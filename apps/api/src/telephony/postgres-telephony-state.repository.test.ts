import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";

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
          publishedVersionId: "workflow-support-v1",
          workflowLabel: "Support triage",
          workspaceId: "workspace-support",
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
          reason: "Routed +14155550100 to Support triage.",
          callSessionId: "CA-dispatch-1:telephony",
          phoneNumberId: "phone-number-pn-voice",
          connectionId: "telephony-tenant-west-africa-1",
          publishedVersionId: "workflow-support-v1",
          workspaceId: "workspace-support",
          workflowLabel: "Support triage",
          recording: {
            enabled: true,
            consentMode: "two-party",
            consentMessage: "Please note this call is being recorded.",
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
          toPhoneNumber: "+14155550100",
          fromPhoneNumber: "+233201110001",
          workflowLabel: "Support triage",
          workspaceId: "workspace-support",
          testCall: false,
          bridgeKind: "twilio-programmable-voice",
          bridgeTarget: "+14155550100",
          mediaPath: "provider-native",
          diagnostics: [
            "Twilio programmable voice accepted the ingress session.",
            "Credential-backed provider bridge is ready for live traffic.",
          ],
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

  it("returns null for organizations with no telephony state", async () => {
    const { repository, pool } = await createHarness();
    lastPool = pool;

    await expect(repository.load("missing-org")).resolves.toBeNull();
    await expect(repository.listOrganizationIds()).resolves.toEqual([]);
  });
});

async function createHarness() {
  const database = newDb({
    autoCreateForeignKeyIndices: true,
  });
  const pg = database.adapters.createPg();
  const pool = new pg.Pool();

  await applySchema(pool);

  return {
    pool,
    repository: new PostgresTelephonyStateRepository(pool),
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
      published_version_id text,
      workflow_label text,
      workspace_id text,
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
      outage_mode text,
      recording jsonb NOT NULL,
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
      diagnostics jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
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
