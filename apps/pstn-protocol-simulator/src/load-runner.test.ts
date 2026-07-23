import { describe, expect, it, vi } from "vitest";

import { PstnLoadRunner, type CapacityTelemetrySample, type LoadCallResult } from "./load-runner";
import type { PstnLoadProfile } from "./load-profiles";

let telemetrySequence = 0;
const healthyTelemetry = (overrides: Partial<CapacityTelemetrySample> = {}): CapacityTelemetrySample => ({
  capturedAt: new Date(Date.UTC(2026, 6, 23, 0, 0, 0, telemetrySequence++)).toISOString(),
  status: "healthy",
  envelope: {
    maxConcurrentCalls: 20,
    cpuLimitMillicores: 2_000,
    memoryLimitBytes: 1_073_741_824,
    fileDescriptorLimit: 4_096,
    databasePoolMax: 10,
    eventLoopDelayLimitMs: 50,
    certified: false,
    expectedWebSocketLegsPerPremiumCall: 2,
  },
  resources: Object.fromEntries(
    ["calls", "cpu", "eventLoop", "memory", "database", "fileDescriptors", "queues"].map((name) => [
      name,
      { available: true, used: 0, limit: 1, utilization: 0, status: "healthy" },
    ]),
  ) as CapacityTelemetrySample["resources"],
  calls: { active: 0 },
  process: { rssBytes: 128 * 1024 * 1024 },
  sockets: { open: [], bufferedBytes: 0 },
  queues: [],
  telemetry: { metricExportFailureCount: 0 },
  ...overrides,
});

const passedCall = (scenario = "normal"): LoadCallResult => ({
  scenario,
  outcome: "passed",
  durationMs: 100,
  webhookLatencyMs: 10,
  mediaConnectLatencyMs: 20,
  firstAudioLatencyMs: 40,
  inboundFrameCount: 20,
  outboundFrameCount: 20,
  identityIsolated: true,
});

const profile = (overrides: Partial<PstnLoadProfile> = {}): PstnLoadProfile => ({
  name: "ci-smoke",
  releaseScale: false,
  stages: [{
    name: "smoke",
    concurrency: 1,
    callCount: 2,
    arrivalRatePerSecond: 10,
    tenantMode: "same-tenant",
    scenarios: ["normal"],
    verifyDrain: true,
  }],
  ...overrides,
});

