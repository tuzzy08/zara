import { describe, expect, it } from "vitest";

import {
  createPstnPremiumWorkerAvailabilityProvider,
  PSTN_PREMIUM_WORKER_AVAILABILITY,
  PstnPremiumWorkerAvailabilityService,
} from "./pstn-premium-worker-availability";
import {
  PstnRealtimeWorkerRegistry,
  type PstnRealtimeWorkerHeartbeat,
  type PstnRealtimeWorkerProvider,
} from "./pstn-realtime-worker-registry";

describe("PstnPremiumWorkerAvailabilityService", () => {
  it("returns unavailable when no compatible ready worker has capacity", async () => {
    const service = createService([]);

    await expect(
      service.select(["openai-realtime"]),
    ).resolves.toEqual({
      status: "unavailable",
      providers: ["openai-realtime"],
      reason: "no_ready_worker",
    });
  });

  it("fails closed when registry discovery fails", async () => {
    const service = new PstnPremiumWorkerAvailabilityService({
      findReadyWorkers: async () => {
        throw new Error("redis unavailable");
      },
    });

    await expect(
      service.select(["gemini-live"]),
    ).resolves.toEqual({
      status: "unavailable",
      providers: ["gemini-live"],
      reason: "registry_unavailable",
    });
  });

  it("rejects zero-capacity and invalid bounded postures", async () => {
    const service = createService([
      heartbeat({ workerId: "worker-zero", availableSlots: 0 }),
      heartbeat({
        workerId: "worker-invalid-resource",
        resources: {
          ...heartbeat().resources,
          eventLoopLagMs: Number.POSITIVE_INFINITY,
        },
      }),
      heartbeat({
        workerId: "worker-wrong-state",
        state: "draining",
      }),
      heartbeat({
        workerId: "worker-wrong-provider",
        supportedProviders: ["gemini-live"],
      }),
    ]);

    await expect(
      service.select(["openai-realtime"]),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "no_ready_worker",
    });
  });

  it("selects highest available slots before current load", async () => {
    const service = createService([
      heartbeat({
        workerId: "worker-low-slots",
        availableSlots: 8,
        activeCalls: 0,
        startingCalls: 0,
      }),
      heartbeat({
        workerId: "worker-high-slots",
        availableSlots: 9,
        activeCalls: 8,
        startingCalls: 1,
      }),
    ]);

    await expect(
      service.select(["openai-realtime"]),
    ).resolves.toEqual({
      status: "available",
      providers: ["openai-realtime"],
      worker: {
        workerId: "worker-high-slots",
        releaseId: "release-abc123",
        mediaStreamBaseUrl:
          "wss://worker-eu-1.zara.test/telephony/twilio/media-streams",
        availableSlots: 9,
        activeCalls: 8,
        startingCalls: 1,
      },
    });
  });

  it("selects only workers that support every provider required by the call", async () => {
    const service = createService([
      heartbeat({
        workerId: "worker-openai-only",
        supportedProviders: ["openai-realtime"],
        availableSlots: 10,
      }),
      heartbeat({
        workerId: "worker-cross-provider",
        supportedProviders: ["openai-realtime", "gemini-live"],
        availableSlots: 8,
      }),
    ]);

    await expect(
      service.select(["openai-realtime", "gemini-live"]),
    ).resolves.toMatchObject({
      status: "available",
      providers: ["openai-realtime", "gemini-live"],
      worker: {
        workerId: "worker-cross-provider",
      },
    });
  });

  it("breaks slot ties by lowest load and then worker ID", async () => {
    const service = createService([
      heartbeat({
        workerId: "worker-z",
        availableSlots: 8,
        activeCalls: 2,
        startingCalls: 2,
      }),
      heartbeat({
        workerId: "worker-b",
        availableSlots: 8,
        activeCalls: 1,
        startingCalls: 1,
      }),
      heartbeat({
        workerId: "worker-a",
        availableSlots: 8,
        activeCalls: 0,
        startingCalls: 2,
      }),
    ]);

    await expect(
      service.select(["openai-realtime"]),
    ).resolves.toMatchObject({
      status: "available",
      worker: {
        workerId: "worker-a",
      },
    });
  });

  it("selects the next ranked worker when a contended worker is excluded", async () => {
    const service = createService([
      heartbeat({
        workerId: "worker-primary",
        availableSlots: 10,
      }),
      heartbeat({
        workerId: "worker-secondary",
        availableSlots: 8,
      }),
    ]);

    await expect(
      service.select(["openai-realtime"], ["worker-primary"]),
    ).resolves.toMatchObject({
      status: "available",
      worker: {
        workerId: "worker-secondary",
      },
    });
  });

  it("returns unavailable without touching Redis for an invalid runtime value", async () => {
    let reads = 0;
    const service = new PstnPremiumWorkerAvailabilityService({
      findReadyWorkers: async () => {
        reads += 1;
        return [];
      },
    });

    await expect(
      service.select(["other" as PstnRealtimeWorkerProvider]),
    ).resolves.toEqual({
      status: "unavailable",
      providers: ["other"],
      reason: "invalid_provider",
    });
    expect(reads).toBe(0);
  });
});

describe("createPstnPremiumWorkerAvailabilityProvider", () => {
  it("exports a stable TelephonyModule-ready factory provider", () => {
    const provider = createPstnPremiumWorkerAvailabilityProvider();
    const registry = {
      findReadyWorkers: async () => [],
    };

    expect(provider.provide).toBe(PSTN_PREMIUM_WORKER_AVAILABILITY);
    expect(provider.inject).toEqual([PstnRealtimeWorkerRegistry]);
    expect(provider.useFactory(registry)).toBeInstanceOf(
      PstnPremiumWorkerAvailabilityService,
    );
  });
});

function createService(heartbeats: PstnRealtimeWorkerHeartbeat[]) {
  return new PstnPremiumWorkerAvailabilityService({
    findReadyWorkers: async () => heartbeats,
  });
}

function heartbeat(
  override: Partial<PstnRealtimeWorkerHeartbeat> = {},
): PstnRealtimeWorkerHeartbeat {
  return {
    workerId: "worker-eu-1",
    releaseId: "release-abc123",
    mediaStreamBaseUrl:
      "wss://worker-eu-1.zara.test/telephony/twilio/media-streams",
    state: "ready",
    supportedProviders: ["openai-realtime", "gemini-live"],
    activeCalls: 2,
    startingCalls: 1,
    availableSlots: 8,
    resources: {
      cpuUtilizationPercent: 40,
      memoryUtilizationPercent: 50,
      eventLoopLagMs: 20,
      openFileDescriptors: 100,
      maxFileDescriptors: 4_096,
      openWebSockets: 10,
      maxWebSockets: 200,
    },
    lastSuccessfulRedisCheckAt: "2026-07-25T10:00:00.000Z",
    lastSuccessfulPostgresCheckAt: "2026-07-25T10:00:00.000Z",
    ...override,
  };
}
