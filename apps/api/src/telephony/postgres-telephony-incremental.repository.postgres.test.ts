import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresTelephonyIncrementalRepository } from "./postgres-telephony-incremental.repository";
import type { CreateTelephonyCallSetupInput } from "./telephony-incremental.repository";
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

  beforeAll(async () => {
    const { Pool: PostgresPool } = await import("pg");
    pool = new PostgresPool({ connectionString, max: 8 });
    repository = new PostgresTelephonyIncrementalRepository(pool);
    await seedTenant(pool, tenantA);
    await seedTenant(pool, tenantB);
  });

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query("delete from tenants where id = any($1::text[])", [[tenantA, tenantB]]);
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

function recordingPolicy() {
  return { enabled: false, consentMode: "disabled" as const, consentMessage: "" };
}
