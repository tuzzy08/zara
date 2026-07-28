import { describe, expect, it, vi } from "vitest";

import type { PstnAdmissionConfig } from "./pstn-admission-config";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import { InMemoryPstnCallAdmission } from "./in-memory-pstn-call-admission";
import type {
  PstnCallAdmission,
  PstnCallAdmissionActivationInput,
  PstnCallAdmissionInput,
  PstnCallAdmissionLeaseInput,
  PstnCallAdmissionReleaseResult,
} from "./pstn-call-admission";

const config: PstnAdmissionConfig = {
  mode: "memory",
  workerId: "worker-a",
  limits: {
    global: 20,
    provider: 10,
    tenant: 8,
    worker: 6,
    runtime: {
      "pstn-sandwich": 5,
      "pstn-premium-realtime": 4,
    },
  },
  cps: {
    global: { capacity: 10, refillPerSecond: 10 },
    providerAccount: { capacity: 5, refillPerSecond: 5 },
  },
  claimTtlMs: 30_000,
  activeTtlMs: 120_000,
  renewIntervalMs: 30_000,
  commandTimeoutMs: 750,
};

function activeLeaseExpiresAt() {
  return new Date(Date.now() + config.activeTtlMs).toISOString();
}

function createAdmission() {
  const calls: {
    reserve: PstnCallAdmissionInput[];
    activate: PstnCallAdmissionActivationInput[];
    renew: PstnCallAdmissionLeaseInput[];
    release: Array<{ reservationId: string }>;
  } = {
    reserve: [],
    activate: [],
    renew: [],
    release: [],
  };
  const admission: PstnCallAdmission = {
    reserve: vi.fn(async (input) => {
      calls.reserve.push(input);
      return {
        outcome: "admitted" as const,
        disposition: "created" as const,
        leaseExpiresAt: new Date(Date.now() + config.claimTtlMs).toISOString(),
        limitingDimension: "runtime_concurrency" as const,
        remainingCapacity: 3,
      };
    }),
    activate: vi.fn(async (input) => {
      calls.activate.push(input);
      return {
        outcome: "activated" as const,
        leaseExpiresAt: activeLeaseExpiresAt(),
        ownershipEpoch: 1,
      };
    }),
    renew: vi.fn(async (input) => {
      calls.renew.push(input);
      return {
        outcome: "renewed" as const,
        leaseExpiresAt: activeLeaseExpiresAt(),
        ownershipEpoch: 1,
      };
    }),
    release: vi.fn(async (input) => {
      calls.release.push(input);
      return { outcome: "released" as const };
    }),
    getHealth: vi.fn(async () => ({
      status: "healthy" as const,
      backend: "memory" as const,
    })),
  };
  return { admission, calls };
}

const scope = {
  tenantId: "tenant-a",
  callSessionId: "CA123:telephony",
  provider: "twilio",
  providerAccountId: "AC123",
  runtime: "pstn-premium-realtime" as const,
};

