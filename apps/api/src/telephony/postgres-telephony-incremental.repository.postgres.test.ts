import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresTelephonyIncrementalRepository } from "./postgres-telephony-incremental.repository";
import type { CreateTelephonyCallSetupInput } from "./telephony-incremental.repository";

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
      callSetup(tenantA, `token-race-${suffix}`),
      callSetup(tenantA, `token-race-${suffix}`),
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
