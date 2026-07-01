import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
    policy.agentClassTemplates === null ||
    typeof policy.agentClassTemplates !== "object" ||
    typeof policy.updatedBy !== "string" ||
    typeof policy.updatedAt !== "string"
  ) {
    throw new Error("Runtime prompt policy state is invalid.");
  }
  const normalizedTemplates: Partial<RuntimePromptPolicy["agentClassTemplates"]> = {};
  const rawTemplates = policy.agentClassTemplates as Record<string, RuntimePromptPolicyAgentClassTemplate | undefined>;

  for (const kind of runtimePromptPolicyRoleKinds) {
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
      defaultRuntimePromptPolicy.agentClassTemplates.custom!.modelDefaults,
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
  fallbackModelDefaults: RuntimePromptPolicyAgentClassModelDefaults,
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
  modelDefaults: RuntimePromptPolicyAgentClassModelDefaults,
): RuntimePromptPolicyAgentClassModelDefaults {
  if (
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
