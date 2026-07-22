import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { metrics, type Attributes, type Counter, type Gauge, type Histogram, type UpDownCounter } from "@opentelemetry/api";
import { readdirSync } from "node:fs";
import {
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
} from "node:perf_hooks";

import {
  runtimeMetricExportHealthStore,
  type RuntimeMetricExportHealthStore,
} from "./runtime-observability";

export type PstnCapacityStatus = "healthy" | "warning" | "critical" | "exhausted";
export type PstnCapacityCallState = "reserved" | "starting" | "active" | "handing_off" | "draining";
export type PstnCapacityRuntimePath = "pstn-sandwich" | "pstn-premium-realtime" | "unknown";
export type PstnCapacityProvider = "twilio" | "openai-realtime" | "gemini-live" | "sandwich" | "other";
export type PstnCapacityQueue =
  | "startup_ingress"
  | "twilio_ingress"
  | "handoff_ingress"
  | "provider_output"
  | "twilio_playback"
  | "tool_handoff"
  | "twilio_marks";
export type PstnCapacityDatabaseOperation =
  | "organization_list"
  | "telephony_state_load"
  | "telephony_state_save";

export interface PstnCapacityConfig {
  maxConcurrentCalls: number;
  cpuLimitMillicores: number;
  memoryLimitBytes: number;
  fileDescriptorLimit: number;
  databasePoolMax: number;
  eventLoopDelayLimitMs: number;
}

export interface PstnProcessSample {
  cpuUtilization: number;
  eventLoopUtilization: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  eventLoopDelayMaxMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  openFileDescriptors: number | null;
  gcPauseCount: number;
  gcPauseDurationMs: number;
}

export interface PstnProcessSampler {
  sample(): PstnProcessSample | null;
  dispose(): void;
}

export interface PstnCapacityMetricPoint {
  name: string;
  kind: "counter" | "up_down_counter" | "gauge" | "histogram";
  value: number;
  attributes: Record<string, string>;
}

export interface PstnCapacityMetricSink {
  emit(point: PstnCapacityMetricPoint): void;
}

interface TrackedCall {
  state: PstnCapacityCallState;
  runtimePath: PstnCapacityRuntimePath;
  provider: PstnCapacityProvider;
}

interface TrackedSocket {
  leg: "twilio" | "provider";
  runtimePath: PstnCapacityRuntimePath;
  provider: PstnCapacityProvider;
  bufferedBytes: number;
}

interface TrackedQueue {
  queue: PstnCapacityQueue;
  bytes: number;
  items: number;
  byteLimit: number;
  itemLimit?: number | undefined;
  drops: number;
}

interface DatabaseSnapshot {
  observed: boolean;
  pool: {
    active: number;
    idle: number;
    waiting: number;
    limit: number;
  };
  lastOperation: {
    operation: PstnCapacityDatabaseOperation;
    outcome: "success" | "failure";
    queryDurationMs: number;
    transactionDurationMs?: number | undefined;
    advisoryLockWaitMs?: number | undefined;
  } | null;
}

interface PstnCapacityQueueSnapshot extends TrackedQueue {
  aggregateUtilization: number;
  peakCallUtilization: number;
  utilization: number;
  status: PstnCapacityStatus;
}

export interface PstnCapacitySnapshot {
  capturedAt: string;
  status: PstnCapacityStatus;
  envelope: PstnCapacityConfig & {
    certified: false;
    expectedWebSocketLegsPerPremiumCall: 2;
  };
  resources: {
    calls: ResourcePosture;
    cpu: ResourcePosture;
    eventLoop: ResourcePosture;
    memory: ResourcePosture;
    database: ResourcePosture;
    fileDescriptors: ResourcePosture;
    queues: ResourcePosture;
  };
  calls: {
    active: number;
    current: Array<TrackedCall & { count: number }>;
    terminal: { completed: number; failed: number };
  };
  process: PstnProcessSample | null;
  sockets: {
    open: Array<Omit<TrackedSocket, "bufferedBytes"> & { count: number }>;
    bufferedBytes: number;
    inbound: { messages: number; bytes: number; messagesPerSecond: number; bytesPerSecond: number };
    outbound: { messages: number; bytes: number; messagesPerSecond: number; bytesPerSecond: number };
  };
  database: DatabaseSnapshot;
  queues: PstnCapacityQueueSnapshot[];
  telemetry: {
    metricExportFailureCount: number;
    lastMetricExportFailureAt: string | null;
  };
}

