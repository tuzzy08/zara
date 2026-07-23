import { describe, expect, it } from "vitest";

import { serializeLoadReport } from "./load-report";

describe("PSTN load report", () => {
  it("serializes the typed report without credential, caller, token, transcript, or media fields", () => {
    const output = serializeLoadReport({
      schemaVersion: "zara.pstn-load-report.v1",
      outcome: "failed",
      commitSha: "abc1234",
      environment: "staging",
      generatedAt: "2026-07-23T00:00:00.000Z",
      profile: "failure",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
      resourceShape: {
        maxConcurrentCalls: 20,
        cpuLimitMillicores: 2_000,
        memoryLimitBytes: 1_073_741_824,
        fileDescriptorLimit: 4_096,
        databasePoolMax: 10,
        eventLoopDelayLimitMs: 50,
        expectedWebSocketLegsPerPremiumCall: 2,
      },
      durationMs: 100,
      stages: [],
      failures: [{ code: "scenario_contract_failed", count: 1 }],
    });

    expect(JSON.parse(output)).toMatchObject({ schemaVersion: "zara.pstn-load-report.v1" });
    expect(output).not.toMatch(/"(?:authToken|credential|caller|from|to|streamToken|transcript|payload|media)"/i);
  });

  it("rejects canonical credential and caller-field variants", () => {
    const unsafe = {
      safe: true,
      AUTH_TOKEN: "secret",
    };
    expect(() => serializeLoadReport(unsafe as never)).toThrow(/forbidden field 'AUTH_TOKEN'/);
  });
});
