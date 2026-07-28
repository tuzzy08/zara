import {
  assertPstnCallAdmissionActivationInput,
  assertPstnCallAdmissionInput,
  assertPstnCallAdmissionLeaseInput,
  assertPstnCallAdmissionReleaseInput,
  type PstnAdmissionLimitingDimension,
  type PstnAdmissionReasonCode,
  type PstnCallAdmission,
  type PstnCallAdmissionActivationInput,
  type PstnCallAdmissionActivateResult,
  type PstnCallAdmissionDimensionUsageInput,
  type PstnCallAdmissionHealth,
  type PstnCallAdmissionInput,
  type PstnCallAdmissionLeaseInput,
  type PstnCallAdmissionReleaseInput,
  type PstnCallAdmissionReleaseResult,
  type PstnCallAdmissionRenewResult,
  type PstnCallAdmissionReserveResult,
  type PstnCallAdmissionTokenBucket,
  type PstnCallAdmissionUsageInput,
} from "./pstn-call-admission";

interface InMemoryReservation {
  fingerprint: string;
  input: PstnCallAdmissionInput;
  state: "claim" | "active";
  expiresAtMs: number;
  limitingDimension: ConcurrencyDimension;
  remainingCapacity: number;
  ownershipEpoch?: number | undefined;
}

interface InMemoryTokenBucket {
  tokens: number;
  updatedAtMs: number;
}

interface InMemoryRecoveryHold {
  ownerWorkerId: string;
  ownershipEpoch: number;
  blockAtMs: number;
  expiresAtMs: number;
}

type ConcurrencyDimension = Exclude<
  PstnAdmissionLimitingDimension,
  "global_cps" | "provider_account_cps" | "backend"
>;
type ConcurrencyReasonCode = Exclude<
  PstnAdmissionReasonCode,
  | "global_cps_limit"
  | "provider_account_cps_limit"
  | "backend_unavailable"
  | "indeterminate_result"
>;

const concurrencyChecks: ReadonlyArray<{
  limit: keyof PstnCallAdmissionInput["limits"];
  reasonCode: ConcurrencyReasonCode;
  limitingDimension: ConcurrencyDimension;
  matches(
    left: PstnCallAdmissionInput,
    right: PstnCallAdmissionInput,
  ): boolean;
}> = [
  {
    limit: "global",
    reasonCode: "global_concurrency_limit",
    limitingDimension: "global_concurrency",
    matches: () => true,
  },
  {
    limit: "provider",
    reasonCode: "provider_concurrency_limit",
    limitingDimension: "provider_concurrency",
    matches: (left, right) => left.provider === right.provider,
  },
  {
    limit: "providerAccount",
    reasonCode: "provider_account_concurrency_limit",
    limitingDimension: "provider_account_concurrency",
    matches: (left, right) =>
      left.provider === right.provider &&
      left.providerAccountId === right.providerAccountId,
  },
  {
    limit: "tenant",
    reasonCode: "tenant_concurrency_limit",
    limitingDimension: "tenant_concurrency",
    matches: (left, right) => left.tenantId === right.tenantId,
  },
  {
    limit: "runtime",
    reasonCode: "runtime_concurrency_limit",
    limitingDimension: "runtime_concurrency",
    matches: (left, right) => left.runtime === right.runtime,
  },
  {
    limit: "worker",
    reasonCode: "worker_concurrency_limit",
    limitingDimension: "worker_concurrency",
    matches: (left, right) => left.workerId === right.workerId,
  },
];

function resolveConcurrencyLimit(
  input: PstnCallAdmissionInput,
  limit: keyof PstnCallAdmissionInput["limits"],
) {
  return limit === "providerAccount"
    ? input.limits.providerAccount ?? input.limits.provider
    : input.limits[limit];
}

