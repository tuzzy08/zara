import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  BillingCycleEvidenceInput,
  BillingReconciliationMeterKey,
  ExternalMeterEvidence,
  ProviderNativeReconciliation,
} from "./billing-usage-reconciliation.service";

type Queryable = Pick<Pool | PoolClient, "query">;

export interface PolarReconciliationClient {
  getMeterQuantity(input: {
    meterId: string;
    externalCustomerId: string;
    startTimestamp: string;
    endTimestamp: string;
  }): Promise<{ total: number }>;
  getCustomerMeterBalance(input: {
    meterId: string;
    externalCustomerId: string;
  }): Promise<{ balance: number } | null>;
  listCycleOrders(input: BillingCycleEvidenceInput): Promise<Array<{
    id: string;
    totalAmount: number;
    currency: string;
    createdAt: string;
  }>>;
}

interface PolarMappingReader {
  listPolarMappings(catalogId: string, environment: "sandbox" | "production"): Promise<Array<{
    mappingType: string;
    internalKey: string;
    providerId: string;
  }>>;
}

export interface BillingProviderEvidenceReport {
  provider: string;
  evidenceKind: "telephony_usage" | "runtime_usage";
  sourceReportId: string;
  payload: {
    quantities: Partial<Record<BillingReconciliationMeterKey, number>>;
    [key: string]: unknown;
  };
}

export interface BillingProviderEvidenceSource {
  collectCycle(input: BillingCycleEvidenceInput): Promise<BillingProviderEvidenceReport | null>;
}

export interface BillingProviderEvidenceReportWriter {
  appendProviderReport(input: BillingProviderEvidenceReport & BillingCycleEvidenceInput & {
    id: string;
    sourceHash: string;
    fetchedAt: string;
  }): Promise<void>;
}