interface ResourcePosture {
  available: boolean;
  used: number | null;
  limit: number;
  utilization: number | null;
  status: PstnCapacityStatus | null;
}

interface PstnCapacityRecorderOptions {
  config?: PstnCapacityConfig | undefined;
  env?: Record<string, string | undefined> | undefined;
  now?: (() => string) | undefined;
  clockMs?: (() => number) | undefined;
  processSampler?: PstnProcessSampler | undefined;
  metricSink?: PstnCapacityMetricSink | undefined;
  metricExportHealthStore?: Pick<RuntimeMetricExportHealthStore, "getSnapshot"> | undefined;
}

const warningUtilization = 0.7;
const criticalUtilization = 0.85;
const exhaustedUtilization = 1;

export class PstnCapacityRecorder {
  private readonly calls = new Map<string, TrackedCall>();
  private readonly sockets = new Map<string, TrackedSocket>();
  private readonly queues = new Map<string, TrackedQueue>();
  private readonly terminal = { completed: 0, failed: 0 };
  private readonly socketTraffic = {
    inbound: { messages: 0, bytes: 0 },
    outbound: { messages: 0, bytes: 0 },
  };
  private database: DatabaseSnapshot;
  private readonly config: PstnCapacityConfig;
  private readonly now: () => string;
  private readonly clockMs: () => number;
  private lastTrafficSample: {
    atMs: number;
    inbound: { messages: number; bytes: number };
    outbound: { messages: number; bytes: number };
  };
  private readonly processSampler: PstnProcessSampler;
  private readonly metricSink: PstnCapacityMetricSink;
  private readonly metricExportHealthStore: Pick<RuntimeMetricExportHealthStore, "getSnapshot">;
  private samplingTimer: ReturnType<typeof setInterval> | undefined;
  private metricExportFailureCount = 0;

  constructor(options: PstnCapacityRecorderOptions = {}) {
    this.config = options.config ?? resolvePstnCapacityConfig(options.env);
    this.now = options.now ?? (() => new Date().toISOString());
    this.clockMs = options.clockMs ?? Date.now;
    this.lastTrafficSample = {
      atMs: this.clockMs(),
      inbound: { messages: 0, bytes: 0 },
      outbound: { messages: 0, bytes: 0 },
    };
    this.processSampler = options.processSampler ?? createNodeProcessSampler();
    this.metricSink = options.metricSink ?? createOpenTelemetryCapacityMetricSink();
    this.metricExportHealthStore = options.metricExportHealthStore ?? runtimeMetricExportHealthStore;
    this.database = {
      observed: false,
      pool: {
        active: 0,
        idle: 0,
        waiting: 0,
        limit: this.config.databasePoolMax,
      },
      lastOperation: null,
    };
  }

  trackCall(input: {
    callId: string;
    state: PstnCapacityCallState;
    runtimePath: string;
    provider: string;
  }) {
    const next: TrackedCall = {
      state: input.state,
      runtimePath: normalizeRuntimePath(input.runtimePath),
      provider: normalizeProvider(input.provider),
    };
    const previous = this.calls.get(input.callId);
    if (previous !== undefined && sameCallDimensions(previous, next)) return;

    if (previous !== undefined) {
      this.emit("zara.pstn.calls.active", "up_down_counter", -1, callAttributes(previous));
    }
    this.calls.set(input.callId, next);
    this.emit("zara.pstn.calls.active", "up_down_counter", 1, callAttributes(next));
    this.emit("zara.pstn.calls.transitions", "counter", 1, callAttributes(next));
  }

  endCall(input: { callId: string; outcome: "completed" | "failed" }) {
    const call = this.calls.get(input.callId);
    if (call === undefined) return;
    this.calls.delete(input.callId);
    this.clearCallQueues(input.callId);
    this.terminal[input.outcome] += 1;
    this.emit("zara.pstn.calls.active", "up_down_counter", -1, callAttributes(call));
    this.emit("zara.pstn.calls.terminal", "counter", 1, {
      runtime_path: call.runtimePath,
      provider: call.provider,
      outcome: input.outcome,
    });
  }

  openSocket(input: {
    socketId: string;
    leg: "twilio" | "provider";
    runtimePath: string;
    provider: string;
  }) {
    if (this.sockets.has(input.socketId)) return;
    const socket: TrackedSocket = {
      leg: input.leg,
      runtimePath: normalizeRuntimePath(input.runtimePath),
      provider: normalizeProvider(input.provider),
      bufferedBytes: 0,
    };
    this.sockets.set(input.socketId, socket);
    this.emit("zara.pstn.sockets.open", "up_down_counter", 1, socketAttributes(socket));
  }

