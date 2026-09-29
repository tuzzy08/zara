import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";

import type {
  RuntimePromptPolicy,
  RuntimePromptPolicyAgentClassTemplate,
  RuntimePromptPolicyAgentClassModelDefaults,
} from "./runtime-prompt-policy.models";
import {
  defaultRuntimePromptPolicy,
  runtimePromptPolicyModelTiers,
  runtimePromptPolicyRealtimeProviders,
  runtimePromptPolicyRoleKinds,
  runtimePromptPolicyTextModelProviders,
} from "./runtime-prompt-policy.models";

export interface RuntimePromptPolicyRepository {
  loadOrCreateInitial(policy: RuntimePromptPolicy): Promise<RuntimePromptPolicy>;
  load(): Promise<RuntimePromptPolicy | null>;
  loadRevision(revision: number): Promise<RuntimePromptPolicy | null>;
  save(policy: RuntimePromptPolicy, expectedVersion: number): Promise<boolean>;
  pinCurrentRevision(sessionKey: string): Promise<{ revision: number; hash: string }>;
}
export class InMemoryRuntimePromptPolicyRepository implements RuntimePromptPolicyRepository {
  private currentVersion = 1;
  private readonly revisions = new Map<number, RuntimePromptPolicy>();
  private readonly sessionPins = new Map<string, { revision: number; hash: string }>();

  async load() {
    return this.loadRevision(this.currentVersion);
  }

  async loadOrCreateInitial(policy: RuntimePromptPolicy) {
    if (!this.revisions.has(1)) this.revisions.set(1, clonePolicy(policy));
    return clonePolicy((await this.load()) ?? policy);
  }

  async loadRevision(revision: number) {
    const policy = this.revisions.get(revision);
    return policy === undefined ? null : clonePolicy(policy);
  }

  async save(policy: RuntimePromptPolicy, expectedVersion: number) {
    if (this.currentVersion !== expectedVersion || policy.version !== expectedVersion + 1) return false;
    this.revisions.set(policy.version, clonePolicy(policy));
    this.currentVersion = policy.version;
    return true;
  }

  async pinCurrentRevision(sessionKey: string) {
    const existing = this.sessionPins.get(sessionKey);
    if (existing !== undefined) return { ...existing };
    const policy = await this.load();
    if (policy === null) throw new Error("Runtime prompt policy is not initialized.");
    const pin = { revision: policy.version, hash: hashRuntimePromptPolicy(policy) };
    this.sessionPins.set(sessionKey, pin);
    return { ...pin };
  }
}

export class LegacyFileRuntimePromptPolicyReader {
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

}

type RuntimePromptPolicyQueryable = Pick<Pool | PoolClient, "query">;

export class PostgresRuntimePromptPolicyRepository implements RuntimePromptPolicyRepository {
  constructor(private readonly database: RuntimePromptPolicyQueryable) {}

  async load() {
    const result = await this.database.query<{ version: number }>(
      "select version from runtime_prompt_policy_current where singleton = true",
    );
    return result.rows[0] === undefined ? null : this.loadRevision(result.rows[0].version);
  }

  async loadOrCreateInitial(policy: RuntimePromptPolicy) {
    await this.database.query(
      "select initialize_runtime_prompt_policy($1::jsonb, $2::text)",
      [JSON.stringify(policy), hashRuntimePromptPolicy(policy)],
    );
    const loaded = await this.load();
    if (loaded === null) throw new Error("Runtime prompt policy initial revision was not stored.");
    return loaded;
  }

