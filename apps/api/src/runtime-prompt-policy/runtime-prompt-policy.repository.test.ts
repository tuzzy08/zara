import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { defaultRuntimePromptPolicy } from "./runtime-prompt-policy.models";
import { FileRuntimePromptPolicyRepository } from "./runtime-prompt-policy.repository";

describe("FileRuntimePromptPolicyRepository", () => {
  it("persists runtime prompt policy guardrails across repository instances", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "zara-runtime-prompt-policy-"));

    try {
      const firstRepository = new FileRuntimePromptPolicyRepository(stateDir);

      await firstRepository.save({
        ...defaultRuntimePromptPolicy,
        version: 2,
        updatedBy: "user-platform-admin",
        guardrails: ["Keep caller-facing responses inside platform policy."],
      });

      const secondRepository = new FileRuntimePromptPolicyRepository(stateDir);
      const loaded = await secondRepository.load();

      expect(loaded).toMatchObject({
        version: 2,
        updatedBy: "user-platform-admin",
        guardrails: ["Keep caller-facing responses inside platform policy."],
      });
      expect(loaded).not.toHaveProperty("rolePrompts");
    } finally {
      await rm(stateDir, { force: true, recursive: true });
    }
  });

  it("persists the agent class template catalog across repository instances", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "zara-runtime-prompt-policy-"));

    try {
      const firstRepository = new FileRuntimePromptPolicyRepository(stateDir);

      await firstRepository.save({
        ...defaultRuntimePromptPolicy,
        version: 2,
        updatedBy: "user-platform-admin",
        agentClassTemplates: {
          ...defaultRuntimePromptPolicy.agentClassTemplates,
          billing: {
            ...defaultRuntimePromptPolicy.agentClassTemplates.billing,
            basePrompt: "Handle invoice, refund, and subscription calls before any handoff.",
            routingProfile: {
              ...defaultRuntimePromptPolicy.agentClassTemplates.billing.routingProfile,
              description: "Billing owns invoices, refunds, subscription status, and payment questions.",
              examples: ["I need help with my invoice", "Can I update my subscription?"],
            },
          },
        },
      });

      const secondRepository = new FileRuntimePromptPolicyRepository(stateDir);
      const loaded = await secondRepository.load();

      expect(loaded?.agentClassTemplates.billing).toMatchObject({
        agentClass: "billing",
        label: "Billing",
        basePrompt: "Handle invoice, refund, and subscription calls before any handoff.",
        routingProfile: {
          description: "Billing owns invoices, refunds, subscription status, and payment questions.",
          examples: ["I need help with my invoice", "Can I update my subscription?"],
          fallbackTarget: "clarify_source_agent",
        },
      });
    } finally {
      await rm(stateDir, { force: true, recursive: true });
    }
  });
});
