import { describe, expect, it } from "vitest";

import {
  RedisPstnCallAdmission,
  type PstnAdmissionRedisCommands,
} from "./redis-pstn-call-admission";
import type {
  PstnAdmissionReasonCode,
  PstnCallAdmissionInput,
} from "./pstn-call-admission";

const nowMs = Date.parse("2026-07-24T12:00:00.000Z");

function createInput(
  overrides: Partial<PstnCallAdmissionInput> = {},
): PstnCallAdmissionInput {
  return {
    reservationId: "reservation-sensitive",
    callSessionId: "call-sensitive",
    tenantId: "tenant-sensitive",
    providerAccountId: "account-sensitive",
    workerId: "worker-sensitive",
    provider: "twilio",
    runtime: "premium-realtime",
    limits: {
      global: 20,
      provider: 18,
      providerAccount: 9,
      tenant: 5,
      runtime: 12,
      worker: 4,
    },
    cps: {
      global: {
        capacity: 10,
        refillPerSecond: 5,
      },
      providerAccount: {
        capacity: 4,
        refillPerSecond: 2,
      },
    },
    claimTtlMs: 10_000,
    activeTtlMs: 60_000,
    ...overrides,
  };
}

class FakeRedisCommands implements PstnAdmissionRedisCommands {
  readonly calls: Array<{
    script: string;
    keys: readonly string[];
    arguments: readonly string[];
  }> = [];

  constructor(
    private readonly responses: unknown[],
    private readonly error?: Error,
  ) {}

