import { describe, expect, it } from "vitest";

import type { PstnRealtimeWorkerConfig } from "./pstn-realtime-worker-config";
import {
  BoundedPstnRealtimeWorkerResourceSampler,
  PstnRealtimeWorkerLifecycleService,
  type PstnRealtimeWorkerLifecycleRuntime,
} from "./pstn-realtime-worker-lifecycle";
import type {
  PstnRealtimeWorkerHeartbeat,
  PstnRealtimeWorkerResourcePosture,
} from "./pstn-realtime-worker-registry";

describe("BoundedPstnRealtimeWorkerResourceSampler", () => {
  it("projects a fixed low-cardinality posture and clamps unbounded probes", async () => {
    const sampler = new BoundedPstnRealtimeWorkerResourceSampler(config(), {
      sample: async () => ({
        cpuUtilizationPercent: 500,
        residentMemoryBytes: 2_147_483_648,
        eventLoopLagMs: 100_000,
        openFileDescriptors: 99_999,
        openWebSockets: 99_999,
        callerNumber: "+15551234567",
      }),
    });

    await expect(sampler.sample()).resolves.toEqual({
      cpuUtilizationPercent: 100,
      memoryUtilizationPercent: 100,
      eventLoopLagMs: 60_000,
      openFileDescriptors: 4_096,
      maxFileDescriptors: 4_096,
      openWebSockets: 200,
      maxWebSockets: 200,
    });
  });
});

describe("PstnRealtimeWorkerLifecycleService", () => {
  it("moves from starting to ready and publishes bounded execution posture", async () => {
    const harness = createHarness();

    expect(harness.service.getHealthPosture().state).toBe("starting");
    await harness.service.start();

    expect(harness.service.getHealthPosture()).toMatchObject({
      state: "ready",
      registered: true,
      dependencies: { redis: true, postgres: true },
      belowExhaustion: true,
      acceptingCalls: true,
      activeCalls: 3,
      startingCalls: 2,
      availableSlots: 8,
    });
    expect(harness.published).toHaveLength(1);
    expect(harness.published[0]).toMatchObject({
      workerId: "worker-eu-1",
      releaseId: "release-abc123",
      state: "ready",
      activeCalls: 3,
      startingCalls: 2,
      availableSlots: 8,
      lastSuccessfulRedisCheckAt: "2026-07-25T10:00:00.000Z",
      lastSuccessfulPostgresCheckAt: "2026-07-25T10:00:00.000Z",
    });
  });

  it("publishes periodically and becomes ready after dependencies recover", async () => {
    const harness = createHarness();
    harness.redisHealthy.value = false;

    await harness.service.start();
    expect(harness.service.getHealthPosture()).toMatchObject({
      state: "starting",
      registered: true,
      acceptingCalls: false,
    });

    harness.redisHealthy.value = true;
    await harness.runtime.runInterval();

    expect(harness.published).toHaveLength(2);
    expect(harness.service.getHealthPosture()).toMatchObject({
      state: "ready",
      registered: true,
      acceptingCalls: true,
    });
  });

  it("fails readiness when publication fails or resources are exhausted", async () => {
    const harness = createHarness();
    harness.failPublication.value = true;
    harness.resources.value = {
      ...healthyResources(),
      eventLoopLagMs: 250,
    };

    await harness.service.start();

    expect(harness.service.getHealthPosture()).toMatchObject({
      state: "starting",
      registered: false,
      belowExhaustion: false,
      acceptingCalls: false,
    });
  });

  it("ages registration out after the heartbeat TTL", async () => {
    const harness = createHarness();
    await harness.service.start();

    harness.runtime.advance(15_001);

    expect(harness.service.getHealthPosture()).toMatchObject({
      registered: false,
      acceptingCalls: false,
    });
  });

  it("withdraws readiness during drain and preserves calls until they reach zero", async () => {
    const harness = createHarness();
    await harness.service.start();
    let sleepCount = 0;
    harness.runtime.onSleep = () => {
      sleepCount += 1;
      if (sleepCount === 2) {
        harness.execution.value = {
          activeCalls: 0,
          startingCalls: 0,
          availableSlots: 20,
        };
      }
    };

    const result = await harness.service.beginDrain();

    expect(result).toEqual({
      completed: true,
      reason: "empty",
      remainingCalls: 0,
    });
    expect(harness.service.getHealthPosture()).toMatchObject({
      state: "draining",
      acceptingCalls: false,
      activeCalls: 0,
      startingCalls: 0,
    });
    expect(harness.published.at(-1)?.state).toBe("draining");
    expect(sleepCount).toBe(2);
  });

  it("ends drain waiting at the bounded deadline without terminating calls", async () => {
    const harness = createHarness({
      drainTimeoutMs: 1_000,
    });
    harness.execution.value = {
      activeCalls: 4,
      startingCalls: 1,
      availableSlots: 15,
    };
    await harness.service.start();

    await expect(harness.service.beginDrain()).resolves.toEqual({
      completed: false,
      reason: "deadline",
      remainingCalls: 5,
    });
    expect(harness.execution.value).toEqual({
      activeCalls: 4,
      startingCalls: 1,
      availableSlots: 15,
    });
    expect(harness.runtime.nowMs()).toBe(
      Date.parse("2026-07-25T10:00:01.000Z"),
    );
  });

  it("publishes draining before waiting and shares one concurrent drain", async () => {
    const harness = createHarness({
      drainTimeoutMs: 1_000,
    });
    await harness.service.start();
    harness.execution.value = {
      activeCalls: 1,
      startingCalls: 0,
      availableSlots: 19,
    };
    const publication = deferred<void>();
    harness.publicationBlocker.value = publication.promise;
    let sleepCount = 0;
    harness.runtime.onSleep = () => {
      sleepCount += 1;
      harness.execution.value = {
        activeCalls: 0,
        startingCalls: 0,
        availableSlots: 20,
      };
    };

    const firstDrain = harness.service.beginDrain();
    const concurrentDrain = harness.service.beginDrain();
    await harness.drainingPublicationAttempted.promise;

    expect(concurrentDrain).toBe(firstDrain);
    expect(harness.publicationAttempts.value).toBe(2);
    expect(sleepCount).toBe(0);

    harness.publicationBlocker.value = undefined;
    publication.resolve();

    await expect(firstDrain).resolves.toEqual({
      completed: true,
      reason: "empty",
      remainingCalls: 0,
    });
    await expect(concurrentDrain).resolves.toEqual({
      completed: true,
      reason: "empty",
      remainingCalls: 0,
    });
    expect(sleepCount).toBe(1);
    expect(harness.published.at(-1)?.state).toBe("draining");
  });

  it("waits for the last ready heartbeat to expire when draining cannot be published", async () => {
    const harness = createHarness({
      heartbeatTtlMs: 15_000,
    });
    harness.execution.value = {
      activeCalls: 0,
      startingCalls: 0,
      availableSlots: 20,
    };
    await harness.service.start();
    harness.failPublication.value = true;

    await expect(harness.service.beginDrain()).resolves.toEqual({
      completed: true,
      reason: "empty",
      remainingCalls: 0,
    });

    expect(harness.runtime.nowMs()).toBe(
      Date.parse("2026-07-25T10:00:15.000Z"),
    );
    expect(harness.publicationAttempts.value).toBe(3);
  });
});

