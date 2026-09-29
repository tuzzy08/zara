import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import type { SharedProviderObservationSnapshot } from "./shared-provider-usage-comparison";
import type { OpenAiTranscriptionSnapshot } from "./openai-transcription-usage-comparison";

export interface ProviderUsageRequest {
  organizationId: string;
  sessionId: string | null;
  externalScopeId: string | null;
  provider: string;
  model: string;
  occurredAt: string;
}

export interface ProviderConnectionResult {
  endedAt: string;
  outcome: "closed" | "failed";
  providerSessionId: string | null;
}

export interface ProviderUsageResult {
  providerRequestId: string;
  occurredAt: string;
  totals: Record<string, number>;
  responseStatus?: "completed" | "cancelled" | "failed" | "incomplete";
  breakdown?: Record<string, number>;
  sourceKind?: "realtime_transcription";
  transcription?: {
    providerSessionId: string;
    itemId: string;
    contentIndex: number;
    usage: { type: "duration"; seconds: number } | {
      type: "tokens";
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      input_token_details?: { audio_tokens?: number; text_tokens?: number };
    };
  };
}

/** Server-only supplier records. These are not customer charges. */
export class ProviderUsageRecordingRepository {
  constructor(private readonly database: Pick<Pool | PoolClient, "query">) {}

