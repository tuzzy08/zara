export interface PstnRealtimeWorkerResourceCeilings {
  cpuUtilizationPercent: number;
  memoryUtilizationPercent: number;
  memoryBytes: number;
  eventLoopLagMs: number;
  openFileDescriptors: number;
  openWebSockets: number;
}

export interface PstnRealtimeWorkerConfig {
  workerId: string;
  releaseId: string;
  mediaStreamBaseUrl: string;
  port: number;
  heartbeatIntervalMs: number;
  heartbeatTtlMs: number;
  drainTimeoutMs: number;
  maxCalls: number;
  supportedProviders: readonly PstnRealtimeWorkerProvider[];
  resourceCeilings: PstnRealtimeWorkerResourceCeilings;
}

export function resolvePstnRealtimeWorkerConfig(
  env: Record<string, string | undefined>,
): PstnRealtimeWorkerConfig {
  const workerId = readIdentifier(env, "PSTN_WORKER_ID");
  const releaseId = readIdentifier(env, "PSTN_WORKER_RELEASE_ID");
  const port = readInteger(env, "PORT", 1, 65_535);
  const heartbeatIntervalMs = readInteger(
    env,
    "PSTN_WORKER_HEARTBEAT_INTERVAL_MS",
    250,
    30_000,
  );
  const heartbeatTtlMs = readInteger(
    env,
    "PSTN_WORKER_HEARTBEAT_TTL_MS",
    1_000,
    60_000,
  );
  if (heartbeatIntervalMs * 2 >= heartbeatTtlMs) {
    throw invalidConfig(
      "heartbeat interval must be less than half the TTL.",
    );
  }

  return {
    workerId,
    releaseId,
    mediaStreamBaseUrl: readMediaStreamBaseUrl(env),
    port,
    heartbeatIntervalMs,
    heartbeatTtlMs,
    drainTimeoutMs: readInteger(
      env,
      "PSTN_WORKER_DRAIN_TIMEOUT_MS",
      1_000,
      3_600_000,
    ),
    maxCalls: readInteger(env, "PSTN_WORKER_MAX_CALLS", 1, 100_000),
    supportedProviders: resolveSupportedProviders(env),
    resourceCeilings: {
      cpuUtilizationPercent: readNumber(
        env,
        "PSTN_WORKER_MAX_CPU_PERCENT",
        1,
        100,
      ),
      memoryUtilizationPercent: readNumber(
        env,
        "PSTN_WORKER_MAX_MEMORY_PERCENT",
        1,
        100,
      ),
      memoryBytes: readInteger(
        env,
        "PSTN_WORKER_MAX_MEMORY_BYTES",
        64 * 1_024 * 1_024,
        1_099_511_627_776,
      ),
      eventLoopLagMs: readNumber(
        env,
        "PSTN_WORKER_MAX_EVENT_LOOP_LAG_MS",
        1,
        60_000,
      ),
      openFileDescriptors: readInteger(
        env,
        "PSTN_WORKER_MAX_OPEN_FILE_DESCRIPTORS",
        1,
        1_000_000,
      ),
      openWebSockets: readInteger(
        env,
        "PSTN_WORKER_MAX_WEBSOCKETS",
        1,
        1_000_000,
      ),
    },
  };
}

function readMediaStreamBaseUrl(
  env: Record<string, string | undefined>,
) {
  const raw = env.PSTN_WORKER_PUBLIC_MEDIA_URL?.trim();
  const normalized =
    normalizePstnRealtimeWorkerMediaStreamBaseUrl(raw);
  if (normalized === undefined) {
    throw invalidConfig(
      "PSTN_WORKER_PUBLIC_MEDIA_URL must be a queryless wss URL, or a loopback ws URL for local execution.",
    );
  }
  return normalized;
}

function resolveSupportedProviders(
  env: Record<string, string | undefined>,
): readonly PstnRealtimeWorkerProvider[] {
  const transport = env.ZARA_PREMIUM_REALTIME_TRANSPORT?.trim() || "live";
  if (transport === "simulator") {
    return ["openai-realtime", "gemini-live"];
  }
  if (transport !== "live") {
    throw invalidConfig(
      "ZARA_PREMIUM_REALTIME_TRANSPORT must be 'live' or 'simulator'.",
    );
  }

  const supported: PstnRealtimeWorkerProvider[] = [];
  if ((env.OPENAI_API_KEY?.trim() ?? "").length > 0) {
    supported.push("openai-realtime");
  }
  if ((env.GEMINI_API_KEY?.trim() ?? "").length > 0) {
    supported.push("gemini-live");
  }
  if (supported.length === 0) {
    throw invalidConfig(
      "at least one premium provider credential is required.",
    );
  }
  return supported;
}

function readIdentifier(
  env: Record<string, string | undefined>,
  name: string,
) {
  const value = env[name];
  const valid = name === "PSTN_WORKER_ID"
    ? isPstnRealtimeWorkerId(value)
    : isPstnRealtimeWorkerReleaseId(value);
  if (!valid || typeof value !== "string") {
    throw invalidConfig(`${name} must be an explicit bounded identifier.`);
  }
  return value;
}

function readInteger(
  env: Record<string, string | undefined>,
  name: string,
  minimum: number,
  maximum: number,
) {
  const value = readNumber(env, name, minimum, maximum);
  if (!Number.isSafeInteger(value)) {
    throw invalidConfig(`${name} must be an integer.`);
  }
  return value;
}

function readNumber(
  env: Record<string, string | undefined>,
  name: string,
  minimum: number,
  maximum: number,
) {
  const raw = env[name];
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidConfig(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function invalidConfig(detail: string) {
  return new Error(`Invalid PSTN realtime worker configuration: ${detail}`);
}
import type { PstnRealtimeWorkerProvider } from "./pstn-realtime-worker-registry";
import {
  isPstnRealtimeWorkerId,
  isPstnRealtimeWorkerReleaseId,
  normalizePstnRealtimeWorkerMediaStreamBaseUrl,
} from "../telephony/pstn-realtime-worker-routing-contract";
