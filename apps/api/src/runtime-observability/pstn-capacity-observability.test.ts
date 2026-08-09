import { describe, expect, it, vi } from "vitest";

import {
  PstnCapacityRecorder,
  type PstnCapacityMetricPoint,
} from "./pstn-capacity-observability";

const fixedProcessSample = {
  cpuUtilization: 0.42,
  eventLoopUtilization: 0.35,
  eventLoopDelayP95Ms: 18,
  eventLoopDelayP99Ms: 22,
  eventLoopDelayMaxMs: 31,
  rssBytes: 600,
  heapUsedBytes: 300,
  heapTotalBytes: 500,
  externalBytes: 80,
  arrayBuffersBytes: 40,
  openFileDescriptors: 8,
  gcPauseCount: 2,
  gcPauseDurationMs: 6,
};

function createRecorder(metricPoints: PstnCapacityMetricPoint[] = []) {
  return new PstnCapacityRecorder({
    config: {
      maxConcurrentCalls: 20,
      cpuLimitMillicores: 1_000,
      memoryLimitBytes: 1_000,
      fileDescriptorLimit: 100,
      databasePoolMax: 10,
      eventLoopDelayLimitMs: 100,
    },
    now: () => "2026-07-22T12:00:00.000Z",
    processSampler: {
      sample: () => fixedProcessSample,
      dispose: vi.fn(),
    },
    metricSink: {
      emit: (point) => metricPoints.push(point),
    },
  });
}

