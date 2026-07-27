import {
  maxPstnAdmissionBucketCapacity,
  maxPstnAdmissionConcurrencyLimit,
  maxPstnAdmissionLeaseTtlMs,
  maxPstnAdmissionRefillPerSecond,
} from "./pstn-call-admission";

export type PstnAdmissionRuntimePath =
  | "pstn-sandwich"
  | "pstn-premium-realtime";

export type PstnAdmissionUnavailableReason =
  | "redis_not_configured"
  | "admission_config_invalid";

export interface PstnAdmissionConfig {
  mode: "memory" | "redis" | "unavailable";
  workerId: string;
  redisUrl?: string | undefined;
  providerQuotaAllowances?: Readonly<Record<string, number>> | undefined;
  unavailableReason?: PstnAdmissionUnavailableReason | undefined;
  limits: {
    global: number;
    provider: number;
    tenant: number;
    worker: number;
    runtime: Record<PstnAdmissionRuntimePath, number>;
  };
  cps: {
    global: {
      capacity: number;
      refillPerSecond: number;
    };
    providerAccount: {
      capacity: number;
      refillPerSecond: number;
    };
  };
  claimTtlMs: number;
  activeTtlMs: number;
  renewIntervalMs: number;
  commandTimeoutMs: number;
}

const provisionalConcurrentCallLimit = 20;
const defaultActiveTtlMs = 120_000;
const defaultRenewIntervalMs = 30_000;

