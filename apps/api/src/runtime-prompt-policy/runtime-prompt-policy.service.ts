import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { AgentRoleKind } from "@zara/core";

import type {
  CreateRuntimePromptPolicyAgentClassInput,
  RuntimePromptPolicyAgentClassModelDefaults,
  RuntimePromptPolicyAgentClassTemplate,
  RuntimePromptPolicy,
  UpdateRuntimePromptPolicyAgentClassTemplateInput,
  UpdateRuntimePromptPolicyInput,
} from "./runtime-prompt-policy.models";
import {
  defaultRuntimePromptPolicy,
  runtimePromptPolicyModelTiers,
  runtimePromptPolicyRealtimeProviders,
  runtimePromptPolicyRoleKinds,
  runtimePromptPolicyTextModelProviders,
} from "./runtime-prompt-policy.models";
import type { RuntimePromptPolicyRepository } from "./runtime-prompt-policy.repository";
import { runtimeRoutePolicyFallbackTargets } from "../runtime-route-policy/runtime-route-policy.models";

export const runtimePromptPolicyRepositoryToken = Symbol("runtimePromptPolicyRepository");

@Injectable()
export class RuntimePromptPolicyService {
  constructor(
    @Inject(runtimePromptPolicyRepositoryToken)
    private readonly repository: RuntimePromptPolicyRepository,
  ) {}

  async getPromptPolicy(): Promise<RuntimePromptPolicy> {
    return clonePolicy(await this.repository.load() ?? defaultRuntimePromptPolicy);
  }

  async updatePromptPolicy(input: UpdateRuntimePromptPolicyInput & { actorUserId: string; updatedAt?: string | undefined }) {
    const current = await this.getPromptPolicy();

    if (input.expectedVersion !== current.version) {
      throw new ConflictException("Runtime prompt policy has changed. Refresh before saving.");
    }

    const reason = input.reason.trim();

    if (reason.length === 0) {
      throw new BadRequestException("Runtime prompt policy updates require a reason.");
    }

    const next: RuntimePromptPolicy = {
      ...current,
      version: current.version + 1,
      guardrails: input.guardrails === undefined ? current.guardrails : normalizeGuardrails(input.guardrails),
      agentClassTemplates: normalizeAgentClassTemplates(
        mergeAgentClassTemplates(current.agentClassTemplates, input.agentClassTemplates),
      ),
      updatedBy: input.actorUserId,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };

    await this.repository.save(next);

    return {
      promptPolicy: clonePolicy(next),
      changedAgentClassKeys: Object.keys(input.agentClassTemplates ?? {}).sort(),
      guardrailCount: next.guardrails.length,
      reason,
    };
  }

  async createAgentClass(
    input: CreateRuntimePromptPolicyAgentClassInput & { actorUserId: string; updatedAt?: string | undefined },
  ) {
    const current = await this.getPromptPolicy();
    const agentClass = normalizeAgentClassKey(input.agentClass);

    if (current.agentClassTemplates[agentClass] !== undefined) {
      throw new ConflictException(`Agent class '${agentClass}' already exists.`);
    }

    const result = await this.updatePromptPolicy({
      expectedVersion: input.expectedVersion,
      reason: input.reason,
      actorUserId: input.actorUserId,
      updatedAt: input.updatedAt,
      agentClassTemplates: {
        [agentClass]: {
          label: input.label,
          basePrompt: input.basePrompt,
          modelDefaults: input.modelDefaults,
          routingProfile: input.routingProfile,
        },
      },
    });

    const agentClassTemplate = result.promptPolicy.agentClassTemplates[agentClass];

    if (agentClassTemplate === undefined) {
      throw new BadRequestException(`Runtime prompt policy did not create agent class '${agentClass}'.`);
    }

    return {
      ...result,
      agentClass: agentClassTemplate,
    };
  }