  async beginConnection(input: ProviderUsageRequest & { callSessionId?: string | null }): Promise<string> {
    const id = randomUUID();
    await this.database.query(`insert into provider_usage_connections
      (id, tenant_id, session_id, external_scope_id, provider, model, started_at, call_session_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, input.organizationId, input.sessionId, input.externalScopeId, input.provider, input.model, input.occurredAt, input.callSessionId ?? null]);
    return id;
  }

  async listTenantConnections(organizationId: string) {
    const result = await this.database.query(`select * from provider_usage_connections
      where tenant_id = $1 order by started_at, id`, [organizationId]);
    return result.rows.map(row => ({ id: row.id as string, sessionId: row.session_id as string | null,
      callSessionId: row.call_session_id as string | null,
      externalScopeId: row.external_scope_id as string | null, provider: row.provider as string, model: row.model as string,
      startedAt: new Date(row.started_at as string | Date).toISOString(), result: row.result as ProviderConnectionResult | null }));
  }

  async finishConnection(organizationId: string, id: string, result: ProviderConnectionResult) {
    const found = await this.database.query(`select started_at from provider_usage_connections
      where tenant_id = $1 and id = $2`, [organizationId, id]);
    if (!found.rows[0]) throw new Error("Provider connection not found.");
    if (!Number.isFinite(Date.parse(result.endedAt)) || Date.parse(result.endedAt) < new Date(found.rows[0].started_at).getTime()
      || !["closed", "failed"].includes(result.outcome)
      || (result.providerSessionId !== null && (typeof result.providerSessionId !== "string"
        || !result.providerSessionId.trim() || result.providerSessionId.length > 512))) {
      throw new Error("Invalid provider connection result.");
    }
    const safe = { endedAt: result.endedAt, outcome: result.outcome, providerSessionId: result.providerSessionId };
    const updated = await this.database.query(`update provider_usage_connections set result = $3
      where tenant_id = $1 and id = $2 and result is null returning id`, [organizationId, id, safe]);
    if (updated.rows.length > 0) return;
    const existing = await this.database.query(`select result from provider_usage_connections
      where tenant_id = $1 and id = $2`, [organizationId, id]);
    if (!isDeepStrictEqual(existing.rows[0]?.result, safe)) throw new Error("Provider connection result changed.");
  }

  /** Platform operator read only. Open records are unresolved, not assumed to be crashed. */
  async loadSharedConnectionCycle(input: { provider: string; externalScopeId: string;
    cycleStartsAt: string; cycleEndsAt: string }) {
    const start = Date.parse(input.cycleStartsAt);
    const end = Date.parse(input.cycleEndsAt);
    if (!input.provider.trim() || !input.externalScopeId.trim() || !Number.isFinite(start) || !Number.isFinite(end)
      || start >= end || start % 86_400_000 !== 0 || end % 86_400_000 !== 0) {
      throw new Error("Shared connection read requires scope and full UTC days.");
    }
    const result = await this.database.query(`select * from provider_usage_connections
      where provider = $1 and external_scope_id = $2 order by started_at, id`, [input.provider, input.externalScopeId]);
    const connections = result.rows.flatMap(row => {
      const startedAt = new Date(row.started_at as string | Date).toISOString();
      const terminal = row.result as ProviderConnectionResult | null;
      if (Date.parse(startedAt) >= end || (terminal !== null && Date.parse(terminal.endedAt) <= start && Date.parse(startedAt) < start)) return [];
      return [{ id: row.id as string, organizationId: row.tenant_id as string, sessionId: row.session_id as string | null,
        callSessionId: row.call_session_id as string | null,
        provider: input.provider, externalScopeId: input.externalScopeId, model: row.model as string, startedAt, result: terminal }];
    });
    // A clean socket close cannot prove all provider usage arrived or was reported.
    return { cycleStartsAt: input.cycleStartsAt, cycleEndsAt: input.cycleEndsAt, complete: false as const, connections };
  }

  async begin(input: ProviderUsageRequest): Promise<string> {
    const id = randomUUID();
    await this.database.query(`insert into provider_usage_requests
      (id, tenant_id, session_id, external_scope_id, provider, model, occurred_at)
      values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.organizationId, input.sessionId, input.externalScopeId, input.provider, input.model, input.occurredAt]);
    return id;
  }

  async beginObserved(input: ProviderUsageRequest & { connectionId?: string | null }, sourceRequestId: string,
    result?: Omit<ProviderUsageResult, "occurredAt">) {
    if (!sourceRequestId.trim()) throw new Error("Invalid observed provider usage request.");
    const initialResult = result === undefined ? null : { ...result, occurredAt: input.occurredAt };
    if (initialResult !== null) {
      validateUsageResult(initialResult);
      initialResult.occurredAt = new Date(input.occurredAt).toISOString();
    }
    if (input.connectionId != null) {
      const connection = (await this.database.query(`select tenant_id, session_id, external_scope_id, provider
        from provider_usage_connections where id = $1 and tenant_id = $2`, [input.connectionId, input.organizationId])).rows[0];
      if (!connection || connection.session_id !== input.sessionId
        || connection.external_scope_id !== input.externalScopeId || connection.provider !== input.provider) {
        throw new Error("Provider usage connection scope does not match.");
      }
    }
    const id = createHash("sha256").update(JSON.stringify([
      input.provider, input.externalScopeId, sourceRequestId,
    ])).digest("hex");
    const inserted = await this.database.query(`insert into provider_usage_requests
      (id, tenant_id, session_id, external_scope_id, provider, model, occurred_at, connection_id, result)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do nothing returning *`,
    [id, input.organizationId, input.sessionId, input.externalScopeId, input.provider, input.model, input.occurredAt, input.connectionId ?? null, initialResult]);
    const row = inserted.rows[0] ?? (await this.database.query(
      "select * from provider_usage_requests where id = $1", [id])).rows[0];
    if (row === undefined || row.tenant_id !== input.organizationId || row.session_id !== input.sessionId
      || row.connection_id !== (input.connectionId ?? null)
      || row.external_scope_id !== input.externalScopeId || row.provider !== input.provider || row.model !== input.model) {
      throw new Error("Provider usage request identity changed.");
    }
    const occurredAt = new Date(row.occurred_at as string | Date).toISOString();
    if (result !== undefined) {
      const finalResult = { ...result, occurredAt };
      if (row.result === null) await this.complete(input.organizationId, id, finalResult);
      else if (!isDeepStrictEqual(row.result, finalResult)) throw new Error("Provider usage result changed.");
    }
    return { id, occurredAt };
  }

  async complete(organizationId: string, id: string, result: ProviderUsageResult): Promise<void> {
    validateUsageResult(result);
    const updated = await this.database.query(`update provider_usage_requests set result = $3
      where tenant_id = $1 and id = $2 and result is null returning id`, [organizationId, id, result]);
    if (updated.rows.length > 0) return;
    const existing = await this.database.query(`select result from provider_usage_requests
      where tenant_id = $1 and id = $2`, [organizationId, id]);
    if (existing.rows.length === 0) throw new Error("Provider usage request not found.");
    if (!isDeepStrictEqual(existing.rows[0]?.result, result)) throw new Error("Provider usage result changed.");
  }

  async listTenantRequests(organizationId: string) {
    const result = await this.database.query(`select r.*, c.call_session_id
      from provider_usage_requests r left join provider_usage_connections c
        on c.id = r.connection_id and c.tenant_id = r.tenant_id
      where r.tenant_id = $1 order by r.occurred_at, r.id`, [organizationId]);
    return result.rows.map(row => ({ id: row.id as string, provider: row.provider as string, model: row.model as string,
      sessionId: row.session_id as string | null,
      connectionId: row.connection_id as string | null, callSessionId: row.call_session_id as string | null,
      externalScopeId: row.external_scope_id as string | null, result: row.result as ProviderUsageResult | null }));
  }

  /** Platform operator read only. Never expose this across a tenant HTTP route. */
  async loadSharedTranscriptionCycle(input: { externalScopeId: string;
    cycleStartsAt: string; cycleEndsAt: string }): Promise<OpenAiTranscriptionSnapshot> {
    const start = Date.parse(input.cycleStartsAt);
    const end = Date.parse(input.cycleEndsAt);
    if (!input.externalScopeId.trim() || !Number.isFinite(start) || !Number.isFinite(end)
      || start >= end || start % 86_400_000 !== 0 || end % 86_400_000 !== 0) {
      throw new Error("Shared transcription read requires a project and full UTC days.");
    }
    const result = await this.database.query(`select r.*, c.call_session_id from provider_usage_requests r
      left join provider_usage_connections c on c.id = r.connection_id and c.tenant_id = r.tenant_id
      where r.provider = $1 and r.external_scope_id = $2 order by r.occurred_at, r.id`, ["openai", input.externalScopeId]);
    const observations: OpenAiTranscriptionSnapshot["observations"] = [];
    let unresolvedRequestCount = 0;
    for (const row of result.rows) {
      const usage = row.result as ProviderUsageResult | null;
      const occurredAt = usage?.occurredAt ?? new Date(row.occurred_at as string | Date).toISOString();
      const time = Date.parse(occurredAt);
      if (time >= end) continue;
      // Unresolved OpenAI rows cannot yet be classified as completion or transcription.
      if (usage === null || (usage.sourceKind === "realtime_transcription" && !usage.transcription)) {
        unresolvedRequestCount += 1;
      } else if (time >= start && usage.sourceKind === "realtime_transcription" && usage.transcription) {
        observations.push({ id: row.id as string, organizationId: row.tenant_id as string,
          sessionId: row.session_id as string | null, connectionId: row.connection_id as string | null,
          callSessionId: row.call_session_id as string | null,
          projectId: input.externalScopeId, model: row.model as string, occurredAt, usage: usage.transcription.usage });
      }
    }
    return { cycleStartsAt: input.cycleStartsAt, cycleEndsAt: input.cycleEndsAt,
      complete: false, unresolvedRequestCount, observations };
  }

  /** Platform operator read only. Never expose this across a tenant HTTP route. */
  async loadSharedCycle(input: { provider: string; externalScopeId: string;
    cycleStartsAt: string; cycleEndsAt: string }): Promise<SharedProviderObservationSnapshot> {
    const start = Date.parse(input.cycleStartsAt);
    const end = Date.parse(input.cycleEndsAt);
    if (!input.provider.trim() || !input.externalScopeId.trim() || !Number.isFinite(start) || !Number.isFinite(end)
      || start >= end || start % 86_400_000 !== 0 || end % 86_400_000 !== 0) {
      throw new Error("Shared usage read requires scope and full UTC days.");
    }
    const result = await this.database.query(`select r.id, r.tenant_id, r.session_id, r.connection_id, r.model, r.occurred_at, r.result, c.call_session_id
      from provider_usage_requests r left join provider_usage_connections c on c.id = r.connection_id and c.tenant_id = r.tenant_id
      where r.provider = $1 and r.external_scope_id = $2`,
    [input.provider, input.externalScopeId]);
    let unresolvedRequestCount = 0;
    const unresolvedRequests: NonNullable<SharedProviderObservationSnapshot["unresolvedRequests"]> = [];
    const observations = result.rows.flatMap(row => {
      const usage = row.result as ProviderUsageResult | null;
      if (usage === null) {
        // Missing results have no known end time. Do not age them out at midnight.
        if (new Date(row.occurred_at as string | Date).getTime() < end) {
          unresolvedRequestCount += 1;
          unresolvedRequests.push({ id: row.id as string, organizationId: row.tenant_id as string,
            sessionId: row.session_id as string | null, connectionId: row.connection_id as string | null,
            callSessionId: row.call_session_id as string | null, model: row.model as string,
            occurredAt: new Date(row.occurred_at as string | Date).toISOString() });
        }
        return [];
      }
      // The current provider report contains completions, not transcription usage.
      if (usage.sourceKind === "realtime_transcription") return [];
      const time = Date.parse(usage.occurredAt);
      if (time < start || time >= end) return [];
      return [{ id: usage.providerRequestId, organizationId: row.tenant_id as string,
        sessionId: row.session_id as string | null, connectionId: row.connection_id as string | null,
        callSessionId: row.call_session_id as string | null,
        provider: input.provider, externalScopeId: input.externalScopeId,
        occurredAt: usage.occurredAt, totals: usage.totals }];
    });
    // Chat and Realtime response recording cannot prove coverage of all endpoints, costs,
    // or use outside Zara. Never turn a partial capture into release evidence.
    return { cycleStartsAt: input.cycleStartsAt, cycleEndsAt: input.cycleEndsAt, complete: false, unresolvedRequestCount, unresolvedRequests, observations };
  }
}

function validateUsageResult(result: ProviderUsageResult) {
  if (!result.providerRequestId.trim() || !Number.isFinite(Date.parse(result.occurredAt))
    || Object.keys(result.totals).length === 0
    || Object.values(result.totals).some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Invalid provider usage result.");
  }
}
