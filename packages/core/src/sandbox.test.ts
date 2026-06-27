import { describe, expect, it } from "vitest";

import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createCallEventStream,
  createConditionNode,
  createCostOptimizedSandwichRuntimeAdapter,
  createEndNode,
  createSandboxCallSession,
  createWorkflowGraph,
  estimateRuntimeCost,
  evaluateRuntimeBudget,
  publishWorkflowVersion,
  RuntimeProviderFailure,
  type CallEvent,
  type CompiledRuntimeManifest,
  type ModelRoutingRule,
  type RuntimePricingCatalog,
} from "./index";

const entryNode = {
  id: "entry",
  kind: "entry",
  label: "Inbound call",
  position: { x: 0, y: 0 },
  config: {},
} as const;

const frontDeskAgent = createAgentRoleNode({
  id: "agent-front-desk",
  label: "Front desk triage",
  position: { x: 140, y: 60 },
  role: {
    kind: "receptionist",
    name: "Front desk triage",
    businessName: "Tuzzy Labs",
    instructions: "Greet callers, gather context, and resolve or route safely.",
    defaultModelTier: "cheap",
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en", "fr"],
      allowMidCallSwitching: true,
    },
    toolbeltAssignments: [
      {
        id: "customer-profile-lookup",
        toolId: "hubspot.profile.lookup",
        label: "Customer profile API",
        description: "Customer profile lookup",
        whenToUse: "Use when the caller needs account-specific support context.",
        connector: "hubspot",
        toolName: "Customer profile lookup",
        integrationConnectionId: "hubspot-prod",
        integrationLabel: "HubSpot - Production",
        connectionStatus: "connected",
        risk: "high",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      },
    ],
  },
});

const billingAgent = createAgentRoleNode({
  id: "agent-billing",
  label: "Billing specialist",
  position: { x: 760, y: 180 },
  role: {
    kind: "billing",
    name: "Billing specialist",
    businessName: "Tuzzy Labs",
    instructions: "Handle payment issues, refunds, and subscription disputes.",
    defaultModelTier: "standard",
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      allowMidCallSwitching: false,
    },
  },
});

const resolvedExit = createEndNode({
  id: "end-resolved",
  label: "Resolved exit",
  position: { x: 760, y: 360 },
  end: {
    outcome: "resolved",
    closingMessage: "Thank the caller and close the conversation.",
  },
});

const conditionNode = createConditionNode({
  id: "condition-intent",
  label: "Intent route",
  position: { x: 460, y: 220 },
  condition: {
    branches: [
      {
        id: "branch-billing",
        label: "Billing",
        expression: 'intent == "billing"',
        targetNodeId: "agent-billing",
      },
    ],
    fallbackLabel: "Resolved",
    fallbackTargetNodeId: "end-resolved",
  },
});

const routingRules: ModelRoutingRule[] = [
  {
    id: "route-greeting-cheap",
    priority: 10,
    when: {
      callPhase: "greeting",
      language: "en",
      maxRisk: "low",
    },
    useTier: "cheap",
    reason: "Greeting turns can stay on the cheapest tier.",
  },
  {
    id: "route-billing-standard",
    priority: 20,
    when: {
      intent: "billing",
      callPhase: "discovery",
      minConfidence: 0.7,
    },
    useTier: "standard",
    reason: "Billing discovery needs a stronger reasoning tier.",
  },
  {
    id: "route-escalation-sota",
    priority: 40,
    when: {
      callPhase: "escalation",
      minRisk: "high",
      maxConfidence: 0.45,
    },
    useTier: "sota",
    reason: "Escalations with low confidence and high risk go premium.",
  },
];

const pricing: RuntimePricingCatalog = {
  telephonyPerMinuteUsd: {
    "browser-webrtc": 0,
    twilio: 0.018,
  },
  sttPerMinuteUsd: 0.007,
  modelPer1kInputTokensUsd: {
    cheap: 0.0004,
    standard: 0.003,
    sota: 0.012,
  },
  modelPer1kOutputTokensUsd: {
    cheap: 0.0008,
    standard: 0.006,
    sota: 0.024,
  },
  ttsPer1kCharactersUsd: 0.015,
  storagePerMbUsd: 0.00005,
};

