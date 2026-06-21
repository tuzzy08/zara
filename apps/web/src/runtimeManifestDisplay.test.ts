import { describe, expect, it } from "vitest";
import {
  buildRuntimeManifestPreview,
  createAgentRoleNode,
  createWorkflowGraph,
  type RuntimeManifestPreview,
} from "@zara/core";

import { compileDraftSandboxRuntimeManifest } from "./sandboxRuntimeManifest";
import {
  formatRuntimeManifestProviderSummary,
  getRuntimeManifestEntryAgentName,
  getRuntimeManifestEntryModelTier,
  resolveWorkflowSandboxRuntimeDisplay,
} from "./runtimeManifestDisplay";

const memory: RuntimeManifestPreview["memory"] = {
  mode: "scoped",
  retrievalScopes: ["session"],
  approvalRequired: true,
};

const budget: RuntimeManifestPreview["budget"] = {
  monthlyCapUsd: 100,
  currentSpendUsd: 0,
  projectedCostPerMinuteUsd: 0.05,
  blockOnLimit: true,
};

describe("runtime manifest display", () => {
  it("uses concrete entry-agent config instead of stale role snapshots", () => {
    const graph = createWorkflowGraph({
      id: "workflow-support",
      name: "Support",
      nodes: [
        {
          id: "entry",
          kind: "entry",
          label: "Inbound call",
          position: { x: 0, y: 0 },
          config: {},
        },
        createAgentRoleNode({
          id: "agent-jane",
          label: "Jane",
          position: { x: 260, y: 0 },
          role: {
            kind: "support",
            name: "Jane",
            businessName: "Zara AI",
            instructions: "Resolve caller support requests.",
            defaultModelTier: "sota",
            runtimeProfileOverride: "premium-realtime",
            realtimeProvider: "gemini-live",
            realtimeModelId: "gemini-3.1-flash-live-preview",
            voiceConfig: {
              provider: "cartesia",
              voiceId: "voice-jane",
              label: "Jane voice",
              sourceType: "catalog",
            },
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
          targetNodeId: "agent-jane",
        },
      ],
    });
    const runtimePreview = buildRuntimeManifestPreview({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-support",
      environment: "production",
      workflowId: "workflow-support",
      graph,
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory,
      budget,
    });
    const manifest = compileDraftSandboxRuntimeManifest({
      workflowId: "workflow-support",
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-support",
      environment: "production",
      createdBy: "user-ops-lead",
      graph,
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      memory,
      budget,
    });
    const staleRole = manifest.roles[0];

    if (staleRole === undefined) {
      throw new Error("Expected draft manifest to include a role snapshot fixture.");
    }

    manifest.roles = [{
      ...staleRole,
      id: "agent-jane",
      name: "New Agent",
      defaultModelTier: "cheap",
      runtimeProfileOverride: "premium-realtime",
      realtimeProvider: "openai-realtime",
      realtimeModelId: "gpt-realtime",
      voiceConfig: {
        provider: "cartesia",
        voiceId: "voice-stale",
        label: "Stale voice",
        sourceType: "catalog",
      },
    }];

    expect(getRuntimeManifestEntryAgentName(manifest)).toBe("Jane");
    expect(getRuntimeManifestEntryModelTier(manifest)).toBe("sota");
    expect(resolveWorkflowSandboxRuntimeDisplay({ manifest, runtimePreview })).toEqual({
      label: "Gemini Live",
      runtimeProfile: "premium-realtime",
      isPremiumRealtime: true,
      voiceLabel: "Jane voice",
      modelId: "gemini-3.1-flash-live-preview",
    });
    expect(formatRuntimeManifestProviderSummary({ manifest })).toBe("Gemini Live / Gemini Live / Gemini Live");
  });
});
