import type {
  LoadScenarioName,
  LoadTenantMode,
  PstnLoadProfile,
  PstnLoadStage,
} from "./load-profiles";

export type CapacityStatus = "healthy" | "warning" | "critical" | "exhausted";

interface ResourcePosture {
  available: boolean;
  used: number | null;
  limit: number;
  utilization: number | null;
  status: CapacityStatus | null;
}

export interface CapacityTelemetrySample {
  capturedAt: string;
  status: CapacityStatus;
  envelope: {
    maxConcurrentCalls: number;
    cpuLimitMillicores: number;
    memoryLimitBytes: number;
    fileDescriptorLimit: number;
    databasePoolMax: number;
    eventLoopDelayLimitMs: number;
    certified: boolean;
    expectedWebSocketLegsPerPremiumCall: number;
  };
  resources: Record<
    "calls" | "cpu" | "eventLoop" | "memory" | "database" | "fileDescriptors" | "queues",
    ResourcePosture
  >;
  calls: { active: number };
  admission: {
    trackedReservations: number;
    pendingReleases: number;
  };
  process: { rssBytes: number } | null;
  sockets: {
    open: Array<{ leg: string; count: number }>;
    bufferedBytes: number;
  };
  queues: Array<{ queue: string; bytes: number; items: number; drops: number }>;
  telemetry: { metricExportFailureCount: number };
}

export interface LoadCallResult {
  scenario: string;
  outcome: "passed" | "failed" | "aborted";
  durationMs: number;
  webhookLatencyMs?: number | undefined;
  mediaConnectLatencyMs?: number | undefined;
  firstAudioLatencyMs?: number | undefined;
  inboundFrameCount: number;
  outboundFrameCount: number;
  identityIsolated: boolean;
  failureCode?: string | undefined;
}

export interface LoadRunMetadata {
  commitSha: string;
  environment: string;
  runtimePath: string;
  provider: string;
}

export type LoadFailureCode =
  | "telemetry_missing"
  | "resource_exhausted"
  | "no_meaningful_traffic"
  | "identity_isolation"
  | "slo_breach"
  | "call_failure"
  | "drain_not_recovered"
  | "exporter_failure_not_observed"
  | "scenario_not_exercised"
  | "latency_evidence_missing"
  | "scenario_contract_failed"
  | "concurrency_not_reached"
  | "telemetry_stale"
  | "telemetry_activity_missing";

export interface LoadFailureSummary {
  code: LoadFailureCode;
  count: number;
  stage?: string | undefined;
}

interface Percentiles {
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface PstnLoadStageReport {
  name: string;
  tenantMode: LoadTenantMode;
  scenarios: string[];
  concurrency: number;
  arrivalRatePerSecond: number;
  durationMs: number;
  attemptedCalls: number;
  completedCalls: number;
  meaningfulCalls: number;
  peakObservedConcurrency: number;
  peakTelemetryActiveCalls: number;
  peakTelemetrySocketLegs: number;
  latencyMs: {
    call: Percentiles;
    webhook: Percentiles;
    mediaConnect: Percentiles;
    firstAudio: Percentiles;
  };
  failures: LoadFailureSummary[];
  slo: {
    passed: boolean;
    successRate: number;
    minimumSuccessRate: number;
    webhookP95Ms: number | null;
    maximumWebhookP95Ms: number;
    firstAudioP95Ms: number | null;
    maximumFirstAudioP95Ms: number;
  };
}

export interface PstnLoadReport {
  schemaVersion: "zara.pstn-load-report.v1";
  outcome: "passed" | "failed";
  commitSha: string;
  environment: string;
  generatedAt: string;
  profile: string;
  runtimePath: string;
  provider: string;
  resourceShape: {
    maxConcurrentCalls: number;
    cpuLimitMillicores: number;
    memoryLimitBytes: number;
    fileDescriptorLimit: number;
    databasePoolMax: number;
    eventLoopDelayLimitMs: number;
    expectedWebSocketLegsPerPremiumCall: number;
  };
  durationMs: number;
  stages: PstnLoadStageReport[];
  failures: LoadFailureSummary[];
}

interface LoadRunnerDependencies {
  runCall(input: {
    scenario: LoadScenarioName;
    tenantMode: LoadTenantMode;
    callIndex: number;
    signal: AbortSignal;
  }): Promise<LoadCallResult>;
  readTelemetry(): Promise<CapacityTelemetrySample>;
  sleep?(delayMs: number): Promise<void>;
  nowMs?(): number;
  drainAttempts?: number;
  drainIntervalMs?: number;
  minimumSuccessRate?: number;
  maximumWebhookP95Ms?: number;
  maximumFirstAudioP95Ms?: number;
  telemetryPollIntervalMs?: number;
}

const requiredResources = [
  "calls",
  "cpu",
  "eventLoop",
  "memory",
  "database",
  "fileDescriptors",
  "queues",
] as const;

const knownFailureCodes = new Set<LoadFailureCode>([
  "telemetry_missing",
  "resource_exhausted",
  "no_meaningful_traffic",
  "identity_isolation",
  "slo_breach",
  "call_failure",
  "drain_not_recovered",
  "exporter_failure_not_observed",
  "scenario_not_exercised",
  "latency_evidence_missing",
  "scenario_contract_failed",
  "concurrency_not_reached",
  "telemetry_stale",
  "telemetry_activity_missing",
]);

export class PstnLoadRunner {
  private readonly nowMs: () => number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly drainAttempts: number;
  private readonly drainIntervalMs: number;
  private readonly minimumSuccessRate: number;
  private readonly maximumWebhookP95Ms: number;
  private readonly maximumFirstAudioP95Ms: number;
  private readonly telemetryPollIntervalMs: number;

