import { Buffer } from "node:buffer";

import {
  isPstnRealtimeWorkerId,
  isPstnRealtimeWorkerMediaStreamBaseUrl,
  isPstnRealtimeWorkerReleaseId,
} from "../telephony/pstn-realtime-worker-routing-contract";

export type PstnRealtimeWorkerState = "starting" | "ready" | "draining";
export type PstnRealtimeWorkerProvider =
  | "openai-realtime"
  | "gemini-live";

export interface PstnRealtimeWorkerResourcePosture {
  cpuUtilizationPercent: number;
  memoryUtilizationPercent: number;
  eventLoopLagMs: number;
  openFileDescriptors: number;
  maxFileDescriptors: number;
  openWebSockets: number;
  maxWebSockets: number;
}

export interface PstnRealtimeWorkerHeartbeat {
  workerId: string;
  releaseId: string;
  mediaStreamBaseUrl: string;
  state: PstnRealtimeWorkerState;
  supportedProviders: readonly PstnRealtimeWorkerProvider[];
  activeCalls: number;
  startingCalls: number;
  availableSlots: number;
  resources: PstnRealtimeWorkerResourcePosture;
  lastSuccessfulRedisCheckAt: string;
  lastSuccessfulPostgresCheckAt: string;
}

export interface PstnRealtimeWorkerRegistryRedisCommands {
  eval(
    script: string,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<unknown>;
}

export interface PstnRealtimeWorkerRegistryOptions {
  heartbeatTtlMs?: number;
  keyPrefix?: string;
}

const providers = ["openai-realtime", "gemini-live"] as const;
const states = ["starting", "ready", "draining"] as const;
const maxRegistryRecords = 256;
const minHeartbeatTtlMs = 1_000;
const maxHeartbeatTtlMs = 60_000;
const maxCount = 100_000;
const maxResourceCount = 1_000_000;
const maxHeartbeatBytes = 4_096;
const defaultHeartbeatTtlMs = 15_000;

const publishHeartbeatScript = `
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local expiresAt = now + tonumber(ARGV[2])

redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
redis.call("ZREM", KEYS[2], KEYS[1])
redis.call("ZREM", KEYS[3], KEYS[1])

if ARGV[3] == "ready" then
  if ARGV[4] == "1" then
    redis.call("ZADD", KEYS[2], expiresAt, KEYS[1])
  end
  if ARGV[5] == "1" then
    redis.call("ZADD", KEYS[3], expiresAt, KEYS[1])
  end
end

return "published"
`;

const readReadyWorkersScript = `
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)

local workerKeys = redis.call(
  "ZRANGEBYSCORE",
  KEYS[1],
  "(" .. tostring(now),
  "+inf",
  "LIMIT",
  0,
  tonumber(ARGV[1])
)
local heartbeats = {}
for _, workerKey in ipairs(workerKeys) do
  local heartbeat = redis.call("GET", workerKey)
  if heartbeat == false then
    redis.call("ZREM", KEYS[1], workerKey)
  else
    table.insert(heartbeats, heartbeat)
  end
end
return heartbeats
`;

export class PstnRealtimeWorkerRegistry {
  private readonly heartbeatTtlMs: number;
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: PstnRealtimeWorkerRegistryRedisCommands,
    options: PstnRealtimeWorkerRegistryOptions,
  ) {
    const heartbeatTtlMs =
      options.heartbeatTtlMs ?? defaultHeartbeatTtlMs;
    if (
      !Number.isInteger(heartbeatTtlMs)
      || heartbeatTtlMs < minHeartbeatTtlMs
      || heartbeatTtlMs > maxHeartbeatTtlMs
    ) {
      throw new Error(
        `PSTN realtime worker heartbeat TTL must be an integer between ${minHeartbeatTtlMs} and ${maxHeartbeatTtlMs} milliseconds.`,
      );
    }
    const keyPrefix = options.keyPrefix ?? "zara:pstn:realtime-workers:v1";
    if (
      !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(keyPrefix)
      || keyPrefix.endsWith(":")
    ) {
      throw new Error("Invalid PSTN realtime worker registry key prefix.");
    }
    this.heartbeatTtlMs = heartbeatTtlMs;
    this.keyPrefix = keyPrefix;
  }

  async publish(input: PstnRealtimeWorkerHeartbeat): Promise<void> {
    const heartbeat = parseHeartbeat(input);
    const payload = JSON.stringify(heartbeat);
    if (Buffer.byteLength(payload, "utf8") > maxHeartbeatBytes) {
      throw invalidHeartbeat();
    }

    const result = await this.redis.eval(
      publishHeartbeatScript,
      [
        this.workerKey(heartbeat.workerId),
        this.providerIndexKey("openai-realtime"),
        this.providerIndexKey("gemini-live"),
      ],
      [
        payload,
        String(this.heartbeatTtlMs),
        heartbeat.state,
        heartbeat.supportedProviders.includes("openai-realtime") ? "1" : "0",
        heartbeat.supportedProviders.includes("gemini-live") ? "1" : "0",
      ],
    );
    if (result !== "published") {
      throw new Error("PSTN realtime worker heartbeat publish failed.");
    }
  }

