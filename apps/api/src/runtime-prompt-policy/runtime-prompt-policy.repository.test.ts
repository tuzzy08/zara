import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { defaultRuntimePromptPolicy } from "./runtime-prompt-policy.models";
import {
  InMemoryRuntimePromptPolicyRepository,
  LegacyFileRuntimePromptPolicyReader,
  PostgresRuntimePromptPolicyRepository,
  hashRuntimePromptPolicy,
} from "./runtime-prompt-policy.repository";

describe("runtime prompt policy repositories", () => {
  it("keeps immutable revisions and rejects a stale expected version", async () => {
    const repository = new InMemoryRuntimePromptPolicyRepository();
    await repository.loadOrCreateInitial(defaultRuntimePromptPolicy);
    const revision2 = { ...defaultRuntimePromptPolicy, version: 2, guardrails: ["Revision two."] };
    const revision3 = { ...revision2, version: 3, guardrails: ["Revision three."] };

    const results = await Promise.all([repository.save(revision2, 1), repository.save(revision3, 1)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await repository.loadRevision(1))?.guardrails).toEqual(defaultRuntimePromptPolicy.guardrails);
    expect((await repository.loadRevision(2))?.guardrails).toEqual(["Revision two."]);
    expect(await repository.loadRevision(3)).toBeNull();
  });

  it("reads the existing mutable file once for the Postgres migration", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "zara-runtime-prompt-policy-"));
    try {
      const policy = { ...defaultRuntimePromptPolicy, version: 7, guardrails: ["Existing operator rule."] };
      await writeFile(join(stateDir, "prompt-policy.json"), JSON.stringify(policy), "utf8");

      expect(await new LegacyFileRuntimePromptPolicyReader(stateDir).load()).toMatchObject({
        version: 7,
        guardrails: ["Existing operator rule."],
      });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("returns an old database revision without adding current class defaults", async () => {
    const stored = {
      ...defaultRuntimePromptPolicy,
      agentClassTemplates: {
        custom: defaultRuntimePromptPolicy.agentClassTemplates.custom!,
      },
    };
    const repository = new PostgresRuntimePromptPolicyRepository({
      query: async () => ({
        rows: [{ policy: stored, policy_hash: hashRuntimePromptPolicy(stored) }],
      }),
    } as never);

    expect(await repository.loadRevision(1)).toEqual(stored);
  });
});
