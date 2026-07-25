import type { PstnRealtimeWorkerConfig } from "./pstn-realtime-worker-config";
import type {
  PstnRealtimeWorkerHeartbeat,
  PstnRealtimeWorkerResourcePosture,
  PstnRealtimeWorkerState,
} from "./pstn-realtime-worker-registry";

export interface PstnRealtimeWorkerHeartbeatPublisher {
  publish(heartbeat: PstnRealtimeWorkerHeartbeat): Promise<void>;
}

export interface PstnRealtimeWorkerDependencyHealthCheck {
  check(): Promise<boolean>;
}

export interface PstnRealtimeWorkerExecutionPosturePort {
  snapshot(): {
    activeCalls: number;
    startingCalls: number;
    availableSlots: number;
  };
}

export interface PstnRealtimeWorkerResourceSampler {
  sample(): Promise<PstnRealtimeWorkerResourcePosture>;
}

export interface PstnRealtimeWorkerLifecycleRuntime {
  nowMs(): number;
  setInterval(callback: () => Promise<void>, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
  sleep(milliseconds: number): Promise<void>;
}

export interface PstnRealtimeWorkerProcessMetricsSource {
  sample(): Promise<{
    cpuUtilizationPercent: number;
    residentMemoryBytes: number;
    eventLoopLagMs: number;
    openFileDescriptors: number;
    openWebSockets: number;
  }>;
}

export interface PstnRealtimeWorkerHealthPosture {
  state: PstnRealtimeWorkerState;
  registered: boolean;
  dependencies: {
    redis: boolean;
    postgres: boolean;
  };
  belowExhaustion: boolean;
  acceptingCalls: boolean;
  activeCalls: number;
  startingCalls: number;
  availableSlots: number;
}

export interface PstnRealtimeWorkerDrainResult {
  completed: boolean;
  reason: "empty" | "deadline";
  remainingCalls: number;
}

const epochTimestamp = "1970-01-01T00:00:00.000Z";
const drainPollIntervalMs = 250;

export class BoundedPstnRealtimeWorkerResourceSampler
  implements PstnRealtimeWorkerResourceSampler
{
  constructor(
    private readonly config: PstnRealtimeWorkerConfig,
    private readonly source: PstnRealtimeWorkerProcessMetricsSource,
  ) {}

  async sample(): Promise<PstnRealtimeWorkerResourcePosture> {
    const sample = await this.source.sample();
    const ceilings = this.config.resourceCeilings;
    return {
      cpuUtilizationPercent: clamp(sample.cpuUtilizationPercent, 0, 100),
      memoryUtilizationPercent: clamp(
        sample.residentMemoryBytes / ceilings.memoryBytes * 100,
        0,
        100,
      ),
      eventLoopLagMs: clamp(sample.eventLoopLagMs, 0, 60_000),
      openFileDescriptors: clampInteger(
        sample.openFileDescriptors,
        0,
        ceilings.openFileDescriptors,
      ),
      maxFileDescriptors: ceilings.openFileDescriptors,
      openWebSockets: clampInteger(
        sample.openWebSockets,
        0,
        ceilings.openWebSockets,
      ),
      maxWebSockets: ceilings.openWebSockets,
    };
  }
}

export class PstnRealtimeWorkerLifecycleService {
  private state: PstnRealtimeWorkerState = "starting";
  private registered = false;
  private lastRegisteredAtMs: number | undefined;
  private redisHealthy = false;
  private postgresHealthy = false;
  private belowExhaustion = false;
  private activeCalls = 0;
  private startingCalls = 0;
  private availableSlots = 0;
  private resources: PstnRealtimeWorkerResourcePosture;
  private lastSuccessfulRedisCheckAt = epochTimestamp;
  private lastSuccessfulPostgresCheckAt = epochTimestamp;
  private intervalHandle: unknown;
  private started = false;
  private refreshPromise: Promise<void> | undefined;
  private drainPromise: Promise<PstnRealtimeWorkerDrainResult> | undefined;

