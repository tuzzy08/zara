import { describe, expect, it } from "vitest";

import {
  InMemoryPublishedWorkflowManifestRepository,
} from "./published-workflow-manifest.repository";
import { WorkflowsService } from "./workflows.service";

describe("WorkflowsService", () => {
  it("stores and resolves the exact compiled manifest produced by publish", async () => {
    const manifests = new InMemoryPublishedWorkflowManifestRepository();
    const service = new WorkflowsService(
      {
        async ensureToolGrantsForPublish() {},
        async validateToolGrantsForPublish() {
          return { ok: true, errors: [] };
        },
      } as never,
      {
        async validateKnowledgeConflictsForPublish() {
          return { canPublish: true, warnings: [], publishBlockers: [] };
        },
      } as never,
      manifests,
    );

    const published = await service.publishWorkflow({
      organizationId: "tenant-west-africa",
      workflowId: "workflow-premium-support",
      request: {
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-support",
        graph: {
          id: "workflow-premium-support",
          name: "Premium support",
          nodes: [
            {
              id: "entry",
              kind: "entry",
              label: "Incoming call",
              position: { x: -200, y: 0 },
              config: {},
            },
            {
              id: "agent-jane",
              kind: "agent",
              label: "Jane",
              position: { x: 0, y: 0 },
              config: {
                role: {
                  kind: "support",
                  name: "Jane",
                  businessName: "Zara",
                  instructions: "Resolve support calls.",
                  defaultModelTier: "sota",
                  runtimeProfileOverride: "premium-realtime",
                  languagePolicy: {
                    defaultLanguage: "en",
                    supportedLanguages: ["en"],
                    allowMidCallSwitching: false,
                  },
                },
              },
            },
          ],
          edges: [
            {
              id: "entry-to-jane",
              sourceNodeId: "entry",
              targetNodeId: "agent-jane",
              kind: "flow",
            },
          ],
        },
        runtime: "openai-realtime",
        runtimeProfile: "premium-realtime",
        telephonyProvider: "twilio",
        memory: {
          mode: "session-only",
          retrievalScopes: ["session"],
          approvalRequired: true,
        },
        budget: {
          monthlyCapUsd: 100,
          currentSpendUsd: 0,
          projectedCostPerMinuteUsd: 0.1,
          blockOnLimit: true,
        },
        now: "2026-07-11T10:00:00.000Z",
      },
    });

    await expect(service.getPublishedManifest({
      organizationId: "tenant-west-africa",
      publishedVersionId: published.publishedVersion.id,
    })).resolves.toEqual(published.manifest);
    await expect(service.getPublishedManifest({
      organizationId: "tenant-other",
      publishedVersionId: published.publishedVersion.id,
    })).resolves.toBeNull();
  });
});