  constructor(private readonly dependencies: LoadRunnerDependencies) {
    this.nowMs = dependencies.nowMs ?? Date.now;
    this.sleep = dependencies.sleep ?? delay;
    this.drainAttempts = dependencies.drainAttempts ?? 30;
    this.drainIntervalMs = dependencies.drainIntervalMs ?? 1_000;
    this.minimumSuccessRate = dependencies.minimumSuccessRate ?? 0.99;
    this.maximumWebhookP95Ms = dependencies.maximumWebhookP95Ms ?? 1_000;
    this.maximumFirstAudioP95Ms = dependencies.maximumFirstAudioP95Ms ?? 2_000;
    this.telemetryPollIntervalMs = dependencies.telemetryPollIntervalMs ?? 100;
  }

  async run(profile: PstnLoadProfile, metadata: LoadRunMetadata): Promise<PstnLoadReport> {
    const startedAt = this.nowMs();
    const failures: LoadFailureSummary[] = [];
    const stages: PstnLoadStageReport[] = [];
    let baseline: CapacityTelemetrySample;
    try {
      baseline = await this.dependencies.readTelemetry();
    } catch {
      return this.report(profile, metadata, startedAt, stages, [{ code: "telemetry_missing", count: 1 }], null);
    }
    if (!hasRequiredTelemetry(baseline)) {
      return this.report(profile, metadata, startedAt, stages, [{ code: "telemetry_missing", count: 1 }], baseline);
    }
    if (baseline.status === "exhausted") {
      return this.report(profile, metadata, startedAt, stages, [{ code: "resource_exhausted", count: 1 }], baseline);
    }

    for (const stage of profile.stages) {
      let stageBaseline: CapacityTelemetrySample;
      try {
        stageBaseline = await this.dependencies.readTelemetry();
      } catch {
        failures.push({ code: "telemetry_missing", count: 1, stage: stage.name });
        break;
      }
      if (!hasRequiredTelemetry(stageBaseline)) {
        failures.push({ code: "telemetry_missing", count: 1, stage: stage.name });
        break;
      }
      if (stageBaseline.status === "exhausted") {
        failures.push({ code: "resource_exhausted", count: 1, stage: stage.name });
        break;
      }
      const stageResult = await this.runStage(stage, stageBaseline, profile.releaseScale);
      stages.push(stageResult.report);
      failures.push(...stageResult.failures);
      if (stageResult.stopProfile) break;
      if (stage.verifyDrain && !await this.waitForDrain(baseline)) {
        failures.push({ code: "drain_not_recovered", count: 1, stage: stage.name });
        break;
      }
    }

    return this.report(profile, metadata, startedAt, stages, failures, baseline);
  }