describe("PstnLoadRunner", () => {
  it("emits report metadata, percentiles, resource shape, traffic, and passing SLOs", async () => {
    const runner = new PstnLoadRunner({
      runCall: vi.fn(async ({ scenario }) => passedCall(scenario)),
      readTelemetry: vi.fn(async () => healthyTelemetry()),
      sleep: vi.fn(async () => undefined),
      nowMs: (() => {
        let now = 0;
        return () => now += 100;
      })(),
    });

    const report = await runner.run(profile(), {
      commitSha: "abc1234",
      environment: "staging",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });

    expect(report).toMatchObject({
      schemaVersion: "zara.pstn-load-report.v1",
      outcome: "passed",
      commitSha: "abc1234",
      environment: "staging",
      resourceShape: { maxConcurrentCalls: 20, expectedWebSocketLegsPerPremiumCall: 2 },
      stages: [{
        concurrency: 1,
        peakObservedConcurrency: 1,
        arrivalRatePerSecond: 10,
        attemptedCalls: 2,
        meaningfulCalls: 2,
        latencyMs: {
          firstAudio: { p50: 40, p95: 40, p99: 40 },
        },
        slo: { passed: true },
      }],
    });
  });

  it("fails a stage that does not actually reach its declared concurrency", async () => {
    const runner = new PstnLoadRunner({
      runCall: vi.fn(async ({ scenario }) => passedCall(scenario)),
      readTelemetry: vi.fn(async () => healthyTelemetry()),
      sleep: vi.fn(async () => undefined),
    });
    const report = await runner.run(profile({
      stages: [{ ...profile().stages[0]!, concurrency: 2, callCount: 1, verifyDrain: false }],
    }), metadata);

    expect(report.failures).toContainEqual(expect.objectContaining({ code: "concurrency_not_reached" }));
    expect(report.stages[0]).toMatchObject({ concurrency: 2, peakObservedConcurrency: 1 });
  });

  it("fails release qualification when telemetry is stale or never observes workload activity", async () => {
    const stale = healthyTelemetry({ capturedAt: "2026-07-23T00:00:00.000Z" });
    const staleRunner = new PstnLoadRunner({
      runCall: vi.fn(async ({ scenario }) => passedCall(scenario)),
      readTelemetry: vi.fn(async () => stale),
      sleep: vi.fn(async () => undefined),
    });
    const releaseProfile = profile({ releaseScale: true, stages: [
      { ...profile().stages[0]!, callCount: 1, verifyDrain: false },
    ] });

    const staleReport = await staleRunner.run(releaseProfile, metadata);
    expect(staleReport.failures).toContainEqual(expect.objectContaining({ code: "telemetry_stale" }));

    const inactiveRunner = new PstnLoadRunner({
      runCall: vi.fn(async ({ scenario }) => passedCall(scenario)),
      readTelemetry: vi.fn(async () => healthyTelemetry()),
      sleep: vi.fn(async () => undefined),
    });
    const inactiveReport = await inactiveRunner.run(releaseProfile, metadata);
    expect(inactiveReport.failures).toContainEqual(expect.objectContaining({ code: "telemetry_activity_missing" }));
  });

  it("does not start calls from an already exhausted posture", async () => {
    const runCall = vi.fn(async ({ scenario }) => passedCall(scenario));
    const runner = new PstnLoadRunner({
      runCall,
      readTelemetry: vi.fn(async () => healthyTelemetry({ status: "exhausted" })),
    });

    const report = await runner.run(profile(), metadata);

    expect(runCall).not.toHaveBeenCalled();
    expect(report.failures).toContainEqual(expect.objectContaining({ code: "resource_exhausted" }));
  });

  it("hard-stops the remaining profile after exhausted telemetry and aborts active work", async () => {
    let telemetryReads = 0;
    const runCall = vi.fn(async ({ signal, scenario }) => {
      if (runCall.mock.calls.length <= 2) return passedCall(scenario);
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { ...passedCall(scenario), outcome: "aborted" as const };
    });
    const runner = new PstnLoadRunner({
      runCall,
      readTelemetry: vi.fn(async () => {
        telemetryReads += 1;
        return telemetryReads >= 3 ? healthyTelemetry({ status: "exhausted" }) : healthyTelemetry();
      }),
      sleep: vi.fn(async () => undefined),
    });

    const report = await runner.run(profile({
      stages: [
        { ...profile().stages[0]!, concurrency: 2, callCount: 4 },
        { ...profile().stages[0]!, name: "must-not-run", callCount: 1 },
      ],
    }), {
      commitSha: "abc1234",
      environment: "staging",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });

    expect(report.outcome).toBe("failed");
    expect(report.failures).toContainEqual(expect.objectContaining({ code: "resource_exhausted" }));
    expect(report.stages.map((stage) => stage.name)).not.toContain("must-not-run");
    expect(runCall.mock.calls.length).toBeLessThan(5);
  });

  it("monitors telemetry while calls are active and aborts before a stalled call completes", async () => {
    let reads = 0;
    let observedAbort = false;
    const runner = new PstnLoadRunner({
      runCall: vi.fn(async ({ signal, scenario }) => {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
          observedAbort = true;
          resolve();
        }, { once: true }));
        return { ...passedCall(scenario), outcome: "aborted" as const };
      }),
      readTelemetry: vi.fn(async () => {
        reads += 1;
        return reads >= 3 ? healthyTelemetry({ status: "exhausted" }) : healthyTelemetry();
      }),
      telemetryPollIntervalMs: 1,
      sleep: vi.fn(async () => undefined),
    });

    const report = await runner.run(profile({
      stages: [{ ...profile().stages[0]!, callCount: 1, verifyDrain: false }],
    }), {
      commitSha: "abc1234",
      environment: "staging",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });

    expect(observedAbort).toBe(true);
    expect(report.failures).toContainEqual(expect.objectContaining({ code: "resource_exhausted" }));
  });

  it("fails closed for absent telemetry, no traffic, identity leakage, and hard SLO breaches", async () => {
    const cases = [
      {
        telemetry: healthyTelemetry({ process: null }),
        call: passedCall(),
        code: "telemetry_missing",
      },
      {
        telemetry: healthyTelemetry(),
        call: { ...passedCall(), inboundFrameCount: 0, outboundFrameCount: 0 },
        code: "no_meaningful_traffic",
      },
      {
        telemetry: healthyTelemetry(),
        call: { ...passedCall(), identityIsolated: false },
        code: "identity_isolation",
      },
      {
        telemetry: healthyTelemetry(),
        call: { ...passedCall(), firstAudioLatencyMs: 9_000 },
        code: "slo_breach",
      },
      {
        telemetry: healthyTelemetry(),
        call: { ...passedCall(), firstAudioLatencyMs: undefined },
        code: "latency_evidence_missing",
      },
    ] as const;

    for (const testCase of cases) {
      const runner = new PstnLoadRunner({
        runCall: vi.fn(async () => testCase.call),
        readTelemetry: vi.fn(async () => testCase.telemetry),
        sleep: vi.fn(async () => undefined),
      });
      const report = await runner.run(profile({
        stages: [{ ...profile().stages[0]!, callCount: 1 }],
      }), {
        commitSha: "abc1234",
        environment: "staging",
        runtimePath: "pstn-premium-realtime",
        provider: "openai-realtime",
      });

      expect(report.outcome).toBe("failed");
      expect(report.failures.map((failure) => failure.code)).toContain(testCase.code);
    }
  });

  it("normalizes unknown call failures to the bounded report taxonomy", async () => {
    const runner = new PstnLoadRunner({
      runCall: vi.fn(async () => ({
        ...passedCall(),
        outcome: "failed" as const,
        failureCode: "Bearer secret-value",
      })),
      readTelemetry: vi.fn(async () => healthyTelemetry()),
      sleep: vi.fn(async () => undefined),
    });

    const report = await runner.run(profile({
      stages: [{ ...profile().stages[0]!, callCount: 1, verifyDrain: false }],
    }), {
      commitSha: "abc1234",
      environment: "staging",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });

    expect(report.failures).toContainEqual(expect.objectContaining({ code: "call_failure" }));
    expect(JSON.stringify(report)).not.toContain("secret-value");
  });

  it("requires calls, sockets, queues, reservations, and memory to return to baseline after drain", async () => {
    const samples = [
      healthyTelemetry(),
      healthyTelemetry(),
      healthyTelemetry({
        calls: { active: 1 },
        process: { rssBytes: 512 * 1024 * 1024 },
        sockets: { open: [{ leg: "twilio", count: 1 }], bufferedBytes: 160 },
        queues: [{ queue: "twilio_playback", bytes: 160, items: 1, drops: 0 }],
      }),
      healthyTelemetry({
        calls: { active: 1 },
        process: { rssBytes: 512 * 1024 * 1024 },
        sockets: { open: [{ leg: "twilio", count: 1 }], bufferedBytes: 160 },
        queues: [{ queue: "twilio_playback", bytes: 160, items: 1, drops: 0 }],
      }),
    ];
    const runner = new PstnLoadRunner({
      runCall: vi.fn(async () => passedCall()),
      readTelemetry: vi.fn(async () => samples.shift() ?? samples.at(-1) ?? healthyTelemetry()),
      sleep: vi.fn(async () => undefined),
      drainAttempts: 1,
    });

    const report = await runner.run(profile({ stages: [{ ...profile().stages[0]!, callCount: 1 }] }), {
      commitSha: "abc1234",
      environment: "staging",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });

    expect(report.outcome).toBe("failed");
    expect(report.failures).toContainEqual(expect.objectContaining({ code: "drain_not_recovered" }));
  });

  it("requires the exporter-failure scenario to produce nonfatal telemetry evidence", async () => {
    const runner = new PstnLoadRunner({
      runCall: vi.fn(async () => passedCall("exporter-failure")),
      readTelemetry: vi.fn(async () => healthyTelemetry()),
      sleep: vi.fn(async () => undefined),
    });
    const report = await runner.run(profile({
      stages: [{
        ...profile().stages[0]!,
        callCount: 1,
        scenarios: ["exporter-failure"],
        verifyDrain: false,
      }],
    }), {
      commitSha: "abc1234",
      environment: "staging",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });

    expect(report.outcome).toBe("failed");
    expect(report.failures).toContainEqual(expect.objectContaining({
      code: "exporter_failure_not_observed",
    }));
  });

  it("fails when a declared scenario produces no call and accepts observed exporter failure evidence", async () => {
    let reads = 0;
    const runner = new PstnLoadRunner({
      runCall: vi.fn(async () => passedCall("normal")),
      readTelemetry: vi.fn(async () => healthyTelemetry({
        telemetry: { metricExportFailureCount: reads++ < 2 ? 0 : 1 },
      })),
      sleep: vi.fn(async () => undefined),
    });
    const report = await runner.run(profile({
      stages: [{
        ...profile().stages[0]!,
        callCount: 1,
        scenarios: ["normal", "exporter-failure"],
        verifyDrain: false,
      }],
    }), {
      commitSha: "abc1234",
      environment: "staging",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });

    expect(report.failures).toContainEqual(expect.objectContaining({ code: "scenario_not_exercised" }));
    expect(report.failures).not.toContainEqual(expect.objectContaining({
      code: "exporter_failure_not_observed",
    }));
  });
});

const metadata = {
  commitSha: "abc1234",
  environment: "staging",
  runtimePath: "pstn-premium-realtime",
  provider: "openai-realtime",
};
