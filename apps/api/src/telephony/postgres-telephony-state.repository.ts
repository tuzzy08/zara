import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import type { PersistedTelephonyStateRecord } from "./telephony-state.repository";

type Queryable = Pick<Pool, "query" | "connect"> & {
  readonly totalCount?: number | undefined;
  readonly idleCount?: number | undefined;
  readonly waitingCount?: number | undefined;
  readonly options?: { max?: number | undefined } | undefined;
};

export class PostgresTelephonyStateRepository {
  constructor(
    private readonly database: Queryable,
    private readonly capacityObservability?: Pick<PstnCapacityObservability, "recordDatabaseOperation">,
  ) {}

  async listOrganizationIds() {
    return this.observeQuery("organization_list", async () => {
      const result = await this.database.query<{
        tenant_id: string;
      }>("select distinct tenant_id from telephony_connections order by tenant_id asc");

      return result.rows.map((row: { tenant_id: string }) => row.tenant_id);
    });
  }

  async load(organizationId: string): Promise<PersistedTelephonyStateRecord | null> {
    return this.observeQuery("telephony_state_load", async () => {
      const connections = await this.database.query(
        "select * from telephony_connections where tenant_id = $1 order by id asc",
        [organizationId],
      );

      if (connections.rows.length === 0) {
        return null;
      }

    const [
      phoneNumbers,
      healthChecks,
      providerHeartbeats,
      dispatches,
      executionSessions,
      executionCommands,
      webhookEvents,
      callControlEvents,
      credentialEnvelopes,
    ] = await Promise.all([
      this.database.query(
        "select * from telephony_phone_numbers where tenant_id = $1 order by id asc",
        [organizationId],
      ),
      this.database.query(
        "select * from telephony_health_checks where tenant_id = $1 order by checked_at desc",
        [organizationId],
      ),
      this.database.query(
        "select * from telephony_provider_heartbeats where tenant_id = $1 order by at desc",
        [organizationId],
      ),
      this.database.query(
        "select * from telephony_dispatches where tenant_id = $1 order by created_at desc",
        [organizationId],
      ),
      this.database.query(
        "select * from telephony_execution_sessions where tenant_id = $1 order by updated_at desc",
        [organizationId],
      ),
      this.database.query(
        "select * from telephony_execution_commands where tenant_id = $1 order by requested_at desc",
        [organizationId],
      ),
      this.database.query(
        "select * from telephony_webhook_events where tenant_id = $1 order by received_at desc",
        [organizationId],
      ),
      this.database.query(
        "select * from telephony_call_control_events where tenant_id = $1 order by at desc",
        [organizationId],
      ),
      this.database.query(
        "select * from telephony_credential_envelopes where tenant_id = $1 order by connection_id asc",
        [organizationId],
      ),
    ]);

      return {
      schemaVersion: 1,
      organizationId,
      connections: connections.rows.map(mapConnectionRow),
      phoneNumbers: phoneNumbers.rows.map(mapPhoneNumberRow),
      healthChecks: healthChecks.rows.map(mapHealthCheckRow),
      providerHeartbeats: providerHeartbeats.rows.map(mapProviderHeartbeatRow),
      dispatches: dispatches.rows.map(mapDispatchRow),
      executionSessions: executionSessions.rows.map(mapExecutionSessionRow),
      executionCommands: executionCommands.rows.map(mapExecutionCommandRow),
      webhookEvents: webhookEvents.rows.map(mapWebhookEventRow),
      callControlEvents: callControlEvents.rows.map(mapCallControlEventRow),
      credentials: credentialEnvelopes.rows.map(mapCredentialEnvelopeRow),
      };
    });
  }

