import type { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import type {
  PstnAdmissionConfig,
  PstnAdmissionRuntimePath,
} from "./pstn-admission-config";
import type {
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
  | "recordAdmissionBackendHealth"
>;

export interface PstnAdmissionOwnershipLostEvent {
  tenantId: string;
  callSessionId: string;
  runtime: PstnAdmissionRuntimePath;
  reason: "lease_unrecoverable" | "not_owner";
}

export class PstnAdmissionCoordinator {
  private readonly tracked = new Map<string, TrackedAdmission>();
  private readonly unresolvedActiveLeases = new Set<string>();
  private readonly pendingReleases = new Map<string, PendingRelease>();
  private renewalTimer: ReturnType<typeof setInterval> | undefined;
  private releaseRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;
  private readonly ownershipLostListeners = new Set<
    (event: PstnAdmissionOwnershipLostEvent) => void | Promise<void>
  >();

  constructor(
    private readonly admission: PstnCallAdmission,
    private readonly config: PstnAdmissionConfig,
    private readonly observability?: PstnAdmissionObservability,
  ) {}

  async reserve(
    scope: PstnAdmissionScope,
  ): Promise<PstnCallAdmissionReserveResult> {
    const input = this.buildInput(scope);
    const startedAt = Date.now();
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
      }
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
      recoveryInput = this.buildRecoveryInput(
        tenantId,
        callSessionId,
        recoveryScope,
      );
    }

    const result = await this.admission.activate({
      reservationId: key,
      workerId: recoveryInput.workerId,
      workerLimit: this.config.limits.worker,
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
      });
      this.ensureRenewalTimer();
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
    this.stopRenewalTimerWhenIdle();
    const releaseIntent: PendingRelease = {
      input: tracked?.input,
      ownershipEpoch: tracked?.ownershipEpoch,
      failureCount: 0,
      nextRetryAt: Date.now(),
      inFlight: undefined,
    };
    this.pendingReleases.set(key, releaseIntent);
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

  shutdown() {
    this.shutdownPromise ??= this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown() {
    this.shuttingDown = true;
    this.clearRenewalTimer();
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
  }

  private buildInput(scope: PstnAdmissionScope): PstnCallAdmissionInput {
    return {
      reservationId: this.trackingKey(scope.tenantId, scope.callSessionId),
      callSessionId: scope.callSessionId,
      tenantId: scope.tenantId,
      providerAccountId: scope.providerAccountId,
      workerId: scope.workerId ?? this.config.workerId,
      provider: scope.provider,
      runtime: scope.runtime,
      limits: {
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
      cps: this.config.cps,
      claimTtlMs: this.config.claimTtlMs,
      activeTtlMs: this.config.activeTtlMs,
    };
  }

  private buildRecoveryInput(
    tenantId: string,
    callSessionId: string,
    recoveryScope: PstnAdmissionRecoveryScope,
  ): PstnCallAdmissionInput {
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
        if (tracked.ownershipEpoch === undefined) {
          this.unresolvedActiveLeases.add(key);
          return;
        }
        const result = await this.admission.renew({
          reservationId: tracked.input.reservationId,
          workerId: tracked.input.workerId,
          ownershipEpoch: tracked.ownershipEpoch,
          activeTtlMs: tracked.input.activeTtlMs,
        });
        this.recordLease("renew", result.outcome, tracked.input);
        if (result.outcome === "not_owner") {
          this.unresolvedActiveLeases.delete(key);
          await this.notifyOwnershipLost(tracked);
          if (this.tracked.get(key) === tracked) {
            this.tracked.delete(key);
          }
          return;
        }
        if (result.outcome === "renewed") {
          this.unresolvedActiveLeases.delete(key);
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
            this.unresolvedActiveLeases.delete(key);
          } else if (reconciliation.outcome === "not_owner") {
            this.unresolvedActiveLeases.delete(key);
            await this.notifyOwnershipLost(tracked);
            if (this.tracked.get(key) === tracked) {
              this.tracked.delete(key);
            }
          } else if (reconciliation.outcome === "not_found") {
            this.unresolvedActiveLeases.delete(key);
            await this.notifyOwnershipLost(tracked, "lease_unrecoverable");
            if (this.tracked.get(key) === tracked) {
              this.tracked.delete(key);
            }
          }
        }
      }),
    );
    this.stopRenewalTimerWhenIdle();
  }

  private async notifyOwnershipLost(
    tracked: TrackedAdmission,
    reason: PstnAdmissionOwnershipLostEvent["reason"] = "not_owner",
  ) {
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

const initialReleaseRetryDelayMs = 1_000;
const maximumReleaseRetryDelayMs = 30_000;

function releaseRetryDelay(failureCount: number) {
  return Math.min(
    initialReleaseRetryDelayMs * 2 ** Math.max(0, failureCount - 1),
    maximumReleaseRetryDelayMs,
  );
}
