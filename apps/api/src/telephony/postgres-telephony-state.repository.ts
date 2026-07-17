import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { PersistedTelephonyStateRecord } from "./telephony-state.repository";

type Queryable = Pick<Pool, "query" | "connect">;

export class PostgresTelephonyStateRepository {
  constructor(private readonly database: Queryable) {}

  async listOrganizationIds() {
    const result = await this.database.query<{
      tenant_id: string;
    }>("select distinct tenant_id from telephony_connections order by tenant_id asc");

    return result.rows.map((row: { tenant_id: string }) => row.tenant_id);
  }

  async load(organizationId: string): Promise<PersistedTelephonyStateRecord | null> {
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
      processedWebhookEvents,
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
      this.database.query(
        "select * from telephony_processed_webhook_events where tenant_id = $1 order by event_sid asc",
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
      processedWebhookEventIds: processedWebhookEvents.rows.map(
        (row: QueryResultRow) => row.event_sid as string,
      ),
    };
  }

  async save(record: PersistedTelephonyStateRecord) {
    const client = await this.database.connect();

    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [record.organizationId]);
      await ensureTenantShell(client, record.organizationId);

      await clearTenantState(client, record.organizationId);

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
          )`,
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
          )`,
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

      for (const healthCheck of record.healthChecks) {
        await client.query(
          `insert into telephony_health_checks (
            id, tenant_id, connection_id, status, blocking, checked_at,
            message, scheduled, latency_ms, diagnostics
          ) values (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10::jsonb
          )`,
          [
            healthCheck.id,
            record.organizationId,
            healthCheck.connectionId,
            healthCheck.status,
            healthCheck.blocking,
            healthCheck.checkedAt,
            healthCheck.message,
            healthCheck.scheduled ?? null,
            healthCheck.latencyMs ?? null,
            jsonOrNull(healthCheck.diagnostics),
          ],
        );
      }

      for (const heartbeat of record.providerHeartbeats ?? []) {
        await client.query(
          `insert into telephony_provider_heartbeats (
            id, tenant_id, connection_id, provider, ownership_mode, status,
            blocking, scheduled, latency_ms, routed_number_count, at, message, diagnostics
          ) values (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12, $13::jsonb
          )`,
          [
            heartbeat.id,
            heartbeat.tenantId,
            heartbeat.connectionId,
            heartbeat.provider,
            heartbeat.ownershipMode,
            heartbeat.status,
            heartbeat.blocking,
            heartbeat.scheduled,
            heartbeat.latencyMs,
            heartbeat.routedNumberCount,
            heartbeat.at,
            heartbeat.message,
            JSON.stringify(heartbeat.diagnostics),
          ],
        );
      }

      for (const dispatch of record.dispatches) {
        await client.query(
          `insert into telephony_dispatches (
            id, tenant_id, direction, disposition, reason, call_session_id, phone_number_id,
            fallback_phone_number_id, connection_id, published_version_id, workspace_id,
            workflow_label, route_mode, runtime_profile, test_route_session_id, outage_mode,
            recording, to_phone_number, from_phone_number, created_at, source, policy_checks
          ) values (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11,
            $12, $13, $14, $15, $16,
            $17::jsonb, $18, $19, $20, $21, $22::jsonb
          )`,
          [
            dispatch.id,
            dispatch.tenantId,
            dispatch.direction,
            dispatch.disposition,
            dispatch.reason,
            dispatch.callSessionId ?? null,
            dispatch.phoneNumberId ?? null,
            dispatch.fallbackPhoneNumberId ?? null,
            dispatch.connectionId ?? null,
            dispatch.publishedVersionId ?? null,
            dispatch.workspaceId ?? null,
            dispatch.workflowLabel ?? null,
            dispatch.routeMode ?? null,
            dispatch.runtimeProfile ?? null,
            dispatch.testRouteSessionId ?? null,
            dispatch.outageMode ?? null,
            JSON.stringify(dispatch.recording),
            dispatch.toPhoneNumber,
            dispatch.fromPhoneNumber,
            dispatch.createdAt,
            dispatch.source,
            jsonOrNull(dispatch.policyChecks),
          ],
        );
      }

      for (const session of record.executionSessions ?? []) {
        await client.query(
          `insert into telephony_execution_sessions (
            id, tenant_id, dispatch_id, call_session_id, connection_id, provider,
            ownership_mode, direction, status, to_phone_number, from_phone_number,
            workflow_label, workspace_id, test_call, bridge_kind, bridge_target, media_path,
            outage_mode, fallback_target, diagnostics, policy_state, created_at, updated_at
          ) values (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17,
            $18, $19, $20::jsonb, $21::jsonb, $22, $23
          )`,
          [
            session.id,
            session.tenantId,
            session.dispatchId,
            session.callSessionId,
            session.connectionId,
            session.provider,
            session.ownershipMode,
            session.direction,
            session.status,
            session.toPhoneNumber,
            session.fromPhoneNumber,
            session.workflowLabel ?? null,
            session.workspaceId ?? null,
            session.testCall,
            session.bridgeKind,
            session.bridgeTarget,
            session.mediaPath,
            session.outageMode ?? null,
            session.fallbackTarget ?? null,
            JSON.stringify(session.diagnostics),
            jsonOrNull(session.policyState),
            session.createdAt,
            session.updatedAt,
          ],
        );
      }

      for (const command of record.executionCommands ?? []) {
        await client.query(
          `insert into telephony_execution_commands (
            id, tenant_id, session_id, dispatch_id, call_session_id, provider,
            action, status, target, payload, requested_at, applied_at
          ) values (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10::jsonb, $11, $12
          )`,
          [
            command.id,
            command.tenantId,
            command.sessionId,
            command.dispatchId,
            command.callSessionId,
            command.provider,
            command.action,
            command.status,
            command.target,
            JSON.stringify(command.payload),
            command.requestedAt,
            command.appliedAt ?? null,
          ],
        );
      }

      for (const event of record.webhookEvents) {
        await client.query(
          `insert into telephony_webhook_events (
            id, tenant_id, connection_id, account_sid, call_sid, event_sid,
            event_type, received_at, duplicate
          ) values (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9
          )`,
          [
            event.id,
            event.tenantId,
            event.connectionId,
            event.accountSid,
            event.callSid,
            event.eventSid,
            event.eventType,
            event.receivedAt,
            event.duplicate,
          ],
        );
      }

      for (const event of record.callControlEvents ?? []) {
        await client.query(
          `insert into telephony_call_control_events (
            id, tenant_id, dispatch_id, call_session_id, event_type, at,
            summary, fallback_target, payload
          ) values (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9::jsonb
          )`,
          [
            event.id,
            event.tenantId,
            event.dispatchId,
            event.callSessionId,
            event.eventType,
            event.at,
            event.summary,
            event.fallbackTarget ?? null,
            JSON.stringify(event.payload),
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

      for (const eventSid of record.processedWebhookEventIds) {
        await client.query(
          `insert into telephony_processed_webhook_events (
            id, tenant_id, event_sid
          ) values (
            $1, $2, $3
          )`,
          [`${record.organizationId}:${eventSid}`, record.organizationId, eventSid],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function ensureTenantShell(client: PoolClient, organizationId: string) {
  await client.query(
    `insert into tenants (id, slug, name)
     values ($1, $1, $1)
     on conflict (id) do nothing`,
    [organizationId],
  );
}

async function clearTenantState(client: PoolClient, organizationId: string) {
  await client.query("delete from telephony_execution_commands where tenant_id = $1", [
    organizationId,
  ]);
  await client.query("delete from telephony_call_control_events where tenant_id = $1", [
    organizationId,
  ]);
  await client.query("delete from telephony_webhook_events where tenant_id = $1", [organizationId]);
  await client.query("delete from telephony_processed_webhook_events where tenant_id = $1", [
    organizationId,
  ]);
  await client.query("delete from telephony_execution_sessions where tenant_id = $1", [
    organizationId,
  ]);
  await client.query("delete from telephony_dispatches where tenant_id = $1", [organizationId]);
  await client.query("delete from telephony_provider_heartbeats where tenant_id = $1", [
    organizationId,
  ]);
  await client.query("delete from telephony_health_checks where tenant_id = $1", [organizationId]);
  await client.query("delete from telephony_phone_numbers where tenant_id = $1", [organizationId]);
  await client.query("delete from telephony_credential_envelopes where tenant_id = $1", [
    organizationId,
  ]);
  await client.query("delete from telephony_connections where tenant_id = $1", [organizationId]);
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
    ...(row.test_route_session_id === null ? {} : { testRouteSessionId: row.test_route_session_id }),
    ...(row.outage_mode === null ? {} : { outageMode: row.outage_mode }),
    recording,
    recordingConsent: buildRecordingConsent(recording, createdAt),
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
    diagnostics: row.diagnostics as string[],
    ...(row.policy_state === null ? {} : { policyState: row.policy_state }),
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
