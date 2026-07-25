import { describe, expect, it } from "vitest";

import type { PstnRealtimeWorkerConfig } from "./pstn-realtime-worker-config";
import {
  PstnCapacityExecutionPostureAdapter,
  PstnCapacityProcessMetricsSource,
  PstnRealtimeWorkerHostLifecycle,
} from "./pstn-realtime-worker-host";

describe("PstnCapacityExecutionPostureAdapter", () => {
  it("projects active, starting, and bounded available slots from one snapshot", () => {
    const adapter = new PstnCapacityExecutionPostureAdapter(
      capacitySource(),
      config(),
    );

    expect(adapter.snapshot()).toEqual({
      activeCalls: 3,
      startingCalls: 2,
      availableSlots: 15,
    });
  });
});

describe("PstnCapacityProcessMetricsSource", () => {
  it("projects only bounded process and socket metrics", async () => {
    const source = new PstnCapacityProcessMetricsSource(capacitySource());

    await expect(source.sample()).resolves.toEqual({
      cpuUtilizationPercent: 50,
      residentMemoryBytes: 536_870_912,
      eventLoopLagMs: 20,
      openFileDescriptors: 120,
      openWebSockets: 10,
    });
  });
});

describe("PstnRealtimeWorkerHostLifecycle", () => {
  it("connects Redis, starts heartbeat lifecycle, and fails startup when not ready", async () => {
    const events: string[] = [];
    const health = {
      acceptingCalls: false,
    };
    const host = createHost(events, health);

    await expect(host.onApplicationBootstrap()).rejects.toThrow(
      "PSTN realtime worker failed readiness during startup",
    );
    expect(events).toEqual(["redis.connect", "lifecycle.start"]);
  });

  it("drains before shutting bridge, execution, and admission in order", async () => {
    const events: string[] = [];
    const host = createHost(events, { acceptingCalls: true });
    await host.onApplicationBootstrap();

    await host.beforeApplicationShutdown();

    expect(events).toEqual([
      "redis.connect",
      "lifecycle.start",
      "lifecycle.beginDrain",
      "lifecycle.stop",
      "bridge.shutdown",
      "execution.shutdown",
      "admission.shutdown",
    ]);
  });
});

function createHost(
  events: string[],
  health: { acceptingCalls: boolean },
) {
  return new PstnRealtimeWorkerHostLifecycle(
    { connect: async () => { events.push("redis.connect"); } },
    {
      start: async () => { events.push("lifecycle.start"); },
      beginDrain: async () => {
        events.push("lifecycle.beginDrain");
        return {
          completed: true as const,
          reason: "empty" as const,
          remainingCalls: 0,
        };
      },
      stop: () => { events.push("lifecycle.stop"); },
      getHealthPosture: () => ({
        state: health.acceptingCalls ? "ready" as const : "starting" as const,
        registered: health.acceptingCalls,
        dependencies: {
          redis: health.acceptingCalls,
          postgres: health.acceptingCalls,
        },
        belowExhaustion: health.acceptingCalls,
        acceptingCalls: health.acceptingCalls,
        activeCalls: 0,
        startingCalls: 0,
        availableSlots: health.acceptingCalls ? 20 : 0,
      }),
    },
    { shutdown: async () => { events.push("bridge.shutdown"); } },
    { shutdown: async () => { events.push("execution.shutdown"); } },
    { shutdown: async () => { events.push("admission.shutdown"); } },
  );
}

function capacitySource() {
  return {
    getSnapshot: () => ({
      calls: {
        active: 5,
        current: [
          {
            state: "starting" as const,
            runtimePath: "pstn-premium-realtime" as const,
            provider: "openai-realtime" as const,
            count: 2,
          },
          {
            state: "active" as const,
            runtimePath: "pstn-premium-realtime" as const,
            provider: "openai-realtime" as const,
            count: 3,
          },
        ],
      },
      process: {
        cpuUtilization: 0.5,
        eventLoopDelayP99Ms: 20,
        rssBytes: 536_870_912,
        openFileDescriptors: 120,
      },
      sockets: {
        open: [
          {
            leg: "twilio" as const,
            runtimePath: "pstn-premium-realtime" as const,
            provider: "twilio" as const,
            count: 5,
          },
          {
            leg: "provider" as const,
            runtimePath: "pstn-premium-realtime" as const,
            provider: "openai-realtime" as const,
            count: 5,
          },
        ],
      },
    }),
  };
}

function config(): PstnRealtimeWorkerConfig {
  return {
  workerId: "worker-eu-1",
  releaseId: "release-abc123",
  mediaStreamBaseUrl:
    "wss://worker-eu-1.zara.test/telephony/twilio/media-streams",
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
