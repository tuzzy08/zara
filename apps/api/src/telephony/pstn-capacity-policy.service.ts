import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";

import type { PstnAdmissionConfig } from "./pstn-admission-config";
import type { PstnAdmissionScope } from "./pstn-admission-coordinator";
import type {
  PstnCapacityPolicy,
  PstnCapacityPolicyAuditEntry,
  PstnCapacityTemporaryReduction,
  PstnResolvedAdmissionPolicy,
  PstnTenantCapacityPosture,
  PstnTenantCapacityUsage,
  UpdatePstnCapacityPolicyInput,
} from "./pstn-capacity-policy.models";
import type {
  PstnCapacityPolicyRepository,
} from "./pstn-capacity-policy.repository";

type PolicyActor = { actorUserId: string };

@Injectable()
export class PstnCapacityPolicyService {
  constructor(
    private readonly repository: PstnCapacityPolicyRepository,
    private readonly hardCeilings: PstnAdmissionConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly qualificationEnv: Record<string, string | undefined> =
      process.env,
  ) {}

  async getPolicy() {
    return (await this.repository.load()) ?? this.defaultPolicy();
  }

  async getStaffPosture() {
    const policy = await this.getPolicy();
    return {
      capturedAt: this.now().toISOString(),
      policy,
      hardCeilings: cloneHardCeilings(this.hardCeilings),
      qualification: resolveQualification(
        this.qualificationEnv,
        policy.limits.global,
      ),
      audit: await this.repository.listAudit(50),
    };
  }

  async updatePolicy(
    input: UpdatePstnCapacityPolicyInput,
    actor: PolicyActor,
  ) {
    const reason = input.reason?.trim();
    if (reason === undefined || reason.length < 3) {
      throw new UnprocessableEntityException(
        "A meaningful reason is required for capacity changes.",
      );
    }

    const before = await this.getPolicy();
    if (before.version !== input.expectedVersion) {
      throw new ConflictException(
        "Capacity policy changed. Refresh before applying this update.",
      );
    }
    const occurredAt = this.now().toISOString();
    const after = mergePolicy(before, input, actor.actorUserId, occurredAt);
    this.assertWithinHardCeilings(after);
    this.assertTemporaryReductions(after.temporaryReductions, after);

    const audit: PstnCapacityPolicyAuditEntry = {
      id: `pstn-capacity-policy-${after.version}`,
      policyVersion: after.version,
      actorUserId: actor.actorUserId,
      reason,
      before: structuredClone(before),
      after: structuredClone(after),
      occurredAt,
    };
    const saved = await this.repository.save({
      expectedVersion: input.expectedVersion,
      policy: after,
      audit,
    });
    if (!saved) {
      throw new ConflictException(
        "Capacity policy changed. Refresh before applying this update.",
      );
    }
    return { policy: after, audit };
  }

  async resolveAdmissionPolicy(
    scope: Pick<
      PstnAdmissionScope,
      | "tenantId"
      | "provider"
      | "providerAccountId"
      | "runtime"
      | "workerId"
      | "providerAvailable"
    >,
  ): Promise<PstnResolvedAdmissionPolicy> {
    const policy = await this.getPolicy();
    const effectiveGlobalLimit = Math.min(
      policy.limits.global,
      this.hardCeilings.limits.global,
    );
    const providerQuota = minimumDefined(
      effectiveGlobalLimit,
      policy.limits.provider,
      this.hardCeilings.limits.provider,
      policy.providerQuotas[scope.provider],
      this.hardCeilings.providerQuotaAllowances?.[scope.provider],
    );
    const providerAccountQuota = minimumDefined(
      providerQuota,
      policy.providerAccountQuotas[
        providerAccountKey(scope.provider, scope.providerAccountId)
      ],
    );
    const limits = {
      global: effectiveGlobalLimit,
      provider: scope.providerAvailable === false ? 0 : providerQuota,
      providerAccount:
        scope.providerAvailable === false ? 0 : providerAccountQuota,
      tenant: minimumDefined(
        effectiveGlobalLimit,
        this.hardCeilings.limits.tenant,
        policy.tenantAllowances[scope.tenantId] ??
          policy.limits.tenantDefault,
      ),
      runtime: minimumDefined(
        effectiveGlobalLimit,
        policy.limits.runtime[scope.runtime],
        this.hardCeilings.limits.runtime[scope.runtime],
      ),
      worker: minimumDefined(
        effectiveGlobalLimit,
        policy.workerLimits[scope.workerId ?? this.hardCeilings.workerId] ??
          policy.limits.worker,
        this.hardCeilings.limits.worker,
      ),
    };
    const activeReductions = policy.temporaryReductions.filter((reduction) =>
      isReductionActive(reduction, this.now()) &&
      reductionMatches(reduction, scope),
    );
    for (const reduction of activeReductions) {
      applyReduction(limits, reduction);
    }
    return {
      policyVersion: policy.version,
      limits,
      cps: {
        global: {
          capacity: Math.min(
            policy.cps.global.capacity,
            this.hardCeilings.cps.global.capacity,
          ),
          refillPerSecond: Math.min(
            policy.cps.global.refillPerSecond,
            this.hardCeilings.cps.global.refillPerSecond,
          ),
        },
        providerAccount: {
          capacity: Math.min(
            policy.cps.providerAccount.capacity,
            this.hardCeilings.cps.providerAccount.capacity,
          ),
          refillPerSecond: Math.min(
            policy.cps.providerAccount.refillPerSecond,
            this.hardCeilings.cps.providerAccount.refillPerSecond,
          ),
        },
      },
      activeReductionIds: activeReductions.map((reduction) => reduction.id),
    };
  }