describe("PstnCapacityRecorder", () => {
  it("emits bounded admission outcome, latency, allowance, and lease metrics", () => {
    const metricPoints: PstnCapacityMetricPoint[] = [];
    const recorder = createRecorder(metricPoints);

    recorder.recordAdmission({
      outcome: "denied",
      reasonCode: "tenant_concurrency_limit",
      limitingDimension: "tenant_concurrency",
      runtimePath: "pstn-premium-realtime",
      provider: "twilio",
      latencyMs: 12,
      remainingCapacity: 0,
    });
    recorder.recordAdmissionLease({
      operation: "renew",
      outcome: "backend_unavailable",
      runtimePath: "pstn-premium-realtime",
      provider: "twilio",
    });
    recorder.recordAdmissionOwnershipLost({
      reason: "confirmed_lease_expired",
      runtimePath: "pstn-premium-realtime",
      provider: "twilio",
    });
    recorder.recordAdmissionBackendHealth({
      status: "unavailable",
      reasonCode: "backend_unavailable",
    });

    expect(metricPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "zara.pstn.admission.requests",
          attributes: expect.objectContaining({
            outcome: "denied",
            reason_code: "tenant_concurrency_limit",
            limiting_dimension: "tenant_concurrency",
          }),
        }),
        expect.objectContaining({
          name: "zara.pstn.admission.duration",
          value: 12,
        }),
        expect.objectContaining({
          name: "zara.pstn.admission.remaining_capacity",
          value: 0,
        }),
        expect.objectContaining({
          name: "zara.pstn.admission.lease_operations",
          attributes: expect.objectContaining({
            operation: "renew",
            outcome: "backend_unavailable",
          }),
        }),
        expect.objectContaining({
          name: "zara.pstn.admission.ownership_lost",
          value: 1,
          attributes: {
            reason: "confirmed_lease_expired",
            runtime_path: "pstn-premium-realtime",
            provider: "twilio",
          },
        }),
        expect.objectContaining({
          name: "zara.pstn.admission.backend_ready",
          value: 0,
          attributes: {
            reason_code: "backend_unavailable",
          },
        }),
      ]),
    );
    expect(JSON.stringify(metricPoints)).not.toContain("tenant-a");
    expect(JSON.stringify(metricPoints)).not.toContain("call-a");
  });

  it.each(["not_owner", "denied"])(
    "preserves the bounded %s admission lease outcome",
    (outcome) => {
      const metricPoints: PstnCapacityMetricPoint[] = [];
      const recorder = createRecorder(metricPoints);

      recorder.recordAdmissionLease({
        operation: "activate",
        outcome,
        runtimePath: "pstn-premium-realtime",
        provider: "twilio",
      });

      expect(metricPoints).toContainEqual(
        expect.objectContaining({
          name: "zara.pstn.admission.lease_operations",
          attributes: expect.objectContaining({ outcome }),
        }),
      );
    },
  );

  it("classifies declared resource use at warning, critical, and exhausted thresholds", () => {
    const recorder = createRecorder();

    for (let index = 0; index < 14; index += 1) {
      recorder.trackCall({
        callId: `call-warning-${index}`,
        state: "active",
        runtimePath: "pstn-premium-realtime",
        provider: "openai-realtime",
      });
    }

    expect(recorder.getSnapshot().resources.calls).toMatchObject({
      used: 14,
      limit: 20,
      utilization: 0.7,
      status: "warning",
    });

    for (let index = 14; index < 17; index += 1) {
      recorder.trackCall({
        callId: `call-critical-${index}`,
        state: "active",
        runtimePath: "pstn-premium-realtime",
        provider: "openai-realtime",
      });
    }

    expect(recorder.getSnapshot().resources.calls.status).toBe("critical");

    for (let index = 17; index < 20; index += 1) {
      recorder.trackCall({
        callId: `call-exhausted-${index}`,
        state: "active",
        runtimePath: "pstn-premium-realtime",
        provider: "openai-realtime",
      });
    }

    const snapshot = recorder.getSnapshot();
    expect(snapshot.status).toBe("exhausted");
    expect(snapshot.resources.calls.status).toBe("exhausted");
    expect(snapshot.envelope.certified).toBe(false);
    expect(snapshot.envelope.maxConcurrentCalls).toBe(20);
    expect(snapshot.resources.fileDescriptors).toMatchObject({
      used: 8,
      limit: 100,
      status: "healthy",
    });
  });

  it("uses the declared provisional worker envelope and classifies event-loop p99", () => {
    const recorder = new PstnCapacityRecorder({
      env: {},
      processSampler: {
        sample: () => ({
          ...fixedProcessSample,
          eventLoopDelayP95Ms: 20,
          eventLoopDelayP99Ms: 50,
        }),
        dispose: vi.fn(),
      },
      metricSink: { emit: vi.fn() },
    });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.envelope).toMatchObject({
      maxConcurrentCalls: 20,
      cpuLimitMillicores: 2_000,
      memoryLimitBytes: 1_073_741_824,
      fileDescriptorLimit: 4_096,
      databasePoolMax: 10,
      eventLoopDelayLimitMs: 50,
      certified: false,
      expectedWebSocketLegsPerPremiumCall: 2,
    });
    expect(snapshot.resources.eventLoop).toMatchObject({
      used: 50,
      limit: 50,
      status: "exhausted",
    });
  });

  it("aggregates call, socket, database, and bounded queue posture without exposing identities", () => {
    const metricPoints: PstnCapacityMetricPoint[] = [];
    const recorder = createRecorder(metricPoints);

    recorder.trackCall({
      callId: "call-secret-123",
      state: "starting",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });
    recorder.trackCall({
      callId: "call-secret-123",
      state: "active",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });
    recorder.trackCall({
      callId: "call-secret-456",
      state: "active",
      runtimePath: "pstn-premium-realtime",
      provider: "gemini-live",
    });

    recorder.openSocket({
      socketId: "stream-secret-123:twilio",
      leg: "twilio",
      runtimePath: "pstn-premium-realtime",
      provider: "twilio",
    });
    recorder.recordSocketHandshake({
      socketId: "stream-secret-123:twilio",
      latencyMs: 45,
      outcome: "accepted",
    });
    recorder.recordSocketTraffic({
      socketId: "stream-secret-123:twilio",
      direction: "inbound",
      messageCount: 2,
      byteCount: 320,
    });
    recorder.recordSocketBuffered({
      socketId: "stream-secret-123:twilio",
      bufferedBytes: 160,
    });

    recorder.recordQueue({
      callId: "call-secret-123",
      queue: "provider_output",
      bytes: 96,
      items: 2,
      byteLimit: 256,
      itemLimit: 8,
    });
    recorder.recordQueueDrop({
      callId: "call-secret-123",
      queue: "provider_output",
      count: 2,
      reason: "overflow",
    });
    recorder.recordDatabaseOperation({
      operation: "telephony_state_save",
      outcome: "success",
      queryDurationMs: 12,
      transactionDurationMs: 18,
      advisoryLockWaitMs: 4,
      poolAcquisitionWaitMs: 3,
      rowLockWaitMs: 5,
      deadlockCount: 1,
      retryCount: 2,
      pool: {
        active: 6,
        idle: 3,
        waiting: 1,
        limit: 10,
      },
    });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.calls.current).toEqual([
      {
        runtimePath: "pstn-premium-realtime",
        provider: "gemini-live",
        state: "active",
        count: 1,
      },
      {
        runtimePath: "pstn-premium-realtime",
        provider: "openai-realtime",
        state: "active",
        count: 1,
      },
    ]);
    expect(snapshot.sockets).toMatchObject({
      open: [{ leg: "twilio", runtimePath: "pstn-premium-realtime", provider: "twilio", count: 1 }],
      bufferedBytes: 160,
      inbound: { messages: 2, bytes: 320 },
    });
    expect(snapshot.database).toMatchObject({
      pool: { active: 6, idle: 3, waiting: 1, limit: 10 },
      lastOperation: {
        operation: "telephony_state_save",
        outcome: "success",
        queryDurationMs: 12,
        transactionDurationMs: 18,
        advisoryLockWaitMs: 4,
        poolAcquisitionWaitMs: 3,
        rowLockWaitMs: 5,
        deadlockCount: 1,
        retryCount: 2,
      },
    });
    expect(snapshot.queues).toEqual([
      {
        queue: "provider_output",
        bytes: 96,
        items: 2,
        byteLimit: 256,
        itemLimit: 8,
        drops: 2,
        aggregateUtilization: 0.375,
        peakCallUtilization: 0.375,
        utilization: 0.375,
        status: "healthy",
      },
    ]);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("call-secret");
    expect(serialized).not.toContain("stream-secret");
    expect(metricPoints).toContainEqual(expect.objectContaining({
      name: "zara.pstn.queue.drops",
      value: 2,
      attributes: { queue: "provider_output", outcome: "overflow" },
    }));
    expect(metricPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "zara.pstn.database.pool_acquisition_wait",
        value: 3,
      }),
      expect.objectContaining({
        name: "zara.pstn.database.row_lock_wait",
        value: 5,
      }),
      expect.objectContaining({
        name: "zara.pstn.database.deadlocks",
        value: 1,
      }),
      expect.objectContaining({
        name: "zara.pstn.database.retries",
        value: 2,
      }),
    ]));

    const allowedAttributeKeys = new Set([
      "runtime_path",
      "provider",
      "state",
      "leg",
      "direction",
      "outcome",
      "queue",
      "operation",
      "close_initiator",
      "close_code_class",
    ]);
    for (const point of metricPoints) {
      expect(Object.keys(point.attributes).every((key) => allowedAttributeKeys.has(key))).toBe(true);
    }
  });

  it("keeps the worst per-call queue posture when aggregate spare capacity would hide it", () => {
    const recorder = createRecorder();
    recorder.recordQueue({
      callId: "call-full",
      queue: "twilio_playback",
      bytes: 100,
      items: 10,
      byteLimit: 100,
      itemLimit: 10,
    });
    recorder.recordQueue({
      callId: "call-empty",
      queue: "twilio_playback",
      bytes: 0,
      items: 0,
      byteLimit: 900,
      itemLimit: 90,
    });

    expect(recorder.getSnapshot().queues).toEqual([
      expect.objectContaining({
        queue: "twilio_playback",
        bytes: 100,
        byteLimit: 1_000,
        aggregateUtilization: 0.1,
        peakCallUtilization: 1,
        utilization: 1,
        status: "exhausted",
      }),
    ]);
  });

  it("reports websocket traffic rates for the latest sample window instead of process lifetime", () => {
    let clockMs = 0;
    const recorder = new PstnCapacityRecorder({
      config: {
        maxConcurrentCalls: 20,
        cpuLimitMillicores: 2_000,
        memoryLimitBytes: 1_073_741_824,
        fileDescriptorLimit: 4_096,
        databasePoolMax: 10,
        eventLoopDelayLimitMs: 50,
      },
      clockMs: () => clockMs,
      processSampler: { sample: () => fixedProcessSample, dispose: vi.fn() },
      metricSink: { emit: vi.fn() },
    });
    recorder.openSocket({
      socketId: "socket-rate",
      leg: "twilio",
      runtimePath: "pstn-premium-realtime",
      provider: "twilio",
    });
    recorder.recordSocketTraffic({
      socketId: "socket-rate",
      direction: "inbound",
      messageCount: 1,
      byteCount: 100,
    });
    clockMs = 1_000;
    expect(recorder.getSnapshot().sockets.inbound).toMatchObject({
      messagesPerSecond: 1,
      bytesPerSecond: 100,
    });

    recorder.recordSocketTraffic({
      socketId: "socket-rate",
      direction: "inbound",
      messageCount: 1,
      byteCount: 50,
    });
    clockMs = 2_000;
    expect(recorder.getSnapshot().sockets.inbound).toMatchObject({
      messages: 2,
      bytes: 150,
      messagesPerSecond: 1,
      bytesPerSecond: 50,
    });
  });

  it("emits bounded finalization outcomes without call identifiers", () => {
    const points: Array<{
      name: string;
      attributes: Record<string, string>;
    }> = [];
    const recorder = new PstnCapacityRecorder({
      config: {
        maxConcurrentCalls: 20,
        cpuLimitMillicores: 2_000,
        memoryLimitBytes: 1_073_741_824,
        fileDescriptorLimit: 4_096,
        databasePoolMax: 10,
        eventLoopDelayLimitMs: 50,
      },
      processSampler: { sample: () => fixedProcessSample, dispose: vi.fn() },
      metricSink: {
        emit(point) {
          points.push({
            name: point.name,
            attributes: point.attributes,
          });
        },
      },
    });

    recorder.recordFinalization({
      source: "worker",
      outcome: "retry_scheduled",
    });
    recorder.recordFinalization({
      source: "lease_reconciler",
      outcome: "reconciled",
    });

    expect(points).toEqual([
      {
        name: "zara.pstn.finalization.operations",
        attributes: {
          source: "worker",
          outcome: "retry_scheduled",
        },
      },
      {
        name: "zara.pstn.finalization.operations",
        attributes: {
          source: "lease_reconciler",
          outcome: "reconciled",
        },
      },
    ]);
  });

  it("emits recovery risk metrics without tenant or call identifiers", () => {
    const points: Array<{
      name: string;
      kind: string;
      value: number;
      attributes: Record<string, string>;
    }> = [];
    const recorder = new PstnCapacityRecorder({
      config: {
        maxConcurrentCalls: 20,
        cpuLimitMillicores: 2_000,
        memoryLimitBytes: 1_073_741_824,
        fileDescriptorLimit: 4_096,
        databasePoolMax: 10,
        eventLoopDelayLimitMs: 50,
      },
      processSampler: { sample: () => fixedProcessSample, dispose: vi.fn() },
      metricSink: {
        emit(point) {
          points.push(point);
        },
      },
    });

    recorder.recordForcedDrain({ forcedCallCount: 3 });
    recorder.recordPendingRelease({
      delta: 1,
      runtimePath: "pstn-premium-realtime",
      provider: "twilio",
    });
    recorder.recordPendingRelease({
      delta: -1,
      runtimePath: "pstn-premium-realtime",
      provider: "twilio",
    });
    recorder.recordAdmissionPosture({
      trackedReservations: 2,
      pendingReleases: 1,
    });
    recorder.recordDuplicateClaim({ source: "media_socket" });

    expect(points).toEqual([
      {
        name: "zara.pstn.worker.forced_drain_terminations",
        kind: "counter",
        value: 3,
        attributes: {},
      },
      {
        name: "zara.pstn.admission.pending_releases",
        kind: "up_down_counter",
        value: 1,
        attributes: {
          runtime_path: "pstn-premium-realtime",
          provider: "twilio",
        },
      },
      {
        name: "zara.pstn.admission.pending_releases",
        kind: "up_down_counter",
        value: -1,
        attributes: {
          runtime_path: "pstn-premium-realtime",
          provider: "twilio",
        },
      },
      {
        name: "zara.pstn.admission.duplicate_claim_attempts",
        kind: "counter",
        value: 1,
        attributes: { source: "media_socket" },
      },
    ]);
    expect(recorder.getSnapshot().admission).toEqual({
      trackedReservations: 2,
      pendingReleases: 1,
    });
  });

  it("periodically samples process pressure without requiring a staff API read", async () => {
    vi.useFakeTimers();
    try {
      const sample = vi.fn(() => fixedProcessSample);
      const metricPoints: PstnCapacityMetricPoint[] = [];
      const recorder = new PstnCapacityRecorder({
        config: {
          maxConcurrentCalls: 20,
          cpuLimitMillicores: 2_000,
          memoryLimitBytes: 1_073_741_824,
          fileDescriptorLimit: 4_096,
          databasePoolMax: 10,
          eventLoopDelayLimitMs: 50,
        },
        processSampler: { sample, dispose: vi.fn() },
        metricSink: { emit: (point) => metricPoints.push(point) },
      });

      recorder.startPeriodicSampling(1_000);
      expect(sample).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(sample).toHaveBeenCalledTimes(3);
      expect(metricPoints).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "zara.pstn.process.event_loop_delay_p99" }),
        expect.objectContaining({ name: "zara.pstn.envelope.max_concurrent_calls", value: 20 }),
      ]));

      recorder.dispose();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sample).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks unavailable process and database samples instead of reporting healthy zeroes", () => {
    const recorder = new PstnCapacityRecorder({
      processSampler: { sample: () => null, dispose: vi.fn() },
      metricSink: { emit: vi.fn() },
    });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.process).toBeNull();
    expect(snapshot.resources.cpu).toMatchObject({ available: false, status: null });
    expect(snapshot.resources.fileDescriptors).toMatchObject({ available: false, status: null });
    expect(snapshot.resources.database).toMatchObject({ available: false, status: null });
    expect(snapshot.database).toMatchObject({ observed: false, lastOperation: null });
  });

  it("classifies websocket close codes by their actual failure domain", () => {
    const metricPoints: PstnCapacityMetricPoint[] = [];
    const recorder = createRecorder(metricPoints);
    for (const [socketId, code] of [["auth", 4_401], ["internal", 1_011]] as const) {
      recorder.openSocket({
        socketId,
        leg: "provider",
        runtimePath: "pstn-premium-realtime",
        provider: "openai-realtime",
      });
      recorder.closeSocket({ socketId, initiator: "remote", code });
    }

    expect(metricPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "zara.pstn.socket.closes",
        attributes: expect.objectContaining({ close_code_class: "authorization" }),
      }),
      expect.objectContaining({
        name: "zara.pstn.socket.closes",
        attributes: expect.objectContaining({ close_code_class: "internal" }),
      }),
    ]));
  });

  it("removes terminal calls and queues idempotently while retaining aggregate failure counts", () => {
    const recorder = createRecorder();
    recorder.trackCall({
      callId: "call-1",
      state: "active",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    });
    recorder.recordQueue({
      callId: "call-1",
      queue: "twilio_playback",
      bytes: 80,
      items: 1,
      byteLimit: 100,
      itemLimit: 10,
    });

    recorder.endCall({ callId: "call-1", outcome: "failed" });
    recorder.endCall({ callId: "call-1", outcome: "failed" });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.calls.active).toBe(0);
    expect(snapshot.calls.terminal).toEqual({ completed: 0, failed: 1 });
    expect(snapshot.queues).toEqual([]);
  });

  it("keeps capacity recording nonfatal when the metric exporter is unavailable", () => {
    const recorder = new PstnCapacityRecorder({
      config: {
        maxConcurrentCalls: 20,
        cpuLimitMillicores: 1_000,
        memoryLimitBytes: 1_000,
        fileDescriptorLimit: 100,
        databasePoolMax: 10,
        eventLoopDelayLimitMs: 100,
      },
      processSampler: {
        sample: () => fixedProcessSample,
        dispose: vi.fn(),
      },
      metricSink: {
        emit() {
          throw new Error("collector unavailable");
        },
      },
    });

    expect(() => recorder.trackCall({
      callId: "call-exporter-failure",
      state: "active",
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
    })).not.toThrow();
    const snapshot = recorder.getSnapshot();
    expect(snapshot.calls.active).toBe(1);
    expect(snapshot.telemetry.metricExportFailureCount).toBeGreaterThan(0);
  });
});
