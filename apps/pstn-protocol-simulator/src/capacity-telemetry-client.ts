import type { CapacityTelemetrySample } from "./load-runner";

export class CapacityTelemetryClient {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: {
    endpoint: string;
    bearerToken?: string | undefined;
    cookie?: string | undefined;
    timeoutMs?: number | undefined;
    fetch?: typeof fetch | undefined;
  }) {
    this.fetch = options.fetch ?? fetch;
  }

  async read(): Promise<CapacityTelemetrySample> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.options.bearerToken !== undefined) headers.authorization = `Bearer ${this.options.bearerToken}`;
    if (this.options.cookie !== undefined) headers.cookie = this.options.cookie;
    const response = await this.fetch(this.options.endpoint, {
      headers,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
    });
    if (!response.ok) throw new Error(`Capacity telemetry request failed with HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    const posture = readPosture(payload);
    if (!isCapacityTelemetrySample(posture)) {
      throw new Error("Capacity telemetry response contained an invalid capacity posture.");
    }
    return posture;
  }
}

function readPosture(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.aiObservability)) return undefined;
  return payload.aiObservability.pstnCapacity;
}

function isCapacityTelemetrySample(value: unknown): value is CapacityTelemetrySample {
  if (!isRecord(value) || !isRecord(value.envelope) || !isRecord(value.resources)) return false;
  if (
    !isRecord(value.calls)
    || !isRecord(value.admission)
    || !isRecord(value.sockets)
    || !isRecord(value.telemetry)
  ) return false;
  const resources = value.resources;
  const resourceNames = ["calls", "cpu", "eventLoop", "memory", "database", "fileDescriptors", "queues"];
  return typeof value.capturedAt === "string"
    && Number.isFinite(Date.parse(value.capturedAt))
    && ["healthy", "warning", "critical", "exhausted"].includes(String(value.status))
    && resourceNames.every((name) => isResourcePosture(resources[name]))
    && capacityEnvelopeIsValid(value.envelope)
    && isFiniteField(value.calls, "active")
    && isFiniteField(value.admission, "trackedReservations")
    && isFiniteField(value.admission, "pendingReleases")
    && typeof value.sockets.bufferedBytes === "number"
    && Number.isFinite(value.sockets.bufferedBytes)
    && Array.isArray(value.sockets.open)
    && value.sockets.open.every((socket) =>
      isRecord(socket) && typeof socket.leg === "string" && isFiniteField(socket, "count"))
    && Array.isArray(value.queues)
    && value.queues.every((queue) => isRecord(queue)
      && typeof queue.queue === "string"
      && ["bytes", "items", "drops"].every((field) => isFiniteField(queue, field)))
    && (value.process === null || (isRecord(value.process) && isFiniteField(value.process, "rssBytes")))
    && isFiniteField(value.telemetry, "metricExportFailureCount");
}

function capacityEnvelopeIsValid(value: Record<string, unknown>) {
  return [
    "maxConcurrentCalls",
    "cpuLimitMillicores",
    "memoryLimitBytes",
    "fileDescriptorLimit",
    "databasePoolMax",
    "eventLoopDelayLimitMs",
    "expectedWebSocketLegsPerPremiumCall",
  ].every((field) => isFiniteField(value, field)) && typeof value.certified === "boolean";
}

function isResourcePosture(value: unknown) {
  if (!isRecord(value) || typeof value.available !== "boolean") return false;
  return isFiniteField(value, "limit")
    && (value.used === null || isFiniteField(value, "used"))
    && (value.utilization === null || isFiniteField(value, "utilization"))
    && (value.status === null || ["healthy", "warning", "critical", "exhausted"].includes(String(value.status)));
}

function isFiniteField(value: Record<string, unknown>, field: string) {
  return typeof value[field] === "number" && Number.isFinite(value[field]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
