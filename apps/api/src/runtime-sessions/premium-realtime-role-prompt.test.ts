import { describe, expect, it } from "vitest";

import { resolveRuntimeAgent, type CompiledRuntimeManifest } from "@zara/core";

import { buildPremiumRealtimeRolePrompt } from "./premium-realtime-role-prompt";

describe("buildPremiumRealtimeRolePrompt", () => {
  it("lists router handoff as a tool without exposing branch copy", () => {
    const manifest = buildRouterManifest();

    const prompt = buildPremiumRealtimeRolePrompt({
      manifest,
      role: manifest.roles[0]!,
      agent: resolveRuntimeAgent(manifest, "agent-front"),
    });

    expect(prompt).toContain("# Available Zara tools");
    expect(prompt).toContain("Handoff caller (`zara_handoff_to_agent`)");
    expect(prompt).toContain("agent-billing");
    expect(prompt).toContain("Billing specialist");
    expect(prompt).not.toContain("No tools are assigned");
    expect(prompt).not.toContain("branch-billing");
    expect(prompt).not.toContain("agent-stale");
    expect(prompt).not.toContain("New Agent");
    expect(prompt).not.toContain("Target agent role is not configured");
    expect(prompt).not.toContain("Caller needs billing help.");
    expect(prompt).not.toContain("Caller needs a deleted specialist.");
    expect(prompt).not.toContain("I have a billing question.");
  });

  it("omits router instructions and handoff tools when all branch targets are stale", () => {
    const manifest = {
      ...buildRouterManifest(),
      routePolicies: [
        {
          ...buildRouterManifest().routePolicies[0]!,
          branches: [
            {
              id: "branch-stale",
              label: "Stale",
              intentKey: "stale",
              target: {
                type: "agent",
                agentId: "agent-stale",
              },
            },
          ],
        },
      ],
    } as CompiledRuntimeManifest;

    const prompt = buildPremiumRealtimeRolePrompt({
      manifest,
      role: manifest.roles[0]!,
      agent: resolveRuntimeAgent(manifest, "agent-front"),
    });

    expect(prompt).not.toContain("# Routing");
    expect(prompt).not.toContain("Handoff caller (`zara_handoff_to_agent`)");
    expect(prompt).not.toContain("Configured handoff targets");
    expect(prompt).not.toContain("agent-stale");
    expect(prompt).not.toContain("New Agent");
    expect(prompt).toContain("No tools are assigned");
  });
});

function buildRouterManifest(): CompiledRuntimeManifest {
  return {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    environment: "sandbox",
    manifestId: "manifest-1",
    publishedVersionId: "published-1",
    workflowId: "workflow-1",
    version: 1,
    runtime: "openai-realtime",
    runtimeProfile: "premium-realtime",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryAgentId: "agent-front",
    entryNodeId: "entry",
    roles: [
      {
        id: "role-router",
        kind: "receptionist",
        name: "Front desk",
        businessName: "Zara AI",
        instructions: "Route callers to the right specialist.",
        defaultModelTier: "cheap",
        runtimeProfileOverride: "premium-realtime",
        realtimeProvider: "openai-realtime",
        toolIds: [],
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
      },
      {
        id: "role-billing",
        kind: "billing",
        name: "Billing specialist",
        businessName: "Zara AI",
        instructions: "Resolve invoice and payment questions.",
        defaultModelTier: "standard",
        runtimeProfileOverride: "premium-realtime",
        realtimeProvider: "openai-realtime",
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
        { id: "entry", kind: "entry", label: "Entry", position: { x: 0, y: 0 }, config: {} },
        {
          id: "agent-front",
          kind: "agent",
          label: "Front desk",
          roleId: "role-router",
          position: { x: 120, y: 0 },
          config: {
            role: {
              kind: "receptionist",
              name: "Front desk",
              businessName: "Zara AI",
              instructions: "Route callers to the right specialist.",
              defaultModelTier: "cheap",
              runtimeProfileOverride: "premium-realtime",
              realtimeProvider: "openai-realtime",
              toolIds: [],
              languagePolicy: {
                defaultLanguage: "en",
                supportedLanguages: ["en"],
                allowMidCallSwitching: false,
              },
            },
          },
        },
        {
          id: "agent-billing",
          kind: "agent",
          label: "Billing specialist",
          roleId: "role-billing",
          position: { x: 320, y: 0 },
          config: {
            role: {
              kind: "billing",
              name: "Billing specialist",
              businessName: "Zara AI",
              instructions: "Resolve invoice and payment questions.",
              defaultModelTier: "standard",
              runtimeProfileOverride: "premium-realtime",
              realtimeProvider: "openai-realtime",
              toolIds: [],
              languagePolicy: {
                defaultLanguage: "en",
                supportedLanguages: ["en"],
                allowMidCallSwitching: false,
              },
            },
          },
        },
        {
          id: "agent-stale",
          kind: "agent",
          label: "New Agent",
          roleId: "role-stale",
          position: { x: 520, y: 0 },
          config: {},
        },
      ],
      edges: [
        {
          id: "edge-entry-front",
          sourceNodeId: "entry",
          targetNodeId: "agent-front",
        },
      ],
    },
    modelRouting: [],
    escalation: {
      enabled: true,
      fallbackMode: "callback",
      triggers: ["user-request"],
      fallbackMessage: "A specialist will call back.",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    toolBindings: [],
    agentToolAssignments: [],
    conditions: [],
    routePolicies: [
      {
        sourceAgentId: "agent-front",
        sourceAgentName: "Front desk",
        type: "route_by_intent",
        trigger: "on_caller_turn_end",
        activation: "until_routed",
        classifier: {
          mode: "standard",
          modelAlias: "intent-classifier-fast",
          confidenceThreshold: 0.65,
        },
        inputWindow: {
          latestCallerTurn: true,
          recentTranscriptTurns: 6,
          includeConversationSummary: true,
          includePreviousAgentContext: true,
          includeRecentToolResults: true,
        },
        readiness: {
          mode: "auto_with_clarification",
          maxClarificationTurns: 2,
        },
        announcement: {
          mode: "template",
          text: "I'll connect you with {targetAgentName}.",
        },
        branches: [
          {
            id: "branch-billing",
            label: "Billing",
            intentKey: "billing",
            target: {
              type: "agent",
              agentId: "agent-billing",
            },
          },
          {
            id: "branch-stale",
            label: "Stale",
            intentKey: "stale",
            target: {
              type: "agent",
              agentId: "agent-stale",
            },
          },
        ],
        fallback: {
          label: "Clarify",
          target: {
            type: "clarify_source_agent",
          },
        },
      },
    ],
    returnRoutes: [],
    exitNodes: [],
    escalationNode: null,
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 100,
      currentSpendUsd: 0,
      projectedCostPerMinuteUsd: 0.25,
      blockOnLimit: true,
    },
    serializedGraph: "{\"nodes\":[],\"edges\":[]}",
    compiledDefinitionHash: "hash-1",
  };
}
