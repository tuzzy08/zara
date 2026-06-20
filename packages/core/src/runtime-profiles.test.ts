import { describe, expect, it } from "vitest";

import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createHandoffNode,
  createPremiumRealtimeSession,
  createPremiumRealtimeSessionObservedEvents,
  createWorkflowGraph,
  estimateRuntimeCost,
  publishWorkflowVersion,
  resolveRuntimeProfilePolicy,
  selectModelRoutingDecision,
  type ModelRoutingRule,
  type RuntimePricingCatalog,
} from "./index";

const pricing: RuntimePricingCatalog = {
  telephonyPerMinuteUsd: {
    "browser-webrtc": 0,
  },
  sttPerMinuteUsd: 0.007,
  modelPer1kInputTokensUsd: {
    cheap: 0.0004,
    standard: 0.003,
    sota: 0.012,
    rules: 0,
  },
  modelPer1kOutputTokensUsd: {
    cheap: 0.0008,
    standard: 0.006,
    sota: 0.024,
    rules: 0,
  },
  ttsPer1kCharactersUsd: 0.015,
  storagePerMbUsd: 0.00005,
};

const routingRules: ModelRoutingRule[] = [
  {
    id: "route-greeting-cheap",
    priority: 10,
    when: {
      callPhase: "greeting",
      language: "en",
    },
    useTier: "cheap",
    reason: "Greeting turns can stay on the cheapest tier.",
  },
];

