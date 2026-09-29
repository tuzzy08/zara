import type { OpenAiOrganizationTranscriptionFact } from "./openai-organization-billing.client";
import type { ProviderUsageResult } from "./provider-usage-recording.repository";

export interface OpenAiTranscriptionSnapshot {
  cycleStartsAt: string;
  cycleEndsAt: string;
  complete: boolean;
  unresolvedRequestCount: number;
  observations: Array<{
    id: string; organizationId: string; projectId: string; model: string; occurredAt: string;
    sessionId?: string | null; connectionId?: string | null; callSessionId?: string | null;
    usage: NonNullable<ProviderUsageResult["transcription"]>["usage"];
  }>;
}

/** Platform supplier comparison only. A match is not a charge-release approval. */
export function compareOpenAiTranscriptionUsage(input: {
  cycleStartsAt: string; cycleEndsAt: string; projectId: string; facts: OpenAiOrganizationTranscriptionFact[];
}, snapshot: OpenAiTranscriptionSnapshot | null) {
  const issues: string[] = [];
  const dayMs = 86_400_000;
  const start = Date.parse(input.cycleStartsAt);
  const end = Date.parse(input.cycleEndsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start % dayMs !== 0 || end % dayMs !== 0) {
    issues.push("comparison_period_invalid");
  }
  if (!snapshot?.complete || snapshot.cycleStartsAt !== input.cycleStartsAt || snapshot.cycleEndsAt !== input.cycleEndsAt) {
    issues.push("observation_coverage_missing");
  }
  if (input.facts.length === 0) issues.push("provider_facts_missing");
  if (snapshot && snapshot.unresolvedRequestCount !== 0) issues.push("observation_unresolved");
  const totals = new Map<string, { model: string | null; bucketStartsAt: string;
    providerSeconds: number[]; observedSeconds: number[]; providerRequests: number; observedRequests: number;
    unknownSeconds: boolean }>();
  function group(model: string | null, bucketStartsAt: string) {
    const key = JSON.stringify([model, bucketStartsAt]);
    let value = totals.get(key);
    if (!value) {
      value = { model, bucketStartsAt, providerSeconds: [], observedSeconds: [], providerRequests: 0, observedRequests: 0,
        unknownSeconds: snapshot === null };
      totals.set(key, value);
    }
    return value;
  }
  const factIds = new Set<string>();
  for (const fact of input.facts) {
    if (!input.projectId.trim() || fact.projectId !== input.projectId) issues.push("provider_scope_mismatch");
    if (!fact.model?.trim()) issues.push("provider_model_missing");
    const bucketStart = Date.parse(fact.bucketStartsAt);
    const bucketEnd = Date.parse(fact.bucketEndsAt);
    if (!Number.isFinite(bucketStart) || !Number.isFinite(bucketEnd) || bucketStart % dayMs !== 0
      || bucketEnd - bucketStart !== dayMs || bucketStart < start || bucketEnd > end) {
      issues.push("provider_period_mismatch");
      continue;
    }
    const id = JSON.stringify([fact.model, bucketStart]);
    if (factIds.has(id)) issues.push("provider_fact_duplicate");
    factIds.add(id);
    if (!validSeconds(fact.seconds) || !Number.isSafeInteger(fact.requestCount) || fact.requestCount < 0) {
      issues.push("provider_quantity_invalid");
      continue;
    }
    const value = group(fact.model, new Date(bucketStart).toISOString());
    value.providerSeconds.push(fact.seconds);
    value.providerRequests += fact.requestCount;
  }
  const observationIds = new Set<string>();
  for (const observation of snapshot?.observations ?? []) {
    if (observation.projectId !== input.projectId) issues.push("observation_scope_mismatch");
    if (!observation.id.trim() || !observation.organizationId.trim() || !observation.model.trim()) {
      issues.push("observation_identity_missing");
    }
    if (observationIds.has(observation.id)) issues.push("observation_duplicate");
    observationIds.add(observation.id);
    const time = Date.parse(observation.occurredAt);
    if (!Number.isFinite(time) || time < start || time >= end) {
      issues.push("observation_period_mismatch");
      continue;
    }
    const day = new Date(Math.floor(time / dayMs) * dayMs).toISOString();
    const value = group(observation.model, day);
    if (observation.usage.type === "duration") {
      if (validSeconds(observation.usage.seconds)) value.observedSeconds.push(observation.usage.seconds);
      else { issues.push("observation_quantity_invalid"); value.unknownSeconds = true; }
    }
    else { issues.push("transcription_unit_unsupported"); value.unknownSeconds = true; }
    value.observedRequests += 1;
  }
  const groups = [...totals.values()].map(({ unknownSeconds, ...value }) => ({ ...value,
    providerSeconds: sumSeconds(value.providerSeconds), observedSeconds: unknownSeconds ? null : sumSeconds(value.observedSeconds),
    observedRequests: snapshot === null ? null : value.observedRequests }));
  const incomplete = issues.length > 0;
  if (groups.some(value => (value.observedSeconds !== null && value.providerSeconds !== value.observedSeconds)
    || (value.observedRequests !== null && value.providerRequests !== value.observedRequests))) issues.push("quantity_mismatch");
  return { scope: "platform" as const, provider: "openai" as const, sourceKind: "audio_transcriptions" as const,
    projectId: input.projectId, status: incomplete ? "incomplete" : issues.length ? "mismatch" : "matched",
    issues: [...new Set(issues)], groups };
}

function validSeconds(value: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// Add the decimal values received in JSON, not their binary floating-point sums.
function sumSeconds(values: number[]) {
  const parts = values.map(value => {
    const [mantissa = "0", exponent = "0"] = String(value).split("e");
    const scale = (mantissa.split(".")[1]?.length ?? 0) - Number(exponent);
    return { coefficient: BigInt(mantissa.replace(".", "")), scale };
  });
  const scale = parts.reduce((maximum, part) => Math.max(maximum, part.scale), 0);
  const sum = parts.reduce((total, part) => total + part.coefficient * 10n ** BigInt(scale - part.scale), 0n);
  if (scale === 0) return String(sum);
  const digits = String(sum).padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, "");
}