  constructor(
    private readonly config: PstnRealtimeWorkerConfig,
    private readonly registry: PstnRealtimeWorkerHeartbeatPublisher,
    private readonly redisHealthCheck: PstnRealtimeWorkerDependencyHealthCheck,
    private readonly postgresHealthCheck: PstnRealtimeWorkerDependencyHealthCheck,
    private readonly executionPosture: PstnRealtimeWorkerExecutionPosturePort,
    private readonly resourceSampler: PstnRealtimeWorkerResourceSampler,
    private readonly runtime: PstnRealtimeWorkerLifecycleRuntime =
      systemLifecycleRuntime,
  ) {
    this.resources = exhaustedResourcePosture(config);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await this.refresh();
    this.intervalHandle = this.runtime.setInterval(
      () => this.refresh(),
      this.config.heartbeatIntervalMs,
    );
  }

  stop(): void {
    if (this.intervalHandle !== undefined) {
      this.runtime.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise !== undefined) {
      return this.refreshPromise;
    }
    const refreshPromise = this.performRefresh();
    this.refreshPromise = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      if (this.refreshPromise === refreshPromise) {
        this.refreshPromise = undefined;
      }
    }
  }

  getHealthPosture(): PstnRealtimeWorkerHealthPosture {
    const registered = this.registered
      && this.lastRegisteredAtMs !== undefined
      && this.runtime.nowMs() - this.lastRegisteredAtMs
        < this.config.heartbeatTtlMs;
    const acceptingCalls = this.state === "ready"
      && registered
      && this.redisHealthy
      && this.postgresHealthy
      && this.belowExhaustion;
    return {
      state: this.state,
      registered,
      dependencies: {
        redis: this.redisHealthy,
        postgres: this.postgresHealthy,
      },
      belowExhaustion: this.belowExhaustion,
      acceptingCalls,
      activeCalls: this.activeCalls,
      startingCalls: this.startingCalls,
      availableSlots: this.availableSlots,
    };
  }

  beginDrain(): Promise<PstnRealtimeWorkerDrainResult> {
    if (this.drainPromise !== undefined) {
      return this.drainPromise;
    }
    this.state = "draining";
    this.registered = false;
    this.drainPromise = this.publishAndWaitForDrain();
    return this.drainPromise;
  }

  private async publishAndWaitForDrain(): Promise<PstnRealtimeWorkerDrainResult> {
    const activeRefresh = this.refreshPromise;
    if (activeRefresh !== undefined) {
      await activeRefresh;
    }
    await this.refresh();
    await this.waitForLastReadyHeartbeatExpiry();
    const deadline = this.runtime.nowMs() + this.config.drainTimeoutMs;
    return this.waitForDrain(deadline);
  }

  private async waitForLastReadyHeartbeatExpiry() {
    if (this.registered || this.lastRegisteredAtMs === undefined) {
      return;
    }
    const remainingMs =
      this.lastRegisteredAtMs + this.config.heartbeatTtlMs
      - this.runtime.nowMs();
    if (remainingMs > 0) {
      await this.runtime.sleep(remainingMs);
    }
  }

  private async performRefresh(): Promise<void> {
    const now = new Date(this.runtime.nowMs()).toISOString();
    const [redisHealthy, postgresHealthy, resources] = await Promise.all([
      safeHealthCheck(this.redisHealthCheck),
      safeHealthCheck(this.postgresHealthCheck),
      safeResourceSample(this.resourceSampler, this.config),
    ]);
    this.redisHealthy = redisHealthy;
    this.postgresHealthy = postgresHealthy;
    if (redisHealthy) {
      this.lastSuccessfulRedisCheckAt = now;
    }
    if (postgresHealthy) {
      this.lastSuccessfulPostgresCheckAt = now;
    }
    this.resources = resources;
    this.updateExecutionPosture();
    this.belowExhaustion = this.calculateBelowExhaustion();

    if (
      this.state === "starting"
      && this.redisHealthy
      && this.postgresHealthy
      && this.belowExhaustion
    ) {
      this.state = "ready";
    }

    const eligible = this.state === "ready"
      && this.redisHealthy
      && this.postgresHealthy
      && this.belowExhaustion;
    const publishedState: PstnRealtimeWorkerState = this.state === "draining"
      ? "draining"
      : eligible ? "ready" : "starting";
    try {
      await this.registry.publish(this.heartbeat(publishedState));
      this.registered = true;
      this.lastRegisteredAtMs = this.runtime.nowMs();
    } catch {
      this.registered = false;
    }
  }

