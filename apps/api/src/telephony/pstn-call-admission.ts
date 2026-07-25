export const PSTN_CALL_ADMISSION = Symbol("PSTN_CALL_ADMISSION");
export const maxPstnAdmissionConcurrencyLimit = 1_000_000;
export const maxPstnAdmissionLeaseTtlMs = 300_000;
export const maxPstnAdmissionBucketCapacity = 100_000;
export const maxPstnAdmissionRefillPerSecond = 100_000;

export const PSTN_ADMISSION_REASON_CODES = [
  "global_concurrency_limit",
  "provider_concurrency_limit",
  "tenant_concurrency_limit",
  "runtime_concurrency_limit",
  "worker_concurrency_limit",
  "global_cps_limit",
  "provider_account_cps_limit",
  "backend_unavailable",
  "indeterminate_result",
] as const;

export type PstnAdmissionReasonCode =
  (typeof PSTN_ADMISSION_REASON_CODES)[number];

export type PstnAdmissionLimitingDimension =
  | "global_concurrency"
  | "provider_concurrency"
  | "tenant_concurrency"
  | "runtime_concurrency"
  | "worker_concurrency"
  | "global_cps"
  | "provider_account_cps"
  | "backend";

export interface PstnCallAdmissionLimits {
  global: number;
  provider: number;
  tenant: number;
  runtime: number;
  worker: number;
}

export interface PstnCallAdmissionTokenBucket {
  capacity: number;
  refillPerSecond: number;
}

export interface PstnCallAdmissionInput {
  reservationId: string;
  callSessionId: string;
  tenantId: string;
  providerAccountId: string;
  workerId: string;
  provider: string;
  runtime: string;
  limits: PstnCallAdmissionLimits;
  cps: {
    global: PstnCallAdmissionTokenBucket;
    providerAccount: PstnCallAdmissionTokenBucket;
  };
  claimTtlMs: number;
  activeTtlMs: number;
}

export interface PstnCallAdmissionLeaseInput {
  reservationId: string;
  workerId: string;
  activeTtlMs: number;
}

export type PstnCallAdmissionActivationInput =
  | PstnCallAdmissionInput
  | (PstnCallAdmissionLeaseInput & {
      workerId: string;
      workerLimit: number;
    });

export interface PstnCallAdmissionReleaseInput {
  reservationId: string;
}

export type PstnCallAdmissionReserveResult =
  | {
      outcome: "admitted";
      disposition: "created" | "existing";
      leaseExpiresAt: string;
      limitingDimension: Exclude<
        PstnAdmissionLimitingDimension,
        "global_cps" | "provider_account_cps" | "backend"
      >;
      remainingCapacity: number;
    }
  | {
      outcome: "denied";
      reasonCode: PstnAdmissionReasonCode;
      limitingDimension?: PstnAdmissionLimitingDimension;
      remainingCapacity?: number;
    };

export type PstnCallAdmissionActivateResult =
  | {
      outcome: "activated" | "existing";
      leaseExpiresAt: string;
    }
  | {
      outcome: "not_found";
    }
  | {
      outcome: "not_owner";
    }
  | {
      outcome: "denied";
      reasonCode: Exclude<
        PstnAdmissionReasonCode,
        | "global_cps_limit"
        | "provider_account_cps_limit"
        | "backend_unavailable"
        | "indeterminate_result"
      >;
    }
  | {
      outcome: "backend_unavailable";
    };

export type PstnCallAdmissionRenewResult =
  | {
      outcome: "renewed";
      leaseExpiresAt: string;
    }
  | {
      outcome: "not_found";
    }
  | {
      outcome: "not_owner";
    }
  | {
      outcome: "backend_unavailable";
    };

export type PstnCallAdmissionReleaseResult = {
  outcome: "released" | "not_found" | "backend_unavailable";
};

export type PstnCallAdmissionHealth =
  | {
      status: "healthy";
      backend: "memory" | "redis";
    }
  | {
      status: "unavailable";
      backend: "redis";
      reasonCode: "backend_unavailable" | "indeterminate_result";
      unavailableReason?:
        | "redis_not_configured"
        | "admission_config_invalid"
        | undefined;
    };

export interface PstnCallAdmission {
  reserve(
    input: PstnCallAdmissionInput,
  ): Promise<PstnCallAdmissionReserveResult>;
  activate(
    input: PstnCallAdmissionActivationInput,
  ): Promise<PstnCallAdmissionActivateResult>;
  renew(
    input: PstnCallAdmissionLeaseInput,
  ): Promise<PstnCallAdmissionRenewResult>;
  release(
    input: PstnCallAdmissionReleaseInput,
  ): Promise<PstnCallAdmissionReleaseResult>;
  getHealth(): Promise<PstnCallAdmissionHealth>;
}

export function assertPstnCallAdmissionLeaseInput(
  input: PstnCallAdmissionLeaseInput,
): void {
  if (
    !isOpaqueValue(input.reservationId) ||
    !isOpaqueValue(input.workerId) ||
    !isBoundedLeaseTtl(input.activeTtlMs)
  ) {
    throw new Error("Invalid PSTN call admission lease input.");
  }
}

export function assertPstnCallAdmissionActivationInput(
  input: PstnCallAdmissionActivationInput,
): void {
  assertPstnCallAdmissionLeaseInput(input);
  const workerLimit =
    "workerLimit" in input ? input.workerLimit : input.limits.worker;
  if (
    !isOpaqueValue(input.workerId) ||
    !Number.isInteger(workerLimit) ||
    workerLimit < 0 ||
    workerLimit > maxPstnAdmissionConcurrencyLimit
  ) {
    throw new Error("Invalid PSTN call admission activation input.");
  }
}

export function assertPstnCallAdmissionReleaseInput(
  input: PstnCallAdmissionReleaseInput,
): void {
  if (!isOpaqueValue(input.reservationId)) {
    throw new Error("Invalid PSTN call admission release input.");
  }
}

const maxOpaqueValueLength = 512;

export function assertPstnCallAdmissionInput(
  input: PstnCallAdmissionInput,
): void {
  const opaqueValues = [
    input.reservationId,
    input.callSessionId,
    input.tenantId,
    input.providerAccountId,
    input.workerId,
    input.provider,
    input.runtime,
  ];
  const limits = Object.values(input.limits);
  const buckets = [input.cps.global, input.cps.providerAccount];
  const valid =
    opaqueValues.every(isOpaqueValue) &&
    limits.every(
      (value) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value <= maxPstnAdmissionConcurrencyLimit,
    ) &&
    buckets.every(
      ({ capacity, refillPerSecond }) =>
        Number.isInteger(capacity) &&
        capacity > 0 &&
        capacity <= maxPstnAdmissionBucketCapacity &&
        Number.isFinite(refillPerSecond) &&
        refillPerSecond > 0 &&
        refillPerSecond <= maxPstnAdmissionRefillPerSecond,
    ) &&
    isBoundedLeaseTtl(input.claimTtlMs) &&
    isBoundedLeaseTtl(input.activeTtlMs);

  if (!valid) {
    throw new Error("Invalid PSTN call admission input.");
  }
}

function isOpaqueValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxOpaqueValueLength
  );
}

function isBoundedLeaseTtl(value: number) {
  return (
    Number.isInteger(value) &&
    value > 0 &&
    value <= maxPstnAdmissionLeaseTtlMs
  );
}
