import { describe, expect, it } from "vitest";
import type { CompiledRuntimeManifest, SandwichTextModelProvider, VoiceAgentRole } from "@zara/core";

import { buildSandboxTextSystemPrompt, buildSandboxTextTurnPrompt } from "./sandbox-text-model-prompts";

describe("buildSandboxTextSystemPrompt", () => {
  it("uses configured agent identity and never hardcodes Zara as the agent name", () => {
    const prompt = buildSandboxTextSystemPrompt(createManifest(), {
      id: "agent-billing",
      kind: "billing",
      name: "Maya",
      businessName: "Tuzzy Labs",
      instructions: "Resolve billing questions with a concise next step.",
      defaultModelTier: "standard",
      toolIds: [],
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
      },
    });

    expect(prompt).toContain("Agent name: Maya");
    expect(prompt).toContain("Business name: Tuzzy Labs");
    expect(prompt).toContain("Role type: billing");
    expect(prompt).toContain("Resolve billing questions with a concise next step.");
    expect(prompt).not.toContain("You are Zara");
    expect(prompt).not.toContain("Specialist 1");
  });

  it("adds agent action instructions and safe toolbelt context when tools are available", () => {
    const prompt = buildSandboxTextTurnPrompt({
      manifest: createManifest(),
      activeRole: createRole(),
      transcript: "Can you check order 123?",
      tier: "cheap",
      context: {
        callPhase: "tool-use",
        language: "en",
      },
      agentContext: {
        latestCallerTurn: "Can you check order 123?",
        recentTranscript: [],
        language: "en",
        availableTools: [
          {
            toolAssignmentId: "assignment-order-lookup",
            label: "Order lookup",
            description: "Find an order by ID.",
            whenToUse: "Use when the caller asks about an order.",
            inputSchema: {
              type: "object",
              properties: {
                orderId: { type: "string" },
              },
            },
            requiredInputs: ["orderId"],
            risk: "low",
            requiresHumanApproval: false,
          },
        ],
        toolResults: [
          {
            toolName: "Order lookup",
            status: "completed",
            summary: "Order 123 ships tomorrow.",
            safeOutput: {
              status: "shipping_tomorrow",
            },
          },
        ],
      },
      agentActionMode: true,
    } satisfies Parameters<SandwichTextModelProvider["streamText"]>[0]);

    expect(prompt).toContain("Return exactly one JSON object");
    expect(prompt).toContain("\"type\":\"respond\"");
    expect(prompt).toContain("\"type\":\"call_tool\"");
    expect(prompt).toContain("assignment-order-lookup");
    expect(prompt).toContain("Use when the caller asks about an order.");
    expect(prompt).toContain("Order 123 ships tomorrow.");
    expect(prompt).toContain("If required tool inputs are missing, choose respond");
    expect(prompt).not.toContain("credentialRef");
  });

  it("adds route action instructions when a route menu is available", () => {
    const prompt = buildSandboxTextTurnPrompt({
      manifest: createManifest(),
      activeRole: createRole(),
      transcript: "I have a question about my invoice.",
      tier: "cheap",
      context: {
        callPhase: "discovery",
        language: "en",
      },
      agentContext: {
        latestCallerTurn: "I have a question about my invoice.",
        recentTranscript: [],
        language: "en",
        availableTools: [],
        routeMenu: {
          branches: [
            {
              branchId: "branch-billing",
              label: "Billing",
              description: "Invoice, payment, refund, and subscription questions.",
              examples: ["I need help with an invoice."],
            },
          ],
          fallback: {
            label: "Ask a clarifying question",
            behavior: "clarify_source_agent",
          },
        },
        toolResults: [],
      },
      agentActionMode: true,
    } satisfies Parameters<SandwichTextModelProvider["streamText"]>[0]);

    expect(prompt).toContain("\"type\":\"route_to_agent\"");
    expect(prompt).toContain("\"branchId\":\"...\"");
    expect(prompt).toContain("branch-billing");
    expect(prompt).toContain("Ask a clarifying question");
    expect(prompt).not.toContain("targetNodeId");
    expect(prompt).not.toContain("targetAgentId");
  });
});

function createRole(): VoiceAgentRole {
  return {
    id: "agent-billing",
    kind: "billing",
    name: "Maya",
    businessName: "Tuzzy Labs",
    instructions: "Resolve billing questions with a concise next step.",
    defaultModelTier: "standard",
    toolIds: [],
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      allowMidCallSwitching: false,
    },
  };
}

function createManifest(): CompiledRuntimeManifest {
  return {
    manifestId: "manifest-live-sandbox",
    publishedVersionId: "published-1",
    workflowId: "workflow-live-sandbox",
    version: 1,
    tenantId: "tenant-west-africa",
    environment: "production",
    workspaceId: "workspace-default",
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryNodeId: "entry",
    entryRoleId: "agent-billing",
    roles: [],
    tools: [],
    graph: {
      id: "workflow-billing",
      name: "Billing workflow",
      nodes: [],
      edges: [],
    },
    modelRouting: [],
    escalation: {
      enabled: false,
      fallbackMode: "ticket",
      triggers: [],
      fallbackMessage: "",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    toolBindings: [],
    agentToolAssignments: [],
    handoffs: [],
    conditions: [],
    routePolicies: [],
    exitNodes: [],
    escalationNode: null,
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 1000,
      currentSpendUsd: 100,
      projectedCostPerMinuteUsd: 0.3,
      blockOnLimit: true,
    },
    serializedGraph: "{\"nodes\":[],\"edges\":[]}",
    compiledDefinitionHash: "hash-live-sandbox",
  };
}
