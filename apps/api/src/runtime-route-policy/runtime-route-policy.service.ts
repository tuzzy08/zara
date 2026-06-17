import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";

import type {
  RuntimeRoutePolicy,
  UpdateRuntimeRoutePolicyInput,
} from "./runtime-route-policy.models";
import {
  defaultRuntimeRoutePolicy,
  runtimeRoutePolicyAnnouncementModes,
  runtimeRoutePolicyFallbackTargets,
  runtimeRoutePolicyReadinessModes,
} from "./runtime-route-policy.models";
import type { RuntimeRoutePolicyRepository } from "./runtime-route-policy.repository";

export const runtimeRoutePolicyRepositoryToken = Symbol("runtimeRoutePolicyRepository");

@Injectable()
export class RuntimeRoutePolicyService {
  constructor(
    @Inject(runtimeRoutePolicyRepositoryToken)
    private readonly repository: RuntimeRoutePolicyRepository,
  ) {}

  async getRoutePolicy(): Promise<RuntimeRoutePolicy> {
    return clonePolicy(await this.repository.load() ?? defaultRuntimeRoutePolicy);
  }

  async updateRoutePolicy(input: UpdateRuntimeRoutePolicyInput & { actorUserId: string; updatedAt?: string | undefined }) {
    const current = await this.getRoutePolicy();

    if (input.expectedVersion !== current.version) {
      throw new ConflictException("Runtime route policy has changed. Refresh before saving.");
    }

    const reason = input.reason.trim();

    if (reason.length === 0) {
      throw new BadRequestException("Runtime route policy updates require a reason.");
    }

    const next: RuntimeRoutePolicy = {
      ...current,
      version: current.version + 1,
      confidenceThreshold: input.confidenceThreshold === undefined
        ? current.confidenceThreshold
        : normalizeConfidenceThreshold(input.confidenceThreshold),
      readinessMode: input.readinessMode === undefined
        ? current.readinessMode
        : normalizeReadinessMode(input.readinessMode),
      maxClarificationTurns: input.maxClarificationTurns === undefined
        ? current.maxClarificationTurns
        : normalizeMaxClarificationTurns(input.maxClarificationTurns),
      announcementMode: input.announcementMode === undefined
        ? current.announcementMode
        : normalizeAnnouncementMode(input.announcementMode),
      fallbackTarget: input.fallbackTarget === undefined
        ? current.fallbackTarget
        : normalizeFallbackTarget(input.fallbackTarget),
      updatedBy: input.actorUserId,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };

    await this.repository.save(next);

    return {
      routePolicy: clonePolicy(next),
      changedKeys: getChangedKeys(input),
      reason,
    };
  }
}

function normalizeConfidenceThreshold(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new BadRequestException("Runtime route policy confidence threshold must be between 0 and 1.");
  }

  return value;
}

function normalizeReadinessMode(value: string) {
  if (!runtimeRoutePolicyReadinessModes.includes(value as never)) {
    throw new BadRequestException(`Runtime route policy readiness mode '${value}' is not supported.`);
  }

  return value as RuntimeRoutePolicy["readinessMode"];
}

function normalizeMaxClarificationTurns(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new BadRequestException("Runtime route policy max clarification turns must be an integer from 0 to 5.");
  }

  return value;
}

function normalizeAnnouncementMode(value: string) {
  if (!runtimeRoutePolicyAnnouncementModes.includes(value as never)) {
    throw new BadRequestException(`Runtime route policy announcement mode '${value}' is not supported.`);
  }

  return value as RuntimeRoutePolicy["announcementMode"];
}

function normalizeFallbackTarget(value: string) {
  if (!runtimeRoutePolicyFallbackTargets.includes(value as never)) {
    throw new BadRequestException(`Runtime route policy fallback target '${value}' is not supported.`);
  }

  return value as RuntimeRoutePolicy["fallbackTarget"];
}

function getChangedKeys(input: UpdateRuntimeRoutePolicyInput) {
  return [
    "confidenceThreshold",
    "readinessMode",
    "maxClarificationTurns",
    "announcementMode",
    "fallbackTarget",
  ].filter((key) => input[key as keyof UpdateRuntimeRoutePolicyInput] !== undefined);
}

function clonePolicy(policy: RuntimeRoutePolicy): RuntimeRoutePolicy {
  return {
    schemaVersion: policy.schemaVersion,
    version: policy.version,
    confidenceThreshold: policy.confidenceThreshold,
    readinessMode: policy.readinessMode,
    maxClarificationTurns: policy.maxClarificationTurns,
    announcementMode: policy.announcementMode,
    fallbackTarget: policy.fallbackTarget,
    updatedBy: policy.updatedBy,
    updatedAt: policy.updatedAt,
  };
}
