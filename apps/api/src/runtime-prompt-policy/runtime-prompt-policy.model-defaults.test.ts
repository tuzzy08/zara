import { describe, expect, it } from "vitest";
import type { CompiledRuntimeManifest } from "@zara/core";

import { defaultRuntimePromptPolicy } from "./runtime-prompt-policy.models";
import { applyRuntimePromptPolicyModelDefaultsToManifest } from "./runtime-prompt-policy.model-defaults";

describe("applyRuntimePromptPolicyModelDefaultsToManifest", () => {
  it("fills missing runtime provider fields from platform agent class defaults", () => {
    const manifest = createManifest();
    const billingTemplate = getDefaultBillingTemplate();
    const policy = {
      ...defaultRuntimePromptPolicy,
      agentClassTemplates: {
        ...defaultRuntimePromptPolicy.agentClassTemplates,
        billing: {
          ...billingTemplate,
          modelDefaults: {
            text: {
              provider: "google-gemini" as const,
              modelTier: "standard" as const,
              modelId: "gemini-billing-default",
            },
            realtime: {
              provider: "gemini-live" as const,
              modelId: "gemini-live-billing-default",
            },
          },
        },
      },
    };

    const projected = applyRuntimePromptPolicyModelDefaultsToManifest(manifest, policy);
    const role = projected.graph.nodes.find((node) => node.id === "agent-billing")?.config["role"];

    expect(role).toMatchObject({
      kind: "billing",
      defaultModelTier: "standard",
      modelProvider: "google-gemini",
      modelId: "gemini-billing-default",
      realtimeProvider: "gemini-live",
      realtimeModelId: "gemini-live-billing-default",
    });
    expect(manifest.graph.nodes.find((node) => node.id === "agent-billing")?.config["role"]).not.toHaveProperty(
      "modelProvider",
    );
  });

  it("overrides stale tenant provider fields with platform-admin model defaults", () => {
    const manifest = createManifest({
      modelProvider: "openai",
      modelId: "openai-explicit",
      realtimeProvider: "openai-realtime",
      realtimeModelId: "realtime-explicit",
    });
    const billingTemplate = getDefaultBillingTemplate();
    const policy = {
      ...defaultRuntimePromptPolicy,
      agentClassTemplates: {
        ...defaultRuntimePromptPolicy.agentClassTemplates,
        billing: {
          ...billingTemplate,
          modelDefaults: {
            text: {
              provider: "google-gemini" as const,
              modelTier: "standard" as const,
              modelId: "gemini-billing-default",
            },
            realtime: {
              provider: "gemini-live" as const,
              modelId: "gemini-live-billing-default",
            },
          },
        },
      },
    };

    const projected = applyRuntimePromptPolicyModelDefaultsToManifest(manifest, policy);
    const role = projected.graph.nodes.find((node) => node.id === "agent-billing")?.config["role"];

    expect(role).toMatchObject({
      defaultModelTier: "standard",
      modelProvider: "google-gemini",
      modelId: "gemini-billing-default",
      realtimeProvider: "gemini-live",
      realtimeModelId: "gemini-live-billing-default",
    });
  });

  it("removes stale tenant model IDs when platform defaults use provider-managed models", () => {
    const projected = applyRuntimePromptPolicyModelDefaultsToManifest(createManifest({
      modelId: "tenant-text-model",
      realtimeModelId: "tenant-realtime-model",
    }), defaultRuntimePromptPolicy);
    const role = projected.graph.nodes.find((node) => node.id === "agent-billing")?.config["role"];

    expect(role).not.toHaveProperty("modelId");
    expect(role).not.toHaveProperty("realtimeModelId");
    expect(role).toMatchObject({
      modelProvider: "openai",
      realtimeProvider: "openai-realtime",
    });
  });
});

function getDefaultBillingTemplate() {
  const template = defaultRuntimePromptPolicy.agentClassTemplates.billing;

  if (template === undefined) {
    throw new Error("Default billing template is missing.");
  }

  return template;
}

function createManifest(
  explicitRoleFields: Record<string, unknown> = {},
): CompiledRuntimeManifest {
  return {
    tenantId: "tenant-1",
    workspaceId: "workspace-default",
    environment: "sandbox",
    manifestId: "manifest-1",
    publishedVersionId: "published-1",
    workflowId: "workflow-1",
    version: 1,
    runtime: "sandwich-pipeline",
    runtimeProfile: "premium-realtime",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryAgentId: "agent-billing",
    entryNodeId: "entry",
    tools: [],
    graph: {
      id: "workflow-1",
      name: "Billing flow",
      nodes: [
        {
          id: "entry",
          kind: "entry",
          label: "Inbound call",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "agent-billing",
          kind: "agent",
          label: "Billing",
          position: { x: 120, y: 0 },
          config: {
            role: {
              kind: "billing",
              name: "Billing",
              businessName: "Zara AI",
              instructions: "Handle billing.",
              defaultModelTier: "cheap",
              runtimeProfileOverride: "premium-realtime",
              languagePolicy: {
                defaultLanguage: "en",
                supportedLanguages: ["en"],
                allowMidCallSwitching: true,
              },
              ...explicitRoleFields,
            },
          },
        },
      ],
      edges: [],
    },
    modelRouting: [],
    escalation: {
      enabled: false,
      fallbackMode: "ticket",
      fallbackMessage: "",
      triggers: [],
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
    routePolicies: [],
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
      projectedCostPerMinuteUsd: 0.1,
      blockOnLimit: true,
    },
    serializedGraph: "{}",
    compiledDefinitionHash: "hash",
  };
}