  updateSocketContext(input: { socketId: string; runtimePath: string; provider?: string | undefined }) {
    const socket = this.sockets.get(input.socketId);
    if (socket === undefined) return;
    const previousAttributes = socketAttributes(socket);
    this.emit("zara.pstn.sockets.open", "up_down_counter", -1, previousAttributes);
    if (socket.bufferedBytes > 0) {
      this.emit("zara.pstn.socket.buffered_bytes", "up_down_counter", -socket.bufferedBytes, previousAttributes);
    }
    socket.runtimePath = normalizeRuntimePath(input.runtimePath);
    if (input.provider !== undefined) socket.provider = normalizeProvider(input.provider);
    const nextAttributes = socketAttributes(socket);
    this.emit("zara.pstn.sockets.open", "up_down_counter", 1, nextAttributes);
    if (socket.bufferedBytes > 0) {
      this.emit("zara.pstn.socket.buffered_bytes", "up_down_counter", socket.bufferedBytes, nextAttributes);
    }
  }

  recordSocketHandshake(input: {
    socketId: string;
    latencyMs: number;
    outcome: "accepted" | "rejected" | "failed";
  }) {
    const socket = this.sockets.get(input.socketId);
    if (socket === undefined) return;
    this.recordSocketHandshakeAttempt({
      leg: socket.leg,
      runtimePath: socket.runtimePath,
      provider: socket.provider,
      latencyMs: input.latencyMs,
      outcome: input.outcome,
    });
  }

  recordSocketHandshakeAttempt(input: {
    leg: "twilio" | "provider";
    runtimePath: string;
    provider: string;
    latencyMs: number;
    outcome: "accepted" | "rejected" | "failed";
  }) {
    this.emit("zara.pstn.socket.handshake.duration", "histogram", nonNegative(input.latencyMs), {
      leg: input.leg,
      runtime_path: normalizeRuntimePath(input.runtimePath),
      provider: normalizeProvider(input.provider),
      outcome: input.outcome,
    });
  }

  recordSocketTraffic(input: {
    socketId: string;
    direction: "inbound" | "outbound";
    messageCount: number;
    byteCount: number;
  }) {
    const socket = this.sockets.get(input.socketId);
    if (socket === undefined) return;
    const messages = nonNegative(input.messageCount);
    const bytes = nonNegative(input.byteCount);
    this.socketTraffic[input.direction].messages += messages;
    this.socketTraffic[input.direction].bytes += bytes;
    const attributes = { ...socketAttributes(socket), direction: input.direction };
    this.emit("zara.pstn.socket.messages", "counter", messages, attributes);
    this.emit("zara.pstn.socket.bytes", "counter", bytes, attributes);
  }

  recordSocketBuffered(input: { socketId: string; bufferedBytes: number }) {
    const socket = this.sockets.get(input.socketId);
    if (socket === undefined) return;
    const nextBufferedBytes = nonNegative(input.bufferedBytes);
    const delta = nextBufferedBytes - socket.bufferedBytes;
    socket.bufferedBytes = nextBufferedBytes;
    this.emit(
      "zara.pstn.socket.buffered_bytes",
      "up_down_counter",
      delta,
      socketAttributes(socket),
    );
  }

  closeSocket(input: {
    socketId: string;
    initiator: "local" | "remote" | "transport";
    code?: number | undefined;
  }) {
    const socket = this.sockets.get(input.socketId);
    if (socket === undefined) return;
    this.sockets.delete(input.socketId);
    const attributes = socketAttributes(socket);
    this.emit("zara.pstn.sockets.open", "up_down_counter", -1, attributes);
    if (socket.bufferedBytes > 0) {
      this.emit("zara.pstn.socket.buffered_bytes", "up_down_counter", -socket.bufferedBytes, attributes);
    }
    this.emit("zara.pstn.socket.closes", "counter", 1, {
      ...attributes,
      close_initiator: input.initiator,
      close_code_class: classifyWebSocketCloseCode(input.code),
    });
  }

