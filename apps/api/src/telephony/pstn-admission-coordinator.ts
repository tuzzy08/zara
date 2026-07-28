import type { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import type {
  PstnAdmissionConfig,
  PstnAdmissionRuntimePath,
} from "./pstn-admission-config";
import type {
  PstnAdmissionReasonCode,
  PstnCallAdmission,
  PstnCallAdmissionInput,
  PstnCallAdmissionReleaseResult,
  PstnCallAdmissionReserveResult,
} from "./pstn-call-admission";

export interface PstnAdmissionScope {
  tenantId: string;
  callSessionId: string;
  provider: string;
  providerAccountId: string;
  runtime: PstnAdmissionRuntimePath;
  workerId?: string | undefined;
  providerAvailable?: boolean | undefined;
}

interface TrackedAdmission {
  input: PstnCallAdmissionInput;
  state: "claim" | "active";
  ownershipEpoch?: number | undefined;
  confirmedLeaseExpiresAtMs?: number | undefined;
  ownershipLossStarted?: boolean | undefined;
}

interface PendingRelease {
  input: PstnCallAdmissionInput | undefined;
  ownershipEpoch: number | undefined;
  failureCount: number;
  nextRetryAt: number;
  inFlight: Promise<PstnCallAdmissionReleaseResult> | undefined;
}

type PstnAdmissionRecoveryScope = Pick<
  PstnAdmissionScope,
  "provider" | "providerAccountId" | "runtime"
>;

type PstnAdmissionObservability = Pick<
  PstnCapacityObservability,
  | "recordAdmission"
  | "recordAdmissionLease"
  | "recordAdmissionOwnershipLost"
  | "recordAdmissionBackendHealth"
  | "recordPendingRelease"
  | "recordAdmissionPosture"
>;

interface PstnAdmissionPolicyResolver {
  resolveAdmissionPolicy(
    scope: Pick<
      PstnAdmissionScope,
      | "tenantId"
      | "provider"
      | "providerAccountId"
      | "runtime"
      | "workerId"
      | "providerAvailable"
    >,
  ): Promise<Pick<PstnCallAdmissionInput, "limits" | "cps">>;
}

interface PstnCapacityRejectionRecorder {
  record(input: {
    tenantId: string;
    callSessionId: string;
    reasonCode: PstnAdmissionReasonCode;
  }): Promise<void>;
}

export interface PstnAdmissionOwnershipLostEvent {
  tenantId: string;
  callSessionId: string;
  runtime: PstnAdmissionRuntimePath;
  reason: "lease_unrecoverable" | "not_owner";
}

export interface PstnAdmissionOwnershipConfirmedEvent {
  tenantId: string;
  callSessionId: string;
  runtime: PstnAdmissionRuntimePath;
  workerId: string;
  ownershipEpoch: number;
  leaseExpiresAt: string;
  operation: "renew" | "recover";
}

export class PstnAdmissionCoordinator {
  private readonly tracked = new Map<string, TrackedAdmission>();
  private readonly unresolvedActiveLeases = new Set<string>();
  private readonly pendingReleases = new Map<string, PendingRelease>();
  private renewalTimer: ReturnType<typeof setInterval> | undefined;
  private ownershipDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private releaseRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;
  private inFlightRejectionRecords = 0;
  private readonly ownershipLostListeners = new Set<
    (event: PstnAdmissionOwnershipLostEvent) => void | Promise<void>
  >();
  private readonly ownershipConfirmedListeners = new Set<
    (event: PstnAdmissionOwnershipConfirmedEvent) => void | Promise<void>
  >();

  constructor(
    private readonly admission: PstnCallAdmission,
    private readonly config: PstnAdmissionConfig,
    private readonly observability?: PstnAdmissionObservability,
    private readonly policyResolver?: PstnAdmissionPolicyResolver,
    private readonly rejectionRecorder?: PstnCapacityRejectionRecorder,
  ) {}

  async reserve(
    scope: PstnAdmissionScope,
  ): Promise<PstnCallAdmissionReserveResult> {
    const startedAt = Date.now();
    let input: PstnCallAdmissionInput;
    try {
      input = await this.buildInput(scope);
    } catch {
      const result = {
        outcome: "denied" as const,
        reasonCode: "backend_unavailable" as const,
        limitingDimension: "backend" as const,
      };
      this.observability?.recordAdmission({
        outcome: "denied",
        reasonCode: result.reasonCode,
        limitingDimension: result.limitingDimension,
        runtimePath: scope.runtime,
        provider: scope.provider,
        latencyMs: Date.now() - startedAt,
      });
      void this.recordRejection(scope, result.reasonCode);
      return result;
    }
    if (this.unresolvedActiveLeases.size > 0) {
      const result = {
        outcome: "denied" as const,
        reasonCode: "indeterminate_result" as const,
      };
      this.observability?.recordAdmission({
        outcome: "denied",
        reasonCode: result.reasonCode,
        runtimePath: scope.runtime,
        provider: scope.provider,
        latencyMs: Date.now() - startedAt,
      });
      void this.recordRejection(scope, result.reasonCode);
      return result;
    }
    const result = await this.admission.reserve(input);
    this.observability?.recordAdmission({
      outcome:
        result.outcome === "admitted"
          ? `admitted_${result.disposition}`
          : "denied",
      ...(result.outcome === "denied"
        ? { reasonCode: result.reasonCode }
        : {}),
      ...(result.limitingDimension === undefined
        ? {}
        : { limitingDimension: result.limitingDimension }),
      ...(result.remainingCapacity === undefined
        ? {}
        : { remainingCapacity: result.remainingCapacity }),
      runtimePath: scope.runtime,
      provider: scope.provider,
      latencyMs: Date.now() - startedAt,
    });
    if (result.outcome === "admitted") {
      const key = this.trackingKey(scope.tenantId, scope.callSessionId);
      const existing = this.tracked.get(key);
      if (result.disposition !== "existing" || existing?.state !== "active") {
        this.tracked.set(key, {
          input,
          state: "claim",
        });
        this.recordAdmissionPosture();
      }
    } else {
      void this.recordRejection(scope, result.reasonCode);
    }
    return result;
  }

  async activate(
    tenantId: string,
    callSessionId: string,
    recoveryScope?: PstnAdmissionRecoveryScope,
  ) {
    const key = this.trackingKey(tenantId, callSessionId);
    const tracked = this.tracked.get(key);
    let recoveryInput = tracked?.input;
    if (recoveryInput === undefined) {
      if (!isCompleteRecoveryScope(recoveryScope)) {
        return { outcome: "not_found" as const };
      }
      recoveryInput = await this.buildRecoveryInput(
        tenantId,
        callSessionId,
        recoveryScope,
      );
    }

    const result = await this.admission.activate({
      reservationId: key,
      workerId: recoveryInput.workerId,
      workerLimit: recoveryInput.limits.worker,
      activeTtlMs: this.config.activeTtlMs,
    });
    this.recordLease(
      "activate",
      result.outcome,
      recoveryInput,
    );
    if (result.outcome === "activated" || result.outcome === "existing") {
      this.tracked.set(key, {
        input: recoveryInput,
        state: "active",
        ownershipEpoch: result.ownershipEpoch,
        confirmedLeaseExpiresAtMs: parseLeaseDeadline(
          result.leaseExpiresAt,
        ),
      });
      this.recordAdmissionPosture();
      this.ensureRenewalTimer();
      this.scheduleOwnershipDeadlineCheck();
    }
    return result;
  }

  async release(
    tenantId: string,
    callSessionId: string,
  ): Promise<PstnCallAdmissionReleaseResult> {
    const key = this.trackingKey(tenantId, callSessionId);
    const pending = this.pendingReleases.get(key);
    if (pending !== undefined) {
      return (
        pending.inFlight ?? Promise.resolve({ outcome: "backend_unavailable" })
      );
    }
    const tracked = this.tracked.get(key);
    this.tracked.delete(key);
    this.unresolvedActiveLeases.delete(key);
    this.scheduleOwnershipDeadlineCheck();
    this.stopRenewalTimerWhenIdle();
    const releaseIntent: PendingRelease = {
      input: tracked?.input,
      ownershipEpoch: tracked?.ownershipEpoch,
      failureCount: 0,
      nextRetryAt: Date.now(),
      inFlight: undefined,
    };
    this.pendingReleases.set(key, releaseIntent);
    this.recordAdmissionPosture();
    this.observability?.recordPendingRelease({
      delta: 1,
      runtimePath: releaseIntent.input?.runtime ?? "unknown",
      provider: releaseIntent.input?.provider ?? "unknown",
    });
    return this.attemptRelease(key, releaseIntent);
  }

  async getHealth() {
    const health = await this.admission.getHealth();
    this.observability?.recordAdmissionBackendHealth({
      status: health.status,
      ...(health.status === "unavailable"
        ? { reasonCode: health.reasonCode }
        : {}),
    });
    return health;
  }

  onOwnershipLost(
    listener: (
      event: PstnAdmissionOwnershipLostEvent,
    ) => void | Promise<void>,
  ) {
    this.ownershipLostListeners.add(listener);
    return () => {
      this.ownershipLostListeners.delete(listener);
    };
  }

  onOwnershipConfirmed(
    listener: (
      event: PstnAdmissionOwnershipConfirmedEvent,
    ) => void | Promise<void>,
  ) {
    this.ownershipConfirmedListeners.add(listener);
    return () => {
      this.ownershipConfirmedListeners.delete(listener);
    };
  }

  shutdown() {
    this.shutdownPromise ??= this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown() {
    this.shuttingDown = true;
    this.clearRenewalTimer();
    this.clearOwnershipDeadlineTimer();
    this.clearReleaseRetryTimer();
    await Promise.allSettled(
      [...this.pendingReleases.values()]
        .map((pending) => pending.inFlight)
        .filter(
          (
            inFlight,
          ): inFlight is Promise<PstnCallAdmissionReleaseResult> =>
            inFlight !== undefined,
        ),
    );
    await Promise.allSettled(
      [...this.pendingReleases.entries()].map(([key, pending]) =>
        this.attemptRelease(key, pending),
      ),
    );
    this.tracked.clear();
    this.unresolvedActiveLeases.clear();
    this.pendingReleases.clear();
    this.recordAdmissionPosture();
  }

  private async buildInput(
    scope: PstnAdmissionScope,
  ): Promise<PstnCallAdmissionInput> {
    const workerId = scope.workerId ?? this.config.workerId;
    const resolved = await this.policyResolver?.resolveAdmissionPolicy({
      ...scope,
      workerId,
    });
    return {
      reservationId: this.trackingKey(scope.tenantId, scope.callSessionId),
      callSessionId: scope.callSessionId,
      tenantId: scope.tenantId,
      providerAccountId: scope.providerAccountId,
      workerId,
      provider: scope.provider,
      runtime: scope.runtime,
      limits: resolved?.limits ?? {
        global: this.config.limits.global,
        provider:
          scope.providerAvailable === false
            ? 0
            : Math.min(
                this.config.limits.provider,
                this.config.providerQuotaAllowances?.[scope.provider] ??
                  this.config.limits.provider,
              ),
        tenant: this.config.limits.tenant,
        runtime: this.config.limits.runtime[scope.runtime],
        worker: this.config.limits.worker,
      },
      cps: resolved?.cps ?? this.config.cps,
      claimTtlMs: this.config.claimTtlMs,
      activeTtlMs: this.config.activeTtlMs,
    };
  }

  private buildRecoveryInput(
    tenantId: string,
    callSessionId: string,
    recoveryScope: PstnAdmissionRecoveryScope,
  ): Promise<PstnCallAdmissionInput> {
    return this.buildInput({
      tenantId,
      callSessionId,
      provider: recoveryScope.provider,
      providerAccountId: recoveryScope.providerAccountId,
      runtime: recoveryScope.runtime,
    });
  }

  private ensureRenewalTimer() {
    if (this.renewalTimer !== undefined) {
      return;
    }
    this.renewalTimer = setInterval(() => {
      void this.renewActiveLeases();
    }, this.config.renewIntervalMs);
    this.renewalTimer.unref?.();
  }

  private async renewActiveLeases() {
    const active = [...this.tracked.entries()].filter(
      ([, tracked]) => tracked.state === "active",
    );
    await Promise.allSettled(
      active.map(async ([key, tracked]) => {
        if (ownershipLossHasStarted(tracked)) {
          return;
        }
        if (tracked.ownershipEpoch === undefined) {
          this.unresolvedActiveLeases.add(key);
          return;
        }
        let result;
        try {
          result = await this.admission.renew({
            reservationId: tracked.input.reservationId,
            workerId: tracked.input.workerId,
            ownershipEpoch: tracked.ownershipEpoch,
            activeTtlMs: tracked.input.activeTtlMs,
          });
        } catch {
          result = { outcome: "backend_unavailable" as const };
        }
        this.recordLease("renew", result.outcome, tracked.input);
        if (
          this.tracked.get(key) !== tracked ||
          ownershipLossHasStarted(tracked)
        ) {
          return;
        }
        if (result.outcome === "not_owner") {
          await this.loseOwnership(key, tracked, "not_owner");
          return;
        }
        if (result.outcome === "renewed") {
          tracked.confirmedLeaseExpiresAtMs = parseLeaseDeadline(
            result.leaseExpiresAt,
          );
          this.unresolvedActiveLeases.delete(key);
          this.scheduleOwnershipDeadlineCheck();
          const durableOwnershipConfirmed =
            await this.notifyOwnershipConfirmed({
            tracked,
            leaseExpiresAt: result.leaseExpiresAt,
            operation: "renew",
          });
          if (!durableOwnershipConfirmed) {
            await this.loseOwnership(
              key,
              tracked,
              "lease_unrecoverable",
            );
          }
          return;
        }
        this.unresolvedActiveLeases.add(key);
        if (result.outcome === "not_found") {
          const reconciliation = await this.admission.activate(tracked.input);
          this.recordLease(
            "activate",
            reconciliation.outcome,
            tracked.input,
          );
          if (
            reconciliation.outcome === "activated" ||
            reconciliation.outcome === "existing"
          ) {
            tracked.ownershipEpoch = reconciliation.ownershipEpoch;
            tracked.confirmedLeaseExpiresAtMs = parseLeaseDeadline(
              reconciliation.leaseExpiresAt,
            );
            this.unresolvedActiveLeases.delete(key);
            this.scheduleOwnershipDeadlineCheck();
            const durableOwnershipConfirmed =
              await this.notifyOwnershipConfirmed({
              tracked,
              leaseExpiresAt: reconciliation.leaseExpiresAt,
              operation: "recover",
            });
            if (!durableOwnershipConfirmed) {
              await this.loseOwnership(
                key,
                tracked,
                "lease_unrecoverable",
              );
            }
          } else if (reconciliation.outcome === "not_owner") {
            await this.loseOwnership(key, tracked, "not_owner");
          } else if (reconciliation.outcome === "not_found") {
            await this.loseOwnership(
              key,
              tracked,
              "lease_unrecoverable",
            );
          }
        }
      }),
    );
    this.stopRenewalTimerWhenIdle();
  }

  private async loseOwnership(
    key: string,
    tracked: TrackedAdmission,
    reason: PstnAdmissionOwnershipLostEvent["reason"],
    observableReason:
      | PstnAdmissionOwnershipLostEvent["reason"]
      | "confirmed_lease_expired" = reason,
  ) {
    if (
      this.tracked.get(key) !== tracked ||
      ownershipLossHasStarted(tracked)
    ) {
      return;
    }
    tracked.ownershipLossStarted = true;
    this.unresolvedActiveLeases.delete(key);
    await this.notifyOwnershipLost(tracked, reason, observableReason);
    if (this.tracked.get(key) === tracked) {
      await this.release(
        tracked.input.tenantId,
        tracked.input.callSessionId,
      );
    }
    this.scheduleOwnershipDeadlineCheck();
  }

  private async notifyOwnershipLost(
    tracked: TrackedAdmission,
    reason: PstnAdmissionOwnershipLostEvent["reason"] = "not_owner",
    observableReason:
      | PstnAdmissionOwnershipLostEvent["reason"]
      | "confirmed_lease_expired" = reason,
  ) {
    this.observability?.recordAdmissionOwnershipLost({
      reason: observableReason,
      runtimePath: tracked.input.runtime,
      provider: tracked.input.provider,
    });
    const event: PstnAdmissionOwnershipLostEvent = {
      tenantId: tracked.input.tenantId,
      callSessionId: tracked.input.callSessionId,
      runtime: tracked.input.runtime === "pstn-premium-realtime"
        ? "pstn-premium-realtime"
        : "pstn-sandwich",
      reason,
    };
    await Promise.allSettled(
      [...this.ownershipLostListeners].map((listener) => listener(event)),
    );
  }

  private async notifyOwnershipConfirmed(input: {
    tracked: TrackedAdmission;
    leaseExpiresAt: string;
    operation: PstnAdmissionOwnershipConfirmedEvent["operation"];
  }) {
    const ownershipEpoch = input.tracked.ownershipEpoch;
    if (ownershipEpoch === undefined) {
      return;
    }
    const event: PstnAdmissionOwnershipConfirmedEvent = {
      tenantId: input.tracked.input.tenantId,
      callSessionId: input.tracked.input.callSessionId,
      runtime: input.tracked.input.runtime as PstnAdmissionRuntimePath,
      workerId: input.tracked.input.workerId,
      ownershipEpoch,
      leaseExpiresAt: input.leaseExpiresAt,
      operation: input.operation,
    };
    const results = await Promise.allSettled(
      [...this.ownershipConfirmedListeners].map((listener) => listener(event)),
    );
    return results.length > 0
      && results.every((result) => result.status === "fulfilled");
  }

  private scheduleOwnershipDeadlineCheck() {
    this.clearOwnershipDeadlineTimer();
    if (this.shuttingDown) {
      return;
    }
    const nextDeadline = Math.min(
      ...[...this.tracked.values()]
        .filter(
          (tracked) =>
            tracked.state === "active" &&
            !ownershipLossHasStarted(tracked) &&
            tracked.confirmedLeaseExpiresAtMs !== undefined,
        )
        .map((tracked) => tracked.confirmedLeaseExpiresAtMs as number),
    );
    if (!Number.isFinite(nextDeadline)) {
      return;
    }
    this.ownershipDeadlineTimer = setTimeout(() => {
      this.ownershipDeadlineTimer = undefined;
      void this.expireConfirmedLeases();
    }, Math.max(0, nextDeadline - Date.now()));
    this.ownershipDeadlineTimer.unref?.();
  }

  private async expireConfirmedLeases() {
    const now = Date.now();
    const expired = [...this.tracked.entries()].filter(
      ([, tracked]) =>
        tracked.state === "active" &&
        !ownershipLossHasStarted(tracked) &&
        tracked.confirmedLeaseExpiresAtMs !== undefined &&
        tracked.confirmedLeaseExpiresAtMs <= now,
    );
    await Promise.allSettled(
      expired.map(([key, tracked]) =>
        this.loseOwnership(
          key,
          tracked,
          "lease_unrecoverable",
          "confirmed_lease_expired",
        ),
      ),
    );
    this.scheduleOwnershipDeadlineCheck();
    this.stopRenewalTimerWhenIdle();
  }

  private stopRenewalTimerWhenIdle() {
    if (
      [...this.tracked.values()].some(
        (tracked) => tracked.state === "active",
      )
    ) {
      return;
    }
    this.clearRenewalTimer();
  }

  private clearRenewalTimer() {
    if (this.renewalTimer === undefined) {
      return;
    }
    clearInterval(this.renewalTimer);
    this.renewalTimer = undefined;
  }

  private clearOwnershipDeadlineTimer() {
    if (this.ownershipDeadlineTimer === undefined) {
      return;
    }
    clearTimeout(this.ownershipDeadlineTimer);
    this.ownershipDeadlineTimer = undefined;
  }

  private attemptRelease(
    key: string,
    pending: PendingRelease,
  ): Promise<PstnCallAdmissionReleaseResult> {
    if (pending.inFlight !== undefined) {
      return pending.inFlight;
    }
    const inFlight = this.performRelease(key, pending);
    pending.inFlight = inFlight;
    return inFlight;
  }

  private async performRelease(
    key: string,
    pending: PendingRelease,
  ): Promise<PstnCallAdmissionReleaseResult> {
    let result: PstnCallAdmissionReleaseResult;
    try {
      result = await this.admission.release(
        pending.input !== undefined && pending.ownershipEpoch !== undefined
          ? {
              reservationId: key,
              workerId: pending.input.workerId,
              ownershipEpoch: pending.ownershipEpoch,
            }
          : { reservationId: key },
      );
    } catch {
      result = { outcome: "backend_unavailable" };
    }
    this.recordLease("release", result.outcome, pending.input);
    pending.inFlight = undefined;

    if (result.outcome !== "backend_unavailable") {
      this.pendingReleases.delete(key);
      this.recordAdmissionPosture();
      this.observability?.recordPendingRelease({
        delta: -1,
        runtimePath: pending.input?.runtime ?? "unknown",
        provider: pending.input?.provider ?? "unknown",
      });
      this.scheduleReleaseRetry();
      return result;
    }

    pending.failureCount += 1;
    pending.nextRetryAt = Date.now() + releaseRetryDelay(pending.failureCount);
    this.scheduleReleaseRetry();
    return result;
  }

  private scheduleReleaseRetry() {
    this.clearReleaseRetryTimer();
    if (this.shuttingDown || this.pendingReleases.size === 0) {
      return;
    }
    const nextRetryAt = Math.min(
      ...[...this.pendingReleases.values()]
        .filter((pending) => pending.inFlight === undefined)
        .map((pending) => pending.nextRetryAt),
    );
    if (!Number.isFinite(nextRetryAt)) {
      return;
    }
    this.releaseRetryTimer = setTimeout(() => {
      this.releaseRetryTimer = undefined;
      void this.retryDueReleases();
    }, Math.max(0, nextRetryAt - Date.now()));
    this.releaseRetryTimer.unref?.();
  }

  private async retryDueReleases() {
    const now = Date.now();
    await Promise.allSettled(
      [...this.pendingReleases.entries()]
        .filter(
          ([, pending]) =>
            pending.inFlight === undefined && pending.nextRetryAt <= now,
        )
        .map(([key, pending]) => this.attemptRelease(key, pending)),
    );
    this.scheduleReleaseRetry();
  }

  private clearReleaseRetryTimer() {
    if (this.releaseRetryTimer === undefined) {
      return;
    }
    clearTimeout(this.releaseRetryTimer);
    this.releaseRetryTimer = undefined;
  }

  private recordAdmissionPosture() {
    this.observability?.recordAdmissionPosture({
      trackedReservations: this.tracked.size,
      pendingReleases: this.pendingReleases.size,
    });
  }

  private async recordRejection(
    scope: PstnAdmissionScope,
    reasonCode: PstnAdmissionReasonCode,
  ) {
    if (this.inFlightRejectionRecords >= maxConcurrentRejectionRecords) {
      return;
    }
    this.inFlightRejectionRecords += 1;
    try {
      await this.rejectionRecorder?.record({
        tenantId: scope.tenantId,
        callSessionId: scope.callSessionId,
        reasonCode,
      });
    } catch {
      // Rejection persistence is observability and must not alter admission.
    } finally {
      this.inFlightRejectionRecords -= 1;
    }
  }

  private trackingKey(tenantId: string, callSessionId: string) {
    return `${tenantId}\0${callSessionId}`;
  }

  private recordLease(
    operation: "activate" | "renew" | "release",
    outcome: string,
    input: PstnCallAdmissionInput | undefined,
  ) {
    this.observability?.recordAdmissionLease({
      operation,
      outcome,
      runtimePath: input?.runtime ?? "unknown",
      provider: input?.provider ?? "unknown",
    });
  }
}

const maxConcurrentRejectionRecords = 16;

function isCompleteRecoveryScope(
  scope: PstnAdmissionRecoveryScope | undefined,
): scope is PstnAdmissionRecoveryScope {
  return (
    scope !== undefined &&
    typeof scope.provider === "string" &&
    scope.provider.trim().length > 0 &&
    typeof scope.providerAccountId === "string" &&
    scope.providerAccountId.trim().length > 0 &&
    (scope.runtime === "pstn-sandwich" ||
      scope.runtime === "pstn-premium-realtime")
  );
}

function parseLeaseDeadline(leaseExpiresAt: string) {
  const deadline = Date.parse(leaseExpiresAt);
  return Number.isFinite(deadline) ? deadline : Date.now();
}

function ownershipLossHasStarted(tracked: TrackedAdmission) {
  return tracked.ownershipLossStarted === true;
}

const initialReleaseRetryDelayMs = 1_000;
const maximumReleaseRetryDelayMs = 30_000;

function releaseRetryDelay(failureCount: number) {
  return Math.min(
    initialReleaseRetryDelayMs * 2 ** Math.max(0, failureCount - 1),
    maximumReleaseRetryDelayMs,
  );
}
