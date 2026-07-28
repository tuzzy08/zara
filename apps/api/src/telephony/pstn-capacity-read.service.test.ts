import { describe, expect, it, vi } from "vitest";

import type { PstnAdmissionConfig } from "./pstn-admission-config";
import {
  InMemoryPstnCapacityPolicyRepository,
} from "./pstn-capacity-policy.repository";
import { PstnCapacityPolicyService } from "./pstn-capacity-policy.service";
import {
  InMemoryPstnCapacityRejectionRepository,
} from "./pstn-capacity-rejection.repository";
import { PstnCapacityRejectionService } from "./pstn-capacity-rejection.service";
import { PstnCapacityReadService } from "./pstn-capacity-read.service";

const emptyScopeCatalog = {
  listScopes: vi.fn(async () => ({
    tenants: [],
    providerAccounts: [],
    providerHealth: {},
    workers: [],
    page: { offset: 0, limit: 512, hasMore: false },
  })),
};

const config: PstnAdmissionConfig = {
  mode: "memory",
  workerId: "worker-a",
  limits: {
    global: 20,
    provider: 15,
    tenant: 8,
    worker: 6,
    runtime: {
      "pstn-sandwich": 12,
      "pstn-premium-realtime": 10,
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

describe("PstnCapacityReadService", () => {
  it("returns authoritative tenant usage with safe durable rejection history", async () => {
    const now = () => new Date("2026-07-28T10:00:00.000Z");
    const policy = new PstnCapacityPolicyService(
      new InMemoryPstnCapacityPolicyRepository(),
      config,
      now,
    );
    await policy.updatePolicy(
      {
        expectedVersion: 1,
        reason: "Set tenant allowance.",
        tenantAllowances: { "tenant-a": 5 },
      },
      { actorUserId: "admin-1" },
    );
    const rejections = new PstnCapacityRejectionService(
      new InMemoryPstnCapacityRejectionRepository(),
      now,
    );
    await rejections.record({
      tenantId: "tenant-a",
      callSessionId: "call-a",
      reasonCode: "worker_concurrency_limit",
    });
    const admission = {
      getHealth: vi.fn(async () => ({
        status: "healthy" as const,
        backend: "redis" as const,
      })),
      getUsage: vi.fn(async () => ({
        status: "available" as const,
        counts: {
          global: { total: 8, active: 6, reservations: 2 },
          provider: { total: 7, active: 5, reservations: 2 },
          providerAccount: { total: 4, active: 3, reservations: 1 },
          tenant: { total: 4, active: 3, reservations: 1 },
          runtime: { total: 6, active: 5, reservations: 1 },
          worker: { total: 4, active: 3, reservations: 1 },
        },
      })),
      getDimensionUsage: vi.fn(async (inputs: readonly unknown[]) => ({
        status: "available" as const,
        counts: inputs.map(() => ({
          total: 4,
          active: 3,
          reservations: 1,
        })),
      })),
    };
    const service = new PstnCapacityReadService(
      policy,
      rejections,
      admission,
      config,
      emptyScopeCatalog,
    );

    const posture = await service.getTenantPosture("tenant-a");

    expect(posture).toMatchObject({
      telemetryStatus: "fresh",
      effectiveAllowance: 5,
      activeUse: 4,
      remainingCapacity: 1,
      saturated: false,
      recentRejections: [
        {
          code: "capacity_reached",
        },
      ],
    });
    expect(JSON.stringify(posture)).not.toContain("worker-a");
    expect(JSON.stringify(posture)).not.toContain("redis");
  });

  it("reports unavailable telemetry as unknown rather than healthy zero", async () => {
    const policy = new PstnCapacityPolicyService(
      new InMemoryPstnCapacityPolicyRepository(),
      config,
    );
    const service = new PstnCapacityReadService(
      policy,
      new PstnCapacityRejectionService(
        new InMemoryPstnCapacityRejectionRepository(),
      ),
      {
        getHealth: vi.fn(async () => ({
          status: "unavailable" as const,
          backend: "redis" as const,
          reasonCode: "backend_unavailable" as const,
        })),
      },
      config,
      emptyScopeCatalog,
    );

    await expect(service.getTenantPosture("tenant-a")).resolves.toMatchObject({
      telemetryStatus: "unavailable",
      activeUse: null,
      remainingCapacity: null,
      saturated: null,
    });
  });

  it("includes durable rejection evidence in the staff posture", async () => {
    const now = () => new Date("2026-07-28T10:00:00.000Z");
    const rejections = new PstnCapacityRejectionService(
      new InMemoryPstnCapacityRejectionRepository(),
      now,
    );
    await rejections.record({
      tenantId: "tenant-a",
      callSessionId: "call-a",
      reasonCode: "tenant_concurrency_limit",
    });
    const service = new PstnCapacityReadService(
      new PstnCapacityPolicyService(
        new InMemoryPstnCapacityPolicyRepository(),
        config,
        now,
      ),
      rejections,
      {
        getHealth: vi.fn(async () => ({
          status: "unavailable" as const,
          backend: "redis" as const,
          reasonCode: "backend_unavailable" as const,
        })),
      },
      config,
      emptyScopeCatalog,
    );

    const posture = await service.getStaffPosture();

    expect(posture.recentRejections).toEqual([
      {
        tenantId: "tenant-a",
        occurredAt: "2026-07-28T10:00:00.000Z",
        reasonCode: "tenant_concurrency_limit",
      },
    ]);
    expect(posture.operationalState).toBe("unavailable");
  });

  it("retains historical rejection evidence without reporting current degradation", async () => {
    let current = new Date("2026-07-28T09:30:00.000Z");
    const now = () => current;
    const rejections = new PstnCapacityRejectionService(
      new InMemoryPstnCapacityRejectionRepository(),
      now,
    );
    await rejections.record({
      tenantId: "tenant-a",
      callSessionId: "call-a",
      reasonCode: "tenant_concurrency_limit",
    });
    current = new Date("2026-07-28T10:00:00.000Z");
    const service = new PstnCapacityReadService(
      new PstnCapacityPolicyService(
        new InMemoryPstnCapacityPolicyRepository(),
        config,
        now,
      ),
      rejections,
      {
        getHealth: vi.fn(async () => ({
          status: "healthy" as const,
          backend: "redis" as const,
        })),
        getDimensionUsage: vi.fn(async (inputs: readonly unknown[]) => ({
          status: "available" as const,
          counts: inputs.map(() => ({
            total: 0,
            active: 0,
            reservations: 0,
          })),
        })),
      },
      config,
      emptyScopeCatalog,
    );

    const posture = await service.getStaffPosture();

    expect(posture.recentRejections).toHaveLength(1);
    expect(posture.operationalState).toBe("healthy");
  });

  it("reports discovered scopes with active reduction limits and degraded posture", async () => {
    const now = () => new Date("2026-07-28T10:00:00.000Z");
    const redisConfig = { ...config, mode: "redis" as const };
    const policy = new PstnCapacityPolicyService(
      new InMemoryPstnCapacityPolicyRepository(),
      redisConfig,
      now,
    );
    await policy.updatePolicy(
      {
        expectedVersion: 1,
        reason: "Protect a recovering provider account.",
        providerAccountQuotas: {
          "twilio:AC123": 5,
        },
        workerLimits: {
          "worker-c": 4,
        },
        temporaryReductions: [
          {
            id: "provider-recovery",
            scope: "provider_account",
            key: "twilio:AC123",
            maxConcurrentCalls: 3,
            startsAt: "2026-07-28T09:55:00.000Z",
            expiresAt: "2026-07-28T10:30:00.000Z",
            reason: "Provider account recovery.",
          },
        ],
      },
      { actorUserId: "admin-1" },
    );
    const service = new PstnCapacityReadService(
      policy,
      new PstnCapacityRejectionService(
        new InMemoryPstnCapacityRejectionRepository(),
      ),
      {
        getHealth: vi.fn(async () => ({
          status: "healthy" as const,
          backend: "redis" as const,
        })),
        getUsage: vi.fn(async () => ({
          status: "available" as const,
          counts: {
            global: { total: 8, active: 6, reservations: 2 },
            provider: { total: 7, active: 5, reservations: 2 },
            providerAccount: { total: 2, active: 2, reservations: 0 },
            tenant: { total: 4, active: 3, reservations: 1 },
            runtime: { total: 6, active: 5, reservations: 1 },
            worker: { total: 5, active: 4, reservations: 1 },
          },
        })),
        getDimensionUsage: vi.fn(async (inputs: readonly unknown[]) => ({
          status: "available" as const,
          counts: inputs.map(() => ({
            total: 2,
            active: 2,
            reservations: 0,
          })),
        })),
      },
      redisConfig,
      {
        listScopes: vi.fn(async () => ({
          tenants: ["tenant-a"],
          providerAccounts: [
            {
              provider: "twilio",
              providerAccountId: "AC123",
              health: "degraded" as const,
            },
          ],
          providerHealth: {
            twilio: "unavailable" as const,
          },
          workers: ["worker-b"],
          page: { offset: 0, limit: 512, hasMore: false },
        })),
      },
    );

    const posture = await service.getStaffPosture();

    expect(posture.dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "provider",
          key: "twilio",
          limit: 15,
          health: "unavailable",
        }),
        expect.objectContaining({
          scope: "provider_account",
          key: "twilio:AC123",
          limit: 3,
          activeReductionIds: ["provider-recovery"],
          health: "degraded",
        }),
        expect.objectContaining({
          scope: "tenant",
          key: "tenant-a",
          limit: 8,
        }),
        expect.objectContaining({
          scope: "worker",
          key: "worker-b",
          limit: 6,
          health: "healthy",
        }),
      ]),
    );
    expect(posture.operationalState).toBe("degraded");
    expect(
      posture.dimensions.find((dimension) => dimension.key === "worker-c"),
    ).toBeUndefined();
    expect(
      posture.dimensions.find((dimension) => dimension.key === "worker-a"),
    ).toBeUndefined();
  });

  it("uses one bounded dimension telemetry read for staff posture", async () => {
    const getDimensionUsage = vi.fn(async (inputs: readonly unknown[]) => ({
      status: "available" as const,
      counts: inputs.map(() => ({
        total: 0,
        active: 0,
        reservations: 0,
      })),
    }));
    const service = new PstnCapacityReadService(
      new PstnCapacityPolicyService(
        new InMemoryPstnCapacityPolicyRepository(),
        config,
      ),
      new PstnCapacityRejectionService(
        new InMemoryPstnCapacityRejectionRepository(),
      ),
      {
        getHealth: vi.fn(async () => ({
          status: "healthy" as const,
          backend: "redis" as const,
        })),
        getUsage: vi.fn(),
        getDimensionUsage,
      },
      config,
      {
        listScopes: vi.fn(async () => ({
          tenants: ["tenant-a", "tenant-b"],
          providerAccounts: [],
          providerHealth: {},
          workers: [],
          page: { offset: 0, limit: 512, hasMore: false },
        })),
      },
    );

    await service.getStaffPosture();

    expect(getDimensionUsage).toHaveBeenCalledTimes(1);
  });

  it("chunks large staff dimension telemetry reads without losing posture", async () => {
    const batchSizes: number[] = [];
    const getDimensionUsage = vi.fn(async (inputs: readonly unknown[]) => {
      batchSizes.push(inputs.length);
      return {
        status: "available" as const,
        counts: inputs.map(() => ({
          total: 0,
          active: 0,
          reservations: 0,
        })),
      };
    });
    const service = new PstnCapacityReadService(
      new PstnCapacityPolicyService(
        new InMemoryPstnCapacityPolicyRepository(),
        config,
      ),
      new PstnCapacityRejectionService(
        new InMemoryPstnCapacityRejectionRepository(),
      ),
      {
        getHealth: vi.fn(async () => ({
          status: "healthy" as const,
          backend: "redis" as const,
        })),
        getDimensionUsage,
      },
      config,
      {
        listScopes: vi.fn(async () => ({
          tenants: Array.from({ length: 512 }, (_, index) => `tenant-${index}`),
          providerAccounts: [],
          providerHealth: {},
          workers: [],
          page: { offset: 0, limit: 512, hasMore: true },
        })),
      },
    );

    const posture = await service.getStaffPosture();

    expect(posture.telemetryStatus).toBe("unavailable");
    expect(posture.operationalState).toBe("unavailable");
    expect(posture.dimensions.some((dimension) =>
      dimension.telemetryAvailable
    )).toBe(true);
    expect(posture.scopePage).toEqual({
      offset: 0,
      limit: 512,
      hasMore: true,
    });
    expect(batchSizes.length).toBeGreaterThan(1);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(128);
    expect(batchSizes.reduce((total, size) => total + size, 0)).toBe(
      posture.dimensions.length,
    );
  });
});
