import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPstnAdmissionRedisClient,
  type PstnAdmissionRedisClient,
} from "./pstn-admission-redis-client";
import { RedisPstnCallAdmission } from "./redis-pstn-call-admission";
import type { PstnCallAdmissionInput } from "./pstn-call-admission";

const redisUrl = process.env.ZARA_TEST_REDIS_URL;
const describeWithRedis = redisUrl === undefined ? describe.skip : describe;

function createKeyPrefix(scope: string) {
  return `zt-${randomUUID()}-${scope}`;
}

const concurrencyCases = [
  {
    dimension: "provider",
    limit: "provider",
    reasonCode: "provider_concurrency_limit",
    isolatedScope: { provider: "sip" },
  },
  {
    dimension: "tenant",
    limit: "tenant",
    reasonCode: "tenant_concurrency_limit",
    isolatedScope: { tenantId: "tenant-b" },
  },
  {
    dimension: "runtime",
    limit: "runtime",
    reasonCode: "runtime_concurrency_limit",
    isolatedScope: { runtime: "cost-optimized" },
  },
  {
    dimension: "worker",
    limit: "worker",
    reasonCode: "worker_concurrency_limit",
    isolatedScope: { workerId: "worker-b" },
  },
] as const;

function createInput(
  index: number,
  overrides: Partial<PstnCallAdmissionInput> = {},
): PstnCallAdmissionInput {
  return {
    reservationId: `reservation-${index}`,
    callSessionId: `call-${index}`,
    tenantId: "tenant-a",
    providerAccountId: "account-a",
    workerId: "worker-a",
    provider: "twilio",
    runtime: "premium-realtime",
    limits: {
      global: 20,
      provider: 100,
      tenant: 100,
      runtime: 100,
      worker: 100,
    },
    cps: {
      global: { capacity: 100, refillPerSecond: 100 },
      providerAccount: { capacity: 100, refillPerSecond: 100 },
    },
    claimTtlMs: 1_000,
    activeTtlMs: 3_000,
    ...overrides,
  };
}