  async getTenantPosture(
    tenantId: string,
    usage: PstnTenantCapacityUsage,
  ): Promise<PstnTenantCapacityPosture> {
    const policy = await this.getPolicy();
    const baseAllowance = Math.min(
      policy.limits.global,
      this.hardCeilings.limits.global,
      this.hardCeilings.limits.tenant,
      policy.tenantAllowances[tenantId] ?? policy.limits.tenantDefault,
    );
    const effectiveAllowance = resolveEffectiveCapacityLimit(
      policy,
      "tenant",
      tenantId,
      baseAllowance,
      this.now(),
    ).limit;
    const activeUse = usage.telemetryStatus === "unavailable"
      ? null
      : usage.activeUse;
    const remainingCapacity = activeUse === null
      ? null
      : Math.max(0, effectiveAllowance - activeUse);
    const nowMs = this.now().getTime();
    const recentRejections = usage.recentRejections.filter((rejection) => {
      const ageMs = nowMs - Date.parse(rejection.occurredAt);
      return ageMs >= 0 && ageMs <= tenantRecentRejectionWindowMs;
    });
    const operationalState =
      usage.telemetryStatus === "unavailable"
        ? "unavailable" as const
        : remainingCapacity === 0
          ? "saturated" as const
          : recentRejections.length > 0
            ? "degraded" as const
            : "healthy" as const;
    return {
      capturedAt: this.now().toISOString(),
      telemetryStatus: usage.telemetryStatus,
      effectiveAllowance,
      activeUse,
      remainingCapacity,
      saturated: remainingCapacity === null ? null : remainingCapacity === 0,
      operationalState,
      recentRejections: recentRejections.map(toTenantSafeRejection),
    };
  }

  private defaultPolicy(): PstnCapacityPolicy {
    const at = this.now().toISOString();
    return {
      schemaVersion: 1,
      version: 1,
      limits: {
        global: this.hardCeilings.limits.global,
        provider: this.hardCeilings.limits.provider,
        tenantDefault: this.hardCeilings.limits.tenant,
        worker: this.hardCeilings.limits.worker,
        runtime: structuredClone(this.hardCeilings.limits.runtime),
      },
      cps: structuredClone(this.hardCeilings.cps),
      providerQuotas: structuredClone(
        this.hardCeilings.providerQuotaAllowances ?? {},
      ),
      providerAccountQuotas: {},
      tenantAllowances: {},
      workerLimits: {},
      temporaryReductions: [],
      updatedBy: "system",
      updatedAt: at,
    };
  }

