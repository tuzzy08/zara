import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataType, newDb } from "pg-mem";
import { defaultRecordingPolicy, importTwilioPhoneNumbers, type TelephonyConnection } from "@zara/core";

import type { PersistedTelephonyStateRecord } from "./telephony-state.repository";
import { PostgresTelephonyStateRepository } from "./postgres-telephony-state.repository";

describe("PostgresTelephonyStateRepository", () => {
  let lastPool: Pool | null = null;

  afterEach(async () => {
    if (lastPool !== null) {
      await lastPool.end();
      lastPool = null;
    }
  });

  it("round-trips tenant telephony state through normalized Postgres tables", async () => {
    const { repository, pool } = await createHarness();
    lastPool = pool;

    const record: PersistedTelephonyStateRecord = {
      schemaVersion: 1,
      organizationId: "tenant-west-africa",
      connections: [
        {
          id: "telephony-tenant-west-africa-1",
          tenantId: "tenant-west-africa",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          status: "active",
          healthStatus: "healthy",
          recordingPolicy: {
            enabled: true,
            consentMode: "single-party",
            consentMessage: "This call may be recorded for quality assurance.",
          },
          blockRoutingOnHealthFailure: true,
          credentialReference: {
            id: "telephony-tenant-west-africa-1:cred",
            provider: "twilio",
            keyVersion: 1,
            preview: "****7890",
          },
          externalReference: "AC1234567890abcdef1234567890abcd",
          webhookBaseUrl: "http://127.0.0.1/telephony/webhooks/twilio",
          webhookStatus: "configured",
          createdBy: "user-ops-lead",
        },
      ],
      phoneNumbers: [
        {
          id: "phone-number-pn-voice",
          tenantId: "tenant-west-africa",
          connectionId: "telephony-tenant-west-africa-1",
          provider: "twilio",
          provisionSource: "provider-import",
          externalNumberId: "PN-voice",
          phoneNumber: "+14155550100",
          friendlyName: "Support line",
          voiceCapable: true,
          callerIdEligible: true,
          status: "routed",
          webhookStatus: "configured",
          liveRoute: {
            mode: "live_route",
            publishedVersionId: "workflow-support-v1",
            workflowLabel: "Support triage",
            workspaceId: "workspace-customer-success",
            runtimeProfile: "balanced",
            activationStatus: "active",
            createdAt: "2026-05-15T16:00:00.000Z",
          },
          testRoute: {
            mode: "test_route",
            publishedVersionId: "workflow-support-test-v2",
            workflowLabel: "Support phone test",
            workspaceId: "workspace-customer-success",
            runtimeProfile: "cost-optimized",
            createdAt: "2026-05-15T16:01:00.000Z",
            allowedCallerNumbers: ["+233201110001"],
            waitingSession: {
              id: "phone-number-pn-voice:pstn-test:1778860860000",
              status: "completed",
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
              createdAt: "2026-05-15T16:01:00.000Z",
              expiresAt: "2026-05-15T16:30:00.000Z",
            },
          },
          phoneTestResults: [
            {
              id: "phone-number-pn-voice:pstn-test:1778860860000:passed",
              tenantId: "tenant-west-africa",
              numberId: "phone-number-pn-voice",
              sessionId: "phone-number-pn-voice:pstn-test:1778860860000",
              status: "passed",
              reason: "PSTN phone test completed every required checkpoint.",
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
              publishedVersionId: "workflow-support-test-v2",
              runtimeProfile: "cost-optimized",
              createdAt: "2026-05-15T16:01:00.000Z",
              completedAt: "2026-05-15T16:05:00.000Z",
            },
          ],
          recordingPolicy: {
            enabled: true,
            consentMode: "two-party",
            consentMessage: "Please note this call is being recorded.",
          },
        },
      ],
      healthChecks: [
        {
          id: "telephony-tenant-west-africa-1:health:1",
          connectionId: "telephony-tenant-west-africa-1",
          status: "healthy",
          blocking: false,
          checkedAt: "2026-05-15T16:00:00.000Z",
          message: "Twilio is healthy.",
          scheduled: false,
          latencyMs: 104,
          diagnostics: ["Twilio REST credential probe completed successfully."],
        },
      ],
      providerHeartbeats: [
        {
          id: "telephony-tenant-west-africa-1:heartbeat:1",
          tenantId: "tenant-west-africa",
          connectionId: "telephony-tenant-west-africa-1",
          provider: "twilio",
          ownershipMode: "byo_provider_account",
          status: "healthy",
          blocking: false,
          scheduled: false,
          latencyMs: 104,
          routedNumberCount: 1,
          at: "2026-05-15T16:01:00.000Z",
          message: "Manual Twilio heartbeat is healthy with 1 routed number.",
          diagnostics: ["Twilio REST credential probe completed successfully."],
        },
      ],
      dispatches: [
        {
          id: "CA-dispatch-1:manual",
          tenantId: "tenant-west-africa",
          direction: "inbound",
          disposition: "routed",
          reason: "Routed +14155550100 to Support phone test.",
          routeMode: "test_route",
          callSessionId: "CA-dispatch-1:telephony",
          phoneNumberId: "phone-number-pn-voice",
          connectionId: "telephony-tenant-west-africa-1",
          publishedVersionId: "workflow-support-test-v2",
          workspaceId: "workspace-customer-success",
          workflowLabel: "Support phone test",
          runtimeProfile: "cost-optimized",
          runtimePath: "pstn-sandwich",
          testRouteSessionId: "phone-number-pn-voice:pstn-test:1778860860000",
          recording: {
            enabled: true,
            consentMode: "two-party",
            consentMessage: "Please note this call is being recorded.",
          },
          recordingConsent: {
            state: "notice_queued",
            noticeRequired: true,
            consentMode: "two-party",
            message: "Please note this call is being recorded.",
            recordedAt: "2026-05-15T16:02:00.000Z",
            reason: "Two-party recording consent requires a notice before call recording.",
          },
          toPhoneNumber: "+14155550100",
          fromPhoneNumber: "+233201110001",
          createdAt: "2026-05-15T16:02:00.000Z",
          source: "manual",
        },
      ],
      executionSessions: [
        {
          id: "CA-dispatch-1:telephony:execution",
          tenantId: "tenant-west-africa",
          dispatchId: "CA-dispatch-1:manual",
          callSessionId: "CA-dispatch-1:telephony",
          connectionId: "telephony-tenant-west-africa-1",
          provider: "twilio",
          ownershipMode: "byo_provider_account",
          direction: "inbound",
          status: "ringing",
          lifecycleState: {
            stage: "ringing",
            observedAt: "2026-05-15T16:02:00.000Z",
          },
          toPhoneNumber: "+14155550100",
          fromPhoneNumber: "+233201110001",
          workflowLabel: "Support triage",
          workspaceId: "workspace-customer-success",
          testCall: false,
          bridgeKind: "twilio-programmable-voice",
          bridgeTarget: "+14155550100",
          mediaPath: "provider-native",
          diagnostics: [
            "Twilio programmable voice accepted the ingress session.",
            "Credential-backed provider bridge is ready for live traffic.",
          ],
          policyState: {
            state: "subscription_grace",
            reason: "Subscription lapsed during an active call; allow grace completion.",
            evaluatedAt: "2026-05-15T16:05:00.000Z",
            graceUntil: "2026-05-15T16:35:00.000Z",
          },
          createdAt: "2026-05-15T16:02:00.000Z",
          updatedAt: "2026-05-15T16:02:00.000Z",
        },
      ],
      executionCommands: [
        {
          id: "CA-dispatch-1:telephony:execution:bridge:1",
          tenantId: "tenant-west-africa",
          sessionId: "CA-dispatch-1:telephony:execution",
          dispatchId: "CA-dispatch-1:manual",
          callSessionId: "CA-dispatch-1:telephony",
          provider: "twilio",
          action: "twilio.calls.answer",
          status: "applied",
          target: "+14155550100",
          payload: {
            toPhoneNumber: "+14155550100",
            fromPhoneNumber: "+233201110001",
            direction: "inbound",
            bridgeTarget: "+14155550100",
            workflowLabel: "Support triage",
            webhookBaseUrl: "http://127.0.0.1/telephony/webhooks/twilio",
            mode: "live-call",
          },
          requestedAt: "2026-05-15T16:02:00.000Z",
          appliedAt: "2026-05-15T16:02:00.000Z",
        },
      ],
      webhookEvents: [
        {
          id: "telephony-tenant-west-africa-1:EVT-1",
          tenantId: "tenant-west-africa",
          connectionId: "telephony-tenant-west-africa-1",
          accountSid: "AC1234567890abcdef1234567890abcd",
          callSid: "CA-dispatch-1",
          eventSid: "EVT-1",
          eventType: "incoming.call",
          receivedAt: "2026-05-15T16:03:00.000Z",
          duplicate: false,
        },
      ],
      callControlEvents: [
        {
          id: "CA-dispatch-1:telephony:dtmf.received:2026-05-15T16:04:00.000Z",
          tenantId: "tenant-west-africa",
          dispatchId: "CA-dispatch-1:manual",
          callSessionId: "CA-dispatch-1:telephony",
          eventType: "dtmf.received",
          at: "2026-05-15T16:04:00.000Z",
          summary: "DTMF 4 captured for live routing.",
          payload: {
            digit: "4",
          },
        },
      ],
      credentials: [
        {
          connectionId: "telephony-tenant-west-africa-1",
          envelope: {
            algorithm: "aes-256-gcm",
            keyVersion: 1,
            iv: "AQIDBAUGBwgJCgsM",
            authTag: "AQIDBAUGBwgJCgsMDQ4PEA==",
            ciphertext: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY",
          },
        },
      ],
      processedWebhookEventIds: ["EVT-1"],
    };

    await repository.save(record);

    await expect(repository.listOrganizationIds()).resolves.toEqual(["tenant-west-africa"]);
    await expect(repository.load("tenant-west-africa")).resolves.toEqual(record);
  });

  it("uses a conservative lifecycle fallback for legacy snapshot sessions", async () => {
    const { repository, pool } = await createHarness();
    lastPool = pool;

    const record = createTwilioImportRecord({
      organizationId: "tenant-west-africa",
      connectionId: "telephony-tenant-west-africa-1",
    });
    record.dispatches = [{
      id: "CA-legacy:manual",
      tenantId: record.organizationId,
      direction: "inbound",
      disposition: "routed",
      reason: "Legacy route.",
      callSessionId: "CA-legacy:telephony",
      connectionId: record.connections[0]!.id,
      recording: defaultRecordingPolicy(),
      recordingConsent: {
        state: "not_required",
        noticeRequired: false,
        consentMode: "disabled",
        message: "",
        recordedAt: "2026-05-15T16:02:00.000Z",
        reason: "Recording is disabled.",
      },
      toPhoneNumber: "+14155550100",
      fromPhoneNumber: "+233201110001",
      createdAt: "2026-05-15T16:02:00.000Z",
      source: "manual",
    }];
    record.executionSessions = [{
      id: "CA-legacy:telephony:execution",
      tenantId: record.organizationId,
      dispatchId: "CA-legacy:manual",
      callSessionId: "CA-legacy:telephony",
      connectionId: record.connections[0]!.id,
      provider: "twilio",
      ownershipMode: "byo_provider_account",
      direction: "inbound",
      status: "terminated",
      toPhoneNumber: "+14155550100",
      fromPhoneNumber: "+233201110001",
      testCall: false,
      bridgeKind: "twilio-programmable-voice",
      bridgeTarget: "+14155550100",
      mediaPath: "provider-native",
      diagnostics: [],
      createdAt: "2026-05-15T16:02:00.000Z",
      updatedAt: "2026-05-15T16:05:00.000Z",
    }];

    await repository.save(record);

    await expect(repository.load(record.organizationId)).resolves.toMatchObject({
      executionSessions: [{
        id: "CA-legacy:telephony:execution",
        lifecycleState: {
          stage: "failed",
          observedAt: "2026-05-15T16:05:00.000Z",
        },
      }],
    });
  });

  it("preserves incrementally owned calls when replacing a stale tenant snapshot", async () => {
    const { repository, pool } = await createHarness();
    lastPool = pool;

    const organizationId = "tenant-west-africa";
    const connectionId = "telephony-tenant-west-africa-1";
    const dispatchId = "CA-row-owned:manual";
    const callSessionId = "CA-row-owned:telephony";
    const sessionId = `${callSessionId}:execution`;
    const currentLifecycle = {
      stage: "active",
      observedAt: "2026-05-15T16:04:00.000Z",
      providerSequence: 7,
    };

    const initialRecord = createTwilioImportRecord({ organizationId, connectionId });
    const phoneNumberId = initialRecord.phoneNumbers[0]!.id;
    await repository.save(initialRecord);
    await pool.query(
      `insert into telephony_dispatches (
        id, tenant_id, direction, disposition, reason, call_session_id, connection_id,
        published_version_id, workspace_id, workflow_label, route_mode, runtime_profile,
        runtime_path, recording, recording_consent, to_phone_number, from_phone_number,
        created_at, source
      ) values (
        $1, $2, 'inbound', 'routed', 'Current durable route.', $3, $4,
        'workflow-current-v1', 'workspace-current', 'Current workflow', 'live_route',
        'premium-realtime', 'pstn-premium-realtime', '{}'::jsonb, '{}'::jsonb,
        '+14155550100', '+233201110001', '2026-05-15T16:02:00.000Z', 'twilio'
      )`,
      [dispatchId, organizationId, callSessionId, connectionId],
    );
    await pool.query(
      `insert into telephony_execution_sessions (
        id, tenant_id, dispatch_id, call_session_id, connection_id, provider,
        ownership_mode, direction, status, version, lifecycle_state,
        to_phone_number, from_phone_number, test_call, bridge_kind, bridge_target,
        media_path, diagnostics, created_at, updated_at
      ) values (
        $1, $2, $3, $4, $5, 'twilio',
        'byo_provider_account', 'inbound', 'active', 7, $6::jsonb,
        '+14155550100', '+233201110001', false, 'twilio-programmable-voice',
        '+14155550100', 'provider-native', '[]'::jsonb,
        '2026-05-15T16:02:00.000Z', '2026-05-15T16:04:00.000Z'
      )`,
      [sessionId, organizationId, dispatchId, callSessionId, connectionId, JSON.stringify(currentLifecycle)],
    );
    await pool.query(
      `insert into telephony_media_stream_tokens (
        tenant_id, call_session_id, dispatch_id, connection_id,
        token_hash, expires_at, created_at, claimed_at
      ) values (
        $1, $2, $3, $4, $5,
        '2026-05-15T16:12:00.000Z', '2026-05-15T16:02:00.000Z',
        '2026-05-15T16:03:00.000Z'
      )`,
      [organizationId, callSessionId, dispatchId, connectionId, "a".repeat(43)],
    );
    await pool.query(
      `insert into telephony_phone_test_checkpoints (
        id, tenant_id, phone_number_id, call_session_id,
        test_route_session_id, checkpoint, observed_at
      ) values (
        'checkpoint-row-owned', $1, $2, $3,
        'test-route-row-owned', 'mediaConnected', '2026-05-15T16:03:00.000Z'
      )`,
      [organizationId, phoneNumberId, callSessionId],
    );

    await pool.query(
      `insert into telephony_dispatches (
        id, tenant_id, direction, disposition, reason, call_session_id, connection_id,
        recording, recording_consent, to_phone_number, from_phone_number, created_at, source
      ) values (
        'CA-legacy:manual', $1, 'inbound', 'routed', 'Legacy route.',
        'CA-legacy:telephony', $2, '{}'::jsonb, '{}'::jsonb,
        '+14155550100', '+233201110001', '2026-05-15T15:00:00.000Z', 'manual'
      )`,
      [organizationId, connectionId],
    );
    await pool.query(
      `insert into telephony_execution_sessions (
        id, tenant_id, dispatch_id, call_session_id, connection_id, provider,
        ownership_mode, direction, status, version, lifecycle_state,
        to_phone_number, from_phone_number, test_call, bridge_kind, bridge_target,
        media_path, diagnostics, created_at, updated_at
      ) values (
        'CA-legacy:telephony:execution', $1, 'CA-legacy:manual', 'CA-legacy:telephony',
        $2, 'twilio', 'byo_provider_account', 'inbound', 'ringing', 0,
        '{"stage":"ringing","observedAt":"2026-05-15T15:00:00.000Z"}'::jsonb,
        '+14155550100', '+233201110001', false, 'twilio-programmable-voice',
        '+14155550100', 'provider-native', '[]'::jsonb,
        '2026-05-15T15:00:00.000Z', '2026-05-15T15:00:00.000Z'
      )`,
      [organizationId, connectionId],
    );

    const saveStaleSnapshot = () => repository.save({
      schemaVersion: 1,
      organizationId,
      connections: [],
      phoneNumbers: [],
      healthChecks: [],
      providerHeartbeats: [],
      dispatches: [
        {
          id: dispatchId,
          tenantId: organizationId,
          direction: "inbound",
          disposition: "routed",
          reason: "Stale route copy.",
          callSessionId,
          connectionId,
          publishedVersionId: "workflow-stale-v1",
          workspaceId: "workspace-stale",
          workflowLabel: "Stale workflow",
          routeMode: "live_route",
          runtimeProfile: "premium-realtime",
          runtimePath: "pstn-premium-realtime",
          recording: {
            enabled: false,
            consentMode: "disabled",
            consentMessage: "",
          },
          recordingConsent: {
            state: "not_required",
            noticeRequired: false,
            consentMode: "disabled",
            message: "",
            recordedAt: "2026-05-15T16:02:00.000Z",
            reason: "Recording is disabled.",
          },
          toPhoneNumber: "+14155550100",
          fromPhoneNumber: "+233201110001",
          createdAt: "2026-05-15T16:02:00.000Z",
          source: "manual",
        },
      ],
      executionSessions: [
        {
          id: sessionId,
          tenantId: organizationId,
          dispatchId,
          callSessionId,
          connectionId,
          provider: "twilio",
          ownershipMode: "byo_provider_account",
          direction: "inbound",
          status: "ringing",
          lifecycleState: {
            stage: "ringing",
            observedAt: "2026-05-15T16:02:00.000Z",
          },
          toPhoneNumber: "+14155550100",
          fromPhoneNumber: "+233201110001",
          testCall: false,
          bridgeKind: "twilio-programmable-voice",
          bridgeTarget: "+14155550100",
          mediaPath: "provider-native",
          diagnostics: [],
          createdAt: "2026-05-15T16:02:00.000Z",
          updatedAt: "2026-05-15T16:02:00.000Z",
        },
      ],
      executionCommands: [],
      webhookEvents: [],
      callControlEvents: [],
      credentials: [],
      processedWebhookEventIds: [],
    });
    await saveStaleSnapshot();

    await expect(
      pool.query(
        `select reason, published_version_id
         from telephony_dispatches
         where tenant_id = $1 and id = $2`,
        [organizationId, dispatchId],
      ),
    ).resolves.toMatchObject({
      rows: [{ reason: "Current durable route.", published_version_id: "workflow-current-v1" }],
    });
    await expect(
      pool.query(
        `select status, version, lifecycle_state
         from telephony_execution_sessions
         where tenant_id = $1 and call_session_id = $2`,
        [organizationId, callSessionId],
      ),
    ).resolves.toMatchObject({
      rows: [{ status: "active", version: 7, lifecycle_state: currentLifecycle }],
    });
    await expect(
      pool.query(
        `select token_hash, claimed_at
         from telephony_media_stream_tokens
         where tenant_id = $1 and call_session_id = $2`,
        [organizationId, callSessionId],
      ),
    ).resolves.toMatchObject({
      rows: [{
        token_hash: "a".repeat(43),
        claimed_at: new Date("2026-05-15T16:03:00.000Z"),
      }],
    });
    await expect(
      pool.query(
        `select id from telephony_phone_test_checkpoints
         where tenant_id = $1 and call_session_id = $2`,
        [organizationId, callSessionId],
      ),
    ).resolves.toMatchObject({ rows: [{ id: "checkpoint-row-owned" }] });
    await expect(
      pool.query("select id from telephony_connections where tenant_id = $1", [organizationId]),
    ).resolves.toMatchObject({ rows: [{ id: connectionId }] });
    await expect(
      pool.query(
        `select id from telephony_dispatches
         where tenant_id = $1 and id = 'CA-legacy:manual'`,
        [organizationId],
      ),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      pool.query(
        `select id from telephony_execution_sessions
         where tenant_id = $1 and id = 'CA-legacy:telephony:execution'`,
        [organizationId],
      ),
    ).resolves.toMatchObject({ rows: [] });

    await pool.query(
      `delete from telephony_media_stream_tokens
       where tenant_id = $1 and call_session_id = $2`,
      [organizationId, callSessionId],
    );
    await saveStaleSnapshot();

    await expect(
      pool.query(
        `select status, version, lifecycle_state
         from telephony_execution_sessions
         where tenant_id = $1 and call_session_id = $2`,
        [organizationId, callSessionId],
      ),
    ).resolves.toMatchObject({
      rows: [{ status: "active", version: 7, lifecycle_state: currentLifecycle }],
    });
    await expect(
      pool.query(
        `select reason, published_version_id
         from telephony_dispatches
         where tenant_id = $1 and id = $2`,
        [organizationId, dispatchId],
      ),
    ).resolves.toMatchObject({
      rows: [{ reason: "Current durable route.", published_version_id: "workflow-current-v1" }],
    });
  });

  it("returns null for organizations with no telephony state", async () => {
    const { repository, pool } = await createHarness();
    lastPool = pool;

    await expect(repository.load("missing-org")).resolves.toBeNull();
    await expect(repository.listOrganizationIds()).resolves.toEqual([]);
  });

  it("persists identical Twilio provider number SIDs across tenants using scoped phone number IDs", async () => {
    const { repository, pool } = await createHarness();
    lastPool = pool;

    await repository.save(createTwilioImportRecord({
      organizationId: "tenant-west-africa",
      connectionId: "telephony-tenant-west-africa-1",
    }));
    await repository.save(createTwilioImportRecord({
      organizationId: "tenant-europe",
      connectionId: "telephony-tenant-europe-1",
    }));

    await expect(repository.load("tenant-west-africa")).resolves.toMatchObject({
      phoneNumbers: [
        {
          id: "phone-number-tenant-west-africa-telephony-tenant-west-africa-1-pn17721001",
          externalNumberId: "PN17721001",
          phoneNumber: "+14155551772",
        },
      ],
    });
    await expect(repository.load("tenant-europe")).resolves.toMatchObject({
      phoneNumbers: [
        {
          id: "phone-number-tenant-europe-telephony-tenant-europe-1-pn17721001",
          externalNumberId: "PN17721001",
          phoneNumber: "+14155551772",
        },
      ],
    });
  });

  it("takes a tenant transaction lock before replacing normalized state", async () => {
    const queries: Array<{ sql: string; parameters?: unknown[] | undefined }> = [];
    const databaseOperations: Array<Record<string, unknown>> = [];
    const client = {
      query: vi.fn(async (sql: string, parameters?: unknown[]) => {
        queries.push({ sql, parameters });
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const repository = new PostgresTelephonyStateRepository({
      async connect() { return client; },
      async query() { return { rows: [] }; },
      totalCount: 4,
      idleCount: 2,
      waitingCount: 1,
      options: { max: 10 },
    } as never, {
      recordDatabaseOperation(input: Record<string, unknown>) {
        databaseOperations.push(input);
      },
    } as never);

    await repository.listOrganizationIds();
    await repository.load("tenant-west-africa");

    await repository.save({
      schemaVersion: 1,
      organizationId: "tenant-west-africa",
      connections: [],
      phoneNumbers: [],
      healthChecks: [],
      providerHeartbeats: [],
      dispatches: [],
      executionSessions: [],
      executionCommands: [],
      webhookEvents: [],
      callControlEvents: [],
      credentials: [],
      processedWebhookEventIds: [],
    });

    const lockIndex = queries.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock"));
    const firstDeleteIndex = queries.findIndex(({ sql }) => sql.trimStart().startsWith("delete from"));
    expect(lockIndex).toBeGreaterThan(queries.findIndex(({ sql }) => sql === "begin"));
    expect(lockIndex).toBeLessThan(firstDeleteIndex);
    expect(queries[lockIndex]?.parameters).toEqual(["tenant-west-africa"]);
    expect(databaseOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "organization_list",
        outcome: "success",
        pool: { active: 2, idle: 2, waiting: 1, limit: 10 },
      }),
      expect.objectContaining({
        operation: "telephony_state_load",
        outcome: "success",
      }),
      expect.objectContaining({
        operation: "telephony_state_save",
        outcome: "success",
        transactionDurationMs: expect.any(Number),
        advisoryLockWaitMs: expect.any(Number),
      }),
    ]));
  });
});

