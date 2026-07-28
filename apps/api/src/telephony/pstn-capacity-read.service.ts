import { Injectable } from "@nestjs/common";

import type { PstnAdmissionConfig } from "./pstn-admission-config";
import type {
  PstnCallAdmission,
  PstnCallAdmissionDimensionUsage,
  PstnCallAdmissionDimensionUsageInput,
  PstnCallAdmissionDimensionUsageResult,
  PstnCallAdmissionUsage,
  PstnCallAdmissionUsageInput,
} from "./pstn-call-admission";
import {
  PstnCapacityPolicyService,
  resolveEffectiveCapacityLimit,
} from "./pstn-capacity-policy.service";
import { PstnCapacityRejectionService } from "./pstn-capacity-rejection.service";
import type {
  PstnCapacityScopeCatalog,
} from "./pstn-capacity-scope-catalog";

@Injectable()
export class PstnCapacityReadService {
  constructor(
    private readonly policyService: PstnCapacityPolicyService,
    private readonly rejectionService: PstnCapacityRejectionService,
    private readonly admission: Pick<
      PstnCallAdmission,
      "getDimensionUsage" | "getHealth" | "getUsage"
    >,
    private readonly config: PstnAdmissionConfig,
    private readonly scopeCatalog: PstnCapacityScopeCatalog,
  ) {}

  async getTenantPosture(tenantId: string) {
    const [health, usage, recentRejections] = await Promise.all([
      this.admission.getHealth(),
      this.readUsage({
        tenantId,
        provider: "unknown",
        providerAccountId: "unknown",
        runtime: "pstn-sandwich",
        workerId: this.config.workerId,
      }),
      this.rejectionService.listForTenant(tenantId, 20),
    ]);
    const telemetryStatus =
      health.status === "healthy" && usage.status === "available"
        ? "fresh" as const
        : "unavailable" as const;
    return this.policyService.getTenantPosture(tenantId, {
      telemetryStatus,
      activeUse:
        usage.status === "available" ? usage.counts.tenant.total : null,
      recentRejections,
    });
  }

