import { describe, expect, it } from "vitest";

import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createEndNode,
  createLiveCallSession,
  createPstnPremiumRealtimeRuntime,
  createWorkflowGraph,
  evaluatePstnPremiumRealtimeCallStart,
  PSTN_MULAW_CODEC,
  publishWorkflowVersion,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type ModelRoutingRule,
  type PstnAudioFrame,
  type PstnPremiumRealtimeProviderTurnInput,
  type ToolCallRequest,
  type ToolExecutionResult,
} from "./index";

describe("pstn premium realtime runtime", () => {
  it("requires explicit provider capability, tenant entitlement, budget, and fallback policy before call start", () => {
    const manifest = compilePremiumPstnManifest();

    const missingPolicy = evaluatePstnPremiumRealtimeCallStart({
      manifest,
      activeRoleId: "agent-front-desk",
      policy: {
        provider: "openai-realtime",
        fallbackPolicy: "block",
      },
    });

    expect(missingPolicy.allowed).toBe(false);
    expect(missingPolicy.runtimePath).toBe("pstn-premium-realtime");
    expect(missingPolicy.blocks.map((block) => block.code)).toEqual([
      "provider_capability_missing",
      "tenant_entitlement_missing",
    ]);

    const providerDown = evaluatePstnPremiumRealtimeCallStart({
      manifest,
      activeRoleId: "agent-front-desk",
      policy: {
        provider: "openai-realtime",
        capability: approvedOpenAiCapability({ available: false }),
        entitlement: { enabled: true },
        budgetAction: "allow",
        fallbackPolicy: "block",
      },
    });

    expect(providerDown.allowed).toBe(false);
    expect(providerDown.blocks.map((block) => block.code)).toContain("provider_unavailable");
    expect(providerDown.fallbackAction).toBe("block");

    const allowed = evaluatePstnPremiumRealtimeCallStart({
      manifest,
      activeRoleId: "agent-front-desk",
      policy: approvedCallStartPolicy(),
    });

    expect(allowed).toMatchObject({
      allowed: true,
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
      fallbackAction: "none",
    });
    expect(allowed.blocks).toEqual([]);
  });

  it("streams provider-native realtime audio back to the PSTN bridge and creates a compatible turn packet", async () => {
    const manifest = compilePremiumPstnManifest();
    const session = createStartedPremiumPstnSession(manifest);
    const providerInputs: PstnPremiumRealtimeProviderTurnInput[] = [];
    const runtime = createPstnPremiumRealtimeRuntime({
      provider: {
        provider: "openai-realtime",
        async runPstnTurn(input) {
          providerInputs.push(input);
          return {
            transcript: "I need a same-day cleaning",
            confidence: 0.93,
            language: "en",
            responseText: "I can help schedule that now.",
            modelId: "gpt-realtime-pstn",
            firstAudioLatencyMs: 118,
            audio: streamChunks("out-1", "out-2"),
          };
        },
      },
      callStartPolicy: approvedCallStartPolicy(),
      now: fixedClock([
        "2026-05-28T12:00:00.000Z",
        "2026-05-28T12:00:00.030Z",
        "2026-05-28T12:00:00.080Z",
        "2026-05-28T12:00:00.120Z",
        "2026-05-28T12:00:00.160Z",
        "2026-05-28T12:00:00.200Z",
      ]),
    });

    const result = await runtime.runTurn({
      callSession: session,
      turnId: "turn-premium-1",
      mediaStreamId: "media-premium-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [inboundFrame({ sequence: 1, payloadBase64: "in-1" })],
      context: defaultContext(),
    });

    expect(providerInputs).toHaveLength(1);
    expect(providerInputs[0]).toMatchObject({
      audioFramesBase64: ["in-1"],
      telephony: {
        codec: "g711_mulaw",
        sampleRateHz: 8000,
        channels: 1,
      },
      provider: "openai-realtime",
    });
    expect(providerInputs[0]?.tools).toEqual([]);
    expect(result.runtimePath).toBe("pstn-premium-realtime");
    expect(result.provider).toBe("openai-realtime");
    expect(result.modelId).toBe("gpt-realtime-pstn");
    expect(result.packet).toBeDefined();
    expect(result.packet!.callerInput).toMatchObject({
      latestCallerTurn: "I need a same-day cleaning",
      source: "telephony",
      sttConfidence: 0.93,
      language: "en",
    });
    expect(result.responseText).toBe("I can help schedule that now.");
    expect(result.outboundFrames.map((frame) => frame.payloadBase64)).toEqual(["out-1", "out-2"]);
    expect(result.outboundFrames.every((frame) => frame.codec.name === "g711_mulaw")).toBe(true);
    expect(result.events.map((event) => event.type)).toEqual([
      "pstn.media.received",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "turn.audio.first_byte",
      "pstn.media.outbound",
      "pstn.media.outbound",
      "turn.completed",
    ]);
    expect(result.events.find((event) => event.type === "turn.audio.first_byte")?.payload).toMatchObject({
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
      latencyMs: 118,
    });
  });

  it("normalizes provider-native interruption into Zara PSTN events without sandwich barge-in thresholds", async () => {
    const manifest = compilePremiumPstnManifest();
    const session = createStartedPremiumPstnSession(manifest);
    const runtime = createPstnPremiumRealtimeRuntime({
      provider: {
        provider: "openai-realtime",
        async runPstnTurn() {
          return {
            transcript: "Actually, stop",
            confidence: 0.88,
            language: "en",
            responseText: "Stopping now.",
            modelId: "gpt-realtime-pstn",
            firstAudioLatencyMs: 96,
            nativeEvents: [
              {
                type: "interruption",
                reason: "caller_speech",
                providerEventId: "evt-native-interrupt-1",
                afterOutboundFrameCount: 1,
              },
            ],
            audio: streamChunks("out-before-interrupt", "out-after-interrupt"),
          };
        },
      },
      callStartPolicy: approvedCallStartPolicy(),
    });

    const result = await runtime.runTurn({
      callSession: session,
      turnId: "turn-premium-interrupt",
      mediaStreamId: "media-premium-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [inboundFrame({ sequence: 1, payloadBase64: "in-1" })],
      context: defaultContext(),
    });

    expect(result.interrupted).toBe(true);
    expect(result.clearAudio).toEqual({
      mediaStreamId: "media-premium-1",
      reason: "caller_speech",
    });
    expect(result.outboundFrames.map((frame) => frame.payloadBase64)).toEqual(["out-before-interrupt"]);
    expect(result.events.find((event) => event.type === "pstn.barge_in.detected")?.payload).toMatchObject({
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
      providerEventId: "evt-native-interrupt-1",
      semantics: "provider-native",
    });
    expect(result.events.map((event) => event.type)).toContain("pstn.audio.clear_requested");
  });

  it("blocks provider failure fallback instead of silently downgrading premium PSTN to sandwich", async () => {
    const manifest = compilePremiumPstnManifest();
    const session = createStartedPremiumPstnSession(manifest);
    const runtime = createPstnPremiumRealtimeRuntime({
      provider: {
        provider: "openai-realtime",
        async runPstnTurn() {
          throw new Error("OpenAI realtime PSTN bridge unavailable.");
        },
      },
      callStartPolicy: approvedCallStartPolicy(),
    });

    const result = await runtime.runTurn({
      callSession: session,
      turnId: "turn-premium-provider-down",
      mediaStreamId: "media-premium-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [inboundFrame({ sequence: 1, payloadBase64: "in-1" })],
      context: defaultContext(),
    });

    expect(result.degraded).toBe(true);
    expect(result.safeCloseout).toBe(true);
    expect(result.failureStage).toBe("provider");
    expect(result.outboundFrames).toEqual([]);
    expect(result.events.find((event) => event.type === "quality.flagged")?.payload).toMatchObject({
      runtimePath: "pstn-premium-realtime",
      provider: "openai-realtime",
      code: "premium_realtime_provider_failed",
      fallbackAction: "block",
    });
    expect(JSON.stringify(result.events)).not.toContain("pstn-sandwich");
  });

  it("normalizes provider-native tool calls into packet-backed tool events before completing the turn", async () => {
    const manifest = {
      ...compilePremiumPstnManifest(),
      agentToolAssignments: [
        {
          id: "tool-ticket-search",
          roleId: "agent-front-desk",
          toolId: "zendesk.search_tickets",
          label: "Search tickets",
          description: "Search support tickets.",
          whenToUse: "Use when the caller asks about an existing ticket.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
          },
          requiredInputs: ["query"],
          risk: "low",
          requiresHumanApproval: false,
          credentialRef: "conn-zendesk-secret",
        },
      ],
    } satisfies CompiledRuntimeManifest;
    const session = createStartedPremiumPstnSession(manifest);
    const providerInputs: PstnPremiumRealtimeProviderTurnInput[] = [];
    const request: ToolCallRequest = {
      type: "call_tool",
      toolCallId: "provider-call-1",
      toolAssignmentId: "tool-ticket-search",
      arguments: {
        query: "account activation",
      },
      reason: "Caller asked for ticket status.",
    };
    const result: ToolExecutionResult = {
      toolCallId: "provider-call-1",
      toolAssignmentId: "tool-ticket-search",
      toolId: "zendesk.search_tickets",
      toolName: "Search tickets",
      status: "completed",
      summary: "Found one open ticket.",
      safeOutput: {
        count: 1,
      },
      durationMs: 42,
      idempotencyKey: "tool-call-provider-call-1",
    };
    const runtime = createPstnPremiumRealtimeRuntime({
      provider: {
        provider: "openai-realtime",
        async runPstnTurn(input) {
          providerInputs.push(input);
          return {
            transcript: "Please check my ticket.",
            confidence: 0.94,
            language: "en",
            responseText: "I found one open ticket.",
            modelId: "gpt-realtime-pstn",
            firstAudioLatencyMs: 82,
            toolCalls: [
              {
                nodeId: "tool-ticket-search",
                request,
                result,
              },
            ],
            audio: streamChunks("out-tool-1"),
          };
        },
      },
      callStartPolicy: approvedCallStartPolicy(),
    });

    const turn = await runtime.runTurn({
      callSession: session,
      turnId: "turn-premium-tool",
      mediaStreamId: "media-premium-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [inboundFrame({ sequence: 1, payloadBase64: "in-1" })],
      context: defaultContext(),
    });

    expect(providerInputs[0]?.tools).toHaveLength(1);
    expect(providerInputs[0]?.tools[0]).toMatchObject({
      toolAssignmentId: "tool-ticket-search",
      toolId: "zendesk.search_tickets",
      label: "Search tickets",
    });
    expect(JSON.stringify(providerInputs[0]?.tools)).not.toContain("conn-zendesk-secret");
    expect(turn.packet?.toolCalls).toEqual([
      {
        request,
        result,
      },
    ]);
    expect(turn.events.map((event) => event.type)).toEqual([
      "pstn.media.received",
      "turn.transcribed",
      "tool.requested",
      "tool.started",
      "tool.completed",
      "routing.model_selected",
      "turn.response.started",
      "turn.audio.first_byte",
      "pstn.media.outbound",
      "turn.completed",
    ]);
  });

  it("lets PSTN providers execute realtime tool callbacks before final audio response", async () => {
    const manifest = {
      ...compilePremiumPstnManifest(),
      agentToolAssignments: [
        {
          id: "tool-ticket-search",
          roleId: "agent-front-desk",
          toolId: "zendesk.search_tickets",
          label: "Search tickets",
          description: "Search support tickets.",
          whenToUse: "Use when the caller asks about an existing ticket.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
          },
          requiredInputs: ["query"],
          risk: "low",
          requiresHumanApproval: false,
          credentialRef: "conn-zendesk-secret",
        },
      ],
    } satisfies CompiledRuntimeManifest;
    const session = createStartedPremiumPstnSession(manifest);
    const order: string[] = [];
    const runtime = createPstnPremiumRealtimeRuntime({
      provider: {
        provider: "openai-realtime",
        async runPstnTurn(input) {
          const tool = await input.executeToolCall({
            providerCallId: "provider-call-1",
            providerFunctionName: input.tools[0]!.name,
            arguments: {
              query: "account activation",
            },
          });
          order.push("tool-callback-completed");
          expect(tool.result.safeOutput).toEqual({
            count: 1,
          });

          order.push("final-response-returned");
          return {
            transcript: "Please check my ticket.",
            confidence: 0.94,
            language: "en",
            responseText: "I found one open ticket.",
            modelId: "gpt-realtime-pstn",
            firstAudioLatencyMs: 82,
            audio: streamChunks("out-tool-1"),
          };
        },
      },
      callStartPolicy: approvedCallStartPolicy(),
    });

    const turn = await runtime.runTurn({
      callSession: session,
      turnId: "turn-premium-tool-callback",
      mediaStreamId: "media-premium-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [inboundFrame({ sequence: 1, payloadBase64: "in-1" })],
      context: defaultContext(),
      executeRealtimeToolCall: async (request) => {
        order.push("zara-tool-executed");
        expect(request.providerFunctionName).toMatch(/^zara_zendesk_search_tickets_/);
        expect(request.arguments).toEqual({
          query: "account activation",
        });

        return {
          nodeId: "tool-ticket-search",
          request: {
            type: "call_tool",
            toolCallId: request.providerCallId,
            toolAssignmentId: "tool-ticket-search",
            arguments: request.arguments ?? {},
            reason: "Provider requested a realtime tool call.",
          },
          result: {
            toolCallId: request.providerCallId,
            toolAssignmentId: "tool-ticket-search",
            toolId: "zendesk.search_tickets",
            toolName: "Search tickets",
            status: "completed",
            summary: "Found one open ticket.",
            safeOutput: {
              count: 1,
            },
            durationMs: 42,
            idempotencyKey: "tool-call-provider-call-1",
          },
        };
      },
    });

    expect(order).toEqual([
      "zara-tool-executed",
      "tool-callback-completed",
      "final-response-returned",
    ]);
    expect(turn.packet?.toolCalls).toHaveLength(1);
    expect(turn.events.map((event) => event.type)).toContain("tool.completed");
  });
});

