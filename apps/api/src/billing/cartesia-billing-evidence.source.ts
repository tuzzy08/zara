import { createHash } from "node:crypto";

import type {
  BillingProviderEvidenceReport,
  BillingProviderEvidenceSource,
} from "./billing-production-reconciliation-evidence";
import type { BillingCycleEvidenceInput } from "./billing-usage-reconciliation.service";

const CARTESIA_API_VERSION = "2026-03-01";
const CARTESIA_API_ORIGIN = "https://api.cartesia.ai";
const MAX_USAGE_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;

type CartesiaFetch = (
  input: string,
  init: { method: "GET"; headers: Record<string, string> },
) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

export interface CartesiaAdminUsageApi {
  getApiKey(apiKeyId: string): Promise<{ id: string }>;
  getCreditUsage(input: {
    apiKeyId: string;
    startTimestamp: string;
    endTimestamp: string;
  }): Promise<unknown>;
}

export interface CartesiaTenantUsageScopeReader {
  readDurableTenantApiKeyScope(input: BillingCycleEvidenceInput): Promise<{
    apiKeyId: string;
    mappingId: string;
  } | null>;
}

export class CartesiaAdminUsageClient implements CartesiaAdminUsageApi {
  private readonly adminApiKey: string;
  private readonly fetchImplementation: CartesiaFetch;

  constructor(input: {
    adminApiKey: string;
    fetchImplementation?: CartesiaFetch;
  }) {
    this.adminApiKey = requiredText(input.adminApiKey, "admin API key");
    this.fetchImplementation = input.fetchImplementation ?? fetch;
  }

  async getApiKey(apiKeyId: string): Promise<{ id: string }> {
    const response = await this.fetchImplementation(
      `${CARTESIA_API_ORIGIN}/api-keys/${encodeURIComponent(requiredText(apiKeyId, "API key ID"))}`,
      this.request(),
    );
    if (!response.ok) {
      throw new Error(`Cartesia API key scope request failed (${response.status ?? "unknown"}).`);
    }
    return parseApiKey(await response.json());
  }

  async getCreditUsage(input: {
    apiKeyId: string;
    startTimestamp: string;
    endTimestamp: string;
  }): Promise<unknown> {
    const url = new URL("/usage/credits", CARTESIA_API_ORIGIN);
    url.searchParams.set("api_key_id", requiredText(input.apiKeyId, "API key ID"));
    url.searchParams.set("start_ts", input.startTimestamp);
    url.searchParams.set("end_ts", input.endTimestamp);
    const response = await this.fetchImplementation(url.toString(), this.request());
    if (!response.ok) {
      throw new Error(`Cartesia credit usage request failed (${response.status ?? "unknown"}).`);
    }
    return response.json();
  }

  private request() {
    return {
      method: "GET" as const,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.adminApiKey}`,
        "cartesia-version": CARTESIA_API_VERSION,
      },
    };
  }
}

export class CartesiaBillingEvidenceSource implements BillingProviderEvidenceSource {
  constructor(
    private readonly cartesia: CartesiaAdminUsageApi,
    private readonly tenantScopes: CartesiaTenantUsageScopeReader,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async collectCycle(input: BillingCycleEvidenceInput): Promise<BillingProviderEvidenceReport | null> {
    const canQueryExactCycle = assertExactCompletedCycle(input, this.now());
    if (!canQueryExactCycle) return null;
    const scope = await this.tenantScopes.readDurableTenantApiKeyScope(input);
    if (scope === null) return null;
    const apiKeyId = requiredText(scope.apiKeyId, "tenant API key ID");
    const mappingId = requiredText(scope.mappingId, "tenant scope mapping ID");
    const providerKey = await this.cartesia.getApiKey(apiKeyId);
    if (providerKey.id !== apiKeyId) {
      throw new Error("Cartesia billing evidence API key scope could not be proved.");
    }
    const rawUsage = await this.cartesia.getCreditUsage({
      apiKeyId,
      startTimestamp: input.cycleStartsAt,
      endTimestamp: input.cycleEndsAt,
    });
    const usage = parseExactUsage(rawUsage, input);
    const fact = {
      id: `cartesia:${apiKeyId}:${input.cycleStartsAt}:${input.cycleEndsAt}`,
      apiKeyId,
      cycleStartsAt: input.cycleStartsAt,
      cycleEndsAt: input.cycleEndsAt,
      credits: usage.credits,
    };
    const sourceReportId = `cartesia_credits_${createHash("sha256").update(stableJson({
      ...input,
      mappingId,
      fact,
    })).digest("hex")}`;

    return {
      provider: "cartesia",
      evidenceKind: "runtime_usage",
      sourceReportId,
      payload: {
        quantities: {},
        source: {
          kind: "provider_billing_api",
          apiVersion: CARTESIA_API_VERSION,
          apiKeyId,
          tenantScopeMappingId: mappingId,
        },
        facts: [fact],
      },
    };
  }
}

function assertExactCompletedCycle(input: BillingCycleEvidenceInput, now: string) {
  const startsAt = Date.parse(input.cycleStartsAt);
  const endsAt = Date.parse(input.cycleEndsAt);
  const nowAt = Date.parse(now);
  if (![startsAt, endsAt, nowAt].every(Number.isFinite) || startsAt >= endsAt) {
    throw new Error("Cartesia billing evidence cycle is invalid.");
  }
  if (!isUtcDayBoundary(startsAt) || !isUtcDayBoundary(endsAt)) {
    return false;
  }
  if (endsAt > nowAt) {
    throw new Error("Cartesia billing evidence requires a completed cycle.");
  }
  if (endsAt - startsAt > MAX_USAGE_WINDOW_MS) {
    throw new Error("Cartesia billing evidence cycle exceeds the provider usage limit.");
  }
  return true;
}

function isUtcDayBoundary(value: number) {
  const date = new Date(value);
  return date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0;
}

function parseApiKey(value: unknown) {
  const item = record(value, "Cartesia API key response is invalid.");
  return { id: requiredText(item.id, "provider API key ID") };
}

function parseExactUsage(value: unknown, input: BillingCycleEvidenceInput) {
  const response = record(value, "Cartesia credit usage response is invalid.");
  if (!Array.isArray(response.data) || response.data.length !== 1) {
    throw new Error("Cartesia billing evidence does not contain one exact usage bucket.");
  }
  const bucket = record(response.data[0], "Cartesia credit usage bucket is invalid.");
  if (
    Date.parse(String(bucket.start_ts)) !== Date.parse(input.cycleStartsAt)
    || Date.parse(String(bucket.end_ts)) !== Date.parse(input.cycleEndsAt)
  ) {
    throw new Error("Cartesia billing evidence does not exactly match the requested cycle.");
  }
  const credits = Number(bucket.credits);
  if (!Number.isSafeInteger(credits) || credits < 0) {
    throw new Error("Cartesia billing evidence credits are invalid.");
  }
  return { credits };
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Cartesia billing evidence ${field} is required.`);
  }
  return value.trim();
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
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