  async eval(
    script: string,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<unknown> {
    this.calls.push({ script, keys, arguments: args });
    if (this.error !== undefined) {
      throw this.error;
    }
    return this.responses.shift();
  }
}

describe("RedisPstnCallAdmission", () => {
  it("reads authoritative dimension usage without exposing raw scope identifiers", async () => {
    const redis = new FakeRedisCommands([[
      "7", "5", "2",
      "5", "4", "1",
      "2", "1", "1",
      "2", "1", "1",
      "4", "3", "1",
      "3", "2", "1",
    ]]);
    const admission = new RedisPstnCallAdmission(redis, {
      keyPrefix: "zara:test",
    });
    const input = createInput();

    await expect(admission.getUsage(input)).resolves.toEqual({
      status: "available",
      counts: {
        global: { total: 7, active: 5, reservations: 2 },
        provider: { total: 5, active: 4, reservations: 1 },
        providerAccount: { total: 2, active: 1, reservations: 1 },
        tenant: { total: 2, active: 1, reservations: 1 },
        runtime: { total: 4, active: 3, reservations: 1 },
        worker: { total: 3, active: 2, reservations: 1 },
      },
    });

    const serializedCommand = JSON.stringify(redis.calls[0]);
    expect(serializedCommand).not.toContain(input.tenantId);
    expect(serializedCommand).not.toContain(input.providerAccountId);
    expect(serializedCommand).not.toContain(input.workerId);
  });

  it("reads selected dimensions with one Redis command", async () => {
    const redis = new FakeRedisCommands([[
      "7", "5", "2",
      "2", "1", "1",
    ]]);
    const admission = new RedisPstnCallAdmission(redis, {
      keyPrefix: "zara:test",
    });
    const input = createInput();

    await expect(
      admission.getDimensionUsage([
        { ...input, dimension: "global" },
        { ...input, dimension: "tenant" },
      ]),
    ).resolves.toEqual({
      status: "available",
      counts: [
        { total: 7, active: 5, reservations: 2 },
        { total: 2, active: 1, reservations: 1 },
      ],
    });
    expect(redis.calls).toHaveLength(1);
    expect(redis.calls[0]?.keys).toHaveLength(2);
  });

  it("treats a dimension member-bound overflow as unavailable telemetry", async () => {
    const redis = new FakeRedisCommands([["member_limit_exceeded"]]);
    const admission = new RedisPstnCallAdmission(redis, {
      keyPrefix: "zara:test",
      usageMemberLimit: 1,
    });
    const input = createInput();

    await expect(
      admission.getDimensionUsage([{ ...input, dimension: "global" }]),
    ).resolves.toEqual({ status: "unavailable" });
    expect(redis.calls[0]?.arguments).toEqual([
      expect.stringContaining(":reservation:"),
      "1",
    ]);
  });

  it("caps telemetry member scans independently of configured concurrency", async () => {
    const redis = new FakeRedisCommands([["member_limit_exceeded"]]);
    const admission = new RedisPstnCallAdmission(redis, {
      keyPrefix: "zara:test",
      usageMemberLimit: 1_000_000,
    });
    const input = createInput();

    await expect(
      admission.getDimensionUsage([{ ...input, dimension: "global" }]),
    ).resolves.toEqual({ status: "unavailable" });
    expect(redis.calls[0]?.arguments).toEqual([
      expect.stringContaining(":reservation:"),
      "1000",
    ]);
  });

  it("reserves atomically with one hash tag and no raw opaque identifiers", async () => {
    const redis = new FakeRedisCommands([
      [
        "admitted",
        "created",
        String(nowMs + 10_000),
        "worker_concurrency",
        "3",
      ],
    ]);
    const admission = new RedisPstnCallAdmission(redis, {
      keyPrefix: "zara:test",
    });
    const input = createInput();

    await expect(admission.reserve(input)).resolves.toEqual({
      outcome: "admitted",
      disposition: "created",
      leaseExpiresAt: "2026-07-24T12:00:10.000Z",
      limitingDimension: "worker_concurrency",
      remainingCapacity: 3,
    });

    expect(redis.calls).toHaveLength(1);
    const call = redis.calls[0]!;
    expect(call.keys).toHaveLength(12);
    expect(
      call.keys.every(
        (key) =>
          key.includes("{pstn-admission}") &&
          (key.match(/\{[^}]+\}/g) ?? []).length === 1,
      ),
    ).toBe(true);
    const serializedCommand = JSON.stringify(call);
    expect(serializedCommand).not.toContain(input.reservationId);
    expect(serializedCommand).not.toContain(input.callSessionId);
    expect(serializedCommand).not.toContain(input.tenantId);
    expect(serializedCommand).not.toContain(input.providerAccountId);
    expect(serializedCommand).not.toContain(input.workerId);
    expect(call.script).toContain("ZREMRANGEBYSCORE");
    expect(call.script).toContain("ZCARD");
    expect(call.script).toContain("HGET");
    expect(call.script).toContain("HSET");
  });

  it.each<[PstnAdmissionReasonCode, string]>([
    ["global_concurrency_limit", "global_concurrency"],
    ["provider_concurrency_limit", "provider_concurrency"],
    ["provider_account_concurrency_limit", "provider_account_concurrency"],
    ["tenant_concurrency_limit", "tenant_concurrency"],
    ["runtime_concurrency_limit", "runtime_concurrency"],
    ["worker_concurrency_limit", "worker_concurrency"],
    ["global_cps_limit", "global_cps"],
    ["provider_account_cps_limit", "provider_account_cps"],
  ])(
    "maps the stable %s denial without returning scope identifiers",
    async (reasonCode, limitingDimension) => {
      const redis = new FakeRedisCommands([
        ["denied", reasonCode, "0"],
      ]);
      const admission = new RedisPstnCallAdmission(redis);

      const result = await admission.reserve(createInput());

      expect(result).toEqual({
        outcome: "denied",
        reasonCode,
        limitingDimension,
        ...(limitingDimension.endsWith("_concurrency")
          ? { remainingCapacity: 0 }
          : {}),
      });
      expect(JSON.stringify(result)).not.toContain("sensitive");
    },
  );

  it("maps duplicate reservations to the existing disposition", async () => {
    const redis = new FakeRedisCommands([
      [
        "admitted",
        "existing",
        String(nowMs + 5_000),
        "tenant_concurrency",
        "2",
      ],
    ]);
    const admission = new RedisPstnCallAdmission(redis);

    await expect(admission.reserve(createInput())).resolves.toEqual({
      outcome: "admitted",
      disposition: "existing",
      leaseExpiresAt: "2026-07-24T12:00:05.000Z",
      limitingDimension: "tenant_concurrency",
      remainingCapacity: 2,
    });
    const script = redis.calls[0]!.script;
    expect(script.indexOf("EXISTS")).toBeLessThan(script.indexOf("HSET"));
  });

  it("isolates provider-account CPS keys by provider and account identity", async () => {
    const redis = new FakeRedisCommands([
      ["admitted", "created", String(nowMs + 10_000), "tenant_concurrency", "4"],
      ["admitted", "created", String(nowMs + 10_000), "tenant_concurrency", "4"],
    ]);
    const admission = new RedisPstnCallAdmission(redis);

    await admission.reserve(createInput({ provider: "twilio" }));
    await admission.reserve(
      createInput({
        reservationId: "reservation-sip",
        callSessionId: "call-sip",
        provider: "sip",
      }),
    );

    expect(redis.calls[0]?.keys[8]).not.toBe(redis.calls[1]?.keys[8]);
  });

  it("fails reserve closed on Redis errors and indeterminate replies", async () => {
    const unavailable = new RedisPstnCallAdmission(
      new FakeRedisCommands([], new Error("raw redis endpoint failure")),
    );
    const indeterminate = new RedisPstnCallAdmission(
      new FakeRedisCommands([["unexpected", "tenant-sensitive"]]),
    );

    await expect(unavailable.reserve(createInput())).resolves.toEqual({
      outcome: "denied",
      reasonCode: "backend_unavailable",
      limitingDimension: "backend",
    });
    await expect(indeterminate.reserve(createInput())).resolves.toEqual({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
  });

  it("rejects inherited object property names as unbounded reason codes", async () => {
    const admission = new RedisPstnCallAdmission(
      new FakeRedisCommands([["denied", "toString"]]),
    );

    await expect(admission.reserve(createInput())).resolves.toEqual({
      outcome: "denied",
      reasonCode: "indeterminate_result",
    });
  });

  it("activates, renews, and releases leases through single atomic commands", async () => {
    const redis = new FakeRedisCommands([
      ["activated", String(nowMs + 60_000), "1"],
      ["existing", String(nowMs + 60_000), "1"],
      ["renewed", String(nowMs + 61_000), "1"],
      ["released"],
      ["not_found"],
    ]);
    const admission = new RedisPstnCallAdmission(redis);
    const input = createInput();

    await expect(admission.activate(input)).resolves.toEqual({
      outcome: "activated",
      leaseExpiresAt: "2026-07-24T12:01:00.000Z",
      ownershipEpoch: 1,
    });
    await expect(admission.activate(input)).resolves.toEqual({
      outcome: "existing",
      leaseExpiresAt: "2026-07-24T12:01:00.000Z",
      ownershipEpoch: 1,
    });
    await expect(admission.renew({
      ...input,
      ownershipEpoch: 1,
    })).resolves.toEqual({
      outcome: "renewed",
      leaseExpiresAt: "2026-07-24T12:01:01.000Z",
      ownershipEpoch: 1,
    });
    await expect(admission.release({
      reservationId: input.reservationId,
      workerId: input.workerId,
      ownershipEpoch: 1,
    })).resolves.toEqual({
      outcome: "released",
    });
    await expect(admission.release({
      reservationId: input.reservationId,
      workerId: input.workerId,
      ownershipEpoch: 1,
    })).resolves.toEqual({
      outcome: "not_found",
    });
    expect(redis.calls).toHaveLength(5);
    expect(redis.calls.map((call) => call.keys.length)).toEqual([
      10, 10, 5, 4, 4,
    ]);
  });

  it("reconciles a missing active lease with every concurrency dimension and no CPS debit", async () => {
    const redis = new FakeRedisCommands([
      ["denied", "global_concurrency_limit"],
    ]);
    const admission = new RedisPstnCallAdmission(redis, {
      keyPrefix: "zara:test",
    });
    const input = createInput();

    await expect(admission.activate(input)).resolves.toEqual({
      outcome: "denied",
      reasonCode: "global_concurrency_limit",
    });

    expect(redis.calls[0]?.keys).toHaveLength(10);
    expect(redis.calls[0]?.arguments).toEqual([
      expect.any(String),
      String(input.activeTtlMs),
      String(input.limits.global),
      String(input.limits.provider),
      String(input.limits.providerAccount),
      String(input.limits.tenant),
      String(input.limits.runtime),
      String(input.limits.worker),
      expect.any(String),
    ]);
  });

  it("requires an owner recovery hold before full-input reconstruction can consume capacity", async () => {
    const redis = new FakeRedisCommands([["not_found"]]);
    const admission = new RedisPstnCallAdmission(redis, {
      keyPrefix: "zara:test",
    });

    await expect(admission.activate(createInput())).resolves.toEqual({
      outcome: "not_found",
    });

    const script = redis.calls[0]!.script;
    const missingHoldGuard =
      'if recoveryOwner == false then\n    return {"not_found"}\n  end';
    expect(script).toContain(missingHoldGuard);
    expect(script.indexOf(missingHoldGuard)).toBeLessThan(
      script.indexOf("local concurrencyReasons"),
    );
  });

  it("fences renewal by current worker ownership", async () => {
    const redis = new FakeRedisCommands([["not_owner"]]);
    const admission = new RedisPstnCallAdmission(redis, {
      keyPrefix: "zara:test",
    });
    const input = createInput();

    await expect(
      admission.renew({
        reservationId: input.reservationId,
        workerId: "worker-former",
        ownershipEpoch: 1,
        activeTtlMs: input.activeTtlMs,
      }),
    ).resolves.toEqual({
      outcome: "not_owner",
    });
    expect(redis.calls[0]?.keys).toHaveLength(5);
  });

  it("maps stale ownership epochs to not_owner for renew and release", async () => {
    const redis = new FakeRedisCommands([["not_owner"], ["not_owner"]]);
    const admission = new RedisPstnCallAdmission(redis);
    const input = createInput();

    await expect(admission.renew({
      reservationId: input.reservationId,
      workerId: input.workerId,
      ownershipEpoch: 2,
      activeTtlMs: input.activeTtlMs,
    })).resolves.toEqual({ outcome: "not_owner" });
    await expect(admission.release({
      reservationId: input.reservationId,
      workerId: input.workerId,
      ownershipEpoch: 2,
    })).resolves.toEqual({ outcome: "not_owner" });
  });

  it("distinguishes backend outages from missing lease lifecycle state", async () => {
    const input = createInput();
    const unavailable = new RedisPstnCallAdmission(
      new FakeRedisCommands([], new Error("redis unavailable")),
    );
    const malformed = new RedisPstnCallAdmission(
      new FakeRedisCommands([["unknown"], null, 42]),
    );

    await expect(unavailable.activate(input)).resolves.toEqual({
      outcome: "backend_unavailable",
    });
    await expect(unavailable.renew({
      ...input,
      ownershipEpoch: 1,
    })).resolves.toEqual({
      outcome: "backend_unavailable",
    });
    await expect(unavailable.release(input)).resolves.toEqual({
      outcome: "backend_unavailable",
    });
    await expect(malformed.activate(input)).resolves.toEqual({
      outcome: "not_found",
    });
    await expect(malformed.renew({
      ...input,
      ownershipEpoch: 1,
    })).resolves.toEqual({
      outcome: "not_found",
    });
    await expect(malformed.release(input)).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("returns a redacted Redis health snapshot", async () => {
    const healthy = new RedisPstnCallAdmission(
      new FakeRedisCommands(["PONG"]),
    );
    const unavailable = new RedisPstnCallAdmission(
      new FakeRedisCommands([], new Error("redis://user:secret@host")),
    );
    const indeterminate = new RedisPstnCallAdmission(
      new FakeRedisCommands(["unexpected-sensitive-value"]),
    );

    await expect(healthy.getHealth()).resolves.toEqual({
      status: "healthy",
      backend: "redis",
    });
    await expect(unavailable.getHealth()).resolves.toEqual({
      status: "unavailable",
      backend: "redis",
      reasonCode: "backend_unavailable",
    });
    await expect(indeterminate.getHealth()).resolves.toEqual({
      status: "unavailable",
      backend: "redis",
      reasonCode: "indeterminate_result",
    });
  });
});