  recordQueue(input: {
    callId: string;
    queue: PstnCapacityQueue;
    bytes: number;
    items: number;
    byteLimit: number;
    itemLimit?: number | undefined;
  }) {
    const key = `${input.callId}:${input.queue}`;
    const previous = this.queues.get(key);
    const queue: TrackedQueue = {
      queue: input.queue,
      bytes: nonNegative(input.bytes),
      items: nonNegative(input.items),
      byteLimit: positive(input.byteLimit, 1),
      ...(input.itemLimit !== undefined ? { itemLimit: positive(input.itemLimit, 1) } : {}),
      drops: previous?.drops ?? 0,
    };
    this.queues.set(key, queue);
    const attributes = { queue: input.queue };
    this.emit("zara.pstn.queue.depth_bytes", "up_down_counter", queue.bytes - (previous?.bytes ?? 0), attributes);
    this.emit("zara.pstn.queue.depth_items", "up_down_counter", queue.items - (previous?.items ?? 0), attributes);
  }

  recordQueueDrop(input: {
    callId: string;
    queue: PstnCapacityQueue;
    count?: number | undefined;
    reason: "overflow" | "stale" | "shutdown" | "other";
  }) {
    const count = positive(input.count ?? 1, 1);
    const queue = this.queues.get(`${input.callId}:${input.queue}`);
    if (queue !== undefined) queue.drops += count;
    this.emit("zara.pstn.queue.drops", "counter", count, {
      queue: input.queue,
      outcome: input.reason,
    });
  }

  clearCallQueues(callId: string) {
    for (const [key, queue] of this.queues) {
      if (!key.startsWith(`${callId}:`)) continue;
      this.queues.delete(key);
      const attributes = { queue: queue.queue };
      this.emit("zara.pstn.queue.depth_bytes", "up_down_counter", -queue.bytes, attributes);
      this.emit("zara.pstn.queue.depth_items", "up_down_counter", -queue.items, attributes);
    }
  }

  recordDatabaseOperation(input: {
    operation: PstnCapacityDatabaseOperation;
    outcome: "success" | "failure";
    queryDurationMs: number;
    transactionDurationMs?: number | undefined;
    advisoryLockWaitMs?: number | undefined;
    pool: DatabaseSnapshot["pool"];
  }) {
    this.database = {
      observed: true,
      pool: {
        active: nonNegative(input.pool.active),
        idle: nonNegative(input.pool.idle),
        waiting: nonNegative(input.pool.waiting),
        limit: positive(input.pool.limit, this.config.databasePoolMax),
      },
      lastOperation: {
        operation: input.operation,
        outcome: input.outcome,
        queryDurationMs: nonNegative(input.queryDurationMs),
        ...(input.transactionDurationMs !== undefined
          ? { transactionDurationMs: nonNegative(input.transactionDurationMs) }
          : {}),
        ...(input.advisoryLockWaitMs !== undefined
          ? { advisoryLockWaitMs: nonNegative(input.advisoryLockWaitMs) }
          : {}),
      },
    };
    const attributes = { operation: input.operation, outcome: input.outcome };
    this.emit("zara.pstn.database.query_duration", "histogram", input.queryDurationMs, attributes);
    if (input.transactionDurationMs !== undefined) {
      this.emit("zara.pstn.database.transaction_duration", "histogram", input.transactionDurationMs, attributes);
    }
    if (input.advisoryLockWaitMs !== undefined) {
      this.emit("zara.pstn.database.advisory_lock_wait", "histogram", input.advisoryLockWaitMs, attributes);
    }
    this.emit("zara.pstn.database.pool_active", "gauge", this.database.pool.active, {});
    this.emit("zara.pstn.database.pool_idle", "gauge", this.database.pool.idle, {});
    this.emit("zara.pstn.database.pool_waiting", "gauge", this.database.pool.waiting, {});
  }

