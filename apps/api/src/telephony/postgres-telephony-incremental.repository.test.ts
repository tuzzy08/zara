import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";

import { PostgresTelephonyIncrementalRepository } from "./postgres-telephony-incremental.repository";
import type { CreateTelephonyCallSetupInput } from "./telephony-incremental.repository";
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
      UNION ALL SELECT 'tokens', count(*)::text FROM telephony_media_stream_tokens
    `);
    expect(counts.rows).toEqual([
      { table_name: "dispatches", count: "2" },
      { table_name: "sessions", count: "2" },
      { table_name: "tokens", count: "2" },
    ]);
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
    const otherTenantExpired = callSetup("tenant-b", "call-expired-b");
    expired.mediaToken.createdAt = "2026-07-23T11:55:00.000Z";
    expired.mediaToken.expiresAt = new Date(Date.now() - 1_000).toISOString();
    expired.mediaToken.createdAt = new Date(Date.now() - 60_000).toISOString();
    otherTenantExpired.mediaToken.createdAt = new Date(Date.now() - 60_000).toISOString();
    otherTenantExpired.mediaToken.expiresAt = new Date(Date.now() - 1_000).toISOString();
    await harness.repository.createCallSetup(active);
    await harness.repository.createCallSetup(terminal);
    await harness.repository.createCallSetup(expired);
    await harness.repository.createCallSetup(otherTenantExpired);

    const claim = {
      tenantId: "tenant-a",
      callSessionId: active.executionSession.callSessionId,
      dispatchId: active.executionSession.dispatchId,
      connectionId: active.executionSession.connectionId,
      tokenHash: active.mediaToken.tokenHash,
    };
    await expect(harness.repository.claimMediaToken(claim)).resolves.toMatchObject({
      outcome: "claimed",
      authorization: {
        tenantId: "tenant-a",
        callSessionId: active.executionSession.callSessionId,
        dispatchId: active.executionSession.dispatchId,
        connectionId: active.executionSession.connectionId,
        runtimePath: "pstn-premium-realtime",
      },
    });
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
      harness.repository.deleteExpiredMediaTokens({
        tenantId: "tenant-a",
        before: new Date().toISOString(),
      }),
    ).resolves.toEqual({ deletedCount: 2 });
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

async function createHarness() {
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
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
    );
    CREATE TABLE telephony_phone_numbers (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE
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
      id text PRIMARY KEY,
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
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE TABLE telephony_webhook_events (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE,
      account_sid text NOT NULL, call_sid text NOT NULL, event_sid text NOT NULL,
      event_type text NOT NULL, received_at timestamptz NOT NULL, duplicate boolean NOT NULL,
      UNIQUE (tenant_id, connection_id, event_sid)
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
  return { pool, repository: new PostgresTelephonyIncrementalRepository(pool) };
}
