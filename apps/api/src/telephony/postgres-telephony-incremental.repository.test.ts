import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import type {
  CompiledRuntimeManifest,
} from "@zara/core";
import { defaultPremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models";

import { PostgresTelephonyIncrementalRepository } from "./postgres-telephony-incremental.repository";
import type {
  CreateTelephonyCallExecutionInput,
  CreateTelephonyCallSetupInput,
  TelephonyPremiumDispatchSnapshot,
} from "./telephony-incremental.repository";
import { computeTelephonyPremiumDispatchSnapshotChecksum } from "./telephony-incremental.repository";
import { hashOneTimeStreamToken } from "../security/one-time-stream-token";

describe("PostgresTelephonyIncrementalRepository", () => {
  let pool: Pool | null = null;

  afterEach(async () => {
    await pool?.end();
    pool = null;
  });

  it("deduplicates provider events with explicit retry and conflict outcomes", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const event = webhookEvent("tenant-a", "event-1");

    await expect(harness.repository.insertWebhookEvent(event)).resolves.toEqual({
      outcome: "inserted",
      receivedAt: event.receivedAt,
    });
    await expect(
      harness.repository.insertWebhookEvent({
        ...event,
        receivedAt: "2026-07-23T12:00:05.000Z",
        duplicate: true,
      }),
    ).resolves.toEqual({
      outcome: "existing",
      receivedAt: event.receivedAt,
    });
    await expect(
      harness.repository.insertWebhookEvent({ ...event, callSid: "CA-conflict" }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      harness.repository.insertWebhookEvent(webhookEvent("tenant-b", "event-1")),
    ).resolves.toEqual({
      outcome: "inserted",
      receivedAt: webhookEvent("tenant-b", "event-1").receivedAt,
    });
    await expect(
      harness.repository.insertWebhookEvent({
        ...webhookEvent("tenant-a", "event-cross-tenant"),
        connectionId: "connection-tenant-b",
      }),
    ).resolves.toEqual({ outcome: "conflict" });
  });

  it("loads fresh tenant-scoped connection admission posture", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    await harness.pool.query(
      `update telephony_connections
       set status = 'disabled',
           health_status = 'failed',
           block_routing_on_health_failure = true
       where tenant_id = $1 and id = $2`,
      ["tenant-a", "connection-tenant-a"],
    );

    await expect(
      harness.repository.loadConnectionAdmissionPosture({
        tenantId: "tenant-a",
        connectionId: "connection-tenant-a",
      }),
    ).resolves.toEqual({
      outcome: "found",
      posture: {
        status: "disabled",
        healthStatus: "failed",
        blockRoutingOnHealthFailure: true,
      },
    });
    await expect(
      harness.repository.loadConnectionAdmissionPosture({
        tenantId: "tenant-b",
        connectionId: "connection-tenant-a",
      }),
    ).resolves.toEqual({ outcome: "not_found" });
    await expect(
      harness.repository.loadConnectionAdmissionPosture({
        tenantId: "tenant-a",
        connectionId: "missing-connection",
      }),
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("persists a blocked dispatch idempotently without creating call setup rows", async () => {
    const harness = await createHarness();
    const dispatch = structuredClone(callSetup("tenant-a", "blocked-call").dispatch);
    dispatch.disposition = "blocked";
    dispatch.reason = "Live route is paused.";
    delete dispatch.callSessionId;

    await expect(harness.repository.insertDispatch(dispatch)).resolves.toEqual({
      outcome: "inserted",
    });
    await expect(
      harness.repository.insertDispatch({
        ...dispatch,
        createdAt: "2026-07-23T12:00:05.000Z",
      }),
    ).resolves.toEqual({ outcome: "existing" });
    await expect(
      harness.repository.insertDispatch({
        ...dispatch,
        reason: "A materially different block.",
      }),
    ).resolves.toEqual({ outcome: "conflict" });

    expect((await harness.pool.query("select * from telephony_dispatches")).rows).toHaveLength(1);
    expect((await harness.pool.query("select * from telephony_execution_sessions")).rows).toEqual([]);
    expect((await harness.pool.query("select * from telephony_media_stream_tokens")).rows).toEqual([]);
  });

  it("creates each call setup atomically and preserves concurrent same-tenant calls", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const first = callSetup("tenant-a", "call-1");
    const second = callSetup("tenant-a", "call-2");

    await expect(
      Promise.all([
        harness.repository.createCallSetup(first),
        harness.repository.createCallSetup(second),
      ]),
    ).resolves.toEqual([
      { outcome: "inserted", mediaToken: "created" },
      { outcome: "inserted", mediaToken: "created" },
    ]);
    await expect(harness.repository.createCallSetup(first)).resolves.toEqual({
      outcome: "existing",
      mediaToken: "retained",
    });
    const regeneratedRetry = callSetup("tenant-a", "call-1");
    regeneratedRetry.dispatch.createdAt = "2026-07-23T12:00:02.000Z";
    regeneratedRetry.executionSession.status = "active";
    regeneratedRetry.executionSession.diagnostics = ["Provider retry observed after setup."];
    regeneratedRetry.executionSession.createdAt = "2026-07-23T12:00:02.000Z";
    regeneratedRetry.executionSession.updatedAt = "2026-07-23T12:00:02.000Z";
    await expect(harness.repository.createCallSetup(regeneratedRetry)).resolves.toEqual({
      outcome: "conflict",
    });
    await expect(
      harness.repository.createCallSetup({
        ...first,
        executionSession: { ...first.executionSession, bridgeTarget: "+15550009999" },
      }),
    ).resolves.toEqual({ outcome: "conflict" });

    const rotated = callSetup("tenant-a", "call-1");
    rotated.mediaToken.tokenHash = hashOneTimeStreamToken("rotated-token");
    rotated.mediaToken.createdAt = "2026-07-23T12:00:01.000Z";
    rotated.mediaToken.expiresAt = "2026-07-23T12:06:00.000Z";
    rotated.dispatch.createdAt = "2026-07-23T12:00:01.000Z";
    rotated.executionSession.createdAt = "2026-07-23T12:00:01.000Z";
    rotated.executionSession.updatedAt = "2026-07-23T12:00:01.000Z";
    await expect(harness.repository.createCallSetup(rotated)).resolves.toEqual({
      outcome: "existing",
      mediaToken: "rotated",
    });
    const crossTenant = callSetup("tenant-a", "call-cross-tenant");
    crossTenant.dispatch.connectionId = "connection-tenant-b";
    crossTenant.executionSession.connectionId = "connection-tenant-b";
    crossTenant.mediaToken.connectionId = "connection-tenant-b";
    await expect(harness.repository.createCallSetup(crossTenant)).resolves.toEqual({
      outcome: "conflict",
    });

    const counts = await harness.pool.query<{ table_name: string; count: string }>(`
      SELECT 'dispatches' AS table_name, count(*)::text AS count FROM telephony_dispatches
      UNION ALL SELECT 'sessions', count(*)::text FROM telephony_execution_sessions
      UNION ALL SELECT 'commands', count(*)::text FROM telephony_execution_commands
      UNION ALL SELECT 'tokens', count(*)::text FROM telephony_media_stream_tokens
    `);
    expect(counts.rows).toEqual([
      { table_name: "dispatches", count: "2" },
      { table_name: "sessions", count: "2" },
      { table_name: "commands", count: "2" },
      { table_name: "tokens", count: "2" },
    ]);
  });

  it("records incremental pool, transaction, row-lock, deadlock, and retry metrics nonfatally", async () => {
    const recordDatabaseOperation = vi.fn();
    const harness = await createHarness({ recordDatabaseOperation });
    pool = harness.pool;

    await expect(
      harness.repository.createCallSetup(callSetup("tenant-a", "observed-call")),
    ).resolves.toEqual({ outcome: "inserted", mediaToken: "created" });

    const transactionObservation = recordDatabaseOperation.mock.calls
      .map(([observation]) => observation)
      .find(
        (observation) =>
          observation.operation === "telephony_call_setup_create" &&
          observation.transactionDurationMs !== undefined,
      );
    expect(transactionObservation).toEqual(
      expect.objectContaining({
        operation: "telephony_call_setup_create",
        outcome: "success",
        queryDurationMs: expect.any(Number),
        transactionDurationMs: expect.any(Number),
        poolAcquisitionWaitMs: expect.any(Number),
        rowLockWaitMs: expect.any(Number),
      }),
    );
    expect(transactionObservation).not.toHaveProperty("deadlockCount");
    expect(transactionObservation).not.toHaveProperty("retryCount");

    recordDatabaseOperation.mockImplementation(() => {
      throw new Error("metrics exporter unavailable");
    });
    await expect(
      harness.repository.createCallSetup(callSetup("tenant-a", "metrics-failure")),
    ).resolves.toEqual({ outcome: "inserted", mediaToken: "created" });
  });

  it("creates tokenless call execution with required commands atomically and idempotently", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "tokenless-call");
    const execution: CreateTelephonyCallExecutionInput = {
      dispatch: setup.dispatch,
      executionSession: setup.executionSession,
      executionCommands: setup.executionCommands,
    };

    await expect(harness.repository.createCallExecution(execution)).resolves.toEqual({
      outcome: "inserted",
    });
    await expect(harness.repository.createCallExecution(execution)).resolves.toEqual({
      outcome: "existing",
    });

    const conflicting = structuredClone(execution);
    conflicting.executionCommands[0]!.target = "+15550009999";
    await expect(harness.repository.createCallExecution(conflicting)).resolves.toEqual({
      outcome: "conflict",
    });

    const counts = await harness.pool.query<{ table_name: string; count: string }>(`
      SELECT 'dispatches' AS table_name, count(*)::text AS count FROM telephony_dispatches
      UNION ALL SELECT 'sessions', count(*)::text FROM telephony_execution_sessions
      UNION ALL SELECT 'commands', count(*)::text FROM telephony_execution_commands
      UNION ALL SELECT 'tokens', count(*)::text FROM telephony_media_stream_tokens
    `);
    expect(counts.rows).toEqual([
      { table_name: "dispatches", count: "1" },
      { table_name: "sessions", count: "1" },
      { table_name: "commands", count: "1" },
      { table_name: "tokens", count: "0" },
    ]);
  });

  it("inserts and loads an immutable premium dispatch snapshot with call setup", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "premium-snapshot");
    setup.premiumDispatchSnapshot = premiumDispatchSnapshot(setup);

    await expect(harness.repository.createCallSetup(setup)).resolves.toEqual({
      outcome: "inserted",
      mediaToken: "created",
    });
    await expect(
      harness.repository.loadPremiumDispatchSnapshot({
        tenantId: "tenant-a",
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).resolves.toEqual({
      outcome: "found",
      snapshot: setup.premiumDispatchSnapshot,
    });
    await expect(harness.repository.createCallSetup(structuredClone(setup))).resolves.toEqual({
      outcome: "existing",
      mediaToken: "retained",
    });

    const conflicting = structuredClone(setup);
    conflicting.premiumDispatchSnapshot!.resolvedConversationPolicy.providers.openaiRealtime.defaultModel =
      "gpt-realtime-conflict";
    conflicting.premiumDispatchSnapshot!.checksum =
      computeTelephonyPremiumDispatchSnapshotChecksum(
        snapshotWithoutChecksum(conflicting.premiumDispatchSnapshot!),
      );
    await expect(harness.repository.createCallSetup(conflicting)).resolves.toEqual({
      outcome: "conflict",
    });
    await expect(
      harness.repository.loadPremiumDispatchSnapshot({
        tenantId: "tenant-b",
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("rejects a premium dispatch snapshot whose persisted checksum is corrupted", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "premium-snapshot-corrupt-checksum");
    setup.premiumDispatchSnapshot = premiumDispatchSnapshot(setup);
    await harness.repository.createCallSetup(setup);
    const corruptedSnapshot = {
      ...structuredClone(setup.premiumDispatchSnapshot),
      checksum: "0".repeat(64),
    };
    await harness.pool.query(
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
      harness.repository.loadPremiumDispatchSnapshot({
        tenantId: setup.dispatch.tenantId,
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).rejects.toThrow("Premium dispatch snapshot identities or checksum are invalid.");
  });

  it("rejects a premium dispatch snapshot whose row envelope disagrees with its payload", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "premium-snapshot-envelope-mismatch");
    setup.premiumDispatchSnapshot = premiumDispatchSnapshot(setup);
    await harness.repository.createCallSetup(setup);
    await harness.pool.query(
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
      harness.repository.loadPremiumDispatchSnapshot({
        tenantId: setup.dispatch.tenantId,
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).rejects.toThrow("Premium dispatch snapshot envelope is invalid.");
  });

  it("rejects sensitive premium snapshot material and rolls back the entire call setup", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "sensitive-premium-snapshot");
    const snapshot = premiumDispatchSnapshot(setup) as TelephonyPremiumDispatchSnapshot & {
      resolvedManifest: { credentials?: { accessToken: string } };
    };
    snapshot.resolvedManifest.credentials = { accessToken: "must-not-be-persisted" };
    snapshot.checksum = computeTelephonyPremiumDispatchSnapshotChecksum(
      snapshotWithoutChecksum(snapshot),
    );
    setup.premiumDispatchSnapshot = snapshot;

    await expect(harness.repository.createCallSetup(setup)).rejects.toThrow(
      "Premium dispatch snapshot contains sensitive material.",
    );
    const rolledBackRows = await Promise.all(
      [
        "telephony_dispatches",
        "telephony_execution_sessions",
        "telephony_media_stream_tokens",
        "telephony_premium_dispatch_snapshots",
      ].map((table) =>
        harness.pool.query(`select tenant_id from ${table} where tenant_id = $1`, ["tenant-a"]),
      ),
    );
    expect(rolledBackRows.every((result) => result.rows.length === 0)).toBe(true);
  });

  it("rejects an outbound execution when its tenant-owned connection is abuse blocked", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const execution = outboundCallExecution("tenant-a", "abuse-blocked-execution");
    await harness.pool.query(
      `update telephony_connections
       set outbound_abuse_blocked = true
       where tenant_id = $1 and id = $2`,
      [execution.dispatch.tenantId, execution.executionSession.connectionId],
    );

    await expect(harness.repository.createCallExecution(execution)).resolves.toEqual({
      outcome: "blocked",
      reasonCode: "outbound_abuse_blocked",
    });

    const counts = await harness.pool.query<{ table_name: string; count: string }>(`
      SELECT 'dispatches' AS table_name, count(*)::text AS count FROM telephony_dispatches
      UNION ALL SELECT 'sessions', count(*)::text FROM telephony_execution_sessions
      UNION ALL SELECT 'commands', count(*)::text FROM telephony_execution_commands
    `);
    expect(counts.rows).toEqual([
      { table_name: "dispatches", count: "0" },
      { table_name: "sessions", count: "0" },
      { table_name: "commands", count: "0" },
    ]);

    await expect(
      harness.repository.createCallExecution(
        outboundCallExecution("tenant-b", "other-tenant-outbound"),
      ),
    ).resolves.toEqual({ outcome: "inserted" });
    const inbound = callSetup("tenant-a", "abuse-blocked-inbound");
    await expect(
      harness.repository.createCallExecution({
        dispatch: inbound.dispatch,
        executionSession: inbound.executionSession,
        executionCommands: inbound.executionCommands,
      }),
    ).resolves.toEqual({ outcome: "inserted" });
  });

  it("rejects duplicate setup after the established session has progressed", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "call-terminal-retry");
    await harness.repository.createCallSetup(setup);
    await harness.pool.query(
      `update telephony_execution_sessions
       set status = 'completed', version = 1
       where tenant_id = $1 and call_session_id = $2`,
      [setup.dispatch.tenantId, setup.executionSession.callSessionId],
    );

    await expect(harness.repository.createCallSetup(setup)).resolves.toEqual({
      outcome: "conflict",
    });
  });

  it("validates fallback numbers against the selected fallback connection", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "call-fallback");
    setup.dispatch.fallbackPhoneNumberId = "number-a-fallback";
    setup.dispatch.connectionId = "connection-tenant-a-fallback";
    setup.executionSession.connectionId = "connection-tenant-a-fallback";
    setup.mediaToken.connectionId = "connection-tenant-a-fallback";

    await expect(harness.repository.createCallSetup(setup)).resolves.toEqual({
      outcome: "inserted",
      mediaToken: "created",
    });

    const conflictingRetry = structuredClone(setup);
    conflictingRetry.executionSession.fallbackTarget = "+15550009999";
    await expect(harness.repository.createCallSetup(conflictingRetry)).resolves.toEqual({
      outcome: "conflict",
    });
  });

  it("rejects a retry that changes the initial recording consent state", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "call-consent");

    await expect(harness.repository.createCallSetup(setup)).resolves.toEqual({
      outcome: "inserted",
      mediaToken: "created",
    });

    const conflictingRetry = structuredClone(setup);
    conflictingRetry.dispatch.recordingConsent.reason = "A different consent decision.";
    conflictingRetry.executionSession.recordingConsent = conflictingRetry.dispatch.recordingConsent;
    await expect(harness.repository.createCallSetup(conflictingRetry)).resolves.toEqual({
      outcome: "conflict",
    });
  });

  it("rolls back call setup when a dependent row cannot be created", async () => {
    const setup = callSetup("tenant-a", "call-rollback");
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: setup.executionSession.connectionId }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: setup.dispatch.phoneNumberId,
            connection_id: setup.executionSession.connectionId,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: setup.dispatch.id }] })
      .mockRejectedValueOnce(Object.assign(new Error("foreign key violation"), { code: "23503" }))
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const repository = new PostgresTelephonyIncrementalRepository({
      connect: async () => ({ query, release }),
      query: vi.fn(),
    } as never);

    await expect(
      repository.createCallSetup(setup),
    ).rejects.toThrow();
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      "begin",
      "select",
      "select",
      "insert",
      "insert",
      "rollback",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("uses versioned compare-and-swap for execution and call lifecycle transitions", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "call-cas");
    await harness.repository.createCallSetup(setup);

    const transition = {
      tenantId: "tenant-a",
      callSessionId: setup.executionSession.callSessionId,
      expectedVersion: 0,
      expectedStatus: "ringing" as const,
      nextStatus: "active" as const,
      updatedAt: "2026-07-23T12:00:01.000Z",
    };
    await expect(harness.repository.transitionExecutionSession(transition)).resolves.toEqual({
      outcome: "updated",
      version: 1,
    });
    await expect(harness.repository.transitionExecutionSession(transition)).resolves.toEqual({
      outcome: "existing",
      version: 1,
    });
    await expect(
      harness.repository.transitionExecutionSession({
        ...transition,
        nextStatus: "terminated",
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 1 });
    await expect(
      harness.repository.transitionExecutionSession({
        ...transition,
        updatedAt: "2026-07-23T12:00:03.000Z",
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 1 });
    await expect(
      harness.repository.transitionExecutionSession({ ...transition, tenantId: "tenant-b" }),
    ).resolves.toEqual({ outcome: "not_found" });

    await expect(
      harness.repository.transitionExecutionSession({
        ...transition,
        expectedVersion: 1,
        expectedStatus: "active",
        nextStatus: "terminated",
        updatedAt: "2026-07-23T12:00:04.000Z",
      }),
    ).resolves.toEqual({ outcome: "updated", version: 2 });
    await expect(
      harness.repository.transitionExecutionSession({
        ...transition,
        expectedVersion: 2,
        expectedStatus: "terminated",
        nextStatus: "active",
        updatedAt: "2026-07-23T12:00:05.000Z",
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 2 });

  });

  it("loads the owned mutation context and records call control atomically", async () => {
    const recordDatabaseOperation = vi.fn();
    const harness = await createHarness({ recordDatabaseOperation });
    pool = harness.pool;
    const setup = callSetup("tenant-a", "call-control");
    await harness.repository.createCallSetup(setup);

    await expect(
      harness.repository.loadCallMutationContext({
        tenantId: "tenant-a",
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).resolves.toEqual({
      outcome: "found",
      context: {
        dispatch: setup.dispatch,
        executionSession: setup.executionSession,
        version: 0,
      },
    });
    await expect(
      harness.repository.loadCallMutationContext({
        tenantId: "tenant-b",
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).resolves.toEqual({ outcome: "not_found" });

    const event = {
      id: "shared-control-event",
      tenantId: "tenant-a",
      dispatchId: setup.dispatch.id,
      callSessionId: setup.executionSession.callSessionId,
      eventType: "dtmf.received" as const,
      at: "2026-07-23T12:00:01.000Z",
      summary: "Caller selected support.",
      payload: { digit: "1" },
    };
    const command = {
      id: "shared-control-command",
      tenantId: "tenant-a",
      sessionId: setup.executionSession.id,
      dispatchId: setup.dispatch.id,
      callSessionId: setup.executionSession.callSessionId,
      provider: "twilio" as const,
      action: "twilio.dtmf.received",
      status: "applied" as const,
      target: setup.executionSession.bridgeTarget,
      payload: { digit: "1" },
      requestedAt: event.at,
      appliedAt: event.at,
    };
    const mutation = {
      tenantId: "tenant-a",
      callSessionId: setup.executionSession.callSessionId,
      dispatchId: setup.dispatch.id,
      expectedVersion: 0,
      expectedStatus: "ringing" as const,
      session: {
        status: "active" as const,
        outageMode: null,
        fallbackTarget: null,
        diagnostics: [event.summary],
        updatedAt: event.at,
      },
      event,
      executionCommands: [command],
      retryCount: 2,
    };

    recordDatabaseOperation.mockClear();
    await expect(harness.repository.recordCallControlMutation(mutation)).resolves.toEqual({
      outcome: "updated",
      version: 1,
    });
    expect(
      recordDatabaseOperation.mock.calls
        .map(([observation]) => observation)
        .filter((observation) => observation.retryCount !== undefined),
    ).toEqual([
      expect.objectContaining({
        operation: "telephony_call_control_mutation",
        outcome: "success",
        retryCount: 2,
      }),
    ]);
    recordDatabaseOperation.mockClear();
    await expect(
      harness.repository.recordCallControlMutation({
        ...mutation,
        event: {
          ...event,
          id: "stale-control-event",
        },
        executionCommands: [
          {
            ...command,
            id: "stale-control-command",
          },
        ],
        retryCount: 1,
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 1 });
    expect(
      recordDatabaseOperation.mock.calls
        .map(([observation]) => observation)
        .filter((observation) => observation.retryCount !== undefined),
    ).toEqual([]);
    const reloaded = await harness.repository.loadCallMutationContext({
      tenantId: mutation.tenantId,
      callSessionId: mutation.callSessionId,
    });
    expect(reloaded.outcome).toBe("found");
    const reloadedVersion = reloaded.outcome === "found" ? reloaded.context.version : -1;
    await expect(
      harness.repository.recordCallControlMutation({
        ...mutation,
        expectedVersion: reloadedVersion,
        expectedStatus: "active",
        session: {
          ...mutation.session,
          diagnostics: [event.summary, event.summary],
        },
      }),
    ).resolves.toEqual({
      outcome: "existing",
      version: 1,
    });
    await expect(harness.repository.recordCallControlMutation(mutation)).resolves.toEqual({
      outcome: "existing",
      version: 1,
    });
    await expect(
      harness.repository.recordCallControlMutation({
        ...mutation,
        expectedVersion: 1,
        expectedStatus: "active",
        event: {
          ...event,
          payload: { digit: "2" },
        },
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 1 });
    await expect(
      harness.repository.recordCallControlMutation({
        ...mutation,
        tenantId: "tenant-b",
        event: { ...event, tenantId: "tenant-b" },
        executionCommands: [{ ...command, tenantId: "tenant-b" }],
      }),
    ).resolves.toEqual({ outcome: "not_found" });

    const terminalAt = "2026-07-23T12:00:02.000Z";
    await expect(
      harness.repository.recordCallControlMutation({
        ...mutation,
        expectedVersion: 1,
        expectedStatus: "active",
        session: {
          ...mutation.session,
          status: "completed",
          diagnostics: [event.summary, "Callback scheduled."],
          updatedAt: terminalAt,
        },
        event: {
          ...event,
          id: "terminal-control-event",
          eventType: "callback.scheduled",
          at: terminalAt,
          summary: "Callback scheduled.",
        },
        executionCommands: [
          {
            ...command,
            id: "terminal-control-command",
            action: "twilio.call.complete",
            requestedAt: terminalAt,
            appliedAt: terminalAt,
          },
        ],
      }),
    ).resolves.toEqual({ outcome: "updated", version: 2 });
    await expect(
      harness.repository.recordCallControlMutation({
        ...mutation,
        expectedVersion: 2,
        expectedStatus: "completed",
        event: { ...event, id: "late-control-event" },
        executionCommands: [{ ...command, id: "late-control-command" }],
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 2 });

    const counts = await harness.pool.query<{ table_name: string; count: string }>(`
      SELECT 'events' AS table_name, count(*)::text AS count FROM telephony_call_control_events
      UNION ALL SELECT 'commands', count(*)::text FROM telephony_execution_commands
    `);
    expect(counts.rows).toEqual([
      { table_name: "events", count: "2" },
      { table_name: "commands", count: "3" },
    ]);
  });

  it("claims bounded media-token hashes once and rejects expired or cross-tenant claims", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const active = callSetup("tenant-a", "call-token");
    active.mediaToken.expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const terminal = callSetup("tenant-a", "call-terminal-token");
    terminal.mediaToken.expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    terminal.executionSession.status = "completed";
    terminal.executionSession.lifecycleState = {
      stage: "completed",
      observedAt: "2026-07-23T12:01:00.000Z",
    };
    const expired = callSetup("tenant-a", "call-expired");
    const sandwich = callSetup("tenant-a", "call-sandwich-worker");
    sandwich.dispatch.runtimePath = "pstn-sandwich";
    sandwich.executionCommands[0]!.payload = { runtimePath: "pstn-sandwich" };
    sandwich.mediaToken.expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const otherTenantExpired = callSetup("tenant-b", "call-expired-b");
    expired.mediaToken.createdAt = "2026-07-23T11:55:00.000Z";
    expired.mediaToken.expiresAt = new Date(Date.now() - 1_000).toISOString();
    expired.mediaToken.createdAt = new Date(Date.now() - 60_000).toISOString();
    otherTenantExpired.mediaToken.createdAt = new Date(Date.now() - 60_000).toISOString();
    otherTenantExpired.mediaToken.expiresAt = new Date(Date.now() - 1_000).toISOString();
    await harness.repository.createCallSetup(active);
    await harness.repository.createCallSetup(terminal);
    await harness.repository.createCallSetup(expired);
    await harness.repository.createCallSetup(sandwich);
    await harness.repository.createCallSetup(otherTenantExpired);

    const claim = {
      tenantId: "tenant-a",
      callSessionId: active.executionSession.callSessionId,
      dispatchId: active.executionSession.dispatchId,
      connectionId: active.executionSession.connectionId,
      tokenHash: active.mediaToken.tokenHash,
      workerId: "premium-worker-a",
    };
    await expect(harness.repository.claimMediaToken(claim)).resolves.toEqual({
      outcome: "claimed",
      ownerEpoch: 1,
      authorization: {
        tenantId: "tenant-a",
        callSessionId: active.executionSession.callSessionId,
        dispatchId: active.executionSession.dispatchId,
        connectionId: active.executionSession.connectionId,
        runtimePath: "pstn-premium-realtime",
      },
    });
    await expect(
      harness.repository.fencePremiumCallOwnership({
        tenantId: "tenant-a",
        callSessionId: active.executionSession.callSessionId,
        workerId: "premium-worker-a",
        ownerEpoch: 1,
        leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "owned", ownerEpoch: 1 });
    await expect(
      harness.repository.fencePremiumCallOwnership({
        tenantId: "tenant-a",
        callSessionId: active.executionSession.callSessionId,
        workerId: "premium-worker-a",
        ownerEpoch: 2,
        leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "not_owner" });
    await expect(
      harness.repository.fencePremiumCallOwnership({
        tenantId: "tenant-a",
        callSessionId: active.executionSession.callSessionId,
        workerId: "premium-worker-b",
        ownerEpoch: 1,
        leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "not_owner" });
    await expect(
      harness.repository.fencePremiumCallOwnership({
        tenantId: "tenant-b",
        callSessionId: active.executionSession.callSessionId,
        workerId: "premium-worker-a",
        ownerEpoch: 1,
        leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "not_found" });
    await expect(
      harness.pool.query(
        `select owner_worker_id, owner_epoch
         from telephony_media_stream_tokens
         where tenant_id = $1 and call_session_id = $2`,
        ["tenant-a", active.executionSession.callSessionId],
      ),
    ).resolves.toMatchObject({
      rows: [{ owner_worker_id: "premium-worker-a", owner_epoch: 1 }],
    });
    const lifecycleTransition = {
      tenantId: "tenant-a",
      callSessionId: active.executionSession.callSessionId,
      expectedVersion: 0,
      expectedStage: "ringing" as const,
      nextState: {
        stage: "media-connected" as const,
        observedAt: "2026-07-23T12:00:01.000Z",
      },
    };
    await expect(
      harness.repository.transitionCallLifecycle({
        ...lifecycleTransition,
        ownership: {
          workerId: "premium-worker-b",
          ownerEpoch: 1,
        },
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 0 });
    await expect(
      harness.repository.transitionCallLifecycle({
        ...lifecycleTransition,
        ownership: {
          workerId: "premium-worker-a",
          ownerEpoch: 2,
        },
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 0 });
    await expect(
      harness.repository.transitionCallLifecycle({
        ...lifecycleTransition,
        ownership: {
          workerId: "premium-worker-a",
          ownerEpoch: 1,
        },
      }),
    ).resolves.toEqual({ outcome: "updated", version: 1 });
    await harness.pool.query(
      `update telephony_media_stream_tokens
       set owner_lease_expires_at = $1
       where tenant_id = $2 and call_session_id = $3`,
      [
        new Date(Date.now() - 1_000).toISOString(),
        "tenant-a",
        active.executionSession.callSessionId,
      ],
    );
    await expect(
      harness.repository.transitionCallLifecycle({
        tenantId: "tenant-a",
        callSessionId: active.executionSession.callSessionId,
        expectedVersion: 1,
        expectedStage: "media-connected",
        nextState: {
          stage: "provider-ready",
          observedAt: "2026-07-23T12:00:02.000Z",
        },
        ownership: {
          workerId: "premium-worker-a",
          ownerEpoch: 1,
        },
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 1 });
    await expect(harness.repository.claimMediaToken(claim)).resolves.toEqual({
      outcome: "already_claimed",
    });
    await expect(harness.repository.createCallSetup(active)).resolves.toEqual({
      outcome: "conflict",
    });
    await harness.pool.query(
      "update telephony_media_stream_tokens set expires_at = $1 where tenant_id = $2 and call_session_id = $3",
      [new Date(Date.now() - 1_000).toISOString(), "tenant-a", active.executionSession.callSessionId],
    );
    await expect(harness.repository.claimMediaToken(claim)).resolves.toEqual({
      outcome: "already_claimed",
    });
    const claimedRetry = callSetup("tenant-a", "call-token");
    claimedRetry.mediaToken.tokenHash = hashOneTimeStreamToken("claimed-retry");
    claimedRetry.mediaToken.createdAt = "2026-07-23T12:00:01.000Z";
    claimedRetry.mediaToken.expiresAt = "2026-07-23T12:06:00.000Z";
    await expect(harness.repository.createCallSetup(claimedRetry)).resolves.toEqual({
      outcome: "conflict",
    });
    await expect(
      harness.repository.claimMediaToken({ ...claim, tokenHash: "b".repeat(64) }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      harness.repository.claimMediaToken({ ...claim, dispatchId: "dispatch-forged" }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      harness.repository.claimMediaToken({ ...claim, tenantId: "tenant-b" }),
    ).resolves.toEqual({ outcome: "not_found" });
    await expect(
      harness.repository.claimMediaToken({
        ...claim,
        callSessionId: terminal.executionSession.callSessionId,
        dispatchId: terminal.executionSession.dispatchId,
        tokenHash: terminal.mediaToken.tokenHash,
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      harness.repository.claimMediaToken({
        ...claim,
        callSessionId: expired.executionSession.callSessionId,
        dispatchId: expired.executionSession.dispatchId,
        tokenHash: expired.mediaToken.tokenHash,
      }),
    ).resolves.toEqual({ outcome: "expired" });
    await expect(
      harness.repository.claimMediaToken({
        ...claim,
        callSessionId: sandwich.executionSession.callSessionId,
        dispatchId: sandwich.executionSession.dispatchId,
        tokenHash: sandwich.mediaToken.tokenHash,
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      harness.repository.deleteExpiredMediaTokens({
        tenantId: "tenant-a",
        before: new Date().toISOString(),
      }),
    ).resolves.toEqual({ deletedCount: 1 });
    await expect(
      harness.repository.fencePremiumCallOwnership({
        tenantId: "tenant-a",
        callSessionId: active.executionSession.callSessionId,
        workerId: "premium-worker-a",
        ownerEpoch: 1,
        leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "owned", ownerEpoch: 1 });
    await expect(harness.repository.claimMediaToken(claim)).resolves.toEqual({
      outcome: "already_claimed",
    });
    await expect(
      harness.repository.claimMediaToken({
        ...claim,
        callSessionId: expired.executionSession.callSessionId,
        dispatchId: expired.executionSession.dispatchId,
        tokenHash: expired.mediaToken.tokenHash,
      }),
    ).resolves.toEqual({ outcome: "not_found" });
    await expect(
      harness.repository.claimMediaToken({
        ...claim,
        tenantId: "tenant-b",
        callSessionId: otherTenantExpired.executionSession.callSessionId,
        dispatchId: otherTenantExpired.executionSession.dispatchId,
        connectionId: otherTenantExpired.executionSession.connectionId,
        tokenHash: otherTenantExpired.mediaToken.tokenHash,
      }),
    ).resolves.toEqual({ outcome: "expired" });
  });

  it("records phone-test checkpoints idempotently without crossing tenant boundaries", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const checkpoint = {
      id: "checkpoint-1",
      tenantId: "tenant-a",
      phoneNumberId: "number-a",
      callSessionId: "call-test",
      testRouteSessionId: "test-route-1",
      checkpoint: "mediaWebSocketConnected",
      observedAt: "2026-07-23T12:00:00.000Z",
    };

    await expect(harness.repository.recordPhoneTestCheckpoint(checkpoint)).resolves.toEqual({
      outcome: "inserted",
    });
    await expect(harness.repository.recordPhoneTestCheckpoint(checkpoint)).resolves.toEqual({
      outcome: "existing",
    });
    await expect(
      harness.repository.recordPhoneTestCheckpoint({
        ...checkpoint,
        observedAt: "2026-07-23T12:00:01.000Z",
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      harness.repository.recordPhoneTestCheckpoint({ ...checkpoint, tenantId: "tenant-b" }),
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("updates only the owned phone-test projection with compare-and-swap idempotency", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const testRoute = phoneTestRoute();
    const phoneTestResults = [phoneTestResult("tenant-a", "number-a")];
    const mutation = {
      tenantId: "tenant-a",
      phoneNumberId: "number-a",
      expectedTestRoute: null,
      expectedPhoneTestResults: null,
      testRoute,
      phoneTestResults,
    };

    await expect(harness.repository.updatePhoneTestProjection(mutation)).resolves.toEqual({
      outcome: "updated",
    });
    await expect(harness.repository.updatePhoneTestProjection(mutation)).resolves.toEqual({
      outcome: "existing",
    });
    await expect(
      harness.repository.updatePhoneTestProjection({
        ...mutation,
        testRoute: {
          ...testRoute,
          waitingSession: { ...testRoute.waitingSession, status: "expired" },
        },
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      harness.repository.updatePhoneTestProjection({
        ...mutation,
        tenantId: "tenant-b",
      }),
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("records an outbound abuse block and disables owned connections atomically", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const dispatch = structuredClone(callSetup("tenant-a", "abuse-block").dispatch);
    dispatch.direction = "outbound";
    dispatch.disposition = "blocked";
    dispatch.reason = "Outbound abuse threshold exceeded.";
    delete dispatch.callSessionId;

    await expect(
      harness.repository.recordOutboundAbuseBlock({
        dispatch,
        connectionIds: ["connection-tenant-a", "connection-tenant-a-fallback"],
      }),
    ).resolves.toEqual({
      outcome: "inserted",
      connectionCount: 2,
    });
    await expect(
      harness.repository.recordOutboundAbuseBlock({
        dispatch,
        connectionIds: ["connection-tenant-a-fallback", "connection-tenant-a"],
      }),
    ).resolves.toEqual({
      outcome: "existing",
      connectionCount: 2,
    });
    const crossTenantDispatch = {
      ...dispatch,
      id: "cross-tenant-abuse-block",
    };
    await expect(
      harness.repository.recordOutboundAbuseBlock({
        dispatch: crossTenantDispatch,
        connectionIds: ["connection-tenant-b"],
      }),
    ).resolves.toEqual({ outcome: "conflict", connectionCount: 0 });
    expect(
      (
        await harness.pool.query(
          "select id from telephony_dispatches where tenant_id = $1 and id = $2",
          ["tenant-a", crossTenantDispatch.id],
        )
      ).rows,
    ).toEqual([]);
    const tenantA = await harness.pool.query(
      `select status, health_status, outbound_abuse_blocked
       from telephony_connections
       where tenant_id = $1
       order by id`,
      ["tenant-a"],
    );
    expect(tenantA.rows).toEqual([
      {
        status: "disabled",
        health_status: "failed",
        outbound_abuse_blocked: true,
      },
      {
        status: "disabled",
        health_status: "failed",
        outbound_abuse_blocked: true,
      },
    ]);
    const tenantB = await harness.pool.query(
      "select status, health_status from telephony_connections where tenant_id = $1",
      ["tenant-b"],
    );
    expect(tenantB.rows).toEqual([{ status: "active", health_status: "healthy" }]);
  });

  it("idempotently reconciles only premium calls whose durable owner lease expired", async () => {
    const harness = await createHarness();
    const expired = callSetup("tenant-a", "expired-owner-reconcile");
    expired.premiumDispatchSnapshot = premiumDispatchSnapshot(expired);
    const live = callSetup("tenant-a", "live-owner-reconcile");
    live.premiumDispatchSnapshot = premiumDispatchSnapshot(live);
    await harness.repository.createCallSetup(expired);
    await harness.repository.createCallSetup(live);
    await harness.pool.query(
      `update telephony_media_stream_tokens
       set claimed_at = $1,
           owner_worker_id = $2,
           owner_epoch = 1,
           owner_lease_expires_at = $3
       where tenant_id = $4 and call_session_id = $5`,
      [
        new Date(Date.now() - 180_000).toISOString(),
        "premium-worker-a",
        new Date(Date.now() - 60_000).toISOString(),
        "tenant-a",
        expired.executionSession.callSessionId,
      ],
    );
    await harness.pool.query(
      `update telephony_media_stream_tokens
       set claimed_at = $1,
           owner_worker_id = $2,
           owner_epoch = 1,
           owner_lease_expires_at = $3
       where tenant_id = $4 and call_session_id = $5`,
      [
        new Date().toISOString(),
        "premium-worker-b",
        new Date(Date.now() + 120_000).toISOString(),
        "tenant-a",
        live.executionSession.callSessionId,
      ],
    );
    const before = new Date().toISOString();

    await expect(
      harness.repository.reconcileExpiredPremiumCallOwners({
        before,
        limit: 10,
      }),
    ).resolves.toEqual({ reconciledCount: 1 });
    await expect(
      harness.repository.loadCallRuntimeContext({
        tenantId: "tenant-a",
        callSessionId: expired.executionSession.callSessionId,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      context: {
        status: "terminated",
        lifecycleState: {
          stage: "failed",
          reasonCode: "premium_call_owner_lease_expired",
        },
      },
    });
    await expect(
      harness.repository.loadCallRuntimeContext({
        tenantId: "tenant-a",
        callSessionId: live.executionSession.callSessionId,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      context: {
        status: "ringing",
        lifecycleState: { stage: "ringing" },
      },
    });
    const retainedTokens = await harness.pool.query(
      `select call_session_id
       from telephony_media_stream_tokens
       where tenant_id = $1
       order by call_session_id`,
      ["tenant-a"],
    );
    expect(retainedTokens.rows).toEqual([{
      call_session_id: live.executionSession.callSessionId,
    }]);
    await expect(
      harness.repository.reconcileExpiredPremiumCallOwners({
        before,
        limit: 10,
      }),
    ).resolves.toEqual({ reconciledCount: 0 });
  });

  it("reconciles a worker that crashes between token claim and durable lease fencing", async () => {
    const harness = await createHarness();
    const setup = callSetup("tenant-a", "unfenced-owner-reconcile");
    setup.premiumDispatchSnapshot = premiumDispatchSnapshot(setup);
    await harness.repository.createCallSetup(setup);
    await harness.pool.query(
      `update telephony_media_stream_tokens
       set claimed_at = $1,
           owner_worker_id = $2,
           owner_epoch = 1,
           owner_lease_expires_at = null,
           expires_at = $3
       where tenant_id = $4 and call_session_id = $5`,
      [
        "2026-07-26T19:58:00.000Z",
        "premium-worker-crashed",
        "2026-07-26T19:59:00.000Z",
        "tenant-a",
        setup.executionSession.callSessionId,
      ],
    );

    await expect(
      harness.repository.reconcileExpiredPremiumCallOwners({
        before: "2026-07-26T20:00:00.000Z",
        limit: 10,
      }),
    ).resolves.toEqual({ reconciledCount: 1 });
    await expect(
      harness.repository.loadCallRuntimeContext({
        tenantId: "tenant-a",
        callSessionId: setup.executionSession.callSessionId,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      context: {
        status: "terminated",
        lifecycleState: {
          stage: "failed",
          reasonCode: "premium_call_owner_lease_expired",
        },
      },
    });
  });

  it("records one health observation without clearing a durable abuse block", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    await harness.pool.query(
      `update telephony_connections
       set status = 'disabled', health_status = 'failed', outbound_abuse_blocked = true
       where tenant_id = $1 and id = $2`,
      ["tenant-a", "connection-tenant-a"],
    );

    await expect(
      harness.repository.recordConnectionHealthObservation({
        tenantId: "tenant-a",
        connectionId: "connection-tenant-a",
        connectionStatus: "active",
        healthStatus: "healthy",
        healthCheck: {
          id: "connection-tenant-a:health:2026-07-24T12:00:00.000Z",
          connectionId: "connection-tenant-a",
          status: "healthy",
          blocking: false,
          checkedAt: "2026-07-24T12:00:00.000Z",
          message: "Provider credentials are valid.",
        },
        heartbeat: {
          id: "connection-tenant-a:heartbeat:2026-07-24T12:00:00.000Z",
          tenantId: "tenant-a",
          connectionId: "connection-tenant-a",
          provider: "twilio",
          ownershipMode: "byo_provider_account",
          status: "healthy",
          blocking: false,
          scheduled: false,
          latencyMs: 12,
          routedNumberCount: 1,
          at: "2026-07-24T12:00:00.000Z",
          message: "Provider heartbeat succeeded.",
          diagnostics: [],
        },
      }),
    ).resolves.toEqual({
      outcome: "updated",
      connectionStatus: "disabled",
      healthStatus: "failed",
    });
    await expect(
      harness.pool.query(
        `select status, health_status, outbound_abuse_blocked
         from telephony_connections
         where tenant_id = $1 and id = $2`,
        ["tenant-a", "connection-tenant-a"],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          status: "disabled",
          health_status: "failed",
          outbound_abuse_blocked: true,
        },
      ],
    });
  });

  it("records the same checkpoint for separate calls in one waiting session", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const first = callSetup("tenant-a", "phone-test-retry-a");
    const second = callSetup("tenant-a", "phone-test-retry-b");
    for (const setup of [first, second]) {
      setup.dispatch.routeMode = "test_route";
      setup.dispatch.testRouteSessionId = "shared-waiting-session";
      await harness.repository.createCallSetup(setup);
    }

    await expect(
      harness.repository.recordPhoneTestCheckpointByCall({
        tenantId: "tenant-a",
        callSessionId: first.executionSession.callSessionId,
        checkpoint: "verifiedWebhook",
        observedAt: "2026-07-23T12:00:01.000Z",
      }),
    ).resolves.toEqual({ outcome: "inserted" });
    await expect(
      harness.repository.recordPhoneTestCheckpointByCall({
        tenantId: "tenant-a",
        callSessionId: second.executionSession.callSessionId,
        checkpoint: "verifiedWebhook",
        observedAt: "2026-07-23T12:00:02.000Z",
      }),
    ).resolves.toEqual({ outcome: "inserted" });
  });

  it("loads runtime context and advances only the owned lifecycle row", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const first = callSetup("tenant-a", "call-lifecycle-a");
    const second = callSetup("tenant-a", "call-lifecycle-b");
    await harness.repository.createCallSetup(first);
    await harness.repository.createCallSetup(second);

    await expect(
      harness.repository.loadCallRuntimeContext({
        tenantId: "tenant-a",
        callSessionId: first.executionSession.callSessionId,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      context: {
        version: 0,
        lifecycleState: {
          stage: "ringing",
        },
        runtimePath: "pstn-premium-realtime",
      },
    });

    const transition = {
      tenantId: "tenant-a",
      callSessionId: first.executionSession.callSessionId,
      expectedVersion: 0,
      expectedStage: "ringing" as const,
      nextState: {
        stage: "media-connected" as const,
        observedAt: "2026-07-23T12:00:01.000Z",
      },
    };
    await expect(
      harness.repository.transitionCallLifecycle(transition),
    ).resolves.toEqual({ outcome: "updated", version: 1 });
    await expect(
      harness.repository.transitionCallLifecycle(transition),
    ).resolves.toEqual({ outcome: "existing", version: 1 });
    await expect(
      harness.repository.transitionCallLifecycle({
        ...transition,
        expectedVersion: 1,
        expectedStage: "media-connected",
        nextState: {
          stage: "completed",
          observedAt: "2026-07-23T12:00:02.000Z",
        },
        nextStatus: "completed",
      }),
    ).resolves.toEqual({ outcome: "updated", version: 2 });
    await expect(
      harness.repository.transitionCallLifecycle({
        ...transition,
        expectedVersion: 2,
        expectedStage: "completed",
        nextState: {
          stage: "active",
          observedAt: "2026-07-23T12:00:03.000Z",
        },
        nextStatus: "active",
      }),
    ).resolves.toEqual({ outcome: "conflict", version: 2 });
    await expect(
      harness.repository.loadCallRuntimeContext({
        tenantId: "tenant-a",
        callSessionId: second.executionSession.callSessionId,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      context: {
        version: 0,
        lifecycleState: { stage: "ringing" },
      },
    });
    await expect(
      harness.repository.loadCallRuntimeContext({
        tenantId: "tenant-b",
        callSessionId: first.executionSession.callSessionId,
      }),
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("resolves a phone-test checkpoint from the durable call without snapshot state", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "call-checkpoint-by-call");
    setup.dispatch.routeMode = "test_route";
    setup.dispatch.testRouteSessionId = "test-route-by-call";
    await harness.repository.createCallSetup(setup);

    const checkpoint = {
      tenantId: "tenant-a",
      callSessionId: setup.executionSession.callSessionId,
      checkpoint: "inboundFrameReceived",
      observedAt: "2026-07-23T12:00:01.000Z",
    };
    await expect(
      harness.repository.recordPhoneTestCheckpointByCall(checkpoint),
    ).resolves.toEqual({ outcome: "inserted" });
    await expect(
      harness.repository.recordPhoneTestCheckpointByCall({
        ...checkpoint,
        observedAt: "2026-07-23T12:00:02.000Z",
      }),
    ).resolves.toEqual({ outcome: "existing" });
    await expect(
      harness.repository.recordPhoneTestCheckpointByCall({
        ...checkpoint,
        tenantId: "tenant-b",
      }),
    ).resolves.toEqual({ outcome: "not_found" });

    const liveSetup = callSetup("tenant-a", "call-live-no-checkpoint");
    await harness.repository.createCallSetup(liveSetup);
    await expect(
      harness.repository.recordPhoneTestCheckpointByCall({
        ...checkpoint,
        callSessionId: liveSetup.executionSession.callSessionId,
      }),
    ).resolves.toEqual({ outcome: "not_applicable" });
  });

  it("derives only a complete tenant-owned phone test as successful", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const setup = callSetup("tenant-a", "call-successful-phone-test");
    setup.dispatch.routeMode = "test_route";
    setup.dispatch.testRouteSessionId = "test-route-successful";
    setup.dispatch.runtimeProfile = "cost-optimized";
    await harness.repository.createCallSetup(setup);

    const query = {
      tenantId: "tenant-a",
      phoneNumberId: setup.dispatch.phoneNumberId!,
      publishedVersionId: setup.dispatch.publishedVersionId!,
      runtimeProfile: "cost-optimized" as const,
    };
    await expect(harness.repository.loadLatestSuccessfulPhoneTest(query)).resolves.toBeNull();

    const checkpoints = [
      "verifiedWebhook",
      "allowedCallerMatched",
      "mediaWebSocketConnected",
      "inboundFrameReceived",
      "transcriptCreated",
      "agentResponseGenerated",
      "outboundAudioSent",
      "cleanEnd",
      "noFatalError",
    ];
    for (const [index, checkpoint] of checkpoints.entries()) {
      await harness.repository.recordPhoneTestCheckpointByCall({
        tenantId: query.tenantId,
        callSessionId: setup.executionSession.callSessionId,
        checkpoint,
        observedAt: `2026-07-23T12:00:${String(index).padStart(2, "0")}.000Z`,
      });
    }

    await expect(harness.repository.loadLatestSuccessfulPhoneTest(query)).resolves.toMatchObject({
      id: "test-route-successful:passed",
      tenantId: "tenant-a",
      numberId: "number-a",
      sessionId: "test-route-successful",
      status: "passed",
      publishedVersionId: "workflow-v1",
      runtimeProfile: "cost-optimized",
      checklist: Object.fromEntries(checkpoints.map((checkpoint) => [checkpoint, true])),
    });
    await expect(
      harness.repository.loadLatestSuccessfulPhoneTest({
        ...query,
        tenantId: "tenant-b",
      }),
    ).resolves.toBeNull();
  });

  it("atomically deletes tenant-retained call data with exact per-table counts", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const expired = callSetup("tenant-a", "retention-expired");
    expired.executionSession.status = "completed";
    expired.executionSession.lifecycleState = {
      stage: "completed",
      observedAt: "2026-07-23T12:30:00.000Z",
    };
    expired.executionSession.updatedAt = "2026-07-23T12:30:00.000Z";
    const active = callSetup("tenant-a", "retention-active");
    const retained = callSetup("tenant-a", "retention-retained");
    const otherTenant = callSetup("tenant-b", "retention-other-tenant");
    const blockedDispatch = {
      ...structuredClone(expired.dispatch),
      id: "CA-retention-blocked:telephony:webhook",
      disposition: "blocked" as const,
      callSessionId: undefined,
    };
    const routedPreSessionDispatch = {
      ...structuredClone(active.dispatch),
      id: "CA-retention-routed-pre-session:telephony",
      callSessionId: "CA-retention-routed-pre-session:telephony",
    };
    setCallSetupTimestamps(retained, "2026-07-25T12:00:00.000Z");
    await harness.repository.createCallSetup(expired);
    await harness.repository.createCallSetup(active);
    await harness.repository.createCallSetup(retained);
    await harness.repository.createCallSetup(otherTenant);
    await harness.repository.insertDispatch(blockedDispatch);
    await harness.repository.insertDispatch(routedPreSessionDispatch);
    const expiredWebhook = webhookEvent("tenant-a", "retention-expired");
    expiredWebhook.callSid = expired.executionSession.callSessionId;
    const activeWebhook = webhookEvent("tenant-a", "retention-active");
    activeWebhook.callSid = active.executionSession.callSessionId;
    const retainedWebhook = webhookEvent("tenant-a", "retention-retained");
    retainedWebhook.receivedAt = "2026-07-25T12:00:00.000Z";
    const blockedWebhook = webhookEvent("tenant-a", "retention-blocked");
    blockedWebhook.callSid = "CA-retention-blocked";
    await harness.repository.insertWebhookEvent(expiredWebhook);
    await harness.repository.insertWebhookEvent(activeWebhook);
    await harness.repository.insertWebhookEvent(retainedWebhook);
    await harness.repository.insertWebhookEvent(blockedWebhook);
    await harness.pool.query(
      `insert into telephony_call_control_events
         (id, tenant_id, dispatch_id, call_session_id, event_type, at, summary, payload)
       values
         ('retention-expired', 'tenant-a', $1, $2, 'dtmf.received', '2026-07-23T12:00:00.000Z', 'expired', '{}'),
         ('retention-retained', 'tenant-a', $3, $4, 'dtmf.received', '2026-07-25T12:00:00.000Z', 'retained', '{}'),
         ('retention-other', 'tenant-b', $5, $6, 'dtmf.received', '2026-07-23T12:00:00.000Z', 'other', '{}')`,
      [
        expired.dispatch.id,
        expired.executionSession.callSessionId,
        retained.dispatch.id,
        retained.executionSession.callSessionId,
        otherTenant.dispatch.id,
        otherTenant.executionSession.callSessionId,
      ],
    );

    await expect(
      harness.repository.deleteRetainedCallData({
        tenantId: "tenant-a",
        retainAfter: "2026-07-24T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      tenantId: "tenant-a",
      retainAfter: "2026-07-24T00:00:00.000Z",
      deletedCounts: {
        webhookEvents: 2,
        callControlEvents: 1,
        executionCommands: 1,
        executionSessions: 1,
        mediaTokens: 1,
        dispatches: 2,
      },
    });
    await expect(runtimeRowCounts(harness.pool, "tenant-a")).resolves.toEqual({
      webhookEvents: 2,
      callControlEvents: 1,
      executionCommands: 2,
      executionSessions: 2,
      mediaTokens: 2,
      dispatches: 3,
    });
    await expect(
      harness.pool.query(
        "select id from telephony_dispatches where tenant_id = $1 and id = $2",
        ["tenant-a", routedPreSessionDispatch.id],
      ),
    ).resolves.toMatchObject({
      rows: [{ id: routedPreSessionDispatch.id }],
    });
    await expect(runtimeRowCounts(harness.pool, "tenant-b")).resolves.toMatchObject({
      callControlEvents: 1,
      executionCommands: 1,
      executionSessions: 1,
      mediaTokens: 1,
      dispatches: 1,
    });
    await expect(
      harness.repository.loadCallMutationContext({
        tenantId: "tenant-a",
        callSessionId: active.executionSession.callSessionId,
      }),
    ).resolves.toMatchObject({ outcome: "found" });
    await expect(
      harness.repository.deleteRetainedCallData({
        tenantId: "tenant-a",
        retainAfter: "2026-07-24T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      deletedCounts: {
        webhookEvents: 0,
        callControlEvents: 0,
        executionCommands: 0,
        executionSessions: 0,
        mediaTokens: 0,
        dispatches: 0,
      },
    });
  });

  it("atomically deletes one tenant-owned connection and its call graph", async () => {
    const harness = await createHarness();
    pool = harness.pool;
    const target = callSetup("tenant-a", "connection-delete");
    target.dispatch.routeMode = "test_route";
    target.dispatch.testRouteSessionId = "connection-delete-test";
    const otherTenant = callSetup("tenant-b", "connection-delete-other");
    await harness.repository.createCallSetup(target);
    await harness.repository.createCallSetup(otherTenant);
    await harness.repository.insertWebhookEvent(webhookEvent("tenant-a", "connection-delete"));
    await harness.repository.recordPhoneTestCheckpointByCall({
      tenantId: "tenant-a",
      callSessionId: target.executionSession.callSessionId,
      checkpoint: "verifiedWebhook",
      observedAt: "2026-07-23T12:00:01.000Z",
    });
    await harness.pool.query(
      `insert into telephony_call_control_events
         (id, tenant_id, dispatch_id, call_session_id, event_type, at, summary, payload)
       values ('connection-delete', 'tenant-a', $1, $2, 'dtmf.received',
               '2026-07-23T12:00:01.000Z', 'delete me', '{}')`,
      [target.dispatch.id, target.executionSession.callSessionId],
    );

    await expect(
      harness.repository.deleteConnection({
        tenantId: "tenant-a",
        connectionId: "connection-tenant-a",
      }),
    ).resolves.toEqual({
      outcome: "deleted",
      deletedCounts: {
        connections: 1,
        phoneNumbers: 1,
        phoneTestCheckpoints: 1,
        webhookEvents: 1,
        callControlEvents: 1,
        executionCommands: 1,
        executionSessions: 1,
        mediaTokens: 1,
        dispatches: 1,
      },
    });
    await expect(runtimeRowCounts(harness.pool, "tenant-a")).resolves.toEqual({
      webhookEvents: 0,
      callControlEvents: 0,
      executionCommands: 0,
      executionSessions: 0,
      mediaTokens: 0,
      dispatches: 0,
    });
    await expect(
      harness.pool.query(
        "select id from telephony_phone_numbers where tenant_id = 'tenant-a' order by id",
      ),
    ).resolves.toMatchObject({ rows: [{ id: "number-a-fallback" }] });
    await expect(
      harness.pool.query("select count(*)::int as count from telephony_phone_test_checkpoints"),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(runtimeRowCounts(harness.pool, "tenant-b")).resolves.toMatchObject({
      executionCommands: 1,
      executionSessions: 1,
      mediaTokens: 1,
      dispatches: 1,
    });
    await expect(
      harness.repository.deleteConnection({
        tenantId: "tenant-b",
        connectionId: "connection-tenant-a-fallback",
      }),
    ).resolves.toEqual({ outcome: "not_found" });
  });
});

function webhookEvent(tenantId: string, eventSid: string) {
  return {
    id: `${tenantId}:${eventSid}`,
    tenantId,
    connectionId: `connection-${tenantId}`,
    accountSid: `AC-${tenantId}`,
    callSid: `CA-${eventSid}`,
    eventSid,
    eventType: "voice.incoming",
    receivedAt: "2026-07-23T12:00:00.000Z",
    duplicate: false,
  };
}

function callSetup(tenantId: string, suffix: string): CreateTelephonyCallSetupInput {
  const dispatchId = `dispatch-${suffix}`;
  const callSessionId = `session-${suffix}`;
  return {
    dispatch: {
      id: dispatchId,
      tenantId,
      direction: "inbound",
      disposition: "routed",
      reason: "Routed to the published workflow.",
      routeMode: "live_route",
      callSessionId,
      phoneNumberId: tenantId === "tenant-a" ? "number-a" : "number-b",
      connectionId: `connection-${tenantId}`,
      publishedVersionId: "workflow-v1",
      workspaceId: "workspace-1",
      workflowLabel: "Support",
      runtimeProfile: "premium-realtime",
      runtimePath: "pstn-premium-realtime",
      recording: { enabled: false, consentMode: "disabled", consentMessage: "" },
      recordingConsent: {
        state: "not_required",
        noticeRequired: false,
        consentMode: "disabled",
        message: "",
        recordedAt: "2026-07-23T12:00:00.000Z",
        reason: "Recording is disabled.",
      },
      toPhoneNumber: "+15550001000",
      fromPhoneNumber: "+15550002000",
      createdAt: "2026-07-23T12:00:00.000Z",
      source: "webhook",
    },
    executionSession: {
      id: `execution-${suffix}`,
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
        observedAt: "2026-07-23T12:00:00.000Z",
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
      createdAt: "2026-07-23T12:00:00.000Z",
      updatedAt: "2026-07-23T12:00:00.000Z",
    },
    executionCommands: [
      {
        id: `execution-${suffix}:bridge:1`,
        tenantId,
        sessionId: `execution-${suffix}`,
        dispatchId,
        callSessionId,
        provider: "twilio",
        action: "twilio.connect-stream",
        status: "applied",
        target: "+15550001000",
        payload: { runtimePath: "pstn-premium-realtime" },
        requestedAt: "2026-07-23T12:00:00.000Z",
        appliedAt: "2026-07-23T12:00:00.000Z",
      },
    ],
    mediaToken: {
      tenantId,
      callSessionId,
      dispatchId,
      connectionId: `connection-${tenantId}`,
      tokenHash: hashOneTimeStreamToken(`${tenantId}:${suffix}`),
      expiresAt: "2026-07-23T12:05:00.000Z",
      createdAt: "2026-07-23T12:00:00.000Z",
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
    createdAt: "2026-07-23T12:00:00.000Z",
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
  suffix: string,
): CreateTelephonyCallExecutionInput {
  const setup = callSetup(tenantId, suffix);
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

function setCallSetupTimestamps(
  setup: CreateTelephonyCallSetupInput,
  timestamp: string,
) {
  setup.dispatch.createdAt = timestamp;
  setup.executionSession.createdAt = timestamp;
  setup.executionSession.updatedAt = timestamp;
  for (const command of setup.executionCommands) {
    command.requestedAt = timestamp;
    command.appliedAt = timestamp;
  }
  setup.mediaToken.createdAt = timestamp;
  setup.mediaToken.expiresAt = new Date(Date.parse(timestamp) + 300_000).toISOString();
}

async function runtimeRowCounts(pool: Pool, tenantId: string) {
  const result = await pool.query<{ table_name: string; count: number }>(
    `select 'webhookEvents' as table_name, count(*)::int as count
       from telephony_webhook_events where tenant_id = $1
     union all select 'callControlEvents', count(*)::int
       from telephony_call_control_events where tenant_id = $1
     union all select 'executionCommands', count(*)::int
       from telephony_execution_commands where tenant_id = $1
     union all select 'executionSessions', count(*)::int
       from telephony_execution_sessions where tenant_id = $1
     union all select 'mediaTokens', count(*)::int
       from telephony_media_stream_tokens where tenant_id = $1
     union all select 'dispatches', count(*)::int
       from telephony_dispatches where tenant_id = $1`,
    [tenantId],
  );
  return Object.fromEntries(result.rows.map(({ table_name, count }) => [table_name, count]));
}

async function createHarness(
  observability?: { recordDatabaseOperation(input: Record<string, unknown>): void },
) {
  const database = newDb({
    autoCreateForeignKeyIndices: true,
    noAstCoverageCheck: true,
  });
  const pg = database.adapters.createPg();
  const pool = new pg.Pool() as Pool;
  await pool.query(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE telephony_connections (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'active',
      health_status text NOT NULL DEFAULT 'healthy',
      block_routing_on_health_failure boolean NOT NULL DEFAULT true,
      outbound_abuse_blocked boolean NOT NULL DEFAULT false
    );
    CREATE TABLE telephony_health_checks (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE,
      status text NOT NULL, blocking boolean NOT NULL, checked_at timestamptz NOT NULL,
      message text NOT NULL, scheduled boolean, latency_ms integer, diagnostics jsonb
    );
    CREATE TABLE telephony_provider_heartbeats (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE,
      provider text NOT NULL, ownership_mode text NOT NULL, status text NOT NULL,
      blocking boolean NOT NULL, scheduled boolean NOT NULL, latency_ms integer NOT NULL,
      routed_number_count integer NOT NULL, at timestamptz NOT NULL,
      message text NOT NULL, diagnostics jsonb NOT NULL
    );
    CREATE TABLE telephony_phone_numbers (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE,
      test_route jsonb,
      phone_test_results jsonb
    );
    CREATE TABLE telephony_dispatches (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      direction text NOT NULL, disposition text NOT NULL, reason text NOT NULL,
      call_session_id text, phone_number_id text, fallback_phone_number_id text,
      connection_id text, published_version_id text, workspace_id text, workflow_label text,
      route_mode text, runtime_profile text, runtime_path text, test_route_session_id text, outage_mode text,
      recording jsonb NOT NULL, recording_consent jsonb,
      to_phone_number text NOT NULL, from_phone_number text NOT NULL,
      created_at timestamptz NOT NULL, source text NOT NULL, policy_checks jsonb
    );
    CREATE UNIQUE INDEX telephony_dispatches_tenant_call_session_unique_idx
      ON telephony_dispatches (tenant_id, call_session_id);
    CREATE TABLE telephony_execution_sessions (
      id text NOT NULL,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      dispatch_id text NOT NULL REFERENCES telephony_dispatches(id) ON DELETE CASCADE,
      call_session_id text NOT NULL,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE,
      provider text NOT NULL, ownership_mode text NOT NULL, direction text NOT NULL,
      status text NOT NULL, version integer NOT NULL DEFAULT 0,
      to_phone_number text NOT NULL, from_phone_number text NOT NULL,
      workflow_label text, workspace_id text, test_call boolean NOT NULL,
      bridge_kind text NOT NULL, bridge_target text NOT NULL, media_path text NOT NULL,
      outage_mode text, fallback_target text, recording_consent jsonb,
      diagnostics jsonb NOT NULL, policy_state jsonb, lifecycle_state jsonb NOT NULL,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE telephony_execution_commands (
      id text NOT NULL,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      session_id text NOT NULL,
      dispatch_id text NOT NULL,
      call_session_id text NOT NULL,
      provider text NOT NULL,
      action text NOT NULL,
      status text NOT NULL,
      target text NOT NULL,
      payload jsonb NOT NULL,
      requested_at timestamptz NOT NULL,
      applied_at timestamptz,
      PRIMARY KEY (tenant_id, id),
      FOREIGN KEY (tenant_id, session_id)
        REFERENCES telephony_execution_sessions(tenant_id, id) ON DELETE CASCADE
    );
    CREATE TABLE telephony_webhook_events (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE,
      account_sid text NOT NULL, call_sid text NOT NULL, event_sid text NOT NULL,
      event_type text NOT NULL, received_at timestamptz NOT NULL, duplicate boolean NOT NULL,
      UNIQUE (tenant_id, connection_id, event_sid)
    );
    CREATE TABLE telephony_call_control_events (
      id text NOT NULL,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      dispatch_id text NOT NULL,
      call_session_id text NOT NULL,
      event_type text NOT NULL,
      at timestamptz NOT NULL,
      summary text NOT NULL,
      fallback_target text,
      payload jsonb NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE UNIQUE INDEX telephony_execution_sessions_tenant_call_session_unique_idx
      ON telephony_execution_sessions (tenant_id, call_session_id);
    CREATE TABLE telephony_media_stream_tokens (
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      call_session_id text NOT NULL,
      dispatch_id text NOT NULL REFERENCES telephony_dispatches(id) ON DELETE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE,
      token_hash varchar(43) NOT NULL UNIQUE,
      expires_at timestamp NOT NULL, created_at timestamp NOT NULL, claimed_at timestamp,
      owner_worker_id text, owner_epoch integer NOT NULL DEFAULT 0,
      owner_lease_expires_at timestamp,
      PRIMARY KEY (tenant_id, call_session_id),
      FOREIGN KEY (tenant_id, call_session_id)
        REFERENCES telephony_execution_sessions(tenant_id, call_session_id) ON DELETE CASCADE
    );
    CREATE TABLE telephony_premium_dispatch_snapshots (
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      call_session_id text NOT NULL,
      dispatch_id text NOT NULL,
      workspace_id text NOT NULL,
      published_version_id text NOT NULL,
      schema_version integer NOT NULL,
      checksum varchar(64) NOT NULL,
      snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (tenant_id, call_session_id),
      FOREIGN KEY (tenant_id, call_session_id)
        REFERENCES telephony_execution_sessions(tenant_id, call_session_id) ON DELETE CASCADE
    );
    CREATE TABLE telephony_phone_test_checkpoints (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      phone_number_id text NOT NULL REFERENCES telephony_phone_numbers(id) ON DELETE CASCADE,
      call_session_id text NOT NULL, test_route_session_id text NOT NULL,
      checkpoint text NOT NULL, observed_at timestamptz NOT NULL,
      UNIQUE (tenant_id, call_session_id, checkpoint)
    );
    INSERT INTO tenants (id) VALUES ('tenant-a'), ('tenant-b');
    INSERT INTO telephony_connections (id, tenant_id)
      VALUES ('connection-tenant-a', 'tenant-a'),
             ('connection-tenant-a-fallback', 'tenant-a'),
             ('connection-tenant-b', 'tenant-b');
    INSERT INTO telephony_phone_numbers (id, tenant_id, connection_id)
      VALUES ('number-a', 'tenant-a', 'connection-tenant-a'),
             ('number-a-fallback', 'tenant-a', 'connection-tenant-a-fallback'),
             ('number-b', 'tenant-b', 'connection-tenant-b');
  `);
  return {
    pool,
    repository: new PostgresTelephonyIncrementalRepository(pool, observability as never),
  };
}

function phoneTestRoute() {
  return {
    mode: "test_route" as const,
    publishedVersionId: "workflow-v1",
    workflowLabel: "Support",
    workspaceId: "workspace-1",
    runtimeProfile: "premium-realtime" as const,
    createdAt: "2026-07-23T12:00:00.000Z",
    allowedCallerNumbers: ["+15550002000"],
    waitingSession: {
      id: "waiting-1",
      status: "waiting" as const,
      allowedCallerNumbers: ["+15550002000"],
      checklist: {
        verifiedWebhook: false,
        allowedCallerMatched: false,
        mediaWebSocketConnected: false,
        inboundFrameReceived: false,
        transcriptCreated: false,
        agentResponseGenerated: false,
        outboundAudioSent: false,
        cleanEnd: false,
        noFatalError: true,
      },
      createdAt: "2026-07-23T12:00:00.000Z",
      expiresAt: "2026-07-23T12:05:00.000Z",
    },
  };
}

function phoneTestResult(tenantId: string, phoneNumberId: string) {
  return {
    id: "test-result-1",
    tenantId,
    numberId: phoneNumberId,
    sessionId: "waiting-1",
    status: "unauthorized_caller" as const,
    reason: "Caller is not authorized for this test.",
    checklist: phoneTestRoute().waitingSession.checklist,
    publishedVersionId: "workflow-v1",
    runtimeProfile: "premium-realtime" as const,
    createdAt: "2026-07-23T12:00:00.000Z",
    completedAt: "2026-07-23T12:00:01.000Z",
  };
}