  async listAgentClasses() {
    const policy = await this.getPromptPolicy();

    return Object.values(policy.agentClassTemplates)
      .map((template) => ({
        agentClass: template.agentClass,
        label: template.label,
        realtimeProvider: template.modelDefaults.realtime.provider,
        routingProfile: {
          description: template.routingProfile.description,
          examples: [...template.routingProfile.examples],
          fallbackTarget: template.routingProfile.fallbackTarget,
        },
      }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.agentClass.localeCompare(right.agentClass));
  }
}
function normalizeGuardrails(guardrails: string[]) {
  const normalized = guardrails.map((guardrail) => guardrail.trim()).filter(Boolean);

  if (normalized.length === 0) {
    throw new BadRequestException("Runtime prompt policy requires at least one guardrail.");
  }

  return normalized;
}

function mergeAgentClassTemplates(
  current: Record<string, RuntimePromptPolicyAgentClassTemplate>,
  updates: Record<string, UpdateRuntimePromptPolicyAgentClassTemplateInput> | undefined,
) {
  const merged: Record<string, RuntimePromptPolicyAgentClassTemplate> = cloneAgentClassTemplates(current);

  for (const [rawKind, update] of Object.entries(updates ?? {})) {
    const kind = normalizeAgentClassKey(rawKind);
    const currentTemplate = current[kind] ?? createNewAgentClassTemplate(kind);

    merged[kind] = {
      agentClass: kind,
      label: update?.label ?? currentTemplate.label,
      basePrompt: update?.basePrompt ?? currentTemplate.basePrompt,
      modelDefaults: mergeAgentClassModelDefaults(currentTemplate.modelDefaults, update?.modelDefaults),
      routingProfile: {
        description: update?.routingProfile?.description ?? currentTemplate.routingProfile.description,
        examples: update?.routingProfile?.examples ?? currentTemplate.routingProfile.examples,
        fallbackTarget: update?.routingProfile?.fallbackTarget ?? currentTemplate.routingProfile.fallbackTarget,
      },
    };
  }

  return merged;
}

function normalizeAgentClassTemplates(
  templates: Record<string, RuntimePromptPolicyAgentClassTemplate>,
) {
  const normalized: Record<string, RuntimePromptPolicyAgentClassTemplate> = {};

  for (const [rawKind, template] of Object.entries(templates)) {
    const kind = normalizeAgentClassKey(rawKind);

    const label = template.label.trim();
    const basePrompt = template.basePrompt.trim();
    const description = template.routingProfile.description.trim();
    const examples = template.routingProfile.examples.map((example) => example.trim()).filter(Boolean);
    const modelDefaults = normalizeAgentClassModelDefaults(kind, template.modelDefaults);

    if (normalizeAgentClassKey(template.agentClass) !== kind) {
      throw new BadRequestException(`Runtime prompt policy agent class template '${kind}' has a mismatched class.`);
    }

    if (label.length === 0) {
      throw new BadRequestException(`Runtime prompt policy requires an agent class label for '${kind}'.`);
    }

    if (basePrompt.length === 0) {
      throw new BadRequestException(`Runtime prompt policy requires an agent class base prompt for '${kind}'.`);
    }

    if (description.length === 0) {
      throw new BadRequestException(`Runtime prompt policy requires a routing description for '${kind}'.`);
    }

    if (examples.length === 0) {
      throw new BadRequestException(`Runtime prompt policy requires at least one routing example for '${kind}'.`);
    }

    if (!runtimeRoutePolicyFallbackTargets.includes(template.routingProfile.fallbackTarget as never)) {
      throw new BadRequestException(
        `Runtime prompt policy fallback target '${template.routingProfile.fallbackTarget}' is not supported.`,
      );
    }

    normalized[kind] = {
      agentClass: kind,
      label,
      basePrompt,
      modelDefaults,
      routingProfile: {
        description,
        examples,
        fallbackTarget: template.routingProfile.fallbackTarget,
      },
    };
  }

  for (const kind of runtimePromptPolicyRoleKinds) {
    if (normalized[kind] === undefined) {
      normalized[kind] = defaultRuntimePromptPolicy.agentClassTemplates[kind]!;
    }
  }

  return normalized;
}

function createNewAgentClassTemplate(agentClass: AgentRoleKind): RuntimePromptPolicyAgentClassTemplate {
  return {
    agentClass,
    label: "",
    basePrompt: "",
    modelDefaults: defaultRuntimePromptPolicy.agentClassTemplates.custom!.modelDefaults,
    routingProfile: {
      description: "",
      examples: [],
      fallbackTarget: "clarify_source_agent",
    },
  };
}

function normalizeAgentClassKey(value: string): AgentRoleKind {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(normalized)) {
    throw new BadRequestException("Agent class keys must be lowercase slugs between 2 and 64 characters.");
  }

  return normalized as AgentRoleKind;
}

function mergeAgentClassModelDefaults(
  current: RuntimePromptPolicyAgentClassModelDefaults,
  update: UpdateRuntimePromptPolicyAgentClassTemplateInput["modelDefaults"] | undefined,
): RuntimePromptPolicyAgentClassModelDefaults {
  return {
    text: {
      ...current.text,
      ...(update?.text ?? {}),
    },
    realtime: {
      ...current.realtime,
      ...(update?.realtime ?? {}),
    },
  };
}

function normalizeAgentClassModelDefaults(
  kind: AgentRoleKind,
  modelDefaults: RuntimePromptPolicyAgentClassModelDefaults,
): RuntimePromptPolicyAgentClassModelDefaults {
  const textProvider = modelDefaults.text.provider;
  const modelTier = modelDefaults.text.modelTier;
  const realtimeProvider = modelDefaults.realtime.provider;

  if (!runtimePromptPolicyTextModelProviders.includes(textProvider as never)) {
    throw new BadRequestException(
      `Runtime prompt policy text model provider '${textProvider}' is not supported for '${kind}'.`,
    );
  }

  if (!runtimePromptPolicyModelTiers.includes(modelTier as never)) {
    throw new BadRequestException(
      `Runtime prompt policy text model tier '${modelTier}' is not supported for '${kind}'.`,
    );
  }

  if (!runtimePromptPolicyRealtimeProviders.includes(realtimeProvider as never)) {
    throw new BadRequestException(
      `Runtime prompt policy realtime provider '${realtimeProvider}' is not supported for '${kind}'.`,
    );
  }

  const textModelId = normalizeOptionalModelId(modelDefaults.text.modelId);
  const realtimeModelId = normalizeOptionalModelId(modelDefaults.realtime.modelId);

  return {
    text: {
      provider: textProvider,
      modelTier,
      ...(textModelId !== undefined ? { modelId: textModelId } : {}),
    },
    realtime: {
      provider: realtimeProvider,
      ...(realtimeModelId !== undefined ? { modelId: realtimeModelId } : {}),
    },
  };
}

function normalizeOptionalModelId(value: string | undefined) {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
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