  async save(record: PersistedTelephonyStateRecord) {
    const operationStartedAt = Date.now();
    let transactionStartedAt = operationStartedAt;
    let advisoryLockWaitMs = 0;
    let outcome: "success" | "failure" = "failure";
    let client: PoolClient | undefined;

    try {
      client = await this.database.connect();
      transactionStartedAt = Date.now();
      await client.query("begin");
      const lockStartedAt = Date.now();
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [record.organizationId]);
      advisoryLockWaitMs = Math.max(0, Date.now() - lockStartedAt);
      await ensureTenantShell(client, record.organizationId);

      await clearCredentialEnvelopes(client, record.organizationId);

      for (const connection of record.connections) {
        await client.query(
          `insert into telephony_connections (
            id, tenant_id, label, ownership_mode, provider, region, status, health_status,
            recording_policy, block_routing_on_health_failure, credential_reference,
            external_reference, sip, webhook_base_url, webhook_status, created_by
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9::jsonb, $10, $11::jsonb,
            $12, $13::jsonb, $14, $15, $16
          )
          on conflict (id) do update set
            label = excluded.label,
            ownership_mode = excluded.ownership_mode,
            provider = excluded.provider,
            region = excluded.region,
            recording_policy = excluded.recording_policy,
            block_routing_on_health_failure = excluded.block_routing_on_health_failure,
            credential_reference = excluded.credential_reference,
            external_reference = excluded.external_reference,
            sip = excluded.sip,
            webhook_base_url = excluded.webhook_base_url,
            webhook_status = excluded.webhook_status,
            created_by = excluded.created_by
          where telephony_connections.tenant_id = excluded.tenant_id`,
          [
            connection.id,
            connection.tenantId,
            connection.label,
            connection.ownershipMode,
            connection.provider,
            connection.region,
            connection.status,
            connection.healthStatus,
            JSON.stringify(connection.recordingPolicy),
            connection.blockRoutingOnHealthFailure,
            jsonOrNull(connection.credentialReference),
            connection.externalReference ?? null,
            jsonOrNull(connection.sip),
            connection.webhookBaseUrl ?? null,
            connection.webhookStatus,
            connection.createdBy,
          ],
        );
      }

      for (const phoneNumber of record.phoneNumbers) {
        await client.query(
          `insert into telephony_phone_numbers (
            id, tenant_id, connection_id, provider, provision_source, external_number_id,
            phone_number, friendly_name, voice_capable, caller_id_eligible, status,
            webhook_status, live_route, test_route, phone_test_results, recording_policy
          ) values (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb
          )
          on conflict (id) do update set
            connection_id = excluded.connection_id,
            provider = excluded.provider,
            provision_source = excluded.provision_source,
            external_number_id = excluded.external_number_id,
            phone_number = excluded.phone_number,
            friendly_name = excluded.friendly_name,
            voice_capable = excluded.voice_capable,
            caller_id_eligible = excluded.caller_id_eligible,
            status = excluded.status,
            webhook_status = excluded.webhook_status,
            live_route = excluded.live_route,
            recording_policy = excluded.recording_policy
          where telephony_phone_numbers.tenant_id = excluded.tenant_id`,
          [
            phoneNumber.id,
            phoneNumber.tenantId,
            phoneNumber.connectionId,
            phoneNumber.provider,
            phoneNumber.provisionSource,
            phoneNumber.externalNumberId,
            phoneNumber.phoneNumber,
            phoneNumber.friendlyName,
            phoneNumber.voiceCapable,
            phoneNumber.callerIdEligible,
            phoneNumber.status,
            phoneNumber.webhookStatus,
            jsonOrNull(phoneNumber.liveRoute),
            jsonOrNull(phoneNumber.testRoute),
            jsonOrNull(phoneNumber.phoneTestResults),
            jsonOrNull(phoneNumber.recordingPolicy),
          ],
        );
      }

      for (const credential of record.credentials) {
        await client.query(
          `insert into telephony_credential_envelopes (
            connection_id, tenant_id, envelope
          ) values (
            $1, $2, $3::jsonb
          )`,
          [
            credential.connectionId,
            record.organizationId,
            jsonOrNull(credential.envelope),
          ],
        );
      }

      await deleteOmittedConfigurationRows(client, record);

      await client.query("commit");
      outcome = "success";
    } catch (error) {
      if (client !== undefined) await client.query("rollback");
      throw error;
    } finally {
      client?.release();
      this.recordDatabaseOperation({
        operation: "telephony_state_save",
        outcome,
        queryDurationMs: Math.max(0, Date.now() - operationStartedAt),
        transactionDurationMs: Math.max(0, Date.now() - transactionStartedAt),
        advisoryLockWaitMs,
      });
    }
  }

  private async observeQuery<T>(
    operation: "organization_list" | "telephony_state_load",
    query: () => Promise<T>,
  ) {
    const startedAt = Date.now();
    let outcome: "success" | "failure" = "failure";
    try {
      const result = await query();
      outcome = "success";
      return result;
    } finally {
      this.recordDatabaseOperation({
        operation,
        outcome,
        queryDurationMs: Math.max(0, Date.now() - startedAt),
      });
    }
  }

  private recordDatabaseOperation(input: {
    operation: "organization_list" | "telephony_state_load" | "telephony_state_save";
    outcome: "success" | "failure";
    queryDurationMs: number;
    transactionDurationMs?: number | undefined;
    advisoryLockWaitMs?: number | undefined;
  }) {
    try {
      this.capacityObservability?.recordDatabaseOperation({
        ...input,
        pool: readPoolSnapshot(this.database),
      });
    } catch {
      // Capacity telemetry must never alter telephony persistence behavior.
    }
  }
}

