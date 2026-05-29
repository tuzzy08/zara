import { describe, expect, it } from "vitest";

import { compileRuntimeManifest } from "./runtime";
import {
  createAgentRoleNode,
  createWorkflowGraph,
  filterPublishedWorkflowVersionsForWorkspace,
  publishWorkflowVersion,
} from "./workflow";

describe("workspace scoped workflows", () => {
  it("stores workspace id on published workflow versions and manifest previews", () => {
    const publishedVersion = publishWorkflowVersion({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-support",
      environment: "production",
      workflowId: "workflow-support",
      graph: createValidGraph("workflow-support"),
      existingVersions: [],
      createdBy: "user-builder",
      runtime: "sandwich-pipeline",
      telephonyProvider: "twilio",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 500,
        currentSpendUsd: 40,
        projectedCostPerMinuteUsd: 0.12,
        blockOnLimit: true,
      },
    });

    expect(publishedVersion.workspaceId).toBe("workspace-support");
    expect(publishedVersion.manifestPreview.workspaceId).toBe("workspace-support");
  });

  it("filters published versions to the active workspace", () => {
    const supportVersion = publishWorkflowVersion({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-support",
      environment: "production",
      workflowId: "workflow-support",
      graph: createValidGraph("workflow-support"),
      existingVersions: [],
      createdBy: "user-builder",
      runtime: "sandwich-pipeline",
      telephonyProvider: "twilio",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 500,
        currentSpendUsd: 40,
        projectedCostPerMinuteUsd: 0.12,
        blockOnLimit: true,
      },
    });
    const salesVersion = publishWorkflowVersion({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-sales",
      environment: "production",
      workflowId: "workflow-sales",
      graph: createValidGraph("workflow-sales"),
      existingVersions: [],
      createdBy: "user-builder",
      runtime: "sandwich-pipeline",
      telephonyProvider: "twilio",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 500,
        currentSpendUsd: 40,
        projectedCostPerMinuteUsd: 0.12,
        blockOnLimit: true,
      },
    });

    expect(filterPublishedWorkflowVersionsForWorkspace({
      versions: [supportVersion, salesVersion],
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-support",
    })).toEqual([supportVersion]);
  });

  it("carries workspace id into compiled runtime manifests", () => {
    const publishedVersion = publishWorkflowVersion({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-support",
      environment: "production",
      workflowId: "workflow-support",
      graph: createValidGraph("workflow-support"),
      existingVersions: [],
      createdBy: "user-builder",
      runtime: "sandwich-pipeline",
      telephonyProvider: "twilio",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 500,
        currentSpendUsd: 40,
        projectedCostPerMinuteUsd: 0.12,
        blockOnLimit: true,
      },
    });

    const manifest = compileRuntimeManifest({
      publishedVersion,
      modelRouting: [
        {
          id: "route-cheap",
          when: {
            callPhase: "discovery",
          },
          useTier: "cheap",
          reason: "Default discovery route",
        },
      ],
      telemetry: {
        captureAudio: false,
        captureTranscript: true,
        redactSensitiveData: true,
        sinks: ["live-monitor"],
      },
    });

    expect(manifest.workspaceId).toBe("workspace-support");
  });
});

function createValidGraph(id: string) {
  return createWorkflowGraph({
    id,
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
        id: "agent-front-desk",
        label: "Front desk",
        position: { x: 200, y: 0 },
        role: {
          kind: "receptionist",
          name: "Front desk",
          businessName: "Tuzzy Labs",
          instructions: "Greet callers and resolve or route their request.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
          reusableSpecialist: true,
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-agent",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
    ],
  });
}
