import { describe, expect, it } from "vitest";

import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createEndNode,
  createLiveCallSession,
  createPstnSandwichRuntime,
  createWorkflowGraph,
  PSTN_MULAW_CODEC,
  publishWorkflowVersion,
  RuntimeProviderFailure,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type ModelRoutingRule,
  type PstnAudioFrame,
  type PstnSandwichSttInput,
  type PstnSandwichTtsInput,
} from "./index";

describe("pstn sandwich runtime", () => {
  it("runs a clean synthetic mu-law turn through STT, model, packet creation, and outbound mu-law audio", async () => {
    const manifest = compilePstnManifest();
    const session = createStartedPstnSession(manifest);
    const sttInputs: PstnSandwichSttInput[] = [];
    const ttsInputs: PstnSandwichTtsInput[] = [];
    const runtime = createPstnSandwichRuntime({
      stt: {
        async transcribe(input) {
          sttInputs.push(input);
          return {
            transcript: "I need to book a cleaning this weekend",
            confidence: 0.91,
            language: "en",
            latencyMs: 180,
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("I can help book that for you.");
        },
      },
      tts: {
        async synthesize(input) {
          ttsInputs.push(input);
          return {
            firstByteLatencyMs: 240,
            codec: PSTN_MULAW_CODEC,
            audio: streamChunks("out-1", "out-2"),
          };
        },
      },
      now: fixedClock([
        "2026-05-28T12:00:00.000Z",
        "2026-05-28T12:00:00.050Z",
        "2026-05-28T12:00:00.120Z",
        "2026-05-28T12:00:00.180Z",
        "2026-05-28T12:00:00.240Z",
        "2026-05-28T12:00:00.300Z",
      ]),
    });

    const result = await runtime.runTurn({
      callSession: session,
      turnId: "turn-1",
      mediaStreamId: "media-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [
        inboundFrame({ sequence: 1, payloadBase64: "in-1" }),
        inboundFrame({ sequence: 2, payloadBase64: "in-2" }),
      ],
      context: defaultContext(),
    });

    expect(sttInputs).toHaveLength(1);
    expect(sttInputs[0]).toMatchObject({
      audioFramesBase64: ["in-1", "in-2"],
      telephony: {
        codec: "g711_mulaw",
        sampleRateHz: 8000,
        channels: 1,
      },
    });
    expect(ttsInputs).toHaveLength(1);
    expect(ttsInputs[0]).toMatchObject({
      output: {
        format: "pcm_mulaw",
        sampleRateHz: 8000,
        channels: 1,
      },
    });
    expect(result.packet).toBeDefined();
    expect(result.packet!.callerInput).toMatchObject({
      latestCallerTurn: "I need to book a cleaning this weekend",
      source: "telephony",
      sttConfidence: 0.91,
      language: "en",
    });
    expect(result.responseText).toBe("I can help book that for you.");
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
  });

  it("normalizes noisy partial media without passing empty or duplicate payloads to STT", async () => {
    const manifest = compilePstnManifest();
    const session = createStartedPstnSession(manifest);
    const sttInputs: PstnSandwichSttInput[] = [];
    const runtime = createPstnSandwichRuntime({
      stt: {
        async transcribe(input) {
          sttInputs.push(input);
          return {
            transcript: "Can you confirm my appointment?",
            confidence: 0.76,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("Yes, I can confirm it.");
        },
      },
      tts: pstnTts("out-1"),
    });

    const result = await runtime.runTurn({
      callSession: session,
      turnId: "turn-noisy",
      mediaStreamId: "media-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [
        inboundFrame({ sequence: 1, payloadBase64: "in-1" }),
        inboundFrame({ sequence: 2, payloadBase64: "" }),
        inboundFrame({ sequence: 4, payloadBase64: "in-4" }),
        inboundFrame({ sequence: 4, payloadBase64: "duplicate" }),
      ],
      context: defaultContext(),
    });

    expect(sttInputs[0]?.audioFramesBase64).toEqual(["in-1", "in-4"]);
    expect(result.events.filter((event) => event.type === "quality.flagged").map((event) => event.payload.code))
      .toEqual(["media_partial_frame", "media_sequence_gap", "media_duplicate_frame"]);
  });

  it("uses a PSTN-ready fallback TTS path when the primary provider cannot emit mu-law 8 kHz audio", async () => {
    const manifest = compilePstnManifest();
    const session = createStartedPstnSession(manifest);
    const ttsRequests: Array<"primary" | "fallback"> = [];
    const runtime = createPstnSandwichRuntime({
      stt: transcriptStt("Please connect me to billing"),
      model: {
        streamText() {
          return streamChunks("I can help with billing.");
        },
      },
      tts: {
        async synthesize() {
          ttsRequests.push("primary");
          return {
            firstByteLatencyMs: 140,
            codec: {
              name: "linear16",
              sampleRateHz: 24000,
              channels: 1,
            },
            audio: streamChunks("bad-audio"),
          };
        },
      },
      fallbackTts: {
        async synthesize() {
          ttsRequests.push("fallback");
          return {
            firstByteLatencyMs: 190,
            codec: PSTN_MULAW_CODEC,
            audio: streamChunks("fallback-mulaw"),
          };
        },
      },
    });

    const result = await runtime.runTurn({
      callSession: session,
      turnId: "turn-fallback-tts",
      mediaStreamId: "media-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [inboundFrame({ sequence: 1, payloadBase64: "in-1" })],
      context: defaultContext(),
    });

    expect(ttsRequests).toEqual(["primary", "fallback"]);
    expect(result.outboundFrames.map((frame) => frame.payloadBase64)).toEqual(["fallback-mulaw"]);
    expect(result.events.find((event) => event.type === "quality.flagged")?.payload).toMatchObject({
      code: "tts_pstn_format_fallback",
      recoverable: true,
    });
  });

  it("classifies model timeouts and sends a safe closeout over PSTN-ready audio", async () => {
    const manifest = compilePstnManifest();
    const session = createStartedPstnSession(manifest);
    const runtime = createPstnSandwichRuntime({
      stt: transcriptStt("Can anyone hear me?"),
      model: {
        async *streamText() {
          throw new RuntimeProviderFailure("model", "timeout", "Model timed out.");
        },
      },
      tts: pstnTts("safe-closeout-audio"),
    });

    const result = await runtime.runTurn({
      callSession: session,
      turnId: "turn-model-timeout",
      mediaStreamId: "media-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [inboundFrame({ sequence: 1, payloadBase64: "in-1" })],
      context: defaultContext(),
    });

    expect(result.degraded).toBe(true);
    expect(result.failureStage).toBe("model");
    expect(result.responseText).toContain("trouble responding");
    expect(result.outboundFrames.map((frame) => frame.payloadBase64)).toEqual(["safe-closeout-audio"]);
    expect(result.events.find((event) => event.type === "quality.flagged")?.payload).toMatchObject({
      stage: "model",
      code: "timeout",
      recoverable: true,
    });
  });

  it("emits interruption and clear events when caller barge-in interrupts non-side-effect playback", async () => {
    const manifest = compilePstnManifest();
    const session = createStartedPstnSession(manifest);
    const runtime = createPstnSandwichRuntime({
      stt: transcriptStt("Tell me about your services"),
      model: {
        streamText() {
          return streamChunks("We can explain the service options.");
        },
      },
      tts: pstnTts("out-1", "out-2", "out-3"),
    });

    const result = await runtime.runTurn({
      callSession: session,
      turnId: "turn-barge-in",
      mediaStreamId: "media-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [inboundFrame({ sequence: 1, payloadBase64: "in-1" })],
      context: defaultContext(),
      bargeIn: {
        afterOutboundFrameCount: 1,
        reason: "caller_speech",
        sideEffectInProgress: false,
      },
    });

    expect(result.interrupted).toBe(true);
    expect(result.clearAudio).toEqual({
      mediaStreamId: "media-1",
      reason: "caller_speech",
    });
    expect(result.outboundFrames.map((frame) => frame.payloadBase64)).toEqual(["out-1"]);
    expect(result.events.map((event) => event.type)).toContain("pstn.barge_in.detected");
    expect(result.events.map((event) => event.type)).toContain("pstn.audio.clear_requested");
  });

  it("safe-closes when the media stream never provides a usable inbound frame", async () => {
    const manifest = compilePstnManifest();
    const session = createStartedPstnSession(manifest);
    const runtime = createPstnSandwichRuntime({
      stt: transcriptStt("unused"),
      model: {
        streamText() {
          return streamChunks("unused");
        },
      },
      tts: pstnTts("unused"),
    });

    const result = await runtime.runTurn({
      callSession: session,
      turnId: "turn-no-frame",
      mediaStreamId: "media-1",
      activeRoleId: "agent-front-desk",
      inboundFrames: [],
      context: defaultContext(),
      mediaWaitMs: 5000,
    });

    expect(result.degraded).toBe(true);
    expect(result.safeCloseout).toBe(true);
    expect(result.outboundFrames).toEqual([]);
    expect(result.events.map((event) => event.type)).toEqual([
      "quality.flagged",
      "call.failed",
      "turn.completed",
    ]);
    expect(result.events[0]?.payload).toMatchObject({
      code: "media_no_frame_timeout",
      thresholdMs: 5000,
    });
  });
});

function compilePstnManifest(): CompiledRuntimeManifest {
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
      defaultModelTier: "cheap",
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
    id: "workflow-pstn-sandwich",
    name: "PSTN sandwich",
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
    runtime: "sandwich-pipeline",
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
      projectedCostPerMinuteUsd: 0.18,
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
    reason: "Discovery PSTN calls use standard routing.",
  },
];

function createStartedPstnSession(manifest: CompiledRuntimeManifest) {
  const session = createLiveCallSession({
    callSessionId: "call-pstn-1",
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
    callSessionId: "call-pstn-1",
    mediaStreamId: "media-1",
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

function transcriptStt(transcript: string) {
  return {
    async transcribe() {
      return {
        transcript,
        confidence: 0.88,
        language: "en",
      };
    },
  };
}

function pstnTts(...chunks: string[]) {
  return {
    async synthesize() {
      return {
        firstByteLatencyMs: 180,
        codec: PSTN_MULAW_CODEC,
        audio: streamChunks(...chunks),
      };
    },
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