  async loadRevision(revision: number) {
    const result = await this.database.query<{ policy: unknown; policy_hash: string }>(
      `select policy, policy_hash from runtime_prompt_policy_revisions where version = $1`,
      [revision],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    if (hashRuntimePromptPolicy(row.policy as RuntimePromptPolicy) !== row.policy_hash) {
      throw new Error("Stored runtime prompt policy revision hash does not match.");
    }
    const policy = normalizeStoredPolicy(row.policy, false);
    if (canonicalJson(policy) !== canonicalJson(row.policy)) {
      throw new Error("Stored runtime prompt policy revision is not an exact policy snapshot.");
    }
    return policy;
  }

  async save(policy: RuntimePromptPolicy, expectedVersion: number) {
    const result = await this.database.query<{ saved: boolean }>(
      "select save_runtime_prompt_policy_revision($1::jsonb, $2::integer, $3::text) as saved",
      [JSON.stringify(policy), expectedVersion, hashRuntimePromptPolicy(policy)],
    );
    return result.rows[0]?.saved === true;
  }

  async pinCurrentRevision(sessionKey: string) {
    const result = await this.database.query<{ revision: number; hash: string }>(
      "select revision, hash from pin_runtime_prompt_policy_revision($1::text)",
      [sessionKey],
    );
    const pin = result.rows[0];
    if (pin === undefined) throw new Error("Runtime prompt policy session pin was not stored.");
    return pin;
  }
}

export function hashRuntimePromptPolicy(policy: RuntimePromptPolicy) {
  return createHash("sha256").update(canonicalJson(policy)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeStoredPolicy(value: unknown, fillLegacyDefaults = true): RuntimePromptPolicy {
  if (value === null || typeof value !== "object") {
    throw new Error("Runtime prompt policy state is invalid.");
  }

  const policy = value as RuntimePromptPolicy;

  if (
    policy.schemaVersion !== 1 ||
    typeof policy.version !== "number" ||
    !Array.isArray(policy.guardrails) ||
    policy.agentClassTemplates === null ||
    typeof policy.agentClassTemplates !== "object" ||
    typeof policy.updatedBy !== "string" ||
    typeof policy.updatedAt !== "string"
  ) {
    throw new Error("Runtime prompt policy state is invalid.");
  }
  const normalizedTemplates: Partial<RuntimePromptPolicy["agentClassTemplates"]> = {};
  const rawTemplates = policy.agentClassTemplates as Record<string, RuntimePromptPolicyAgentClassTemplate | undefined>;

  for (const kind of fillLegacyDefaults ? runtimePromptPolicyRoleKinds : []) {
    const fallbackTemplate = defaultRuntimePromptPolicy.agentClassTemplates[kind];

    if (fallbackTemplate === undefined) {
      throw new Error("Runtime prompt policy state is invalid.");
    }

    const template = rawTemplates[kind] ?? fallbackTemplate;

    if (
      template === undefined ||
      normalizeStoredAgentClassKey(template.agentClass) !== kind ||
      typeof template.label !== "string" ||
      typeof template.basePrompt !== "string" ||
      template.routingProfile === null ||
      typeof template.routingProfile !== "object" ||
      typeof template.routingProfile.description !== "string" ||
      !Array.isArray(template.routingProfile.examples) ||
      typeof template.routingProfile.fallbackTarget !== "string"
    ) {
      throw new Error("Runtime prompt policy state is invalid.");
    }

    normalizedTemplates[kind] = normalizeStoredAgentClassTemplate(
      kind,
      template,
      fallbackTemplate.modelDefaults,
    );
  }

  for (const [rawKind, template] of Object.entries(rawTemplates)) {
    const kind = normalizeStoredAgentClassKey(rawKind);

    if (normalizedTemplates[kind] !== undefined) {
      continue;
    }

    if (
      template === undefined ||
      normalizeStoredAgentClassKey(template.agentClass) !== kind ||
      typeof template.label !== "string" ||
      typeof template.basePrompt !== "string" ||
      template.routingProfile === null ||
      typeof template.routingProfile !== "object" ||
      typeof template.routingProfile.description !== "string" ||
      !Array.isArray(template.routingProfile.examples) ||
      typeof template.routingProfile.fallbackTarget !== "string"
    ) {
      throw new Error("Runtime prompt policy state is invalid.");
    }

    normalizedTemplates[kind] = normalizeStoredAgentClassTemplate(
      kind,
      template,
      fillLegacyDefaults
        ? defaultRuntimePromptPolicy.agentClassTemplates.custom!.modelDefaults
        : undefined,
    );
  }

  return clonePolicy({
    ...policy,
    agentClassTemplates: normalizedTemplates as RuntimePromptPolicy["agentClassTemplates"],
  });
}

function normalizeStoredAgentClassTemplate(
  agentClass: string,
  template: RuntimePromptPolicyAgentClassTemplate,
  fallbackModelDefaults: RuntimePromptPolicyAgentClassModelDefaults | undefined,
): RuntimePromptPolicyAgentClassTemplate {
  return {
    agentClass: agentClass as RuntimePromptPolicyAgentClassTemplate["agentClass"],
    label: template.label,
    basePrompt: template.basePrompt,
    modelDefaults: normalizeStoredModelDefaults(
      (template as { modelDefaults?: RuntimePromptPolicyAgentClassModelDefaults | undefined }).modelDefaults
        ?? fallbackModelDefaults,
    ),
    routingProfile: {
      description: template.routingProfile.description,
      examples: [...template.routingProfile.examples],
      fallbackTarget: template.routingProfile.fallbackTarget,
    },
  };
}

function normalizeStoredAgentClassKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{1,63}$/u.test(value.trim().toLowerCase())) {
    throw new Error("Runtime prompt policy state is invalid.");
  }

  return value.trim().toLowerCase();
}

function normalizeStoredModelDefaults(
  modelDefaults: RuntimePromptPolicyAgentClassModelDefaults | undefined,
): RuntimePromptPolicyAgentClassModelDefaults {
  if (
    modelDefaults === undefined ||
    modelDefaults === null ||
    typeof modelDefaults !== "object" ||
    modelDefaults.text === null ||
    typeof modelDefaults.text !== "object" ||
    modelDefaults.realtime === null ||
    typeof modelDefaults.realtime !== "object" ||
    !runtimePromptPolicyTextModelProviders.includes(modelDefaults.text.provider as never) ||
    !runtimePromptPolicyModelTiers.includes(modelDefaults.text.modelTier as never) ||
    !runtimePromptPolicyRealtimeProviders.includes(modelDefaults.realtime.provider as never) ||
    (
      modelDefaults.text.modelId !== undefined &&
      typeof modelDefaults.text.modelId !== "string"
    ) ||
    (
      modelDefaults.realtime.modelId !== undefined &&
      typeof modelDefaults.realtime.modelId !== "string"
    )
  ) {
    throw new Error("Runtime prompt policy state is invalid.");
  }

  const textModelId = modelDefaults.text.modelId?.trim();
  const realtimeModelId = modelDefaults.realtime.modelId?.trim();

  return {
    text: {
      provider: modelDefaults.text.provider,
      modelTier: modelDefaults.text.modelTier,
      ...(textModelId !== undefined && textModelId.length > 0 ? { modelId: textModelId } : {}),
    },
    realtime: {
      provider: modelDefaults.realtime.provider,
      ...(realtimeModelId !== undefined && realtimeModelId.length > 0 ? { modelId: realtimeModelId } : {}),
    },
  };
}

function clonePolicy(policy: RuntimePromptPolicy): RuntimePromptPolicy {
  return {
    schemaVersion: policy.schemaVersion,
    version: policy.version,
    guardrails: [...policy.guardrails],
    agentClassTemplates: cloneAgentClassTemplates(policy.agentClassTemplates),
    updatedBy: policy.updatedBy,
    updatedAt: policy.updatedAt,
  };
}

function cloneAgentClassTemplates(templates: RuntimePromptPolicy["agentClassTemplates"]) {
  const cloned: RuntimePromptPolicy["agentClassTemplates"] = {};

  for (const [kind, template] of Object.entries(templates)) {

    cloned[kind] = {
      agentClass: template.agentClass,
      label: template.label,
      basePrompt: template.basePrompt,
      modelDefaults: {
        text: {
          provider: template.modelDefaults.text.provider,
          modelTier: template.modelDefaults.text.modelTier,
          ...(template.modelDefaults.text.modelId !== undefined
            ? { modelId: template.modelDefaults.text.modelId }
            : {}),
        },
        realtime: {
          provider: template.modelDefaults.realtime.provider,
          ...(template.modelDefaults.realtime.modelId !== undefined
            ? { modelId: template.modelDefaults.realtime.modelId }
            : {}),
        },
      },
      routingProfile: {
        description: template.routingProfile.description,
        examples: [...template.routingProfile.examples],
        fallbackTarget: template.routingProfile.fallbackTarget,
      },
    };
  }

  return cloned;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
