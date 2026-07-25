import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PstnAdmissionConfig } from "./pstn-admission-config";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import {
  PstnAdmissionModule,
  PstnAdmissionRedisLifecycle,
} from "./pstn-admission.module";
import type { PstnCallAdmission } from "./pstn-call-admission";

const lifecycleConfig: PstnAdmissionConfig = {
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

describe("PstnAdmissionModule", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("provides the deterministic in-memory coordinator outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PSTN_ADMISSION_REDIS_URL", "");
    const module = await Test.createTestingModule({
      imports: [PstnAdmissionModule],
    }).compile();

    const coordinator = module.get(PstnAdmissionCoordinator);

    await expect(coordinator.getHealth()).resolves.toEqual({
      status: "healthy",
      backend: "memory",
    });
    await module.close();
  });

  it("fails production admission closed when Redis is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PSTN_ADMISSION_REDIS_URL", "");
    const module = await Test.createTestingModule({
      imports: [PstnAdmissionModule],
    }).compile();

    const coordinator = module.get(PstnAdmissionCoordinator);

    await expect(coordinator.getHealth()).resolves.toEqual({
      status: "unavailable",
      backend: "redis",
      reasonCode: "backend_unavailable",
      unavailableReason: "redis_not_configured",
    });
    await expect(
      coordinator.reserve({
        tenantId: "tenant-a",
        callSessionId: "call-a",
        provider: "twilio",
        providerAccountId: "account-a",
        runtime: "pstn-premium-realtime",
      }),
    ).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "backend_unavailable",
    });
    await module.close();
  });

  it.each([
    {
      label: "a malformed renewal interval",
      activeTtlMs: "120000",
      renewIntervalMs: "later",
    },
    {
      label: "an unsafe active TTL and renewal interval relationship",
      activeTtlMs: "30000",
      renewIntervalMs: "20000",
    },
  ])("fails readiness closed without throwing during module construction for $label", async ({
    activeTtlMs,
    renewIntervalMs,
  }) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PSTN_ADMISSION_REDIS_URL", "redis://redis:6379");
    vi.stubEnv("PSTN_ADMISSION_GLOBAL_CPS_RATE", "10");
    vi.stubEnv("PSTN_ADMISSION_GLOBAL_CPS_BURST", "10");
    vi.stubEnv("PSTN_ADMISSION_PROVIDER_CPS_RATE", "5");
    vi.stubEnv("PSTN_ADMISSION_PROVIDER_CPS_BURST", "5");
    vi.stubEnv("PSTN_ADMISSION_ACTIVE_TTL_MS", activeTtlMs);
    vi.stubEnv("PSTN_ADMISSION_RENEW_INTERVAL_MS", renewIntervalMs);

    const module = await Test.createTestingModule({
      imports: [PstnAdmissionModule],
    }).compile();
    const coordinator = module.get(PstnAdmissionCoordinator);

    await expect(coordinator.getHealth()).resolves.toEqual({
      status: "unavailable",
      backend: "redis",
      reasonCode: "backend_unavailable",
      unavailableReason: "admission_config_invalid",
    });
    await module.close();
  });

  it("drains pending releases before Redis teardown exactly once", async () => {
    const phases: string[] = [];
    let releaseAttempts = 0;
    const admission: PstnCallAdmission = {
        reserve: vi.fn(async () => ({
          outcome: "admitted" as const,
          disposition: "created" as const,
          leaseExpiresAt: "2026-07-24T12:00:30.000Z",
          limitingDimension: "runtime_concurrency" as const,
          remainingCapacity: 3,
        })),
        activate: vi.fn(async () => ({
          outcome: "activated" as const,
          leaseExpiresAt: "2026-07-24T12:02:00.000Z",
        })),
        renew: vi.fn(async () => ({
          outcome: "renewed" as const,
          leaseExpiresAt: "2026-07-24T12:02:30.000Z",
        })),
        release: vi.fn(async () => {
          releaseAttempts += 1;
          phases.push(`release_${releaseAttempts}`);
          return releaseAttempts === 1
            ? { outcome: "backend_unavailable" as const }
            : { outcome: "released" as const };
        }),
        getHealth: vi.fn(async () => ({
          status: "healthy" as const,
          backend: "memory" as const,
        })),
    };
    const coordinator = new PstnAdmissionCoordinator(
      admission,
      lifecycleConfig,
    );
    await coordinator.reserve({
      tenantId: "tenant-a",
      callSessionId: "call-a",
      provider: "twilio",
      providerAccountId: "account-a",
      runtime: "pstn-premium-realtime",
    });
    await coordinator.release("tenant-a", "call-a");
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(() => phases.push("redis_destroyed")),
    };
    const lifecycle = new PstnAdmissionRedisLifecycle(
      client as never,
      coordinator,
    );

    await lifecycle.shutdown();
    await lifecycle.shutdown();

    expect(phases).toEqual([
      "release_1",
      "release_2",
      "redis_destroyed",
    ]);
  });
});
