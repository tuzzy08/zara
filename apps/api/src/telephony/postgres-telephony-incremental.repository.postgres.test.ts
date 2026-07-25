import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CompiledRuntimeManifest,
} from "@zara/core";
import { defaultPremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models";

import { PostgresTelephonyIncrementalRepository } from "./postgres-telephony-incremental.repository";
import { PostgresTelephonyStateRepository } from "./postgres-telephony-state.repository";
import type {
  CreateTelephonyCallExecutionInput,
  CreateTelephonyCallSetupInput,
  TelephonyPremiumDispatchSnapshot,
} from "./telephony-incremental.repository";
import { computeTelephonyPremiumDispatchSnapshotChecksum } from "./telephony-incremental.repository";
import {
  PstnCapacityRecorder,
  type PstnCapacityMetricPoint,
} from "../runtime-observability/pstn-capacity-observability";

const connectionString = process.env.ZARA_TEST_POSTGRES_URL;

describe.skipIf(connectionString === undefined)("PostgresTelephonyIncrementalRepository PostgreSQL", () => {
  let pool: Pool;
  let repository: PostgresTelephonyIncrementalRepository;
  const suffix = randomUUID();
  const tenantA = `incremental-a-${suffix}`;
  const tenantB = `incremental-b-${suffix}`;
  const snapshotTenant = `incremental-snapshot-${suffix}`;
  const abuseTenant = `incremental-abuse-${suffix}`;
  const abuseRaceTenant = `incremental-abuse-race-${suffix}`;

  beforeAll(async () => {
    const { Pool: PostgresPool } = await import("pg");
    pool = new PostgresPool({ connectionString, max: 8 });
    repository = new PostgresTelephonyIncrementalRepository(pool);
    await seedTenant(pool, tenantA);
    await seedTenant(pool, tenantB);
    await seedTenant(pool, snapshotTenant);
    await seedTenant(pool, abuseTenant);
    await seedTenant(pool, abuseRaceTenant);
  });

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query(
        "delete from tenants where id = any($1::text[])",
        [[tenantA, tenantB, snapshotTenant, abuseTenant, abuseRaceTenant]],
      );
      await pool.end();
    }
  });

  it("serializes a same-key call setup retry without duplicate rows", async () => {
    const setup = callSetup(tenantA, `same-key-${suffix}`);
    const outcomes = await Promise.all([
      repository.createCallSetup(setup),
      repository.createCallSetup(setup),
    ]);

    expect(outcomes).toEqual(
      expect.arrayContaining([
        { outcome: "inserted", mediaToken: "created" },
        { outcome: "existing", mediaToken: "retained" },
      ]),
    );
    const rows = await pool.query(
      `select count(*)::int as count from telephony_execution_sessions
       where tenant_id = $1 and call_session_id = $2`,
      [tenantA, setup.executionSession.callSessionId],
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it("keeps incremental phone-test and abuse posture after a stale configuration save", async () => {
    const stateRepository = new PostgresTelephonyStateRepository(pool);
    const staleSnapshot = await stateRepository.load(snapshotTenant);
    expect(staleSnapshot).not.toBeNull();
    const phoneNumberId = `number-${snapshotTenant}`;
    const connectionId = `connection-${snapshotTenant}`;
    const currentTestRoute = {
      mode: "test_route" as const,
      publishedVersionId: "workflow-current-v2",
      workflowLabel: "Current phone test",
      workspaceId: "workspace-current",
      runtimeProfile: "premium-realtime" as const,
      createdAt: "2026-07-24T12:00:00.000Z",
      allowedCallerNumbers: ["+233201110001"],
      waitingSession: {
        id: `waiting-${suffix}`,
        status: "completed" as const,
        allowedCallerNumbers: ["+233201110001"],
        checklist: {
          verifiedWebhook: true,
          allowedCallerMatched: true,
          mediaWebSocketConnected: true,
          inboundFrameReceived: true,
          transcriptCreated: true,
          agentResponseGenerated: true,
          outboundAudioSent: true,
          cleanEnd: true,
          noFatalError: true,
        },
        createdAt: "2026-07-24T12:00:00.000Z",
        expiresAt: "2026-07-24T12:15:00.000Z",
      },
    };
    const currentPhoneTestResults = [{
      id: `phone-test-${suffix}`,
      tenantId: snapshotTenant,
      numberId: phoneNumberId,
      sessionId: `waiting-${suffix}`,
      status: "passed" as const,
      reason: "All checkpoints passed.",
      checklist: {
        verifiedWebhook: true,
        allowedCallerMatched: true,
        mediaWebSocketConnected: true,
        inboundFrameReceived: true,
        transcriptCreated: true,
        agentResponseGenerated: true,
        outboundAudioSent: true,
        cleanEnd: true,
        noFatalError: true,
      },
      publishedVersionId: currentTestRoute.publishedVersionId,
      runtimeProfile: currentTestRoute.runtimeProfile,
      createdAt: "2026-07-24T12:00:00.000Z",
      completedAt: "2026-07-24T12:05:00.000Z",
    }];
    await expect(
      repository.updatePhoneTestProjection({
        tenantId: snapshotTenant,
        phoneNumberId,
        expectedTestRoute: null,
        expectedPhoneTestResults: null,
        testRoute: currentTestRoute,
        phoneTestResults: currentPhoneTestResults,
      }),
    ).resolves.toEqual({ outcome: "updated" });

    const abuseDispatch = structuredClone(
      callSetup(snapshotTenant, `snapshot-abuse-${suffix}`).dispatch,
    );
    abuseDispatch.direction = "outbound";
    abuseDispatch.disposition = "blocked";
    abuseDispatch.reason = "Outbound abuse threshold exceeded.";
    delete abuseDispatch.callSessionId;
    await expect(
      repository.recordOutboundAbuseBlock({
        dispatch: abuseDispatch,
        connectionIds: [connectionId],
      }),
    ).resolves.toEqual({ outcome: "inserted", connectionCount: 1 });

    staleSnapshot!.connections[0] = {
      ...staleSnapshot!.connections[0]!,
      label: "Updated provider label",
      status: "active",
      healthStatus: "healthy",
    };
    staleSnapshot!.phoneNumbers[0] = {
      ...staleSnapshot!.phoneNumbers[0]!,
      friendlyName: "Updated support line",
      phoneTestResults: [],
    };
    delete staleSnapshot!.phoneNumbers[0]!.testRoute;
    await stateRepository.save(staleSnapshot!);

    await expect(
      pool.query(
        `select label, status, health_status, outbound_abuse_blocked
         from telephony_connections
         where tenant_id = $1 and id = $2`,
        [snapshotTenant, connectionId],
      ),
    ).resolves.toMatchObject({
      rows: [{
        label: "Updated provider label",
        status: "disabled",
        health_status: "failed",
        outbound_abuse_blocked: true,
      }],
    });
    await expect(
      pool.query(
        `select friendly_name, test_route, phone_test_results
         from telephony_phone_numbers
         where tenant_id = $1 and id = $2`,
        [snapshotTenant, phoneNumberId],
      ),
    ).resolves.toMatchObject({
      rows: [{
        friendly_name: "Updated support line",
        test_route: currentTestRoute,
        phone_test_results: currentPhoneTestResults,
      }],
    });
  });

  it("allows only one competing lifecycle compare-and-swap", async () => {
    const setup = callSetup(tenantA, `cas-${suffix}`);
    await repository.createCallSetup(setup);
    const base = {
      tenantId: tenantA,
      callSessionId: setup.executionSession.callSessionId,
      expectedVersion: 0,
      expectedStatus: "ringing" as const,
      updatedAt: new Date().toISOString(),
    };

    const outcomes = await Promise.all([
      repository.transitionExecutionSession({ ...base, nextStatus: "active" }),
      repository.transitionExecutionSession({ ...base, nextStatus: "terminated" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.outcome === "updated")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.outcome === "conflict")).toHaveLength(1);
  });

  it("allows only one competing unclaimed-token rotation", async () => {
    const setup = callSetup(tenantA, `token-race-${suffix}`);
    await repository.createCallSetup(setup);
    const retries = [
      structuredClone(setup),
      structuredClone(setup),
    ];
    retries[0]!.mediaToken.tokenHash = createHash("sha256")
      .update(`rotation-a-${suffix}`)
      .digest("base64url");
    retries[1]!.mediaToken.tokenHash = createHash("sha256")
      .update(`rotation-b-${suffix}`)
      .digest("base64url");
    retries.forEach((retry, index) => {
      retry.mediaToken.createdAt = new Date(Date.now() + index + 1).toISOString();
      retry.mediaToken.expiresAt = new Date(Date.now() + 300_000 + index).toISOString();
    });

    const outcomes = await Promise.all(retries.map((retry) => repository.createCallSetup(retry)));
    expect(outcomes.filter((outcome) => outcome.outcome === "existing")).toEqual([
      { outcome: "existing", mediaToken: "rotated" },
    ]);
    expect(outcomes.filter((outcome) => outcome.outcome === "conflict")).toEqual([
      { outcome: "conflict" },
    ]);

    const winnerIndex = outcomes.findIndex((outcome) => outcome.outcome === "existing");
    await expect(
      repository.claimMediaToken({
        tenantId: tenantA,
        callSessionId: setup.executionSession.callSessionId,
        dispatchId: setup.executionSession.dispatchId,
        connectionId: setup.executionSession.connectionId,
        tokenHash: retries[winnerIndex]!.mediaToken.tokenHash,
      }),
    ).resolves.toMatchObject({ outcome: "claimed" });
  });

  it("allows only one concurrent claim and uses the database clock for expiry", async () => {
    const active = callSetup(tenantA, `claim-race-${suffix}`);
    await repository.createCallSetup(active);

    const claims = await Promise.all([
      repository.claimMediaToken({
        tenantId: tenantA,
        callSessionId: active.executionSession.callSessionId,
        dispatchId: active.executionSession.dispatchId,
        connectionId: active.executionSession.connectionId,
        tokenHash: active.mediaToken.tokenHash,
      }),
      repository.claimMediaToken({
        tenantId: tenantA,
        callSessionId: active.executionSession.callSessionId,
        dispatchId: active.executionSession.dispatchId,
        connectionId: active.executionSession.connectionId,
        tokenHash: active.mediaToken.tokenHash,
      }),
    ]);
    expect(claims.map((claim) => claim.outcome)).toEqual(
      expect.arrayContaining(["claimed", "already_claimed"]),
    );

    const expired = callSetup(tenantA, `expired-${suffix}`);
    expired.mediaToken.createdAt = new Date(Date.now() - 120_000).toISOString();
    expired.mediaToken.expiresAt = new Date(Date.now() - 60_000).toISOString();
    await repository.createCallSetup(expired);
    await expect(
      repository.claimMediaToken({
        tenantId: tenantA,
        callSessionId: expired.executionSession.callSessionId,
        dispatchId: expired.executionSession.dispatchId,
        connectionId: expired.executionSession.connectionId,
        tokenHash: expired.mediaToken.tokenHash,
      }),
    ).resolves.toEqual({ outcome: "expired" });
  });

  it("keeps identical provider call identities independent across tenants", async () => {
    const identity = `shared-provider-call-${suffix}`;
    const outcomes = await Promise.all([
      repository.createCallSetup(callSetup(tenantA, identity)),
      repository.createCallSetup(callSetup(tenantB, identity)),
    ]);

    expect(outcomes).toEqual([
      { outcome: "inserted", mediaToken: "created" },
      { outcome: "inserted", mediaToken: "created" },
    ]);
  });

  it("atomically persists one immutable premium snapshot for concurrent setup retries", async () => {
    const setup = callSetup(tenantA, `snapshot-race-${suffix}`);
    setup.premiumDispatchSnapshot = premiumDispatchSnapshot(setup);

    const outcomes = await Promise.all([
      repository.createCallSetup(structuredClone(setup)),
      repository.createCallSetup(structuredClone(setup)),
    ]);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { outcome: "inserted", mediaToken: "created" },
        { outcome: "existing", mediaToken: "retained" },
      ]),
    );
    await expect(
      repository.loadPremiumDispatchSnapshot({
        tenantId: tenantA,
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).resolves.toEqual({
      outcome: "found",
      snapshot: setup.premiumDispatchSnapshot,
    });
    await expect(
      repository.loadPremiumDispatchSnapshot({
        tenantId: tenantB,
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).resolves.toEqual({ outcome: "not_found" });

    const conflict = structuredClone(setup);
    conflict.premiumDispatchSnapshot!.resolvedConversationPolicy.providers.openaiRealtime.defaultModel =
      "gpt-realtime-conflict";
    conflict.premiumDispatchSnapshot!.checksum =
      computeTelephonyPremiumDispatchSnapshotChecksum(
        snapshotWithoutChecksum(conflict.premiumDispatchSnapshot!),
      );
    await expect(repository.createCallSetup(conflict)).resolves.toEqual({
      outcome: "conflict",
    });
  });

  it("rejects a corrupted premium dispatch snapshot checksum in PostgreSQL", async () => {
    const setup = callSetup(tenantA, `snapshot-corrupt-checksum-${suffix}`);
    setup.premiumDispatchSnapshot = premiumDispatchSnapshot(setup);
    await repository.createCallSetup(setup);
    const corruptedSnapshot = {
      ...structuredClone(setup.premiumDispatchSnapshot),
      checksum: "0".repeat(64),
    };
    await pool.query(
      `update telephony_premium_dispatch_snapshots
       set checksum = $1, snapshot = $2::jsonb
       where tenant_id = $3 and call_session_id = $4`,
      [
        corruptedSnapshot.checksum,
        JSON.stringify(corruptedSnapshot),
        setup.dispatch.tenantId,
        setup.executionSession.callSessionId,
      ],
    );

    await expect(
      repository.loadPremiumDispatchSnapshot({
        tenantId: setup.dispatch.tenantId,
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).rejects.toThrow("Premium dispatch snapshot identities or checksum are invalid.");
  });

  it("rejects a premium dispatch row and payload envelope mismatch in PostgreSQL", async () => {
    const setup = callSetup(tenantA, `snapshot-envelope-mismatch-${suffix}`);
    setup.premiumDispatchSnapshot = premiumDispatchSnapshot(setup);
    await repository.createCallSetup(setup);
    await pool.query(
      `update telephony_premium_dispatch_snapshots
       set workspace_id = $1
       where tenant_id = $2 and call_session_id = $3`,
      [
        "workspace-tampered",
        setup.dispatch.tenantId,
        setup.executionSession.callSessionId,
      ],
    );

    await expect(
      repository.loadPremiumDispatchSnapshot({
        tenantId: setup.dispatch.tenantId,
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).rejects.toThrow("Premium dispatch snapshot envelope is invalid.");
  });

  it("allows one worker claim and fences stale worker epochs in PostgreSQL", async () => {
    const setup = callSetup(tenantA, `worker-claim-${suffix}`);
    setup.premiumDispatchSnapshot = premiumDispatchSnapshot(setup);
    await repository.createCallSetup(setup);
    const claim = {
      tenantId: tenantA,
      callSessionId: setup.executionSession.callSessionId,
      dispatchId: setup.executionSession.dispatchId,
      connectionId: setup.executionSession.connectionId,
      tokenHash: setup.mediaToken.tokenHash,
    };
    const claims = await Promise.all([
      repository.claimMediaToken({ ...claim, workerId: "premium-worker-a" }),
      repository.claimMediaToken({ ...claim, workerId: "premium-worker-b" }),
    ]);
    const winner = claims.find((candidate) => candidate.outcome === "claimed");
    expect(claims.map((candidate) => candidate.outcome)).toEqual(
      expect.arrayContaining(["claimed", "already_claimed"]),
    );
    expect(winner).toMatchObject({ outcome: "claimed", ownerEpoch: 1 });
    const owner = await pool.query<{ owner_worker_id: string; owner_epoch: number }>(
      `select owner_worker_id, owner_epoch
       from telephony_media_stream_tokens
       where tenant_id = $1 and call_session_id = $2`,
      [tenantA, setup.executionSession.callSessionId],
    );
    const ownerWorkerId = owner.rows[0]!.owner_worker_id;
    await expect(
      repository.fencePremiumCallOwnership({
        tenantId: tenantA,
        callSessionId: setup.executionSession.callSessionId,
        workerId: ownerWorkerId,
        ownerEpoch: 1,
      }),
    ).resolves.toEqual({ outcome: "owned", ownerEpoch: 1 });
    await expect(
      repository.fencePremiumCallOwnership({
        tenantId: tenantA,
        callSessionId: setup.executionSession.callSessionId,
        workerId: ownerWorkerId,
        ownerEpoch: 2,
      }),
    ).resolves.toEqual({ outcome: "not_owner" });
    await pool.query(
      `update telephony_execution_sessions
       set lifecycle_state = jsonb_build_object(
         'stage', 'completed',
         'observedAt', current_timestamp
       )
       where tenant_id = $1 and call_session_id = $2`,
      [tenantA, setup.executionSession.callSessionId],
    );
    await expect(
      repository.fencePremiumCallOwnership({
        tenantId: tenantA,
        callSessionId: setup.executionSession.callSessionId,
        workerId: ownerWorkerId,
        ownerEpoch: 1,
      }),
    ).resolves.toEqual({ outcome: "not_owner" });
  });

  it("blocks a stale replica from creating outbound work after another replica records abuse", async () => {
    const postureWriter = new PostgresTelephonyIncrementalRepository(pool);
    const staleReplica = new PostgresTelephonyIncrementalRepository(pool);
    const blockedDispatch = structuredClone(
      callSetup(abuseTenant, `abuse-marker-${suffix}`).dispatch,
    );
    blockedDispatch.direction = "outbound";
    blockedDispatch.disposition = "blocked";
    blockedDispatch.reason = "Outbound abuse threshold exceeded.";
    delete blockedDispatch.callSessionId;

    await expect(
      postureWriter.recordOutboundAbuseBlock({
        dispatch: blockedDispatch,
        connectionIds: [`connection-${abuseTenant}`],
      }),
    ).resolves.toEqual({ outcome: "inserted", connectionCount: 1 });

    const execution = outboundCallExecution(
      abuseTenant,
      `stale-replica-${suffix}`,
    );
    await expect(staleReplica.createCallExecution(execution)).resolves.toEqual({
      outcome: "blocked",
      reasonCode: "outbound_abuse_blocked",
    });

    const created = await pool.query(
      `select
         (select count(*)::int from telephony_dispatches
          where tenant_id = $1 and id = $2) as dispatches,
         (select count(*)::int from telephony_execution_sessions
          where tenant_id = $1 and id = $3) as sessions,
         (select count(*)::int from telephony_execution_commands
          where tenant_id = $1 and session_id = $3) as commands`,
      [
        abuseTenant,
        execution.dispatch.id,
        execution.executionSession.id,
      ],
    );
    expect(created.rows[0]).toEqual({
      dispatches: 0,
      sessions: 0,
      commands: 0,
    });
  });

  it("serializes outbound execution behind an in-flight abuse posture update", async () => {
    const blocker = await pool.connect();
    const { Pool: PostgresPool } = await import("pg");
    const applicationName = `abuse-race-${suffix}`;
    const staleReplicaPool = new PostgresPool({
      connectionString,
      max: 1,
      application_name: applicationName,
    });
    const staleReplica = new PostgresTelephonyIncrementalRepository(staleReplicaPool);
    const execution = outboundCallExecution(
      abuseRaceTenant,
      `abuse-race-${suffix}`,
    );
    let settled = false;

    try {
      await blocker.query("begin");
      await blocker.query(
        `update telephony_connections
         set outbound_abuse_blocked = true
         where tenant_id = $1 and id = $2`,
        [abuseRaceTenant, `connection-${abuseRaceTenant}`],
      );
      const attempted = staleReplica.createCallExecution(execution).finally(() => {
        settled = true;
      });

      await expect(
        waitForBlockedConnectionPostureRead(pool, applicationName),
      ).resolves.toBe("Lock");
      expect(settled).toBe(false);
      await blocker.query("commit");

      await expect(attempted).resolves.toEqual({
        outcome: "blocked",
        reasonCode: "outbound_abuse_blocked",
      });
    } finally {
      if (!settled) {
        await blocker.query("rollback").catch(() => undefined);
      }
      blocker.release();
      await staleReplicaPool.end();
    }
  });

  it("deletes one tenant-owned tested number and cascades only its checkpoints", async () => {
    const phoneNumberId = `number-${tenantA}`;
    await pool.query(
      `insert into telephony_phone_test_checkpoints (
         id, tenant_id, phone_number_id, call_session_id, test_route_session_id,
         checkpoint, observed_at
       ) values ($1, $2, $3, $4, $5, 'verifiedWebhook', current_timestamp)`,
      [
        `checkpoint-delete-${suffix}`,
        tenantA,
        phoneNumberId,
        `delete-number-call-${suffix}`,
        `delete-number-route-${suffix}`,
      ],
    );

    await expect(
      repository.deletePhoneNumber({
        tenantId: tenantA,
        phoneNumberId,
      }),
    ).resolves.toEqual({ outcome: "deleted" });

    const deletedRows = await pool.query(
      `select
         (select count(*)::int from telephony_phone_numbers
          where tenant_id = $1 and id = $2) as phone_numbers,
         (select count(*)::int from telephony_phone_test_checkpoints
          where tenant_id = $1 and phone_number_id = $2) as checkpoints,
         (select count(*)::int from telephony_phone_numbers
          where tenant_id = $3 and id = $4) as other_tenant_numbers`,
      [tenantA, phoneNumberId, tenantB, `number-${tenantB}`],
    );
    expect(deletedRows.rows[0]).toEqual({
      phone_numbers: 0,
      checkpoints: 0,
      other_tenant_numbers: 1,
    });
    await seedPhoneNumber(pool, tenantA);
  });

  it("qualifies 50 same-tenant setups with concurrent cross-tenant isolation and metrics", async () => {
    const metricPoints: PstnCapacityMetricPoint[] = [];
    const observedRepository = new PostgresTelephonyIncrementalRepository(
      pool,
      new PstnCapacityRecorder({
        metricSink: { emit: (point) => metricPoints.push(point) },
      }),
    );
    const tenantACalls = Array.from({ length: 50 }, (_, index) =>
      callSetup(tenantA, `qualification-a-${index}-${suffix}`),
    );
    const tenantBCalls = Array.from({ length: 10 }, (_, index) =>
      callSetup(tenantB, `qualification-b-${index}-${suffix}`),
    );

    const outcomes = await Promise.all(
      [...tenantACalls, ...tenantBCalls].map((setup) =>
        observedRepository.createCallSetup(setup),
      ),
    );
    expect(outcomes).toHaveLength(60);
    expect(outcomes.every((outcome) => outcome.outcome === "inserted")).toBe(true);

    const callSessionIds = [...tenantACalls, ...tenantBCalls].map(
      (setup) => setup.executionSession.callSessionId,
    );
    const counts = await pool.query<{
      tenant_id: string;
      dispatches: number;
      sessions: number;
      commands: number;
      tokens: number;
    }>(
      `select tenant_id,
          count(distinct dispatch_id)::int as dispatches,
          count(distinct session_id)::int as sessions,
          count(distinct command_id)::int as commands,
          count(distinct token_call_session_id)::int as tokens
       from (
         select d.tenant_id, d.id as dispatch_id, s.id as session_id,
                c.id as command_id, t.call_session_id as token_call_session_id
         from telephony_dispatches d
         join telephony_execution_sessions s
           on s.tenant_id = d.tenant_id and s.dispatch_id = d.id
         join telephony_execution_commands c
           on c.tenant_id = s.tenant_id and c.session_id = s.id
         join telephony_media_stream_tokens t
           on t.tenant_id = s.tenant_id and t.call_session_id = s.call_session_id
         where d.call_session_id = any($1::text[])
       ) qualified
       group by tenant_id
       order by tenant_id`,
      [callSessionIds],
    );
    expect(counts.rows).toEqual([
      {
        tenant_id: tenantA,
        dispatches: 50,
        sessions: 50,
        commands: 50,
        tokens: 50,
      },
      {
        tenant_id: tenantB,
        dispatches: 10,
        sessions: 10,
        commands: 10,
        tokens: 10,
      },
    ]);
    await expect(
      observedRepository.loadCallMutationContext({
        tenantId: tenantB,
        callSessionId: tenantACalls[0]!.executionSession.callSessionId,
      }),
    ).resolves.toEqual({ outcome: "not_found" });
    expect(metricPoints.map((point) => point.name)).toEqual(
      expect.arrayContaining([
        "zara.pstn.database.pool_acquisition_wait",
        "zara.pstn.database.transaction_duration",
        "zara.pstn.database.row_lock_wait",
      ]),
    );
    expect(
      metricPoints.filter(
        ({ name }) =>
          name === "zara.pstn.database.deadlocks" ||
          name === "zara.pstn.database.retries",
      ),
    ).toEqual([]);
  }, 30_000);

  it("keeps call-control terminal state monotonic under fresh-version retries", async () => {
    const metricPoints: PstnCapacityMetricPoint[] = [];
    const observedRepository = new PostgresTelephonyIncrementalRepository(
      pool,
      new PstnCapacityRecorder({
        metricSink: { emit: (point) => metricPoints.push(point) },
      }),
    );
    const setup = callSetup(tenantA, `terminal-control-${suffix}`);
    await observedRepository.createCallSetup(setup);
    const at = new Date().toISOString();
    const event = {
      id: `terminal-event-${suffix}`,
      tenantId: tenantA,
      dispatchId: setup.dispatch.id,
      callSessionId: setup.executionSession.callSessionId,
      eventType: "callback.scheduled" as const,
      at,
      summary: "Callback scheduled.",
      payload: { callbackNumber: "+15550002000" },
    };
    const command = {
      id: `terminal-command-${suffix}`,
      tenantId: tenantA,
      sessionId: setup.executionSession.id,
      dispatchId: setup.dispatch.id,
      callSessionId: setup.executionSession.callSessionId,
      provider: "twilio" as const,
      action: "twilio.call.complete",
      status: "applied" as const,
      target: setup.executionSession.bridgeTarget,
      payload: event.payload,
      requestedAt: at,
      appliedAt: at,
    };
    const mutation = {
      tenantId: tenantA,
      dispatchId: setup.dispatch.id,
      callSessionId: setup.executionSession.callSessionId,
      expectedVersion: 0,
      expectedStatus: "ringing" as const,
      session: {
        status: "completed" as const,
        outageMode: null,
        fallbackTarget: null,
        diagnostics: [event.summary],
        updatedAt: at,
      },
      event,
      executionCommands: [command],
      retryCount: 2,
    };

    await expect(observedRepository.recordCallControlMutation(mutation)).resolves.toEqual({
      outcome: "updated",
      version: 1,
    });
    expect(
      metricPoints.filter(({ name }) => name === "zara.pstn.database.retries"),
    ).toEqual([
      expect.objectContaining({
        name: "zara.pstn.database.retries",
        value: 2,
        attributes: {
          operation: "telephony_call_control_mutation",
          outcome: "success",
        },
      }),
    ]);
    await expect(
      observedRepository.recordCallControlMutation({
        ...mutation,
        retryCount: 0,
        expectedVersion: 1,
        expectedStatus: "completed",
        session: {
          ...mutation.session,
          diagnostics: [event.summary, event.summary],
        },
      }),
    ).resolves.toEqual({ outcome: "existing", version: 1 });
    await expect(
      observedRepository.recordCallControlMutation({
        ...mutation,
        retryCount: 0,
        expectedVersion: 1,
        expectedStatus: "completed",
        event: { ...event, id: `late-event-${suffix}` },
        executionCommands: [{ ...command, id: `late-command-${suffix}` }],
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 1 });
    await expect(
      observedRepository.loadCallMutationContext({
        tenantId: tenantA,
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      context: {
        version: 1,
        executionSession: {
          status: "completed",
          diagnostics: [event.summary],
        },
      },
    });
  });

  it("persists separate blocked starts without serializing them through call setup", async () => {
    const first = structuredClone(callSetup(tenantA, `blocked-a-${suffix}`).dispatch);
    const second = structuredClone(callSetup(tenantA, `blocked-b-${suffix}`).dispatch);
    for (const dispatch of [first, second]) {
      dispatch.disposition = "blocked";
      dispatch.reason = "Live route is paused.";
      delete dispatch.callSessionId;
    }

    await expect(
      Promise.all([
        repository.insertDispatch(first),
        repository.insertDispatch(second),
      ]),
    ).resolves.toEqual([{ outcome: "inserted" }, { outcome: "inserted" }]);
  });

  it("rejects setup when its owned number is concurrently deleted", async () => {
    const setup = callSetup(tenantA, `delete-race-${suffix}`);
    const deletingClient = await pool.connect();
    try {
      await deletingClient.query("begin");
      await deletingClient.query(
        "delete from telephony_phone_numbers where tenant_id = $1 and id = $2",
        [tenantA, setup.dispatch.phoneNumberId],
      );

      const setupAttempt = repository.createCallSetup(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await deletingClient.query("commit");

      await expect(setupAttempt).resolves.toEqual({ outcome: "conflict" });
      const dispatch = await pool.query(
        "select id from telephony_dispatches where tenant_id = $1 and id = $2",
        [tenantA, setup.dispatch.id],
      );
      expect(dispatch.rows).toHaveLength(0);
    } finally {
      await deletingClient.query("rollback").catch(() => undefined);
      deletingClient.release();
      await seedPhoneNumber(pool, tenantA);
    }
  });

  it("rejects a retry that changes failover routing state", async () => {
    const setup = callSetup(tenantA, `fallback-retry-${suffix}`);
    setup.dispatch.outageMode = "provider-fallback";
    setup.executionSession.outageMode = "provider-fallback";
    setup.executionSession.fallbackTarget = "+15550003000";
    await repository.createCallSetup(setup);

    const conflicting = structuredClone(setup);
    conflicting.executionSession.fallbackTarget = "+15550004000";
    await expect(repository.createCallSetup(conflicting)).resolves.toEqual({
      outcome: "conflict",
    });
  });

  it("rolls back a dispatch when a dependent session identity conflicts", async () => {
    const existing = callSetup(tenantA, `rollback-existing-${suffix}`);
    await repository.createCallSetup(existing);
    const conflicting = callSetup(tenantA, `rollback-conflict-${suffix}`);
    conflicting.executionSession.id = existing.executionSession.id;
    conflicting.executionCommands = conflicting.executionCommands.map((command) => ({
      ...command,
      sessionId: existing.executionSession.id,
    }));

    await expect(repository.createCallSetup(conflicting)).resolves.toEqual({ outcome: "conflict" });
    const dispatch = await pool.query("select id from telephony_dispatches where id = $1", [
      conflicting.dispatch.id,
    ]);
    expect(dispatch.rows).toHaveLength(0);
  });

  it("rejects cross-tenant provider references without creating webhook or call rows", async () => {
    const eventId = `event-${suffix}`;
    await expect(
      repository.insertWebhookEvent({
        id: `${tenantA}:${eventId}`,
        tenantId: tenantA,
        connectionId: `connection-${tenantB}`,
        accountSid: "AC-cross-tenant",
        callSid: "CA-cross-tenant",
        eventSid: eventId,
        eventType: "voice.incoming",
        receivedAt: new Date().toISOString(),
        duplicate: false,
      }),
    ).resolves.toEqual({ outcome: "conflict" });

    const setup = callSetup(tenantA, `cross-tenant-${suffix}`);
    setup.dispatch.connectionId = `connection-${tenantB}`;
    setup.executionSession.connectionId = `connection-${tenantB}`;
    setup.mediaToken.connectionId = `connection-${tenantB}`;
    await expect(repository.createCallSetup(setup)).resolves.toEqual({ outcome: "conflict" });
  });

  it("retains routed pre-session dispatches while deleting terminal graphs and blocked orphans", async () => {
    const cutoff = "2026-07-24T00:00:00.000Z";
    const oldTimestamp = "2026-07-23T12:00:00.000Z";
    const terminal = callSetup(tenantA, `retention-terminal-${suffix}`);
    const routedPreSession = structuredClone(
      callSetup(tenantA, `retention-routed-${suffix}`).dispatch,
    );
    const blockedOrphan = structuredClone(
      callSetup(tenantA, `retention-blocked-${suffix}`).dispatch,
    );
    const otherTenantRouted = structuredClone(
      callSetup(tenantB, `retention-other-${suffix}`).dispatch,
    );
    routedPreSession.createdAt = oldTimestamp;
    blockedOrphan.createdAt = oldTimestamp;
    blockedOrphan.disposition = "blocked";
    delete blockedOrphan.callSessionId;
    otherTenantRouted.createdAt = oldTimestamp;

    await repository.createCallSetup(terminal);
    await pool.query(
      `update telephony_execution_sessions
       set status = 'completed',
           lifecycle_state = $3::jsonb,
           updated_at = $4
       where tenant_id = $1 and call_session_id = $2`,
      [
        tenantA,
        terminal.executionSession.callSessionId,
        JSON.stringify({
          stage: "completed",
          observedAt: oldTimestamp,
        }),
        oldTimestamp,
      ],
    );
    await repository.insertDispatch(routedPreSession);
    await repository.insertDispatch(blockedOrphan);
    await repository.insertDispatch(otherTenantRouted);

    await expect(
      repository.deleteRetainedCallData({
        tenantId: tenantA,
        retainAfter: cutoff,
      }),
    ).resolves.toMatchObject({
      tenantId: tenantA,
      retainAfter: cutoff,
      deletedCounts: {
        executionSessions: 1,
        dispatches: 2,
      },
    });
    await expect(
      pool.query(
        `select id from telephony_dispatches
         where tenant_id = $1 and id = any($2::text[])
         order by id`,
        [
          tenantA,
          [terminal.dispatch.id, routedPreSession.id, blockedOrphan.id],
        ],
      ),
    ).resolves.toMatchObject({
      rows: [{ id: routedPreSession.id }],
    });
    await expect(
      pool.query(
        "select id from telephony_dispatches where tenant_id = $1 and id = $2",
        [tenantB, otherTenantRouted.id],
      ),
    ).resolves.toMatchObject({
      rows: [{ id: otherTenantRouted.id }],
    });
  });
});

async function seedTenant(pool: Pool, tenantId: string) {
  await pool.query(
    `insert into tenants (id, slug, name, status, default_locale, created_at, updated_at)
     values ($1, $1, $1, 'active', 'en', current_timestamp, current_timestamp)`,
    [tenantId],
  );
  await pool.query(
    `insert into telephony_connections (
       id, tenant_id, label, ownership_mode, provider, region, status, health_status,
       recording_policy, block_routing_on_health_failure, webhook_status, created_by
     ) values ($1, $2, 'Test Twilio', 'byo_provider_account', 'twilio', 'us-east-1',
       'active', 'healthy', $3::jsonb, true, 'configured', 'integration-test')`,
    [`connection-${tenantId}`, tenantId, JSON.stringify(recordingPolicy())],
  );
  await seedPhoneNumber(pool, tenantId);
}

async function seedPhoneNumber(pool: Pool, tenantId: string) {
  await pool.query(
    `insert into telephony_phone_numbers (
       id, tenant_id, connection_id, provider, provision_source, external_number_id,
       phone_number, friendly_name, voice_capable, caller_id_eligible, status, webhook_status
     ) values ($1, $2, $3, 'twilio', 'provider-import', $4, $5, 'Test line', true, true,
       'routed', 'configured')
     on conflict (id) do nothing`,
    [
      `number-${tenantId}`,
      tenantId,
      `connection-${tenantId}`,
      `PN-${tenantId}`,
      `+1${createHash("sha256").update(tenantId).digest("hex").slice(0, 10)}`,
    ],
  );
}

function callSetup(tenantId: string, identity: string): CreateTelephonyCallSetupInput {
  const dispatchId = `dispatch-${identity}`;
  const callSessionId = `session-${identity}`;
  const now = new Date().toISOString();
  return {
    dispatch: {
      id: dispatchId,
      tenantId,
      direction: "inbound",
      disposition: "routed",
      reason: "PostgreSQL integration test route.",
      routeMode: "live_route",
      callSessionId,
      phoneNumberId: `number-${tenantId}`,
      connectionId: `connection-${tenantId}`,
      publishedVersionId: "workflow-v1",
      workspaceId: "workspace-1",
      workflowLabel: "Support",
      runtimeProfile: "premium-realtime",
      runtimePath: "pstn-premium-realtime",
      recording: recordingPolicy(),
      recordingConsent: {
        state: "not_required",
        noticeRequired: false,
        consentMode: "disabled",
        message: "",
        recordedAt: now,
        reason: "Recording is disabled.",
      },
      toPhoneNumber: "+15550001000",
      fromPhoneNumber: "+15550002000",
      createdAt: now,
      source: "webhook",
    },
    executionSession: {
      id: `execution-${identity}`,
      tenantId,
      dispatchId,
      callSessionId,
      connectionId: `connection-${tenantId}`,
      provider: "twilio",
      ownershipMode: "byo_provider_account",
      direction: "inbound",
      status: "ringing",
      lifecycleState: {
        stage: "ringing",
        observedAt: now,
      },
      toPhoneNumber: "+15550001000",
      fromPhoneNumber: "+15550002000",
      workflowLabel: "Support",
      workspaceId: "workspace-1",
      testCall: false,
      bridgeKind: "twilio-programmable-voice",
      bridgeTarget: "+15550001000",
      mediaPath: "provider-native",
      diagnostics: [],
      createdAt: now,
      updatedAt: now,
    },
    executionCommands: [
      {
        id: `execution-${identity}:bridge:1`,
        tenantId,
        sessionId: `execution-${identity}`,
        dispatchId,
        callSessionId,
        provider: "twilio",
        action: "twilio.connect-stream",
        status: "applied",
        target: "+15550001000",
        payload: { runtimePath: "pstn-premium-realtime" },
        requestedAt: now,
        appliedAt: now,
      },
    ],
    mediaToken: {
      tenantId,
      callSessionId,
      dispatchId,
      connectionId: `connection-${tenantId}`,
      tokenHash: createHash("sha256").update(`${tenantId}:${identity}`).digest("base64url"),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      createdAt: now,
    },
  };
}

function premiumDispatchSnapshot(
  setup: CreateTelephonyCallSetupInput,
): TelephonyPremiumDispatchSnapshot {
  const snapshot = {
    schemaVersion: 1 as const,
    tenantId: setup.dispatch.tenantId,
    workspaceId: setup.dispatch.workspaceId!,
    callSessionId: setup.executionSession.callSessionId,
    dispatchId: setup.dispatch.id,
    publishedVersionId: setup.dispatch.publishedVersionId!,
    resolvedManifest: {
      tenantId: setup.dispatch.tenantId,
      workspaceId: setup.dispatch.workspaceId,
      publishedVersionId: setup.dispatch.publishedVersionId,
      runtimeProfile: "premium-realtime",
      compiledDefinitionHash: "manifest-definition-hash",
    } as unknown as CompiledRuntimeManifest,
    resolvedConversationPolicy: structuredClone(defaultPremiumRealtimeConversationPolicy),
    workerTarget: {
      workerId: "worker-test-1",
      releaseId: "release-test-1",
      mediaStreamBaseUrl:
        "wss://worker-test.zara.test/telephony/twilio/media-streams",
    },
    createdAt: setup.executionSession.createdAt,
  };
  return {
    ...snapshot,
    checksum: computeTelephonyPremiumDispatchSnapshotChecksum(snapshot),
  };
}

function snapshotWithoutChecksum(
  snapshot: TelephonyPremiumDispatchSnapshot,
): Omit<TelephonyPremiumDispatchSnapshot, "checksum"> {
  const withoutChecksum = structuredClone(snapshot) as Partial<TelephonyPremiumDispatchSnapshot>;
  delete withoutChecksum.checksum;
  return withoutChecksum as Omit<TelephonyPremiumDispatchSnapshot, "checksum">;
}

function outboundCallExecution(
  tenantId: string,
  identity: string,
): CreateTelephonyCallExecutionInput {
  const setup = callSetup(tenantId, identity);
  setup.dispatch.direction = "outbound";
  setup.dispatch.disposition = "queued";
  setup.dispatch.reason = "Outbound call queued.";
  setup.executionSession.direction = "outbound";
  return {
    dispatch: setup.dispatch,
    executionSession: setup.executionSession,
    executionCommands: setup.executionCommands,
  };
}

function recordingPolicy() {
  return { enabled: false, consentMode: "disabled" as const, consentMessage: "" };
}

async function waitForBlockedConnectionPostureRead(
  pool: Pool,
  applicationName: string,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const activity = await pool.query<{ wait_event_type: string | null }>(
      `select wait_event_type
       from pg_stat_activity
       where application_name = $1
         and state = 'active'
         and query like 'select outbound_abuse_blocked%'`,
      [applicationName],
    );
    if (activity.rows[0]?.wait_event_type != null) {
      return activity.rows[0].wait_event_type;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the outbound posture row lock.");
}