function createPublishedWorkflowVersion() {
  const graph = createWorkflowGraph({
    id: "workflow-sandbox-session",
    name: "Sandbox session",
    nodes: [entryNode, frontDeskAgent, conditionNode, billingAgent, resolvedExit],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-condition",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "condition-intent",
      },
      {
        id: "edge-condition-billing",
        sourceNodeId: "condition-intent",
        targetNodeId: "agent-billing",
        condition: "Billing",
      },
      {
        id: "edge-condition-resolved",
        sourceNodeId: "condition-intent",
        targetNodeId: "end-resolved",
        condition: "Resolved",
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
    runtime: "sandwich-pipeline",
    telephonyProvider: "browser-webrtc",
    memory: {
      mode: "scoped",
      retrievalScopes: ["session", "caller"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 80,
      currentSpendUsd: 18,
      projectedCostPerMinuteUsd: 0.22,
      blockOnLimit: true,
    },
  });
}

function createManifest(): CompiledRuntimeManifest {
  return compileRuntimeManifest({
    publishedVersion: createPublishedWorkflowVersion(),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor", "opentelemetry"],
    },
    availableIntegrationConnectionIds: ["hubspot-prod"],
  });
}

function event(type: CallEvent["type"], id: string, at: string): CallEvent {
  return {
    id,
    callSessionId: "call-1",
    tenantId: "tenant-west-africa",
    type,
    at,
    payload: {},
  };
}