describe("runtime profiles", () => {
  it("uses the balanced profile routing floor, stronger tts voice, and higher estimated cost", () => {
    const balancedManifest = compileRuntimeManifest({
      publishedVersion: createPublishedWorkflowVersion({
        runtimeProfile: "balanced",
        frontDeskRuntimeProfileOverride: "balanced",
      }),
      modelRouting: routingRules,
      telemetry: {
        captureAudio: false,
        captureTranscript: true,
        redactSensitiveData: true,
        sinks: ["live-monitor"],
      },
    });
    const costOptimizedManifest = compileRuntimeManifest({
      publishedVersion: createPublishedWorkflowVersion(),
      modelRouting: routingRules,
      telemetry: {
        captureAudio: false,
        captureTranscript: true,
        redactSensitiveData: true,
        sinks: ["live-monitor"],
      },
    });

    const balancedProfile = resolveRuntimeProfilePolicy({
      manifest: balancedManifest,
      activeRoleId: "agent-front-desk",
    });
    const balancedDecision = selectModelRoutingDecision({
      manifest: balancedManifest,
      activeRoleId: "agent-front-desk",
      context: {
        callPhase: "discovery",
        language: "en",
        confidence: 0.64,
      },
    });
    const balancedEstimate = estimateRuntimeCost({
      manifest: balancedManifest,
      pricing,
      usage: {
        callMinutes: 3,
        sttMinutes: 3,
        modelInputTokens: 1800,
        modelOutputTokens: 2400,
        ttsCharacters: 1200,
        storageMb: 2,
      },
      modelTier: balancedDecision.tier,
      activeRoleId: "agent-front-desk",
    });
    const costOptimizedEstimate = estimateRuntimeCost({
      manifest: costOptimizedManifest,
      pricing,
      usage: {
        callMinutes: 3,
        sttMinutes: 3,
        modelInputTokens: 1800,
        modelOutputTokens: 2400,
        ttsCharacters: 1200,
        storageMb: 2,
      },
      modelTier: "cheap",
      activeRoleId: "agent-front-desk",
    });

    expect(balancedProfile).toMatchObject({
      id: "balanced",
      ttsVoice: "neural-hd",
    });
    expect(balancedDecision).toMatchObject({
      tier: "standard",
      source: "profile_default",
    });
    expect(balancedEstimate.totalUsd).toBeGreaterThan(costOptimizedEstimate.totalUsd);
  });

  it("creates premium realtime sessions only when policy allows it and observes tool plus handoff activity", () => {
    const premiumManifest = compileRuntimeManifest({
      publishedVersion: createPublishedWorkflowVersion({
        runtime: "openai-realtime",
        runtimeProfile: "premium-realtime",
        billingRuntimeProfileOverride: "premium-realtime",
      }),
      modelRouting: routingRules,
      telemetry: {
        captureAudio: false,
        captureTranscript: true,
        redactSensitiveData: true,
        sinks: ["live-monitor", "opentelemetry"],
      },
    });

    const session = createPremiumRealtimeSession({
      manifest: premiumManifest,
      activeRoleId: "agent-billing",
      budgetAllowed: true,
      now: () => "2026-05-14T10:20:00.000Z",
    });
    const toolEvents = createPremiumRealtimeSessionObservedEvents({
      session,
      callSessionId: "call-premium-1",
      tenantId: premiumManifest.tenantId,
      at: "2026-05-14T10:21:00.000Z",
      action: {
        type: "tool",
        nodeId: "tool-customer-profile",
        toolId: "hubspot.profile.lookup",
        summary: "Fetched account profile",
      },
    });
    const handoffEvents = createPremiumRealtimeSessionObservedEvents({
      session,
      callSessionId: "call-premium-1",
      tenantId: premiumManifest.tenantId,
      at: "2026-05-14T10:22:00.000Z",
      action: {
        type: "handoff",
        nodeId: "handoff-billing",
        sourceRoleId: "agent-front-desk",
        targetRoleId: "agent-billing",
        targetRoleName: "Billing specialist",
      },
    });

    expect(session).toMatchObject({
      runtime: "openai-realtime",
      policy: "premium-realtime",
    });
    expect(session.observedEventTypes).toEqual([
      "tool.requested",
      "tool.started",
      "tool.completed",
      "tool.failed",
      "tool.approval_required",
      "agent.handoff.requested",
      "agent.handoff.completed",
    ]);
    expect(toolEvents.map((event) => event.type)).toEqual(["tool.started", "tool.completed"]);
    expect(handoffEvents.map((event) => event.type)).toEqual([
      "agent.handoff.requested",
      "agent.handoff.completed",
    ]);

    expect(() =>
      createPremiumRealtimeSession({
        manifest: compileRuntimeManifest({
          publishedVersion: createPublishedWorkflowVersion(),
          modelRouting: routingRules,
          telemetry: {
            captureAudio: false,
            captureTranscript: true,
            redactSensitiveData: true,
            sinks: ["live-monitor"],
          },
        }),
        activeRoleId: "agent-front-desk",
        budgetAllowed: true,
      }),
    ).toThrowError("Premium realtime is not enabled for role 'agent-front-desk'.");

    expect(() =>
      createPremiumRealtimeSession({
        manifest: premiumManifest,
        activeRoleId: "agent-billing",
        budgetAllowed: false,
      }),
    ).toThrowError("Premium realtime is blocked by the current budget policy.");
  });

  it("creates server-owned Gemini Live premium realtime sessions when a role selects Google realtime", () => {
    const premiumManifest = compileRuntimeManifest({
      publishedVersion: createPublishedWorkflowVersion({
        runtime: "openai-realtime",
        runtimeProfile: "premium-realtime",
        billingRuntimeProfileOverride: "premium-realtime",
        billingRealtimeProvider: "gemini-live",
      }),
      modelRouting: routingRules,
      telemetry: {
        captureAudio: false,
        captureTranscript: true,
        redactSensitiveData: true,
        sinks: ["live-monitor", "opentelemetry"],
      },
    });

    const session = createPremiumRealtimeSession({
      manifest: premiumManifest,
      activeRoleId: "agent-billing",
      budgetAllowed: true,
      now: () => "2026-05-14T10:20:00.000Z",
    });

    expect(session).toMatchObject({
      runtime: "gemini-live",
      model: "gemini-3.1-flash-live-preview",
    });
    expect(session.transportUrl).toMatch(/^\/runtime\/realtime\/sessions\//);
    expect(session.transportUrl).not.toContain("generativelanguage.googleapis.com");
  });
});

function createPublishedWorkflowVersion(input?: {
  runtime?: "sandwich-pipeline" | "openai-realtime";
  runtimeProfile?: "cost-optimized" | "balanced" | "premium-realtime";
  frontDeskRuntimeProfileOverride?: "balanced" | "premium-realtime";
  billingRuntimeProfileOverride?: "balanced" | "premium-realtime";
  billingRealtimeProvider?: "openai-realtime" | "gemini-live";
}) {
  const graph = createWorkflowGraph({
    id: "workflow-runtime-profiles",
    name: "Runtime profiles",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 160, y: 80 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Greet the caller, gather context, and route safely.",
          defaultModelTier: "cheap",
          runtimeProfileOverride: input?.frontDeskRuntimeProfileOverride,
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en", "fr"],
            allowMidCallSwitching: true,
          },
        },
      }),
      createConditionNode({
        id: "condition-billing",
        label: "Intent route",
        position: { x: 420, y: 80 },
        condition: {
          branches: [
            {
              id: "billing",
              label: "Billing",
              expression: 'intent == "billing"',
              targetNodeId: "handoff-billing",
            },
          ],
          fallbackLabel: "Resolved",
          fallbackTargetNodeId: "end-resolved",
        },
      }),
      createHandoffNode({
        id: "handoff-billing",
        label: "Billing handoff",
        position: { x: 660, y: 80 },
        handoff: {
          targetRoleId: "agent-billing",
          targetRoleName: "Billing specialist",
          handoffReason: "Route invoice and refund disputes to billing.",
        },
      }),
      createAgentRoleNode({
        id: "agent-billing",
        label: "Billing specialist",
        position: { x: 900, y: 80 },
        role: {
          kind: "billing",
          name: "Billing specialist",
          businessName: "Tuzzy Labs",
          instructions: "Handle payment issues, refunds, and subscription disputes.",
          defaultModelTier: "standard",
          runtimeProfileOverride: input?.billingRuntimeProfileOverride,
          ...(input?.billingRealtimeProvider !== undefined
            ? { realtimeProvider: input.billingRealtimeProvider }
            : {}),
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
        },
      }),
      createEndNode({
        id: "end-resolved",
        label: "Resolved exit",
        position: { x: 660, y: 260 },
        end: {
          outcome: "resolved",
          closingMessage: "Close the call after the request is resolved.",
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-condition",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "condition-billing",
      },
      {
        id: "edge-condition-billing",
        sourceNodeId: "condition-billing",
        targetNodeId: "handoff-billing",
        condition: "Billing",
      },
      {
        id: "edge-condition-resolved",
        sourceNodeId: "condition-billing",
        targetNodeId: "end-resolved",
        condition: "Resolved",
      },
      {
        id: "edge-handoff-billing",
        sourceNodeId: "handoff-billing",
        targetNodeId: "agent-billing",
      },
    ],
  });

  return publishWorkflowVersion({
    workflowId: graph.id,
    tenantId: "tenant-west-africa",
    environment: "sandbox",
    createdBy: "user-1",
    graph,
    existingVersions: [],
    runtime: input?.runtime ?? "sandwich-pipeline",
    runtimeProfile: input?.runtimeProfile,
    telephonyProvider: "browser-webrtc",
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 500,
      currentSpendUsd: 40,
      projectedCostPerMinuteUsd: 0.18,
      blockOnLimit: true,
    },
  });
}