async function createHarness() {
  const database = newDb({
    autoCreateForeignKeyIndices: true,
  });
  database.public.registerFunction({
    name: "hashtext",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: () => 1,
  });
  database.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  const pg = database.adapters.createPg();
  const pool = new pg.Pool();

  await applySchema(pool);

  return {
    pool,
    repository: new PostgresTelephonyStateRepository(pool),
  };
}

function createTwilioImportRecord(input: {
  organizationId: string;
  connectionId: string;
}): PersistedTelephonyStateRecord {
  const connection: TelephonyConnection = {
    id: input.connectionId,
    tenantId: input.organizationId,
    label: "Tenant Twilio account",
    ownershipMode: "byo_provider_account",
    provider: "twilio",
    region: "us-east-1",
    status: "active",
    healthStatus: "healthy",
    recordingPolicy: defaultRecordingPolicy(),
    blockRoutingOnHealthFailure: true,
    externalReference: "AC1234567890abcdef1234567890abcd",
    webhookStatus: "configured",
    createdBy: "user-ops-lead",
  };

  return {
    schemaVersion: 1,
    organizationId: input.organizationId,
    connections: [connection],
    phoneNumbers: importTwilioPhoneNumbers({
      tenantId: input.organizationId,
      connectionId: input.connectionId,
      existingNumbers: [],
      availableNumbers: [
        {
          sid: "PN17721001",
          phoneNumber: "+14155551772",
          friendlyName: "Support line",
          capabilities: {
            voice: true,
            sms: true,
          },
        },
      ],
    }),
    healthChecks: [],
    providerHeartbeats: [],
    dispatches: [],
    executionSessions: [],
    executionCommands: [],
    webhookEvents: [],
    callControlEvents: [],
    credentials: [],
    processedWebhookEventIds: [],
  };
}

