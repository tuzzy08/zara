import { describe, expect, it } from "vitest";

import {
  resolveIntentRouteClassification,
  type IntentRouteNodeConfig,
} from "./intent-routing";

describe("resolveIntentRouteClassification", () => {
  it("routes a valid model match through the configured branch target", () => {
    const route = buildIntentRouteConfig();

    expect(
      resolveIntentRouteClassification({
        nodeId: "condition-intent",
        route,
        output: {
          matchedBranchId: "branch-billing",
          intentKey: "billing",
          confidence: 0.86,
          reason: "The caller is asking about an invoice.",
          usedFallback: false,
        },
      }),
    ).toEqual({
      result: {
        nodeId: "condition-intent",
        matchedBranchId: "branch-billing",
        intentKey: "billing",
        label: "Billing",
        confidence: 0.86,
        reason: "The caller is asking about an invoice.",
        usedFallback: false,
        targetNodeId: "agent-billing",
      },
    });
  });

  it("uses fallback for low confidence matches", () => {
    const route = buildIntentRouteConfig();

    expect(
      resolveIntentRouteClassification({
        nodeId: "condition-intent",
        route,
        output: {
          matchedBranchId: "branch-billing",
          intentKey: "billing",
          confidence: 0.42,
          reason: "The billing signal is weak.",
          usedFallback: false,
        },
      }),
    ).toEqual({
      result: {
        nodeId: "condition-intent",
        matchedBranchId: null,
        intentKey: null,
        label: null,
        confidence: 0.42,
        reason: "Classifier confidence 0.42 was below threshold 0.65.",
        usedFallback: true,
        targetNodeId: "agent-front-desk",
      },
      warning: {
        code: "intent_classifier.low_confidence",
        message: "Intent classifier confidence was below the configured threshold.",
        recoverable: true,
      },
    });
  });

  it("uses fallback for malformed or unknown classifier output", () => {
    const route = buildIntentRouteConfig();

    expect(
      resolveIntentRouteClassification({
        nodeId: "condition-intent",
        route,
        output: {
          matchedBranchId: "branch-upgrade",
          intentKey: "upgrade",
          confidence: 0.98,
          reason: "The caller wants to upgrade.",
          usedFallback: false,
        },
      }),
    ).toEqual({
      result: expect.objectContaining({
        matchedBranchId: null,
        intentKey: null,
        usedFallback: true,
        targetNodeId: "agent-front-desk",
      }),
      warning: {
        code: "intent_classifier.unknown_branch",
        message: "Intent classifier selected an unknown branch.",
        recoverable: true,
      },
    });

    expect(
      resolveIntentRouteClassification({
        nodeId: "condition-intent",
        route,
        output: {
          matchedBranchId: "branch-billing",
          intentKey: "billing",
          reason: "Missing confidence.",
          usedFallback: false,
        },
      }),
    ).toEqual({
      result: expect.objectContaining({
        confidence: 0,
        usedFallback: true,
        targetNodeId: "agent-front-desk",
      }),
      warning: {
        code: "intent_classifier.invalid_output",
        message: "Intent classifier returned invalid structured output.",
        recoverable: true,
      },
    });
  });

  it("honors classifier-selected fallback", () => {
    const route = buildIntentRouteConfig();

    expect(
      resolveIntentRouteClassification({
        nodeId: "condition-intent",
        route,
        output: {
          matchedBranchId: null,
          intentKey: null,
          confidence: 0.74,
          reason: "The request spans multiple intents.",
          usedFallback: true,
        },
      }),
    ).toEqual({
      result: {
        nodeId: "condition-intent",
        matchedBranchId: null,
        intentKey: null,
        label: null,
        confidence: 0.74,
        reason: "The request spans multiple intents.",
        usedFallback: true,
        targetNodeId: "agent-front-desk",
      },
    });
  });
});

function buildIntentRouteConfig(): IntentRouteNodeConfig {
  return {
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
    branches: [
      {
        id: "branch-billing",
        label: "Billing",
        intentKey: "billing",
        description: "The caller needs help with invoices, payments, refunds, or balances.",
        examples: ["I need a copy of my invoice.", "Why was I charged twice?"],
        targetNodeId: "agent-billing",
      },
      {
        id: "branch-support",
        label: "Support",
        intentKey: "support",
        description: "The caller needs product or account support.",
        examples: ["I cannot sign in.", "The app is not loading."],
        targetNodeId: "agent-support",
      },
    ],
    fallback: {
      label: "General support",
      targetNodeId: "agent-front-desk",
    },
  };
}
