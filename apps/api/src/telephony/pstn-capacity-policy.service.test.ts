import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import type { PstnAdmissionConfig } from "./pstn-admission-config";
import {
  InMemoryPstnCapacityPolicyRepository,
} from "./pstn-capacity-policy.repository";
import {
  PstnCapacityPolicyService,
} from "./pstn-capacity-policy.service";

const hardCeilings: PstnAdmissionConfig = {
  mode: "memory",
  workerId: "worker-a",
  limits: {
    global: 40,
    provider: 30,
    tenant: 20,
    worker: 12,
    runtime: {
      "pstn-sandwich": 24,
      "pstn-premium-realtime": 16,
    },
  },
  providerQuotaAllowances: {
    twilio: 28,
  },
  cps: {
    global: { capacity: 12, refillPerSecond: 8 },
    providerAccount: { capacity: 6, refillPerSecond: 4 },
  },
  claimTtlMs: 30_000,
  activeTtlMs: 120_000,
  renewIntervalMs: 30_000,
  commandTimeoutMs: 750,
};

function createService(now = () => new Date("2026-07-28T10:00:00.000Z")) {
  return new PstnCapacityPolicyService(
    new InMemoryPstnCapacityPolicyRepository(),
    hardCeilings,
    now,
  );
}

describe("PstnCapacityPolicyService", () => {
  it("starts from deployed ceilings and reports qualification as provisional", async () => {
    const service = createService();

    const posture = await service.getStaffPosture();

    expect(posture.policy.version).toBe(1);
    expect(posture.hardCeilings.limits.global).toBe(40);
    expect(posture.policy.limits.global).toBe(40);
    expect(posture.qualification).toEqual({
      status: "provisional",
      evidenceDate: null,
      environment: null,
      highestPassingConcurrentCalls: null,
      safetyHeadroomPercent: null,
      deployedConfigurationExceedsQualification: null,
    });
  });

  it("reports certified qualification evidence supplied by deployment", async () => {
    const service = new PstnCapacityPolicyService(
      new InMemoryPstnCapacityPolicyRepository(),
      hardCeilings,
      () => new Date("2026-07-28T10:00:00.000Z"),
      {
        PSTN_CAPACITY_QUALIFICATION_EVIDENCE_DATE: "2026-07-27",
        PSTN_CAPACITY_QUALIFICATION_ENVIRONMENT: "staging-eu-1",
        PSTN_CAPACITY_QUALIFICATION_HIGHEST_PASSING_CALLS: "50",
        PSTN_CAPACITY_QUALIFICATION_SAFETY_HEADROOM_PERCENT: "20",
      },
    );

    await expect(service.getStaffPosture()).resolves.toMatchObject({
      qualification: {
        status: "certified",
        evidenceDate: "2026-07-27",
        environment: "staging-eu-1",
        highestPassingConcurrentCalls: 50,
        safetyHeadroomPercent: 20,
        deployedConfigurationExceedsQualification: false,
      },
    });
  });

  it("does not certify an impossible qualification calendar date", async () => {
    const service = new PstnCapacityPolicyService(
      new InMemoryPstnCapacityPolicyRepository(),
      hardCeilings,
      () => new Date("2026-07-28T10:00:00.000Z"),
      {
        PSTN_CAPACITY_QUALIFICATION_EVIDENCE_DATE: "2026-02-31",
        PSTN_CAPACITY_QUALIFICATION_ENVIRONMENT: "staging-eu-1",
        PSTN_CAPACITY_QUALIFICATION_HIGHEST_PASSING_CALLS: "50",
        PSTN_CAPACITY_QUALIFICATION_SAFETY_HEADROOM_PERCENT: "20",
      },
    );

    await expect(service.getStaffPosture()).resolves.toMatchObject({
      qualification: { status: "provisional" },
    });
  });

  it("does not certify qualification when numeric evidence is blank", async () => {
    const service = new PstnCapacityPolicyService(
      new InMemoryPstnCapacityPolicyRepository(),
      hardCeilings,
      () => new Date("2026-07-28T10:00:00.000Z"),
      {
        PSTN_CAPACITY_QUALIFICATION_EVIDENCE_DATE: "2026-07-27",
        PSTN_CAPACITY_QUALIFICATION_ENVIRONMENT: "staging-eu-1",
        PSTN_CAPACITY_QUALIFICATION_HIGHEST_PASSING_CALLS: "50",
        PSTN_CAPACITY_QUALIFICATION_SAFETY_HEADROOM_PERCENT: " ",
      },
    );

    await expect(service.getStaffPosture()).resolves.toMatchObject({
      qualification: { status: "provisional" },
    });
  });

  it("updates policy with optimistic concurrency and immutable audit evidence", async () => {
    const service = createService();

    const result = await service.updatePolicy(
      {
        expectedVersion: 1,
        reason: "Reduce capacity while provider latency is elevated.",
        limits: {
          global: 32,
          provider: 24,
          tenantDefault: 14,
          worker: 10,
          runtime: {
            "pstn-sandwich": 20,
            "pstn-premium-realtime": 12,
          },
        },
      },
      { actorUserId: "platform-admin-1" },
    );

    expect(result.policy.version).toBe(2);
    expect(result.policy.limits.global).toBe(32);
    expect(result.audit).toMatchObject({
      policyVersion: 2,
      actorUserId: "platform-admin-1",
      reason: "Reduce capacity while provider latency is elevated.",
    });
    expect(result.audit.before.limits.global).toBe(40);
    expect(result.audit.after.limits.global).toBe(32);

    await expect(
      service.updatePolicy(
        {
          expectedVersion: 1,
          reason: "Stale update.",
          limits: { global: 20 },
        },
        { actorUserId: "platform-admin-2" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects limits that exceed a deployed or provider ceiling", async () => {
    const service = createService();

    await expect(
      service.updatePolicy(
        {
          expectedVersion: 1,
          reason: "Attempt to widen capacity.",
          limits: { global: 41 },
          providerQuotas: { twilio: 29 },
        },
        { actorUserId: "platform-admin-1" },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await expect(
      service.updatePolicy(
        {
          expectedVersion: 1,
          reason: "Invalid fractional concurrency.",
          limits: { tenantDefault: 3.5 },
        },
        { actorUserId: "platform-admin-1" },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await expect(
      service.updatePolicy(
        {
          expectedVersion: 1,
          reason: "Invalid reduction scope.",
          temporaryReductions: [
            {
              id: "invalid-scope",
              scope: "region" as never,
              key: "west",
              maxConcurrentCalls: 2,
              startsAt: "2026-07-28T10:00:00.000Z",
              expiresAt: "2026-07-28T11:00:00.000Z",
              reason: "This scope is unsupported.",
            },
          ],
        },
        { actorUserId: "platform-admin-1" },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("resolves account, tenant, runtime, worker, CPS, and active temporary reductions", async () => {
    let current = new Date("2026-07-28T10:00:00.000Z");
    const service = createService(() => current);

    await service.updatePolicy(
      {
        expectedVersion: 1,
        reason: "Apply tenant and account posture.",
        providerAccountQuotas: { "twilio:account-a": 18 },
        tenantAllowances: { "tenant-a": 9 },
        temporaryReductions: [
          {
            id: "incident-1",
            scope: "tenant",
            key: "tenant-a",
            maxConcurrentCalls: 4,
            startsAt: "2026-07-28T09:55:00.000Z",
            expiresAt: "2026-07-28T10:05:00.000Z",
            reason: "Protect tenant traffic during recovery.",
          },
        ],
      },
      { actorUserId: "platform-admin-1" },
    );

    const reduced = await service.resolveAdmissionPolicy({
      tenantId: "tenant-a",
      provider: "twilio",
      providerAccountId: "account-a",
      runtime: "pstn-premium-realtime",
      workerId: "worker-a",
      providerAvailable: true,
    });

    expect(reduced.limits).toEqual({
      global: 40,
      provider: 28,
      providerAccount: 18,
      tenant: 4,
      runtime: 16,
      worker: 12,
    });
    expect(reduced.activeReductionIds).toEqual(["incident-1"]);
    await expect(
      service.getTenantPosture("tenant-a", {
        activeUse: 2,
        telemetryStatus: "fresh",
        recentRejections: [],
      }),
    ).resolves.toMatchObject({
      effectiveAllowance: 4,
      activeUse: 2,
      remainingCapacity: 2,
    });

    current = new Date("2026-07-28T10:05:01.000Z");
    const restored = await service.resolveAdmissionPolicy({
      tenantId: "tenant-a",
      provider: "twilio",
      providerAccountId: "account-a",
      runtime: "pstn-premium-realtime",
      workerId: "worker-a",
      providerAvailable: true,
    });

    expect(restored.limits.tenant).toBe(9);
    expect(restored.activeReductionIds).toEqual([]);
    await expect(
      service.getTenantPosture("tenant-a", {
        activeUse: 2,
        telemetryStatus: "fresh",
        recentRejections: [],
      }),
    ).resolves.toMatchObject({
      effectiveAllowance: 9,
      remainingCapacity: 7,
    });
  });

  it("keeps provider health closure non-bypassable", async () => {
    const service = createService();

    const resolved = await service.resolveAdmissionPolicy({
      tenantId: "tenant-a",
      provider: "twilio",
      providerAccountId: "account-a",
      runtime: "pstn-sandwich",
      workerId: "worker-a",
      providerAvailable: false,
    });

    expect(resolved.limits.provider).toBe(0);
    expect(resolved.limits.providerAccount).toBe(0);
  });

  it("re-clamps persisted policy when deployment ceilings shrink", async () => {
    const repository = new InMemoryPstnCapacityPolicyRepository();
    const originalService = new PstnCapacityPolicyService(
      repository,
      hardCeilings,
    );
    await originalService.updatePolicy(
      {
        expectedVersion: 1,
        reason: "Configure the original deployment envelope.",
        limits: {
          global: 30,
          provider: 24,
          tenantDefault: 18,
          worker: 10,
          runtime: {
            "pstn-sandwich": 20,
            "pstn-premium-realtime": 14,
          },
        },
        cps: {
          global: { capacity: 10, refillPerSecond: 7 },
          providerAccount: { capacity: 5, refillPerSecond: 3 },
        },
        providerQuotas: { twilio: 22 },
        providerAccountQuotas: { "twilio:account-a": 17 },
        tenantAllowances: { "tenant-a": 16 },
        workerLimits: { "worker-a": 9 },
      },
      { actorUserId: "platform-admin-1" },
    );
    const reducedCeilings: PstnAdmissionConfig = {
      ...hardCeilings,
      limits: {
        global: 8,
        provider: 7,
        tenant: 6,
        worker: 5,
        runtime: {
          "pstn-sandwich": 4,
          "pstn-premium-realtime": 3,
        },
      },
      providerQuotaAllowances: { twilio: 6 },
      cps: {
        global: { capacity: 4, refillPerSecond: 2 },
        providerAccount: { capacity: 3, refillPerSecond: 1 },
      },
    };
    const restartedService = new PstnCapacityPolicyService(
      repository,
      reducedCeilings,
    );

    await expect(
      restartedService.resolveAdmissionPolicy({
        tenantId: "tenant-a",
        provider: "twilio",
        providerAccountId: "account-a",
        runtime: "pstn-premium-realtime",
        workerId: "worker-a",
        providerAvailable: true,
      }),
    ).resolves.toMatchObject({
      limits: {
        global: 8,
        provider: 6,
        providerAccount: 6,
        tenant: 6,
        runtime: 3,
        worker: 5,
      },
      cps: {
        global: { capacity: 4, refillPerSecond: 2 },
        providerAccount: { capacity: 3, refillPerSecond: 1 },
      },
    });
    await expect(
      restartedService.getTenantPosture("tenant-a", {
        activeUse: 1,
        telemetryStatus: "fresh",
        recentRejections: [],
      }),
    ).resolves.toMatchObject({
      effectiveAllowance: 6,
    });
  });

  it("never presents a tenant allowance above the durable global limit", async () => {
    const service = createService();
    await service.updatePolicy(
      {
        expectedVersion: 1,
        reason: "Reduce shared global capacity.",
        limits: { global: 5 },
        tenantAllowances: { "tenant-a": 9 },
      },
      { actorUserId: "platform-admin-1" },
    );

    await expect(
      service.getTenantPosture("tenant-a", {
        activeUse: 2,
        telemetryStatus: "fresh",
        recentRejections: [],
      }),
    ).resolves.toMatchObject({
      effectiveAllowance: 5,
      remainingCapacity: 3,
    });
  });

  it("returns a tenant-safe projection without topology or other tenant allowances", async () => {
    const service = createService();
    await service.updatePolicy(
      {
        expectedVersion: 1,
        reason: "Set tenant allowances.",
        tenantAllowances: {
          "tenant-a": 8,
          "tenant-b": 3,
        },
        workerLimits: {
          "worker-secret": 2,
        },
      },
      { actorUserId: "platform-admin-1" },
    );

    const posture = await service.getTenantPosture("tenant-a", {
      activeUse: 5,
      telemetryStatus: "fresh",
      recentRejections: [
        {
          occurredAt: "2026-07-28T09:59:00.000Z",
          reasonCode: "tenant_concurrency_limit",
        },
        {
          occurredAt: "2026-07-28T09:58:00.000Z",
          reasonCode: "provider_account_concurrency_limit",
        },
        {
          occurredAt: "2026-07-28T09:57:00.000Z",
          reasonCode: "provider_account_cps_limit",
        },
      ],
    });

    expect(posture).toEqual({
      capturedAt: "2026-07-28T10:00:00.000Z",
      telemetryStatus: "fresh",
      effectiveAllowance: 8,
      activeUse: 5,
      remainingCapacity: 3,
      saturated: false,
      operationalState: "degraded",
      recentRejections: [
        {
          occurredAt: "2026-07-28T09:59:00.000Z",
          code: "capacity_reached",
          message: "Your current call capacity is in use. Try again shortly or contact support.",
        },
        {
          occurredAt: "2026-07-28T09:58:00.000Z",
          code: "capacity_reached",
          message: "Your current call capacity is in use. Try again shortly or contact support.",
        },
        {
          occurredAt: "2026-07-28T09:57:00.000Z",
          code: "retry_later",
          message: "The call could not start. Try again shortly.",
        },
      ],
    });
    expect(JSON.stringify(posture)).not.toContain("tenant-b");
    expect(JSON.stringify(posture)).not.toContain("worker-secret");
  });

  it("does not treat historical tenant rejections as current degradation", async () => {
    const service = createService();

    await expect(
      service.getTenantPosture("tenant-a", {
        activeUse: 1,
        telemetryStatus: "fresh",
        recentRejections: [
          {
            occurredAt: "2026-07-28T09:30:00.000Z",
            reasonCode: "tenant_concurrency_limit",
          },
        ],
      }),
    ).resolves.toMatchObject({
      operationalState: "healthy",
      recentRejections: [],
    });
  });

  it("rejects an admission policy with too many temporary reductions", async () => {
    const service = createService();

    await expect(
      service.updatePolicy(
        {
          expectedVersion: 1,
          reason: "Attempt an unbounded reduction policy.",
          temporaryReductions: Array.from({ length: 129 }, (_, index) => ({
            id: `reduction-${index}`,
            scope: "global" as const,
            maxConcurrentCalls: 1,
            startsAt: "2026-07-28T09:00:00.000Z",
            expiresAt: "2026-07-28T11:00:00.000Z",
            reason: "Bounded test reduction.",
          })),
        },
        { actorUserId: "platform-admin-1" },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("rejects an operational policy map that exceeds its scope bound", async () => {
    const service = createService();

    await expect(
      service.updatePolicy(
        {
          expectedVersion: 1,
          reason: "Attempt an unbounded tenant allowance map.",
          tenantAllowances: Object.fromEntries(
            Array.from({ length: 513 }, (_, index) => [
              `tenant-${index}`,
              1,
            ]),
          ),
        },
        { actorUserId: "platform-admin-1" },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
