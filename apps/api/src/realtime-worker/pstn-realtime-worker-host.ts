import type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger } from "@nestjs/common";

import type { PstnAdmissionRedisClient } from "../telephony/pstn-admission-redis-client";
import type { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import type { PstnRealtimeWorkerShutdownInput } from "../telephony/pstn-premium-call-execution";
import type { PstnRealtimeWorkerConfig } from "./pstn-realtime-worker-config";
import type {
  PstnRealtimeWorkerDrainResult,
  PstnRealtimeWorkerExecutionPosturePort,
  PstnRealtimeWorkerProcessMetricsSource,
} from "./pstn-realtime-worker-lifecycle";

interface CapacitySnapshotSource {
  getSnapshot(): {
    calls: {
      active: number;
      current: Array<{
        state: string;
        runtimePath: string;
        count: number;
      }>;
    };
    process: {
      cpuUtilization: number;
      eventLoopDelayP99Ms: number;
      rssBytes: number;
      openFileDescriptors: number | null;
    } | null;
    sockets: {
      open: Array<{
        runtimePath: string;
        count: number;
      }>;
    };
  };
}

interface LifecycleOwner {
  start(): Promise<void>;
  beginDrain(): Promise<PstnRealtimeWorkerDrainResult>;
  stop(): void;
  getHealthPosture(): { acceptingCalls: boolean };
}

interface ShutdownOwner {
  shutdown(input?: PstnRealtimeWorkerShutdownInput): Promise<unknown>;
}

export class PstnCapacityExecutionPostureAdapter
  implements PstnRealtimeWorkerExecutionPosturePort
{
  constructor(
    private readonly capacity: CapacitySnapshotSource,
    private readonly config: PstnRealtimeWorkerConfig,
  ) {}

  snapshot() {
    const snapshot = this.capacity.getSnapshot();
    let startingCalls = 0;
    let activeCalls = 0;
    for (const current of snapshot.calls.current) {
      if (current.runtimePath !== "pstn-premium-realtime") {
        continue;
      }
      const count = boundedInteger(current.count, this.config.maxCalls);
      if (current.state === "starting") {
        startingCalls += count;
      } else if (
        current.state === "active"
        || current.state === "handing_off"
        || current.state === "draining"
      ) {
        activeCalls += count;
      }
    }
    activeCalls = Math.min(activeCalls, this.config.maxCalls);
    startingCalls = Math.min(startingCalls, this.config.maxCalls);
    return {
      activeCalls,
      startingCalls,
      availableSlots: Math.max(
        0,
        this.config.maxCalls - activeCalls - startingCalls,
      ),
    };
  }
}

export class PstnCapacityProcessMetricsSource
  implements PstnRealtimeWorkerProcessMetricsSource
{
  constructor(private readonly capacity: CapacitySnapshotSource) {}

  async sample() {
    const snapshot = this.capacity.getSnapshot();
    const processSample = snapshot.process;
    if (processSample === null) {
      throw new Error("PSTN process metrics are unavailable.");
    }
    const openWebSockets = snapshot.sockets.open
      .filter((socket) => socket.runtimePath === "pstn-premium-realtime")
      .reduce((total, socket) => total + boundedInteger(socket.count), 0);
    return {
      cpuUtilizationPercent: boundedNumber(
        processSample.cpuUtilization * 100,
      ),
      residentMemoryBytes: boundedNumber(processSample.rssBytes),
      eventLoopLagMs: boundedNumber(processSample.eventLoopDelayP99Ms),
      openFileDescriptors: boundedInteger(
        processSample.openFileDescriptors ?? openWebSockets,
      ),
      openWebSockets: boundedInteger(openWebSockets),
    };
  }
}

export class PstnRealtimeWorkerRedisHealthCheck {
  constructor(private readonly redis: PstnAdmissionRedisClient) {}

  async check() {
    return await this.redis.eval(
      'return redis.call("PING")',
      [],
      [],
    ) === "PONG";
  }
}

export class PstnRealtimeWorkerPostgresHealthCheck {
  constructor(
    private readonly database: {
      query(query: string): Promise<{ rows: unknown[] }>;
    },
  ) {}

  async check() {
    const result = await this.database.query("select 1");
    return result.rows.length === 1;
  }
}

export class PstnRealtimeWorkerHostLifecycle
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private shutdownPromise: Promise<void> | undefined;
  private readonly logger = new Logger(PstnRealtimeWorkerHostLifecycle.name);

  constructor(
    private readonly redis: Pick<PstnAdmissionRedisClient, "connect">,
    private readonly lifecycle: LifecycleOwner,
    private readonly bridge: ShutdownOwner,
    private readonly execution: ShutdownOwner,
    private readonly admission: ShutdownOwner,
    private readonly capacity: Pick<
      PstnCapacityObservability,
      "recordForcedDrain"
    >,
  ) {}

  async onApplicationBootstrap() {
    await this.redis.connect();
    await this.lifecycle.start();
    if (!this.lifecycle.getHealthPosture().acceptingCalls) {
      throw new Error(
        "PSTN realtime worker failed readiness during startup.",
      );
    }
  }

  beforeApplicationShutdown() {
    this.shutdownPromise ??= this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown() {
    let firstError: unknown;
    let drainResult: PstnRealtimeWorkerDrainResult | undefined;
    try {
      drainResult = await this.lifecycle.beginDrain();
    } catch (error) {
      firstError = error;
    } finally {
      this.lifecycle.stop();
    }

    const shutdownInput = drainResult?.reason === "deadline"
      ? {
          reasonCode: "worker_drain_deadline" as const,
          forcedCallCount: drainResult.remainingCalls,
        }
      : undefined;
    if (shutdownInput !== undefined) {
      this.capacity.recordForcedDrain({
        forcedCallCount: shutdownInput.forcedCallCount,
      });
      this.logger.warn(
        "[pstn-realtime-worker] drain_deadline "
          + JSON.stringify({
            forcedCallCount: shutdownInput.forcedCallCount,
          }),
      );
    }

    for (const owner of [this.bridge, this.execution]) {
      try {
        await owner.shutdown(shutdownInput);
      } catch (error) {
        firstError ??= error;
      }
    }
    try {
      await this.admission.shutdown();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  }
}

function boundedInteger(value: number, maximum = 1_000_000) {
  return Number.isInteger(value) && value >= 0
    ? Math.min(value, maximum)
    : 0;
}

function boundedNumber(value: number, maximum = 1_000_000_000_000) {
  return Number.isFinite(value) && value >= 0
    ? Math.min(value, maximum)
    : maximum;
}
