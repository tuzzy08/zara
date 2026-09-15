import { describe, expect, it } from "vitest";

import { defaultRuntimePromptPolicy } from "./runtime-prompt-policy.models";
import { InMemoryRuntimePromptPolicyRepository } from "./runtime-prompt-policy.repository";
import { RuntimePromptPolicyService } from "./runtime-prompt-policy.service";

describe("RuntimePromptPolicyService", () => {
  it("selects an immutable revision with a stable hash", async () => {
    const service = new RuntimePromptPolicyService(new InMemoryRuntimePromptPolicyRepository());

    const selected = await service.selectPromptPolicy();
    selected.policy.guardrails[0] = "changed by caller";
    const selectedAgain = await service.getPromptPolicySelection(selected.revision, selected.hash);

    expect(selectedAgain).toMatchObject({
      revision: 1,
      hash: selected.hash,
      policy: defaultRuntimePromptPolicy,
    });
  });

  it("keeps an existing session on its revision after a new policy is published", async () => {
    const service = new RuntimePromptPolicyService(new InMemoryRuntimePromptPolicyRepository());
    const first = await service.selectPromptPolicyForSession("pstn:tenant-a:call-a");
    await service.updatePromptPolicy({
      expectedVersion: 1,
      reason: "Publish revision two.",
      actorUserId: "platform-admin",
      guardrails: ["Revision two."],
    });

    const existing = await service.selectPromptPolicyForSession("pstn:tenant-a:call-a");
    const next = await service.selectPromptPolicyForSession("pstn:tenant-a:call-b");

    expect(existing).toEqual(first);
    expect(next.revision).toBe(2);
    expect(next.policy.guardrails).toEqual(["Revision two."]);
  });

  it("allows one atomic write for one expected version", async () => {
    const service = new RuntimePromptPolicyService(new InMemoryRuntimePromptPolicyRepository());
    const update = (guardrail: string) => service.updatePromptPolicy({
      expectedVersion: 1,
      reason: "Test concurrent update.",
      actorUserId: "platform-admin",
      updatedAt: "2026-09-15T10:00:00.000Z",
      guardrails: [guardrail],
    });

    const results = await Promise.allSettled([update("First."), update("Second.")]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });

  it("promotes an old revision as a new revision for rollback", async () => {
    const service = new RuntimePromptPolicyService(new InMemoryRuntimePromptPolicyRepository());
    await service.updatePromptPolicy({
      expectedVersion: 1,
      reason: "Publish revision two.",
      actorUserId: "platform-admin",
      updatedAt: "2026-09-15T10:00:00.000Z",
      guardrails: ["Revision two."],
    });

    const result = await service.promotePromptPolicyRevision({
      revision: 1,
      expectedVersion: 2,
      reason: "Rollback revision two.",
      actorUserId: "platform-admin",
      updatedAt: "2026-09-15T10:01:00.000Z",
    });

    expect(result.promptPolicy.version).toBe(3);
    expect(result.promptPolicy.guardrails).toEqual(defaultRuntimePromptPolicy.guardrails);
    expect((await service.getPromptPolicyRevision(2)).guardrails).toEqual(["Revision two."]);
  });

  it("fails closed when a pinned hash does not match", async () => {
    const service = new RuntimePromptPolicyService(new InMemoryRuntimePromptPolicyRepository());

    await expect(service.getPromptPolicySelection(1, "bad-hash"))
      .rejects.toThrow("Runtime prompt policy revision hash does not match");
  });

  it("removes classes added after the promoted revision", async () => {
    const service = new RuntimePromptPolicyService(new InMemoryRuntimePromptPolicyRepository());
    await service.createAgentClass({
      expectedVersion: 1,
      reason: "Add claims class.",
      actorUserId: "platform-admin",
      agentClass: "claims",
      label: "Claims",
      basePrompt: "Handle claims.",
      routingProfile: {
        description: "Claims owns claim requests.",
        examples: ["Start a claim"],
        fallbackTarget: "clarify_source_agent",
      },
    });

    const result = await service.promotePromptPolicyRevision({
      revision: 1,
      expectedVersion: 2,
      reason: "Restore the initial class catalog.",
      actorUserId: "platform-admin",
    });

    expect(result.promptPolicy.agentClassTemplates).not.toHaveProperty("claims");
  });

  it("rejects malformed promotion input and reports an absent revision", async () => {
    const service = new RuntimePromptPolicyService(new InMemoryRuntimePromptPolicyRepository());

    await expect(service.promotePromptPolicyRevision({
      revision: 1,
      expectedVersion: 1,
      reason: 7 as unknown as string,
      actorUserId: "platform-admin",
    })).rejects.toMatchObject({ status: 400 });
    await expect(service.promotePromptPolicyRevision({
      revision: 9,
      expectedVersion: 1,
      reason: "Restore revision nine.",
      actorUserId: "platform-admin",
    })).rejects.toMatchObject({ status: 404 });
  });
});
