import { describe, expect, it } from "vitest";

import {
  bootstrapPstnRealtimeWorker,
  type PstnRealtimeWorkerBootstrapDependencies,
} from "./realtime-worker.main";
import { PstnRealtimeWorkerModule } from "./pstn-realtime-worker.module";

describe("bootstrapPstnRealtimeWorker", () => {
  it("initializes observability, enables SIGTERM shutdown, and listens on the worker port", async () => {
    const events: string[] = [];
    const dependencies = bootstrapDependencies(events);

    await bootstrapPstnRealtimeWorker(dependencies);

    expect(events).toEqual([
      "observability",
      `create:${PstnRealtimeWorkerModule.name}`,
      "shutdown:SIGTERM,SIGINT",
      "listen:4020",
    ]);
  });

  it("fails before creating Nest when the exact worker role is absent", async () => {
    const events: string[] = [];
    const dependencies = bootstrapDependencies(events);
    dependencies.env.ZARA_PROCESS_ROLE = "api";

    await expect(
      bootstrapPstnRealtimeWorker(dependencies),
    ).rejects.toThrow("ZARA_PROCESS_ROLE must be 'pstn-realtime-worker'");
    expect(events).toEqual([]);
  });
});

function bootstrapDependencies(
  events: string[],
): PstnRealtimeWorkerBootstrapDependencies {
  return {
    env: {
      ZARA_PROCESS_ROLE: "pstn-realtime-worker",
      OPENAI_API_KEY: "test-openai-api-key",
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
      PSTN_WORKER_MAX_EVENT_LOOP_LAG_MS: "250",
      PSTN_WORKER_MAX_OPEN_FILE_DESCRIPTORS: "4096",
      PSTN_WORKER_MAX_WEBSOCKETS: "200",
    },
    initializeObservability: () => {
      events.push("observability");
    },
    createApplication: async (module) => {
      events.push(`create:${module.name}`);
      return {
        enableShutdownHooks: (signals) => {
          events.push(`shutdown:${signals.join(",")}`);
        },
        listen: async (port) => {
          events.push(`listen:${port}`);
        },
      };
    },
  };
}
