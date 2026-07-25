import { describe, expect, it } from "vitest";

import { InMemoryPstnCallAdmission } from "./in-memory-pstn-call-admission";
import type {
  PstnAdmissionLimitingDimension,
  PstnAdmissionReasonCode,
  PstnCallAdmissionInput,
} from "./pstn-call-admission";

const startTimeMs = Date.parse("2026-07-24T12:00:00.000Z");

function createInput(
  overrides: Partial<PstnCallAdmissionInput> = {},
): PstnCallAdmissionInput {
  return {
    reservationId: "reservation-a",
    callSessionId: "call-a",
    tenantId: "tenant-a",
    providerAccountId: "account-a",
    workerId: "worker-a",
    provider: "twilio",
    runtime: "premium-realtime",
    limits: {
      global: 20,
      provider: 20,
      tenant: 20,
      runtime: 20,
      worker: 20,
    },
    cps: {
      global: {
        capacity: 20,
        refillPerSecond: 10,
      },
      providerAccount: {
        capacity: 20,
        refillPerSecond: 10,
      },
    },
    claimTtlMs: 10_000,
    activeTtlMs: 60_000,
    ...overrides,
  };
}

describe("InMemoryPstnCallAdmission", () => {
  it.each<
    [
      keyof PstnCallAdmissionInput["limits"],
      PstnAdmissionReasonCode,
      PstnAdmissionLimitingDimension,
      Partial<PstnCallAdmissionInput>,
    ]
  >([
    [
      "global",
      "global_concurrency_limit",
      "global_concurrency",
      {
        provider: "sip",
        tenantId: "tenant-b",
        runtime: "cost-optimized",
        workerId: "worker-b",
      },
    ],
    [
      "provider",
      "provider_concurrency_limit",
      "provider_concurrency",
      {
        tenantId: "tenant-b",
        runtime: "cost-optimized",
        workerId: "worker-b",
      },
    ],
    [
      "tenant",
      "tenant_concurrency_limit",
      "tenant_concurrency",
      {
        provider: "sip",
        runtime: "cost-optimized",
        workerId: "worker-b",
      },
    ],
    [
      "runtime",
      "runtime_concurrency_limit",
      "runtime_concurrency",
      {
        provider: "sip",
        tenantId: "tenant-b",
        workerId: "worker-b",
      },
    ],
    [
      "worker",
      "worker_concurrency_limit",
      "worker_concurrency",
      {
        provider: "sip",
        tenantId: "tenant-b",
        runtime: "cost-optimized",
      },
    ],
  ])(
    "enforces the %s concurrency limit",
    async (limit, reasonCode, limitingDimension, secondScope) => {
      const admission = new InMemoryPstnCallAdmission(() => startTimeMs);
      const limits = {
        ...createInput().limits,
        [limit]: 1,
      };

      await expect(admission.reserve(createInput({ limits }))).resolves.toMatchObject({
        outcome: "admitted",
        disposition: "created",
        remainingCapacity: 0,
        limitingDimension,
      });
      await expect(
        admission.reserve(
          createInput({
            ...secondScope,
            reservationId: "reservation-b",
            callSessionId: "call-b",
            providerAccountId: "account-b",
            limits,
          }),
        ),
      ).resolves.toEqual({
        outcome: "denied",
        reasonCode,
        limitingDimension,
        remainingCapacity: 0,
      });
    },
  );

  it("closes new admission when an effective concurrency limit is zero", async () => {
    const admission = new InMemoryPstnCallAdmission(() => startTimeMs);

    await expect(
      admission.reserve(
        createInput({
          limits: { ...createInput().limits, provider: 0 },
        }),
      ),
    ).resolves.toEqual({
      outcome: "denied",
      reasonCode: "provider_concurrency_limit",
      limitingDimension: "provider_concurrency",
      remainingCapacity: 0,
    });
  });

  it("returns the lowest remaining concurrency allowance atomically", async () => {
    const admission = new InMemoryPstnCallAdmission(() => startTimeMs);

    await expect(
      admission.reserve(
        createInput({
          limits: {
            global: 20,
            provider: 8,
            tenant: 4,
            runtime: 12,
            worker: 6,
          },
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "admitted",
      limitingDimension: "tenant_concurrency",
      remainingCapacity: 3,
    });
  });

  it("enforces global and provider-account token buckets without debiting duplicates", async () => {
    let nowMs = startTimeMs;
    const admission = new InMemoryPstnCallAdmission(() => nowMs);
    const cps = {
      global: { capacity: 3, refillPerSecond: 1 },
      providerAccount: { capacity: 2, refillPerSecond: 1 },
    };
    const firstInput = createInput({ cps });

    const created = await admission.reserve(firstInput);
    const duplicate = await admission.reserve(firstInput);
    expect(created).toEqual({
      outcome: "admitted",
      disposition: "created",
      leaseExpiresAt: "2026-07-24T12:00:10.000Z",
      limitingDimension: "global_concurrency",
      remainingCapacity: 19,
    });
    expect(duplicate).toEqual({
      outcome: "admitted",
      disposition: "existing",
      leaseExpiresAt: "2026-07-24T12:00:10.000Z",
      limitingDimension: "global_concurrency",
      remainingCapacity: 19,
    });
    await admission.release(firstInput);

    const secondInput = createInput({
      reservationId: "reservation-b",
      callSessionId: "call-b",
      cps,
    });
    await expect(admission.reserve(secondInput)).resolves.toMatchObject({
      outcome: "admitted",
    });
    await admission.release(secondInput);

    await expect(
      admission.reserve(
        createInput({
          reservationId: "reservation-c",
          callSessionId: "call-c",
          cps,
        }),
      ),
    ).resolves.toEqual({
      outcome: "denied",
      reasonCode: "provider_account_cps_limit",
      limitingDimension: "provider_account_cps",
    });

    nowMs += 1_000;
    await expect(
      admission.reserve(
        createInput({
          reservationId: "reservation-d",
          callSessionId: "call-d",
          cps,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
  });

  it("denies on the global CPS bucket without consuming provider-account capacity", async () => {
    const admission = new InMemoryPstnCallAdmission(() => startTimeMs);
    const cps = {
      global: { capacity: 1, refillPerSecond: 1 },
      providerAccount: { capacity: 2, refillPerSecond: 1 },
    };
    const firstInput = createInput({ cps });
    await admission.reserve(firstInput);
    await admission.release(firstInput);

    await expect(
      admission.reserve(
        createInput({
          reservationId: "reservation-b",
          callSessionId: "call-b",
          providerAccountId: "account-b",
          cps,
        }),
      ),
    ).resolves.toEqual({
      outcome: "denied",
      reasonCode: "global_cps_limit",
      limitingDimension: "global_cps",
    });
  });

  it("isolates provider-account CPS buckets by provider and account identity", async () => {
    const admission = new InMemoryPstnCallAdmission(() => startTimeMs);
    const cps = {
      global: { capacity: 2, refillPerSecond: 1 },
      providerAccount: { capacity: 1, refillPerSecond: 1 },
    };
    const twilioInput = createInput({
      provider: "twilio",
      providerAccountId: "shared-account",
      cps,
    });

    await expect(admission.reserve(twilioInput)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await admission.release(twilioInput);

    await expect(
      admission.reserve(
        createInput({
          reservationId: "reservation-sip",
          callSessionId: "call-sip",
          provider: "sip",
          providerAccountId: "shared-account",
          cps,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
  });

  it("reclaims an expired claim before evaluating concurrency", async () => {
    let nowMs = startTimeMs;
    const admission = new InMemoryPstnCallAdmission(() => nowMs);
    const limited = createInput({
      limits: { ...createInput().limits, global: 1 },
      claimTtlMs: 1_000,
    });

    await admission.reserve(limited);
    nowMs += 1_001;

    await expect(
      admission.reserve(
        createInput({
          reservationId: "reservation-b",
          callSessionId: "call-b",
          limits: limited.limits,
          claimTtlMs: 1_000,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await expect(admission.activate(limited)).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("activates and renews only a live reservation with the bounded active TTL", async () => {
    let nowMs = startTimeMs;
    const admission = new InMemoryPstnCallAdmission(() => nowMs);
    const input = createInput({
      claimTtlMs: 1_000,
      activeTtlMs: 5_000,
      limits: { ...createInput().limits, global: 1 },
    });

    await admission.reserve(input);
    await expect(admission.activate(input)).resolves.toEqual({
      outcome: "activated",
      leaseExpiresAt: "2026-07-24T12:00:05.000Z",
      ownershipEpoch: 1,
    });
    await expect(admission.activate(input)).resolves.toEqual({
      outcome: "existing",
      leaseExpiresAt: "2026-07-24T12:00:05.000Z",
      ownershipEpoch: 1,
    });

    nowMs += 4_000;
    await expect(admission.renew({
      ...input,
      ownershipEpoch: 1,
    })).resolves.toEqual({
      outcome: "renewed",
      leaseExpiresAt: "2026-07-24T12:00:09.000Z",
      ownershipEpoch: 1,
    });

    nowMs += 2_000;
    await expect(
      admission.reserve(
        createInput({
          reservationId: "reservation-b",
          callSessionId: "call-b",
          limits: input.limits,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "global_concurrency_limit",
    });

    nowMs += 3_001;
    await expect(admission.renew({
      ...input,
      ownershipEpoch: 1,
    })).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("blocks new admission at active lease expiry until the owner reconstructs", async () => {
    let nowMs = startTimeMs;
    const admission = new InMemoryPstnCallAdmission(() => nowMs);
    const input = createInput({
      activeTtlMs: 1_000,
      limits: { ...createInput().limits, global: 2 },
      cps: {
        global: { capacity: 2, refillPerSecond: 0.001 },
        providerAccount: { capacity: 2, refillPerSecond: 0.001 },
      },
    });

    await admission.reserve(input);
    await admission.activate(input);
    nowMs += 1_001;

    const peer = createInput({
      reservationId: "reservation-b",
      callSessionId: "call-b",
      limits: input.limits,
      cps: input.cps,
    });
    await expect(admission.reserve(peer)).resolves.toEqual({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
    await expect(
      admission.activate({
        ...input,
        workerId: "worker-b",
      }),
    ).resolves.toEqual({
      outcome: "not_owner",
    });
    await expect(admission.activate(input)).resolves.toMatchObject({
      outcome: "activated",
    });
    await expect(admission.reserve(peer)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
  });

  it("advances the recovery hold on authorized renewal and clears it on release", async () => {
    let nowMs = startTimeMs;
    const admission = new InMemoryPstnCallAdmission(() => nowMs);
    const input = createInput({
      activeTtlMs: 1_000,
      limits: { ...createInput().limits, global: 2 },
    });
    const peer = createInput({
      reservationId: "reservation-b",
      callSessionId: "call-b",
      limits: input.limits,
    });

    await admission.reserve(input);
    await admission.activate(input);
    nowMs += 500;
    await admission.renew({
      ...input,
      ownershipEpoch: 1,
    });

    nowMs = startTimeMs + 1_001;
    await expect(admission.reserve(peer)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await admission.release(peer);

    nowMs = startTimeMs + 1_501;
    await expect(admission.reserve(peer)).resolves.toEqual({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
    await expect(admission.release(input)).resolves.toEqual({
      outcome: "not_found",
    });
    await expect(admission.reserve(peer)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
  });

  it("refreshes a denied reconstruction hold and expires abandoned recovery state", async () => {
    let nowMs = startTimeMs;
    const admission = new InMemoryPstnCallAdmission(() => nowMs);
    const input = createInput({
      activeTtlMs: 1_000,
      limits: { ...createInput().limits, global: 2 },
    });
    const occupant = createInput({
      reservationId: "reservation-b",
      callSessionId: "call-b",
      workerId: "worker-b",
      activeTtlMs: 10_000,
      limits: input.limits,
    });

    await admission.reserve(input);
    await admission.activate(input);
    await admission.reserve(occupant);
    await admission.activate(occupant);

    nowMs += 1_500;
    await expect(
      admission.activate({
        ...input,
        limits: { ...input.limits, global: 1 },
      }),
    ).resolves.toEqual({
      outcome: "denied",
      reasonCode: "global_concurrency_limit",
    });
    await admission.release(occupant);

    const peer = createInput({
      reservationId: "reservation-c",
      callSessionId: "call-c",
      limits: input.limits,
    });
    nowMs = startTimeMs + 2_100;
    await expect(admission.reserve(peer)).resolves.toEqual({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });

    nowMs = startTimeMs + 2_501;
    await expect(admission.reserve(peer)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
  });

  it("fences an active call to one worker and ownership epoch", async () => {
    const admission = new InMemoryPstnCallAdmission(() => startTimeMs);
    const limits = {
      global: 10,
      provider: 10,
      tenant: 10,
      runtime: 10,
      worker: 1,
    };
    const call = createInput({ limits });
    await admission.reserve(call);
    await expect(admission.activate(call)).resolves.toEqual({
      outcome: "activated",
      leaseExpiresAt: "2026-07-24T12:01:00.000Z",
      ownershipEpoch: 1,
    });

    await expect(
      admission.activate({
        reservationId: call.reservationId,
        workerId: "worker-b",
        workerLimit: 1,
        activeTtlMs: call.activeTtlMs,
      }),
    ).resolves.toEqual({
      outcome: "not_owner",
    });

    await expect(
      admission.renew({
        reservationId: call.reservationId,
        workerId: "worker-a",
        ownershipEpoch: 2,
        activeTtlMs: call.activeTtlMs,
      }),
    ).resolves.toEqual({
      outcome: "not_owner",
    });
    await expect(
      admission.release({
        reservationId: call.reservationId,
        workerId: "worker-a",
        ownershipEpoch: 2,
      }),
    ).resolves.toEqual({
      outcome: "not_owner",
    });
    await expect(
      admission.renew({
        reservationId: call.reservationId,
        workerId: "worker-a",
        ownershipEpoch: 1,
        activeTtlMs: call.activeTtlMs,
      }),
    ).resolves.toEqual({
      outcome: "renewed",
      leaseExpiresAt: "2026-07-24T12:01:00.000Z",
      ownershipEpoch: 1,
    });
    await expect(
      admission.release({
        reservationId: call.reservationId,
        workerId: "worker-a",
        ownershipEpoch: 1,
      }),
    ).resolves.toEqual({
      outcome: "released",
    });
  });

  it("releases a reservation idempotently", async () => {
    const admission = new InMemoryPstnCallAdmission(() => startTimeMs);
    const input = createInput();

    await admission.reserve(input);
    await expect(admission.release(input)).resolves.toEqual({
      outcome: "released",
    });
    await expect(admission.release(input)).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("fails closed when a duplicate reservation changes opaque scope", async () => {
    const admission = new InMemoryPstnCallAdmission(() => startTimeMs);
    const input = createInput();
    await admission.reserve(input);

    const result = await admission.reserve({
      ...input,
      tenantId: "tenant-other",
    });

    expect(result).toEqual({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
  });

  it("returns only bounded, redacted result and health fields", async () => {
    const admission = new InMemoryPstnCallAdmission(() => startTimeMs);
    const input = createInput();

    const outputs = [
      await admission.reserve(input),
      await admission.activate(input),
      await admission.renew({
        ...input,
        ownershipEpoch: 1,
      }),
      await admission.release(input),
      await admission.getHealth(),
    ];
    const serialized = JSON.stringify(outputs);

    expect(serialized).not.toContain(input.reservationId);
    expect(serialized).not.toContain(input.callSessionId);
    expect(serialized).not.toContain(input.tenantId);
    expect(serialized).not.toContain(input.providerAccountId);
    expect(serialized).not.toContain(input.workerId);
    expect(await admission.getHealth()).toEqual({
      status: "healthy",
      backend: "memory",
    });
  });
});