function createHarness(overrides: Partial<PstnRealtimeWorkerConfig> = {}) {
  const published: PstnRealtimeWorkerHeartbeat[] = [];
  const failPublication = { value: false };
  const publicationAttempts = { value: 0 };
  const publicationBlocker = { value: undefined as Promise<void> | undefined };
  const drainingPublicationAttempted = deferred<void>();
  const redisHealthy = { value: true };
  const postgresHealthy = { value: true };
  const execution = {
    value: { activeCalls: 3, startingCalls: 2, availableSlots: 8 },
  };
  const resources = { value: healthyResources() };
  const runtime = new FakeLifecycleRuntime();
  const service = new PstnRealtimeWorkerLifecycleService(
    { ...config(), ...overrides },
    {
      publish: async (heartbeat) => {
        publicationAttempts.value += 1;
        if (publicationAttempts.value === 2) {
          drainingPublicationAttempted.resolve();
        }
        await publicationBlocker.value;
        if (failPublication.value) {
          throw new Error("redis unavailable");
        }
        published.push(heartbeat);
      },
    },
    { check: async () => redisHealthy.value },
    { check: async () => postgresHealthy.value },
    { snapshot: () => execution.value },
    { sample: async () => resources.value },
    runtime,
  );
  return {
    service,
    published,
    failPublication,
    publicationAttempts,
    publicationBlocker,
    drainingPublicationAttempted,
    redisHealthy,
    postgresHealthy,
    execution,
    resources,
    runtime,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function config(): PstnRealtimeWorkerConfig {
  return {
    workerId: "worker-eu-1",
    releaseId: "release-abc123",
    mediaStreamBaseUrl:
      "wss://realtime.example.com/telephony/twilio/media-streams",
    port: 4_020,
    heartbeatIntervalMs: 5_000,
    heartbeatTtlMs: 15_000,
    drainTimeoutMs: 1_800_000,
    maxCalls: 20,
    supportedProviders: ["openai-realtime"],
    resourceCeilings: {
      cpuUtilizationPercent: 85,
      memoryUtilizationPercent: 85,
      memoryBytes: 1_073_741_824,
      eventLoopLagMs: 250,
      openFileDescriptors: 4_096,
      openWebSockets: 200,
    },
  };
}

function healthyResources(): PstnRealtimeWorkerResourcePosture {
  return {
    cpuUtilizationPercent: 40,
    memoryUtilizationPercent: 50,
    eventLoopLagMs: 20,
    openFileDescriptors: 100,
    maxFileDescriptors: 4_096,
    openWebSockets: 10,
    maxWebSockets: 200,
  };
}

class FakeLifecycleRuntime implements PstnRealtimeWorkerLifecycleRuntime {
  private time = Date.parse("2026-07-25T10:00:00.000Z");
  private interval: (() => Promise<void>) | undefined;
  onSleep: (() => void) | undefined;

  nowMs() {
    return this.time;
  }

  setInterval(callback: () => Promise<void>) {
    this.interval = callback;
    return "interval";
  }

  clearInterval() {
    this.interval = undefined;
  }

  async sleep(milliseconds: number) {
    this.time += milliseconds;
    this.onSleep?.();
  }

  advance(milliseconds: number) {
    this.time += milliseconds;
  }

  async runInterval() {
    await this.interval?.();
  }
}
