import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PstnRealtimeWorkerConfig } from "./pstn-realtime-worker-config";
import type { PstnRealtimeWorkerDrainResult } from "./pstn-realtime-worker-lifecycle";
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
  it("keeps running but unavailable while startup readiness recovers", async () => {
    const events: string[] = [];
    const host = createHost(events);

    await expect(host.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(events).toEqual(["redis.connect", "lifecycle.start"]);
  });

  it("drains before shutting bridge, execution, and admission in order", async () => {
    const events: string[] = [];
    const host = createHost(events);
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

  it("force-terminates and reports calls that remain at the drain deadline", async () => {
    const events: string[] = [];
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const host = createHost(
      events,
      {
        completed: false,
        reason: "deadline",
        remainingCalls: 5,
      },
    );

    await host.beforeApplicationShutdown();

    expect(events).toEqual([
      "lifecycle.beginDrain",
      "lifecycle.stop",
      "capacity.forcedDrain:5",
      "bridge.shutdown:worker_drain_deadline:5",
      "execution.shutdown:worker_drain_deadline:5",
      "admission.shutdown",
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[pstn-realtime-worker] drain_deadline "
        + JSON.stringify({ forcedCallCount: 5 }),
    );
    warn.mockRestore();
  });
});

function createHost(
  events: string[],
  drainResult: PstnRealtimeWorkerDrainResult = {
    completed: true,
    reason: "empty",
    remainingCalls: 0,
  },
) {
  return new PstnRealtimeWorkerHostLifecycle(
    { connect: async () => { events.push("redis.connect"); } },
    {
      start: async () => { events.push("lifecycle.start"); },
      beginDrain: async () => {
        events.push("lifecycle.beginDrain");
        return drainResult;
      },
      stop: () => { events.push("lifecycle.stop"); },
      getHealthPosture: () => ({ acceptingCalls: false }),
    },
    {
      shutdown: async (input?: {
        reasonCode: string;
        forcedCallCount: number;
      }) => {
        events.push(
          input === undefined
            ? "bridge.shutdown"
            : `bridge.shutdown:${input.reasonCode}:${input.forcedCallCount}`,
        );
      },
    },
    {
      shutdown: async (input?: {
        reasonCode: string;
        forcedCallCount: number;
      }) => {
        events.push(
          input === undefined
            ? "execution.shutdown"
            : `execution.shutdown:${input.reasonCode}:${input.forcedCallCount}`,
        );
      },
    },
    { shutdown: async () => { events.push("admission.shutdown"); } },
    {
      recordForcedDrain: ({ forcedCallCount }: { forcedCallCount: number }) => {
        events.push(`capacity.forcedDrain:${forcedCallCount}`);
      },
    },
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
