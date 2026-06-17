import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RuntimeRoutePolicy } from "./runtime-route-policy.models";

export interface RuntimeRoutePolicyRepository {
  load(): Promise<RuntimeRoutePolicy | null>;
  save(policy: RuntimeRoutePolicy): Promise<void>;
}

export class InMemoryRuntimeRoutePolicyRepository implements RuntimeRoutePolicyRepository {
  private policy: RuntimeRoutePolicy | null = null;

  async load() {
    return this.policy === null ? null : clonePolicy(this.policy);
  }

  async save(policy: RuntimeRoutePolicy) {
    this.policy = clonePolicy(policy);
  }
}

export class FileRuntimeRoutePolicyRepository implements RuntimeRoutePolicyRepository {
  private readonly filePath: string;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, "route-policy.json");
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeStoredPolicy(JSON.parse(raw));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async save(policy: RuntimeRoutePolicy) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}

function normalizeStoredPolicy(value: unknown): RuntimeRoutePolicy {
  if (value === null || typeof value !== "object") {
    throw new Error("Runtime route policy state is invalid.");
  }

  const policy = value as RuntimeRoutePolicy;

  if (
    policy.schemaVersion !== 1 ||
    typeof policy.version !== "number" ||
    typeof policy.confidenceThreshold !== "number" ||
    typeof policy.readinessMode !== "string" ||
    typeof policy.maxClarificationTurns !== "number" ||
    typeof policy.announcementMode !== "string" ||
    typeof policy.fallbackTarget !== "string" ||
    typeof policy.updatedBy !== "string" ||
    typeof policy.updatedAt !== "string"
  ) {
    throw new Error("Runtime route policy state is invalid.");
  }

  return clonePolicy(policy);
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
