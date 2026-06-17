import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { defaultRuntimeRoutePolicy } from "./runtime-route-policy.models";
import { FileRuntimeRoutePolicyRepository } from "./runtime-route-policy.repository";

describe("FileRuntimeRoutePolicyRepository", () => {
  it("persists runtime route policy across repository instances", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "zara-runtime-route-policy-"));

    try {
      const firstRepository = new FileRuntimeRoutePolicyRepository(stateDir);

      await firstRepository.save({
        ...defaultRuntimeRoutePolicy,
        version: 2,
        confidenceThreshold: 0.81,
        readinessMode: "agent_requested",
        updatedBy: "user-platform-admin",
      });

      const secondRepository = new FileRuntimeRoutePolicyRepository(stateDir);
      const loaded = await secondRepository.load();

      expect(loaded).toMatchObject({
        version: 2,
        confidenceThreshold: 0.81,
        readinessMode: "agent_requested",
        updatedBy: "user-platform-admin",
      });
    } finally {
      await rm(stateDir, { force: true, recursive: true });
    }
  });
});