async function applySchema(pool: Pool) {
  await pool.query(`
    CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'archived');

    CREATE TABLE tenants (
      id text PRIMARY KEY,
      slug text NOT NULL,
      name text NOT NULL,
      status tenant_status NOT NULL DEFAULT 'active',
      default_locale text NOT NULL DEFAULT 'en',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX tenants_slug_unique_idx ON tenants (slug);

    CREATE TABLE telephony_connections (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      label text NOT NULL,
      ownership_mode text NOT NULL,
      provider text NOT NULL,
      region text NOT NULL,
      status text NOT NULL,
      health_status text NOT NULL,
      recording_policy jsonb NOT NULL,
      block_routing_on_health_failure boolean NOT NULL,
      credential_reference jsonb,
      external_reference text,
      sip jsonb,
      webhook_base_url text,
      webhook_status text NOT NULL,
      created_by text NOT NULL
    );

    CREATE TABLE telephony_phone_numbers (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE ON UPDATE CASCADE,
      provider text NOT NULL,
      provision_source text NOT NULL,
      external_number_id text NOT NULL,
      phone_number text NOT NULL,
      friendly_name text NOT NULL,
      voice_capable boolean NOT NULL,
      caller_id_eligible boolean NOT NULL,
      status text NOT NULL,
      webhook_status text NOT NULL,
      live_route jsonb,
      test_route jsonb,
      phone_test_results jsonb,
      recording_policy jsonb
    );

    CREATE TABLE telephony_health_checks (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE ON UPDATE CASCADE,
      status text NOT NULL,
      blocking boolean NOT NULL,
      checked_at timestamptz NOT NULL,
      message text NOT NULL,
      scheduled boolean,
      latency_ms integer,
      diagnostics jsonb
    );

    CREATE TABLE telephony_provider_heartbeats (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE ON UPDATE CASCADE,
      provider text NOT NULL,
      ownership_mode text NOT NULL,
      status text NOT NULL,
      blocking boolean NOT NULL,
      scheduled boolean NOT NULL,
      latency_ms integer NOT NULL,
      routed_number_count integer NOT NULL,
      at timestamptz NOT NULL,
      message text NOT NULL,
      diagnostics jsonb NOT NULL
    );

    CREATE TABLE telephony_dispatches (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      direction text NOT NULL,
      disposition text NOT NULL,
      reason text NOT NULL,
      call_session_id text,
      phone_number_id text,
      fallback_phone_number_id text,
      connection_id text,
      published_version_id text,
      workspace_id text,
      workflow_label text,
      route_mode text,
      runtime_profile text,
      runtime_path text,
      test_route_session_id text,
      outage_mode text,
      recording jsonb NOT NULL,
      recording_consent jsonb,
      to_phone_number text NOT NULL,
      from_phone_number text NOT NULL,
      created_at timestamptz NOT NULL,
      source text NOT NULL,
      policy_checks jsonb
    );

    CREATE TABLE telephony_execution_sessions (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      dispatch_id text NOT NULL REFERENCES telephony_dispatches(id) ON DELETE CASCADE ON UPDATE CASCADE,
      call_session_id text NOT NULL,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE ON UPDATE CASCADE,
      provider text NOT NULL,
      ownership_mode text NOT NULL,
      direction text NOT NULL,
      status text NOT NULL,
      version integer NOT NULL DEFAULT 0,
      lifecycle_state jsonb NOT NULL,
      to_phone_number text NOT NULL,
      from_phone_number text NOT NULL,
      workflow_label text,
      workspace_id text,
      test_call boolean NOT NULL,
      bridge_kind text NOT NULL,
      bridge_target text NOT NULL,
      media_path text NOT NULL,
      outage_mode text,
      fallback_target text,
      recording_consent jsonb,
      diagnostics jsonb NOT NULL,
      policy_state jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );

    CREATE UNIQUE INDEX telephony_execution_sessions_tenant_call_session_unique_idx
      ON telephony_execution_sessions (tenant_id, call_session_id);

    CREATE TABLE telephony_media_stream_tokens (
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      call_session_id text NOT NULL,
      dispatch_id text NOT NULL REFERENCES telephony_dispatches(id) ON DELETE CASCADE ON UPDATE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE ON UPDATE CASCADE,
      token_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL,
      claimed_at timestamptz,
      PRIMARY KEY (tenant_id, call_session_id),
      FOREIGN KEY (tenant_id, call_session_id)
        REFERENCES telephony_execution_sessions(tenant_id, call_session_id)
        ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE TABLE telephony_phone_test_checkpoints (
      id text NOT NULL,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      phone_number_id text NOT NULL REFERENCES telephony_phone_numbers(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
      call_session_id text NOT NULL,
      test_route_session_id text NOT NULL,
      checkpoint text NOT NULL,
      observed_at timestamptz NOT NULL,
      PRIMARY KEY (tenant_id, id),
      UNIQUE (tenant_id, call_session_id, checkpoint)
    );

    CREATE TABLE telephony_execution_commands (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      session_id text NOT NULL REFERENCES telephony_execution_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
      dispatch_id text NOT NULL,
      call_session_id text NOT NULL,
      provider text NOT NULL,
      action text NOT NULL,
      status text NOT NULL,
      target text NOT NULL,
      payload jsonb NOT NULL,
      requested_at timestamptz NOT NULL,
      applied_at timestamptz
    );

    CREATE TABLE telephony_webhook_events (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      connection_id text NOT NULL REFERENCES telephony_connections(id) ON DELETE CASCADE ON UPDATE CASCADE,
      account_sid text NOT NULL,
      call_sid text NOT NULL,
      event_sid text NOT NULL,
      event_type text NOT NULL,
      received_at timestamptz NOT NULL,
      duplicate boolean NOT NULL
    );

    CREATE TABLE telephony_call_control_events (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      dispatch_id text NOT NULL,
      call_session_id text NOT NULL,
      event_type text NOT NULL,
      at timestamptz NOT NULL,
      summary text NOT NULL,
      fallback_target text,
      payload jsonb NOT NULL
    );

    CREATE TABLE telephony_credential_envelopes (
      connection_id text PRIMARY KEY REFERENCES telephony_connections(id) ON DELETE CASCADE ON UPDATE CASCADE,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      envelope jsonb
    );

    CREATE TABLE telephony_processed_webhook_events (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
      event_sid text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