  getSnapshot(): PstnCapacitySnapshot {
    const processSample = this.sampleProcess();
    const activeCalls = this.calls.size;
    const queues = aggregateQueues(this.queues.values());
    const traffic = this.sampleSocketTraffic();
    const resources = {
      calls: resourcePosture(activeCalls, this.config.maxConcurrentCalls),
      cpu: processSample === null
        ? unavailableResourcePosture(this.config.cpuLimitMillicores / 1_000)
        : resourcePosture(processSample.cpuUtilization, this.config.cpuLimitMillicores / 1_000),
      eventLoop: processSample === null
        ? unavailableResourcePosture(this.config.eventLoopDelayLimitMs)
        : resourcePosture(processSample.eventLoopDelayP99Ms, this.config.eventLoopDelayLimitMs),
      memory: processSample === null
        ? unavailableResourcePosture(this.config.memoryLimitBytes)
        : resourcePosture(processSample.rssBytes, this.config.memoryLimitBytes),
      database: this.database.observed
        ? resourcePosture(
            this.database.pool.active + this.database.pool.waiting,
            this.database.pool.limit,
          )
        : unavailableResourcePosture(this.database.pool.limit),
      fileDescriptors: processSample === null || processSample.openFileDescriptors === null
        ? unavailableResourcePosture(this.config.fileDescriptorLimit)
        : resourcePosture(
            Math.max(processSample.openFileDescriptors, this.sockets.size),
            this.config.fileDescriptorLimit,
          ),
      queues: highestQueuePosture(queues),
    };

    const metricExportHealth = this.metricExportHealthStore.getSnapshot();
    return {
      capturedAt: this.now(),
      status: highestStatus(Object.values(resources).flatMap((resource) =>
        resource.status === null ? [] : [resource.status]
      )),
      envelope: {
        ...this.config,
        certified: false,
        expectedWebSocketLegsPerPremiumCall: 2,
      },
      resources,
      calls: {
        active: activeCalls,
        current: aggregateCalls(this.calls.values()),
        terminal: { ...this.terminal },
      },
      process: processSample,
      sockets: {
        open: aggregateSockets(this.sockets.values()),
        bufferedBytes: [...this.sockets.values()].reduce((total, socket) => total + socket.bufferedBytes, 0),
        inbound: traffic.inbound,
        outbound: traffic.outbound,
      },
      database: cloneDatabaseSnapshot(this.database),
      queues,
      telemetry: {
        metricExportFailureCount: this.metricExportFailureCount + metricExportHealth.failureCount,
        lastMetricExportFailureAt: metricExportHealth.lastFailureAt,
      },
    };
  }

  startPeriodicSampling(intervalMs = 10_000) {
    if (this.samplingTimer !== undefined) return;
    this.sampleProcess();
    this.samplingTimer = setInterval(() => {
      this.sampleProcess();
    }, positive(intervalMs, 10_000));
    this.samplingTimer.unref?.();
  }

  dispose() {
    if (this.samplingTimer !== undefined) {
      clearInterval(this.samplingTimer);
      this.samplingTimer = undefined;
    }
    this.processSampler.dispose();
  }

  private sampleProcess() {
    let sample: PstnProcessSample | null;
    try {
      sample = this.processSampler.sample();
    } catch {
      sample = null;
    }
    if (sample !== null) this.emitProcessMetrics(sample);
    this.emitEnvelopeMetrics();
    return sample;
  }

  private sampleSocketTraffic() {
    const sampledAtMs = this.clockMs();
    const elapsedSeconds = Math.max(1, (sampledAtMs - this.lastTrafficSample.atMs) / 1_000);
    const inbound = trafficSnapshot(
      this.socketTraffic.inbound,
      this.lastTrafficSample.inbound,
      elapsedSeconds,
    );
    const outbound = trafficSnapshot(
      this.socketTraffic.outbound,
      this.lastTrafficSample.outbound,
      elapsedSeconds,
    );
    this.lastTrafficSample = {
      atMs: sampledAtMs,
      inbound: { ...this.socketTraffic.inbound },
      outbound: { ...this.socketTraffic.outbound },
    };
    return { inbound, outbound };
  }

  private emitEnvelopeMetrics() {
    this.emit("zara.pstn.envelope.max_concurrent_calls", "gauge", this.config.maxConcurrentCalls, {});
    this.emit("zara.pstn.envelope.cpu_limit_millicores", "gauge", this.config.cpuLimitMillicores, {});
    this.emit("zara.pstn.envelope.memory_limit_bytes", "gauge", this.config.memoryLimitBytes, {});
    this.emit("zara.pstn.envelope.file_descriptor_limit", "gauge", this.config.fileDescriptorLimit, {});
    this.emit("zara.pstn.envelope.database_pool_max", "gauge", this.config.databasePoolMax, {});
    this.emit("zara.pstn.envelope.event_loop_delay_limit_ms", "gauge", this.config.eventLoopDelayLimitMs, {});
  }