describeWithRedis("RedisPstnCallAdmission with real Redis", () => {
  let firstClient: PstnAdmissionRedisClient;
  let secondClient: PstnAdmissionRedisClient;
  let admissionA: RedisPstnCallAdmission;
  let admissionB: RedisPstnCallAdmission;
  const keyPrefix = `zara-test-${randomUUID()}`;

  beforeAll(async () => {
    firstClient = createPstnAdmissionRedisClient(redisUrl!, 1_000);
    secondClient = createPstnAdmissionRedisClient(redisUrl!, 1_000);
    await Promise.all([firstClient.connect(), secondClient.connect()]);
    admissionA = new RedisPstnCallAdmission(firstClient, { keyPrefix });
    admissionB = new RedisPstnCallAdmission(secondClient, { keyPrefix });
  });

  afterAll(() => {
    firstClient?.destroy();
    secondClient?.destroy();
  });

  it("does not oversubscribe the global limit across clients", async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        (index % 2 === 0 ? admissionA : admissionB).reserve(
          createInput(index),
        ),
      ),
    );

    expect(
      results.filter((result) => result.outcome === "admitted"),
    ).toHaveLength(20);
    expect(
      results.filter(
        (result) =>
          result.outcome === "denied" &&
          result.reasonCode === "global_concurrency_limit",
      ),
    ).toHaveLength(20);
  });

  it.each(concurrencyCases)(
    "enforces the $dimension concurrency limit atomically while isolating scopes",
    async ({ dimension, limit, reasonCode, isolatedScope }) => {
      const dimensionPrefix = createKeyPrefix(dimension);
      const dimensionA = new RedisPstnCallAdmission(firstClient, {
        keyPrefix: dimensionPrefix,
      });
      const dimensionB = new RedisPstnCallAdmission(secondClient, {
        keyPrefix: dimensionPrefix,
      });
      const limits = {
        ...createInput(0).limits,
        [limit]: 2,
      };

      const contended = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          (index % 2 === 0 ? dimensionA : dimensionB).reserve(
            createInput(1_000 + index, { limits }),
          ),
        ),
      );

      expect(
        contended.filter((result) => result.outcome === "admitted"),
      ).toHaveLength(2);
      expect(
        contended.filter(
          (result) =>
            result.outcome === "denied" &&
            result.reasonCode === reasonCode,
        ),
      ).toHaveLength(2);
      await expect(
        dimensionB.reserve(
          createInput(1_100, {
            ...isolatedScope,
            limits,
          }),
        ),
      ).resolves.toMatchObject({
        outcome: "admitted",
        disposition: "created",
      });
    },
  );

  it("enforces provider-account CPS atomically while isolating accounts and providers", async () => {
    const cpsPrefix = createKeyPrefix("account-cps");
    const cpsA = new RedisPstnCallAdmission(firstClient, {
      keyPrefix: cpsPrefix,
    });
    const cpsB = new RedisPstnCallAdmission(secondClient, {
      keyPrefix: cpsPrefix,
    });
    const cps = {
      global: { capacity: 100, refillPerSecond: 100 },
      providerAccount: { capacity: 2, refillPerSecond: 0.001 },
    };

    const contended = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        (index % 2 === 0 ? cpsA : cpsB).reserve(
          createInput(1_200 + index, { cps }),
        ),
      ),
    );

    expect(
      contended.filter((result) => result.outcome === "admitted"),
    ).toHaveLength(2);
    expect(
      contended.filter(
        (result) =>
          result.outcome === "denied" &&
          result.reasonCode === "provider_account_cps_limit",
      ),
    ).toHaveLength(2);
    await expect(
      cpsA.reserve(
        createInput(1_300, {
          providerAccountId: "account-b",
          cps,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await expect(
      cpsB.reserve(
        createInput(1_301, {
          provider: "sip",
          cps,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
  });

  it("reuses a duplicate reservation without consuming CPS twice", async () => {
    const duplicatePrefix = `${keyPrefix}-duplicate`;
    const duplicateA = new RedisPstnCallAdmission(firstClient, {
      keyPrefix: duplicatePrefix,
    });
    const duplicateB = new RedisPstnCallAdmission(secondClient, {
      keyPrefix: duplicatePrefix,
    });
    const input = createInput(100, {
      cps: {
        global: { capacity: 1, refillPerSecond: 0.001 },
        providerAccount: { capacity: 1, refillPerSecond: 0.001 },
      },
    });

    const duplicates = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 === 0 ? duplicateA : duplicateB).reserve(input),
      ),
    );
    const other = await duplicateA.reserve(
      createInput(101, { cps: input.cps }),
    );

    expect(
      duplicates.filter(
        (result) =>
          result.outcome === "admitted" &&
          result.disposition === "created",
      ),
    ).toHaveLength(1);
    expect(duplicates.every((result) => result.outcome === "admitted")).toBe(
      true,
    );
    expect(other).toMatchObject({
      outcome: "denied",
      reasonCode: "global_cps_limit",
    });
  });

  it("reclaims expired claims and releases reservations idempotently", async () => {
    const lifecyclePrefix = `${keyPrefix}-lifecycle`;
    const lifecycle = new RedisPstnCallAdmission(firstClient, {
      keyPrefix: lifecyclePrefix,
    });
    const input = createInput(200, {
      limits: {
        global: 1,
        provider: 1,
        tenant: 1,
        runtime: 1,
        worker: 1,
      },
      claimTtlMs: 100,
    });
    await expect(lifecycle.reserve(input)).resolves.toMatchObject({
      outcome: "admitted",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const replacement = createInput(201, {
      limits: input.limits,
      claimTtlMs: 100,
    });
    await expect(lifecycle.reserve(replacement)).resolves.toMatchObject({
      outcome: "admitted",
    });
    await expect(lifecycle.release(replacement)).resolves.toEqual({
      outcome: "released",
    });
    await expect(lifecycle.release(replacement)).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("activates and releases the same reservation across workers and clients", async () => {
    const lifecyclePrefix = `${keyPrefix}-cross-worker`;
    const ingress = new RedisPstnCallAdmission(firstClient, {
      keyPrefix: lifecyclePrefix,
    });
    const mediaWorker = new RedisPstnCallAdmission(secondClient, {
      keyPrefix: lifecyclePrefix,
    });
    const input = createInput(250, {
      limits: {
        global: 1,
        provider: 1,
        tenant: 1,
        runtime: 1,
        worker: 1,
      },
    });

    await expect(ingress.reserve(input)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await expect(
      mediaWorker.reserve({
        ...input,
        workerId: "worker-b",
      }),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "existing",
    });
    await expect(
      mediaWorker.activate({
        reservationId: input.reservationId,
        workerId: "worker-b",
        workerLimit: 1,
        activeTtlMs: input.activeTtlMs,
      }),
    ).resolves.toMatchObject({
      outcome: "activated",
    });
    await expect(
      ingress.release({ reservationId: input.reservationId }),
    ).resolves.toEqual({
      outcome: "released",
    });
    await expect(
      ingress.reserve({
        ...createInput(251),
        limits: input.limits,
      }),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
  });

  it("re-establishes expired active accounting without consuming CPS again", async () => {
    const recoveryPrefix = createKeyPrefix("recover");
    const recovery = new RedisPstnCallAdmission(firstClient, {
      keyPrefix: recoveryPrefix,
    });
    const input = createInput(270, {
      cps: {
        global: { capacity: 1, refillPerSecond: 0.001 },
        providerAccount: { capacity: 1, refillPerSecond: 0.001 },
      },
      activeTtlMs: 1_000,
    });

    await expect(recovery.reserve(input)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await expect(recovery.activate(input)).resolves.toMatchObject({
      outcome: "activated",
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    await expect(recovery.activate(input)).resolves.toMatchObject({
      outcome: "activated",
    });
    await expect(recovery.release(input)).resolves.toEqual({
      outcome: "released",
    });
    await expect(
      recovery.reserve(
        createInput(271, {
          cps: input.cps,
          activeTtlMs: input.activeTtlMs,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "global_cps_limit",
    });
  });

  it("rejects arbitrary full activation without consuming concurrency capacity", async () => {
    const guardedPrefix = createKeyPrefix("guard-recovery");
    const guarded = new RedisPstnCallAdmission(firstClient, {
      keyPrefix: guardedPrefix,
    });
    const limits = {
      global: 1,
      provider: 1,
      tenant: 1,
      runtime: 1,
      worker: 1,
    };
    const arbitrary = createInput(275, { limits });

    await expect(guarded.activate(arbitrary)).resolves.toEqual({
      outcome: "not_found",
    });
    await expect(
      guarded.reserve(createInput(276, { limits })),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
  });

  it("moves active ownership only when the destination worker has capacity", async () => {
    const ownershipPrefix = createKeyPrefix("ownership");
    const ownershipA = new RedisPstnCallAdmission(firstClient, {
      keyPrefix: ownershipPrefix,
    });
    const ownershipB = new RedisPstnCallAdmission(secondClient, {
      keyPrefix: ownershipPrefix,
    });
    const workerLimits = {
      global: 10,
      provider: 10,
      tenant: 10,
      runtime: 10,
      worker: 1,
    };
    const moving = createInput(280, { limits: workerLimits });
    const destinationOccupant = createInput(281, {
      workerId: "worker-b",
      limits: workerLimits,
    });

    await ownershipA.reserve(moving);
    await ownershipA.activate(moving);
    await ownershipB.reserve(destinationOccupant);
    await ownershipB.activate(destinationOccupant);

    await expect(
      ownershipB.activate({
        reservationId: moving.reservationId,
        workerId: "worker-b",
        workerLimit: 1,
        activeTtlMs: moving.activeTtlMs,
      }),
    ).resolves.toEqual({
      outcome: "denied",
      reasonCode: "worker_concurrency_limit",
    });

    await ownershipB.release(destinationOccupant);
    await expect(
      ownershipB.activate({
        reservationId: moving.reservationId,
        workerId: "worker-b",
        workerLimit: 1,
        activeTtlMs: moving.activeTtlMs,
      }),
    ).resolves.toMatchObject({
      outcome: "existing",
    });
    await expect(
      ownershipA.renew({
        reservationId: moving.reservationId,
        workerId: "worker-a",
        activeTtlMs: moving.activeTtlMs,
      }),
    ).resolves.toEqual({
      outcome: "not_owner",
    });
    await expect(
      ownershipB.renew({
        reservationId: moving.reservationId,
        workerId: "worker-b",
        activeTtlMs: moving.activeTtlMs,
      }),
    ).resolves.toMatchObject({
      outcome: "renewed",
    });
    await expect(
      ownershipA.reserve(
        createInput(282, {
          workerId: "worker-a",
          limits: workerLimits,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await expect(
      ownershipB.reserve(
        createInput(283, {
          workerId: "worker-b",
          limits: workerLimits,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "worker_concurrency_limit",
    });
  });

  it("blocks peers at primary expiry and bounds abandoned recovery holds", async () => {
    const debtPrefix = createKeyPrefix("hold");
    const owner = new RedisPstnCallAdmission(firstClient, {
      keyPrefix: debtPrefix,
    });
    const peer = new RedisPstnCallAdmission(secondClient, {
      keyPrefix: debtPrefix,
    });
    const limits = {
      global: 2,
      provider: 10,
      tenant: 10,
      runtime: 10,
      worker: 10,
    };
    const liveCall = createInput(290, {
      limits,
      activeTtlMs: 1_000,
    });
    await owner.reserve(liveCall);
    await owner.activate(liveCall);
    const whilePrimaryValid = createInput(291, { limits });
    await expect(peer.reserve(whilePrimaryValid)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await peer.release(whilePrimaryValid);
    await new Promise((resolve) => setTimeout(resolve, 1_050));

    await expect(
      peer.reserve(createInput(292, { limits })),
    ).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
    await expect(owner.activate(liveCall)).resolves.toMatchObject({
      outcome: "activated",
    });
    const afterReconciliation = createInput(293, { limits });
    await expect(peer.reserve(afterReconciliation)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await owner.release(liveCall);
    await peer.release(afterReconciliation);

    const releasedCall = createInput(294, {
      limits: { ...limits, global: 1 },
      activeTtlMs: 1_000,
    });
    await owner.reserve(releasedCall);
    await owner.activate(releasedCall);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    await expect(
      peer.reserve(
        createInput(295, {
          limits: releasedCall.limits,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
    await expect(owner.release(releasedCall)).resolves.toEqual({
      outcome: "not_found",
    });
    const afterRelease = createInput(296, {
      limits: releasedCall.limits,
    });
    await expect(peer.reserve(afterRelease)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await peer.release(afterRelease);

    const orphanedCall = createInput(297, {
      limits: releasedCall.limits,
      activeTtlMs: 1_000,
    });
    await owner.reserve(orphanedCall);
    await owner.activate(orphanedCall);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    await expect(
      peer.reserve(
        createInput(298, {
          limits: orphanedCall.limits,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await expect(
      peer.reserve(
        createInput(299, {
          limits: orphanedCall.limits,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
  }, 10_000);

  it("advances the recovery hold only for an authorized renewal", async () => {
    const renewalPrefix = createKeyPrefix("hold-renew");
    const owner = new RedisPstnCallAdmission(firstClient, {
      keyPrefix: renewalPrefix,
    });
    const peer = new RedisPstnCallAdmission(secondClient, {
      keyPrefix: renewalPrefix,
    });
    const limits = {
      global: 2,
      provider: 10,
      tenant: 10,
      runtime: 10,
      worker: 10,
    };
    const input = createInput(305, {
      limits,
      activeTtlMs: 2_000,
    });
    await owner.reserve(input);
    await owner.activate(input);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(
      owner.renew({
        reservationId: input.reservationId,
        workerId: input.workerId,
        activeTtlMs: input.activeTtlMs,
      }),
    ).resolves.toMatchObject({
      outcome: "renewed",
    });

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const afterOriginalDeadline = createInput(306, { limits });
    await expect(peer.reserve(afterOriginalDeadline)).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
    });
    await peer.release(afterOriginalDeadline);

    await new Promise((resolve) => setTimeout(resolve, 1_050));
    await expect(
      peer.reserve(createInput(307, { limits })),
    ).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
    await owner.release(input);
  });

  it("fails new reservations closed after the client is unavailable", async () => {
    const isolatedClient = createPstnAdmissionRedisClient(redisUrl!, 100);
    await isolatedClient.connect();
    const isolated = new RedisPstnCallAdmission(isolatedClient, {
      keyPrefix: `${keyPrefix}-outage`,
    });
    isolatedClient.destroy();

    await expect(isolated.reserve(createInput(310))).resolves.toMatchObject({
      outcome: "denied",
      reasonCode: "backend_unavailable",
    });
  });
});
