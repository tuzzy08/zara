import { describe, expect, it } from "vitest";

import {
  PstnRealtimeWorkerRegistry,
  type PstnRealtimeWorkerHeartbeat,
  type PstnRealtimeWorkerRegistryRedisCommands,
} from "./pstn-realtime-worker-registry";

const heartbeat: PstnRealtimeWorkerHeartbeat = {
  workerId: "worker-eu-1",
  releaseId: "release-abc123",
  mediaStreamBaseUrl:
    "wss://worker-eu-1.zara.test/telephony/twilio/media-streams",
  state: "ready",
  supportedProviders: ["openai-realtime", "gemini-live"],
  activeCalls: 7,
  startingCalls: 2,
  availableSlots: 11,
  resources: {
    cpuUtilizationPercent: 42.5,
    memoryUtilizationPercent: 61.25,
    eventLoopLagMs: 18,
    openFileDescriptors: 120,
    maxFileDescriptors: 1_024,
    openWebSockets: 18,
    maxWebSockets: 200,
  },
  lastSuccessfulRedisCheckAt: "2026-07-25T10:00:00.000Z",
  lastSuccessfulPostgresCheckAt: "2026-07-25T09:59:59.000Z",
};

describe("PstnRealtimeWorkerRegistry", () => {
  it("publishes a strict heartbeat and its TTL atomically", async () => {
    const redis = createRedisCommands("published");
    const registry = new PstnRealtimeWorkerRegistry(redis, {
      keyPrefix: "test:pstn-workers",
      heartbeatTtlMs: 15_000,
    });

    await registry.publish(heartbeat);

    expect(redis.calls).toHaveLength(1);
    const [script, keys, args] = redis.calls[0]!;
    expect(script).toContain('redis.call("TIME")');
    expect(script).toContain('redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])');
    expect(script).toContain('redis.call("ZADD"');
    expect(keys).toEqual([
      "test:pstn-workers:worker:d29ya2VyLWV1LTE",
      "test:pstn-workers:ready:openai-realtime",
      "test:pstn-workers:ready:gemini-live",
    ]);
    expect(args.slice(1)).toEqual(["15000", "ready", "1", "1"]);
    expect(JSON.parse(args[0]!)).toEqual(heartbeat);
    expect(args[0]).not.toMatch(/caller|credential|streamToken/i);
  });

  it("returns only live, compatible, ready, valid workers", async () => {
    const otherProvider = {
      ...heartbeat,
      workerId: "worker-gemini",
      supportedProviders: ["gemini-live"],
    };
    const draining = {
      ...heartbeat,
      workerId: "worker-draining",
      state: "draining",
    };
    const malformed = {
      ...heartbeat,
      workerId: "worker-malformed",
      transportToken: "must-not-escape",
    };
    const redis = createRedisCommands([
      JSON.stringify(heartbeat),
      JSON.stringify(otherProvider),
      JSON.stringify(draining),
      JSON.stringify(malformed),
      "{not-json",
    ]);
    const registry = new PstnRealtimeWorkerRegistry(redis, {
      keyPrefix: "test:pstn-workers",
      heartbeatTtlMs: 15_000,
    });

    await expect(registry.findReadyWorkers("openai-realtime")).resolves.toEqual([
      heartbeat,
    ]);

    const [script, keys, args] = redis.calls[0]!;
    expect(script).toContain('redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)');
    expect(script).toContain('redis.call("GET", workerKey)');
    expect(keys).toEqual(["test:pstn-workers:ready:openai-realtime"]);
    expect(args).toEqual(["257"]);
  });

  it.each([
    ["unknown top-level fields", { ...heartbeat, callerNumber: "+15551234567" }],
    ["unknown resource fields", {
      ...heartbeat,
      resources: { ...heartbeat.resources, credential: "secret" },
    }],
    ["an unbounded worker id", { ...heartbeat, workerId: "w".repeat(129) }],
    ["an HTTP media endpoint", {
      ...heartbeat,
      mediaStreamBaseUrl: "https://worker.zara.test/media",
    }],
    ["a media endpoint with a query", {
      ...heartbeat,
      mediaStreamBaseUrl: "wss://worker.zara.test/media?token=secret",
    }],
    ["an unsupported provider", {
      ...heartbeat,
      supportedProviders: ["other-provider"],
    }],
    ["duplicate providers", {
      ...heartbeat,
      supportedProviders: ["openai-realtime", "openai-realtime"],
    }],
    ["an invalid state", { ...heartbeat, state: "stopped" }],
    ["an unbounded call count", {
      ...heartbeat,
      activeCalls: 100_001,
    }],
    ["an invalid resource percentage", {
      ...heartbeat,
      resources: {
        ...heartbeat.resources,
        cpuUtilizationPercent: 101,
      },
    }],
    ["an impossible descriptor posture", {
      ...heartbeat,
      resources: {
        ...heartbeat.resources,
        openFileDescriptors: 1_025,
      },
    }],
    ["a non-canonical timestamp", {
      ...heartbeat,
      lastSuccessfulRedisCheckAt: "2026-07-25 10:00:00",
    }],
  ])("rejects %s before issuing a Redis command", async (_label, value) => {
    const redis = createRedisCommands("published");
    const registry = new PstnRealtimeWorkerRegistry(redis, {
      heartbeatTtlMs: 15_000,
    });

    await expect(
      registry.publish(value as PstnRealtimeWorkerHeartbeat),
    ).rejects.toThrow("Invalid PSTN realtime worker heartbeat");
    expect(redis.calls).toHaveLength(0);
  });

  it("rejects unbounded discovery responses", async () => {
    const redis = createRedisCommands(
      Array.from({ length: 257 }, () => JSON.stringify(heartbeat)),
    );
    const registry = new PstnRealtimeWorkerRegistry(redis, {
      heartbeatTtlMs: 15_000,
    });

    await expect(
      registry.findReadyWorkers("openai-realtime"),
    ).rejects.toThrow("PSTN realtime worker registry result exceeds 256 records");
  });

  it.each([999, 60_001])("rejects unsafe heartbeat TTL %i", (heartbeatTtlMs) => {
    const redis = createRedisCommands("published");

    expect(
      () => new PstnRealtimeWorkerRegistry(redis, { heartbeatTtlMs }),
    ).toThrow("PSTN realtime worker heartbeat TTL");
  });
});

type RedisEvalCall = [
  script: string,
  keys: readonly string[],
  args: readonly string[],
];

function createRedisCommands(
  result: unknown,
): PstnRealtimeWorkerRegistryRedisCommands & { calls: RedisEvalCall[] } {
  const calls: RedisEvalCall[] = [];
  return {
    calls,
    eval: async (
      script: string,
      keys: readonly string[],
      args: readonly string[],
    ) => {
      calls.push([script, keys, args]);
      return result;
    },
  };
}
