import { describe, expect, it } from "vitest";

import { PlatformAdminService } from "./platform-admin.service";

describe("PlatformAdminService PSTN capacity posture", () => {
  it("projects the live recorder snapshot into staff runtime observability", () => {
    const capacity = {
      getSnapshot: () => ({
        capturedAt: "2026-07-22T12:00:00.000Z",
        status: "warning",
        envelope: {
          maxConcurrentCalls: 20,
          cpuLimitMillicores: 1_000,
          memoryLimitBytes: 1_073_741_824,
          fileDescriptorLimit: 4_096,
          databasePoolMax: 10,
          eventLoopDelayLimitMs: 100,
          expectedWebSocketLegsPerPremiumCall: 2,
          certified: false,
        },
      }),
    };
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      capacity as never,
    );

    expect(service.getRuntimeAiObservability().pstnCapacity).toEqual(capacity.getSnapshot());
  });
});