  private async runStage(
    stage: PstnLoadStage,
    stageBaseline: CapacityTelemetrySample,
    requireTelemetryActivity: boolean,
  ) {
    const startedAt = this.nowMs();
    const controller = new AbortController();
    const results: LoadCallResult[] = [];
    const failures: LoadFailureSummary[] = [];
    let nextCallIndex = 0;
    let stopProfile = false;
    let maximumExporterFailureCount = stageBaseline.telemetry.metricExportFailureCount;
    let latestTelemetryAt = Date.parse(stageBaseline.capturedAt);
    let peakTelemetryActiveCalls = stageBaseline.calls.active;
    let peakTelemetrySocketLegs = countSockets(stageBaseline);
    let activeCalls = 0;
    let peakObservedConcurrency = 0;
    const telemetryMonitorController = new AbortController();
    const deadline = stage.durationMs === undefined ? null : startedAt + stage.durationMs;
    let nextLaunchAt = startedAt;
    const arrivalIntervalMs = 1_000 / Math.max(0.001, stage.arrivalRatePerSecond);

    const takeCall = () => {
      if (controller.signal.aborted) return null;
      if (stage.callCount !== undefined && nextCallIndex >= stage.callCount) return null;
      if (deadline !== null && this.nowMs() >= deadline) return null;
      return nextCallIndex++;
    };
    const reserveLaunch = async () => {
      const launchAt = nextLaunchAt;
      nextLaunchAt += arrivalIntervalMs;
      await this.sleep(Math.max(0, launchAt - this.nowMs()));
    };
    const observeTelemetry = async () => {
      let telemetry: CapacityTelemetrySample;
      try {
        telemetry = await this.dependencies.readTelemetry();
      } catch {
        addFailureOnce(failures, { code: "telemetry_missing", count: 1, stage: stage.name });
        stopProfile = true;
        controller.abort();
        return;
      }
      if (!hasRequiredTelemetry(telemetry)) {
        addFailureOnce(failures, { code: "telemetry_missing", count: 1, stage: stage.name });
        stopProfile = true;
        controller.abort();
        return;
      }
      maximumExporterFailureCount = Math.max(
        maximumExporterFailureCount,
        telemetry.telemetry.metricExportFailureCount,
      );
      latestTelemetryAt = Math.max(latestTelemetryAt, Date.parse(telemetry.capturedAt));
      peakTelemetryActiveCalls = Math.max(peakTelemetryActiveCalls, telemetry.calls.active);
      peakTelemetrySocketLegs = Math.max(peakTelemetrySocketLegs, countSockets(telemetry));
      if (telemetry.status === "exhausted") {
        addFailureOnce(failures, { code: "resource_exhausted", count: 1, stage: stage.name });
        stopProfile = true;
        controller.abort();
      }
    };
    const monitorTelemetry = async () => {
      while (!controller.signal.aborted && !telemetryMonitorController.signal.aborted) {
        const elapsed = await abortableDelay(
          this.telemetryPollIntervalMs,
          telemetryMonitorController.signal,
        );
        if (!elapsed || controller.signal.aborted) return;
        await observeTelemetry();
      }
    };
    const worker = async () => {
      while (!controller.signal.aborted) {
        const callIndex = takeCall();
        if (callIndex === null) return;
        await reserveLaunch();
        if (controller.signal.aborted) return;
        if (deadline !== null && this.nowMs() >= deadline) return;
        const scenario = stage.scenarios[callIndex % stage.scenarios.length]!;
        let result: LoadCallResult;
        activeCalls += 1;
        peakObservedConcurrency = Math.max(peakObservedConcurrency, activeCalls);
        try {
          result = await this.dependencies.runCall({
            scenario,
            tenantMode: stage.tenantMode,
            callIndex,
            signal: controller.signal,
          });
        } catch {
          result = {
            scenario,
            outcome: controller.signal.aborted ? "aborted" : "failed",
            durationMs: 0,
            inboundFrameCount: 0,
            outboundFrameCount: 0,
            identityIsolated: true,
            failureCode: controller.signal.aborted ? "resource_exhausted" : "call_failure",
          };
        } finally {
          activeCalls -= 1;
        }
        results.push(result);
        if (controller.signal.aborted) return;
        await observeTelemetry();
      }
    };

    const telemetryMonitor = monitorTelemetry();
    try {
      await Promise.all(Array.from({ length: stage.concurrency }, () => worker()));
    } finally {
      telemetryMonitorController.abort();
      await telemetryMonitor;
    }
    const analysis = analyzeResults(stage, results, {
      minimumSuccessRate: this.minimumSuccessRate,
      maximumWebhookP95Ms: this.maximumWebhookP95Ms,
      maximumFirstAudioP95Ms: this.maximumFirstAudioP95Ms,
    });
    failures.push(...analysis.failures);
    if (peakObservedConcurrency < stage.concurrency && !stopProfile) {
      failures.push({ code: "concurrency_not_reached", count: 1, stage: stage.name });
    }
    if (latestTelemetryAt <= Date.parse(stageBaseline.capturedAt)) {
      failures.push({ code: "telemetry_stale", count: 1, stage: stage.name });
    }
    if (
      requireTelemetryActivity
      && peakTelemetryActiveCalls <= stageBaseline.calls.active
      && peakTelemetrySocketLegs <= countSockets(stageBaseline)
    ) {
      failures.push({ code: "telemetry_activity_missing", count: 1, stage: stage.name });
    }
    if (
      stage.scenarios.includes("exporter-failure")
      && maximumExporterFailureCount <= stageBaseline.telemetry.metricExportFailureCount
    ) {
      failures.push({ code: "exporter_failure_not_observed", count: 1, stage: stage.name });
    }
    return {
      report: {
        name: stage.name,
        tenantMode: stage.tenantMode,
        scenarios: [...stage.scenarios],
        concurrency: stage.concurrency,
        arrivalRatePerSecond: stage.arrivalRatePerSecond,
        durationMs: Math.max(0, this.nowMs() - startedAt),
        attemptedCalls: results.length,
        completedCalls: results.filter((result) => result.outcome !== "aborted").length,
        meaningfulCalls: analysis.meaningfulCalls,
        peakObservedConcurrency,
        peakTelemetryActiveCalls,
        peakTelemetrySocketLegs,
        latencyMs: analysis.latencyMs,
        failures: aggregateFailures(failures),
        slo: analysis.slo,
      },
      failures,
      stopProfile: stopProfile || failures.some((failure) =>
        failure.code === "telemetry_missing" || failure.code === "resource_exhausted"),
    };
  }