export class InMemoryPstnCallAdmission implements PstnCallAdmission {
  private readonly reservations = new Map<string, InMemoryReservation>();
  private readonly recoveryHolds = new Map<string, InMemoryRecoveryHold>();
  private readonly tokenBuckets = new Map<string, InMemoryTokenBucket>();

  constructor(private readonly now: () => number = Date.now) {}

  async getUsage(input: PstnCallAdmissionUsageInput) {
    this.reclaimExpiredReservations(this.now());
    const reservations = [...this.reservations.values()];
    return {
      status: "available" as const,
      counts: {
        global: dimensionUsage(reservations),
        provider: dimensionUsage(reservations.filter(
          (reservation) => reservation.input.provider === input.provider,
        )),
        providerAccount: dimensionUsage(reservations.filter(
          (reservation) =>
            reservation.input.provider === input.provider &&
            reservation.input.providerAccountId === input.providerAccountId,
        )),
        tenant: dimensionUsage(reservations.filter(
          (reservation) => reservation.input.tenantId === input.tenantId,
        )),
        runtime: dimensionUsage(reservations.filter(
          (reservation) => reservation.input.runtime === input.runtime,
        )),
        worker: dimensionUsage(reservations.filter(
          (reservation) => reservation.input.workerId === input.workerId,
        )),
      },
    };
  }

  async getDimensionUsage(
    inputs: readonly PstnCallAdmissionDimensionUsageInput[],
  ) {
    this.reclaimExpiredReservations(this.now());
    const reservations = [...this.reservations.values()];
    return {
      status: "available" as const,
      counts: inputs.map((input) =>
        dimensionUsage(
          reservations.filter((reservation) =>
            matchesUsageDimension(reservation, input)
          ),
        )
      ),
    };
  }