  async getStaffPosture(scopeOffset = 0) {
    const [policyPosture, health, recentRejections, discoveredScopes] =
      await Promise.all([
      this.policyService.getStaffPosture(),
      this.admission.getHealth(),
      this.rejectionService.listRecent(100),
      this.scopeCatalog.listScopes({ offset: scopeOffset }),
    ]);
    const policy = policyPosture.policy;
    const providerAccounts = uniqueProviderAccounts(
      discoveredScopes.providerAccounts,
    );
    const providers = [
      ...new Set([
        ...Object.keys(discoveredScopes.providerHealth),
        ...providerAccounts.map((account) => account.provider),
      ]),
    ].sort();
    const tenants = [...new Set(discoveredScopes.tenants)].sort();
    const workers = [
      ...new Set([
        ...(this.config.mode === "memory" ? [this.config.workerId] : []),
        ...discoveredScopes.workers,
      ]),
    ].sort();
    const descriptors: CapacityDescriptor[] = [
      {
        scope: "global",
        key: "global",
        limit: Math.min(
          policy.limits.global,
          this.config.limits.global,
        ),
        usageDimension: "global",
      },
      ...providers.map((provider) => ({
        scope: "provider" as const,
        key: provider,
        limit: Math.min(
          policy.limits.global,
          this.config.limits.global,
          policy.limits.provider,
          this.config.limits.provider,
          policy.providerQuotas[provider] ?? policy.limits.provider,
          this.config.providerQuotaAllowances?.[provider] ??
            this.config.limits.provider,
        ),
        usageDimension: "provider" as const,
        provider,
        health:
          discoveredScopes.providerHealth[provider] ??
          aggregateProviderHealth(
            providerAccounts
              .filter((account) => account.provider === provider)
              .map((account) => account.health),
          ),
      })),
      ...providerAccounts.map((account) => {
        const key = `${account.provider}:${account.providerAccountId}`;
        return {
          scope: "provider_account" as const,
          key,
          limit: Math.min(
            policy.limits.global,
            this.config.limits.global,
            policy.limits.provider,
            this.config.limits.provider,
            policy.providerQuotas[account.provider] ?? policy.limits.provider,
            policy.providerAccountQuotas[key] ?? policy.limits.provider,
            this.config.providerQuotaAllowances?.[account.provider] ??
              this.config.limits.provider,
          ),
          usageDimension: "providerAccount" as const,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          health: account.health,
        };
      }),
      ...tenants.map((tenantId) => ({
        scope: "tenant" as const,
        key: tenantId,
        limit: Math.min(
          policy.limits.global,
          this.config.limits.global,
          this.config.limits.tenant,
          policy.tenantAllowances[tenantId] ?? policy.limits.tenantDefault,
        ),
        usageDimension: "tenant" as const,
        tenantId,
      })),
      ...Object.entries(policy.limits.runtime).map(([runtime, limit]) => ({
        scope: "runtime" as const,
        key: runtime,
        limit: Math.min(
          policy.limits.global,
          this.config.limits.global,
          limit,
          this.config.limits.runtime[
            runtime as keyof PstnAdmissionConfig["limits"]["runtime"]
          ],
        ),
        usageDimension: "runtime" as const,
        runtime,
      })),
      ...workers.map((workerId) => ({
        scope: "worker" as const,
        key: workerId,
        limit: Math.min(
          policy.limits.global,
          this.config.limits.global,
          this.config.limits.worker,
          policy.workerLimits[workerId] ?? policy.limits.worker,
        ),
        usageDimension: "worker" as const,
        workerId,
        health:
          discoveredScopes.workers.includes(workerId) ||
          (this.config.mode === "memory" && workerId === this.config.workerId)
          ? "healthy" as const
          : "unavailable" as const,
      })),
    ];
    const dimensionUsage = await this.readDimensionUsage(
      descriptors.map((descriptor) => ({
        dimension: descriptor.usageDimension,
          tenantId: descriptor.tenantId ?? "unknown",
          provider: descriptor.provider ?? "unknown",
          providerAccountId: descriptor.providerAccountId ?? "unknown",
          runtime: descriptor.runtime ?? "pstn-sandwich",
          workerId: descriptor.workerId ?? this.config.workerId,
      })),
    );
    const dimensions = descriptors.map((descriptor, index) => {
        const effective = resolveEffectiveCapacityLimit(
          policy,
          descriptor.scope,
          descriptor.key,
          descriptor.limit,
          new Date(policyPosture.capturedAt),
        );
        return capacityDimension(
          { ...descriptor, ...effective },
          dimensionUsage.status === "available"
            ? dimensionUsage.counts[index] ?? null
            : null,
        );
      });
    const inventoryComplete =
      discoveredScopes.page.offset === 0 && !discoveredScopes.page.hasMore;
    const telemetryStatus =
      inventoryComplete &&
      health.status === "healthy" &&
      dimensions.every((dimension) => dimension.telemetryAvailable)
        ? "fresh" as const
        : "unavailable" as const;
    const capturedAtMs = Date.parse(policyPosture.capturedAt);
    const recentOperationalRejectionCount = recentRejections.filter(
      (rejection) => {
        const ageMs = capturedAtMs - Date.parse(rejection.occurredAt);
        return ageMs >= 0 && ageMs <= operationalRejectionWindowMs;
      },
    ).length;
    return {
      ...policyPosture,
      telemetryStatus,
      operationalState: resolveOperationalState(
        telemetryStatus,
        dimensions,
        recentOperationalRejectionCount,
      ),
      admissionHealth: health,
      scopePage: discoveredScopes.page,
      dimensions,
      recentRejections,
    };
  }

  private async readUsage(
    input: PstnCallAdmissionUsageInput,
  ): Promise<PstnCallAdmissionUsage> {
    return this.admission.getUsage === undefined
      ? { status: "unavailable" }
      : this.admission.getUsage(input);
  }

  private async readDimensionUsage(
    inputs: readonly PstnCallAdmissionDimensionUsageInput[],
  ): Promise<PstnCallAdmissionDimensionUsageResult> {
    if (this.admission.getDimensionUsage === undefined) {
      return { status: "unavailable" };
    }
    const counts: PstnCallAdmissionDimensionUsage[] = [];
    for (let index = 0; index < inputs.length; index += dimensionUsageBatchSize) {
      const result = await this.admission.getDimensionUsage(
        inputs.slice(index, index + dimensionUsageBatchSize),
      );
      if (result.status !== "available") {
        return { status: "unavailable" };
      }
      counts.push(...result.counts);
    }
    return { status: "available", counts };
  }
}

