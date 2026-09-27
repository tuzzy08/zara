import type { Pool, PoolClient } from "pg";

export class TenantSessionBillingAudit {
  constructor(private readonly database: Pick<Pool | PoolClient, "query">) {}

  async auditCycle(input: { organizationId: string; cycleStartsAt: string; cycleEndsAt: string }) {
    const start = Date.parse(input.cycleStartsAt);
    const end = Date.parse(input.cycleEndsAt);
    if (!input.organizationId.trim() || !Number.isFinite(start) || !Number.isFinite(end)
      || start >= end || start % 86_400_000 !== 0 || end % 86_400_000 !== 0) {
      throw new Error("Invalid tenant audit period.");
    }
    const parameters = [input.organizationId, input.cycleStartsAt, input.cycleEndsAt];
    const sessions = await this.database.query(
      `select s.call_session_id, s.lifecycle_state, d.runtime_path
         from telephony_execution_sessions s
         left join telephony_dispatches d on d.tenant_id = s.tenant_id and d.id = s.dispatch_id
        where s.tenant_id = $1
          and (s.lifecycle_state ->> 'observedAt')::timestamptz >= $2::timestamptz
          and (s.lifecycle_state ->> 'observedAt')::timestamptz < $3::timestamptz
          and s.lifecycle_state ->> 'stage' in ('completed', 'failed', 'expired')`, parameters);
    const ledger = await this.database.query(
      `select id, quantity, unit, metadata
         from billing_ledger_entries
        where tenant_id = $1 and entry_type = 'runtime_charge'
          and occurred_at >= $2::timestamptz and occurred_at < $3::timestamptz
          and coalesce(metadata ->> 'source', '') <> 'browser_sandbox'`, parameters);
    const durations = sessions.rows.map((row) => duration(row.lifecycle_state));
    const runtimeSeconds = durations.includes(null) ? null
      : durations.reduce<number>((total, value) => total + value!, 0);
    const ledgerSeconds = ledger.rows.reduce((total, row) => total + Number(row.quantity), 0);
    const issues: string[] = [];
    if (sessions.rows.length === 0 && ledger.rows.length === 0) issues.push("no_session_evidence");
    if (runtimeSeconds === null) issues.push("session_duration_missing");
    for (const session of sessions.rows) {
      const entries = ledger.rows.filter((entry) => entry.metadata.callSessionId === session.call_session_id);
      if (entries.length === 0) {
        issues.push("session_ledger_missing");
      }
      if (entries.length > 1) issues.push("session_ledger_duplicate");
      const seconds = duration(session.lifecycle_state);
      if (seconds !== null && entries.some((entry) => Number(entry.quantity) !== seconds)) issues.push("runtime_quantity_mismatch");
      const meter = session.runtime_path === "pstn-sandwich" ? "standard_runtime_seconds"
        : session.runtime_path === "pstn-premium-realtime" ? "premium_runtime_seconds" : null;
      if (meter === null || entries.some((entry) => entry.unit !== "second" || entry.metadata.billingClass !== meter)) {
        issues.push("runtime_meter_mismatch");
      }
    }
    for (const entry of ledger.rows) {
      if (!sessions.rows.some((session) => session.call_session_id === entry.metadata?.callSessionId)) {
        issues.push("ledger_session_missing");
      }
    }
    if (runtimeSeconds !== null && runtimeSeconds !== ledgerSeconds) issues.push("runtime_quantity_mismatch");
    return { ...input, status: issues.includes("no_session_evidence") || runtimeSeconds === null
      ? "incomplete" : issues.length === 0 ? "matched" : "mismatch",
      sessionCount: sessions.rows.length, runtimeSeconds, ledgerSeconds,
      issues: [...new Set(issues)] };
  }
}

function duration(state: { stage?: string; observedAt?: string; providerConnectedAt?: string }) {
  const start = Date.parse(state.providerConnectedAt ?? "");
  const end = Date.parse(state.observedAt ?? "");
  if (state.providerConnectedAt === undefined && Number.isFinite(end)
    && (state.stage === "failed" || state.stage === "expired")) return 0;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.floor((end - start) / 1000) : null;
}
