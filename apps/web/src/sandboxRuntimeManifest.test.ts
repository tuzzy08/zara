import { describe, expect, it } from "vitest";
import { createAgentRoleNode, createWorkflowGraph } from "@zara/core";

import { compileDraftSandboxRuntimeManifest } from "./sandboxRuntimeManifest";

describe("sandbox runtime manifest", () => {
  it("preserves the workflow identity for draft sandbox permission checks", () => {
    const graph = createWorkflowGraph({
      id: "workflow-support-triage",
      name: "Support triage",
      nodes: [
        {
          id: "entry",
          kind: "entry",
          label: "Inbound call",
          position: { x: 0, y: 0 },
          config: {},
        },
        createAgentRoleNode({
          id: "agent-support",
          label: "Support agent",
          position: { x: 260, y: 0 },
          role: {
            kind: "receptionist",
            name: "Support agent",
            businessName: "Zara AI",
            instructions: "Help callers with support requests.",
            defaultModelTier: "standard",
            languagePolicy: {
              defaultLanguage: "en",
              supportedLanguages: ["en"],
              allowMidCallSwitching: false,
            },
          },
        }),
      ],
      edges: [
        {
          id: "edge-entry-agent",
          sourceNodeId: "entry",
          targetNodeId: "agent-support",
        },
      ],
    });

    const manifest = compileDraftSandboxRuntimeManifest({
      workflowId: "workflow-support-triage",
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-customer-success",
      environment: "production",
      createdBy: "user-ops-lead",
      graph,
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 100,
        currentSpendUsd: 0,
        projectedCostPerMinuteUsd: 0.05,
        blockOnLimit: true,
      },
    });

    expect(manifest.workflowId).toBe("workflow-support-triage");
    expect(manifest.publishedVersionId).not.toContain("draft-sandbox");
  });
});
