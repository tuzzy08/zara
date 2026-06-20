import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { AgentRoleKind } from "@zara/core";

import type {
  RuntimePromptPolicyAgentClassTemplate,
  RuntimePromptPolicy,
  UpdateRuntimePromptPolicyAgentClassTemplateInput,
  UpdateRuntimePromptPolicyInput,
} from "./runtime-prompt-policy.models";
import {
  defaultRuntimePromptPolicy,
  runtimePromptPolicyRoleKinds,
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
}
function normalizeGuardrails(guardrails: string[]) {
  const normalized = guardrails.map((guardrail) => guardrail.trim()).filter(Boolean);

  if (normalized.length === 0) {
    throw new BadRequestException("Runtime prompt policy requires at least one guardrail.");
  }

  return normalized;
}

function mergeAgentClassTemplates(
  current: Record<AgentRoleKind, RuntimePromptPolicyAgentClassTemplate>,
  updates: Partial<Record<AgentRoleKind, UpdateRuntimePromptPolicyAgentClassTemplateInput>> | undefined,
) {
  const merged: Partial<Record<AgentRoleKind, RuntimePromptPolicyAgentClassTemplate>> = {};

  for (const kind of runtimePromptPolicyRoleKinds) {
    const currentTemplate = current[kind];
    const update = updates?.[kind];

    merged[kind] = {
      agentClass: kind,
      label: update?.label ?? currentTemplate.label,
      basePrompt: update?.basePrompt ?? currentTemplate.basePrompt,
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
  templates: Partial<Record<AgentRoleKind, RuntimePromptPolicyAgentClassTemplate>>,
) {
  const normalized: Partial<Record<AgentRoleKind, RuntimePromptPolicyAgentClassTemplate>> = {};

  for (const kind of runtimePromptPolicyRoleKinds) {
    const template = templates[kind];

    if (template === undefined) {
      throw new BadRequestException(`Runtime prompt policy requires an agent class template for '${kind}'.`);
    }

    const label = template.label.trim();
    const basePrompt = template.basePrompt.trim();
    const description = template.routingProfile.description.trim();
    const examples = template.routingProfile.examples.map((example) => example.trim()).filter(Boolean);

    if (template.agentClass !== kind) {
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
      routingProfile: {
        description,
        examples,
        fallbackTarget: template.routingProfile.fallbackTarget,
      },
    };
  }

  return normalized as Record<AgentRoleKind, RuntimePromptPolicyAgentClassTemplate>;
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
  const cloned: Partial<RuntimePromptPolicy["agentClassTemplates"]> = {};

  for (const kind of runtimePromptPolicyRoleKinds) {
    const template = templates[kind];

    cloned[kind] = {
      agentClass: template.agentClass,
      label: template.label,
      basePrompt: template.basePrompt,
      routingProfile: {
        description: template.routingProfile.description,
        examples: [...template.routingProfile.examples],
        fallbackTarget: template.routingProfile.fallbackTarget,
      },
    };
  }

  return cloned as RuntimePromptPolicy["agentClassTemplates"];
}
