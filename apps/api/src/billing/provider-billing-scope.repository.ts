import type { Pool, PoolClient } from "pg";

import type { BillingCycleEvidenceInput } from "./billing-usage-reconciliation.service";
import type { GeminiCloudBillingProjectMapping } from "./gemini-cloud-billing-evidence.source";

type Queryable = Pick<Pool | PoolClient, "query">;

export type DirectBillingProvider = "cartesia" | "openai" | "gemini";

export interface ProviderBillingScope {
  id: string;
  externalScopeId: string;
  configuration: Record<string, unknown>;
}

export class PostgresProviderBillingScopeRepository {
  constructor(private readonly database: Queryable) {}

  async readActiveScope(input: {
    organizationId: string;
    provider: DirectBillingProvider;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }): Promise<ProviderBillingScope | null> {
    const result = await this.database.query(
      `select id, external_scope_id, configuration
         from billing_provider_tenant_scopes
        where tenant_id = $1
          and provider = $2
          and effective_from <= $3::timestamptz
          and (effective_until is null or effective_until >= $4::timestamptz)
        order by effective_from desc, id`,
      [input.organizationId, input.provider, input.cycleStartsAt, input.cycleEndsAt],
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) throw new Error("Provider billing scope is ambiguous.");
    const row = result.rows[0] as Record<string, unknown>;
    if (
      typeof row.id !== "string"
      || row.id.trim() === ""
      || typeof row.external_scope_id !== "string"
      || row.external_scope_id.trim() === ""
      || row.configuration === null
      || typeof row.configuration !== "object"
      || Array.isArray(row.configuration)
    ) {
      throw new Error("Provider billing scope is invalid.");
    }
    return {
      id: row.id,
      externalScopeId: row.external_scope_id,
      configuration: row.configuration as Record<string, unknown>,
    };
  }

  async readDurableTenantApiKeyScope(input: BillingCycleEvidenceInput) {
    const scope = await this.readActiveScope({ ...input, provider: "cartesia" });
    return scope === null ? null : {
      apiKeyId: scope.externalScopeId,
      mappingId: scope.id,
    };
  }

  async getProjectId(input: BillingCycleEvidenceInput) {
    return (await this.readActiveScope({ ...input, provider: "openai" }))?.externalScopeId ?? null;
  }

  async readActiveMapping(
    input: BillingCycleEvidenceInput,
  ): Promise<GeminiCloudBillingProjectMapping | null> {
    const scope = await this.readActiveScope({ ...input, provider: "gemini" });
    if (scope === null) return null;
    const configuration = scope.configuration;
    return {
      id: scope.id,
      organizationId: input.organizationId,
      gcpProjectId: scope.externalScopeId,
      billingAccountId: requiredString(configuration.billingAccountId),
      normalizedBillingView: requiredString(configuration.normalizedBillingView),
      serviceIds: requiredStringArray(configuration.serviceIds),
      skuIds: requiredStringArray(configuration.skuIds),
      exportEnabledAt: requiredString(configuration.exportEnabledAt),
    };
  }
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Provider billing scope configuration is invalid.");
  }
  return value.trim();
}

function requiredStringArray(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Provider billing scope configuration is invalid.");
  }
  return value.map(requiredString);
}