function compilePremiumPstnManifest(): CompiledRuntimeManifest {
  const entryNode = {
    id: "entry",
    kind: "entry",
    label: "Inbound call",
    position: { x: 0, y: 0 },
    config: {},
  } as const;
  const frontDeskAgent = createAgentRoleNode({
    id: "agent-front-desk",
    label: "Front desk",
    position: { x: 180, y: 0 },
    role: {
      kind: "receptionist",
      name: "Front desk",
      businessName: "Tuzzy Labs",
      instructions: "Answer calls and route safely.",
      defaultModelTier: "standard",
      realtimeProvider: "openai-realtime",
      realtimeModelId: "gpt-realtime-pstn",
      reusableSpecialist: false,
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
      },
    },
  });
  const exitNode = createEndNode({
    id: "end",
    label: "End",
    position: { x: 420, y: 0 },
    end: {
      outcome: "resolved",
      closingMessage: "Close the call.",
    },
  });
  const graph = createWorkflowGraph({
    id: "workflow-pstn-premium",
    name: "PSTN premium realtime",
    nodes: [entryNode, frontDeskAgent, exitNode],
    edges: [
      {
        id: "edge-entry-agent",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-agent-exit",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "end",
      },
    ],
  });
  const publishedVersion = publishWorkflowVersion({
    workflowId: graph.id,
    tenantId: "tenant-west-africa",
    environment: "production",
    createdBy: "user-ops",
    graph,
    existingVersions: [],
    runtime: "openai-realtime",
    runtimeProfile: "premium-realtime",
    telephonyProvider: "twilio",
    workspaceId: "workspace-lagos",
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 1200,
      currentSpendUsd: 200,
      projectedCostPerMinuteUsd: 0.42,
      blockOnLimit: true,
    },
  });

  return compileRuntimeManifest({
    publishedVersion,
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor", "opentelemetry"],
    },
    telephonyConnectionId: "conn-twilio-1",
    telephonyOwnership: "bring-your-own",
  });
}