  private emitProcessMetrics(sample: PstnProcessSample) {
    this.emit("zara.pstn.process.cpu_utilization", "gauge", sample.cpuUtilization, {});
    this.emit("zara.pstn.process.event_loop_utilization", "gauge", sample.eventLoopUtilization, {});
    this.emit("zara.pstn.process.event_loop_delay_p95", "gauge", sample.eventLoopDelayP95Ms, {});
    this.emit("zara.pstn.process.event_loop_delay_p99", "gauge", sample.eventLoopDelayP99Ms, {});
    this.emit("zara.pstn.process.event_loop_delay_max", "gauge", sample.eventLoopDelayMaxMs, {});
    this.emit("zara.pstn.process.rss_bytes", "gauge", sample.rssBytes, {});
    this.emit("zara.pstn.process.heap_used_bytes", "gauge", sample.heapUsedBytes, {});
    this.emit("zara.pstn.process.heap_total_bytes", "gauge", sample.heapTotalBytes, {});
    this.emit("zara.pstn.process.external_bytes", "gauge", sample.externalBytes, {});
    this.emit("zara.pstn.process.array_buffers_bytes", "gauge", sample.arrayBuffersBytes, {});
    if (sample.openFileDescriptors !== null) {
      this.emit("zara.pstn.process.open_file_descriptors", "gauge", sample.openFileDescriptors, {});
    }
    this.emit("zara.pstn.process.gc_pause_count", "counter", sample.gcPauseCount, {});
    this.emit("zara.pstn.process.gc_pause_duration", "histogram", sample.gcPauseDurationMs, {});
  }

  private emit(
    name: string,
    kind: PstnCapacityMetricPoint["kind"],
    value: number,
    attributes: Record<string, string>,
  ) {
    try {
      this.metricSink.emit({ name, kind, value: nonNegativeUnlessDelta(value, kind), attributes });
    } catch {
      this.metricExportFailureCount += 1;
      // Capacity export is deliberately outside the live call failure path.
    }
  }
}

@Injectable()
export class PstnCapacityObservability extends PstnCapacityRecorder implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  onModuleInit() {
    this.startPeriodicSampling(readPositiveInteger(
      process.env["PSTN_CAPACITY_SAMPLE_INTERVAL_MS"],
      10_000,
    ));
  }

  onModuleDestroy() {
    this.dispose();
  }
}

export function resolvePstnCapacityConfig(
  env: Record<string, string | undefined> = process.env,
): PstnCapacityConfig {
  return {
    maxConcurrentCalls: readPositiveInteger(env["PSTN_CAPACITY_MAX_CONCURRENT_CALLS"], 20),
    cpuLimitMillicores: readPositiveInteger(
      env["PSTN_INSTANCE_CPU_LIMIT_MILLICORES"],
      2_000,
    ),
    memoryLimitBytes: readPositiveInteger(env["PSTN_INSTANCE_MEMORY_LIMIT_BYTES"], 1_073_741_824),
    fileDescriptorLimit: readPositiveInteger(env["PSTN_INSTANCE_FILE_DESCRIPTOR_LIMIT"], 4_096),
    databasePoolMax: readPositiveInteger(env["PGPOOL_MAX"], 10),
    eventLoopDelayLimitMs: readPositiveInteger(env["PSTN_EVENT_LOOP_DELAY_LIMIT_MS"], 50),
  };
}

export function createOpenTelemetryCapacityMetricSink(): PstnCapacityMetricSink {
  const meter = metrics.getMeter("zara-pstn-capacity");
  const counters = new Map<string, Counter<Attributes>>();
  const upDownCounters = new Map<string, UpDownCounter<Attributes>>();
  const gauges = new Map<string, Gauge<Attributes>>();
  const histograms = new Map<string, Histogram<Attributes>>();

  return {
    emit(point) {
      if (point.kind === "counter") {
        getInstrument(counters, point.name, () => meter.createCounter(point.name)).add(
          point.value,
          point.attributes,
        );
        return;
      }
      if (point.kind === "up_down_counter") {
        getInstrument(upDownCounters, point.name, () => meter.createUpDownCounter(point.name)).add(
          point.value,
          point.attributes,
        );
        return;
      }
      if (point.kind === "gauge") {
        getInstrument(gauges, point.name, () => meter.createGauge(point.name)).record(
          point.value,
          point.attributes,
        );
        return;
      }
      getInstrument(histograms, point.name, () => meter.createHistogram(point.name)).record(
        point.value,
        point.attributes,
      );
    },
  };
}

