import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeLoadReport } from "./load-report-writer";
import type { PstnLoadReport } from "./load-runner";

describe("PSTN load report writer", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("atomically retains a machine-readable report under a bounded safe filename", async () => {
    directory = await mkdtemp(join(tmpdir(), "zara-pstn-load-"));
    const path = await writeLoadReport(report, directory);

    expect(path.startsWith(directory)).toBe(true);
    expect(path).toMatch(/stepped-abc1234-20260723T000000000Z\.json$/u);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(report);
    expect((await readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});

const report: PstnLoadReport = {
  schemaVersion: "zara.pstn-load-report.v1",
  outcome: "passed",
  commitSha: "abc1234",
  environment: "staging",
  generatedAt: "2026-07-23T00:00:00.000Z",
  profile: "stepped",
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
  durationMs: 1_000,
  stages: [],
  failures: [],
};
