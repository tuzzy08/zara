import type { Pool, PoolClient, QueryResultRow } from "pg";
import { performance } from "node:perf_hooks";
import type {
  TelephonyCallLifecycleState,
  TelephonyCallControlEvent,
  TelephonyExecutionCommand,
  TelephonyExecutionSession,
  TelephonyExecutionSessionStatus,
  TelephonyConnection,
  TelephonyHealthStatus,
  TelephonyPhoneTestResult,
  PstnRuntimePath,
} from "@zara/core";

import type {
  ClaimTelephonyMediaTokenInput,
  CreateTelephonyCallExecutionInput,
  CreateTelephonyCallSetupInput,
  DeleteTelephonyConnectionInput,
  DeleteTelephonyPhoneNumberInput,
  DeleteTelephonyRetainedCallDataInput,
  DeleteExpiredTelephonyMediaTokensInput,
  FenceTelephonyPremiumCallOwnershipInput,
  LoadTelephonyConnectionAdmissionPostureInput,
  LoadLatestSuccessfulPhoneTestInput,
  LoadTelephonyCallMutationContextInput,
  LoadTelephonyCallRuntimeContextInput,
  LoadTelephonyPremiumDispatchSnapshotInput,
  ReconcileExpiredTelephonyPremiumCallOwnersInput,
  RecordTelephonyPhoneTestCheckpointByCallInput,
  RecordTelephonyCallControlMutationInput,
  RecordTelephonyConnectionHealthObservationInput,
  RecordTelephonyOutboundAbuseBlockInput,
  TelephonyCallMutationContext,
  TelephonyCallRuntimeContext,
  TelephonyMediaTokenClaimOutcome,
  TelephonyPhoneTestCheckpointRecord,
  TelephonyPremiumDispatchSnapshot,
  TelephonyPremiumDispatchRepository,
  TelephonyTransitionOutcome,
  TransitionTelephonyCallLifecycleInput,
  TransitionTelephonyExecutionSessionInput,
  UpdateTelephonyPhoneTestProjectionInput,
} from "./telephony-incremental.repository";
import {
  computeTelephonyPremiumDispatchSnapshotChecksum,
  createSuccessfulPhoneTestChecklist,
} from "./telephony-incremental.repository";
import {
  isPstnRealtimeWorkerId,
  isPstnRealtimeWorkerMediaStreamBaseUrl,
  isPstnRealtimeWorkerReleaseId,
} from "./pstn-realtime-worker-routing-contract";
import type { TelephonyDispatchRecord, TelephonyWebhookEvent } from "./telephony.models";
import type {
  PstnCapacityDatabaseOperation,
  PstnCapacityObservability,
} from "../runtime-observability/pstn-capacity-observability";

type Queryable = Pick<Pool, "query" | "connect">;
type DatabaseMetricsRecorder = Pick<PstnCapacityObservability, "recordDatabaseOperation">;

