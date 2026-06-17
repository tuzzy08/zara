import { describe, expect, it } from "vitest";

import {
  resolveAgentRoutePolicyClassification,
  resolveIntentRouteClassification,
  type IntentRouteNodeConfig,
} from "./intent-routing";
import type { DraftWorkflowAgentRoutePolicy } from "./workflow";

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

describe("resolveAgentRoutePolicyClassification", () => {
  it("creates packet-ready intent, announcement, and transfer context from a confident configured branch", () => {
    const routePolicy = buildAgentRoutePolicy();
    const recentToolResults = [
      {
        toolCallId: "tool-call-1",
        toolAssignmentId: "tool-assignment-1",
        toolId: "billing-search",
        toolName: "Billing lookup",
        status: "completed" as const,
        summary: "Found invoice INV-1042.",
        durationMs: 54,
        idempotencyKey: "turn-1:tool-call-1",
      },
    ];

    expect(
      resolveAgentRoutePolicyClassification({
        routePolicy,
        sourceAgent: { id: "agent-front-desk", name: "Front desk", kind: "receptionist" },
        targetAgents: [{ id: "agent-billing", name: "Billing specialist", kind: "billing" }],
        transferId: "turn-1:agent-front-desk:agent-billing",
        callerNeedSummary: "The caller needs help understanding invoice INV-1042.",
        recentToolResults,
        output: {
          matchedBranchId: "branch-billing",
          intentKey: "billing",
          confidence: 0.91,
          reason: "The caller is asking about a billing issue.",
          usedFallback: false,
          targetNodeId: "agent-support",
        },
      }),
    ).toEqual({
      intent: {
        nodeId: "agent-front-desk",
        matchedBranchId: "branch-billing",
        intentKey: "billing",
        label: "Billing",
        confidence: 0.91,
        reason: "The caller is asking about a billing issue.",
        usedFallback: false,
        targetNodeId: "agent-billing",
      },
      target: {
        type: "agent",
        agentId: "agent-billing",
      },
      announcementText: "I'll connect you with Billing specialist.",
      transfer: {
        transferId: "turn-1:agent-front-desk:agent-billing",
        sourceAgent: { id: "agent-front-desk", name: "Front desk", kind: "receptionist" },
        targetAgent: { id: "agent-billing", name: "Billing specialist", kind: "billing" },
        reason: "The caller is asking about a billing issue.",
        callerNeedSummary: "The caller needs help understanding invoice INV-1042.",
        matchedIntent: {
          intentKey: "billing",
          label: "Billing",
          confidence: 0.91,
        },
        recentToolResults,
        instructionsToTarget: "Review the invoice context before greeting the caller.",
      },
    });
  });

  it("falls back to the configured clarify-source target without transfer or announcement", () => {
    const routePolicy = buildAgentRoutePolicy();

    expect(
      resolveAgentRoutePolicyClassification({
        routePolicy,
        sourceAgent: { id: "agent-front-desk", name: "Front desk", kind: "receptionist" },
        targetAgents: [{ id: "agent-billing", name: "Billing specialist", kind: "billing" }],
        callerNeedSummary: "The caller may need billing help, but the need is unclear.",
        output: {
          matchedBranchId: "branch-billing",
          intentKey: "billing",
          confidence: 0.31,
          reason: "The billing signal is weak.",
          usedFallback: false,
        },
      }),
    ).toEqual({
      intent: {
        nodeId: "agent-front-desk",
        matchedBranchId: null,
        intentKey: null,
        label: null,
        confidence: 0.31,
        reason: "Classifier confidence 0.31 was below threshold 0.65.",
        usedFallback: true,
        targetNodeId: "agent-front-desk",
      },
      target: {
        type: "clarify_source_agent",
      },
      warning: {
        code: "intent_classifier.low_confidence",
        message: "Intent classifier confidence was below the configured threshold.",
        recoverable: true,
      },
    });
  });

  it("uses the configured fallback target for invalid classifier output", () => {
    const routePolicy = buildAgentRoutePolicy();

    expect(
      resolveAgentRoutePolicyClassification({
        routePolicy,
        sourceAgent: { id: "agent-front-desk", name: "Front desk", kind: "receptionist" },
        targetAgents: [{ id: "agent-billing", name: "Billing specialist", kind: "billing" }],
        callerNeedSummary: "The caller need is not yet clear enough to route.",
        output: "not-json",
      }),
    ).toEqual({
      intent: {
        nodeId: "agent-front-desk",
        matchedBranchId: null,
        intentKey: null,
        label: null,
        confidence: 0,
        reason: "Intent classifier returned invalid structured output.",
        usedFallback: true,
        targetNodeId: "agent-front-desk",
      },
      target: {
        type: "clarify_source_agent",
      },
      warning: {
        code: "intent_classifier.invalid_output",
        message: "Intent classifier returned invalid structured output.",
        recoverable: true,
      },
    });
  });

  it("keeps unclear callers with the source agent when fallback asks for clarification", () => {
    const routePolicy = buildAgentRoutePolicy();

    expect(
      resolveAgentRoutePolicyClassification({
        routePolicy,
        sourceAgent: { id: "agent-front-desk", name: "Front desk", kind: "receptionist" },
        targetAgents: [{ id: "agent-billing", name: "Billing specialist", kind: "billing" }],
        callerNeedSummary: "The caller has not said what they need yet.",
        output: {
          matchedBranchId: "branch-billing",
          intentKey: "billing",
          confidence: 0.41,
          reason: "Billing is possible, but the caller has not given enough context.",
          usedFallback: false,
        },
      }),
    ).toEqual({
      intent: {
        nodeId: "agent-front-desk",
        matchedBranchId: null,
        intentKey: null,
        label: null,
        confidence: 0.41,
        reason: "Classifier confidence 0.41 was below threshold 0.65.",
        usedFallback: true,
        targetNodeId: "agent-front-desk",
      },
      target: {
        type: "clarify_source_agent",
      },
      warning: {
        code: "intent_classifier.low_confidence",
        message: "Intent classifier confidence was below the configured threshold.",
        recoverable: true,
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

function buildAgentRoutePolicy(): DraftWorkflowAgentRoutePolicy {
  return {
    sourceAgentId: "agent-front-desk",
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
        description: "The caller needs help with invoices, payments, refunds, or balances.",
        examples: ["I need a copy of my invoice.", "Why was I charged twice?"],
        target: {
          type: "agent",
          agentId: "agent-billing",
        },
        transferInstructions: "Review the invoice context before greeting the caller.",
      },
      {
        id: "branch-support",
        label: "Support",
        intentKey: "support",
        description: "The caller needs product or account support.",
        examples: ["I cannot sign in.", "The app is not loading."],
        target: {
          type: "agent",
          agentId: "agent-support",
        },
      },
    ],
    fallback: {
      label: "Clarify need",
      target: {
        type: "clarify_source_agent",
      },
    },
  };
}