function createNodeProcessSampler(): PstnProcessSampler {
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();
  let previousCpu = process.cpuUsage();
  let previousAt = process.hrtime.bigint();
  let previousEventLoop = performance.eventLoopUtilization();
  let gcPauseCount = 0;
  let gcPauseDurationMs = 0;
  const gcObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gcPauseCount += 1;
      gcPauseDurationMs += entry.duration;
    }
  });
  gcObserver.observe({ entryTypes: ["gc"] });

  return {
    sample() {
      const currentAt = process.hrtime.bigint();
      const elapsedMicros = Math.max(1, Number(currentAt - previousAt) / 1_000);
      const cpu = process.cpuUsage(previousCpu);
      const eventLoop = performance.eventLoopUtilization(previousEventLoop);
      const memory = process.memoryUsage();
      const sample: PstnProcessSample = {
        cpuUtilization: (cpu.user + cpu.system) / elapsedMicros,
        eventLoopUtilization: eventLoop.utilization,
        eventLoopDelayP95Ms: nanosecondsToMilliseconds(eventLoopDelay.percentile(95)),
        eventLoopDelayP99Ms: nanosecondsToMilliseconds(eventLoopDelay.percentile(99)),
        eventLoopDelayMaxMs: nanosecondsToMilliseconds(eventLoopDelay.max),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
        openFileDescriptors: readOpenFileDescriptorCount(),
        gcPauseCount,
        gcPauseDurationMs,
      };
      previousCpu = process.cpuUsage();
      previousAt = currentAt;
      previousEventLoop = performance.eventLoopUtilization();
      gcPauseCount = 0;
      gcPauseDurationMs = 0;
      eventLoopDelay.reset();
      return sample;
    },
    dispose() {
      eventLoopDelay.disable();
      gcObserver.disconnect();
    },
  };
}

function readOpenFileDescriptorCount() {
  try {
    return readdirSync("/proc/self/fd").length;
  } catch {
    return null;
  }
}

function resourcePosture(used: number, limit: number): ResourcePosture {
  const safeUsed = nonNegative(used);
  const safeLimit = positive(limit, 1);
  const utilization = safeUsed / safeLimit;
  return {
    available: true,
    used: safeUsed,
    limit: safeLimit,
    utilization,
    status: classifyUtilization(utilization),
  };
}

function unavailableResourcePosture(limit: number): ResourcePosture {
  return {
    available: false,
    used: null,
    limit: positive(limit, 1),
    utilization: null,
    status: null,
  };
}

function classifyUtilization(utilization: number): PstnCapacityStatus {
  if (utilization >= exhaustedUtilization) return "exhausted";
  if (utilization >= criticalUtilization) return "critical";
  if (utilization >= warningUtilization) return "warning";
  return "healthy";
}

function highestStatus(statuses: PstnCapacityStatus[]): PstnCapacityStatus {
  const rank: Record<PstnCapacityStatus, number> = {
    healthy: 0,
    warning: 1,
    critical: 2,
    exhausted: 3,
  };
  return statuses.reduce(
    (highest, status) => rank[status] > rank[highest] ? status : highest,
    "healthy" as PstnCapacityStatus,
  );
}

function highestQueuePosture(
  queues: PstnCapacityQueueSnapshot[],
): ResourcePosture {
  const utilization = queues.reduce((maximum, queue) => Math.max(maximum, queue.utilization), 0);
  return {
    available: true,
    used: utilization,
    limit: 1,
    utilization,
    status: classifyUtilization(utilization),
  };
}

function aggregateCalls(calls: Iterable<TrackedCall>) {
  const groups = new Map<string, TrackedCall & { count: number }>();
  for (const call of calls) {
    const key = `${call.runtimePath}:${call.provider}:${call.state}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { ...call, count: 1 });
    else group.count += 1;
  }
  return [...groups.values()].sort((left, right) =>
    `${left.runtimePath}:${left.provider}:${left.state}`.localeCompare(
      `${right.runtimePath}:${right.provider}:${right.state}`,
    ),
  );
}

function aggregateSockets(sockets: Iterable<TrackedSocket>) {
  const groups = new Map<string, Omit<TrackedSocket, "bufferedBytes"> & { count: number }>();
  for (const socket of sockets) {
    const key = `${socket.leg}:${socket.runtimePath}:${socket.provider}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        leg: socket.leg,
        runtimePath: socket.runtimePath,
        provider: socket.provider,
        count: 1,
      });
    } else {
      group.count += 1;
    }
  }
  return [...groups.values()].sort((left, right) =>
    `${left.leg}:${left.runtimePath}:${left.provider}`.localeCompare(
      `${right.leg}:${right.runtimePath}:${right.provider}`,
    ),
  );
}