  private assertWithinHardCeilings(policy: PstnCapacityPolicy) {
    const scopedPolicyMaps: Array<[string, Record<string, number>]> = [
      ["provider quotas", policy.providerQuotas],
      ["provider account quotas", policy.providerAccountQuotas],
      ["tenant allowances", policy.tenantAllowances],
      ["worker limits", policy.workerLimits],
    ];
    for (const [label, values] of scopedPolicyMaps) {
      if (Object.keys(values).length > maxScopedPolicyEntries) {
        throw new UnprocessableEntityException(
          `Capacity policy supports at most ${maxScopedPolicyEntries} ${label}.`,
        );
      }
    }
    const integerChecks: Array<[string, number, number]> = [
      ["global limit", policy.limits.global, this.hardCeilings.limits.global],
      ["provider limit", policy.limits.provider, this.hardCeilings.limits.provider],
      ["tenant limit", policy.limits.tenantDefault, this.hardCeilings.limits.tenant],
      ["worker limit", policy.limits.worker, this.hardCeilings.limits.worker],
      [
        "sandwich runtime limit",
        policy.limits.runtime["pstn-sandwich"],
        this.hardCeilings.limits.runtime["pstn-sandwich"],
      ],
      [
        "premium runtime limit",
        policy.limits.runtime["pstn-premium-realtime"],
        this.hardCeilings.limits.runtime["pstn-premium-realtime"],
      ],
      [
        "global CPS burst",
        policy.cps.global.capacity,
        this.hardCeilings.cps.global.capacity,
      ],
      [
        "provider CPS burst",
        policy.cps.providerAccount.capacity,
        this.hardCeilings.cps.providerAccount.capacity,
      ],
    ];
    const rateChecks: Array<[string, number, number]> = [
      [
        "global CPS rate",
        policy.cps.global.refillPerSecond,
        this.hardCeilings.cps.global.refillPerSecond,
      ],
      [
        "provider CPS rate",
        policy.cps.providerAccount.refillPerSecond,
        this.hardCeilings.cps.providerAccount.refillPerSecond,
      ],
    ];
    for (const [label, value, ceiling] of integerChecks) {
      assertBoundedInteger(label, value, ceiling);
    }
    for (const [label, value, ceiling] of rateChecks) {
      assertBoundedRate(label, value, ceiling);
    }
    for (const [provider, value] of Object.entries(policy.providerQuotas)) {
      assertBoundedInteger(
        `provider quota '${provider}'`,
        value,
        Math.min(
          this.hardCeilings.limits.provider,
          this.hardCeilings.providerQuotaAllowances?.[provider] ??
            this.hardCeilings.limits.provider,
        ),
      );
    }
    for (const [key, value] of Object.entries(policy.providerAccountQuotas)) {
      const provider = key.split(":", 1)[0] ?? "";
      assertBoundedInteger(
        `provider account quota '${key}'`,
        value,
        Math.min(
          this.hardCeilings.limits.provider,
          this.hardCeilings.providerQuotaAllowances?.[provider] ??
            this.hardCeilings.limits.provider,
        ),
      );
    }
    for (const [tenantId, value] of Object.entries(policy.tenantAllowances)) {
      assertBoundedInteger(
        `tenant allowance '${tenantId}'`,
        value,
        this.hardCeilings.limits.tenant,
      );
    }
    for (const [workerId, value] of Object.entries(policy.workerLimits)) {
      assertBoundedInteger(
        `worker limit '${workerId}'`,
        value,
        this.hardCeilings.limits.worker,
      );
    }
  }

  private assertTemporaryReductions(
    reductions: PstnCapacityTemporaryReduction[],
    policy: PstnCapacityPolicy,
  ) {
    if (reductions.length > maxTemporaryReductions) {
      throw new UnprocessableEntityException(
        `Capacity policy supports at most ${maxTemporaryReductions} temporary reductions.`,
      );
    }
    const ids = new Set<string>();
    for (const reduction of reductions) {
      if (
        !capacityReductionScopes.has(reduction.scope) ||
        reduction.id.trim().length === 0 ||
        ids.has(reduction.id) ||
        reduction.reason.trim().length < 3 ||
        !Number.isInteger(reduction.maxConcurrentCalls) ||
        reduction.maxConcurrentCalls < 0 ||
        !Number.isFinite(Date.parse(reduction.startsAt)) ||
        !Number.isFinite(Date.parse(reduction.expiresAt)) ||
        Date.parse(reduction.startsAt) >= Date.parse(reduction.expiresAt)
      ) {
        throw new UnprocessableEntityException(
          `Temporary reduction '${reduction.id}' is invalid.`,
        );
      }
      ids.add(reduction.id);
      const ceiling = reductionCeiling(reduction, policy);
      if (
        reduction.maxConcurrentCalls > ceiling ||
        (reduction.scope !== "global" &&
          (reduction.key === undefined || reduction.key.trim().length === 0))
      ) {
        throw new UnprocessableEntityException(
          `Temporary reduction '${reduction.id}' exceeds its policy limit or has no scope key.`,
        );
      }
    }
  }
}

const tenantRecentRejectionWindowMs = 15 * 60 * 1_000;
const maxTemporaryReductions = 128;
const maxScopedPolicyEntries = 512;