  async reserve(
    input: PstnCallAdmissionInput,
  ): Promise<PstnCallAdmissionReserveResult> {
    if (!isValidInput(input)) {
      return {
        outcome: "denied",
        reasonCode: "indeterminate_result",
      };
    }

    const nowMs = this.now();
    this.reclaimExpiredReservations(nowMs);
    this.pruneExpiredRecoveryHolds(nowMs);
    const fingerprint = createScopeFingerprint(input);
    const existing = this.reservations.get(input.reservationId);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return {
          outcome: "denied",
          reasonCode: "indeterminate_result",
        };
      }
      return {
        outcome: "admitted",
        disposition: "existing",
        leaseExpiresAt: toIso(existing.expiresAtMs),
        limitingDimension: existing.limitingDimension,
        remainingCapacity: existing.remainingCapacity,
      };
    }
    if (this.hasMaturedRecoveryHold(nowMs)) {
      return {
        outcome: "denied",
        reasonCode: "indeterminate_result",
      };
    }

    let limitingCheck = concurrencyChecks[0]!;
    let lowestRemainingCapacity = Number.POSITIVE_INFINITY;
    for (const check of concurrencyChecks) {
      const used = [...this.reservations.values()].filter((reservation) =>
        check.matches(reservation.input, input),
      ).length;
      const remainingCapacity = resolveConcurrencyLimit(input, check.limit) - used;
      if (remainingCapacity < lowestRemainingCapacity) {
        limitingCheck = check;
        lowestRemainingCapacity = remainingCapacity;
      }
      if (remainingCapacity <= 0) {
        return {
          outcome: "denied",
          reasonCode: check.reasonCode,
          limitingDimension: check.limitingDimension,
          remainingCapacity: 0,
        };
      }
    }

    const globalBucket = this.readBucket(
      "global",
      input.cps.global,
      nowMs,
    );
    const accountBucketKey = JSON.stringify([
      "account",
      input.provider,
      input.providerAccountId,
    ]);
    const accountBucket = this.readBucket(
      accountBucketKey,
      input.cps.providerAccount,
      nowMs,
    );
    if (globalBucket.tokens < 1) {
      return {
        outcome: "denied",
        reasonCode: "global_cps_limit",
        limitingDimension: "global_cps",
      };
    }
    if (accountBucket.tokens < 1) {
      return {
        outcome: "denied",
        reasonCode: "provider_account_cps_limit",
        limitingDimension: "provider_account_cps",
      };
    }

    this.tokenBuckets.set("global", {
      tokens: globalBucket.tokens - 1,
      updatedAtMs: nowMs,
    });
    this.tokenBuckets.set(accountBucketKey, {
      tokens: accountBucket.tokens - 1,
      updatedAtMs: nowMs,
    });
    const expiresAtMs = nowMs + input.claimTtlMs;
    this.reservations.set(input.reservationId, {
      fingerprint,
      input,
      state: "claim",
      expiresAtMs,
      limitingDimension: limitingCheck.limitingDimension,
      remainingCapacity: lowestRemainingCapacity - 1,
    });

    return {
      outcome: "admitted",
      disposition: "created",
      leaseExpiresAt: toIso(expiresAtMs),
      limitingDimension: limitingCheck.limitingDimension,
      remainingCapacity: lowestRemainingCapacity - 1,
    };
  }

  async activate(
    input: PstnCallAdmissionActivationInput,
  ): Promise<PstnCallAdmissionActivateResult> {
    if (!isValidActivationInput(input)) {
      return { outcome: "not_found" };
    }

    const nowMs = this.now();
    this.reclaimExpiredReservations(nowMs);
    this.pruneExpiredRecoveryHolds(nowMs);
    let reservation = this.reservations.get(input.reservationId);
    if (reservation === undefined) {
      if (!("limits" in input)) {
        return { outcome: "not_found" };
      }
      const recoveryHold = this.recoveryHolds.get(input.reservationId);
      if (recoveryHold === undefined) {
        return { outcome: "not_found" };
      }
      if (recoveryHold.ownerWorkerId !== input.workerId) {
        return { outcome: "not_owner" };
      }
      let limitingCheck = concurrencyChecks[0]!;
      let lowestRemainingCapacity = Number.POSITIVE_INFINITY;
      for (const check of concurrencyChecks) {
        const used = [...this.reservations.values()].filter((candidate) =>
          check.matches(candidate.input, input),
        ).length;
        const remainingCapacity = resolveConcurrencyLimit(input, check.limit) - used;
        if (remainingCapacity < lowestRemainingCapacity) {
          limitingCheck = check;
          lowestRemainingCapacity = remainingCapacity;
        }
        if (remainingCapacity <= 0) {
          this.setRecoveryHold(
            input.reservationId,
            input.workerId,
            nowMs,
            input.activeTtlMs,
            recoveryHold.ownershipEpoch,
          );
          return {
            outcome: "denied",
            reasonCode: check.reasonCode,
          };
        }
      }
      const expiresAtMs = nowMs + input.activeTtlMs;
      reservation = {
        fingerprint: createScopeFingerprint(input),
        input,
        state: "active",
        expiresAtMs,
        limitingDimension: limitingCheck.limitingDimension,
        remainingCapacity: lowestRemainingCapacity - 1,
        ownershipEpoch: recoveryHold.ownershipEpoch + 1,
      };
      this.reservations.set(input.reservationId, reservation);
      const ownershipEpoch = recoveryHold.ownershipEpoch + 1;
      reservation.ownershipEpoch = ownershipEpoch;
      this.setRecoveryHold(
        input.reservationId,
        input.workerId,
        expiresAtMs,
        input.activeTtlMs,
        ownershipEpoch,
      );
      return {
        outcome: "activated",
        leaseExpiresAt: toIso(expiresAtMs),
        ownershipEpoch,
      };
    }

    if (
      reservation.state === "active" &&
      reservation.input.workerId !== input.workerId
    ) {
      return { outcome: "not_owner" };
    }
    if (reservation.input.workerId !== input.workerId) {
      const workerLimit =
        "workerLimit" in input ? input.workerLimit : input.limits.worker;
      const destinationWorkerUse = [...this.reservations.values()].filter(
        (candidate) =>
          candidate !== reservation &&
          candidate.input.workerId === input.workerId,
      ).length;
      if (destinationWorkerUse >= workerLimit) {
        return {
          outcome: "denied",
          reasonCode: "worker_concurrency_limit",
        };
      }
      reservation.input = {
        ...reservation.input,
        workerId: input.workerId,
        limits: {
          ...reservation.input.limits,
          worker: workerLimit,
        },
      };
      const recoveryHold = this.recoveryHolds.get(input.reservationId);
      if (recoveryHold !== undefined) {
        recoveryHold.ownerWorkerId = input.workerId;
      }
    }
    if (reservation.state === "active") {
      this.setRecoveryHold(
        input.reservationId,
        reservation.input.workerId,
        reservation.expiresAtMs,
        input.activeTtlMs,
        reservation.ownershipEpoch ?? 1,
      );
      return {
        outcome: "existing",
        leaseExpiresAt: toIso(reservation.expiresAtMs),
        ownershipEpoch: reservation.ownershipEpoch ?? 1,
      };
    }
    reservation.state = "active";
    reservation.ownershipEpoch = 1;
    reservation.expiresAtMs = nowMs + input.activeTtlMs;
    this.setRecoveryHold(
      input.reservationId,
      reservation.input.workerId,
      reservation.expiresAtMs,
      input.activeTtlMs,
      reservation.ownershipEpoch,
    );
    return {
      outcome: "activated",
      leaseExpiresAt: toIso(reservation.expiresAtMs),
      ownershipEpoch: reservation.ownershipEpoch,
    };
  }

  async renew(
    input: PstnCallAdmissionLeaseInput,
  ): Promise<PstnCallAdmissionRenewResult> {
    if (!isValidLeaseInput(input)) {
      return { outcome: "not_found" };
    }

    const nowMs = this.now();
    this.reclaimExpiredReservations(nowMs);
    this.pruneExpiredRecoveryHolds(nowMs);
    const reservation = this.reservations.get(input.reservationId);
    if (reservation === undefined || reservation.state !== "active") {
      return { outcome: "not_found" };
    }
    if (
      reservation.input.workerId !== input.workerId ||
      reservation.ownershipEpoch !== input.ownershipEpoch
    ) {
      return { outcome: "not_owner" };
    }

    reservation.expiresAtMs = nowMs + input.activeTtlMs;
    this.setRecoveryHold(
      input.reservationId,
      input.workerId,
      reservation.expiresAtMs,
      input.activeTtlMs,
      input.ownershipEpoch,
    );
    return {
      outcome: "renewed",
      leaseExpiresAt: toIso(reservation.expiresAtMs),
      ownershipEpoch: input.ownershipEpoch,
    };
  }

  async release(
    input: PstnCallAdmissionReleaseInput,
  ): Promise<PstnCallAdmissionReleaseResult> {
    if (!isValidReleaseInput(input)) {
      return { outcome: "not_found" };
    }

    const nowMs = this.now();
    this.reclaimExpiredReservations(nowMs);
    this.pruneExpiredRecoveryHolds(nowMs);
    const reservation = this.reservations.get(input.reservationId);
    if (reservation === undefined) {
      if (!("ownershipEpoch" in input)) {
        this.recoveryHolds.delete(input.reservationId);
      }
      return { outcome: "not_found" };
    }
    if (
      "ownershipEpoch" in input &&
      (reservation.state !== "active" ||
        reservation.input.workerId !== input.workerId ||
        reservation.ownershipEpoch !== input.ownershipEpoch)
    ) {
      return { outcome: "not_owner" };
    }

    this.recoveryHolds.delete(input.reservationId);
    this.reservations.delete(input.reservationId);
    return { outcome: "released" };
  }

  async getHealth(): Promise<PstnCallAdmissionHealth> {
    return {
      status: "healthy",
      backend: "memory",
    };
  }

  private reclaimExpiredReservations(nowMs: number) {
    for (const [reservationId, reservation] of this.reservations) {
      if (reservation.expiresAtMs <= nowMs) {
        this.reservations.delete(reservationId);
      }
    }
  }

  private pruneExpiredRecoveryHolds(nowMs: number) {
    for (const [reservationId, recoveryHold] of this.recoveryHolds) {
      if (recoveryHold.expiresAtMs <= nowMs) {
        this.recoveryHolds.delete(reservationId);
      }
    }
  }

  private hasMaturedRecoveryHold(nowMs: number) {
    return [...this.recoveryHolds.values()].some(
      (recoveryHold) => recoveryHold.blockAtMs <= nowMs,
    );
  }

  private setRecoveryHold(
    reservationId: string,
    ownerWorkerId: string,
    blockAtMs: number,
    activeTtlMs: number,
    ownershipEpoch: number,
  ) {
    this.recoveryHolds.set(reservationId, {
      ownerWorkerId,
      ownershipEpoch,
      blockAtMs,
      expiresAtMs: blockAtMs + activeTtlMs,
    });
  }

  private readBucket(
    key: string,
    config: PstnCallAdmissionTokenBucket,
    nowMs: number,
  ) {
    const current = this.tokenBuckets.get(key);
    if (current === undefined) {
      return {
        tokens: config.capacity,
        updatedAtMs: nowMs,
      };
    }

    const elapsedSeconds = Math.max(0, nowMs - current.updatedAtMs) / 1_000;
    return {
      tokens: Math.min(
        config.capacity,
        current.tokens + elapsedSeconds * config.refillPerSecond,
      ),
      updatedAtMs: nowMs,
    };
  }
}