  private async waitForDrain(
    deadline: number,
  ): Promise<PstnRealtimeWorkerDrainResult> {
    while (true) {
      this.updateExecutionPosture();
      const remainingCalls = this.activeCalls + this.startingCalls;
      if (remainingCalls === 0) {
        await this.refresh();
        return { completed: true, reason: "empty", remainingCalls: 0 };
      }
      const remainingMs = deadline - this.runtime.nowMs();
      if (remainingMs <= 0) {
        await this.refresh();
        return {
          completed: false,
          reason: "deadline",
          remainingCalls,
        };
      }
      await this.runtime.sleep(Math.min(drainPollIntervalMs, remainingMs));
    }
  }

  private updateExecutionPosture() {
    try {
      const posture = this.executionPosture.snapshot();
      this.activeCalls = boundedCallCount(
        posture.activeCalls,
        this.config.maxCalls,
      );
      this.startingCalls = boundedCallCount(
        posture.startingCalls,
        this.config.maxCalls,
      );
      const capacitySlots = Math.max(
        0,
        this.config.maxCalls - this.activeCalls - this.startingCalls,
      );
      this.availableSlots = Math.min(
        capacitySlots,
        boundedCallCount(posture.availableSlots, this.config.maxCalls),
      );
    } catch {
      this.activeCalls = this.config.maxCalls;
      this.startingCalls = 0;
      this.availableSlots = 0;
    }
  }

  private calculateBelowExhaustion() {
    const ceilings = this.config.resourceCeilings;
    return this.availableSlots > 0
      && this.resources.cpuUtilizationPercent < ceilings.cpuUtilizationPercent
      && this.resources.memoryUtilizationPercent
        < ceilings.memoryUtilizationPercent
      && this.resources.eventLoopLagMs < ceilings.eventLoopLagMs
      && this.resources.openFileDescriptors < ceilings.openFileDescriptors
      && this.resources.openWebSockets < ceilings.openWebSockets;
  }

  private heartbeat(
    state: PstnRealtimeWorkerState,
  ): PstnRealtimeWorkerHeartbeat {
    return {
      workerId: this.config.workerId,
      releaseId: this.config.releaseId,
      mediaStreamBaseUrl: this.config.mediaStreamBaseUrl,
      state,
      supportedProviders: this.config.supportedProviders,
      activeCalls: this.activeCalls,
      startingCalls: this.startingCalls,
      availableSlots: this.availableSlots,
      resources: this.resources,
      lastSuccessfulRedisCheckAt: this.lastSuccessfulRedisCheckAt,
      lastSuccessfulPostgresCheckAt: this.lastSuccessfulPostgresCheckAt,
    };
  }
}

const systemLifecycleRuntime: PstnRealtimeWorkerLifecycleRuntime = {
  nowMs: () => Date.now(),
  setInterval: (callback, milliseconds) => {
    const handle = setInterval(() => {
      void callback();
    }, milliseconds);
    handle.unref?.();
    return handle;
  },
  clearInterval: (handle) => {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
  sleep: (milliseconds) =>
    new Promise((resolve) => {
      const handle = setTimeout(resolve, milliseconds);
      handle.unref?.();
    }),
};

async function safeHealthCheck(
  healthCheck: PstnRealtimeWorkerDependencyHealthCheck,
) {
  try {
    return await healthCheck.check() === true;
  } catch {
    return false;
  }
}

async function safeResourceSample(
  sampler: PstnRealtimeWorkerResourceSampler,
  config: PstnRealtimeWorkerConfig,
) {
  try {
    return await sampler.sample();
  } catch {
    return exhaustedResourcePosture(config);
  }
}

function exhaustedResourcePosture(
  config: PstnRealtimeWorkerConfig,
): PstnRealtimeWorkerResourcePosture {
  return {
    cpuUtilizationPercent: config.resourceCeilings.cpuUtilizationPercent,
    memoryUtilizationPercent: config.resourceCeilings.memoryUtilizationPercent,
    eventLoopLagMs: config.resourceCeilings.eventLoopLagMs,
    openFileDescriptors: config.resourceCeilings.openFileDescriptors,
    maxFileDescriptors: config.resourceCeilings.openFileDescriptors,
    openWebSockets: config.resourceCeilings.openWebSockets,
    maxWebSockets: config.resourceCeilings.openWebSockets,
  };
}

function boundedCallCount(value: number, maximum: number) {
  return Number.isInteger(value) && value >= 0
    ? Math.min(value, maximum)
    : maximum;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.round(clamp(value, minimum, maximum));
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return maximum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}