describe("PstnAdmissionCoordinator", () => {
  it("builds one bounded admission input and reuses its deterministic identity", async () => {
    const { admission, calls } = createAdmission();
    const coordinator = new PstnAdmissionCoordinator(admission, config);

    await coordinator.reserve(scope);
    await coordinator.reserve(scope);

    expect(calls.reserve).toHaveLength(2);
    expect(calls.reserve[0]).toEqual({
      reservationId: "tenant-a\u0000CA123:telephony",
      callSessionId: "CA123:telephony",
      tenantId: "tenant-a",
      providerAccountId: "AC123",
      workerId: "worker-a",
      provider: "twilio",
      runtime: "pstn-premium-realtime",
      limits: {
        global: 20,
        provider: 10,
        tenant: 8,
        runtime: 4,
        worker: 6,
      },
      cps: config.cps,
      claimTtlMs: 30_000,
      activeTtlMs: 120_000,
    });
    expect(calls.reserve[1]?.reservationId).toBe(
      calls.reserve[0]?.reservationId,
    );
  });

  it("closes only new provider admission when provider health is unavailable", async () => {
    const { admission, calls } = createAdmission();
    const coordinator = new PstnAdmissionCoordinator(admission, config);

    await coordinator.reserve({
      ...scope,
      callSessionId: "CA-health:telephony",
      providerAvailable: false,
    });

    expect(calls.reserve[0]?.limits.provider).toBe(0);
  });

  it("clamps new provider admission to the platform-owned quota allowance", async () => {
    const { admission, calls } = createAdmission();
    const coordinator = new PstnAdmissionCoordinator(admission, {
      ...config,
      providerQuotaAllowances: {
        twilio: 2,
      },
    });

    await coordinator.reserve(scope);

    expect(calls.reserve[0]?.limits.provider).toBe(2);
  });

  it("uses the current operational policy for every new reservation", async () => {
    const { admission, calls } = createAdmission();
    const resolveAdmissionPolicy = vi.fn(async () => ({
      policyVersion: 7,
      limits: {
        global: 11,
        provider: 9,
        tenant: 3,
        runtime: 6,
        worker: 4,
      },
      cps: {
        global: { capacity: 4, refillPerSecond: 3 },
        providerAccount: { capacity: 2, refillPerSecond: 1 },
      },
      activeReductionIds: ["incident-7"],
    }));
    const coordinator = new PstnAdmissionCoordinator(
      admission,
      config,
      undefined,
      { resolveAdmissionPolicy },
    );

    await coordinator.reserve(scope);

    expect(resolveAdmissionPolicy).toHaveBeenCalledWith({
      ...scope,
      workerId: "worker-a",
    });
    expect(calls.reserve[0]).toMatchObject({
      limits: {
        global: 11,
        provider: 9,
        tenant: 3,
        runtime: 6,
        worker: 4,
      },
      cps: {
        global: { capacity: 4, refillPerSecond: 3 },
        providerAccount: { capacity: 2, refillPerSecond: 1 },
      },
    });
  });

  it("fails closed when operational policy cannot be loaded", async () => {
    const { admission, calls } = createAdmission();
    const rejectionRecorder = { record: vi.fn(async () => undefined) };
    const coordinator = new PstnAdmissionCoordinator(
      admission,
      config,
      undefined,
      {
        resolveAdmissionPolicy: vi.fn(async () => {
          throw new Error("policy store unavailable");
        }),
      },
      rejectionRecorder,
    );

    await expect(coordinator.reserve(scope)).resolves.toEqual({
      outcome: "denied",
      reasonCode: "backend_unavailable",
      limitingDimension: "backend",
    });
    expect(calls.reserve).toHaveLength(0);
    expect(rejectionRecorder.record).toHaveBeenCalledWith({
      tenantId: scope.tenantId,
      callSessionId: scope.callSessionId,
      reasonCode: "backend_unavailable",
    });
  });

  it("records denied reservations for tenant-safe rejection history", async () => {
    const { admission } = createAdmission();
    admission.reserve = vi.fn(async () => ({
      outcome: "denied" as const,
      reasonCode: "tenant_concurrency_limit" as const,
      limitingDimension: "tenant_concurrency" as const,
      remainingCapacity: 0,
    }));
    const rejectionRecorder = { record: vi.fn(async () => undefined) };
    const coordinator = new PstnAdmissionCoordinator(
      admission,
      config,
      undefined,
      undefined,
      rejectionRecorder,
    );

    await coordinator.reserve(scope);

    expect(rejectionRecorder.record).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      callSessionId: "CA123:telephony",
      reasonCode: "tenant_concurrency_limit",
    });
  });

  it("does not delay admission responses while rejection evidence persists", async () => {
    const { admission } = createAdmission();
    admission.reserve = vi.fn(async () => ({
      outcome: "denied" as const,
      reasonCode: "tenant_concurrency_limit" as const,
    }));
    const coordinator = new PstnAdmissionCoordinator(
      admission,
      config,
      undefined,
      undefined,
      { record: vi.fn(() => new Promise<void>(() => undefined)) },
    );

    const result = await Promise.race([
      coordinator.reserve(scope),
      new Promise<"timed_out">((resolve) =>
        setTimeout(() => resolve("timed_out"), 20)
      ),
    ]);

    expect(result).toEqual({
      outcome: "denied",
      reasonCode: "tenant_concurrency_limit",
    });
  });

  it("activates a tracked claim and renews active calls on one shared timer", async () => {
    vi.useFakeTimers();
    const { admission, calls } = createAdmission();
    const coordinator = new PstnAdmissionCoordinator(admission, config);
    const ownershipConfirmed = vi.fn();
    coordinator.onOwnershipConfirmed(ownershipConfirmed);
    await coordinator.reserve(scope);
    await coordinator.reserve({
      ...scope,
      callSessionId: "CA456:telephony",
    });

    await coordinator.activate(scope.tenantId, scope.callSessionId);
    await coordinator.activate(scope.tenantId, "CA456:telephony");
    await vi.advanceTimersByTimeAsync(config.renewIntervalMs);

    expect(calls.renew).toHaveLength(2);
    expect(ownershipConfirmed).toHaveBeenCalledTimes(2);
    expect(ownershipConfirmed).toHaveBeenLastCalledWith({
      tenantId: scope.tenantId,
      callSessionId: "CA456:telephony",
      runtime: scope.runtime,
      workerId: config.workerId,
      ownershipEpoch: 1,
      leaseExpiresAt: activeLeaseExpiresAt(),
      operation: "renew",
    });
    expect(vi.getTimerCount()).toBe(2);
    await coordinator.shutdown();
    vi.useRealTimers();
  });

  it("stops renewing and releases admission when durable ownership confirmation fails", async () => {
    vi.useFakeTimers();
    try {
      const { admission, calls } = createAdmission();
      const coordinator = new PstnAdmissionCoordinator(admission, config);
      coordinator.onOwnershipConfirmed(async () => {
        throw new Error("durable ownership fence rejected");
      });
      await coordinator.reserve(scope);
      await coordinator.activate(scope.tenantId, scope.callSessionId);

      await vi.advanceTimersByTimeAsync(config.renewIntervalMs);

      expect(calls.renew).toHaveLength(1);
      expect(calls.release).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(config.renewIntervalMs * 2);
      expect(calls.renew).toHaveLength(1);
      await coordinator.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops renewing when no durable ownership confirmer is registered", async () => {
    vi.useFakeTimers();
    try {
      const { admission, calls } = createAdmission();
      const coordinator = new PstnAdmissionCoordinator(admission, config);
      await coordinator.reserve(scope);
      await coordinator.activate(scope.tenantId, scope.callSessionId);

      await vi.advanceTimersByTimeAsync(config.renewIntervalMs);

      expect(calls.renew).toHaveLength(1);
      expect(calls.release).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(config.renewIntervalMs * 2);
      expect(calls.renew).toHaveLength(1);
      await coordinator.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps active calls tracked during a Redis renewal outage", async () => {
    vi.useFakeTimers();
    const { admission, calls } = createAdmission();
    admission.renew = vi.fn(async (input) => {
      calls.renew.push(input);
      return { outcome: "backend_unavailable" as const };
    });
    const coordinator = new PstnAdmissionCoordinator(admission, config);
    await coordinator.reserve(scope);
    await coordinator.activate(scope.tenantId, scope.callSessionId);

    await vi.advanceTimersByTimeAsync(config.renewIntervalMs * 2);

    expect(calls.renew).toHaveLength(2);
    await coordinator.shutdown();
    vi.useRealTimers();
  });

  it("expires indeterminate ownership once at the last Redis-confirmed lease deadline", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime("2026-07-24T12:00:00.000Z");
      const { admission, calls } = createAdmission();
      admission.renew = vi.fn(async (input) => {
        calls.renew.push(input);
        return { outcome: "backend_unavailable" as const };
      });
      const observability = {
        recordAdmission: vi.fn(),
        recordAdmissionLease: vi.fn(),
        recordAdmissionBackendHealth: vi.fn(),
        recordAdmissionOwnershipLost: vi.fn(),
        recordPendingRelease: vi.fn(),
        recordAdmissionPosture: vi.fn(),
      };
      const coordinator = new PstnAdmissionCoordinator(
        admission,
        config,
        observability,
      );
      const ownershipLost = vi.fn();
      coordinator.onOwnershipLost(ownershipLost);
      await coordinator.reserve(scope);
      await coordinator.activate(scope.tenantId, scope.callSessionId);

      await vi.advanceTimersByTimeAsync(config.renewIntervalMs);
      await expect(
        coordinator.reserve({
          ...scope,
          callSessionId: "CA-blocked-during-outage:telephony",
        }),
      ).resolves.toMatchObject({
        outcome: "denied",
        reasonCode: "indeterminate_result",
      });

      await vi.advanceTimersByTimeAsync(config.activeTtlMs - config.renewIntervalMs - 1);
      expect(ownershipLost).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(ownershipLost).toHaveBeenCalledOnce();
      expect(ownershipLost).toHaveBeenCalledWith({
        tenantId: scope.tenantId,
        callSessionId: scope.callSessionId,
        runtime: scope.runtime,
        reason: "lease_unrecoverable",
      });
      expect(observability.recordAdmissionOwnershipLost).toHaveBeenCalledOnce();
      expect(observability.recordAdmissionOwnershipLost).toHaveBeenCalledWith({
        reason: "confirmed_lease_expired",
        provider: scope.provider,
        runtimePath: scope.runtime,
      });

      await vi.advanceTimersByTimeAsync(config.activeTtlMs);
      expect(ownershipLost).toHaveBeenCalledOnce();
      expect(observability.recordAdmissionOwnershipLost).toHaveBeenCalledOnce();
      await coordinator.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("advances the confirmed ownership deadline only after Redis renewal succeeds", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime("2026-07-24T12:00:00.000Z");
      const { admission, calls } = createAdmission();
      admission.renew = vi
        .fn()
        .mockImplementationOnce(async (input) => {
          calls.renew.push(input);
          return {
            outcome: "renewed" as const,
            leaseExpiresAt: "2026-07-24T12:02:30.000Z",
            ownershipEpoch: 1,
          };
        })
        .mockImplementation(async (input) => {
          calls.renew.push(input);
          return { outcome: "backend_unavailable" as const };
        });
      const coordinator = new PstnAdmissionCoordinator(admission, config);
      coordinator.onOwnershipConfirmed(() => undefined);
      const ownershipLost = vi.fn();
      coordinator.onOwnershipLost(ownershipLost);
      await coordinator.reserve(scope);
      await coordinator.activate(scope.tenantId, scope.callSessionId);

      await vi.advanceTimersByTimeAsync(config.activeTtlMs);
      expect(ownershipLost).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(29_999);
      expect(ownershipLost).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(ownershipLost).toHaveBeenCalledOnce();
      await coordinator.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a thrown renewal as indeterminate until the confirmed deadline expires", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime("2026-07-24T12:00:00.000Z");
      const { admission, calls } = createAdmission();
      admission.renew = vi.fn(async (input) => {
        calls.renew.push(input);
        throw new Error("Redis command outcome is unknown");
      });
      const coordinator = new PstnAdmissionCoordinator(admission, config);
      const ownershipLost = vi.fn();
      coordinator.onOwnershipLost(ownershipLost);
      await coordinator.reserve(scope);
      await coordinator.activate(scope.tenantId, scope.callSessionId);

      await vi.advanceTimersByTimeAsync(config.renewIntervalMs);
      await expect(
        coordinator.reserve({
          ...scope,
          callSessionId: "CA-blocked-after-timeout:telephony",
        }),
      ).resolves.toMatchObject({
        outcome: "denied",
        reasonCode: "indeterminate_result",
      });

      await vi.advanceTimersByTimeAsync(config.activeTtlMs - config.renewIntervalMs);
      expect(ownershipLost).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(config.activeTtlMs);
      expect(ownershipLost).toHaveBeenCalledOnce();
      await coordinator.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the ownership epoch available while loss listeners release", async () => {
    vi.useFakeTimers();
    const { admission, calls } = createAdmission();
    admission.renew = vi.fn(async (input) => {
      calls.renew.push(input);
      return { outcome: "not_owner" as const };
    });
    const coordinator = new PstnAdmissionCoordinator(admission, config);
    const ownershipLost = vi.fn(async () => {
      await coordinator.release(scope.tenantId, scope.callSessionId);
    });
    coordinator.onOwnershipLost(ownershipLost);
    await coordinator.reserve(scope);
    await coordinator.activate(scope.tenantId, scope.callSessionId);

    await vi.advanceTimersByTimeAsync(config.renewIntervalMs * 2);

    expect(calls.renew).toEqual([
      {
        reservationId: "tenant-a\u0000CA123:telephony",
        workerId: "worker-a",
        ownershipEpoch: 1,
        activeTtlMs: config.activeTtlMs,
      },
    ]);
    expect(ownershipLost).toHaveBeenCalledOnce();
    expect(ownershipLost).toHaveBeenCalledWith({
      tenantId: scope.tenantId,
      callSessionId: scope.callSessionId,
      runtime: scope.runtime,
      reason: "not_owner",
    });
    expect(calls.release).toEqual([
      {
        reservationId: "tenant-a\u0000CA123:telephony",
        workerId: "worker-a",
        ownershipEpoch: 1,
      },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    await coordinator.shutdown();
    vi.useRealTimers();
  });

  it("reserves the selected media worker instead of the control-plane process", async () => {
    const { admission, calls } = createAdmission();
    const coordinator = new PstnAdmissionCoordinator(admission, config);

    await coordinator.reserve({
      ...scope,
      workerId: "worker-media-eu-1",
    });

    expect(calls.reserve[0]?.workerId).toBe("worker-media-eu-1");
    await coordinator.shutdown();
  });

  it("re-establishes an expired active lease without losing its admission scope", async () => {
    vi.useFakeTimers();
    const { admission, calls } = createAdmission();
    admission.renew = vi.fn(async (input) => {
      calls.renew.push(input);
      return { outcome: "not_found" as const };
    });
    const coordinator = new PstnAdmissionCoordinator(admission, config);
    await coordinator.reserve(scope);
    await coordinator.activate(scope.tenantId, scope.callSessionId);

    await vi.advanceTimersByTimeAsync(config.renewIntervalMs);

    expect(calls.activate).toHaveLength(2);
    expect(calls.activate[1]).toEqual(calls.reserve[0]);
    await coordinator.shutdown();
    vi.useRealTimers();
  });

  it("terminates ownership when an expired active lease cannot be reconstructed", async () => {
    vi.useFakeTimers();
    const { admission, calls } = createAdmission();
    admission.renew = vi.fn(async (input) => {
      calls.renew.push(input);
      return { outcome: "not_found" as const };
    });
    admission.activate = vi.fn(async (input) => {
      calls.activate.push(input);
      return calls.activate.length === 1
        ? {
            outcome: "activated" as const,
            leaseExpiresAt: activeLeaseExpiresAt(),
            ownershipEpoch: 1,
          }
        : { outcome: "not_found" as const };
    });
    const coordinator = new PstnAdmissionCoordinator(admission, config);
    const ownershipLost = vi.fn();
    coordinator.onOwnershipLost(ownershipLost);
    await coordinator.reserve(scope);
    await coordinator.activate(scope.tenantId, scope.callSessionId);

    await vi.advanceTimersByTimeAsync(config.renewIntervalMs);

    expect(ownershipLost).toHaveBeenCalledWith({
      tenantId: scope.tenantId,
      callSessionId: scope.callSessionId,
      runtime: scope.runtime,
      reason: "lease_unrecoverable",
    });
    expect(vi.getTimerCount()).toBe(0);
    await coordinator.shutdown();
    vi.useRealTimers();
  });

  it("fails new admission closed until an uncounted live call terminates", async () => {
    vi.useFakeTimers();
    const { admission, calls } = createAdmission();
    admission.renew = vi.fn(async (input) => {
      calls.renew.push(input);
      return { outcome: "not_found" as const };
    });
    admission.activate = vi.fn(async (input) => {
      calls.activate.push(input);
      return calls.activate.length === 1
          ? {
              outcome: "activated" as const,
              leaseExpiresAt: activeLeaseExpiresAt(),
              ownershipEpoch: 1,
            }
        : {
            outcome: "denied" as const,
            reasonCode: "worker_concurrency_limit" as const,
          };
    });
    const coordinator = new PstnAdmissionCoordinator(admission, config);
    await coordinator.reserve(scope);
    await coordinator.activate(scope.tenantId, scope.callSessionId);
    await vi.advanceTimersByTimeAsync(config.renewIntervalMs);

    await expect(
      coordinator.reserve({
        ...scope,
        callSessionId: "CA-blocked:telephony",
      }),
    ).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
    expect(calls.reserve).toHaveLength(1);

    await coordinator.release(scope.tenantId, scope.callSessionId);
    await coordinator.reserve({
      ...scope,
      callSessionId: "CA-after-release:telephony",
    });
    expect(calls.reserve).toHaveLength(2);
    await coordinator.shutdown();
    vi.useRealTimers();
  });

  it("keeps an active lease renewable after a duplicate webhook reservation", async () => {
    vi.useFakeTimers();
    const { admission, calls } = createAdmission();
    admission.reserve = vi.fn(async (input) => {
      calls.reserve.push(input);
      return {
        outcome: "admitted" as const,
        disposition: calls.reserve.length === 1 ? "created" as const : "existing" as const,
        leaseExpiresAt: activeLeaseExpiresAt(),
        limitingDimension: "runtime_concurrency" as const,
        remainingCapacity: 3,
      };
    });
    const coordinator = new PstnAdmissionCoordinator(admission, config);

    await coordinator.reserve(scope);
    await coordinator.activate(scope.tenantId, scope.callSessionId);
    await coordinator.reserve(scope);
    await vi.advanceTimersByTimeAsync(config.renewIntervalMs);

    expect(calls.renew).toHaveLength(1);
    await coordinator.shutdown();
    vi.useRealTimers();
  });

  it("releases terminal calls idempotently without deleting tracked leases on shutdown", async () => {
    const { admission, calls } = createAdmission();
    const coordinator = new PstnAdmissionCoordinator(admission, config);
    await coordinator.reserve(scope);
    await coordinator.release(scope.tenantId, scope.callSessionId);
    await coordinator.release(scope.tenantId, scope.callSessionId);
    await coordinator.reserve({
      ...scope,
      callSessionId: "CA456:telephony",
    });

    await coordinator.shutdown();

    expect(calls.release.map((input) => input.reservationId)).toEqual([
      "tenant-a\u0000CA123:telephony",
      "tenant-a\u0000CA123:telephony",
    ]);
  });

  it("retains release ownership and retries when the admission backend rejects", async () => {
    vi.useFakeTimers();
    try {
      const { admission, calls } = createAdmission();
      admission.release = vi
        .fn()
        .mockImplementationOnce(async (input) => {
          calls.release.push(input);
          throw new Error("redis unavailable");
        })
        .mockImplementationOnce(async (input) => {
          calls.release.push(input);
          return { outcome: "released" as const };
        });
      const observability = {
        recordAdmission: vi.fn(),
        recordAdmissionLease: vi.fn(),
        recordAdmissionOwnershipLost: vi.fn(),
        recordAdmissionBackendHealth: vi.fn(),
        recordPendingRelease: vi.fn(),
        recordAdmissionPosture: vi.fn(),
      };
      const coordinator = new PstnAdmissionCoordinator(
        admission,
        config,
        observability,
      );
      await coordinator.reserve(scope);
      await coordinator.activate(scope.tenantId, scope.callSessionId);

      await expect(
        coordinator.release(scope.tenantId, scope.callSessionId),
      ).resolves.toEqual({ outcome: "backend_unavailable" });
      expect(calls.release).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(calls.release).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls.release).toHaveLength(2);
      expect(observability.recordPendingRelease.mock.calls).toEqual([
        [{
          delta: 1,
          runtimePath: scope.runtime,
          provider: scope.provider,
        }],
        [{
          delta: -1,
          runtimePath: scope.runtime,
          provider: scope.provider,
        }],
      ]);

      await coordinator.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries resolved backend failures with bounded exponential delay", async () => {
    vi.useFakeTimers();
    try {
      const { admission, calls } = createAdmission();
      admission.release = vi.fn(async (input) => {
        calls.release.push(input);
        return calls.release.length < 3
          ? { outcome: "backend_unavailable" as const }
          : { outcome: "not_found" as const };
      });
      const coordinator = new PstnAdmissionCoordinator(admission, config);
      await coordinator.reserve(scope);

      await expect(
        coordinator.release(scope.tenantId, scope.callSessionId),
      ).resolves.toEqual({ outcome: "backend_unavailable" });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls.release).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(calls.release).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls.release).toHaveLength(3);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(calls.release).toHaveLength(3);
      await coordinator.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops renewing an active lease while its release is pending", async () => {
    vi.useFakeTimers();
    try {
      const { admission, calls } = createAdmission();
      admission.release = vi.fn(async (input) => {
        calls.release.push(input);
        return { outcome: "backend_unavailable" as const };
      });
      const coordinator = new PstnAdmissionCoordinator(admission, config);
      await coordinator.reserve(scope);
      await coordinator.activate(scope.tenantId, scope.callSessionId);

      await coordinator.release(scope.tenantId, scope.callSessionId);
      await vi.advanceTimersByTimeAsync(config.renewIntervalMs);

      expect(calls.renew).toHaveLength(0);
      expect(calls.release.length).toBeGreaterThan(1);
      await coordinator.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes a pending release immediately during shutdown", async () => {
    vi.useFakeTimers();
    try {
      const { admission, calls } = createAdmission();
      admission.release = vi.fn(async (input) => {
        calls.release.push(input);
        return calls.release.length === 1
          ? { outcome: "backend_unavailable" as const }
          : { outcome: "released" as const };
      });
      const coordinator = new PstnAdmissionCoordinator(admission, config);
      await coordinator.reserve(scope);

      await coordinator.release(scope.tenantId, scope.callSessionId);
      await coordinator.shutdown();

      expect(calls.release).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finalizes release ownership explicitly and idempotently", async () => {
    const { admission, calls } = createAdmission();
    admission.release = vi.fn(async (input) => {
      calls.release.push(input);
      return calls.release.length === 1
        ? { outcome: "backend_unavailable" as const }
        : { outcome: "released" as const };
    });
    const coordinator = new PstnAdmissionCoordinator(admission, config);
    await coordinator.reserve(scope);
    await coordinator.release(scope.tenantId, scope.callSessionId);

    await coordinator.shutdown();
    await coordinator.shutdown();

    expect(calls.release).toHaveLength(2);
  });

  it("does not double release when shutdown joins an in-flight attempt", async () => {
    const { admission, calls } = createAdmission();
    let finishRelease: (() => void) | undefined;
    admission.release = vi.fn(
      (input) =>
        new Promise<PstnCallAdmissionReleaseResult>((resolve) => {
          calls.release.push(input);
          finishRelease = () => resolve({ outcome: "released" as const });
        }),
    );
    const coordinator = new PstnAdmissionCoordinator(admission, config);
    await coordinator.reserve(scope);

    const releasing = coordinator.release(
      scope.tenantId,
      scope.callSessionId,
    );
    const shutdown = coordinator.shutdown();
    finishRelease?.();

    await expect(releasing).resolves.toEqual({ outcome: "released" });
    await shutdown;
    expect(calls.release).toHaveLength(1);
  });

  it("does not release a reservation activated by another process when ingress shuts down", async () => {
    const admission = new InMemoryPstnCallAdmission();
    const ingress = new PstnAdmissionCoordinator(admission, config);
    const mediaWorker = new PstnAdmissionCoordinator(admission, {
      ...config,
      workerId: "worker-b",
    });

    await ingress.reserve(scope);
    await mediaWorker.activate(scope.tenantId, scope.callSessionId, {
      provider: scope.provider,
      providerAccountId: scope.providerAccountId,
      runtime: scope.runtime,
    });
    await ingress.shutdown();

    await expect(
      mediaWorker.release(scope.tenantId, scope.callSessionId),
    ).resolves.toEqual({ outcome: "released" });
    await mediaWorker.shutdown();
  });

  it("activates and releases a reservation from another process coordinator", async () => {
    const admission = new InMemoryPstnCallAdmission();
    const ingress = new PstnAdmissionCoordinator(admission, config);
    const mediaWorker = new PstnAdmissionCoordinator(admission, {
      ...config,
      workerId: "worker-b",
    });

    await expect(ingress.reserve(scope)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await expect(
      mediaWorker.activate(scope.tenantId, scope.callSessionId, {
        provider: scope.provider,
        providerAccountId: scope.providerAccountId,
        runtime: scope.runtime,
      }),
    ).resolves.toMatchObject({
      outcome: "activated",
    });
    await expect(
      ingress.release(scope.tenantId, scope.callSessionId),
    ).resolves.toEqual({
      outcome: "released",
    });
    await expect(
      mediaWorker.release(scope.tenantId, scope.callSessionId),
    ).resolves.toEqual({
      outcome: "not_found",
    });

    await ingress.shutdown();
    await mediaWorker.shutdown();
  });

  it("fails closed without activating an untracked claim when recovery scope is missing", async () => {
    const { admission, calls } = createAdmission();
    const mediaWorker = new PstnAdmissionCoordinator(admission, {
      ...config,
      workerId: "worker-b",
    });

    await expect(
      mediaWorker.activate(scope.tenantId, scope.callSessionId),
    ).resolves.toEqual({
      outcome: "not_found",
    });
    expect(calls.activate).toEqual([]);
    await mediaWorker.shutdown();
  });

  it("fails closed without activating an untracked claim when recovery scope is incomplete", async () => {
    const { admission, calls } = createAdmission();
    const mediaWorker = new PstnAdmissionCoordinator(admission, {
      ...config,
      workerId: "worker-b",
    });

    await expect(
      mediaWorker.activate(scope.tenantId, scope.callSessionId, {
        provider: scope.provider,
        providerAccountId: "",
        runtime: scope.runtime,
      }),
    ).resolves.toEqual({
      outcome: "not_found",
    });
    expect(calls.activate).toEqual([]);
    await mediaWorker.shutdown();
  });

  it("fails closed for structurally partial untracked recovery input", async () => {
    const { admission, calls } = createAdmission();
    const mediaWorker = new PstnAdmissionCoordinator(admission, {
      ...config,
      workerId: "worker-b",
    });

    await expect(
      mediaWorker.activate(scope.tenantId, scope.callSessionId, {
        provider: scope.provider,
        runtime: scope.runtime,
      } as never),
    ).resolves.toEqual({
      outcome: "not_found",
    });
    expect(calls.activate).toEqual([]);
    await mediaWorker.shutdown();
  });

  it("preserves provider and runtime telemetry when another process activates the lease", async () => {
    const { admission } = createAdmission();
    const ingress = new PstnAdmissionCoordinator(admission, config);
    const observability = {
      recordAdmission: vi.fn(),
      recordAdmissionLease: vi.fn(),
      recordAdmissionOwnershipLost: vi.fn(),
      recordAdmissionBackendHealth: vi.fn(),
      recordPendingRelease: vi.fn(),
      recordAdmissionPosture: vi.fn(),
    };
    const mediaWorker = new PstnAdmissionCoordinator(
      admission,
      {
        ...config,
        workerId: "worker-b",
      },
      observability,
    );
    await ingress.reserve(scope);

    await mediaWorker.activate(scope.tenantId, scope.callSessionId, {
      provider: scope.provider,
      providerAccountId: scope.providerAccountId,
      runtime: scope.runtime,
    });

    expect(observability.recordAdmissionLease).toHaveBeenCalledWith({
      operation: "activate",
      outcome: "activated",
      provider: "twilio",
      runtimePath: "pstn-premium-realtime",
    });
    await ingress.shutdown();
    await mediaWorker.shutdown();
  });

  it("records only bounded admission and lease dimensions", async () => {
    const { admission } = createAdmission();
    const observability = {
      recordAdmission: vi.fn(),
      recordAdmissionLease: vi.fn(),
      recordAdmissionOwnershipLost: vi.fn(),
      recordAdmissionBackendHealth: vi.fn(),
      recordPendingRelease: vi.fn(),
      recordAdmissionPosture: vi.fn(),
    };
    const coordinator = new PstnAdmissionCoordinator(
      admission,
      config,
      observability,
    );

    await coordinator.reserve(scope);
    await coordinator.activate(scope.tenantId, scope.callSessionId);
    await coordinator.release(scope.tenantId, scope.callSessionId);
    await coordinator.getHealth();

    expect(observability.recordAdmission).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "admitted_created",
        limitingDimension: "runtime_concurrency",
        remainingCapacity: 3,
        runtimePath: "pstn-premium-realtime",
        provider: "twilio",
        latencyMs: expect.any(Number),
      }),
    );
    expect(observability.recordAdmissionLease).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "activate",
        outcome: "activated",
      }),
    );
    expect(observability.recordAdmissionBackendHealth).toHaveBeenCalledWith({
      status: "healthy",
    });
    expect(observability.recordAdmissionPosture.mock.calls).toEqual([
      [{ trackedReservations: 1, pendingReleases: 0 }],
      [{ trackedReservations: 1, pendingReleases: 0 }],
      [{ trackedReservations: 0, pendingReleases: 1 }],
      [{ trackedReservations: 0, pendingReleases: 0 }],
    ]);
    expect(JSON.stringify(observability.recordAdmission.mock.calls)).not.toContain(
      scope.tenantId,
    );
    expect(JSON.stringify(observability.recordAdmission.mock.calls)).not.toContain(
      scope.callSessionId,
    );
  });
});
