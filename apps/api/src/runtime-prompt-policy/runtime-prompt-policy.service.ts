import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { AgentRoleKind } from "@zara/core";

import type {
  RuntimePromptPolicy,
  UpdateRuntimePromptPolicyInput,
} from "./runtime-prompt-policy.models";
import {
  defaultRuntimePromptPolicy,
  runtimePromptPolicyRoleKinds,
} from "./runtime-prompt-policy.models";
import type { RuntimePromptPolicyRepository } from "./runtime-prompt-policy.repository";

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
      rolePrompts: normalizeRolePrompts({
        ...current.rolePrompts,
        ...(input.rolePrompts ?? {}),
      }),
      updatedBy: input.actorUserId,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };

    await this.repository.save(next);

    return {
      promptPolicy: clonePolicy(next),
      changedRoleKeys: Object.keys(input.rolePrompts ?? {}).sort(),
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

function normalizeRolePrompts(rolePrompts: Partial<Record<AgentRoleKind, string>>) {
  const normalized: Partial<Record<AgentRoleKind, string>> = {};

  for (const kind of runtimePromptPolicyRoleKinds) {
    const value = rolePrompts[kind]?.trim() ?? "";

    if (value.length === 0) {
      throw new BadRequestException(`Runtime prompt policy requires a prompt for '${kind}'.`);
    }

    normalized[kind] = value;
  }

  return normalized as Record<AgentRoleKind, string>;
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
