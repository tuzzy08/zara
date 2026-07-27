import { describe, expect, it, vi } from "vitest";

import type { CompiledRuntimeManifest } from "@zara/core";

import { defaultPremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models";
import { PremiumPstnDispatchSnapshotResolver } from "./premium-pstn-dispatch-snapshot-resolver";

describe("PremiumPstnDispatchSnapshotResolver", () => {
  it("freezes the exact manifest defaults and conversation policy used by a premium dispatch", async () => {
    const manifest = createManifest();
    const getPromptPolicy = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      updatedAt: "2026-07-25T10:00:00.000Z",
      agentClassTemplates: {
        receptionist: {
          modelDefaults: {
            text: {
              provider: "openai",
              modelTier: "premium",
              modelId: "gpt-5.4",
            },
            realtime: {
              provider: "openai",
              modelId: "gpt-realtime-2.1",
            },
          },
        },
      },
    });
    const conversationPolicy = structuredClone(
      defaultPremiumRealtimeConversationPolicy,
    );
    const resolver = new PremiumPstnDispatchSnapshotResolver(
      {
        load: vi.fn().mockResolvedValue(manifest),
      },
      { getPromptPolicy },
      {
        getPolicy: vi.fn().mockResolvedValue(conversationPolicy),
      },
    );

    const result = await resolver.resolve({
      organizationId: "tenant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "workflow-v7",
    });

    expect(result.resolvedManifest.graph.nodes[0]?.config.role).toMatchObject({
      realtimeProvider: "openai",
      realtimeModelId: "gpt-realtime-2.1",
    });
    expect(result.resolvedConversationPolicy).toEqual(conversationPolicy);
    expect(result.resolvedManifest).not.toBe(manifest);
    expect(result.resolvedConversationPolicy).not.toBe(conversationPolicy);
  });

  it("rejects a manifest that is not the exact premium tenant version", async () => {
    const resolver = new PremiumPstnDispatchSnapshotResolver(
      {
        load: vi.fn().mockResolvedValue({
          ...createManifest(),
          tenantId: "other-tenant",
        }),
      },
      {
        getPromptPolicy: vi.fn(),
      },
      {
        getPolicy: vi.fn(),
      },
    );

    await expect(resolver.resolve({
      organizationId: "tenant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "workflow-v7",
    })).rejects.toMatchObject({
      code: "premium_dispatch_snapshot_manifest_unavailable",
    });
  });
});

function createManifest(): CompiledRuntimeManifest {
  return {
    schemaVersion: 1,
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    workflowId: "workflow-1",
    publishedVersionId: "workflow-v7",
    publishedAt: "2026-07-25T09:00:00.000Z",
    runtimeProfile: "premium-realtime",
    entryNodeId: "agent-1",
    entryAgentId: "agent-1",
    graph: {
      id: "workflow-1",
      name: "Support",
      nodes: [{
        id: "agent-1",
        kind: "agent",
        label: "Jane",
        position: { x: 0, y: 0 },
        config: {
          role: {
            kind: "receptionist",
            name: "Jane",
            businessName: "Zara",
            defaultLanguage: "en",
            defaultVoice: "marin",
            defaultModelTier: "cheap",
            modelProvider: "openai",
          },
        },
      }],
      edges: [],
    },
    routePolicies: [],
    agents: [],
    toolGrants: [],
    warnings: [],
  } as unknown as CompiledRuntimeManifest;
}