function resolveQualification(
  env: Record<string, string | undefined>,
  deployedGlobalLimit: number,
) {
  const evidenceDate = env.PSTN_CAPACITY_QUALIFICATION_EVIDENCE_DATE?.trim();
  const environment =
    env.PSTN_CAPACITY_QUALIFICATION_ENVIRONMENT?.trim();
  const highestPassingCallsValue =
    env.PSTN_CAPACITY_QUALIFICATION_HIGHEST_PASSING_CALLS?.trim();
  const safetyHeadroomValue =
    env.PSTN_CAPACITY_QUALIFICATION_SAFETY_HEADROOM_PERCENT?.trim();
  const highestPassingConcurrentCalls = Number(
    highestPassingCallsValue,
  );
  const safetyHeadroomPercent = Number(
    safetyHeadroomValue,
  );
  if (
    evidenceDate === undefined ||
    !isExactIsoDate(evidenceDate) ||
    environment === undefined ||
    environment.length === 0 ||
    highestPassingCallsValue === undefined ||
    highestPassingCallsValue.length === 0 ||
    !Number.isInteger(highestPassingConcurrentCalls) ||
    highestPassingConcurrentCalls <= 0 ||
    safetyHeadroomValue === undefined ||
    safetyHeadroomValue.length === 0 ||
    !Number.isFinite(safetyHeadroomPercent) ||
    safetyHeadroomPercent < 0 ||
    safetyHeadroomPercent >= 100
  ) {
    return {
      status: "provisional" as const,
      evidenceDate: null,
      environment: null,
      highestPassingConcurrentCalls: null,
      safetyHeadroomPercent: null,
      deployedConfigurationExceedsQualification: null,
    };
  }
  const qualifiedLimit = Math.floor(
    highestPassingConcurrentCalls * (1 - safetyHeadroomPercent / 100),
  );
  return {
    status: "certified" as const,
    evidenceDate,
    environment,
    highestPassingConcurrentCalls,
    safetyHeadroomPercent,
    deployedConfigurationExceedsQualification:
      deployedGlobalLimit > qualifiedLimit,
  };
}

function isExactIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function mergePolicy(
  before: PstnCapacityPolicy,
  input: UpdatePstnCapacityPolicyInput,
  actorUserId: string,
  occurredAt: string,
): PstnCapacityPolicy {
  return {
    ...structuredClone(before),
    version: before.version + 1,
    limits: {
      ...before.limits,
      ...input.limits,
      runtime: {
        ...before.limits.runtime,
        ...input.limits?.runtime,
      },
    },
    cps: {
      global: {
        ...before.cps.global,
        ...input.cps?.global,
      },
      providerAccount: {
        ...before.cps.providerAccount,
        ...input.cps?.providerAccount,
      },
    },
    providerQuotas: structuredClone(
      input.providerQuotas ?? before.providerQuotas,
    ),
    providerAccountQuotas: structuredClone(
      input.providerAccountQuotas ?? before.providerAccountQuotas,
    ),
    tenantAllowances: structuredClone(
      input.tenantAllowances ?? before.tenantAllowances,
    ),
    workerLimits: structuredClone(
      input.workerLimits ?? before.workerLimits,
    ),
    temporaryReductions: structuredClone(
      input.temporaryReductions ?? before.temporaryReductions,
    ),
    updatedBy: actorUserId,
    updatedAt: occurredAt,
  };
}

function cloneHardCeilings(config: PstnAdmissionConfig) {
  return {
    limits: structuredClone(config.limits),
    cps: structuredClone(config.cps),
    providerQuotaAllowances: structuredClone(
      config.providerQuotaAllowances ?? {},
    ),
  };
}

function assertBoundedInteger(label: string, value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new UnprocessableEntityException(
      `${label} must be a whole number between 0 and its deployed ceiling (${maximum}).`,
    );
  }
}

function assertBoundedRate(label: string, value: number, maximum: number) {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new UnprocessableEntityException(
      `${label} must be greater than 0 and no higher than its deployed ceiling (${maximum}).`,
    );
  }
}

const capacityReductionScopes = new Set<PstnCapacityTemporaryReduction["scope"]>([
  "global",
  "provider",
  "provider_account",
  "tenant",
  "runtime",
  "worker",
]);

function providerAccountKey(provider: string, providerAccountId: string) {
  return `${provider}:${providerAccountId}`;
}

function minimumDefined(...values: Array<number | undefined>) {
  return Math.min(
    ...values.filter((value): value is number => value !== undefined),
  );
}

function isReductionActive(
  reduction: PstnCapacityTemporaryReduction,
  now: Date,
) {
  const nowMs = now.getTime();
  return Date.parse(reduction.startsAt) <= nowMs &&
    nowMs < Date.parse(reduction.expiresAt);
}