function aggregateQueues(queues: Iterable<TrackedQueue>) {
  const groups = new Map<PstnCapacityQueue, TrackedQueue & { peakCallUtilization: number }>();
  for (const queue of queues) {
    const callUtilization = queueUtilization(queue);
    const group = groups.get(queue.queue);
    if (group === undefined) groups.set(queue.queue, { ...queue, peakCallUtilization: callUtilization });
    else {
      group.bytes += queue.bytes;
      group.items += queue.items;
      group.byteLimit += queue.byteLimit;
      group.drops += queue.drops;
      group.peakCallUtilization = Math.max(group.peakCallUtilization, callUtilization);
      if (group.itemLimit !== undefined || queue.itemLimit !== undefined) {
        group.itemLimit = (group.itemLimit ?? 0) + (queue.itemLimit ?? 0);
      }
    }
  }
  return [...groups.values()]
    .map((queue) => {
      const aggregateUtilization = queueUtilization(queue);
      const utilization = Math.max(aggregateUtilization, queue.peakCallUtilization);
      return {
        ...queue,
        aggregateUtilization,
        utilization,
        status: classifyUtilization(utilization),
      };
    })
    .sort((left, right) => left.queue.localeCompare(right.queue));
}

function queueUtilization(queue: Pick<TrackedQueue, "bytes" | "items" | "byteLimit" | "itemLimit">) {
  const byteUtilization = queue.bytes / queue.byteLimit;
  const itemUtilization = queue.itemLimit === undefined ? 0 : queue.items / queue.itemLimit;
  return Math.max(byteUtilization, itemUtilization);
}

function trafficSnapshot(
  traffic: { messages: number; bytes: number },
  previous: { messages: number; bytes: number },
  elapsedSeconds: number,
) {
  return {
    ...traffic,
    messagesPerSecond: Math.max(0, traffic.messages - previous.messages) / elapsedSeconds,
    bytesPerSecond: Math.max(0, traffic.bytes - previous.bytes) / elapsedSeconds,
  };
}

function callAttributes(call: TrackedCall) {
  return {
    runtime_path: call.runtimePath,
    provider: call.provider,
    state: call.state,
  };
}

function socketAttributes(socket: TrackedSocket) {
  return {
    leg: socket.leg,
    runtime_path: socket.runtimePath,
    provider: socket.provider,
  };
}

function sameCallDimensions(left: TrackedCall, right: TrackedCall) {
  return left.state === right.state
    && left.runtimePath === right.runtimePath
    && left.provider === right.provider;
}

function normalizeRuntimePath(value: string): PstnCapacityRuntimePath {
  return value === "pstn-sandwich" || value === "pstn-premium-realtime" ? value : "unknown";
}

function normalizeProvider(value: string): PstnCapacityProvider {
  if (
    value === "twilio"
    || value === "openai-realtime"
    || value === "gemini-live"
    || value === "sandwich"
  ) {
    return value;
  }
  return "other";
}

function classifyWebSocketCloseCode(code: number | undefined) {
  if (code === undefined) return "unknown";
  if (code === 1000 || code === 1001) return "normal";
  if (code === 4_401 || code === 4_403) return "authorization";
  if (code === 1_009 || code === 1_013 || code === 4_408) return "capacity";
  if (code === 1_002 || code === 1_003 || code === 1_007) return "protocol";
  if (code === 1_011 || code >= 4_500) return "internal";
  if (code === 1_008 || code === 4_400 || code === 4_409) return "policy";
  if (code >= 4_000) return "application";
  return "transport";
}

function cloneDatabaseSnapshot(snapshot: DatabaseSnapshot): DatabaseSnapshot {
  return {
    observed: snapshot.observed,
    pool: { ...snapshot.pool },
    lastOperation: snapshot.lastOperation === null ? null : { ...snapshot.lastOperation },
  };
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function nonNegativeUnlessDelta(
  value: number,
  kind: PstnCapacityMetricPoint["kind"],
) {
  return kind === "up_down_counter" && Number.isFinite(value) ? value : nonNegative(value);
}

function nanosecondsToMilliseconds(value: number) {
  return Number.isFinite(value) ? value / 1_000_000 : 0;
}

function getInstrument<T>(instruments: Map<string, T>, name: string, create: () => T) {
  const existing = instruments.get(name);
  if (existing !== undefined) return existing;
  const instrument = create();
  instruments.set(name, instrument);
  return instrument;
}
