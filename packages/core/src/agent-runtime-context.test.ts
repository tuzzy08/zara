import { describe, expect, it } from "vitest";

import {
  createAgentRuntimeContext,
  resolveRuntimeAgents,
  type CompiledRuntimeManifest,
} from "./index";

describe("agent runtime context", () => {
  it("derives concrete runtime agents from graph agent nodes and role snapshots", () => {
    const manifest = createManifest();

    expect(resolveRuntimeAgents(manifest)).toEqual([
      expect.objectContaining({
        agentId: "agent-jane",
        nodeId: "agent-jane",
        roleId: "role-support",
        name: "Jane",
        kind: "support",
        toolAssignments: [
          expect.objectContaining({
            id: "assignment-search",
            toolId: "zendesk.search_tickets",
          }),
        ],
      }),
      expect.objectContaining({
        agentId: "agent-james",
        roleId: "role-billing",
        name: "James",
        kind: "billing",
        toolAssignments: [],
      }),
    ]);
  });

  it("uses concrete graph agent config before stale role snapshot config", () => {
    const manifest = createManifest();
    const agents = resolveRuntimeAgents({
      ...manifest,
      roles: manifest.roles.map((role) =>
        role.id === "role-support"
          ? {
              ...role,
              name: "Stale Jane",
              modelProvider: "openai",
              modelId: "gpt-stale",
              realtimeProvider: "openai-realtime",
              realtimeModelId: "gpt-realtime-stale",
              voiceConfig: {
                provider: "cartesia" as const,
                voiceId: "voice-stale",
                label: "Stale voice",
                sourceType: "catalog" as const,
              },
              realtimeVoiceConfig: {
                provider: "openai-realtime" as const,
                voice: "alloy" as const,
              },
            }
          : role,
      ),
      graph: {
        ...manifest.graph,
        nodes: manifest.graph.nodes.map((node) =>
          node.id === "agent-jane"
            ? {
                ...node,
                config: {
                  role: {
                    kind: "support",
                    name: "Jane",
                    businessName: "Zara AI",
                    instructions: "Fresh concrete support instructions.",
                    defaultModelTier: "sota",
                    modelProvider: "google-gemini",
                    modelId: "gemini-agent",
                    realtimeProvider: "gemini-live",
                    realtimeModelId: "gemini-live-agent",
                    runtimeProfileOverride: "balanced",
                    voiceConfig: {
                      provider: "cartesia" as const,
                      voiceId: "voice-agent",
                      label: "Agent voice",
                      sourceType: "catalog" as const,
                      speed: 1.08,
                    },
                    realtimeVoiceConfig: {
                      provider: "gemini-live" as const,
                      voiceName: "Aoede" as const,
                    },
                    languagePolicy: {
                      defaultLanguage: "fr",
                      supportedLanguages: ["fr", "en"],
                      allowMidCallSwitching: true,
                    },
                  },
                },
              }
            : node,
        ),
      },
    });

    expect(agents[0]).toMatchObject({
      agentId: "agent-jane",
      roleId: "role-support",
      name: "Jane",
      defaultModelTier: "sota",
      modelProvider: "google-gemini",
      modelId: "gemini-agent",
      realtimeProvider: "gemini-live",
      realtimeModelId: "gemini-live-agent",
      runtimeProfileOverride: "balanced",
      voiceConfig: {
        voiceId: "voice-agent",
        speed: 1.08,
      },
      realtimeVoiceConfig: {
        provider: "gemini-live",
        voiceName: "Aoede",
      },
      languagePolicy: {
        defaultLanguage: "fr",
        supportedLanguages: ["fr", "en"],
        allowMidCallSwitching: true,
      },
    });
    expect(agents[0]?.name).not.toBe("Stale Jane");
  });

  it("builds a constrained runtime context for tool execution", () => {
    const context = createAgentRuntimeContext({
      manifest: createManifest(),
      activeAgentId: "agent-jane",
      callSessionId: "session-1",
      actorUserId: "user-1",
    });

    expect(context).toMatchObject({
      organizationId: "tenant-1",
      workspaceId: "workspace-1",
      callSessionId: "session-1",
      actorUserId: "user-1",
      manifest: {
        manifestId: "manifest-1",
        version: 1,
        publishedVersionId: "published-1",
        workflowId: "workflow-1",
      },
      agent: {
        agentId: "agent-jane",
        roleId: "role-support",
        name: "Jane",
        kind: "support",
      },
    });
    expect(context).not.toHaveProperty("graph");
    expect(context).not.toHaveProperty("roles");
    expect(context).not.toHaveProperty("routePolicies");
  });
});

function createManifest(): CompiledRuntimeManifest {
  return {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    environment: "sandbox",
    manifestId: "manifest-1",
    publishedVersionId: "published-1",
    workflowId: "workflow-1",
    version: 1,
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryRoleId: "role-support",
    entryNodeId: "entry",
    roles: [
      {
        id: "role-support",
        kind: "support",
        name: "Jane",
        businessName: "Zara AI",
        instructions: "Help support callers.",
        defaultModelTier: "standard",
        toolIds: ["zendesk.search_tickets"],
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
      },
      {
        id: "role-billing",
        kind: "billing",
        name: "James",
        businessName: "Zara AI",
        instructions: "Help billing callers.",
        defaultModelTier: "standard",
        toolIds: [],
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
      },
    ],
    tools: [],
    graph: {
      id: "workflow-1",
      name: "Support workflow",
      nodes: [
        { id: "entry", kind: "entry", label: "Inbound call", position: { x: 0, y: 0 }, config: {} },
        { id: "agent-jane", kind: "agent", label: "Stale label", roleId: "role-support", position: { x: 120, y: 0 }, config: {} },
        { id: "agent-james", kind: "agent", label: "Another stale label", roleId: "role-billing", position: { x: 320, y: 0 }, config: {} },
      ],
      edges: [],
    },
    modelRouting: [],
    escalation: {
      enabled: true,
      fallbackMode: "callback",
      triggers: ["user-request"],
      fallbackMessage: "A specialist will follow up.",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    toolBindings: [],
    agentToolAssignments: [
      {
        id: "assignment-search",
        roleId: "role-support",
        toolId: "zendesk.search_tickets",
        label: "Search tickets",
        description: "Search support tickets.",
        whenToUse: "Use when a caller asks about a ticket.",
        inputSchema: { type: "object" },
        requiredInputs: [],
        risk: "low",
        requiresHumanApproval: false,
      },
    ],
    handoffs: [],
    conditions: [],
    routePolicies: [],
    returnRoutes: [],
    exitNodes: [],
    escalationNode: null,
    memory: {
      mode: "session-only",
      retrievalScopes: ["session"],
      approvalRequired: false,
    },
    budget: {
      monthlyCapUsd: 100,
      currentSpendUsd: 0,
      projectedCostPerMinuteUsd: 0.12,
      blockOnLimit: true,
    },
    serializedGraph: "{\"nodes\":[],\"edges\":[]}",
    compiledDefinitionHash: "hash-1",
  };
}
