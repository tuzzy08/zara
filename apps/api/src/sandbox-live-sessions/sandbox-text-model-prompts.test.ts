import { describe, expect, it } from "vitest";
import type { CompiledRuntimeManifest, VoiceAgentRole } from "@zara/core";

import { buildSandboxTextSystemPrompt } from "./sandbox-text-model-prompts";

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
});

function createManifest(): CompiledRuntimeManifest {
  return {
    manifestId: "manifest-live-sandbox",
    publishedVersionId: "published-1",
    version: 1,
    tenantId: "tenant-west-africa",
    environment: "production",
    workspaceId: "workspace-operations",
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
    handoffs: [],
    conditions: [],
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