function createScopeFingerprint(input: PstnCallAdmissionInput) {
  return JSON.stringify([
    input.callSessionId,
    input.tenantId,
    input.providerAccountId,
    input.provider,
    input.runtime,
  ]);
}

function matchesUsageDimension(
  reservation: InMemoryReservation,
  input: PstnCallAdmissionDimensionUsageInput,
) {
  if (input.dimension === "global") return true;
  if (input.dimension === "provider") {
    return reservation.input.provider === input.provider;
  }
  if (input.dimension === "providerAccount") {
    return reservation.input.provider === input.provider &&
      reservation.input.providerAccountId === input.providerAccountId;
  }
  if (input.dimension === "tenant") {
    return reservation.input.tenantId === input.tenantId;
  }
  if (input.dimension === "runtime") {
    return reservation.input.runtime === input.runtime;
  }
  return reservation.input.workerId === input.workerId;
}

function dimensionUsage(reservations: InMemoryReservation[]) {
  return {
    total: reservations.length,
    active: reservations.filter((reservation) => reservation.state === "active")
      .length,
    reservations: reservations.filter(
      (reservation) => reservation.state === "claim",
    ).length,
  };
}

function isValidActivationInput(input: PstnCallAdmissionActivationInput) {
  try {
    assertPstnCallAdmissionActivationInput(input);
    return true;
  } catch {
    return false;
  }
}

function isValidLeaseInput(input: PstnCallAdmissionLeaseInput) {
  try {
    assertPstnCallAdmissionLeaseInput(input);
    return true;
  } catch {
    return false;
  }
}

function isValidReleaseInput(input: PstnCallAdmissionReleaseInput) {
  try {
    assertPstnCallAdmissionReleaseInput(input);
    return true;
  } catch {
    return false;
  }
}

function isValidInput(input: PstnCallAdmissionInput) {
  try {
    assertPstnCallAdmissionInput(input);
    return true;
  } catch {
    return false;
  }
}

function toIso(timestampMs: number) {
  return new Date(timestampMs).toISOString();
}
