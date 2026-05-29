import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { defaultRuntimePromptPolicy } from "./runtime-prompt-policy.models";
import { FileRuntimePromptPolicyRepository } from "./runtime-prompt-policy.repository";

describe("FileRuntimePromptPolicyRepository", () => {
  it("persists runtime prompt policy across repository instances", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "zara-runtime-prompt-policy-"));

    try {
      const firstRepository = new FileRuntimePromptPolicyRepository(stateDir);

      await firstRepository.save({
        ...defaultRuntimePromptPolicy,
        version: 2,
        updatedBy: "user-platform-admin",
        rolePrompts: {
          ...defaultRuntimePromptPolicy.rolePrompts,
          billing: "Resolve invoice and refund calls with a short next step.",
        },
      });

      const secondRepository = new FileRuntimePromptPolicyRepository(stateDir);
      const loaded = await secondRepository.load();

      expect(loaded).toMatchObject({
        version: 2,
        updatedBy: "user-platform-admin",
        rolePrompts: {
          billing: "Resolve invoice and refund calls with a short next step.",
        },
      });
    } finally {
      await rm(stateDir, { force: true, recursive: true });
    }
  });
});