export class PostgresTelephonyIncrementalRepository
  implements TelephonyPremiumDispatchRepository {
  private readonly database: Queryable;

  constructor(database: Queryable, observability?: DatabaseMetricsRecorder) {
    this.database =
      observability === undefined
        ? database
        : createInstrumentedDatabase(database, observability);
  }

  async insertWebhookEvent(event: TelephonyWebhookEvent) {
    const ownedConnection = await this.database.query(
      "select id from telephony_connections where tenant_id = $1 and id = $2",
      [event.tenantId, event.connectionId],
    );
    if (ownedConnection.rows.length === 0) {
      return { outcome: "conflict" as const };
    }

    const beforeInsert = await this.loadWebhookEvent(event);
    if (beforeInsert !== undefined) {
      return webhookEventMatches(beforeInsert, event)
        ? {
            outcome: "existing" as const,
            receivedAt: normalizeTimestamp(beforeInsert.received_at),
          }
        : { outcome: "conflict" as const };
    }

    const inserted = await this.database.query(
      `insert into telephony_webhook_events (
        id, tenant_id, connection_id, account_sid, call_sid, event_sid,
        event_type, received_at, duplicate
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (tenant_id, connection_id, event_sid) do nothing
      returning id`,
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

    if (inserted.rows.length > 0) {
      return { outcome: "inserted" as const, receivedAt: event.receivedAt };
    }

    const existing = await this.loadWebhookEvent(event);
    if (existing === undefined || !webhookEventMatches(existing, event)) {
      return { outcome: "conflict" as const };
    }
    return {
      outcome: "existing" as const,
      receivedAt: normalizeTimestamp(existing.received_at),
    };
  }

  async insertDispatch(dispatch: TelephonyDispatchRecord) {
    const client = await this.database.connect();
    try {
      await client.query("begin");
      if (!(await dispatchReferencesAreOwned(client, dispatch))) {
        await client.query("rollback");
        return { outcome: "conflict" as const };
      }

      const existing = await loadDispatch(client, dispatch.tenantId, dispatch.id);
      if (existing !== undefined) {
        await client.query("commit");
        return {
          outcome: dispatchMatches(existing, dispatch)
            ? ("existing" as const)
            : ("conflict" as const),
        };
      }

      const inserted = await insertDispatchRow(client, dispatch);
      if (inserted.rows.length > 0) {
        await client.query("commit");
        return { outcome: "inserted" as const };
      }

      const raced = await loadDispatch(client, dispatch.tenantId, dispatch.id);
      const outcome = dispatchMatches(raced, dispatch)
        ? ("existing" as const)
        : ("conflict" as const);
      await client.query("commit");
      return { outcome };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async createCallSetup(input: CreateTelephonyCallSetupInput) {
    assertCallSetup(input);
    const client = await this.database.connect();

    try {
      await client.query("begin");
      if (!(await callSetupReferencesAreOwned(client, input))) {
        await client.query("rollback");
        return { outcome: "conflict" as const };
      }
      const inserted = await insertDispatchRow(client, input.dispatch);
      if (inserted.rows.length === 0) {
        const existing = await loadCallSetup(client, input);
        const existingSnapshot = await loadPremiumDispatchSnapshotRow(
          client,
          input.dispatch.tenantId,
          input.executionSession.callSessionId,
        );
        if (
          !callSetupMatches(existing, input) ||
          !premiumDispatchSnapshotMatches(existingSnapshot, input.premiumDispatchSnapshot) ||
          !(await executionCommandsMatch(
            client,
            input.dispatch.tenantId,
            input.executionSession.id,
            input.executionCommands,
          ))
        ) {
          await client.query("rollback");
          return { outcome: "conflict" as const };
        }
        if (existing?.claimed_at !== null) {
          await client.query("rollback");
          return { outcome: "conflict" as const };
        }
        if (
          existing?.token_hash === input.mediaToken.tokenHash &&
          normalizeTimestamp(existing.expires_at) === normalizeTimestamp(input.mediaToken.expiresAt) &&
          normalizeTimestamp(existing.token_created_at) === normalizeTimestamp(input.mediaToken.createdAt)
        ) {
          await client.query("commit");
          return { outcome: "existing" as const, mediaToken: "retained" as const };
        }
        const rotated = await client.query(
          `update telephony_media_stream_tokens
           set token_hash = $1, expires_at = $2, created_at = $3
           where tenant_id = $4 and call_session_id = $5
             and token_hash = $6 and claimed_at is null
           returning call_session_id`,
          [
            input.mediaToken.tokenHash,
            input.mediaToken.expiresAt,
            input.mediaToken.createdAt,
            input.mediaToken.tenantId,
            input.mediaToken.callSessionId,
            existing.token_hash,
          ],
        );
        if (rotated.rows.length === 0) {
          await client.query("rollback");
          return { outcome: "conflict" as const };
        }
        await client.query("commit");
        return { outcome: "existing" as const, mediaToken: "rotated" as const };
      }

      await insertExecutionSession(client, input);
      await insertExecutionCommands(client, input);
      await insertMediaToken(client, input);
      await insertPremiumDispatchSnapshot(client, input);
      await client.query("commit");
      return { outcome: "inserted" as const, mediaToken: "created" as const };
    } catch (error) {
      await rollbackQuietly(client);
      if (isUniqueViolation(error)) {
        return { outcome: "conflict" as const };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async createCallExecution(input: CreateTelephonyCallExecutionInput) {
    assertCallExecution(input);
    const client = await this.database.connect();

    try {
      await client.query("begin");
      const outboundPosture = await lockOutboundExecutionConnection(client, input);
      if (outboundPosture === "not_owned") {
        await client.query("rollback");
        return { outcome: "conflict" as const };
      }
      if (outboundPosture === "blocked") {
        await client.query("rollback");
        return {
          outcome: "blocked" as const,
          reasonCode: "outbound_abuse_blocked" as const,
        };
      }
      if (!(await callSetupReferencesAreOwned(client, input))) {
        await client.query("rollback");
        return { outcome: "conflict" as const };
      }
      const inserted = await insertDispatchRow(client, input.dispatch);
      if (inserted.rows.length === 0) {
        const existing = await loadCallSetup(client, input);
        const outcome =
          callExecutionMatches(existing, input) &&
          (await executionCommandsMatch(
            client,
            input.dispatch.tenantId,
            input.executionSession.id,
            input.executionCommands,
          ))
            ? ("existing" as const)
            : ("conflict" as const);
        await client.query(outcome === "existing" ? "commit" : "rollback");
        return { outcome };
      }

      await insertExecutionSession(client, input);
      await insertExecutionCommands(client, input);
      await client.query("commit");
      return { outcome: "inserted" as const };
    } catch (error) {
      await rollbackQuietly(client);
      if (isUniqueViolation(error)) {
        return { outcome: "conflict" as const };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async loadCallMutationContext(input: LoadTelephonyCallMutationContextInput) {
    const row = await loadCallSetupByCall(
      this.database,
      input.tenantId,
      input.callSessionId,
    );
    if (row === undefined || row.session_id === null || row.version === null) {
      return { outcome: "not_found" as const };
    }
    return {
      outcome: "found" as const,
      context: callMutationContextFromRow(row, input.callSessionId),
    };
  }

  async loadConnectionAdmissionPosture(
    input: LoadTelephonyConnectionAdmissionPostureInput,
  ) {
    const result = await this.database.query<ConnectionAdmissionPostureRow>(
      `select status, health_status, block_routing_on_health_failure
       from telephony_connections
       where tenant_id = $1 and id = $2`,
      [input.tenantId, input.connectionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { outcome: "not_found" as const };
    }
    return {
      outcome: "found" as const,
      posture: {
        status: row.status,
        healthStatus: row.health_status,
        blockRoutingOnHealthFailure: row.block_routing_on_health_failure,
      },
    };
  }

  async recordCallControlMutation(input: RecordTelephonyCallControlMutationInput) {
    assertCallControlMutation(input);
    const client = await this.database.connect();
    setInstrumentedTransactionContext(client, {
      operation: "telephony_call_control_mutation",
      retryCount: input.retryCount,
    });
    try {
      await client.query("begin");
      const locked = await client.query<CallControlSessionRow>(
        `select status, version, outage_mode, fallback_target, diagnostics, updated_at
         from telephony_execution_sessions
         where tenant_id = $1 and call_session_id = $2 and dispatch_id = $3
         for update`,
        [input.tenantId, input.callSessionId, input.dispatchId],
      );
      const current = locked.rows[0];
      if (current === undefined) {
        await client.query("rollback");
        return { outcome: "not_found" as const };
      }
      const existingEvent = await loadCallControlEvent(client, input.event);
      if (existingEvent !== undefined) {
        const exactReplay =
          callControlEventRowMatches(existingEvent, input.event) &&
          (await executionCommandSubsetMatches(client, input.executionCommands));
        await client.query(exactReplay ? "commit" : "rollback");
        return {
          outcome: exactReplay ? ("existing" as const) : ("conflict" as const),
          version: current.version,
        };
      }
      if (
        current.version !== input.expectedVersion ||
        current.status !== input.expectedStatus ||
        isTerminalExecutionStatus(current.status)
      ) {
        await client.query("rollback");
        return { outcome: "conflict" as const, version: current.version };
      }

      const updated = await client.query<{ version: number }>(
        `update telephony_execution_sessions
         set status = $1,
             outage_mode = $2,
             fallback_target = $3,
             diagnostics = $4::jsonb,
             updated_at = $5,
             version = version + 1
         where tenant_id = $6 and call_session_id = $7 and dispatch_id = $8
           and version = $9 and status = $10
           and status not in ('terminated', 'completed', 'blocked')
         returning version`,
        [
          input.session.status,
          input.session.outageMode,
          input.session.fallbackTarget,
          JSON.stringify(input.session.diagnostics),
          input.session.updatedAt,
          input.tenantId,
          input.callSessionId,
          input.dispatchId,
          input.expectedVersion,
          input.expectedStatus,
        ],
      );
      const version = updated.rows[0]?.version;
      if (version === undefined) {
        await client.query("rollback");
        return { outcome: "conflict" as const, version: current.version };
      }
      if (!(await insertOrMatchCallControlEvent(client, input.event))) {
        await client.query("rollback");
        return { outcome: "conflict" as const, version: current.version };
      }
      if (!(await insertOrMatchExecutionCommands(client, input.executionCommands))) {
        await client.query("rollback");
        return { outcome: "conflict" as const, version: current.version };
      }
      await client.query("commit");
      return { outcome: "updated" as const, version };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePhoneTestProjection(input: UpdateTelephonyPhoneTestProjectionInput) {
    const current = await this.database.query<PhoneTestProjectionRow>(
      `select test_route, phone_test_results
       from telephony_phone_numbers
       where tenant_id = $1 and id = $2`,
      [input.tenantId, input.phoneNumberId],
    );
    const row = current.rows[0];
    if (row === undefined) return { outcome: "not_found" as const };
    if (
      jsonMatches(row.test_route, input.testRoute) &&
      jsonMatches(row.phone_test_results, input.phoneTestResults)
    ) {
      return { outcome: "existing" as const };
    }
    if (
      !jsonMatches(row.test_route, input.expectedTestRoute) ||
      !jsonMatches(row.phone_test_results, input.expectedPhoneTestResults)
    ) {
      return { outcome: "conflict" as const };
    }
    const updated = await this.database.query(
      `update telephony_phone_numbers
       set test_route = $1::jsonb, phone_test_results = $2::jsonb
       where tenant_id = $3 and id = $4
         and (($5::jsonb is null and test_route is null) or test_route = $5::jsonb)
         and (($6::jsonb is null and phone_test_results is null)
           or phone_test_results = $6::jsonb)
       returning id`,
      [
        jsonParameter(input.testRoute),
        jsonParameter(input.phoneTestResults),
        input.tenantId,
        input.phoneNumberId,
        jsonParameter(input.expectedTestRoute),
        jsonParameter(input.expectedPhoneTestResults),
      ],
    );
    return {
      outcome: updated.rows.length > 0 ? ("updated" as const) : ("conflict" as const),
    };
  }

  async deletePhoneNumber(input: DeleteTelephonyPhoneNumberInput) {
    const deleted = await this.database.query(
      `delete from telephony_phone_numbers
       where tenant_id = $1 and id = $2
       returning id`,
      [input.tenantId, input.phoneNumberId],
    );
    return {
      outcome: deleted.rows.length > 0 ? ("deleted" as const) : ("not_found" as const),
    };
  }

  async recordOutboundAbuseBlock(input: RecordTelephonyOutboundAbuseBlockInput) {
    if (
      input.dispatch.direction !== "outbound" ||
      input.dispatch.disposition !== "blocked"
    ) {
      throw new Error("Outbound abuse handling requires a blocked outbound dispatch.");
    }
    const connectionIds = [...new Set(input.connectionIds)].sort();
    if (connectionIds.length === 0) {
      throw new Error("At least one telephony connection is required for abuse handling.");
    }
    const client = await this.database.connect();
    const placeholders = connectionIds.map((_, index) => `$${index + 2}`).join(", ");
    try {
      await client.query("begin");
      const locked = await client.query<ConnectionPostureRow>(
        `select id, status, health_status
         from telephony_connections
         where tenant_id = $1 and id in (${placeholders})
         order by id
         for update`,
        [input.dispatch.tenantId, ...connectionIds],
      );
      if (locked.rows.length !== connectionIds.length) {
        await client.query("rollback");
        return { outcome: "conflict" as const, connectionCount: 0 };
      }
      if (!(await dispatchReferencesAreOwned(client, input.dispatch))) {
        await client.query("rollback");
        return { outcome: "conflict" as const, connectionCount: 0 };
      }
      const existing = await loadDispatch(
        client,
        input.dispatch.tenantId,
        input.dispatch.id,
      );
      let outcome: "inserted" | "existing";
      if (existing !== undefined) {
        if (!dispatchMatches(existing, input.dispatch)) {
          await client.query("rollback");
          return { outcome: "conflict" as const, connectionCount: 0 };
        }
        outcome = "existing";
      } else {
        const inserted = await insertDispatchRow(client, input.dispatch);
        if (inserted.rows.length === 0) {
          const raced = await loadDispatch(
            client,
            input.dispatch.tenantId,
            input.dispatch.id,
          );
          if (!dispatchMatches(raced, input.dispatch)) {
            await client.query("rollback");
            return { outcome: "conflict" as const, connectionCount: 0 };
          }
          outcome = "existing";
        } else {
          outcome = "inserted";
        }
      }
      await client.query(
        `update telephony_connections
         set status = 'disabled',
             health_status = 'failed',
             outbound_abuse_blocked = true
         where tenant_id = $1 and id in (${placeholders})`,
        [input.dispatch.tenantId, ...connectionIds],
      );
      await client.query("commit");
      return {
        outcome,
        connectionCount: connectionIds.length,
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteRetainedCallData(input: DeleteTelephonyRetainedCallDataInput) {
    assertValidTimestamp(input.retainAfter, "Retention cutoff");
    const client = await this.database.connect();
    setInstrumentedTransactionContext(client, {
      operation: "telephony_retention_delete",
    });
    try {
      await client.query("begin");
      const webhookEvents = await client.query(
        `delete from telephony_webhook_events
         where tenant_id = $1
           and received_at < $2
           and (
             call_sid in (
               select call_session_id from telephony_execution_sessions
               where tenant_id = $1
                 and lifecycle_state->>'stage' in ('completed', 'failed', 'expired')
                 and updated_at < $2
             )
             or call_sid || ':telephony' in (
               select call_session_id from telephony_execution_sessions
               where tenant_id = $1
                 and lifecycle_state->>'stage' in ('completed', 'failed', 'expired')
                 and updated_at < $2
             )
             or call_sid || ':telephony:webhook' in (
               select id from telephony_dispatches
               where tenant_id = $1
                 and disposition = 'blocked'
                 and created_at < $2
                 and id not in (
                   select dispatch_id from telephony_execution_sessions
                   where tenant_id = $1
                 )
             )
           )
         returning id`,
        [input.tenantId, input.retainAfter],
      );
      const callControlEvents = await client.query(
        `delete from telephony_call_control_events
         where tenant_id = $1
            and call_session_id in (
              select call_session_id from telephony_execution_sessions
              where tenant_id = $1
                and lifecycle_state->>'stage' in ('completed', 'failed', 'expired')
                and updated_at < $2
            )
          returning id`,
        [input.tenantId, input.retainAfter],
      );
      const executionCommands = await client.query(
        `delete from telephony_execution_commands
         where tenant_id = $1
            and session_id in (
              select id from telephony_execution_sessions
              where tenant_id = $1
                and lifecycle_state->>'stage' in ('completed', 'failed', 'expired')
                and updated_at < $2
            )
          returning id`,
        [input.tenantId, input.retainAfter],
      );
      const mediaTokens = await client.query(
        `delete from telephony_media_stream_tokens
         where tenant_id = $1
            and call_session_id in (
              select call_session_id from telephony_execution_sessions
              where tenant_id = $1
                and lifecycle_state->>'stage' in ('completed', 'failed', 'expired')
                and updated_at < $2
            )
          returning call_session_id`,
        [input.tenantId, input.retainAfter],
      );
      const executionSessions = await client.query<{
        id: string;
        dispatch_id: string;
      }>(
        `delete from telephony_execution_sessions
         where tenant_id = $1
            and lifecycle_state->>'stage' in ('completed', 'failed', 'expired')
            and updated_at < $2
          returning id, dispatch_id`,
        [input.tenantId, input.retainAfter],
      );
      const terminalDispatchIds = executionSessions.rows.map(
        (row) => row.dispatch_id,
      );
      const dispatchDeleteBatchSize = 1_000;
      let deletedDispatchCount = 0;
      for (
        let offset = 0;
        offset < terminalDispatchIds.length;
        offset += dispatchDeleteBatchSize
      ) {
        const dispatchIdChunk = terminalDispatchIds.slice(
          offset,
          offset + dispatchDeleteBatchSize,
        );
        const terminalDispatches = await client.query(
          `delete from telephony_dispatches
           where tenant_id = $1
             and id in (${dispatchIdChunk
               .map((_, index) => `$${index + 2}`)
               .join(", ")})
           returning id`,
          [input.tenantId, ...dispatchIdChunk],
        );
        deletedDispatchCount += terminalDispatches.rows.length;
      }
      const blockedDispatches = await client.query(
        `delete from telephony_dispatches
          where tenant_id = $1
            and disposition = 'blocked'
            and created_at < $2
            and id not in (
              select dispatch_id from telephony_execution_sessions
              where tenant_id = $1
            )
          returning id`,
        [input.tenantId, input.retainAfter],
      );
      deletedDispatchCount += blockedDispatches.rows.length;
      await client.query("commit");
      return {
        tenantId: input.tenantId,
        retainAfter: input.retainAfter,
        deletedCounts: {
          webhookEvents: webhookEvents.rows.length,
          callControlEvents: callControlEvents.rows.length,
          executionCommands: executionCommands.rows.length,
          executionSessions: executionSessions.rows.length,
          mediaTokens: mediaTokens.rows.length,
          dispatches: deletedDispatchCount,
        },
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordConnectionHealthObservation(
    input: RecordTelephonyConnectionHealthObservationInput,
  ) {
    const client = await this.database.connect();
    setInstrumentedTransactionContext(client, {
      operation: "telephony_connection_health_observation",
    });
    try {
      await client.query("begin");
      const owned = await client.query<{
        status: string;
        health_status: string;
        outbound_abuse_blocked: boolean;
      }>(
        `select status, health_status, outbound_abuse_blocked
         from telephony_connections
         where tenant_id = $1 and id = $2
         for update`,
        [input.tenantId, input.connectionId],
      );
      if (owned.rows.length === 0) {
        await client.query("rollback");
        return { outcome: "not_found" as const };
      }

      const current = owned.rows[0]!;
      const connectionStatus = current.outbound_abuse_blocked
        ? (current.status as typeof input.connectionStatus)
        : input.connectionStatus;
      const healthStatus = current.outbound_abuse_blocked
        ? (current.health_status as typeof input.healthStatus)
        : input.healthStatus;
      await client.query(
        `update telephony_connections
         set status = $3, health_status = $4
         where tenant_id = $1 and id = $2`,
        [
          input.tenantId,
          input.connectionId,
          connectionStatus,
          healthStatus,
        ],
      );
      await client.query(
        `insert into telephony_health_checks (
          id, tenant_id, connection_id, status, blocking, checked_at,
          message, scheduled, latency_ms, diagnostics
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (id) do nothing`,
        [
          input.healthCheck.id,
          input.tenantId,
          input.connectionId,
          input.healthCheck.status,
          input.healthCheck.blocking,
          input.healthCheck.checkedAt,
          input.healthCheck.message,
          input.healthCheck.scheduled ?? null,
          input.healthCheck.latencyMs ?? null,
          input.healthCheck.diagnostics ?? null,
        ],
      );
      if (input.heartbeat !== undefined) {
        await client.query(
          `insert into telephony_provider_heartbeats (
            id, tenant_id, connection_id, provider, ownership_mode, status,
            blocking, scheduled, latency_ms, routed_number_count, at, message,
            diagnostics
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          on conflict (id) do nothing`,
          [
            input.heartbeat.id,
            input.tenantId,
            input.connectionId,
            input.heartbeat.provider,
            input.heartbeat.ownershipMode,
            input.heartbeat.status,
            input.heartbeat.blocking,
            input.heartbeat.scheduled,
            input.heartbeat.latencyMs,
            input.heartbeat.routedNumberCount,
            input.heartbeat.at,
            input.heartbeat.message,
            input.heartbeat.diagnostics,
          ],
        );
      }
      await client.query("commit");
      return {
        outcome: "updated" as const,
        connectionStatus,
        healthStatus,
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteConnection(input: DeleteTelephonyConnectionInput) {
    const client = await this.database.connect();
    setInstrumentedTransactionContext(client, {
      operation: "telephony_connection_delete",
    });
    try {
      await client.query("begin");
      const owned = await client.query(
        `select id from telephony_connections
         where tenant_id = $1 and id = $2
         for update`,
        [input.tenantId, input.connectionId],
      );
      if (owned.rows.length === 0) {
        await client.query("rollback");
        return { outcome: "not_found" as const };
      }
      const phoneNumbers = await client.query(
        `select id from telephony_phone_numbers
         where tenant_id = $1 and connection_id = $2`,
        [input.tenantId, input.connectionId],
      );
      const phoneTestCheckpoints = await client.query(
        `select checkpoint.id
         from telephony_phone_test_checkpoints checkpoint
         inner join telephony_phone_numbers phone_number
           on phone_number.id = checkpoint.phone_number_id
          and phone_number.tenant_id = checkpoint.tenant_id
         where checkpoint.tenant_id = $1 and phone_number.connection_id = $2`,
        [input.tenantId, input.connectionId],
      );
      const callControlEvents = await client.query(
        `delete from telephony_call_control_events
         where tenant_id = $1
           and (
             dispatch_id in (
               select id from telephony_dispatches
               where tenant_id = $1 and connection_id = $2
             )
             or call_session_id in (
               select call_session_id from telephony_execution_sessions
               where tenant_id = $1 and connection_id = $2
             )
           )
         returning id`,
        [input.tenantId, input.connectionId],
      );
      const executionCommands = await client.query(
        `delete from telephony_execution_commands
         where tenant_id = $1
           and (
             dispatch_id in (
               select id from telephony_dispatches
               where tenant_id = $1 and connection_id = $2
             )
             or session_id in (
               select id from telephony_execution_sessions
               where tenant_id = $1 and connection_id = $2
             )
           )
         returning id`,
        [input.tenantId, input.connectionId],
      );
      const mediaTokens = await client.query(
        `delete from telephony_media_stream_tokens
         where tenant_id = $1
           and (
             connection_id = $2
             or dispatch_id in (
               select id from telephony_dispatches
               where tenant_id = $1 and connection_id = $2
             )
           )
         returning call_session_id`,
        [input.tenantId, input.connectionId],
      );
      const executionSessions = await client.query(
        `delete from telephony_execution_sessions
         where tenant_id = $1
           and (
             connection_id = $2
             or dispatch_id in (
               select id from telephony_dispatches
               where tenant_id = $1 and connection_id = $2
             )
           )
         returning id`,
        [input.tenantId, input.connectionId],
      );
      const webhookEvents = await client.query(
        `delete from telephony_webhook_events
         where tenant_id = $1 and connection_id = $2
         returning id`,
        [input.tenantId, input.connectionId],
      );
      const dispatches = await client.query(
        `delete from telephony_dispatches
         where tenant_id = $1 and connection_id = $2
         returning id`,
        [input.tenantId, input.connectionId],
      );
      const connections = await client.query(
        `delete from telephony_connections
         where tenant_id = $1 and id = $2
         returning id`,
        [input.tenantId, input.connectionId],
      );
      await client.query("commit");
      return {
        outcome: "deleted" as const,
        deletedCounts: {
          connections: connections.rows.length,
          phoneNumbers: phoneNumbers.rows.length,
          phoneTestCheckpoints: phoneTestCheckpoints.rows.length,
          webhookEvents: webhookEvents.rows.length,
          callControlEvents: callControlEvents.rows.length,
          executionCommands: executionCommands.rows.length,
          executionSessions: executionSessions.rows.length,
          mediaTokens: mediaTokens.rows.length,
          dispatches: dispatches.rows.length,
        },
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionExecutionSession(
    input: TransitionTelephonyExecutionSessionInput,
  ): Promise<TelephonyTransitionOutcome> {
    const updated = await this.database.query<{ version: number }>(
      `update telephony_execution_sessions
       set status = $1,
           version = version + 1,
           updated_at = $2,
           diagnostics = coalesce($3::jsonb, diagnostics),
           policy_state = case when $4::boolean then $5::jsonb else policy_state end
       where tenant_id = $6 and call_session_id = $7 and version = $8 and status = $9
         and status not in ('terminated', 'completed', 'blocked')
       returning version`,
      [
        input.nextStatus,
        input.updatedAt,
        input.diagnostics === undefined ? null : JSON.stringify(input.diagnostics),
        input.policyState !== undefined,
        input.policyState === undefined ? null : JSON.stringify(input.policyState),
        input.tenantId,
        input.callSessionId,
        input.expectedVersion,
        input.expectedStatus,
      ],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow !== undefined) {
      return { outcome: "updated", version: updatedRow.version };
    }

    const current = await this.database.query<{
      status: string;
      version: number;
      updated_at: unknown;
      diagnostics: unknown;
      policy_state: unknown;
    }>(
      `select status, version, updated_at, diagnostics, policy_state from telephony_execution_sessions
       where tenant_id = $1 and call_session_id = $2`,
      [input.tenantId, input.callSessionId],
    );
    const row = current.rows[0];
    if (row === undefined) {
      return { outcome: "not_found" };
    }
    if (
      row.status === input.nextStatus &&
      row.version === input.expectedVersion + 1 &&
      normalizeTimestamp(row.updated_at) === normalizeTimestamp(input.updatedAt) &&
      (input.diagnostics === undefined || jsonMatches(row.diagnostics, input.diagnostics)) &&
      (input.policyState === undefined || jsonMatches(row.policy_state, input.policyState))
    ) {
      return { outcome: "existing", version: row.version };
    }
    return { outcome: "conflict", version: row.version };
  }

  async loadCallRuntimeContext(input: LoadTelephonyCallRuntimeContextInput) {
    const result = await this.database.query<{
      tenant_id: string;
      call_session_id: string;
      dispatch_id: string;
      connection_id: string;
      disposition: string;
      phone_number_id: string | null;
      published_version_id: string | null;
      workspace_id: string | null;
      workflow_label: string | null;
      route_mode: string | null;
      runtime_profile: string | null;
      runtime_path: string | null;
      test_route_session_id: string | null;
      status: string;
      version: number;
      lifecycle_state: unknown;
    }>(
      `select
         s.tenant_id, s.call_session_id, s.dispatch_id, s.connection_id,
         d.disposition, d.phone_number_id, d.published_version_id, d.workspace_id,
         d.workflow_label, d.route_mode, d.runtime_profile, d.runtime_path,
         d.test_route_session_id, s.status, s.version, s.lifecycle_state
       from telephony_execution_sessions s
       join telephony_dispatches d
         on d.tenant_id = s.tenant_id and d.id = s.dispatch_id
       where s.tenant_id = $1 and s.call_session_id = $2
         and d.runtime_path in ('pstn-sandwich', 'pstn-premium-realtime')`,
      [input.tenantId, input.callSessionId],
    );
    const row = result.rows[0];
    if (row === undefined) return { outcome: "not_found" as const };
    return {
      outcome: "found" as const,
      context: {
        tenantId: row.tenant_id,
        callSessionId: row.call_session_id,
        dispatchId: row.dispatch_id,
        connectionId: row.connection_id,
        disposition: row.disposition as TelephonyCallRuntimeContext["disposition"],
        ...(row.phone_number_id === null ? {} : { phoneNumberId: row.phone_number_id }),
        ...(row.published_version_id === null
          ? {}
          : { publishedVersionId: row.published_version_id }),
        ...(row.workspace_id === null ? {} : { workspaceId: row.workspace_id }),
        ...(row.workflow_label === null ? {} : { workflowLabel: row.workflow_label }),
        ...(row.route_mode === null ? {} : { routeMode: row.route_mode }),
        ...(row.runtime_profile === null ? {} : { runtimeProfile: row.runtime_profile }),
        runtimePath: row.runtime_path as PstnRuntimePath,
        ...(row.test_route_session_id === null
          ? {}
          : { testRouteSessionId: row.test_route_session_id }),
        status: row.status as TelephonyExecutionSessionStatus,
        version: row.version,
        lifecycleState: asLifecycleState(row.lifecycle_state),
      },
    };
  }

  async loadPremiumDispatchSnapshot(input: LoadTelephonyPremiumDispatchSnapshotInput) {
    const row = await loadPremiumDispatchSnapshotRow(
      this.database,
      input.tenantId,
      input.callSessionId,
    );
    if (row === undefined) {
      return { outcome: "not_found" as const };
    }
    const snapshot = asPremiumDispatchSnapshot(row.snapshot);
    assertPremiumDispatchSnapshotIntegrity(snapshot);
    assertPremiumDispatchSnapshotEnvelope(row, snapshot);
    return {
      outcome: "found" as const,
      snapshot,
    };
  }

  async transitionCallLifecycle(
    input: TransitionTelephonyCallLifecycleInput,
  ): Promise<TelephonyTransitionOutcome> {
    if (
      input.ownership !== undefined &&
      (
        !isPstnRealtimeWorkerId(input.ownership.workerId) ||
        !Number.isSafeInteger(input.ownership.ownerEpoch) ||
        input.ownership.ownerEpoch < 1
      )
    ) {
      return { outcome: "conflict" };
    }
    const updated = await this.database.query<{ version: number }>(
      `update telephony_execution_sessions
       set lifecycle_state = $1::jsonb,
           status = coalesce($2::text, status),
           version = version + 1,
           updated_at = $3
       where tenant_id = $4 and call_session_id = $5
         and version = $6
         and lifecycle_state->>'stage' = $7
         and lifecycle_state->>'stage' not in ('completed', 'failed', 'expired')
         and (
           ($8::text is null and $9::integer is null)
           or exists (
             select 1
             from telephony_media_stream_tokens as token
             where token.tenant_id = $4
               and token.call_session_id = $5
               and token.owner_worker_id = $8
               and token.owner_epoch = $9
               and token.claimed_at is not null
               and token.owner_lease_expires_at > current_timestamp
           )
         )
       returning version`,
      [
        JSON.stringify(input.nextState),
        input.nextStatus ?? null,
        input.nextState.observedAt,
        input.tenantId,
        input.callSessionId,
        input.expectedVersion,
        input.expectedStage,
        input.ownership?.workerId ?? null,
        input.ownership?.ownerEpoch ?? null,
      ],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow !== undefined) {
      return { outcome: "updated", version: updatedRow.version };
    }

    const current = await this.database.query<{
      status: string;
      version: number;
      lifecycle_state: unknown;
    }>(
      `select status, version, lifecycle_state
       from telephony_execution_sessions
       where tenant_id = $1 and call_session_id = $2`,
      [input.tenantId, input.callSessionId],
    );
    const row = current.rows[0];
    if (row === undefined) return { outcome: "not_found" };
    if (
      row.version === input.expectedVersion + 1 &&
      jsonMatches(row.lifecycle_state, input.nextState) &&
      (input.nextStatus === undefined || row.status === input.nextStatus)
    ) {
      return { outcome: "existing", version: row.version };
    }
    return { outcome: "conflict", version: row.version };
  }

  async claimMediaToken(
    input: ClaimTelephonyMediaTokenInput,
  ): Promise<TelephonyMediaTokenClaimOutcome> {
    if (
      !isSha256Hash(input.tokenHash) ||
      (input.workerId !== undefined &&
        !isPstnRealtimeWorkerId(input.workerId))
    ) {
      return { outcome: "conflict" };
    }

    const authorization = await this.database.query<{
      tenant_id: string;
      call_session_id: string;
      dispatch_id: string;
      connection_id: string;
      runtime_path: string | null;
    }>(
      `select
         t.tenant_id, t.call_session_id, t.dispatch_id, t.connection_id,
         d.runtime_path
       from telephony_media_stream_tokens t
       join telephony_execution_sessions s
         on s.tenant_id = t.tenant_id and s.call_session_id = t.call_session_id
       join telephony_dispatches d
         on d.tenant_id = t.tenant_id and d.id = t.dispatch_id
       where t.tenant_id = $1 and t.call_session_id = $2
         and t.dispatch_id = $3 and t.connection_id = $4 and t.token_hash = $5
         and d.runtime_path is not null
         and s.lifecycle_state->>'stage' not in ('completed', 'failed', 'expired')`,
      [
        input.tenantId,
        input.callSessionId,
        input.dispatchId,
        input.connectionId,
        input.tokenHash,
      ],
    );
    const authorizationRow = authorization.rows.find(
      (row) =>
        isPstnRuntimePath(row.runtime_path) &&
        (input.workerId === undefined || row.runtime_path === "pstn-premium-realtime"),
    );
    const claimed =
      authorizationRow === undefined
        ? { rows: [] as Array<{ owner_epoch: number }> }
        : input.workerId === undefined
          ? await this.database.query<{ owner_epoch: number }>(
              `update telephony_media_stream_tokens
               set claimed_at = current_timestamp
               where tenant_id = $1 and call_session_id = $2
                 and dispatch_id = $3 and connection_id = $4 and token_hash = $5
                 and claimed_at is null and expires_at > current_timestamp
                 and exists (
                   select 1
                   from telephony_execution_sessions s
                   where s.tenant_id = $1
                     and s.call_session_id = $2
                     and s.lifecycle_state->>'stage'
                       not in ('completed', 'failed', 'expired')
                 )
               returning owner_epoch`,
              [
                input.tenantId,
                input.callSessionId,
                input.dispatchId,
                input.connectionId,
                input.tokenHash,
              ],
            )
          : await this.database.query<{ owner_epoch: number }>(
              `update telephony_media_stream_tokens
               set claimed_at = current_timestamp,
                   owner_worker_id = $6,
                   owner_epoch = owner_epoch + 1
               where tenant_id = $1 and call_session_id = $2
                 and dispatch_id = $3 and connection_id = $4 and token_hash = $5
                 and claimed_at is null and expires_at > current_timestamp
                 and owner_worker_id is null and owner_epoch = 0
                 and exists (
                   select 1
                   from telephony_execution_sessions s
                   where s.tenant_id = $1
                     and s.call_session_id = $2
                     and s.lifecycle_state->>'stage'
                       not in ('completed', 'failed', 'expired')
                 )
               returning owner_epoch`,
              [
                input.tenantId,
                input.callSessionId,
                input.dispatchId,
                input.connectionId,
                input.tokenHash,
                input.workerId,
              ],
            );
    if (claimed.rows.length > 0 && authorizationRow !== undefined) {
      const ownerEpoch = claimed.rows[0]?.owner_epoch;
      return {
        outcome: "claimed",
        ...(input.workerId === undefined || ownerEpoch === undefined ? {} : { ownerEpoch }),
        authorization: {
          tenantId: authorizationRow.tenant_id,
          callSessionId: authorizationRow.call_session_id,
          dispatchId: authorizationRow.dispatch_id,
          connectionId: authorizationRow.connection_id,
          runtimePath: authorizationRow.runtime_path as PstnRuntimePath,
        },
      };
    }

    const current = await this.database.query<{
      token_hash: string;
      dispatch_id: string;
      connection_id: string;
      claimed_at: unknown | null;
      expired: boolean;
    }>(
      `select token_hash, dispatch_id, connection_id, claimed_at,
         (expires_at <= current_timestamp) as expired
       from telephony_media_stream_tokens
       where tenant_id = $1 and call_session_id = $2`,
      [input.tenantId, input.callSessionId],
    );
    const row = current.rows[0];
    if (row === undefined) {
      return { outcome: "not_found" };
    }
    if (row.token_hash !== input.tokenHash) {
      return { outcome: "conflict" };
    }
    if (row.dispatch_id !== input.dispatchId || row.connection_id !== input.connectionId) {
      return { outcome: "conflict" };
    }
    if (row.claimed_at !== null) {
      return { outcome: "already_claimed" };
    }
    if (row.expired) {
      return { outcome: "expired" };
    }
    return { outcome: "conflict" };
  }

  async fencePremiumCallOwnership(input: FenceTelephonyPremiumCallOwnershipInput) {
    if (
      !isPstnRealtimeWorkerId(input.workerId) ||
      !Number.isSafeInteger(input.ownerEpoch) ||
      input.ownerEpoch < 1 ||
      !Number.isFinite(Date.parse(input.leaseExpiresAt))
    ) {
      return { outcome: "not_owner" as const };
    }
    const owned = await this.database.query<{ owner_epoch: number }>(
      `update telephony_media_stream_tokens
       set owner_lease_expires_at = case
         when owner_lease_expires_at is null
           or owner_lease_expires_at < $5
         then $5
         else owner_lease_expires_at
       end
       where tenant_id = $1 and call_session_id = $2
         and owner_worker_id = $3 and owner_epoch = $4
         and claimed_at is not null
         and $5 > current_timestamp
         and exists (
           select 1
           from telephony_execution_sessions as session
           where session.tenant_id = $1
             and session.call_session_id = $2
             and session.lifecycle_state->>'stage'
               not in ('completed', 'failed', 'expired')
         )
       returning owner_epoch`,
      [
        input.tenantId,
        input.callSessionId,
        input.workerId,
        input.ownerEpoch,
        input.leaseExpiresAt,
      ],
    );
    const row = owned.rows[0];
    if (row !== undefined) {
      return { outcome: "owned" as const, ownerEpoch: row.owner_epoch };
    }
    const existing = await this.database.query(
      `select 1 from telephony_media_stream_tokens
       where tenant_id = $1 and call_session_id = $2`,
      [input.tenantId, input.callSessionId],
    );
    return existing.rows.length === 0
      ? { outcome: "not_found" as const }
      : { outcome: "not_owner" as const };
  }

  async reconcileExpiredPremiumCallOwners(
    input: ReconcileExpiredTelephonyPremiumCallOwnersInput,
  ) {
    if (
      !Number.isFinite(Date.parse(input.before))
      || !Number.isSafeInteger(input.limit)
      || input.limit < 1
      || input.limit > 1_000
    ) {
      throw new RangeError("Expired premium call reconciliation input is invalid.");
    }
    const nextState = JSON.stringify({
      stage: "failed",
      observedAt: input.before,
      reasonCode: "premium_call_owner_lease_expired",
    });
    const client = await this.database.connect();
    setInstrumentedTransactionContext(client, {
      operation: "telephony_call_lifecycle_transition",
    });
    try {
      await client.query("begin");
      const candidates = await client.query<{
        tenant_id: string;
        call_session_id: string;
      }>(
        `select session.tenant_id, session.call_session_id
         from telephony_execution_sessions as session
         inner join telephony_dispatches as dispatch
           on dispatch.tenant_id = session.tenant_id
          and dispatch.id = session.dispatch_id
         inner join telephony_media_stream_tokens as token
           on token.tenant_id = session.tenant_id
          and token.call_session_id = session.call_session_id
         where dispatch.runtime_path = 'pstn-premium-realtime'
           and token.owner_worker_id is not null
           and token.owner_epoch > 0
           and (
             token.owner_lease_expires_at <= $1
             or (
               token.owner_lease_expires_at is null
               and token.expires_at <= $1
             )
           )
           and session.lifecycle_state->>'stage'
             not in ('completed', 'failed', 'expired')
         order by coalesce(
           token.owner_lease_expires_at,
           token.expires_at
         ), session.call_session_id
         limit $2
         for update skip locked`,
        [input.before, input.limit],
      );
      let reconciledCount = 0;
      for (const candidate of candidates.rows) {
        const reconciled = await client.query(
          `update telephony_execution_sessions
           set lifecycle_state = $1::jsonb,
               status = 'terminated',
               version = version + 1,
               updated_at = $2
           where tenant_id = $3
             and call_session_id = $4
             and lifecycle_state->>'stage'
               not in ('completed', 'failed', 'expired')
           returning call_session_id`,
          [
            nextState,
            input.before,
            candidate.tenant_id,
            candidate.call_session_id,
          ],
        );
        if (reconciled.rows.length > 0) {
          await client.query(
            `delete from telephony_media_stream_tokens
             where tenant_id = $1 and call_session_id = $2`,
            [candidate.tenant_id, candidate.call_session_id],
          );
        }
        reconciledCount += reconciled.rows.length;
      }
      await client.query("commit");
      return { reconciledCount };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteExpiredMediaTokens(input: DeleteExpiredTelephonyMediaTokensInput) {
    const deleted = await this.database.query(
      `delete from telephony_media_stream_tokens
       where tenant_id = $1 and expires_at <= $2 and claimed_at is null
       returning call_session_id`,
      [input.tenantId, input.before],
    );
    return { deletedCount: deleted.rows.length };
  }

  async recordPhoneTestCheckpoint(checkpoint: TelephonyPhoneTestCheckpointRecord) {
    const ownedNumber = await this.database.query(
      "select id from telephony_phone_numbers where tenant_id = $1 and id = $2",
      [checkpoint.tenantId, checkpoint.phoneNumberId],
    );
    if (ownedNumber.rows.length === 0) {
      return { outcome: "not_found" as const };
    }

    const inserted = await this.database.query(
      `insert into telephony_phone_test_checkpoints (
        id, tenant_id, phone_number_id, call_session_id,
        test_route_session_id, checkpoint, observed_at
      ) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict do nothing returning id`,
      [
        checkpoint.id,
        checkpoint.tenantId,
        checkpoint.phoneNumberId,
        checkpoint.callSessionId,
        checkpoint.testRouteSessionId,
        checkpoint.checkpoint,
        checkpoint.observedAt,
      ],
    );
    if (inserted.rows.length > 0) {
      return { outcome: "inserted" as const };
    }

    const current = await this.database.query<{
      id: string;
      phone_number_id: string;
      call_session_id: string;
      observed_at: unknown;
    }>(
      `select id, phone_number_id, call_session_id, observed_at
       from telephony_phone_test_checkpoints
       where tenant_id = $1 and call_session_id = $2 and checkpoint = $3`,
      [checkpoint.tenantId, checkpoint.callSessionId, checkpoint.checkpoint],
    );
    const row = current.rows[0];
    const matches =
      row !== undefined &&
      row.id === checkpoint.id &&
      row.phone_number_id === checkpoint.phoneNumberId &&
      row.call_session_id === checkpoint.callSessionId &&
      normalizeTimestamp(row.observed_at) === normalizeTimestamp(checkpoint.observedAt);
    return { outcome: matches ? ("existing" as const) : ("conflict" as const) };
  }

  async recordPhoneTestCheckpointByCall(
    input: RecordTelephonyPhoneTestCheckpointByCallInput,
  ) {
    const id = `${input.callSessionId}:${input.checkpoint}`;
    const inserted = await this.database.query(
      `insert into telephony_phone_test_checkpoints (
         id, tenant_id, phone_number_id, call_session_id,
         test_route_session_id, checkpoint, observed_at
       )
       select $1, d.tenant_id, d.phone_number_id, d.call_session_id,
         d.test_route_session_id, $4, $5::timestamptz
       from telephony_dispatches d
       where d.tenant_id = $2 and d.call_session_id = $3
         and d.route_mode = 'test_route'
         and d.phone_number_id is not null
         and d.test_route_session_id is not null
       on conflict do nothing
       returning id`,
      [id, input.tenantId, input.callSessionId, input.checkpoint, input.observedAt],
    );
    if (inserted.rows.length > 0) return { outcome: "inserted" as const };

    const dispatch = await this.database.query<{
      route_mode: string | null;
      phone_number_id: string | null;
      test_route_session_id: string | null;
    }>(
      `select route_mode, phone_number_id, test_route_session_id
       from telephony_dispatches
       where tenant_id = $1 and call_session_id = $2`,
      [input.tenantId, input.callSessionId],
    );
    const row = dispatch.rows[0];
    if (row === undefined) return { outcome: "not_found" as const };
    if (
      row.route_mode !== "test_route" ||
      row.phone_number_id === null ||
      row.test_route_session_id === null
    ) {
      return { outcome: "not_applicable" as const };
    }
    return { outcome: "existing" as const };
  }

  async loadLatestSuccessfulPhoneTest(input: LoadLatestSuccessfulPhoneTestInput) {
    const result = await this.database.query<SuccessfulPhoneTestCheckpointRow>(
      `select
         d.call_session_id, d.test_route_session_id, d.created_at,
         max(c.observed_at) as completed_at
       from telephony_dispatches d
       join telephony_phone_test_checkpoints c
         on c.tenant_id = d.tenant_id and c.call_session_id = d.call_session_id
       where d.tenant_id = $1
         and d.phone_number_id = $2
         and d.published_version_id = $3
         and d.runtime_profile = $4
         and d.route_mode = 'test_route'
         and d.test_route_session_id is not null
         and c.checkpoint in (
           'verifiedWebhook', 'allowedCallerMatched', 'mediaWebSocketConnected',
           'inboundFrameReceived', 'transcriptCreated', 'agentResponseGenerated',
           'outboundAudioSent', 'cleanEnd', 'noFatalError'
         )
       group by
         d.call_session_id, d.test_route_session_id, d.created_at
       having count(distinct c.checkpoint) = 9
       order by max(c.observed_at) desc
       limit 1`,
      [
        input.tenantId,
        input.phoneNumberId,
        input.publishedVersionId,
        input.runtimeProfile,
      ],
    );
    return deriveLatestSuccessfulPhoneTest(input, result.rows[0]);
  }

  private async loadWebhookEvent(event: TelephonyWebhookEvent) {
    const existing = await this.database.query<WebhookEventRow>(
      `select id, account_sid, call_sid, event_type, received_at, duplicate
       from telephony_webhook_events
       where tenant_id = $1 and connection_id = $2 and event_sid = $3`,
      [event.tenantId, event.connectionId, event.eventSid],
    );
    return existing.rows[0];
  }
}

interface WebhookEventRow extends QueryResultRow {
  id: string;
  account_sid: string;
  call_sid: string;
  event_type: string;
  received_at: unknown;
  duplicate: boolean;
}

interface SuccessfulPhoneTestCheckpointRow extends QueryResultRow {
  call_session_id: string;
  test_route_session_id: string;
  created_at: unknown;
  completed_at: unknown;
}

interface PremiumDispatchSnapshotRow extends QueryResultRow {
  tenant_id: string;
  call_session_id: string;
  dispatch_id: string;
  workspace_id: string;
  published_version_id: string;
  schema_version: number;
  checksum: string;
  snapshot: unknown;
  created_at: unknown;
}

function deriveLatestSuccessfulPhoneTest(
  input: LoadLatestSuccessfulPhoneTestInput,
  row: SuccessfulPhoneTestCheckpointRow | undefined,
): TelephonyPhoneTestResult | null {
  if (row === undefined) return null;

  return {
    id: `${row.test_route_session_id}:passed`,
    tenantId: input.tenantId,
    numberId: input.phoneNumberId,
    sessionId: row.test_route_session_id,
    status: "passed",
    reason: "PSTN phone test completed every required checkpoint.",
    checklist: createSuccessfulPhoneTestChecklist(),
    publishedVersionId: input.publishedVersionId,
    runtimeProfile: input.runtimeProfile,
    createdAt: normalizeTimestamp(row.created_at),
    completedAt: normalizeTimestamp(row.completed_at),
  };
}

interface CallSetupRow extends QueryResultRow {
  tenant_id: string;
  dispatch_id: string;
  call_session_id: string;
  dispatch_connection_id: string | null;
  disposition: string;
  dispatch_direction: string;
  reason: string;
  phone_number_id: string | null;
  fallback_phone_number_id: string | null;
  published_version_id: string | null;
  workspace_id: string | null;
  workflow_label: string | null;
  route_mode: string | null;
  runtime_profile: string | null;
  runtime_path: string | null;
  test_route_session_id: string | null;
  dispatch_outage_mode: string | null;
  recording: unknown;
  dispatch_recording_consent: unknown;
  dispatch_to: string;
  dispatch_from: string;
  dispatch_created_at: unknown;
  source: string;
  policy_checks: unknown;
  session_id: string | null;
  session_dispatch_id: string | null;
  session_connection_id: string | null;
  provider: string | null;
  ownership_mode: string | null;
  direction: string | null;
  status: string | null;
  version: number | null;
  session_to: string | null;
  session_from: string | null;
  bridge_kind: string | null;
  bridge_target: string | null;
  media_path: string | null;
  test_call: boolean | null;
  session_workflow_label: string | null;
  session_workspace_id: string | null;
  session_outage_mode: string | null;
  fallback_target: string | null;
  session_recording_consent: unknown;
  diagnostics: unknown;
  policy_state: unknown;
  lifecycle_state: unknown;
  session_created_at: unknown;
  session_updated_at: unknown;
  token_dispatch_id: string | null;
  token_connection_id: string | null;
  token_hash: string | null;
  claimed_at: unknown | null;
  expires_at: unknown;
  token_created_at: unknown;
}

type DispatchRow = Pick<
  CallSetupRow,
  | "dispatch_id"
  | "dispatch_connection_id"
  | "dispatch_direction"
  | "disposition"
  | "reason"
  | "phone_number_id"
  | "fallback_phone_number_id"
  | "published_version_id"
  | "workspace_id"
  | "workflow_label"
  | "route_mode"
  | "runtime_profile"
  | "runtime_path"
  | "test_route_session_id"
  | "dispatch_outage_mode"
  | "recording"
  | "dispatch_recording_consent"
  | "dispatch_to"
  | "dispatch_from"
  | "source"
  | "policy_checks"
> & {
  call_session_id: string | null;
};

async function loadDispatch(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  tenantId: string,
  dispatchId: string,
) {
  const result = await database.query<DispatchRow>(
    `select
       id as dispatch_id, connection_id as dispatch_connection_id,
       direction as dispatch_direction, disposition, reason, call_session_id,
       phone_number_id, fallback_phone_number_id, published_version_id, workspace_id,
       workflow_label, route_mode, runtime_profile, runtime_path, test_route_session_id,
       outage_mode as dispatch_outage_mode, recording,
       recording_consent as dispatch_recording_consent,
       to_phone_number as dispatch_to, from_phone_number as dispatch_from,
       source, policy_checks
     from telephony_dispatches
     where tenant_id = $1 and id = $2`,
    [tenantId, dispatchId],
  );
  return result.rows[0];
}

async function loadCallSetup(
  database: Pick<PoolClient, "query">,
  input: CreateTelephonyCallExecutionInput,
) {
  return loadCallSetupByCall(
    database,
    input.dispatch.tenantId,
    input.executionSession.callSessionId,
  );
}

async function loadCallSetupByCall(
  database: Pick<PoolClient, "query"> | Queryable,
  tenantId: string,
  callSessionId: string,
) {
  const result = await database.query<CallSetupRow>(
    `select
       d.tenant_id, d.id as dispatch_id, d.call_session_id,
       d.connection_id as dispatch_connection_id,
       d.direction as dispatch_direction, d.disposition, d.reason,
       d.phone_number_id, d.fallback_phone_number_id,
       d.published_version_id, d.workspace_id, d.workflow_label,
       d.route_mode, d.runtime_profile, d.runtime_path, d.test_route_session_id,
       d.outage_mode as dispatch_outage_mode, d.recording,
       d.recording_consent as dispatch_recording_consent,
       d.to_phone_number as dispatch_to, d.from_phone_number as dispatch_from,
       d.created_at as dispatch_created_at, d.source, d.policy_checks,
       s.id as session_id, s.dispatch_id as session_dispatch_id,
       s.connection_id as session_connection_id, s.provider, s.ownership_mode,
       s.direction, s.status, s.version, s.to_phone_number as session_to,
       s.from_phone_number as session_from, s.bridge_kind, s.bridge_target,
       s.media_path, s.test_call, s.workflow_label as session_workflow_label,
       s.workspace_id as session_workspace_id, s.outage_mode as session_outage_mode,
       s.fallback_target, s.recording_consent as session_recording_consent,
        s.diagnostics, s.policy_state, s.lifecycle_state,
       s.created_at as session_created_at, s.updated_at as session_updated_at,
       t.dispatch_id as token_dispatch_id, t.connection_id as token_connection_id,
       t.token_hash, t.expires_at, t.created_at as token_created_at, t.claimed_at
     from telephony_dispatches d
     left join telephony_execution_sessions s
       on s.tenant_id = d.tenant_id and s.call_session_id = d.call_session_id
     left join telephony_media_stream_tokens t
       on t.tenant_id = d.tenant_id and t.call_session_id = d.call_session_id
     where d.tenant_id = $1 and d.call_session_id = $2`,
    [tenantId, callSessionId],
  );
  return result.rows[0];
}

async function loadPremiumDispatchSnapshotRow(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  tenantId: string,
  callSessionId: string,
) {
  const result = await database.query<PremiumDispatchSnapshotRow>(
    `select
       tenant_id, call_session_id, dispatch_id, workspace_id,
       published_version_id, schema_version, checksum, snapshot, created_at
     from telephony_premium_dispatch_snapshots
     where tenant_id = $1 and call_session_id = $2`,
    [tenantId, callSessionId],
  );
  return result.rows[0];
}

function callMutationContextFromRow(
  row: CallSetupRow,
  callSessionId: string,
): TelephonyCallMutationContext {
  const dispatch: TelephonyDispatchRecord = {
    id: row.dispatch_id,
    tenantId: row.tenant_id,
    direction: row.dispatch_direction as TelephonyDispatchRecord["direction"],
    disposition: row.disposition as TelephonyDispatchRecord["disposition"],
    reason: row.reason,
    callSessionId,
    ...(row.phone_number_id === null ? {} : { phoneNumberId: row.phone_number_id }),
    ...(row.fallback_phone_number_id === null
      ? {}
      : { fallbackPhoneNumberId: row.fallback_phone_number_id }),
    ...(row.dispatch_connection_id === null
      ? {}
      : { connectionId: row.dispatch_connection_id }),
    ...(row.published_version_id === null
      ? {}
      : { publishedVersionId: row.published_version_id }),
    ...(row.workspace_id === null ? {} : { workspaceId: row.workspace_id }),
    ...(row.workflow_label === null ? {} : { workflowLabel: row.workflow_label }),
    ...(row.route_mode === null
      ? {}
      : { routeMode: row.route_mode as NonNullable<TelephonyDispatchRecord["routeMode"]> }),
    ...(row.runtime_profile === null
      ? {}
      : {
          runtimeProfile:
            row.runtime_profile as NonNullable<TelephonyDispatchRecord["runtimeProfile"]>,
        }),
    ...(row.runtime_path === null
      ? {}
      : {
          runtimePath: row.runtime_path as NonNullable<TelephonyDispatchRecord["runtimePath"]>,
        }),
    ...(row.test_route_session_id === null
      ? {}
      : { testRouteSessionId: row.test_route_session_id }),
    ...(row.dispatch_outage_mode === null
      ? {}
      : {
          outageMode:
            row.dispatch_outage_mode as NonNullable<TelephonyDispatchRecord["outageMode"]>,
        }),
    recording: cloneJson(row.recording),
    recordingConsent: cloneJson(row.dispatch_recording_consent),
    toPhoneNumber: row.dispatch_to,
    fromPhoneNumber: row.dispatch_from,
    createdAt: normalizeTimestamp(row.dispatch_created_at),
    source: row.source as TelephonyDispatchRecord["source"],
    ...(row.policy_checks === null ? {} : { policyChecks: cloneJson(row.policy_checks) }),
  };
  const executionSession: TelephonyCallMutationContext["executionSession"] = {
    id: row.session_id!,
    tenantId: row.tenant_id,
    dispatchId: row.session_dispatch_id!,
    callSessionId,
    connectionId: row.session_connection_id!,
    provider: row.provider as TelephonyExecutionSession["provider"],
    ownershipMode: row.ownership_mode as TelephonyExecutionSession["ownershipMode"],
    direction: row.direction as TelephonyExecutionSession["direction"],
    status: row.status as TelephonyExecutionSession["status"],
    toPhoneNumber: row.session_to!,
    fromPhoneNumber: row.session_from!,
    ...(row.session_workflow_label === null
      ? {}
      : { workflowLabel: row.session_workflow_label }),
    ...(row.session_workspace_id === null ? {} : { workspaceId: row.session_workspace_id }),
    testCall: row.test_call!,
    bridgeKind: row.bridge_kind as TelephonyExecutionSession["bridgeKind"],
    bridgeTarget: row.bridge_target!,
    mediaPath: row.media_path as TelephonyExecutionSession["mediaPath"],
    ...(row.session_outage_mode === null
      ? {}
      : {
          outageMode:
            row.session_outage_mode as NonNullable<TelephonyExecutionSession["outageMode"]>,
        }),
    ...(row.fallback_target === null ? {} : { fallbackTarget: row.fallback_target }),
    ...(row.session_recording_consent === null
      ? {}
      : { recordingConsent: cloneJson(row.session_recording_consent) }),
    ...(row.policy_state === null ? {} : { policyState: cloneJson(row.policy_state) }),
    lifecycleState: asLifecycleState(row.lifecycle_state),
    diagnostics: cloneJson(row.diagnostics),
    createdAt: normalizeTimestamp(row.session_created_at),
    updatedAt: normalizeTimestamp(row.session_updated_at),
  };
  return { dispatch, executionSession, version: row.version! };
}

interface CallControlSessionRow extends QueryResultRow {
  status: string;
  version: number;
}

interface PhoneTestProjectionRow extends QueryResultRow {
  test_route: unknown | null;
  phone_test_results: unknown | null;
}

interface ConnectionPostureRow extends QueryResultRow {
  id: string;
  status: string;
  health_status: string;
}

interface ConnectionAdmissionPostureRow extends QueryResultRow {
  status: TelephonyConnection["status"];
  health_status: TelephonyHealthStatus;
  block_routing_on_health_failure: boolean;
}

async function lockOutboundExecutionConnection(
  client: Pick<PoolClient, "query">,
  input: CreateTelephonyCallExecutionInput,
) {
  if (input.dispatch.direction !== "outbound") {
    return "allowed" as const;
  }

  const connection = await client.query<{ outbound_abuse_blocked: boolean }>(
    `select outbound_abuse_blocked
     from telephony_connections
     where tenant_id = $1 and id = $2
     for update`,
    [input.dispatch.tenantId, input.executionSession.connectionId],
  );
  if (connection.rows.length === 0) {
    return "not_owned" as const;
  }
  return connection.rows[0]!.outbound_abuse_blocked
    ? ("blocked" as const)
    : ("allowed" as const);
}

async function callSetupReferencesAreOwned(
  client: Pick<PoolClient, "query">,
  input: CreateTelephonyCallExecutionInput,
) {
  return dispatchReferencesAreOwned(
    client,
    input.dispatch,
    input.executionSession.connectionId,
  );
}

async function dispatchReferencesAreOwned(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  dispatch: TelephonyDispatchRecord,
  effectiveConnectionId = dispatch.connectionId,
) {
  if (effectiveConnectionId !== undefined) {
    const connection = await database.query(
      `select id from telephony_connections
       where tenant_id = $1 and id = $2
       for key share`,
      [dispatch.tenantId, effectiveConnectionId],
    );
    if (connection.rows.length === 0) return false;
  }
  if (dispatch.phoneNumberId === undefined) return true;

  const primaryNumber = await database.query(
    `select id, connection_id from telephony_phone_numbers
     where tenant_id = $1 and id = $2
     for key share`,
    [dispatch.tenantId, dispatch.phoneNumberId],
  );
  if (primaryNumber.rows.length === 0) return false;
  if (dispatch.fallbackPhoneNumberId === undefined) {
    return (
      effectiveConnectionId === undefined ||
      primaryNumber.rows[0]?.connection_id === effectiveConnectionId
    );
  }
  if (effectiveConnectionId === undefined) return false;

  const fallbackNumber = await database.query(
    `select id from telephony_phone_numbers
     where tenant_id = $1 and id = $2 and connection_id = $3
     for key share`,
    [
      dispatch.tenantId,
      dispatch.fallbackPhoneNumberId,
      effectiveConnectionId,
    ],
  );
  return fallbackNumber.rows.length > 0;
}

async function insertDispatchRow(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  dispatch: TelephonyDispatchRecord,
) {
  return database.query(
    `insert into telephony_dispatches (
      id, tenant_id, direction, disposition, reason, call_session_id,
      phone_number_id, fallback_phone_number_id, connection_id, published_version_id,
      workspace_id, workflow_label, route_mode, runtime_profile, runtime_path, test_route_session_id,
      outage_mode, recording, recording_consent, to_phone_number, from_phone_number,
      created_at, source, policy_checks
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb, $20, $21, $22, $23, $24::jsonb
    ) on conflict do nothing returning id`,
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
      dispatch.runtimePath ?? null,
      dispatch.testRouteSessionId ?? null,
      dispatch.outageMode ?? null,
      JSON.stringify(dispatch.recording),
      JSON.stringify(dispatch.recordingConsent),
      dispatch.toPhoneNumber,
      dispatch.fromPhoneNumber,
      dispatch.createdAt,
      dispatch.source,
      dispatch.policyChecks === undefined ? null : JSON.stringify(dispatch.policyChecks),
    ],
  );
}

async function insertExecutionSession(
  client: PoolClient,
  input: CreateTelephonyCallExecutionInput,
) {
  const session = input.executionSession;
  await client.query(
    `insert into telephony_execution_sessions (
      id, tenant_id, dispatch_id, call_session_id, connection_id, provider,
      ownership_mode, direction, status, version, to_phone_number, from_phone_number,
      workflow_label, workspace_id, test_call, bridge_kind, bridge_target, media_path,
      outage_mode, fallback_target, recording_consent, diagnostics, policy_state,
      lifecycle_state, created_at, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11,
      $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb,
      $22::jsonb, $23::jsonb, $24, $25
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
      session.recordingConsent === undefined ? null : JSON.stringify(session.recordingConsent),
      JSON.stringify(session.diagnostics),
      session.policyState === undefined ? null : JSON.stringify(session.policyState),
      JSON.stringify(session.lifecycleState),
      session.createdAt,
      session.updatedAt,
    ],
  );
}

async function insertExecutionCommands(
  client: Pick<PoolClient, "query">,
  input: CreateTelephonyCallExecutionInput,
) {
  for (const command of input.executionCommands) {
    await client.query(
      `insert into telephony_execution_commands (
        id, tenant_id, session_id, dispatch_id, call_session_id, provider,
        action, status, target, payload, requested_at, applied_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
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
}

async function insertMediaToken(client: PoolClient, input: CreateTelephonyCallSetupInput) {
  const token = input.mediaToken;
  await client.query(
    `insert into telephony_media_stream_tokens (
      tenant_id, call_session_id, dispatch_id, connection_id,
      token_hash, expires_at, created_at, claimed_at
    ) values ($1, $2, $3, $4, $5, $6, $7, null)`,
    [
      token.tenantId,
      token.callSessionId,
      token.dispatchId,
      token.connectionId,
      token.tokenHash,
      token.expiresAt,
      token.createdAt,
    ],
  );
}

async function insertPremiumDispatchSnapshot(
  client: Pick<PoolClient, "query">,
  input: CreateTelephonyCallSetupInput,
) {
  const snapshot = input.premiumDispatchSnapshot;
  if (snapshot === undefined) return;
  await client.query(
    `insert into telephony_premium_dispatch_snapshots (
      tenant_id, call_session_id, dispatch_id, workspace_id,
      published_version_id, schema_version, checksum, snapshot, created_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      snapshot.tenantId,
      snapshot.callSessionId,
      snapshot.dispatchId,
      snapshot.workspaceId,
      snapshot.publishedVersionId,
      snapshot.schemaVersion,
      snapshot.checksum,
      JSON.stringify(snapshot),
      snapshot.createdAt,
    ],
  );
}

function assertCallSetup(input: CreateTelephonyCallSetupInput) {
  assertCallExecution(input);
  const tenantId = input.dispatch.tenantId;
  const callSessionId = input.dispatch.callSessionId;
  if (
    input.mediaToken.tenantId !== tenantId ||
    input.mediaToken.callSessionId !== callSessionId ||
    input.mediaToken.dispatchId !== input.dispatch.id ||
    input.executionSession.connectionId !== input.mediaToken.connectionId ||
    !isFiniteTimestamp(input.mediaToken.createdAt) ||
    !isFiniteTimestamp(input.mediaToken.expiresAt) ||
    Date.parse(input.mediaToken.expiresAt) <= Date.parse(input.mediaToken.createdAt) ||
    !isSha256Hash(input.mediaToken.tokenHash)
  ) {
    throw new Error("Telephony call setup identities or media token hash are invalid.");
  }
  if (input.premiumDispatchSnapshot !== undefined) {
    assertPremiumDispatchSnapshot(input, input.premiumDispatchSnapshot);
  }
}

function assertPremiumDispatchSnapshot(
  input: CreateTelephonyCallSetupInput,
  snapshot: TelephonyPremiumDispatchSnapshot,
) {
  assertPremiumDispatchSnapshotIntegrity(snapshot);
  if (
    input.dispatch.runtimePath !== "pstn-premium-realtime" ||
    snapshot.tenantId !== input.dispatch.tenantId ||
    snapshot.workspaceId !== input.dispatch.workspaceId ||
    snapshot.callSessionId !== input.executionSession.callSessionId ||
    snapshot.dispatchId !== input.dispatch.id ||
    snapshot.publishedVersionId !== input.dispatch.publishedVersionId
  ) {
    throw new Error("Premium dispatch snapshot identities or checksum are invalid.");
  }
}

function assertPremiumDispatchSnapshotIntegrity(snapshot: TelephonyPremiumDispatchSnapshot) {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.resolvedManifest !== "object" ||
    snapshot.resolvedManifest === null ||
    snapshot.resolvedManifest.tenantId !== snapshot.tenantId ||
    snapshot.resolvedManifest.workspaceId !== snapshot.workspaceId ||
    snapshot.resolvedManifest.publishedVersionId !== snapshot.publishedVersionId ||
    !isPremiumWorkerTarget(snapshot.workerTarget) ||
    !isFiniteTimestamp(snapshot.createdAt) ||
    !/^[a-f0-9]{64}$/.test(snapshot.checksum)
  ) {
    throw new Error("Premium dispatch snapshot identities or checksum are invalid.");
  }
  const withoutChecksum = structuredClone(snapshot) as Partial<TelephonyPremiumDispatchSnapshot>;
  delete withoutChecksum.checksum;
  if (
    computeTelephonyPremiumDispatchSnapshotChecksum(
      withoutChecksum as Omit<TelephonyPremiumDispatchSnapshot, "checksum">,
    ) !== snapshot.checksum
  ) {
    throw new Error("Premium dispatch snapshot identities or checksum are invalid.");
  }
  if (containsSensitiveSnapshotMaterial(snapshot)) {
    throw new Error("Premium dispatch snapshot contains sensitive material.");
  }
}

function assertPremiumDispatchSnapshotEnvelope(
  row: PremiumDispatchSnapshotRow,
  snapshot: TelephonyPremiumDispatchSnapshot,
) {
  if (
    row.tenant_id !== snapshot.tenantId ||
    row.call_session_id !== snapshot.callSessionId ||
    row.dispatch_id !== snapshot.dispatchId ||
    row.workspace_id !== snapshot.workspaceId ||
    row.published_version_id !== snapshot.publishedVersionId ||
    row.schema_version !== snapshot.schemaVersion ||
    row.checksum !== snapshot.checksum ||
    normalizeTimestamp(row.created_at) !== normalizeTimestamp(snapshot.createdAt)
  ) {
    throw new Error("Premium dispatch snapshot envelope is invalid.");
  }
}

function isPremiumWorkerTarget(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const target = value as Record<string, unknown>;
  return Object.keys(target).length === 3
    && isPstnRealtimeWorkerId(target["workerId"])
    && isPstnRealtimeWorkerReleaseId(target["releaseId"])
    && isPstnRealtimeWorkerMediaStreamBaseUrl(
      target["mediaStreamBaseUrl"],
    );
}

function assertCallExecution(input: CreateTelephonyCallExecutionInput) {
  const tenantId = input.dispatch.tenantId;
  const callSessionId = input.dispatch.callSessionId;
  const session = input.executionSession;
  const commandsAreOwned =
    input.executionCommands.length > 0 &&
    input.executionCommands.every(
      (command) =>
        command.tenantId === tenantId &&
        command.sessionId === session.id &&
        command.dispatchId === input.dispatch.id &&
        command.callSessionId === callSessionId &&
        command.provider === session.provider &&
        isFiniteTimestamp(command.requestedAt) &&
        (command.appliedAt === undefined || isFiniteTimestamp(command.appliedAt)),
    );
  if (
    callSessionId === undefined ||
    session.tenantId !== tenantId ||
    session.callSessionId !== callSessionId ||
    session.dispatchId !== input.dispatch.id ||
    input.dispatch.connectionId !== session.connectionId ||
    !commandsAreOwned
  ) {
    throw new Error("Telephony call execution identities or commands are invalid.");
  }
}

function callSetupMatches(row: CallSetupRow | undefined, input: CreateTelephonyCallSetupInput) {
  if (!callExecutionMatches(row, input)) return false;
  const token = input.mediaToken;
  return (
    row!.token_dispatch_id === token.dispatchId &&
    row!.token_connection_id === token.connectionId &&
    row!.token_hash !== null &&
    row!.expires_at !== null &&
    row!.token_created_at !== null
  );
}

function premiumDispatchSnapshotMatches(
  row: PremiumDispatchSnapshotRow | undefined,
  expected: TelephonyPremiumDispatchSnapshot | undefined,
) {
  if (row === undefined || expected === undefined) {
    return row === undefined && expected === undefined;
  }
  return (
    row.tenant_id === expected.tenantId &&
    row.call_session_id === expected.callSessionId &&
    row.dispatch_id === expected.dispatchId &&
    row.workspace_id === expected.workspaceId &&
    row.published_version_id === expected.publishedVersionId &&
    row.schema_version === expected.schemaVersion &&
    row.checksum === expected.checksum &&
    normalizeTimestamp(row.created_at) === normalizeTimestamp(expected.createdAt) &&
    jsonMatches(row.snapshot, expected)
  );
}

function callExecutionMatches(
  row: CallSetupRow | undefined,
  input: CreateTelephonyCallExecutionInput,
) {
  if (row === undefined) return false;
  const dispatch = input.dispatch;
  const session = input.executionSession;
  return (
    row.dispatch_id === dispatch.id &&
    row.dispatch_connection_id === (dispatch.connectionId ?? null) &&
    row.dispatch_direction === dispatch.direction &&
    row.disposition === dispatch.disposition &&
    row.reason === dispatch.reason &&
    row.phone_number_id === (dispatch.phoneNumberId ?? null) &&
    row.fallback_phone_number_id === (dispatch.fallbackPhoneNumberId ?? null) &&
    row.published_version_id === (dispatch.publishedVersionId ?? null) &&
    row.workspace_id === (dispatch.workspaceId ?? null) &&
    row.workflow_label === (dispatch.workflowLabel ?? null) &&
    row.route_mode === (dispatch.routeMode ?? null) &&
    row.runtime_profile === (dispatch.runtimeProfile ?? null) &&
    row.runtime_path === (dispatch.runtimePath ?? null) &&
    row.test_route_session_id === (dispatch.testRouteSessionId ?? null) &&
    row.dispatch_outage_mode === (dispatch.outageMode ?? null) &&
    jsonMatches(row.recording, dispatch.recording) &&
    jsonMatches(row.dispatch_recording_consent, dispatch.recordingConsent) &&
    row.dispatch_to === dispatch.toPhoneNumber &&
    row.dispatch_from === dispatch.fromPhoneNumber &&
    row.source === dispatch.source &&
    jsonMatches(row.policy_checks, dispatch.policyChecks ?? null) &&
    row.session_id === session.id &&
    row.session_dispatch_id === session.dispatchId &&
    row.session_connection_id === session.connectionId &&
    row.provider === session.provider &&
    row.ownership_mode === session.ownershipMode &&
    row.direction === session.direction &&
    row.status === session.status &&
    row.version === 0 &&
    row.session_to === session.toPhoneNumber &&
    row.session_from === session.fromPhoneNumber &&
    row.bridge_kind === session.bridgeKind &&
    row.bridge_target === session.bridgeTarget &&
    row.media_path === session.mediaPath &&
    row.test_call === session.testCall &&
    row.session_workflow_label === (session.workflowLabel ?? null) &&
    row.session_workspace_id === (session.workspaceId ?? null) &&
    row.session_outage_mode === (session.outageMode ?? null) &&
    row.fallback_target === (session.fallbackTarget ?? null) &&
    jsonMatches(row.session_recording_consent, session.recordingConsent ?? null) &&
    jsonMatches(row.lifecycle_state, session.lifecycleState)
  );
}

async function executionCommandsMatch(
  database: Pick<PoolClient, "query">,
  tenantId: string,
  sessionId: string,
  commands: TelephonyExecutionCommand[],
) {
  const result = await database.query<ExecutionCommandRow>(
    `select id, tenant_id, session_id, dispatch_id, call_session_id, provider,
            action, status, target, payload, requested_at, applied_at
     from telephony_execution_commands
     where tenant_id = $1 and session_id = $2
     order by id`,
    [tenantId, sessionId],
  );
  const expected = [...commands].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return (
    result.rows.length === expected.length &&
    result.rows.every((row, index) => executionCommandMatches(row, expected[index]!))
  );
}

interface ExecutionCommandRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  session_id: string;
  dispatch_id: string;
  call_session_id: string;
  provider: string;
  action: string;
  status: string;
  target: string;
  payload: unknown;
  requested_at: unknown;
  applied_at: unknown | null;
}

function executionCommandMatches(row: ExecutionCommandRow, command: TelephonyExecutionCommand) {
  return (
    row.id === command.id &&
    row.tenant_id === command.tenantId &&
    row.session_id === command.sessionId &&
    row.dispatch_id === command.dispatchId &&
    row.call_session_id === command.callSessionId &&
    row.provider === command.provider &&
    row.action === command.action &&
    row.status === command.status &&
    row.target === command.target &&
    jsonMatches(row.payload, command.payload) &&
    normalizeTimestamp(row.requested_at) === normalizeTimestamp(command.requestedAt) &&
    (row.applied_at === null
      ? command.appliedAt === undefined
      : normalizeTimestamp(row.applied_at) === normalizeTimestamp(command.appliedAt))
  );
}

function assertCallControlMutation(input: RecordTelephonyCallControlMutationInput) {
  const commandSessionIds = new Set(input.executionCommands.map((command) => command.sessionId));
  if (
    input.event.tenantId !== input.tenantId ||
    input.event.callSessionId !== input.callSessionId ||
    input.event.dispatchId !== input.dispatchId ||
    input.executionCommands.length === 0 ||
    commandSessionIds.size !== 1 ||
    input.executionCommands.some(
      (command) =>
        command.tenantId !== input.tenantId ||
        command.callSessionId !== input.callSessionId ||
        command.dispatchId !== input.dispatchId ||
        !isFiniteTimestamp(command.requestedAt) ||
        (command.appliedAt !== undefined && !isFiniteTimestamp(command.appliedAt)),
    ) ||
    !isFiniteTimestamp(input.event.at) ||
    !isFiniteTimestamp(input.session.updatedAt) ||
    (input.retryCount !== undefined &&
      (!Number.isSafeInteger(input.retryCount) || input.retryCount < 0))
  ) {
    throw new Error("Telephony call-control mutation identities are invalid.");
  }
}

function assertValidTimestamp(value: string, label: string) {
  if (!isFiniteTimestamp(value)) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
}

async function insertOrMatchCallControlEvent(
  database: Pick<PoolClient, "query">,
  event: TelephonyCallControlEvent,
) {
  const inserted = await database.query(
    `insert into telephony_call_control_events (
       id, tenant_id, dispatch_id, call_session_id, event_type, at,
       summary, fallback_target, payload
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     on conflict (tenant_id, id) do nothing
     returning id`,
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
  return inserted.rows.length > 0 || callControlEventMatches(database, event);
}

async function callControlEventMatches(
  database: Pick<PoolClient, "query">,
  event: TelephonyCallControlEvent,
) {
  const row = await loadCallControlEvent(database, event);
  return row !== undefined && callControlEventRowMatches(row, event);
}

async function loadCallControlEvent(
  database: Pick<PoolClient, "query">,
  event: Pick<TelephonyCallControlEvent, "tenantId" | "id">,
) {
  const result = await database.query<CallControlEventRow>(
    `select id, tenant_id, dispatch_id, call_session_id, event_type, at,
            summary, fallback_target, payload
     from telephony_call_control_events
     where tenant_id = $1 and id = $2`,
    [event.tenantId, event.id],
  );
  return result.rows[0];
}

function callControlEventRowMatches(
  row: CallControlEventRow,
  event: TelephonyCallControlEvent,
) {
  return (
    row.dispatch_id === event.dispatchId &&
    row.call_session_id === event.callSessionId &&
    row.event_type === event.eventType &&
    normalizeTimestamp(row.at) === normalizeTimestamp(event.at) &&
    row.summary === event.summary &&
    row.fallback_target === (event.fallbackTarget ?? null) &&
    jsonMatches(row.payload, event.payload)
  );
}

interface CallControlEventRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  dispatch_id: string;
  call_session_id: string;
  event_type: string;
  at: unknown;
  summary: string;
  fallback_target: string | null;
  payload: unknown;
}

async function insertOrMatchExecutionCommands(
  database: Pick<PoolClient, "query">,
  commands: TelephonyExecutionCommand[],
) {
  for (const command of commands) {
    await database.query(
      `insert into telephony_execution_commands (
         id, tenant_id, session_id, dispatch_id, call_session_id, provider,
         action, status, target, payload, requested_at, applied_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       on conflict (tenant_id, id) do nothing`,
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
  return executionCommandSubsetMatches(database, commands);
}

async function executionCommandSubsetMatches(
  database: Pick<PoolClient, "query">,
  commands: TelephonyExecutionCommand[],
) {
  const rows = await Promise.all(
    commands.map(async (command) => {
      const result = await database.query<ExecutionCommandRow>(
        `select id, tenant_id, session_id, dispatch_id, call_session_id, provider,
                action, status, target, payload, requested_at, applied_at
         from telephony_execution_commands
         where tenant_id = $1 and id = $2`,
        [command.tenantId, command.id],
      );
      return result.rows[0];
    }),
  );
  return rows.every(
    (row, index) => row !== undefined && executionCommandMatches(row, commands[index]!),
  );
}

function isTerminalExecutionStatus(status: string) {
  return status === "terminated" || status === "completed" || status === "blocked";
}

function dispatchMatches(row: DispatchRow | undefined, dispatch: TelephonyDispatchRecord) {
  return (
    row !== undefined &&
    row.dispatch_id === dispatch.id &&
    row.dispatch_connection_id === (dispatch.connectionId ?? null) &&
    row.dispatch_direction === dispatch.direction &&
    row.disposition === dispatch.disposition &&
    row.reason === dispatch.reason &&
    row.call_session_id === (dispatch.callSessionId ?? null) &&
    row.phone_number_id === (dispatch.phoneNumberId ?? null) &&
    row.fallback_phone_number_id === (dispatch.fallbackPhoneNumberId ?? null) &&
    row.published_version_id === (dispatch.publishedVersionId ?? null) &&
    row.workspace_id === (dispatch.workspaceId ?? null) &&
    row.workflow_label === (dispatch.workflowLabel ?? null) &&
    row.route_mode === (dispatch.routeMode ?? null) &&
    row.runtime_profile === (dispatch.runtimeProfile ?? null) &&
    row.runtime_path === (dispatch.runtimePath ?? null) &&
    row.test_route_session_id === (dispatch.testRouteSessionId ?? null) &&
    row.dispatch_outage_mode === (dispatch.outageMode ?? null) &&
    jsonMatches(row.recording, dispatch.recording) &&
    jsonMatches(row.dispatch_recording_consent, dispatch.recordingConsent) &&
    row.dispatch_to === dispatch.toPhoneNumber &&
    row.dispatch_from === dispatch.fromPhoneNumber &&
    row.source === dispatch.source &&
    jsonMatches(row.policy_checks, dispatch.policyChecks ?? null)
  );
}

function webhookEventMatches(row: WebhookEventRow | undefined, event: TelephonyWebhookEvent) {
  return (
    row !== undefined &&
    row.id === event.id &&
    row.account_sid === event.accountSid &&
    row.call_sid === event.callSid &&
    row.event_type === event.eventType
  );
}

async function rollbackQuietly(client: PoolClient) {
  try {
    await client.query("rollback");
  } catch {
    // Preserve the original database failure.
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isSha256Hash(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isFiniteTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}

function isPstnRuntimePath(value: string | null): value is PstnRuntimePath {
  return value === "pstn-sandwich" || value === "pstn-premium-realtime";
}

function asPremiumDispatchSnapshot(value: unknown): TelephonyPremiumDispatchSnapshot {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return structuredClone(parsed) as TelephonyPremiumDispatchSnapshot;
}

const sensitiveSnapshotKeys = new Set([
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "authorization",
  "credential",
  "credentials",
  "password",
  "secret",
  "streamtoken",
  "tokenhash",
]);

function containsSensitiveSnapshotMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveSnapshotMaterial);
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record["name"] === "string" &&
    record["name"].toLowerCase() === "authorization" &&
    typeof record["value"] === "string" &&
    record["value"].trim().length > 0
  ) {
    return true;
  }
  return Object.entries(record).some(
    ([key, entry]) =>
      (sensitiveSnapshotKeys.has(key.toLowerCase()) &&
        entry !== undefined &&
        entry !== null &&
        entry !== "") ||
      containsSensitiveSnapshotMaterial(entry),
  );
}

function jsonMatches(value: unknown, expected: unknown) {
  return JSON.stringify(canonicalizeJson(value)) === JSON.stringify(canonicalizeJson(expected));
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeJson(entry)]),
  );
}

function cloneJson<T>(value: unknown): T {
  return structuredClone(value) as T;
}

function jsonParameter(value: unknown) {
  return value === null ? null : JSON.stringify(value);
}

function normalizeTimestamp(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function asLifecycleState(value: unknown): TelephonyCallLifecycleState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("stage" in value) ||
    typeof value.stage !== "string" ||
    !("observedAt" in value) ||
    typeof value.observedAt !== "string"
  ) {
    throw new Error("Stored telephony lifecycle state is invalid.");
  }
  return value as TelephonyCallLifecycleState;
}

type InstrumentedQuery = (...args: unknown[]) => Promise<unknown>;
const setTransactionMetricsContext = Symbol("setTransactionMetricsContext");

interface TransactionMetricsContext {
  operation: PstnCapacityDatabaseOperation;
  retryCount?: number | undefined;
}

type InstrumentedPoolClient = PoolClient & {
  [setTransactionMetricsContext]?: (context: TransactionMetricsContext) => void;
};

function createInstrumentedDatabase(
  database: Queryable,
  observability: DatabaseMetricsRecorder,
): Queryable {
  const query = async (...args: unknown[]) => {
    const acquisitionStartedAt = performance.now();
    const client = await database.connect();
    const poolAcquisitionWaitMs = performance.now() - acquisitionStartedAt;
    const queryStartedAt = performance.now();
    const sql = queryText(args[0]);
    try {
      const result = await invokeQuery(client.query, client, args);
      safeRecordDatabaseOperation(observability, {
        operation: inferQueryOperation(sql),
        outcome: "success",
        queryDurationMs: performance.now() - queryStartedAt,
        poolAcquisitionWaitMs,
        rowLockWaitMs: isRowLockingQuery(sql)
          ? performance.now() - queryStartedAt
          : 0,
        pool: poolSnapshot(database),
      });
      return result;
    } catch (error) {
      safeRecordDatabaseOperation(observability, {
        operation: inferQueryOperation(sql),
        outcome: "failure",
        queryDurationMs: performance.now() - queryStartedAt,
        poolAcquisitionWaitMs,
        rowLockWaitMs: isRowLockingQuery(sql)
          ? performance.now() - queryStartedAt
          : 0,
        ...(isDeadlock(error) ? { deadlockCount: 1 } : {}),
        pool: poolSnapshot(database),
      });
      throw error;
    } finally {
      client.release();
    }
  };
  const connect = async () => {
    const acquisitionStartedAt = performance.now();
    const client = await database.connect();
    return createInstrumentedClient(
      client,
      observability,
      database,
      performance.now() - acquisitionStartedAt,
    );
  };
  return {
    query: query as unknown as Queryable["query"],
    connect: connect as Queryable["connect"],
  };
}

function createInstrumentedClient(
  client: PoolClient,
  observability: DatabaseMetricsRecorder,
  database: Queryable,
  poolAcquisitionWaitMs: number,
): PoolClient {
  let transactionStartedAt: number | null = null;
  let rowLockWaitMs = 0;
  let acquisitionReported = false;
  let metricsContext: TransactionMetricsContext | undefined;
  const transactionStatements: string[] = [];
  const query = async (...args: unknown[]) => {
    const sql = queryText(args[0]);
    const normalized = sql.trim().toLowerCase();
    const queryStartedAt = performance.now();
    if (normalized === "begin") transactionStartedAt = queryStartedAt;
    try {
      const result = await invokeQuery(client.query, client, args);
      const queryDurationMs = performance.now() - queryStartedAt;
      if (isRowLockingQuery(sql)) rowLockWaitMs += queryDurationMs;
      if (!isTransactionControl(normalized)) {
        transactionStatements.push(sql);
        safeRecordDatabaseOperation(observability, {
          operation: inferQueryOperation(sql),
          outcome: "success",
          queryDurationMs,
          ...(!acquisitionReported ? { poolAcquisitionWaitMs } : {}),
          rowLockWaitMs: isRowLockingQuery(sql) ? queryDurationMs : 0,
          pool: poolSnapshot(database),
        });
        acquisitionReported = true;
      }
      if (
        (normalized === "commit" || normalized === "rollback") &&
        transactionStartedAt !== null
      ) {
        safeRecordDatabaseOperation(observability, {
          operation:
            metricsContext?.operation ?? inferTransactionOperation(transactionStatements),
          outcome: "success",
          queryDurationMs,
          transactionDurationMs: performance.now() - transactionStartedAt,
          poolAcquisitionWaitMs,
          rowLockWaitMs,
          ...(normalized === "commit" &&
            metricsContext?.retryCount !== undefined &&
            metricsContext.retryCount > 0
            ? { retryCount: metricsContext.retryCount }
            : {}),
          pool: poolSnapshot(database),
        });
      }
      return result;
    } catch (error) {
      const queryDurationMs = performance.now() - queryStartedAt;
      safeRecordDatabaseOperation(observability, {
        operation:
          metricsContext?.operation ??
          inferTransactionOperation([...transactionStatements, sql]),
        outcome: "failure",
        queryDurationMs,
        ...(transactionStartedAt === null
          ? {}
          : { transactionDurationMs: performance.now() - transactionStartedAt }),
        poolAcquisitionWaitMs,
        rowLockWaitMs:
          rowLockWaitMs + (isRowLockingQuery(sql) ? queryDurationMs : 0),
        ...(isDeadlock(error) ? { deadlockCount: 1 } : {}),
        ...(metricsContext?.retryCount !== undefined && metricsContext.retryCount > 0
          ? { retryCount: metricsContext.retryCount }
          : {}),
        pool: poolSnapshot(database),
      });
      throw error;
    }
  };
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") return query;
      if (property === setTransactionMetricsContext) {
        return (context: TransactionMetricsContext) => {
          metricsContext = context;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function setInstrumentedTransactionContext(
  client: PoolClient,
  context: TransactionMetricsContext,
) {
  (client as InstrumentedPoolClient)[setTransactionMetricsContext]?.(context);
}

async function invokeQuery(
  query: PoolClient["query"],
  receiver: PoolClient,
  args: unknown[],
) {
  return await Reflect.apply(
    query as unknown as InstrumentedQuery,
    receiver,
    args,
  );
}

function queryText(value: unknown) {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text;
  }
  return "";
}

function inferTransactionOperation(
  statements: string[],
): PstnCapacityDatabaseOperation {
  const sql = statements.join("\n").toLowerCase();
  if (sql.includes("telephony_call_control_events")) {
    return "telephony_call_control_mutation";
  }
  if (
    sql.includes("update telephony_connections") &&
    sql.includes("health_status = 'failed'")
  ) {
    return "telephony_outbound_abuse_block";
  }
  if (sql.includes("insert into telephony_media_stream_tokens")) {
    return "telephony_call_setup_create";
  }
  if (
    sql.includes("insert into telephony_execution_sessions") &&
    sql.includes("insert into telephony_execution_commands")
  ) {
    return "telephony_call_execution_create";
  }
  return inferQueryOperation(statements.at(-1) ?? "");
}

function inferQueryOperation(sql: string): PstnCapacityDatabaseOperation {
  const normalized = sql.toLowerCase();
  if (normalized.includes("telephony_webhook_events")) {
    return "telephony_webhook_insert";
  }
  if (normalized.includes("telephony_call_control_events")) {
    return "telephony_call_control_mutation";
  }
  if (
    normalized.includes("telephony_phone_numbers") &&
    (normalized.includes("test_route") || normalized.includes("phone_test_results"))
  ) {
    return "telephony_phone_test_projection_update";
  }
  if (
    normalized.includes("delete from telephony_phone_numbers")
  ) {
    return "telephony_phone_number_delete";
  }
  if (normalized.includes("telephony_phone_test_checkpoints")) {
    return normalized.includes("test_route_session_id") &&
      normalized.includes("group by")
      ? "telephony_successful_phone_test_load"
      : "telephony_phone_test_checkpoint_record";
  }
  if (normalized.includes("delete from telephony_media_stream_tokens")) {
    return "telephony_media_token_cleanup";
  }
  if (normalized.includes("telephony_media_stream_tokens")) {
    return normalized.includes("claimed_at")
      ? "telephony_media_token_claim"
      : "telephony_call_setup_create";
  }
  if (
    normalized.includes("telephony_execution_sessions") &&
    normalized.includes("lifecycle_state") &&
    normalized.includes("update")
  ) {
    return "telephony_call_lifecycle_transition";
  }
  if (
    normalized.includes("telephony_execution_sessions") &&
    normalized.includes("telephony_dispatches")
  ) {
    return normalized.includes("telephony_media_stream_tokens")
      ? "telephony_call_mutation_context_load"
      : "telephony_call_runtime_context_load";
  }
  if (normalized.includes("telephony_execution_sessions")) {
    return "telephony_execution_session_transition";
  }
  return "telephony_dispatch_insert";
}

function isTransactionControl(normalizedSql: string) {
  return (
    normalizedSql === "begin" ||
    normalizedSql === "commit" ||
    normalizedSql === "rollback"
  );
}

function isRowLockingQuery(sql: string) {
  return /\bfor\s+(update|key\s+share)\b/i.test(sql);
}

function isDeadlock(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "40P01"
  );
}

function poolSnapshot(database: Queryable) {
  const pool = database as Partial<Pool> & { options?: { max?: number } };
  return {
    active: Math.max(0, (pool.totalCount ?? 0) - (pool.idleCount ?? 0)),
    idle: pool.idleCount ?? 0,
    waiting: pool.waitingCount ?? 0,
    limit: pool.options?.max ?? 1,
  };
}

function safeRecordDatabaseOperation(
  observability: DatabaseMetricsRecorder,
  input: Parameters<DatabaseMetricsRecorder["recordDatabaseOperation"]>[0],
) {
  try {
    observability.recordDatabaseOperation(input);
  } catch {
    // Capacity telemetry must never block telephony persistence.
  }
}
