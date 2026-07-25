import type { FactoryProvider } from "@nestjs/common";

import {
  isPstnRealtimeWorkerId,
  isPstnRealtimeWorkerMediaStreamBaseUrl,
  isPstnRealtimeWorkerReleaseId,
} from "../telephony/pstn-realtime-worker-routing-contract";
import {
  PstnRealtimeWorkerRegistry,
  type PstnRealtimeWorkerHeartbeat,
  type PstnRealtimeWorkerProvider,
} from "./pstn-realtime-worker-registry";

export interface PstnPremiumWorkerSelection {
  status: "available";
  providers: readonly PstnRealtimeWorkerProvider[];
  worker: {
    workerId: string;
    releaseId: string;
    mediaStreamBaseUrl: string;
    availableSlots: number;
    activeCalls: number;
    startingCalls: number;
  };
}

export interface PstnPremiumWorkerUnavailable {
  status: "unavailable";
  providers: readonly string[];
  reason:
    | "invalid_provider"
    | "no_ready_worker"
    | "registry_unavailable";
}

export type PstnPremiumWorkerAvailabilityResult =
  | PstnPremiumWorkerSelection
  | PstnPremiumWorkerUnavailable;

export interface PstnPremiumWorkerAvailability {
  select(
    providers: readonly PstnRealtimeWorkerProvider[],
    excludedWorkerIds?: readonly string[],
  ): Promise<PstnPremiumWorkerAvailabilityResult>;
}

export const PSTN_PREMIUM_WORKER_AVAILABILITY = Symbol(
  "PSTN_PREMIUM_WORKER_AVAILABILITY",
);

interface PstnRealtimeWorkerRegistryReader {
  findReadyWorkers(
    provider: PstnRealtimeWorkerProvider,
  ): Promise<readonly PstnRealtimeWorkerHeartbeat[]>;
}

const premiumProviders = ["openai-realtime", "gemini-live"] as const;
const heartbeatKeys = [
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
] as const;
const resourceKeys = [
  "cpuUtilizationPercent",
  "eventLoopLagMs",
  "maxFileDescriptors",
  "maxWebSockets",
  "memoryUtilizationPercent",
  "openFileDescriptors",
  "openWebSockets",
] as const;
const maxCount = 100_000;
const maxResourceCount = 1_000_000;

export class PstnPremiumWorkerAvailabilityService
  implements PstnPremiumWorkerAvailability
{
  constructor(private readonly registry: PstnRealtimeWorkerRegistryReader) {}

  async select(
    providers: readonly PstnRealtimeWorkerProvider[],
    excludedWorkerIds: readonly string[] = [],
  ): Promise<PstnPremiumWorkerAvailabilityResult> {
    if (!isProviderList(providers)) {
      return {
        status: "unavailable",
        providers,
        reason: "invalid_provider",
      };
    }

    let heartbeats: readonly PstnRealtimeWorkerHeartbeat[];
    try {
      heartbeats = await this.registry.findReadyWorkers(providers[0]!);
    } catch {
      return {
        status: "unavailable",
        providers,
        reason: "registry_unavailable",
      };
    }

    const excludedWorkers = new Set(excludedWorkerIds);
    const selected = heartbeats
      .filter(
        (heartbeat) =>
          isEligibleHeartbeat(heartbeat, providers)
          && !excludedWorkers.has(heartbeat.workerId),
      )
      .sort(compareWorkers)[0];
    if (selected === undefined) {
      return {
        status: "unavailable",
        providers,
        reason: "no_ready_worker",
      };
    }
    return {
      status: "available",
      providers,
      worker: {
        workerId: selected.workerId,
        releaseId: selected.releaseId,
        mediaStreamBaseUrl: selected.mediaStreamBaseUrl,
        availableSlots: selected.availableSlots,
        activeCalls: selected.activeCalls,
        startingCalls: selected.startingCalls,
      },
    };
  }
}

