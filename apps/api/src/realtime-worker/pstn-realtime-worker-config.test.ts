import { describe, expect, it } from "vitest";

import { resolvePstnRealtimeWorkerConfig } from "./pstn-realtime-worker-config";

describe("resolvePstnRealtimeWorkerConfig", () => {
  it("resolves the explicit bounded worker environment", () => {
    expect(resolvePstnRealtimeWorkerConfig(validEnv())).toEqual({
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
        eventLoopLagMs: 50,
        openFileDescriptors: 4_096,
        openWebSockets: 200,
      },
    });
  });

  it.each([
    ["PSTN_WORKER_ID", ""],
    ["PSTN_WORKER_ID", "worker@eu-1"],
    ["PSTN_WORKER_ID", "worker/eu-1"],
    ["PSTN_WORKER_RELEASE_ID", ""],
    ["PSTN_WORKER_PUBLIC_MEDIA_URL", "https://worker.zara.test/media"],
    ["PORT", "0"],
    ["PSTN_WORKER_HEARTBEAT_INTERVAL_MS", "0"],
    ["PSTN_WORKER_HEARTBEAT_TTL_MS", "60001"],
    ["PSTN_WORKER_DRAIN_TIMEOUT_MS", "999"],
    ["PSTN_WORKER_MAX_CALLS", "0"],
    ["PSTN_WORKER_MAX_CPU_PERCENT", "101"],
    ["PSTN_WORKER_MAX_MEMORY_PERCENT", "NaN"],
    ["PSTN_WORKER_MAX_MEMORY_BYTES", "1024"],
    ["PSTN_WORKER_MAX_EVENT_LOOP_LAG_MS", "-1"],
    ["PSTN_WORKER_MAX_OPEN_FILE_DESCRIPTORS", "0"],
    ["PSTN_WORKER_MAX_WEBSOCKETS", "0"],
  ])("rejects invalid %s", (name, value) => {
    expect(() =>
      resolvePstnRealtimeWorkerConfig({
        ...validEnv(),
        [name]: value,
      })
    ).toThrow("Invalid PSTN realtime worker configuration");
  });

  it("requires the heartbeat interval to be strictly less than half the TTL", () => {
    expect(() =>
      resolvePstnRealtimeWorkerConfig({
        ...validEnv(),
        PSTN_WORKER_HEARTBEAT_INTERVAL_MS: "7500",
        PSTN_WORKER_HEARTBEAT_TTL_MS: "15000",
      })
    ).toThrow("heartbeat interval must be less than half the TTL");
  });

  it("advertises only live providers with configured credentials", () => {
    expect(resolvePstnRealtimeWorkerConfig({
      ...validEnv(),
      GEMINI_API_KEY: "gemini-key",
    }).supportedProviders).toEqual([
      "openai-realtime",
      "gemini-live",
    ]);

    expect(() =>
      resolvePstnRealtimeWorkerConfig({
        ...validEnv(),
        OPENAI_API_KEY: "",
      })
    ).toThrow("at least one premium provider credential");
  });

  it("advertises both simulated providers without live credentials", () => {
    expect(resolvePstnRealtimeWorkerConfig({
      ...validEnv(),
      OPENAI_API_KEY: "",
      ZARA_PREMIUM_REALTIME_TRANSPORT: "simulator",
    }).supportedProviders).toEqual([
      "openai-realtime",
      "gemini-live",
    ]);
  });
});

function validEnv(): Record<string, string | undefined> {
  return {
    PSTN_WORKER_ID: "worker-eu-1",
    PSTN_WORKER_RELEASE_ID: "release-abc123",
    PSTN_WORKER_PUBLIC_MEDIA_URL:
      "wss://worker-eu-1.zara.test/telephony/twilio/media-streams",
    PORT: "4020",
    PSTN_WORKER_HEARTBEAT_INTERVAL_MS: "5000",
    PSTN_WORKER_HEARTBEAT_TTL_MS: "15000",
    PSTN_WORKER_DRAIN_TIMEOUT_MS: "1800000",
    PSTN_WORKER_MAX_CALLS: "20",
    PSTN_WORKER_MAX_CPU_PERCENT: "85",
    PSTN_WORKER_MAX_MEMORY_PERCENT: "85",
    PSTN_WORKER_MAX_MEMORY_BYTES: "1073741824",
    PSTN_WORKER_MAX_EVENT_LOOP_LAG_MS: "50",
    PSTN_WORKER_MAX_OPEN_FILE_DESCRIPTORS: "4096",
    PSTN_WORKER_MAX_WEBSOCKETS: "200",
    OPENAI_API_KEY: "openai-key",
  };
}