function readPoolSnapshot(database: Queryable) {
  const total = Math.max(0, database.totalCount ?? 0);
  const idle = Math.max(0, database.idleCount ?? 0);
  return {
    active: Math.max(0, total - idle),
    idle,
    waiting: Math.max(0, database.waitingCount ?? 0),
    limit: Math.max(1, database.options?.max ?? 10),
  };
}

async function ensureTenantShell(client: PoolClient, organizationId: string) {
  await client.query(
    `insert into tenants (id, slug, name)
     values ($1, $1, $1)
     on conflict (id) do nothing`,
    [organizationId],
  );
}

async function clearCredentialEnvelopes(client: PoolClient, organizationId: string) {
  await client.query("delete from telephony_credential_envelopes where tenant_id = $1", [
    organizationId,
  ]);
}

async function deleteOmittedConfigurationRows(
  client: PoolClient,
  record: PersistedTelephonyStateRecord,
) {
  const phoneNumberIds = record.phoneNumbers.map(({ id }) => id);
  await client.query(
    `delete from telephony_phone_numbers
     where tenant_id = $1
       and not (id = any($2::text[]))
       and id not in (
         select phone_number_id
         from telephony_phone_test_checkpoints
         where tenant_id = $1
       )`,
    [record.organizationId, phoneNumberIds],
  );

  const connectionIds = record.connections.map(({ id }) => id);
  await client.query(
    `delete from telephony_connections
     where tenant_id = $1
       and not (id = any($2::text[]))
       and id not in (
         select connection_id
         from telephony_execution_sessions
         where tenant_id = $1
       )
       and id not in (
         select connection_id
         from telephony_media_stream_tokens
         where tenant_id = $1
       )`,
    [record.organizationId, connectionIds],
  );
}

function mapConnectionRow(row: QueryResultRow) {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    label: row.label as string,
    ownershipMode: row.ownership_mode,
    provider: row.provider,
    region: row.region as string,
    status: row.status,
    healthStatus: row.health_status,
    recordingPolicy: row.recording_policy,
    blockRoutingOnHealthFailure: row.block_routing_on_health_failure as boolean,
    ...(row.credential_reference === null ? {} : { credentialReference: row.credential_reference }),
    ...(row.external_reference === null ? {} : { externalReference: row.external_reference }),
    ...(row.sip === null ? {} : { sip: row.sip }),
    ...(row.webhook_base_url === null ? {} : { webhookBaseUrl: row.webhook_base_url }),
    webhookStatus: row.webhook_status,
    createdBy: row.created_by as string,
  };
}