  private async waitForDrain(baseline: CapacityTelemetrySample) {
    for (let attempt = 0; attempt < this.drainAttempts; attempt += 1) {
      if (attempt > 0) await this.sleep(this.drainIntervalMs);
      let sample: CapacityTelemetrySample;
      try {
        sample = await this.dependencies.readTelemetry();
      } catch {
        return false;
      }
      if (!hasRequiredTelemetry(sample)) return false;
      if (hasRecoveredToBaseline(baseline, sample)) return true;
    }
    return false;
  }

  private report(
    profile: PstnLoadProfile,
    metadata: LoadRunMetadata,
    startedAt: number,
    stages: PstnLoadStageReport[],
    failures: LoadFailureSummary[],
    baseline: CapacityTelemetrySample | null,
  ): PstnLoadReport {
    const envelope = baseline?.envelope;
    return {
      schemaVersion: "zara.pstn-load-report.v1",
      outcome: failures.length === 0 && stages.every((stage) => stage.slo.passed) ? "passed" : "failed",
      commitSha: metadata.commitSha,
      environment: metadata.environment,
      generatedAt: new Date().toISOString(),
      profile: profile.name,
      runtimePath: metadata.runtimePath,
      provider: metadata.provider,
      resourceShape: {
        maxConcurrentCalls: envelope?.maxConcurrentCalls ?? 0,
        cpuLimitMillicores: envelope?.cpuLimitMillicores ?? 0,
        memoryLimitBytes: envelope?.memoryLimitBytes ?? 0,
        fileDescriptorLimit: envelope?.fileDescriptorLimit ?? 0,
        databasePoolMax: envelope?.databasePoolMax ?? 0,
        eventLoopDelayLimitMs: envelope?.eventLoopDelayLimitMs ?? 0,
        expectedWebSocketLegsPerPremiumCall: envelope?.expectedWebSocketLegsPerPremiumCall ?? 0,
      },
      durationMs: Math.max(0, this.nowMs() - startedAt),
      stages,
      failures: aggregateFailures(failures),
    };
  }
}

function analyzeResults(
  stage: PstnLoadStage,
  results: LoadCallResult[],
  sloConfig: {
    minimumSuccessRate: number;
    maximumWebhookP95Ms: number;
    maximumFirstAudioP95Ms: number;
  },
) {
  const failures: LoadFailureSummary[] = [];
  const meaningful = results.filter((result) => result.inboundFrameCount > 0 || result.outboundFrameCount > 0);
  const exercisedScenarios = new Set(results.map((result) => result.scenario));
  const unexercisedScenarios = stage.scenarios.filter((scenario) => !exercisedScenarios.has(scenario));
  if (unexercisedScenarios.length > 0) {
    failures.push({ code: "scenario_not_exercised", count: unexercisedScenarios.length, stage: stage.name });
  }
  if (results.length === 0 || meaningful.length === 0) {
    failures.push({ code: "no_meaningful_traffic", count: Math.max(1, results.length), stage: stage.name });
  }
  const isolationFailures = results.filter((result) => !result.identityIsolated);
  if (isolationFailures.length > 0) {
    failures.push({ code: "identity_isolation", count: isolationFailures.length, stage: stage.name });
  }
  for (const result of results.filter((candidate) => candidate.outcome === "failed")) {
    failures.push({ code: normalizeFailureCode(result.failureCode), count: 1, stage: stage.name });
  }
  const completed = results.filter((result) => result.outcome !== "aborted");
  const passed = completed.filter((result) => result.outcome === "passed");
  const successRate = completed.length === 0 ? 0 : passed.length / completed.length;
  const webhook = percentiles(passed.flatMap((result) =>
    result.webhookLatencyMs === undefined ? [] : [result.webhookLatencyMs]));
  const webhookEvidenceComplete = passed.every((result) =>
    result.webhookLatencyMs !== undefined && Number.isFinite(result.webhookLatencyMs));
  const firstAudioRequired = results
    .filter((result) => result.outcome === "passed" && requiresFirstAudio(result.scenario));
  const firstAudio = percentiles(firstAudioRequired
    .flatMap((result) => result.firstAudioLatencyMs === undefined ? [] : [result.firstAudioLatencyMs]));
  const firstAudioEvidenceComplete = firstAudioRequired.every((result) =>
    result.firstAudioLatencyMs !== undefined && Number.isFinite(result.firstAudioLatencyMs));
  if (!webhookEvidenceComplete || !firstAudioEvidenceComplete) {
    failures.push({ code: "latency_evidence_missing", count: 1, stage: stage.name });
  }
  const sloPassed = successRate >= sloConfig.minimumSuccessRate
    && webhookEvidenceComplete
    && (webhook.p95 === null || webhook.p95 <= sloConfig.maximumWebhookP95Ms)
    && firstAudioEvidenceComplete
    && (firstAudio.p95 === null || firstAudio.p95 <= sloConfig.maximumFirstAudioP95Ms);
  if (!sloPassed) failures.push({ code: "slo_breach", count: 1, stage: stage.name });
  return {
    meaningfulCalls: meaningful.length,
    failures,
    latencyMs: {
      call: percentiles(results.map((result) => result.durationMs)),
      webhook,
      mediaConnect: percentiles(results.flatMap((result) =>
        result.mediaConnectLatencyMs === undefined ? [] : [result.mediaConnectLatencyMs])),
      firstAudio,
    },
    slo: {
      passed: sloPassed,
      successRate,
      minimumSuccessRate: sloConfig.minimumSuccessRate,
      webhookP95Ms: webhook.p95,
      maximumWebhookP95Ms: sloConfig.maximumWebhookP95Ms,
      firstAudioP95Ms: firstAudio.p95,
      maximumFirstAudioP95Ms: sloConfig.maximumFirstAudioP95Ms,
    },
  };
}

function hasRequiredTelemetry(sample: CapacityTelemetrySample) {
  return Number.isFinite(Date.parse(sample.capturedAt))
    && sample.process !== null
    && Number.isFinite(sample.process.rssBytes)
    && requiredResources.every((resource) => {
      const posture = sample.resources[resource];
      return posture?.available === true
        && Number.isFinite(posture.limit)
        && (posture.used === null || Number.isFinite(posture.used))
        && (posture.utilization === null || Number.isFinite(posture.utilization));
    })
    && Number.isFinite(sample.calls.active)
    && Number.isFinite(sample.admission.trackedReservations)
    && Number.isFinite(sample.admission.pendingReleases)
    && Number.isFinite(sample.sockets.bufferedBytes)
    && Array.isArray(sample.sockets.open)
    && sample.sockets.open.every((socket) => Number.isFinite(socket.count))
    && Array.isArray(sample.queues)
    && sample.queues.every((queue) =>
      Number.isFinite(queue.bytes) && Number.isFinite(queue.items) && Number.isFinite(queue.drops))
    && Number.isFinite(sample.telemetry.metricExportFailureCount);
}

function hasRecoveredToBaseline(baseline: CapacityTelemetrySample, current: CapacityTelemetrySample) {
  const baselineSockets = baseline.sockets.open.reduce((sum, socket) => sum + socket.count, 0);
  const currentSockets = current.sockets.open.reduce((sum, socket) => sum + socket.count, 0);
  const baselineQueue = queueTotals(baseline);
  const currentQueue = queueTotals(current);
  const memoryAllowance = Math.max(32 * 1024 * 1024, baseline.process!.rssBytes * 0.1);
  return current.status !== "exhausted"
    && current.calls.active <= baseline.calls.active
    && current.admission.trackedReservations
      <= baseline.admission.trackedReservations
    && current.admission.pendingReleases
      <= baseline.admission.pendingReleases
    && (current.resources.calls.used ?? Number.POSITIVE_INFINITY)
      <= (baseline.resources.calls.used ?? Number.NEGATIVE_INFINITY)
    && currentSockets <= baselineSockets
    && current.sockets.bufferedBytes <= baseline.sockets.bufferedBytes
    && currentQueue.bytes <= baselineQueue.bytes
    && currentQueue.items <= baselineQueue.items
    && current.process!.rssBytes <= baseline.process!.rssBytes + memoryAllowance;
}

function countSockets(sample: CapacityTelemetrySample) {
  return sample.sockets.open.reduce((sum, socket) => sum + socket.count, 0);
}

function queueTotals(sample: CapacityTelemetrySample) {
  return sample.queues.reduce(
    (totals, queue) => ({ bytes: totals.bytes + queue.bytes, items: totals.items + queue.items }),
    { bytes: 0, items: 0 },
  );
}

function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { p50: null, p95: null, p99: null };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted: number[], quantile: number) {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
}

function requiresFirstAudio(scenario: string) {
  return scenario !== "provider-quota-error" && scenario !== "provider-closure";
}

function aggregateFailures(failures: LoadFailureSummary[]) {
  const aggregate = new Map<string, LoadFailureSummary>();
  for (const failure of failures) {
    const key = `${failure.stage ?? ""}:${failure.code}`;
    const existing = aggregate.get(key);
    if (existing === undefined) aggregate.set(key, { ...failure });
    else existing.count += failure.count;
  }
  return [...aggregate.values()];
}

function addFailureOnce(failures: LoadFailureSummary[], failure: LoadFailureSummary) {
  if (!failures.some((candidate) =>
    candidate.code === failure.code && candidate.stage === failure.stage)) {
    failures.push(failure);
  }
}

function normalizeFailureCode(code: string | undefined): LoadFailureCode {
  return code !== undefined && knownFailureCodes.has(code as LoadFailureCode)
    ? code as LoadFailureCode
    : "call_failure";
}

function abortableDelay(delayMs: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function delay(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