export function resolveEffectiveCapacityLimit(
  policy: PstnCapacityPolicy,
  scope: PstnCapacityTemporaryReduction["scope"],
  key: string,
  baseLimit: number,
  now: Date,
) {
  const activeReductions = policy.temporaryReductions.filter((reduction) =>
    isReductionActive(reduction, now) &&
    (reduction.scope === "global" ||
      (reduction.scope === scope && reduction.key === key)),
  );
  return {
    limit: activeReductions.reduce(
      (limit, reduction) =>
        Math.min(limit, reduction.maxConcurrentCalls),
      baseLimit,
    ),
    activeReductionIds: activeReductions.map((reduction) => reduction.id),
  };
}

function reductionMatches(
  reduction: PstnCapacityTemporaryReduction,
  scope: Pick<
    PstnAdmissionScope,
    "tenantId" | "provider" | "providerAccountId" | "runtime" | "workerId"
  >,
) {
  if (reduction.scope === "global") return true;
  if (reduction.scope === "provider") return reduction.key === scope.provider;
  if (reduction.scope === "provider_account") {
    return reduction.key ===
      providerAccountKey(scope.provider, scope.providerAccountId);
  }
  if (reduction.scope === "tenant") return reduction.key === scope.tenantId;
  if (reduction.scope === "runtime") return reduction.key === scope.runtime;
  return reduction.key === scope.workerId;
}

function applyReduction(
  limits: {
    global: number;
    provider: number;
    providerAccount?: number | undefined;
    tenant: number;
    runtime: number;
    worker: number;
  },
  reduction: PstnCapacityTemporaryReduction,
) {
  if (reduction.scope === "global") {
    limits.global = Math.min(limits.global, reduction.maxConcurrentCalls);
  } else if (reduction.scope === "provider") {
    limits.provider = Math.min(limits.provider, reduction.maxConcurrentCalls);
  } else if (reduction.scope === "provider_account") {
    limits.providerAccount = Math.min(
      limits.providerAccount ?? limits.provider,
      reduction.maxConcurrentCalls,
    );
  } else if (reduction.scope === "tenant") {
    limits.tenant = Math.min(limits.tenant, reduction.maxConcurrentCalls);
  } else if (reduction.scope === "runtime") {
    limits.runtime = Math.min(limits.runtime, reduction.maxConcurrentCalls);
  } else {
    limits.worker = Math.min(limits.worker, reduction.maxConcurrentCalls);
  }
}

function reductionCeiling(
  reduction: PstnCapacityTemporaryReduction,
  policy: PstnCapacityPolicy,
) {
  if (reduction.scope === "global") return policy.limits.global;
  if (reduction.scope === "provider") {
    return Math.min(
      policy.limits.provider,
      policy.providerQuotas[reduction.key ?? ""] ?? policy.limits.provider,
    );
  }
  if (reduction.scope === "provider_account") {
    return Math.min(
      policy.limits.provider,
      policy.providerAccountQuotas[reduction.key ?? ""] ??
        policy.limits.provider,
    );
  }
  if (reduction.scope === "tenant") {
    return policy.tenantAllowances[reduction.key ?? ""] ??
      policy.limits.tenantDefault;
  }
  if (reduction.scope === "runtime") {
    return policy.limits.runtime[
      reduction.key as keyof PstnCapacityPolicy["limits"]["runtime"]
    ] ?? 0;
  }
  return policy.workerLimits[reduction.key ?? ""] ?? policy.limits.worker;
}

function toTenantSafeRejection(
  rejection: PstnTenantCapacityUsage["recentRejections"][number],
) {
  if (
    rejection.reasonCode === "provider_concurrency_limit" ||
    rejection.reasonCode === "backend_unavailable"
  ) {
    return {
      occurredAt: rejection.occurredAt,
      code: "provider_unavailable" as const,
      message: "Calling is temporarily unavailable. Try again shortly.",
    };
  }
  if (
    rejection.reasonCode === "tenant_concurrency_limit" ||
    rejection.reasonCode === "global_concurrency_limit" ||
    rejection.reasonCode === "provider_account_concurrency_limit" ||
    rejection.reasonCode === "runtime_concurrency_limit" ||
    rejection.reasonCode === "worker_concurrency_limit"
  ) {
    return {
      occurredAt: rejection.occurredAt,
      code: "capacity_reached" as const,
      message:
        "Your current call capacity is in use. Try again shortly or contact support.",
    };
  }
  return {
    occurredAt: rejection.occurredAt,
    code: "retry_later" as const,
    message: "The call could not start. Try again shortly.",
  };
}