function mapPhoneNumberRow(row: QueryResultRow) {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    connectionId: row.connection_id as string,
    provider: row.provider,
    provisionSource: row.provision_source,
    externalNumberId: row.external_number_id as string,
    phoneNumber: row.phone_number as string,
    friendlyName: row.friendly_name as string,
    voiceCapable: row.voice_capable as boolean,
    callerIdEligible: row.caller_id_eligible as boolean,
    status: row.status,
    webhookStatus: row.webhook_status,
    ...(row.live_route === null ? {} : { liveRoute: row.live_route }),
    ...(row.test_route === null ? {} : { testRoute: row.test_route }),
    ...(row.phone_test_results === null ? {} : { phoneTestResults: row.phone_test_results }),
    ...(row.recording_policy === null ? {} : { recordingPolicy: row.recording_policy }),
  };
}

function mapHealthCheckRow(row: QueryResultRow) {
  return {
    id: row.id as string,
    connectionId: row.connection_id as string,
    status: row.status,
    blocking: row.blocking as boolean,
    checkedAt: normalizeTimestamp(row.checked_at),
    message: row.message as string,
    ...(row.scheduled === null ? {} : { scheduled: row.scheduled }),
    ...(row.latency_ms === null ? {} : { latencyMs: row.latency_ms }),
    ...(row.diagnostics === null ? {} : { diagnostics: row.diagnostics }),
  };
}

function mapProviderHeartbeatRow(row: QueryResultRow) {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    connectionId: row.connection_id as string,
    provider: row.provider,
    ownershipMode: row.ownership_mode,
    status: row.status,
    blocking: row.blocking as boolean,
    scheduled: row.scheduled as boolean,
    latencyMs: row.latency_ms as number,
    routedNumberCount: row.routed_number_count as number,
    at: normalizeTimestamp(row.at),
    message: row.message as string,
    diagnostics: row.diagnostics as string[],
  };
}

function mapDispatchRow(row: QueryResultRow) {
  const recording = row.recording;
  const createdAt = normalizeTimestamp(row.created_at);

  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    direction: row.direction,
    disposition: row.disposition,
    reason: row.reason as string,
    ...(row.call_session_id === null ? {} : { callSessionId: row.call_session_id }),
    ...(row.phone_number_id === null ? {} : { phoneNumberId: row.phone_number_id }),
    ...(row.fallback_phone_number_id === null
      ? {}
      : { fallbackPhoneNumberId: row.fallback_phone_number_id }),
    ...(row.connection_id === null ? {} : { connectionId: row.connection_id }),
    ...(row.published_version_id === null ? {} : { publishedVersionId: row.published_version_id }),
    ...(row.workspace_id === null ? {} : { workspaceId: row.workspace_id }),
    ...(row.workflow_label === null ? {} : { workflowLabel: row.workflow_label }),
    ...(row.route_mode === null ? {} : { routeMode: row.route_mode }),
    ...(row.runtime_profile === null ? {} : { runtimeProfile: row.runtime_profile }),
    ...(row.runtime_path === null ? {} : { runtimePath: row.runtime_path }),
    ...(row.test_route_session_id === null ? {} : { testRouteSessionId: row.test_route_session_id }),
    ...(row.outage_mode === null ? {} : { outageMode: row.outage_mode }),
    recording,
    recordingConsent:
      row.recording_consent === null
        ? buildRecordingConsent(recording, createdAt)
        : row.recording_consent,
    toPhoneNumber: row.to_phone_number as string,
    fromPhoneNumber: row.from_phone_number as string,
    createdAt,
    source: row.source,
    ...(row.policy_checks === null ? {} : { policyChecks: row.policy_checks }),
  };
}

