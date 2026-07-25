import type {
  CompiledRuntimeManifest,
  RealtimeProviderId,
} from "@zara/core";
import { describe, expect, it } from "vitest";

import { resolvePremiumPstnRequiredProviders } from "./premium-pstn-worker-requirements";

describe("resolvePremiumPstnRequiredProviders", () => {
  it("includes provider overrides for every route-reachable agent", () => {
    const manifest = buildManifest({
      entryAgentId: "agent-router",
      agents: [
        { id: "agent-router", provider: "openai-realtime" },
        { id: "agent-billing", provider: "gemini-live" },
        { id: "agent-retention" },
      ],
      routes: [
        {
          sourceAgentId: "agent-router",
          targets: ["agent-billing"],
          fallbackAgentId: "agent-retention",
        },
      ],
    });

    expect(
      resolvePremiumPstnRequiredProviders({
        manifest,
        defaultProvider: "openai-realtime",
      }),
    ).toEqual(["openai-realtime", "gemini-live"]);
  });

  it("does not require providers used only by unrelated agents", () => {
    const manifest = buildManifest({
      entryAgentId: "agent-front",
      agents: [
        { id: "agent-front" },
        { id: "agent-unrelated", provider: "gemini-live" },
      ],
      routes: [],
    });

    expect(
      resolvePremiumPstnRequiredProviders({
        manifest,
        defaultProvider: "openai-realtime",
      }),
    ).toEqual(["openai-realtime"]);
  });

  it("requires the default provider when the entry agent cannot be resolved", () => {
    const manifest = buildManifest({
      entryAgentId: "agent-missing",
      agents: [],
      routes: [],
    });

    expect(
      resolvePremiumPstnRequiredProviders({
        manifest,
        defaultProvider: "openai-realtime",
      }),
    ).toEqual(["openai-realtime"]);
  });
});

function buildManifest(input: {
  entryAgentId: string;
  agents: Array<{
    id: string;
    provider?: RealtimeProviderId | undefined;
  }>;
  routes: Array<{
    sourceAgentId: string;
    targets: string[];
    fallbackAgentId?: string | undefined;
  }>;
}) {
  return {
    entryAgentId: input.entryAgentId,
    agentToolAssignments: [],
    graph: {
      id: "workflow-test",
      name: "Test workflow",
      nodes: input.agents.map((agent) => ({
        id: agent.id,
        kind: "agent" as const,
        label: agent.id,
        position: { x: 0, y: 0 },
        config: {
          role: {
            name: agent.id,
            kind: "specialist",
            businessName: "Zara",
            instructions: "Help the caller.",
            defaultModelTier: "standard" as const,
            ...(agent.provider === undefined
              ? {}
              : { realtimeProvider: agent.provider }),
            languagePolicy: {
              defaultLanguage: "en",
              supportedLanguages: ["en"],
              allowMidCallSwitching: false,
            },
          },
        },
      })),
      edges: [],
    },
    routePolicies: input.routes.map((route) => ({
      sourceAgentId: route.sourceAgentId,
      sourceAgentName: route.sourceAgentId,
      type: "route_by_intent" as const,
      trigger: "on_caller_turn_end" as const,
      activation: "until_routed" as const,
      classifier: {
        mode: "standard" as const,
        modelAlias: "intent-classifier-fast" as const,
        confidenceThreshold: 0.7,
      },
      inputWindow: {
        latestCallerTurn: true,
        recentTranscriptTurns: 3,
        includeConversationSummary: true,
        includePreviousAgentContext: true,
        includeRecentToolResults: true,
      },
      readiness: {
        mode: "auto_with_clarification" as const,
      },
      announcement: {
        mode: "template" as const,
      },
      branches: route.targets.map((agentId, index) => ({
        id: `branch-${index}`,
        label: agentId,
        intentKey: agentId,
        target: {
          type: "agent" as const,
          agentId,
        },
      })),
      fallback: {
        label: "Fallback",
        target: route.fallbackAgentId === undefined
          ? { type: "clarify_source_agent" as const }
          : {
              type: "agent" as const,
              agentId: route.fallbackAgentId,
            },
      },
    })),
  } satisfies Pick<
    CompiledRuntimeManifest,
    "agentToolAssignments" | "entryAgentId" | "graph" | "routePolicies"
  >;
}