const operationalRejectionWindowMs = 15 * 60 * 1_000;
const dimensionUsageBatchSize = 128;

type CapacityScope =
  | "global"
  | "provider"
  | "provider_account"
  | "tenant"
  | "runtime"
  | "worker";

interface CapacityDescriptor {
  scope: CapacityScope;
  key: string;
  limit: number;
  usageDimension:
    | "global"
    | "provider"
    | "providerAccount"
    | "tenant"
    | "runtime"
    | "worker";
  provider?: string | undefined;
  providerAccountId?: string | undefined;
  tenantId?: string | undefined;
  runtime?: string | undefined;
  workerId?: string | undefined;
  activeReductionIds?: string[] | undefined;
  health?: "healthy" | "degraded" | "unavailable" | undefined;
}

function capacityDimension(
  descriptor: CapacityDescriptor,
  usage: PstnCallAdmissionDimensionUsage | null,
) {
  const availableSlots =
    usage === null ? null : Math.max(0, descriptor.limit - usage.total);
  const utilization =
    usage === null || descriptor.limit === 0
      ? null
      : usage.total / descriptor.limit;
  return {
    scope: descriptor.scope,
    key: descriptor.key,
    limit: descriptor.limit,
    activeCalls: usage?.active ?? null,
    reservations: usage?.reservations ?? null,
    used: usage?.total ?? null,
    availableSlots,
    saturation:
      usage === null
        ? null
        : descriptor.limit === 0 || usage.total >= descriptor.limit
          ? "saturated" as const
          : utilization !== null && utilization >= 0.85
            ? "critical" as const
            : utilization !== null && utilization >= 0.7
              ? "warning" as const
              : "healthy" as const,
    telemetryAvailable: usage !== null,
    activeReductionIds: descriptor.activeReductionIds ?? [],
    health: descriptor.health ?? null,
  };
}

function uniqueProviderAccounts(
  accounts: Array<{
    provider: string;
    providerAccountId: string;
    health?: "healthy" | "degraded" | "unavailable";
  }>,
) {
  const indexed = new Map<string, (typeof accounts)[number]>();
  for (const account of accounts) {
    const key = `${account.provider}:${account.providerAccountId}`;
    const existing = indexed.get(key);
    const health = mergeProviderAccountHealth(
      existing?.health,
      account.health,
    );
    indexed.set(key, {
      ...existing,
      ...account,
      ...(health === undefined ? {} : { health }),
    });
  }
  return [...indexed.values()].sort((left, right) =>
    `${left.provider}:${left.providerAccountId}`.localeCompare(
      `${right.provider}:${right.providerAccountId}`,
    )
  );
}

function mergeProviderAccountHealth(
  left: "healthy" | "degraded" | "unavailable" | undefined,
  right: "healthy" | "degraded" | "unavailable" | undefined,
) {
  const healthRank = {
    healthy: 0,
    degraded: 1,
    unavailable: 2,
  } as const;
  if (left === undefined) return right;
  if (right === undefined) return left;
  return healthRank[left] >= healthRank[right] ? left : right;
}

function resolveOperationalState(
  telemetryStatus: "fresh" | "unavailable",
  dimensions: Array<ReturnType<typeof capacityDimension>>,
  rejectionCount: number,
) {
  if (telemetryStatus === "unavailable") return "unavailable" as const;
  if (dimensions.some((dimension) => dimension.saturation === "saturated")) {
    return "saturated" as const;
  }
  if (
    rejectionCount > 0 ||
    dimensions.some((dimension) =>
      dimension.saturation === "warning" ||
      dimension.saturation === "critical" ||
      dimension.health === "degraded" ||
      dimension.health === "unavailable"
    )
  ) {
    return "degraded" as const;
  }
  return "healthy" as const;
}

function aggregateProviderHealth(
  health: Array<"healthy" | "degraded" | "unavailable" | undefined>,
) {
  if (health.includes("unavailable")) return "unavailable" as const;
  if (health.includes("degraded")) return "degraded" as const;
  if (health.includes("healthy")) return "healthy" as const;
  return undefined;
}