export function resolvePstnAdmissionConfig(
  env: Record<string, string | undefined> = process.env,
): PstnAdmissionConfig {
  const redisUrl = nonEmpty(env.PSTN_ADMISSION_REDIS_URL);
  const configuredRenewIntervalMs = readPositiveInteger(
    env.PSTN_ADMISSION_RENEW_INTERVAL_MS,
    defaultRenewIntervalMs,
  );
  const configuredActiveTtlMs = readBoundedPositiveInteger(
    env.PSTN_ADMISSION_ACTIVE_TTL_MS,
    defaultActiveTtlMs,
    maxPstnAdmissionLeaseTtlMs,
  );
  const hasUnsafeLeaseTiming =
    configuredActiveTtlMs < configuredRenewIntervalMs * 3;
  const activeTtlMs = hasUnsafeLeaseTiming
    ? defaultActiveTtlMs
    : configuredActiveTtlMs;
  const renewIntervalMs = hasUnsafeLeaseTiming
    ? defaultRenewIntervalMs
    : configuredRenewIntervalMs;
  const twilioQuotaAllowance = readOptionalBoundedNonNegativeInteger(
    env.PSTN_ADMISSION_TWILIO_QUOTA_MAX_CONCURRENT_CALLS,
    maxPstnAdmissionConcurrencyLimit,
  );

  const base = {
    workerId:
      nonEmpty(env.PSTN_WORKER_ID) ??
      nonEmpty(env.HOSTNAME) ??
      `zara-api-${process.pid}`,
    limits: {
      global: readNonNegativeInteger(
        env.PSTN_ADMISSION_GLOBAL_MAX_CONCURRENT_CALLS,
        provisionalConcurrentCallLimit,
      ),
      provider: readNonNegativeInteger(
        env.PSTN_ADMISSION_PROVIDER_MAX_CONCURRENT_CALLS,
        provisionalConcurrentCallLimit,
      ),
      tenant: readNonNegativeInteger(
        env.PSTN_ADMISSION_TENANT_MAX_CONCURRENT_CALLS,
        provisionalConcurrentCallLimit,
      ),
      worker: readNonNegativeInteger(
        env.PSTN_ADMISSION_WORKER_MAX_CONCURRENT_CALLS,
        provisionalConcurrentCallLimit,
      ),
      runtime: {
        "pstn-sandwich": readNonNegativeInteger(
          env.PSTN_ADMISSION_SANDWICH_MAX_CONCURRENT_CALLS,
          provisionalConcurrentCallLimit,
        ),
        "pstn-premium-realtime": readNonNegativeInteger(
          env.PSTN_ADMISSION_PREMIUM_MAX_CONCURRENT_CALLS,
          provisionalConcurrentCallLimit,
        ),
      },
    },
    cps: {
      global: {
        capacity: readBoundedPositiveInteger(
          env.PSTN_ADMISSION_GLOBAL_CPS_BURST,
          10,
          maxPstnAdmissionBucketCapacity,
        ),
        refillPerSecond: readBoundedPositiveNumber(
          env.PSTN_ADMISSION_GLOBAL_CPS_RATE,
          10,
          maxPstnAdmissionRefillPerSecond,
        ),
      },
      providerAccount: {
        capacity: readBoundedPositiveInteger(
          env.PSTN_ADMISSION_PROVIDER_CPS_BURST,
          5,
          maxPstnAdmissionBucketCapacity,
        ),
        refillPerSecond: readBoundedPositiveNumber(
          env.PSTN_ADMISSION_PROVIDER_CPS_RATE,
          5,
          maxPstnAdmissionRefillPerSecond,
        ),
      },
    },
    claimTtlMs: readBoundedPositiveInteger(
      env.PSTN_ADMISSION_CLAIM_TTL_MS,
      30_000,
      maxPstnAdmissionLeaseTtlMs,
    ),
    activeTtlMs,
    renewIntervalMs,
    commandTimeoutMs: readPositiveInteger(
      env.PSTN_ADMISSION_COMMAND_TIMEOUT_MS,
      750,
    ),
    ...(twilioQuotaAllowance === undefined
      ? {}
      : {
          providerQuotaAllowances: {
            twilio: twilioQuotaAllowance,
          },
        }),
  };

  if (redisUrl !== undefined) {
    if (
      env.NODE_ENV === "production" &&
      (isExplicitInvalidPositiveInteger(
        env.PSTN_ADMISSION_GLOBAL_CPS_BURST,
        maxPstnAdmissionBucketCapacity,
      ) ||
        isExplicitInvalidPositiveNumber(
          env.PSTN_ADMISSION_GLOBAL_CPS_RATE,
          maxPstnAdmissionRefillPerSecond,
        ) ||
        isExplicitInvalidPositiveInteger(
          env.PSTN_ADMISSION_PROVIDER_CPS_BURST,
          maxPstnAdmissionBucketCapacity,
        ) ||
        isExplicitInvalidPositiveNumber(
          env.PSTN_ADMISSION_PROVIDER_CPS_RATE,
          maxPstnAdmissionRefillPerSecond,
        ) ||
        [
          env.PSTN_ADMISSION_GLOBAL_MAX_CONCURRENT_CALLS,
          env.PSTN_ADMISSION_PROVIDER_MAX_CONCURRENT_CALLS,
          env.PSTN_ADMISSION_TENANT_MAX_CONCURRENT_CALLS,
          env.PSTN_ADMISSION_WORKER_MAX_CONCURRENT_CALLS,
          env.PSTN_ADMISSION_SANDWICH_MAX_CONCURRENT_CALLS,
          env.PSTN_ADMISSION_PREMIUM_MAX_CONCURRENT_CALLS,
        ].some(isExplicitInvalidNonNegativeInteger) ||
        isExplicitInvalidOptionalNonNegativeInteger(
          env.PSTN_ADMISSION_TWILIO_QUOTA_MAX_CONCURRENT_CALLS,
          maxPstnAdmissionConcurrencyLimit,
        ) ||
        [
          env.PSTN_ADMISSION_CLAIM_TTL_MS,
          env.PSTN_ADMISSION_ACTIVE_TTL_MS,
        ].some((value) =>
          isExplicitInvalidPositiveInteger(
            value,
            maxPstnAdmissionLeaseTtlMs,
          ),
        ) ||
        isExplicitInvalidPositiveInteger(
          env.PSTN_ADMISSION_RENEW_INTERVAL_MS,
          maxPstnAdmissionLeaseTtlMs,
        ) ||
        hasUnsafeLeaseTiming)
    ) {
      return {
        mode: "unavailable",
        unavailableReason: "admission_config_invalid",
        ...base,
      };
    }
    return {
      mode: "redis",
      redisUrl,
      ...base,
    };
  }

  if (env.NODE_ENV === "production") {
    return {
      mode: "unavailable",
      unavailableReason: "redis_not_configured",
      ...base,
    };
  }

  return {
    mode: "memory",
    ...base,
  };
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
}

function readNonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= maxPstnAdmissionConcurrencyLimit
    ? parsed
    : fallback;
}

function readBoundedPositiveNumber(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
}

function isExplicitInvalidPositiveNumber(
  value: string | undefined,
  maximum: number,
) {
  if (value === undefined) {
    return true;
  }
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed <= 0 || parsed > maximum;
}

function isExplicitInvalidPositiveInteger(
  value: string | undefined,
  maximum: number,
) {
  if (value === undefined) {
    return false;
  }
  const parsed = Number(value);
  return !Number.isInteger(parsed) || parsed <= 0 || parsed > maximum;
}

function readOptionalBoundedNonNegativeInteger(
  value: string | undefined,
  maximum: number,
) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? parsed
    : undefined;
}

function isExplicitInvalidOptionalNonNegativeInteger(
  value: string | undefined,
  maximum: number,
) {
  if (value === undefined) {
    return false;
  }
  return readOptionalBoundedNonNegativeInteger(value, maximum) === undefined;
}

function isExplicitInvalidNonNegativeInteger(value: string | undefined) {
  if (value === undefined) {
    return false;
  }
  const parsed = Number(value);
  return (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > maxPstnAdmissionConcurrencyLimit
  );
}

function nonEmpty(value: string | undefined) {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