function mapExecutionSessionRow(row: QueryResultRow) {
  const createdAt = normalizeTimestamp(row.created_at);

  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    dispatchId: row.dispatch_id as string,
    callSessionId: row.call_session_id as string,
    connectionId: row.connection_id as string,
    provider: row.provider,
    ownershipMode: row.ownership_mode,
    direction: row.direction,
    status: row.status,
    toPhoneNumber: row.to_phone_number as string,
    fromPhoneNumber: row.from_phone_number as string,
    ...(row.workflow_label === null ? {} : { workflowLabel: row.workflow_label }),
    ...(row.workspace_id === null ? {} : { workspaceId: row.workspace_id }),
    testCall: row.test_call as boolean,
    bridgeKind: row.bridge_kind,
    bridgeTarget: row.bridge_target as string,
    mediaPath: row.media_path,
    ...(row.outage_mode === null ? {} : { outageMode: row.outage_mode }),
    ...(row.fallback_target === null ? {} : { fallbackTarget: row.fallback_target }),
    ...(row.recording_consent === null ? {} : { recordingConsent: row.recording_consent }),
    diagnostics: row.diagnostics as string[],
    ...(row.policy_state === null ? {} : { policyState: row.policy_state }),
    lifecycleState: row.lifecycle_state,
    createdAt,
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function mapWebhookEventRow(row: QueryResultRow) {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    connectionId: row.connection_id as string,
    accountSid: row.account_sid as string,
    callSid: row.call_sid as string,
    eventSid: row.event_sid as string,
    eventType: row.event_type as string,
    receivedAt: normalizeTimestamp(row.received_at),
    duplicate: row.duplicate as boolean,
  };
}

function mapExecutionCommandRow(row: QueryResultRow) {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    sessionId: row.session_id as string,
    dispatchId: row.dispatch_id as string,
    callSessionId: row.call_session_id as string,
    provider: row.provider,
    action: row.action as string,
    status: row.status,
    target: row.target as string,
    payload: row.payload as Record<string, string>,
    requestedAt: normalizeTimestamp(row.requested_at),
    ...(row.applied_at === null ? {} : { appliedAt: normalizeTimestamp(row.applied_at) }),
  };
}

function mapCallControlEventRow(row: QueryResultRow) {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    dispatchId: row.dispatch_id as string,
    callSessionId: row.call_session_id as string,
    eventType: row.event_type,
    at: normalizeTimestamp(row.at),
    summary: row.summary as string,
    ...(row.fallback_target === null ? {} : { fallbackTarget: row.fallback_target }),
    payload: row.payload as Record<string, string>,
  };
}

function mapCredentialEnvelopeRow(row: QueryResultRow) {
  return {
    connectionId: row.connection_id as string,
    ...(row.envelope === null ? {} : { envelope: row.envelope }),
  };
}

function buildRecordingConsent(recording: {
  enabled: boolean;
  consentMode: "disabled" | "single-party" | "two-party";
  consentMessage: string;
}, recordedAt: string) {
  if (!recording.enabled || recording.consentMode === "disabled") {
    return {
      state: "recording_disabled" as const,
      noticeRequired: false,
      consentMode: recording.consentMode,
      message: recording.consentMessage,
      recordedAt,
      reason: "Recording is disabled for this call.",
    };
  }

  if (recording.consentMode === "two-party") {
    return {
      state: "notice_queued" as const,
      noticeRequired: true,
      consentMode: recording.consentMode,
      message: recording.consentMessage,
      recordedAt,
      reason: "Two-party recording consent requires a notice before call recording.",
    };
  }

  return {
    state: "not_required" as const,
    noticeRequired: false,
    consentMode: recording.consentMode,
    message: recording.consentMessage,
    recordedAt,
    reason: "Single-party recording policy does not require a pre-recording notice.",
  };
}

function normalizeTimestamp(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return new Date(value).toISOString();
  }

  return new Date(String(value)).toISOString();
}

function jsonOrNull(value: object | string[] | undefined) {
  return value === undefined ? null : JSON.stringify(value);
}
