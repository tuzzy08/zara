import type { BillingProviderEvidenceReport } from "./billing-production-reconciliation-evidence";

export interface SharedProviderObservationSnapshot {
  cycleStartsAt: string;
  cycleEndsAt: string;
  complete: boolean;
  unresolvedRequestCount: number;
  observations: Array<{
    id: string;
    organizationId: string;
    sessionId?: string | null;
    connectionId?: string | null;
    callSessionId?: string | null;
    externalScopeId: string;
    provider: string;
    occurredAt: string;
    totals: Record<string, number>;
  }>;
}

// This comparison result is not a charge-release approval. The caller must supply
// server-owned observations, not a tenant upload or a reconstructed customer ledger.
export function compareSharedProviderUsage(input: {
  cycleStartsAt: string;
  cycleEndsAt: string;
  externalScopeId: string;
  report: BillingProviderEvidenceReport;
}, snapshot: SharedProviderObservationSnapshot | null) {
  const providerTotals: Record<string, number> = {};
  const zaraTotals: Record<string, number> = {};
  const base = { scope: "platform" as const, provider: input.report.provider,
    externalScopeId: input.externalScopeId, providerTotals, zaraTotals };
  const cycleStart = Date.parse(input.cycleStartsAt);
  const cycleEnd = Date.parse(input.cycleEndsAt);
  if (!Number.isFinite(cycleStart) || !Number.isFinite(cycleEnd) || cycleStart >= cycleEnd
    || cycleStart % 86_400_000 !== 0 || cycleEnd % 86_400_000 !== 0) {
    return { ...base, status: "incomplete", issues: ["comparison_period_invalid"] };
  }
  const issues: string[] = [];
  if (snapshot === null || !snapshot.complete || snapshot.cycleStartsAt !== input.cycleStartsAt
    || snapshot.cycleEndsAt !== input.cycleEndsAt) {
    issues.push("observation_coverage_missing");
  }
  if (snapshot && snapshot.unresolvedRequestCount !== 0) issues.push("observation_unresolved");
  if (issues.length > 0) return { ...base, status: "incomplete", issues };
  if (input.report.provider !== "cartesia" && input.report.provider !== "openai") {
    return { ...base, status: "incomplete", issues: ["provider_unsupported"] };
  }
  if (!input.report.sourceReportId.trim() || !input.externalScopeId.trim()) issues.push("provider_identity_missing");
  const payload = input.report.payload;
  const facts = Array.isArray(payload.facts) ? payload.facts.map(record) : [];
  if (facts.length === 0) return { ...base, status: "incomplete", issues: ["provider_facts_missing"] };
  if (input.report.provider === "cartesia" && facts.length !== 1) issues.push("provider_fact_count_invalid");
  const providerScope = input.report.provider === "cartesia" ? record(payload.source).apiKeyId : payload.projectId;
  if (payload.scope !== "platform" || providerScope !== input.externalScopeId) issues.push("provider_scope_mismatch");
  if (Object.keys(payload.quantities).length > 0) issues.push("provider_customer_quantity_forbidden");
  const factIds = new Set<unknown>();
  for (const fact of facts) {
    if (typeof fact.id !== "string" || !fact.id.trim()) issues.push("provider_identity_missing");
    if (factIds.has(fact.id)) issues.push("provider_fact_duplicate");
    factIds.add(fact.id);
    if ((input.report.provider === "cartesia" ? fact.apiKeyId : fact.projectId) !== input.externalScopeId) {
      issues.push("provider_scope_mismatch");
    }
    const cartesia = input.report.provider === "cartesia";
    const start = Date.parse(String(cartesia ? fact.cycleStartsAt : fact.bucketStartsAt));
    const end = Date.parse(String(cartesia ? fact.cycleEndsAt : fact.bucketEndsAt));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end
      || start < Date.parse(input.cycleStartsAt) || end > Date.parse(input.cycleEndsAt)
      || (cartesia && (start !== Date.parse(input.cycleStartsAt) || end !== Date.parse(input.cycleEndsAt)))) {
      issues.push("provider_period_mismatch");
    }
    if (input.report.provider === "openai" && fact.kind === "cost") {
      const currency = typeof fact.currency === "string" ? fact.currency.toLowerCase() : "";
      const micros = typeof fact.amount === "number" ? fact.amount * 1_000_000 : NaN;
      if (!/^[a-z]{3}$/.test(currency) || !Number.isSafeInteger(micros) || micros < 0) {
        issues.push("provider_quantity_invalid");
      } else {
        const unit = `costMicros:${currency}`;
        providerTotals[unit] = (providerTotals[unit] ?? 0) + micros;
      }
      continue;
    }
    const units = input.report.provider === "cartesia" ? ["credits"]
      : ["inputTokens", "outputTokens", "requestCount"];
    for (const unit of units) {
      const value = fact[unit];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        issues.push("provider_quantity_invalid");
        continue;
      }
      providerTotals[unit] = (providerTotals[unit] ?? 0) + value;
    }
  }
  const ids = new Set<string>();
  for (const observation of snapshot?.observations ?? []) {
    if (observation.provider !== input.report.provider || observation.externalScopeId !== input.externalScopeId) {
      issues.push("observation_scope_mismatch");
    }
    if (!observation.id.trim() || !observation.organizationId.trim()) issues.push("observation_identity_missing");
    if (ids.has(observation.id)) issues.push("observation_duplicate");
    ids.add(observation.id);
    const time = Date.parse(observation.occurredAt);
    if (!Number.isFinite(time) || time < Date.parse(input.cycleStartsAt) || time >= Date.parse(input.cycleEndsAt)) {
      issues.push("observation_period_mismatch");
    }
    for (const [unit, value] of Object.entries(observation.totals)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        issues.push("observation_quantity_invalid");
        continue;
      }
      zaraTotals[unit] = (zaraTotals[unit] ?? 0) + value;
    }
  }
  for (const unit of new Set([...Object.keys(providerTotals), ...Object.keys(zaraTotals)])) {
    if (providerTotals[unit] !== zaraTotals[unit]) issues.push(`quantity_mismatch:${unit}`);
  }
  return { ...base, status: issues.length === 0 ? "matched" : "mismatch", issues: [...new Set(issues)] };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