const routingRules: ModelRoutingRule[] = [
  {
    id: "route-default-standard",
    priority: 1,
    when: {
      callPhase: "discovery",
      minConfidence: 0,
    },
    useTier: "standard",
    reason: "Premium PSTN calls use realtime routing.",
  },
];

function approvedCallStartPolicy() {
  return {
    provider: "openai-realtime" as const,
    capability: approvedOpenAiCapability(),
    entitlement: { enabled: true },
    budgetAction: "allow" as const,
    fallbackPolicy: "block" as const,
  };
}

function approvedOpenAiCapability(overrides: { available?: boolean } = {}) {
  return {
    provider: "openai-realtime" as const,
    approvedForPstn: true,
    available: overrides.available ?? true,
    supportsPstnMediaBridge: true,
    supportsOutboundAudio: true,
    supportsNativeInterruption: true,
  };
}

function createStartedPremiumPstnSession(manifest: CompiledRuntimeManifest) {
  const session = createLiveCallSession({
    callSessionId: "call-pstn-premium-1",
    manifest,
    source: {
      mode: "pstn",
      phoneNumberId: "phone-1",
      telephonyConnectionId: "conn-twilio-1",
      routeMode: "test_route",
    },
    expectedScope: {
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-lagos",
      phoneNumberId: "phone-1",
      publishedVersionId: manifest.publishedVersionId,
      runtimeProfile: manifest.runtimeProfile,
    },
    now: fixedClock(["2026-05-28T11:59:59.000Z"]),
  });
  session.start();
  return session;
}

function inboundFrame(overrides: Partial<PstnAudioFrame> & Pick<PstnAudioFrame, "sequence" | "payloadBase64">): PstnAudioFrame {
  return {
    callSessionId: "call-pstn-premium-1",
    mediaStreamId: "media-premium-1",
    direction: "inbound",
    codec: PSTN_MULAW_CODEC,
    timestampMs: overrides.sequence * 20,
    ...overrides,
  };
}

function defaultContext(): ModelRoutingContext {
  return {
    callPhase: "discovery",
    confidence: 0.9,
    language: "en",
  };
}

async function* streamChunks(...chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function fixedClock(times: string[]) {
  let index = 0;
  return () => times[Math.min(index++, times.length - 1)] ?? "2026-05-28T12:00:00.000Z";
}