async function* streamChunks(...chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("call event stream", () => {
  it("keeps ordered idempotent events, supports reconnect replay, and pushes live updates to subscribers", () => {
    const stream = createCallEventStream();

    const firstBatch = stream.publish([
      event("call.started", "evt-1", "2026-05-13T09:00:00.000Z"),
      event("turn.started", "evt-2", "2026-05-13T09:00:01.000Z"),
      event("call.started", "evt-1", "2026-05-13T09:00:00.000Z"),
    ]);

    expect(firstBatch).toEqual({
      accepted: 2,
      duplicates: 1,
      lastSequence: 2,
    });

    const received: string[] = [];
    const unsubscribe = stream.subscribe(
      (events) => {
        received.push(...events.map((streamedEvent) => `${streamedEvent.sequence}:${streamedEvent.id}`));
      },
      { afterSequence: 1 },
    );

    expect(received).toEqual(["2:evt-2"]);

    stream.publish(event("turn.completed", "evt-3", "2026-05-13T09:00:03.000Z"));

    expect(received).toEqual(["2:evt-2", "3:evt-3"]);
    expect(stream.replay({ afterSequence: 1 }).map((streamedEvent) => streamedEvent.id)).toEqual([
      "evt-2",
      "evt-3",
    ]);

    unsubscribe();
  });
});

describe("runtime budget and cost estimation", () => {
  it("estimates telephony, stt, model, tts, and storage costs with tenant attribution", () => {
    const estimate = estimateRuntimeCost({
      manifest: {
        ...createManifest(),
        telephonyProvider: "twilio",
      },
      pricing,
      usage: {
        callMinutes: 4.2,
        sttMinutes: 4.2,
        modelInputTokens: 2100,
        modelOutputTokens: 3200,
        ttsCharacters: 1480,
        storageMb: 5.4,
      },
      modelTier: "standard",
      callSessionId: "call-estimate-1",
    });

    expect(estimate.tenantId).toBe("tenant-west-africa");
    expect(estimate.components.map((component) => component.kind)).toEqual([
      "telephony",
      "stt",
      "model_input",
      "model_output",
      "tts",
      "storage",
    ]);
    expect(estimate.totalUsd).toBeGreaterThan(0);
    expect(estimate.complete).toBe(true);
  });

  it("blocks call start when pricing is incomplete or the budget would be exceeded", () => {
    const manifest = {
      ...createManifest(),
      budget: {
        ...createManifest().budget,
        monthlyCapUsd: 18.3,
        currentSpendUsd: 18.0,
      },
      telephonyProvider: "twilio" as const,
    };
    const incompleteEstimate = estimateRuntimeCost({
      manifest,
      pricing: {
        ...pricing,
        telephonyPerMinuteUsd: {},
      },
      usage: {
        callMinutes: 3,
        sttMinutes: 3,
        modelInputTokens: 1200,
        modelOutputTokens: 1600,
        ttsCharacters: 860,
        storageMb: 3,
      },
      modelTier: "standard",
    });

    expect(incompleteEstimate.complete).toBe(false);
    expect(incompleteEstimate.missingPrices).toContain("telephony:twilio");

    const budgetDecision = evaluateRuntimeBudget({
      manifest,
      estimate: incompleteEstimate,
      stage: "call_start",
    });

    expect(budgetDecision.allowed).toBe(false);
    expect(budgetDecision.reason).toContain("pricing");
  });
});

describe("sandbox call session", () => {
  it("starts a browser sandbox call, records transcript and metrics, and exposes simulated tools", async () => {
    const manifest = createManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe({ audioFrames }) {
          return {
            transcript: audioFrames.join(" ").replaceAll("frame:", ""),
            confidence: 0.84,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("Let me review ", "that billing charge for you.");
        },
      },
      tts: {
        async synthesize({ text }) {
          return {
            firstByteLatencyMs: 180,
            audio: streamChunks(`audio:${text}`),
          };
        },
      },
      now: () => "2026-05-13T10:00:00.000Z",
    });

    const session = createSandboxCallSession({
      callSessionId: "sandbox-call-1",
      manifest,
      runtime,
      pricing,
      now: () => "2026-05-13T10:00:00.000Z",
      toolRegistry: {
        "hubspot.profile.lookup": async ({ payload }) => ({
          summary: `Fetched account profile for ${String(payload.phone ?? "unknown caller")}`,
          output: {
            contactId: "contact-1",
          },
        }),
      },
    });

    const started = session.start({
      microphonePermission: "granted",
      mode: "microphone",
    });

    expect(started.status).toBe("active");

    const turn = await session.sendCallerTurn({
      activeAgentId: "agent-front-desk",
      audioFrames: ["frame:I need help with a billing charge"],
      context: {
        intent: "billing",
        callPhase: "discovery",
        requestedToolId: "hubspot.profile.lookup",
      },
      durationMs: 22000,
    });

    expect(turn.responseText).toContain("billing charge");

    const toolResult = await session.invokeTool({
      nodeId: "agent-front-desk:customer-profile-lookup",
      payload: {
        phone: "+2348000000000",
      },
    });

    expect(toolResult.summary).toContain("Fetched account profile");

    const ended = session.end({
      disposition: "sandbox_complete",
    });

    expect(ended.status).toBe("ended");
    expect(session.getTranscript().map((item) => `${item.speaker}:${item.text}`)).toEqual([
      "system:Sandbox call started in microphone mode.",
      "caller:I need help with a billing charge",
      "agent:Let me review that billing charge for you.",
      "system:Fetched account profile for +2348000000000",
      "system:Sandbox call ended.",
    ]);
    expect(session.getMetrics()).toEqual(
      expect.objectContaining({
        turnCount: 1,
        toolCallCount: 1,
      }),
    );
    expect(session.getMetrics().estimatedCostUsd).toBeGreaterThan(0);
    expect(session.replayEvents().map((streamedEvent) => streamedEvent.type)).toEqual([
      "call.started",
      "turn.started",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "turn.audio.first_byte",
      "turn.completed",
      "tool.started",
      "tool.completed",
      "call.ended",
    ]);
    expect(session.replayEvents()[1]?.payload).toMatchObject({
      activeAgentId: "agent-front-desk",
    });
    expect(session.replayEvents()[1]?.payload).not.toHaveProperty("activeRoleId");
  });

  it("handles mic denial without starting the call", () => {
    const manifest = createManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          throw new RuntimeProviderFailure("stt", "timeout", "unused");
        },
      },
      model: {
        streamText() {
          return streamChunks("unused");
        },
      },
      tts: {
        async synthesize() {
          return {
            firstByteLatencyMs: 0,
            audio: streamChunks("unused"),
          };
        },
      },
      now: () => "2026-05-13T10:00:00.000Z",
    });

    const session = createSandboxCallSession({
      callSessionId: "sandbox-call-denied",
      manifest,
      runtime,
      pricing,
      now: () => "2026-05-13T10:00:00.000Z",
    });

    const blocked = session.start({
      microphonePermission: "denied",
      mode: "microphone",
    });

    expect(blocked.status).toBe("blocked");
    expect(session.replayEvents().map((streamedEvent) => streamedEvent.type)).toEqual(["call.failed"]);
    expect(session.getTranscript().map((item) => item.text)).toEqual([
      "Microphone access was denied. Restore microphone access before retrying the sandbox call.",
    ]);
  });
});