  async findReadyWorkers(
    provider: PstnRealtimeWorkerProvider,
  ): Promise<readonly PstnRealtimeWorkerHeartbeat[]> {
    if (!isProvider(provider)) {
      throw new Error("Invalid PSTN realtime worker provider.");
    }
    const result = await this.redis.eval(
      readReadyWorkersScript,
      [this.providerIndexKey(provider)],
      [String(maxRegistryRecords + 1)],
    );
    if (!Array.isArray(result)) {
      throw new Error("Invalid PSTN realtime worker registry response.");
    }
    if (result.length > maxRegistryRecords) {
      throw new Error(
        `PSTN realtime worker registry result exceeds ${maxRegistryRecords} records.`,
      );
    }

    const workers = new Map<string, PstnRealtimeWorkerHeartbeat>();
    for (const value of result) {
      if (typeof value !== "string") {
        continue;
      }
      try {
        const heartbeat = parseHeartbeat(JSON.parse(value));
        if (
          heartbeat.state === "ready"
          && heartbeat.supportedProviders.includes(provider)
        ) {
          workers.set(heartbeat.workerId, heartbeat);
        }
      } catch {
        // Corrupt or stale registry data is not eligible for call admission.
      }
    }
    return [...workers.values()];
  }

  private workerKey(workerId: string) {
    return `${this.keyPrefix}:worker:${Buffer.from(workerId, "utf8").toString("base64url")}`;
  }

  private providerIndexKey(provider: PstnRealtimeWorkerProvider) {
    return `${this.keyPrefix}:ready:${provider}`;
  }
}

function parseHeartbeat(value: unknown): PstnRealtimeWorkerHeartbeat {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "activeCalls",
      "availableSlots",
      "lastSuccessfulPostgresCheckAt",
      "lastSuccessfulRedisCheckAt",
      "mediaStreamBaseUrl",
      "releaseId",
      "resources",
      "startingCalls",
      "state",
      "supportedProviders",
      "workerId",
    ])
    || !isPstnRealtimeWorkerId(value.workerId)
    || !isPstnRealtimeWorkerReleaseId(value.releaseId)
    || !isPstnRealtimeWorkerMediaStreamBaseUrl(value.mediaStreamBaseUrl)
    || !isState(value.state)
    || !isProviderList(value.supportedProviders)
    || !isBoundedInteger(value.activeCalls, maxCount)
    || !isBoundedInteger(value.startingCalls, maxCount)
    || !isBoundedInteger(value.availableSlots, maxCount)
    || !isResourcePosture(value.resources)
    || !isCanonicalTimestamp(value.lastSuccessfulRedisCheckAt)
    || !isCanonicalTimestamp(value.lastSuccessfulPostgresCheckAt)
  ) {
    throw invalidHeartbeat();
  }

  return {
    workerId: value.workerId,
    releaseId: value.releaseId,
    mediaStreamBaseUrl: value.mediaStreamBaseUrl,
    state: value.state,
    supportedProviders: [...value.supportedProviders],
    activeCalls: value.activeCalls,
    startingCalls: value.startingCalls,
    availableSlots: value.availableSlots,
    resources: {
      cpuUtilizationPercent: value.resources.cpuUtilizationPercent,
      memoryUtilizationPercent: value.resources.memoryUtilizationPercent,
      eventLoopLagMs: value.resources.eventLoopLagMs,
      openFileDescriptors: value.resources.openFileDescriptors,
      maxFileDescriptors: value.resources.maxFileDescriptors,
      openWebSockets: value.resources.openWebSockets,
      maxWebSockets: value.resources.maxWebSockets,
    },
    lastSuccessfulRedisCheckAt: value.lastSuccessfulRedisCheckAt,
    lastSuccessfulPostgresCheckAt: value.lastSuccessfulPostgresCheckAt,
  };
}

function isResourcePosture(
  value: unknown,
): value is PstnRealtimeWorkerResourcePosture {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "cpuUtilizationPercent",
      "eventLoopLagMs",
      "maxFileDescriptors",
      "maxWebSockets",
      "memoryUtilizationPercent",
      "openFileDescriptors",
      "openWebSockets",
    ])
    || !isPercentage(value.cpuUtilizationPercent)
    || !isPercentage(value.memoryUtilizationPercent)
    || !isFiniteNumber(value.eventLoopLagMs, 60_000)
    || !isBoundedInteger(value.openFileDescriptors, maxResourceCount)
    || !isBoundedInteger(value.maxFileDescriptors, maxResourceCount, 1)
    || value.openFileDescriptors > value.maxFileDescriptors
    || !isBoundedInteger(value.openWebSockets, maxResourceCount)
    || !isBoundedInteger(value.maxWebSockets, maxResourceCount, 1)
    || value.openWebSockets > value.maxWebSockets
  ) {
    return false;
  }
  return true;
}

function isProviderList(
  value: unknown,
): value is readonly PstnRealtimeWorkerProvider[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= providers.length
    && value.every(isProvider)
    && new Set(value).size === value.length;
}

function isProvider(value: unknown): value is PstnRealtimeWorkerProvider {
  return typeof value === "string"
    && providers.includes(value as PstnRealtimeWorkerProvider);
}

function isState(value: unknown): value is PstnRealtimeWorkerState {
  return typeof value === "string"
    && states.includes(value as PstnRealtimeWorkerState);
}

function isBoundedInteger(
  value: unknown,
  maximum: number,
  minimum = 0,
): value is number {
  return Number.isInteger(value)
    && (value as number) >= minimum
    && (value as number) <= maximum;
}

function isPercentage(value: unknown): value is number {
  return isFiniteNumber(value, 100);
}

function isFiniteNumber(value: unknown, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= maximum;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
) {
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index]);
}

function invalidHeartbeat() {
  return new Error("Invalid PSTN realtime worker heartbeat.");
}
