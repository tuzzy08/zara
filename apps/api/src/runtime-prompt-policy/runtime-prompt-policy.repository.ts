import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RuntimePromptPolicy } from "./runtime-prompt-policy.models";

export interface RuntimePromptPolicyRepository {
  load(): Promise<RuntimePromptPolicy | null>;
  save(policy: RuntimePromptPolicy): Promise<void>;
}
export class InMemoryRuntimePromptPolicyRepository implements RuntimePromptPolicyRepository {
  private policy: RuntimePromptPolicy | null = null;

  async load() {
    return this.policy === null ? null : clonePolicy(this.policy);
  }

  async save(policy: RuntimePromptPolicy) {
    this.policy = clonePolicy(policy);
  }
}

export class FileRuntimePromptPolicyRepository implements RuntimePromptPolicyRepository {
  private readonly filePath: string;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, "prompt-policy.json");
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

  async save(policy: RuntimePromptPolicy) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}

function normalizeStoredPolicy(value: unknown): RuntimePromptPolicy {
  if (value === null || typeof value !== "object") {
    throw new Error("Runtime prompt policy state is invalid.");
  }

  const policy = value as RuntimePromptPolicy;

  if (
    policy.schemaVersion !== 1 ||
    typeof policy.version !== "number" ||
    !Array.isArray(policy.guardrails) ||
    policy.rolePrompts === null ||
    typeof policy.rolePrompts !== "object" ||
    typeof policy.updatedBy !== "string" ||
    typeof policy.updatedAt !== "string"
  ) {
    throw new Error("Runtime prompt policy state is invalid.");
  }

  return clonePolicy(policy);
}

function clonePolicy(policy: RuntimePromptPolicy): RuntimePromptPolicy {
  return {
    schemaVersion: policy.schemaVersion,
    version: policy.version,
    guardrails: [...policy.guardrails],
    rolePrompts: { ...policy.rolePrompts },
    updatedBy: policy.updatedBy,
    updatedAt: policy.updatedAt,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