export class BillingProviderEvidenceCollector {
  constructor(
    private readonly repository: BillingProviderEvidenceReportWriter,
    private readonly sources: BillingProviderEvidenceSource[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async collectTenantCycle(input: BillingCycleEvidenceInput) {
    let imported = 0;
    let failed = 0;
    for (const source of this.sources) {
      let report: BillingProviderEvidenceReport | null;
      try {
        report = await source.collectCycle(input);
      } catch {
        failed += 1;
        continue;
      }
      if (report === null) continue;
      const sourceHash = hashProviderReport(input, report);
      await this.repository.appendProviderReport({
        ...input,
        ...report,
        id: `provider_evidence_${sourceHash}`,
        sourceHash,
        fetchedAt: this.now(),
      });
      imported += 1;
    }
    return failed === 0 ? { imported } : { imported, failed };
  }
}

export class PostgresProviderEvidenceRepository implements BillingProviderEvidenceReportWriter {
  constructor(private readonly database: Queryable) {}

  async readProviderUsage(input: BillingCycleEvidenceInput): Promise<ExternalMeterEvidence | null> {
    const [result, scopeResult] = await Promise.all([this.database.query(
      `select id, provider, evidence_kind, source_report_id, source_hash,
              cycle_starts_at, cycle_ends_at, fetched_at, payload
         from billing_provider_evidence_reports
        where tenant_id = $1
          and catalog_id = $2
          and cycle_starts_at = $3::timestamptz
          and cycle_ends_at = $4::timestamptz
        order by provider, source_report_id`,
      [input.organizationId, input.catalogId, input.cycleStartsAt, input.cycleEndsAt],
    ), this.database.query(
      `select provider
         from billing_provider_tenant_scopes
        where tenant_id = $1
          and effective_from <= $2::timestamptz
          and (effective_until is null or effective_until >= $3::timestamptz)
        order by provider`,
      [input.organizationId, input.cycleStartsAt, input.cycleEndsAt],
    )]);
    if (result.rows.length === 0) return null;
    const quantities: Partial<Record<BillingReconciliationMeterKey, number>> = {};
    const sourceIds: string[] = [];
    const fetchedTimes: number[] = [];
    const meterSessionIds = new Map<BillingReconciliationMeterKey, Set<string>>();
    const providerNative: ProviderNativeReconciliation[] = [];
    for (const row of result.rows) {
      const report = reportFromRow(row);
      const expectedHash = hashProviderReport(input, report);
      if (expectedHash !== row.source_hash) {
        throw new Error("Provider evidence report hash does not match its source facts.");
      }
      sourceIds.push(`${report.provider}/${report.sourceReportId}`);
      fetchedTimes.push(timestampMs(row.fetched_at, "fetch time"));
      const reportSessionIds = providerSessionIds(report.payload);
      if (isNativeProvider(report.provider)) {
        providerNative.push(reconcileProviderNativeReport(input, report));
      }
      for (const [key, value] of Object.entries(report.payload.quantities)) {
        if (!isMeterKey(key)) throw new Error("Provider evidence contains an unknown meter.");
        const priorSessionIds = meterSessionIds.get(key);
        if (priorSessionIds !== undefined && (priorSessionIds.size === 0 || reportSessionIds.length === 0)) {
          throw new Error("Provider evidence cannot prove unique provider sessions.");
        }
        const nextSessionIds = priorSessionIds ?? new Set<string>();
        for (const sessionId of reportSessionIds) {
          if (nextSessionIds.has(sessionId)) {
            throw new Error("Provider evidence contains a duplicate provider session.");
          }
          nextSessionIds.add(sessionId);
        }
        meterSessionIds.set(key, nextSessionIds);
        quantities[key] = (quantities[key] ?? 0) + integer(value);
      }
    }
    const fetchedAt = new Date(Math.min(...fetchedTimes)).toISOString();
    return scopedMeterEvidence(
      input,
      `provider-reports:${sourceIds.join(",")}`,
      fetchedAt,
      quantities,
      result.rows,
      undefined,
      providerNative,
      [...new Set(scopeResult.rows
        .map((row) => String(row.provider))
        .filter(isNativeProvider))],
    );
  }

  async appendProviderReport(
    input: BillingProviderEvidenceReport & BillingCycleEvidenceInput & {
      id: string;
      sourceHash: string;
      fetchedAt: string;
    },
  ) {
    const inserted = await this.database.query(
       `insert into billing_provider_evidence_reports (
         tenant_id, id, catalog_id, provider, evidence_kind, source_report_id, source_hash,
         cycle_starts_at, cycle_ends_at, fetched_at, payload, created_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$10)
       on conflict (tenant_id, catalog_id, cycle_starts_at, cycle_ends_at, provider, source_report_id)
       do nothing`,
      [
        input.organizationId,
        input.id,
        input.catalogId,
        input.provider,
        input.evidenceKind,
        input.sourceReportId,
        input.sourceHash,
        input.cycleStartsAt,
        input.cycleEndsAt,
        input.fetchedAt,
        JSON.stringify(input.payload),
      ],
    );
    if (inserted.rowCount === 0) {
      const existing = await this.database.query(
        `select source_hash
           from billing_provider_evidence_reports
          where tenant_id = $1
            and catalog_id = $2
            and cycle_starts_at = $3::timestamptz
            and cycle_ends_at = $4::timestamptz
            and provider = $5
            and source_report_id = $6`,
        [
          input.organizationId,
          input.catalogId,
          input.cycleStartsAt,
          input.cycleEndsAt,
          input.provider,
          input.sourceReportId,
        ],
      );
      if (existing.rows[0]?.source_hash !== input.sourceHash) {
        throw new Error("Provider evidence report ID was reused with different source facts.");
      }
    }
  }
}

function providerSessionIds(payload: BillingProviderEvidenceReport["payload"]): string[] {
  if (!Array.isArray(payload.facts)) return [];
  return payload.facts.map((fact) => requiredText(record(fact).id, "provider session ID"));
}

export function reconcileProviderNativeReport(
  input: BillingCycleEvidenceInput,
  report: BillingProviderEvidenceReport,
): ProviderNativeReconciliation {
  const forbiddenQuantity = Object.keys(report.payload.quantities).length > 0;
  const facts = Array.isArray(report.payload.facts) ? report.payload.facts : [];
  if (facts.length === 0) return nativeMismatch(input, report, "", [
    ...(forbiddenQuantity ? ["provider_native_zara_quantity_forbidden"] : []),
    "provider_facts_missing",
  ]);
  const result = report.provider === "cartesia"
    ? reconcileCartesia(input, report, facts)
    : report.provider === "openai"
      ? reconcileOpenAi(input, report, facts)
      : report.provider === "gemini"
        ? reconcileGemini(input, report, facts)
        : nativeMismatch(input, report, "", ["provider_native_contract_unsupported"]);
  if (!forbiddenQuantity) return result;
  return { ...result, status: "mismatch", issues: ["provider_native_zara_quantity_forbidden", ...result.issues] };
}

function reconcileCartesia(
  input: BillingCycleEvidenceInput,
  report: BillingProviderEvidenceReport,
  facts: unknown[],
): ProviderNativeReconciliation {
  const source = safeRecord(report.payload.source);
  const scopeId = text(source.apiKeyId);
  const issues: string[] = [];
  if (!isUtcDay(input.cycleStartsAt) || !isUtcDay(input.cycleEndsAt)) {
    issues.push("provider_cycle_not_full_utc_days");
  }
  let credits = 0;
  if (facts.length !== 1) issues.push("provider_fact_count_invalid");
  for (const raw of facts) {
    const fact = safeRecord(raw);
    if (text(fact.apiKeyId) !== scopeId || scopeId === "") issues.push("provider_fact_scope_mismatch");
    if (fact.cycleStartsAt !== input.cycleStartsAt || fact.cycleEndsAt !== input.cycleEndsAt) {
      issues.push("provider_fact_cycle_mismatch");
    }
    const value = nonnegativeIntegerOrNull(fact.credits);
    if (value === null) issues.push("provider_fact_total_invalid");
    else credits += value;
  }
  return nativeResult(input, report, scopeId, { credits }, issues, facts.length);
}

function reconcileOpenAi(
  input: BillingCycleEvidenceInput,
  report: BillingProviderEvidenceReport,
  facts: unknown[],
): ProviderNativeReconciliation {
  const scopeId = text(report.payload.projectId);
  const issues: string[] = [];
  const totals = { inputTokens: 0, outputTokens: 0, requestCount: 0, cost: 0 };
  let currency = "";
  for (const raw of facts) {
    const fact = safeRecord(raw);
    if (text(fact.projectId) !== scopeId || scopeId === "") issues.push("provider_fact_scope_mismatch");
    if (!withinCycle(fact.bucketStartsAt, fact.bucketEndsAt, input)) {
      issues.push("provider_fact_cycle_mismatch");
    }
    if (fact.kind === "usage") {
      const values = [fact.inputTokens, fact.outputTokens, fact.requestCount]
        .map(nonnegativeIntegerOrNull);
      if (values.some((value) => value === null)) issues.push("provider_fact_total_invalid");
      else {
        totals.inputTokens += values[0]!;
        totals.outputTokens += values[1]!;
        totals.requestCount += values[2]!;
      }
    } else if (fact.kind === "cost") {
      const amount = nonnegativeNumberOrNull(fact.amount);
      const factCurrency = text(fact.currency).toLowerCase();
      if (amount === null || factCurrency === "") issues.push("provider_fact_total_invalid");
      else {
        if (currency !== "" && currency !== factCurrency) issues.push("provider_fact_currency_mismatch");
        currency = factCurrency;
        totals.cost += amount;
      }
    } else issues.push("provider_fact_kind_invalid");
  }
  return nativeResult(input, report, scopeId, totals, issues, facts.length);
}

function reconcileGemini(
  input: BillingCycleEvidenceInput,
  report: BillingProviderEvidenceReport,
  facts: unknown[],
): ProviderNativeReconciliation {
  const source = safeRecord(report.payload.source);
  const mappingId = text(source.mappingId);
  const firstProject = text(safeRecord(facts[0]).projectId);
  const scopeId = `${mappingId}/${firstProject}`;
  const issues: string[] = [];
  let costMicros = 0;
  let currency = "";
  for (const raw of facts) {
    const fact = safeRecord(raw);
    if (mappingId === "" || firstProject === "" || text(fact.projectId) !== firstProject) {
      issues.push("provider_fact_scope_mismatch");
    }
    const overlaps = overlapsCycle(fact.usageStartTime, fact.usageEndTime, input);
    const contained = withinCycle(fact.usageStartTime, fact.usageEndTime, input);
    if (!overlaps) {
      issues.push("provider_fact_cycle_mismatch");
    }
    if ((overlaps && !contained) || fact.allocationStatus === "boundary_overlap") {
      issues.push("provider_fact_cycle_overlap");
    }
    const value = integerOrNull(fact.costMicros);
    const factCurrency = text(fact.currency).toLowerCase();
    if (value === null || factCurrency === "") issues.push("provider_fact_total_invalid");
    else {
      if (currency !== "" && currency !== factCurrency) issues.push("provider_fact_currency_mismatch");
      currency = factCurrency;
      costMicros += value;
    }
  }
  return nativeResult(input, report, scopeId, { costMicros }, issues, facts.length);
}

function nativeResult(
  input: BillingCycleEvidenceInput,
  report: BillingProviderEvidenceReport,
  scopeId: string,
  totals: Record<string, number>,
  issues: string[],
  factCount: number,
): ProviderNativeReconciliation {
  const uniqueIssues = [...new Set(issues)];
  return {
    provider: report.provider,
    sourceReportId: report.sourceReportId,
    status: uniqueIssues.length === 0 ? "matched" : "mismatch",
    factCount,
    scopeId,
    coverageStartsAt: input.cycleStartsAt,
    coverageEndsAt: input.cycleEndsAt,
    totals,
    issues: uniqueIssues,
  };
}

function nativeMismatch(
  input: BillingCycleEvidenceInput,
  report: BillingProviderEvidenceReport,
  scopeId: string,
  issues: string[],
) {
  return nativeResult(input, report, scopeId, {}, issues, 0);
}

function isNativeProvider(provider: string) {
  return provider === "cartesia" || provider === "openai" || provider === "gemini";
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nonnegativeIntegerOrNull(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function integerOrNull(value: unknown) {
  return Number.isSafeInteger(value) ? Number(value) : null;
}

function nonnegativeNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function withinCycle(start: unknown, end: unknown, input: BillingCycleEvidenceInput) {
  const startAt = Date.parse(String(start));
  const endAt = Date.parse(String(end));
  return Number.isFinite(startAt) && Number.isFinite(endAt) && startAt < endAt
    && startAt >= Date.parse(input.cycleStartsAt) && endAt <= Date.parse(input.cycleEndsAt);
}

function overlapsCycle(start: unknown, end: unknown, input: BillingCycleEvidenceInput) {
  const startAt = Date.parse(String(start));
  const endAt = Date.parse(String(end));
  return Number.isFinite(startAt) && Number.isFinite(endAt) && startAt < endAt
    && startAt < Date.parse(input.cycleEndsAt) && endAt > Date.parse(input.cycleStartsAt);
}

function isUtcDay(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().endsWith("T00:00:00.000Z");
}

export class PolarBillingReconciliationReader {
  constructor(
    private readonly polar: PolarReconciliationClient,
    private readonly mappings: PolarMappingReader,
    private readonly environment: "sandbox" | "production",
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async readPolarMeters(input: BillingCycleEvidenceInput): Promise<ExternalMeterEvidence | null> {
    const mappings = (await this.mappings.listPolarMappings(input.catalogId, this.environment))
      .filter((mapping) => mapping.mappingType === "meter" && isMeterKey(mapping.internalKey));
    if (mappings.length === 0) return null;
    const quantities: Partial<Record<BillingReconciliationMeterKey, number>> = {};
    for (const mapping of mappings) {
      const quantity = await this.polar.getMeterQuantity({
        meterId: mapping.providerId,
        externalCustomerId: input.organizationId,
        startTimestamp: input.cycleStartsAt,
        endTimestamp: input.cycleEndsAt,
      });
      quantities[mapping.internalKey as BillingReconciliationMeterKey] = integer(quantity.total);
    }
    const paygMapping = mappings.find((mapping) => mapping.internalKey === "payg_charge_minor");
    const paygBalance = paygMapping === undefined
      ? null
      : await this.polar.getCustomerMeterBalance({
        meterId: paygMapping.providerId,
        externalCustomerId: input.organizationId,
      });
    return scopedMeterEvidence(
      input,
      "polar:meters.quantities",
      this.now(),
      quantities,
      { mappings, paygBalance },
      paygBalance === null ? undefined : integer(paygBalance.balance),
    );
  }

  async readDraftInvoice(input: BillingCycleEvidenceInput) {
    const orders = await this.polar.listCycleOrders(input);
    if (orders.length === 0) return null;
    const currencies = new Set(orders.map((order) => order.currency));
    if (currencies.size !== 1) throw new Error("Polar cycle orders use mixed currencies.");
    const fetchedAt = this.now();
    return {
      evidenceId: evidenceId("polar_invoice", input, orders),
      sourceId: "polar:orders.list",
      fetchedAt,
      ...input,
      amountMinor: orders.reduce((total, order) => total + integer(order.totalAmount), 0),
      currency: orders[0]!.currency,
    };
  }
}

function scopedMeterEvidence(
  input: BillingCycleEvidenceInput,
  sourceId: string,
  fetchedAt: string,
  quantities: Partial<Record<BillingReconciliationMeterKey, number>>,
  source: unknown,
  polarBalanceMinor?: number,
  providerNative?: ProviderNativeReconciliation[],
  requiredNativeProviders?: string[],
): ExternalMeterEvidence {
  return {
    evidenceId: evidenceId(
      sourceId.startsWith("provider-reports:") ? "provider_usage" : "polar_meter",
      input,
      source,
    ),
    sourceId,
    fetchedAt,
    ...input,
    quantities,
    ...(polarBalanceMinor === undefined ? {} : { polarBalanceMinor }),
    ...(providerNative === undefined || providerNative.length === 0 ? {} : { providerNative }),
    ...(requiredNativeProviders === undefined || requiredNativeProviders.length === 0
      ? {}
      : { requiredNativeProviders }),
  };
}

function evidenceId(prefix: string, input: BillingCycleEvidenceInput, source: unknown) {
  return `${prefix}_${createHash("sha256").update(JSON.stringify({ input, source })).digest("hex")}`;
}

function reportFromRow(row: QueryResultRow): BillingProviderEvidenceReport {
  const payload = record(row.payload);
  const rawQuantities = record(payload.quantities);
  const quantities: Partial<Record<BillingReconciliationMeterKey, number>> = {};
  for (const [key, value] of Object.entries(rawQuantities)) {
    if (!isMeterKey(key)) throw new Error("Provider evidence contains an unknown meter.");
    quantities[key] = integer(value);
  }
  const evidenceKind = String(row.evidence_kind);
  if (evidenceKind !== "telephony_usage" && evidenceKind !== "runtime_usage") {
    throw new Error("Provider evidence kind is invalid.");
  }
  const allowedKeys = evidenceKind === "telephony_usage"
    ? new Set<BillingReconciliationMeterKey>(["platform_telephony_charge_minor"])
    : new Set<BillingReconciliationMeterKey>([
      "standard_runtime_seconds",
      "premium_runtime_seconds",
    ]);
  if (Object.keys(quantities).some((key) => !allowedKeys.has(key as BillingReconciliationMeterKey))) {
    throw new Error("Provider evidence meter does not match its evidence kind.");
  }
  return {
    provider: requiredText(row.provider, "provider"),
    evidenceKind,
    sourceReportId: requiredText(row.source_report_id, "source report ID"),
    payload: { ...payload, quantities },
  };
}

function hashProviderReport(
  input: BillingCycleEvidenceInput,
  report: BillingProviderEvidenceReport,
) {
  return createHash("sha256").update(stableJson({
    organizationId: input.organizationId,
    cycleStartsAt: input.cycleStartsAt,
    cycleEndsAt: input.cycleEndsAt,
    provider: report.provider,
    evidenceKind: report.evidenceKind,
    sourceReportId: report.sourceReportId,
    payload: report.payload,
  })).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Provider evidence ${field} is invalid.`);
  }
  return value;
}

function timestampMs(value: unknown, field: string) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`Provider evidence ${field} is invalid.`);
  return parsed;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provider usage evidence is invalid.");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error("Reconciliation quantity must be a non-negative integer.");
  }
  return normalized;
}

function isMeterKey(value: string): value is BillingReconciliationMeterKey {
  return value === "standard_runtime_seconds"
    || value === "premium_runtime_seconds"
    || value === "platform_telephony_charge_minor"
    || value === "payg_charge_minor";
}