export function createPstnPremiumWorkerAvailabilityProvider():
  FactoryProvider<PstnPremiumWorkerAvailability> {
  return {
    provide: PSTN_PREMIUM_WORKER_AVAILABILITY,
    inject: [PstnRealtimeWorkerRegistry],
    useFactory: (registry: PstnRealtimeWorkerRegistry | undefined) =>
      new PstnPremiumWorkerAvailabilityService(
        registry ?? unavailableRegistry,
      ),
  };
}

const unavailableRegistry: PstnRealtimeWorkerRegistryReader = {
  async findReadyWorkers() {
    throw new Error("PSTN realtime worker registry is unavailable.");
  },
};

function isEligibleHeartbeat(
  value: unknown,
  providers: readonly PstnRealtimeWorkerProvider[],
): value is PstnRealtimeWorkerHeartbeat {
  if (
    !isRecord(value)
    || !hasExactKeys(value, heartbeatKeys)
    || !isPstnRealtimeWorkerId(value.workerId)
    || !isPstnRealtimeWorkerReleaseId(value.releaseId)
    || !isPstnRealtimeWorkerMediaStreamBaseUrl(value.mediaStreamBaseUrl)
    || value.state !== "ready"
    || !supportsAllProviders(value.supportedProviders, providers)
    || !isBoundedInteger(value.activeCalls, 0, maxCount)
    || !isBoundedInteger(value.startingCalls, 0, maxCount)
    || !isBoundedInteger(value.availableSlots, 1, maxCount)
    || !isBoundedResourcePosture(value.resources)
    || !isCanonicalTimestamp(value.lastSuccessfulRedisCheckAt)
    || !isCanonicalTimestamp(value.lastSuccessfulPostgresCheckAt)
  ) {
    return false;
  }
  return true;
}

function isBoundedResourcePosture(value: unknown) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, resourceKeys)
    || !isBoundedNumber(value.cpuUtilizationPercent, 0, 100)
    || !isBoundedNumber(value.memoryUtilizationPercent, 0, 100)
    || !isBoundedNumber(value.eventLoopLagMs, 0, 60_000)
    || !isBoundedInteger(
      value.openFileDescriptors,
      0,
      maxResourceCount,
    )
    || !isBoundedInteger(
      value.maxFileDescriptors,
      1,
      maxResourceCount,
    )
    || value.openFileDescriptors > value.maxFileDescriptors
    || !isBoundedInteger(value.openWebSockets, 0, maxResourceCount)
    || !isBoundedInteger(value.maxWebSockets, 1, maxResourceCount)
    || value.openWebSockets > value.maxWebSockets
  ) {
    return false;
  }
  return true;
}

function compareWorkers(
  left: PstnRealtimeWorkerHeartbeat,
  right: PstnRealtimeWorkerHeartbeat,
) {
  const slots = right.availableSlots - left.availableSlots;
  if (slots !== 0) {
    return slots;
  }
  const load = left.activeCalls + left.startingCalls
    - right.activeCalls - right.startingCalls;
  if (load !== 0) {
    return load;
  }
  return left.workerId < right.workerId
    ? -1
    : left.workerId > right.workerId ? 1 : 0;
}

function isPremiumProvider(
  value: unknown,
): value is PstnRealtimeWorkerProvider {
  return typeof value === "string"
    && premiumProviders.includes(value as PstnRealtimeWorkerProvider);
}

function isProviderList(
  value: unknown,
): value is readonly PstnRealtimeWorkerProvider[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= premiumProviders.length
    && value.every(isPremiumProvider)
    && new Set(value).size === value.length;
}

function supportsAllProviders(
  supportedProviders: unknown,
  requiredProviders: readonly PstnRealtimeWorkerProvider[],
) {
  return isProviderList(supportedProviders)
    && requiredProviders.every((provider) =>
      supportedProviders.includes(provider)
    );
}

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isInteger(value)
    && (value as number) >= minimum
    && (value as number) <= maximum;
}

function isBoundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function isCanonicalTimestamp(value: unknown) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime())
    && timestamp.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}
