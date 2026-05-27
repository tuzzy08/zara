import { describe, expect, it } from "vitest";

import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createConditionNode,
  createCostOptimizedSandwichRuntimeAdapter,
  createEndNode,
  createHandoffNode,
  createToolNode,
  createWorkflowGraph,
  publishWorkflowVersion,
  RuntimeManifestCompileError,
  RuntimeProviderFailure,
  selectModelRoutingDecision,
  type CompiledRuntimeManifest,
  type ModelRoutingRule,
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
    instructions: "Triage the request, gather context, and route the caller safely.",
    defaultModelTier: "cheap",
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en", "fr"],
      allowMidCallSwitching: true,
    },
    reusableSpecialist: true,
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
      supportedLanguages: ["en", "fr"],
      allowMidCallSwitching: true,
    },
    reusableSpecialist: true,
  },
});

const billingHandoff = createHandoffNode({
  id: "handoff-billing",
  label: "Billing handoff",
  position: { x: 620, y: 180 },
  handoff: {
    targetRoleId: "agent-billing",
    targetRoleName: "Billing specialist",
    handoffReason: "Move invoice and refund conversations to the billing specialist lane.",
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

const billingExit = createEndNode({
  id: "end-billing",
  label: "Billing resolved",
  position: { x: 980, y: 180 },
  end: {
    outcome: "resolved",
    closingMessage: "Confirm the billing fix before ending the call.",
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
        targetNodeId: "handoff-billing",
      },
    ],
    fallbackLabel: "Resolved",
    fallbackTargetNodeId: "end-resolved",
  },
});

const apiTool = createToolNode({
  id: "tool-customer-profile",
  label: "Customer profile API",
  position: { x: 420, y: 40 },
  toolId: "hubspot.profile.lookup",
  tool: {
    connector: "webhook",
    toolName: "Customer profile lookup",
    integrationConnectionId: "hubspot-prod",
    integrationLabel: "HubSpot - Production",
    connectionStatus: "connected",
    risk: "high",
    requiresAuthorization: true,
    requiresHumanApproval: false,
    request: {
      method: "POST",
      url: "https://api.example.test/customers/lookup",
      authToken: "secret://hubspot/token",
      headers: [
        { name: "content-type", value: "application/json" },
        { name: "x-tenant-id", value: "{{tenant.id}}" },
      ],
      bodyTemplate: "{\"phone\":\"{{caller.phone}}\"}",
    },
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

function createPublishedWorkflowVersion() {
  const graph = createWorkflowGraph({
    id: "workflow-sandbox-runtime",
    name: "Sandbox runtime",
    nodes: [
      entryNode,
      frontDeskAgent,
      apiTool,
      conditionNode,
      billingHandoff,
      billingAgent,
      resolvedExit,
      billingExit,
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-tool",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "tool-customer-profile",
      },
      {
        id: "edge-front-desk-condition",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "condition-intent",
      },
      {
        id: "edge-condition-billing",
        sourceNodeId: "condition-intent",
        targetNodeId: "handoff-billing",
        condition: "Billing",
      },
      {
        id: "edge-condition-resolved",
        sourceNodeId: "condition-intent",
        targetNodeId: "end-resolved",
        condition: "Resolved",
      },
      {
        id: "edge-handoff-billing",
        sourceNodeId: "handoff-billing",
        targetNodeId: "agent-billing",
      },
      {
        id: "edge-billing-exit",
        sourceNodeId: "agent-billing",
        targetNodeId: "end-billing",
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
      monthlyCapUsd: 1200,
      currentSpendUsd: 214,
      projectedCostPerMinuteUsd: 0.18,
      blockOnLimit: true,
    },
  });
}

function compileManifest(overrides: Partial<Parameters<typeof compileRuntimeManifest>[0]> = {}) {
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
    ...overrides,
  });
}

async function* streamChunks(...chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("runtime manifest compiler", () => {
  it("compiles a deterministic manifest from a published workflow version", () => {
    const manifest = compileManifest();
    const secondManifest = compileManifest();

    expect(manifest).toEqual(secondManifest);
    expect(manifest).toEqual(
      expect.objectContaining({
        manifestId: expect.stringContaining("workflow-sandbox-runtime-v1"),
        publishedVersionId: "workflow-sandbox-runtime-v1",
        runtime: "sandwich-pipeline",
        telephonyProvider: "browser-webrtc",
        entryNodeId: "entry",
        entryRoleId: "agent-front-desk",
        serializedGraph: createPublishedWorkflowVersion().serializedGraph,
      }),
    );
    expect(manifest.toolBindings).toEqual([
      expect.objectContaining({
        nodeId: "tool-customer-profile",
        toolId: "hubspot.profile.lookup",
        request: expect.objectContaining({
          method: "POST",
          url: "https://api.example.test/customers/lookup",
          authToken: "secret://hubspot/token",
        }),
      }),
    ]);
    expect(manifest.handoffs).toEqual([
      expect.objectContaining({
        nodeId: "handoff-billing",
        targetRoleId: "agent-billing",
      }),
    ]);
    expect(manifest.conditions).toEqual([
      expect.objectContaining({
        nodeId: "condition-intent",
        fallbackTargetNodeId: "end-resolved",
      }),
    ]);
  });

  it("fails fast when a published tool reference no longer exists", () => {
    const publishedVersion = createPublishedWorkflowVersion();
    const brokenPublishedVersion = {
      ...publishedVersion,
      tools: [],
    };

    expect(() =>
      compileRuntimeManifest({
        publishedVersion: brokenPublishedVersion,
        modelRouting: routingRules,
        telemetry: {
          captureAudio: false,
          captureTranscript: true,
          redactSensitiveData: true,
          sinks: ["live-monitor"],
        },
        availableIntegrationConnectionIds: ["hubspot-prod"],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeManifestCompileError>>({
        code: "runtime.missing_tool_definition",
      }),
    );
  });

  it("fails fast when tenant config is missing a required integration connection", () => {
    expect(() =>
      compileManifest({
        availableIntegrationConnectionIds: [],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeManifestCompileError>>({
        code: "runtime.missing_integration_connection",
      }),
    );
  });
});

describe("model routing policy engine", () => {
  it("selects the highest-priority escalation rule and logs the decision", () => {
    const manifest = compileManifest();

    const decision = selectModelRoutingDecision({
      manifest,
      activeRoleId: "agent-front-desk",
      context: {
        intent: "billing",
        callPhase: "escalation",
        confidence: 0.32,
        requestedToolId: "hubspot.profile.lookup",
        language: "en",
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        tier: "sota",
        matchedRuleId: "route-escalation-sota",
        source: "rule",
      }),
    );
    expect(decision.log).toEqual(
      expect.objectContaining({
        matchedRuleId: "route-escalation-sota",
        reason: "Escalations with low confidence and high risk go premium.",
      }),
    );
  });

  it("falls back to the active role default tier when no rule matches", () => {
    const manifest = compileManifest({
      modelRouting: [
        {
          id: "route-french-only",
          priority: 5,
          when: {
            language: "fr",
            callPhase: "greeting",
          },
          useTier: "standard",
          reason: "French greetings use the stronger tier.",
        },
      ],
    });

    const decision = selectModelRoutingDecision({
      manifest,
      activeRoleId: "agent-front-desk",
      context: {
        intent: "support",
        callPhase: "resolution",
        confidence: 0.91,
        language: "en",
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        tier: "cheap",
        source: "role_default",
      }),
    );
    expect(decision.matchedRuleId).toBeUndefined();
    expect(decision.log.reason).toContain("Front desk triage");
  });
});

describe("cost optimized sandwich runtime adapter", () => {
  it("streams STT, model, and TTS stages while emitting ordered call events", async () => {
    const manifest = compileManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "I need help with a billing charge",
            confidence: 0.84,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("Let me pull up that charge", " and review it with you.");
        },
      },
      tts: {
        async synthesize() {
          return {
            firstByteLatencyMs: 210,
            audio: streamChunks("pcm-1", "pcm-2"),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-1",
      manifest,
      activeRoleId: "agent-front-desk",
      audioFrames: ["frame-1", "frame-2"],
      context: {
        intent: "billing",
        callPhase: "discovery",
      },
    });

    expect(result.transcript).toBe("I need help with a billing charge");
    expect(result.responseText).toBe("Let me pull up that charge and review it with you.");
    expect(result.audioChunks).toEqual(["pcm-1", "pcm-2"]);
    expect(result.routingDecision.tier).toBe("standard");
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
  });

  it("identifies the selected text model provider and explicit model id in routing events", async () => {
    const publishedVersion = createPublishedWorkflowVersion();
    const manifest = compileManifest({
      publishedVersion: {
        ...publishedVersion,
        roles: publishedVersion.roles.map((role) =>
          role.id === "agent-front-desk"
            ? {
                ...role,
                modelProvider: "google-gemini",
                modelId: "gemini-3.5-flash",
              }
            : role,
        ),
      },
    });
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Can you check my plan?",
            confidence: 0.91,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("I can check that for you.");
        },
      },
      tts: {
        async synthesize() {
          return {
            firstByteLatencyMs: 180,
            audio: streamChunks("pcm-1"),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-gemini",
      manifest,
      activeRoleId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "discovery",
      },
    });

    expect(result.events.find((event) => event.type === "routing.model_selected")?.payload)
      .toMatchObject({
        provider: "google-gemini",
        modelId: "gemini-3.5-flash",
      });
  });

  it("streams model chunks into streaming-capable TTS before the full response is complete", async () => {
    const manifest = compileManifest();
    const events: string[] = [];
    const receivedTextChunks: string[] = [];
    let legacySynthesizeUsed = false;
    let streamingTtsStarted = false;

    const waitForStreamingTts = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return streamingTtsStarted;
    };

    const streamingTts = {
      async synthesize({ text }: { text: string }) {
        legacySynthesizeUsed = true;
        events.push("tts:legacy");
        return {
          firstByteLatencyMs: 180,
          audio: streamChunks(`audio:${text}`),
        };
      },
      async synthesizeStreaming({ textStream }: { textStream: AsyncIterable<string> }) {
        streamingTtsStarted = true;
        events.push("tts:streaming-started");

        for await (const chunk of textStream) {
          receivedTextChunks.push(chunk);
          events.push(`tts:chunk:${chunk}`);
        }

        return {
          firstByteLatencyMs: 180,
          audio: streamChunks("pcm-1"),
        };
      },
    };

    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Can you check my appointment?",
            confidence: 0.92,
            language: "en",
          };
        },
      },
      model: {
        async *streamText() {
          events.push("model:first");
          yield "I can check ";

          events.push((await waitForStreamingTts()) ? "model:tts-started" : "model:tts-not-started");
          events.push("model:second");
          yield "that appointment now.";
        },
      },
      tts: streamingTts,
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-streaming-tts",
      manifest,
      activeRoleId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "discovery",
      },
    });

    expect(legacySynthesizeUsed).toBe(false);
    expect(receivedTextChunks).toEqual(["I can check ", "that appointment now."]);
    expect(events).toContain("model:tts-started");
    expect(events.indexOf("tts:streaming-started")).toBeLessThan(events.indexOf("model:second"));
    expect(result.responseText).toBe("I can check that appointment now.");
    expect(result.audioChunks).toEqual(["pcm-1"]);
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
  });

  it("surfaces TTS audio chunks before the full turn completes", async () => {
    const manifest = compileManifest();
    const observedAudioChunks: Array<{ chunk: string; index: number }> = [];
    let releaseSecondChunk = () => {};
    const secondChunkGate = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });

    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Can you check my appointment?",
            confidence: 0.92,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("I can check that appointment now.");
        },
      },
      tts: {
        async synthesize({ text }) {
          return {
            firstByteLatencyMs: 180,
            audio: (async function* () {
              yield `pcm-1:${text}`;
              await secondChunkGate;
              yield "pcm-2";
            })(),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    let turnSettled = false;
    let turnPromise: Promise<unknown>;
    const firstChunkSeen = new Promise<"seen">((resolve) => {
      turnPromise = runtime.runTurn({
        callSessionId: "call-streaming-audio",
        manifest,
        activeRoleId: "agent-front-desk",
        audioFrames: ["frame-1"],
        context: {
          callPhase: "discovery",
        },
        onAudioChunk: (chunk, index) => {
          observedAudioChunks.push({ chunk, index });
          if (index === 0) {
            resolve("seen");
          }
        },
      });

      void turnPromise.then(() => {
        turnSettled = true;
      });
    });

    const firstChunkSignal = await Promise.race([
      firstChunkSeen,
      new Promise<"missing">((resolve) => setTimeout(() => resolve("missing"), 25)),
    ]);
    expect(firstChunkSignal).toBe("seen");
    expect(turnSettled).toBe(false);

    releaseSecondChunk();
    await turnPromise!;

    expect(observedAudioChunks).toEqual([
      { chunk: "pcm-1:I can check that appointment now.", index: 0 },
      { chunk: "pcm-2", index: 1 },
    ]);
  });

  it("degrades predictably when STT times out", async () => {
    const manifest = compileManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          throw new RuntimeProviderFailure("stt", "timeout", "STT provider timed out.");
        },
      },
      model: {
        streamText() {
          return streamChunks("unused");
        },
      },
      tts: {
        async synthesize({ text }) {
          return {
            firstByteLatencyMs: 120,
            audio: streamChunks(`audio:${text}`),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-2",
      manifest,
      activeRoleId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "greeting",
      },
    });

    expect(result.degraded).toBe(true);
    expect(result.failureStage).toBe("stt");
    expect(result.responseText).toContain("didn't catch that");
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "call.failed",
      "routing.model_selected",
      "turn.response.started",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
  });

  it("keeps a partial answer when the model stream is interrupted", async () => {
    const manifest = compileManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "I need to update my payment method",
            confidence: 0.78,
            language: "en",
          };
        },
      },
      model: {
        async *streamText() {
          yield "I can help update ";
          throw new RuntimeProviderFailure("model", "interrupted", "Model stream disconnected.");
        },
      },
      tts: {
        async synthesize({ text }) {
          return {
            firstByteLatencyMs: 190,
            audio: streamChunks(`audio:${text}`),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-3",
      manifest,
      activeRoleId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        intent: "billing",
        callPhase: "discovery",
      },
    });

    expect(result.degraded).toBe(true);
    expect(result.failureStage).toBe("model");
    expect(result.responseText).toBe("I can help update");
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "quality.flagged",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
  });

  it("flags TTS first-byte delay without dropping the turn", async () => {
    const manifest = compileManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Please confirm the order status",
            confidence: 0.91,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("I have the order details here.");
        },
      },
      tts: {
        async synthesize() {
          return {
            firstByteLatencyMs: 1600,
            audio: streamChunks("pcm-1"),
          };
        },
      },
      firstByteDelayThresholdMs: 800,
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-4",
      manifest,
      activeRoleId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "resolution",
      },
    });

    expect(result.degraded).toBe(false);
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "quality.flagged",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
    expect(result.events[4]?.payload).toEqual(
      expect.objectContaining({
        stage: "tts",
        latencyMs: 1600,
      }),
    );
  });
});

function assertManifest(manifest: CompiledRuntimeManifest) {
  expect(manifest.entryRoleId).toBeTruthy();
}

describe("runtime manifest test helpers", () => {
  it("keeps the helper type anchored to the public compiled manifest", () => {
    assertManifest(compileManifest());
  });
});
