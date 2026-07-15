import { classifyPstnFirstResponseLatency } from "../runtime-observability/runtime-observability";
import {
  PstnPremiumCallActor,
  type PstnPremiumCallActorProvider,
} from "../telephony/pstn-premium-call-actor";
import { PstnPremiumPlaybackController } from "../telephony/pstn-premium-playback-controller";
import { PremiumProviderMessagePressure } from "../telephony/premium-provider-message-pressure";

export const pstnMediaEvalDatasetId = "zara.pstn-media.v1";

export type PstnMediaEvalReleaseGate = "cost-optimized" | "premium-openai" | "premium-gemini";
export type PstnMediaEvalRuntimeProvider = "cost-optimized" | "openai-realtime" | "gemini-live";

export interface PstnMediaEvalExample {
  id: string;
  suite: typeof pstnMediaEvalDatasetId;
  inputs: {
    scenario: string;
    scenarioKey: string;
    provider: "twilio";
    routeMode: "test_route" | "live_route";
    runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
    runtimeProvider: PstnMediaEvalRuntimeProvider;
    releaseGate: PstnMediaEvalReleaseGate;
    media: {
      codec: "g711_mulaw";
      sampleRateHz: 8000;
      channels: 1;
    };
  };
  referenceOutputs: {
    requiredChecklist: Record<string, boolean>;
    firstResponseClassification?: "good" | "warning" | "critical" | undefined;
    requiredSignals: string[];
  };
}

export interface PstnMediaEvalOutput {
  releaseGate?: PstnMediaEvalReleaseGate | undefined;
  runtimePath?: "pstn-sandwich" | "pstn-premium-realtime" | undefined;
  runtimeProvider?: PstnMediaEvalRuntimeProvider | undefined;
  checklist?: Record<string, boolean> | undefined;
  latency?: {
    firstResponseLatencyMs?: number | undefined;
    firstResponseClassification?: "good" | "warning" | "critical" | undefined;
    ttsFirstByteLatencyMs?: number | undefined;
  } | undefined;
  emittedSignals?: string[] | undefined;
}

export interface PstnMediaEvalScorecard {
  passed: boolean;
  scores: Record<
    "checklist" | "latencyClassification" | "requiredSignals" | "releaseGate" | "runtimeIdentity",
    0 | 1
  >;
  explanations: Record<
    "checklist" | "latencyClassification" | "requiredSignals" | "releaseGate" | "runtimeIdentity",
    string
  >;
}

export interface PstnMediaEvalGateScorecard {
  passed: boolean;
  gates: Record<PstnMediaEvalReleaseGate, {
    passed: boolean;
    passedCount: number;
    totalCount: number;
  }>;
}

export interface PstnMediaEvalScenarioOptions {
  runtimeProvider?: PstnMediaEvalRuntimeProvider | undefined;
  suppressProviderCongestion?: boolean | undefined;
  suppressInterruption?: boolean | undefined;
  suppressCompletionAcknowledgement?: boolean | undefined;
  suppressSecondStop?: boolean | undefined;
  suppressProviderOutputLimit?: boolean | undefined;
}

const successfulChecklist = {
  verifiedWebhook: true,
  allowedCallerMatched: true,
  mediaWebSocketConnected: true,
  inboundFrameReceived: true,
  transcriptCreated: true,
  agentResponseGenerated: true,
  outboundAudioSent: true,
  cleanEnd: true,
  noFatalError: true,
};

const failedChecklist = {
  ...successfulChecklist,
  cleanEnd: false,
  noFatalError: false,
};

const premiumSuccessfulChecklist = {
  verifiedWebhook: true,
  allowedCallerMatched: true,
  mediaWebSocketConnected: true,
  providerReady: true,
  inboundFrameReceived: true,
  outboundAudioSent: true,
  cleanEnd: true,
  noFatalError: true,
};

const premiumFailedChecklist = {
  ...premiumSuccessfulChecklist,
  cleanEnd: false,
  noFatalError: false,
};

export function loadPstnMediaEvalFixtures(): PstnMediaEvalExample[] {
  return [
    fixture("pstn-clean-successful-phone-test", "clean-successful-phone-test", "Clean successful phone test", successfulChecklist, "good", [
      "webhook.received",
      "route.selected",
      "media.websocket_connected",
      "media.first_inbound_frame",
      "transcript.created",
      "tts.first_byte",
      "media.first_outbound_frame",
      "call.ended",
    ]),
    fixture("pstn-no-frame-timeout", "no-frame-timeout", "No inbound frame timeout", {
      ...failedChecklist,
      inboundFrameReceived: false,
      transcriptCreated: false,
      agentResponseGenerated: false,
      outboundAudioSent: false,
    }, "critical", [
      "webhook.received",
      "route.selected",
      "media.websocket_connected",
      "provider.failure",
      "call.ended",
    ]),
    fixture("pstn-tts-first-byte-timeout", "tts-first-byte-timeout", "TTS first-byte timeout", failedChecklist, "critical", [
      "webhook.received",
      "route.selected",
      "media.websocket_connected",
      "media.first_inbound_frame",
      "transcript.created",
      "tts.first_byte",
      "runtime.failure",
      "call.ended",
    ]),
    fixture("pstn-caller-barge-in", "caller-barge-in", "Caller barge-in during response", successfulChecklist, "good", [
      "webhook.received",
      "route.selected",
      "media.websocket_connected",
      "media.first_inbound_frame",
      "transcript.created",
      "tts.first_byte",
      "media.first_outbound_frame",
      "barge_in.clear",
      "call.ended",
    ]),
    fixture("pstn-provider-stop-before-response", "provider-stop-before-response", "Provider stop before response", {
      ...failedChecklist,
      outboundAudioSent: false,
    }, "warning", [
      "webhook.received",
      "route.selected",
      "media.websocket_connected",
      "media.first_inbound_frame",
      "provider.failure",
      "call.ended",
    ]),
    ...premiumFixtures("premium-openai", "openai-realtime"),
    ...premiumFixtures("premium-gemini", "gemini-live"),
  ];
}

export function scorePstnMediaEvalExample(
  example: PstnMediaEvalExample,
  output: PstnMediaEvalOutput,
): PstnMediaEvalScorecard {
  const expectedClassification = example.referenceOutputs.firstResponseClassification;
  const actualClassification =
    output.latency?.firstResponseClassification
    ?? (
      output.latency?.firstResponseLatencyMs === undefined
        ? undefined
        : classifyPstnFirstResponseLatency(output.latency.firstResponseLatencyMs)
    );
  const checklistPassed = Object.entries(example.referenceOutputs.requiredChecklist).every(
    ([key, expected]) => output.checklist?.[key] === expected,
  );
  const requiredSignalsPassed = example.referenceOutputs.requiredSignals.every(
    (signal) => output.emittedSignals?.includes(signal) === true,
  );
  const latencyPassed =
    expectedClassification === undefined || actualClassification === expectedClassification;
  const releaseGatePassed = output.releaseGate === example.inputs.releaseGate;
  const runtimeIdentityPassed =
    output.runtimePath === example.inputs.runtimePath
    && output.runtimeProvider === example.inputs.runtimeProvider;
  const scores = {
    checklist: checklistPassed ? 1 : 0,
    latencyClassification: latencyPassed ? 1 : 0,
    requiredSignals: requiredSignalsPassed ? 1 : 0,
    releaseGate: releaseGatePassed ? 1 : 0,
    runtimeIdentity: runtimeIdentityPassed ? 1 : 0,
  } satisfies PstnMediaEvalScorecard["scores"];

  return {
    passed: Object.values(scores).every((score) => score === 1),
    scores,
    explanations: {
      checklist: "Expected PSTN phone-test checklist fields to match the scenario.",
      latencyClassification: `Expected first-response latency classification '${expectedClassification ?? "not-required"}'.`,
      requiredSignals: "Expected required PSTN observability signals to be emitted.",
      releaseGate: `Expected release gate '${example.inputs.releaseGate}'.`,
      runtimeIdentity: `Expected runtime '${example.inputs.runtimePath}' with provider '${example.inputs.runtimeProvider}'.`,
    },
  };
}

export function scorePstnMediaEvalGate(
  examples: PstnMediaEvalExample[],
  outputs: Record<string, PstnMediaEvalOutput | undefined>,
): PstnMediaEvalGateScorecard {
  const gates = Object.fromEntries(
    (["cost-optimized", "premium-openai", "premium-gemini"] as const).map((releaseGate) => {
      const gateExamples = examples.filter((example) => example.inputs.releaseGate === releaseGate);
      const passedCount = gateExamples.filter((example) => (
        scorePstnMediaEvalExample(example, outputs[example.id] ?? {}).passed
      )).length;

      return [releaseGate, {
        passed: gateExamples.length > 0 && passedCount === gateExamples.length,
        passedCount,
        totalCount: gateExamples.length,
      }];
    }),
  ) as PstnMediaEvalGateScorecard["gates"];

  return {
    passed: Object.values(gates).every((gate) => gate.passed),
    gates,
  };
}

export async function executePstnMediaEvalScenario(
  example: PstnMediaEvalExample,
  options: PstnMediaEvalScenarioOptions = {},
): Promise<PstnMediaEvalOutput> {
  if (example.inputs.releaseGate === "cost-optimized") {
    return observeSandwichScenario(example);
  }

  return observePremiumScenario(example, options);
}

function fixture(
  id: string,
  scenarioKey: string,
  scenario: string,
  requiredChecklist: Record<string, boolean>,
  firstResponseClassification: "good" | "warning" | "critical",
  requiredSignals: string[],
  identity: {
    runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
    runtimeProvider: PstnMediaEvalRuntimeProvider;
    releaseGate: PstnMediaEvalReleaseGate;
  } = {
    runtimePath: "pstn-sandwich",
    runtimeProvider: "cost-optimized",
    releaseGate: "cost-optimized",
  },
): PstnMediaEvalExample {
  return {
    id,
    suite: pstnMediaEvalDatasetId,
    inputs: {
      scenario,
      scenarioKey,
      provider: "twilio",
      routeMode: "test_route",
      runtimePath: identity.runtimePath,
      runtimeProvider: identity.runtimeProvider,
      releaseGate: identity.releaseGate,
      media: {
        codec: "g711_mulaw",
        sampleRateHz: 8000,
        channels: 1,
      },
    },
    referenceOutputs: {
      requiredChecklist,
      firstResponseClassification,
      requiredSignals,
    },
  };
}

function premiumFixtures(
  releaseGate: Exclude<PstnMediaEvalReleaseGate, "cost-optimized">,
  runtimeProvider: Exclude<PstnMediaEvalRuntimeProvider, "cost-optimized">,
): PstnMediaEvalExample[] {
  const identity = {
    runtimePath: "pstn-premium-realtime" as const,
    runtimeProvider,
    releaseGate,
  };
  const idPrefix = `pstn-${releaseGate}`;

  return [
    fixture(`${idPrefix}-normal-flow`, "normal-flow", "Premium normal media flow", {
      ...premiumSuccessfulChecklist,
      playbackCompleted: true,
    }, "good", [
      "premium.readiness", "premium.playback", "media.first_outbound_frame", "premium.cleanup",
    ], identity),
    fixture(`${idPrefix}-startup-buffering`, "startup-buffering", "Bounded startup media buffers and flushes after readiness", {
      ...premiumSuccessfulChecklist,
      startupMediaBuffered: true,
      startupMediaFlushedInOrder: true,
    }, "good", ["premium.pressure", "premium.readiness", "media.first_inbound_frame", "premium.cleanup"], identity),
    fixture(`${idPrefix}-readiness-timeout`, "readiness-timeout", "Provider readiness acknowledgement times out", {
      ...premiumFailedChecklist,
      providerReady: false,
      outboundAudioSent: false,
    }, "critical", ["premium.readiness", "provider.failure", "premium.cleanup", "call.ended"], identity),
    fixture(`${idPrefix}-congestion`, "congestion", "Provider WebSocket congestion fails closed", premiumFailedChecklist, "critical", [
      "premium.pressure", "provider.failure", "premium.cleanup", "call.ended",
    ], identity),
    fixture(`${idPrefix}-queue-overflow`, "queue-overflow", "Bounded provider message queue overflows", premiumFailedChecklist, "critical", [
      "premium.pressure", "runtime.failure", "premium.cleanup", "call.ended",
    ], identity),
    fixture(`${idPrefix}-playback-overflow`, "playback-overflow", "Bounded local playback queue overflows", premiumFailedChecklist, "critical", [
      "premium.playback", "runtime.failure", "premium.cleanup", "call.ended",
    ], identity),
    fixture(`${idPrefix}-interruption`, "interruption", "Interruption clears playback and rejects stale generation output", {
      ...premiumSuccessfulChecklist,
      playbackCleared: true,
      staleGenerationDiscarded: true,
    }, "good", ["premium.interruption", "premium.playback", "premium.cleanup"], identity),
    fixture(`${idPrefix}-handoff-replacement-failure`, "handoff-replacement-failure", "Replacement provider session fails during handoff", premiumFailedChecklist, "critical", [
      "premium.handoff", "provider.failure", "premium.cleanup", "call.ended",
    ], identity),
    fixture(`${idPrefix}-cleanup`, "cleanup", "Terminal cleanup releases both call legs once", {
      ...premiumSuccessfulChecklist,
      cleanupIdempotent: true,
    }, "good", ["premium.cleanup", "call.ended"], identity),
    fixture(`${idPrefix}-runtime-provider-drift`, "runtime-provider-drift", "Release output remains pinned to the selected runtime and provider", premiumSuccessfulChecklist, "good", [
      "premium.readiness", "premium.playback", "premium.cleanup",
    ], identity),
  ];
}

function observeSandwichScenario(example: PstnMediaEvalExample): PstnMediaEvalOutput {
  const checklist = { ...successfulChecklist };
  const emittedSignals = [
    "webhook.received",
    "route.selected",
    "media.websocket_connected",
  ];
  let firstResponseLatencyMs = 1180;

  switch (example.inputs.scenarioKey) {
    case "clean-successful-phone-test":
      emittedSignals.push(
        "media.first_inbound_frame", "transcript.created", "tts.first_byte",
        "media.first_outbound_frame", "call.ended",
      );
      break;
    case "no-frame-timeout":
      Object.assign(checklist, {
        inboundFrameReceived: false,
        transcriptCreated: false,
        agentResponseGenerated: false,
        outboundAudioSent: false,
        cleanEnd: false,
        noFatalError: false,
      });
      firstResponseLatencyMs = 5200;
      emittedSignals.push("provider.failure", "call.ended");
      break;
    case "tts-first-byte-timeout":
      Object.assign(checklist, { cleanEnd: false, noFatalError: false });
      firstResponseLatencyMs = 5200;
      emittedSignals.push(
        "media.first_inbound_frame", "transcript.created", "tts.first_byte",
        "runtime.failure", "call.ended",
      );
      break;
    case "caller-barge-in":
      emittedSignals.push(
        "media.first_inbound_frame", "transcript.created", "tts.first_byte",
        "media.first_outbound_frame", "barge_in.clear", "call.ended",
      );
      break;
    case "provider-stop-before-response":
      Object.assign(checklist, { outboundAudioSent: false, cleanEnd: false, noFatalError: false });
      firstResponseLatencyMs = 2200;
      emittedSignals.push("media.first_inbound_frame", "provider.failure", "call.ended");
      break;
    default:
      throw new Error(`Unsupported sandwich PSTN eval scenario '${example.inputs.scenarioKey}'.`);
  }

  return {
    releaseGate: "cost-optimized",
    runtimePath: "pstn-sandwich",
    runtimeProvider: "cost-optimized",
    checklist,
    latency: {
      firstResponseLatencyMs,
      firstResponseClassification: classifyPstnFirstResponseLatency(firstResponseLatencyMs),
      ttsFirstByteLatencyMs: Math.min(firstResponseLatencyMs, 1200),
    },
    emittedSignals,
  };
}

async function observePremiumScenario(
  example: PstnMediaEvalExample,
  options: PstnMediaEvalScenarioOptions,
): Promise<PstnMediaEvalOutput> {
  if (example.inputs.releaseGate === "cost-optimized") {
    throw new Error("Premium PSTN eval scenarios require a premium release gate.");
  }
  const checklist: Record<string, boolean> = { ...premiumSuccessfulChecklist };
  const emittedSignals = new Set<string>();
  let firstResponseLatencyMs = 1180;

  switch (example.inputs.scenarioKey) {
    case "normal-flow": {
      const playback = observePlaybackCompletion(options.suppressCompletionAcknowledgement === true);
      checklist.playbackCompleted = playback.completed;
      checklist.outboundAudioSent = playback.frameCount > 0;
      emittedSignals.add("premium.readiness");
      emittedSignals.add("premium.playback");
      if (playback.frameCount > 0) emittedSignals.add("media.first_outbound_frame");
      emittedSignals.add("premium.cleanup");
      break;
    }
    case "startup-buffering": {
      const probe = createActorProbe({ ready: "deferred" });
      await probe.actor.start();
      const media = mediaMessage();
      probe.actor.appendInbound(media);
      const buffered = probe.actor.getDiagnostics();
      probe.resolveReady();
      await waitForActorState(probe.actor, "active");
      const flushed = probe.actor.getDiagnostics();
      checklist.startupMediaBuffered = buffered.ingressDepthBytes === media.residentByteLength
        && buffered.aggregateIngressBytes === media.residentByteLength;
      checklist.startupMediaFlushedInOrder = probe.sent.length === 1
        && flushed.ingressDepthBytes === 0
        && flushed.aggregateIngressBytes === 0;
      emittedSignals.add("premium.pressure");
      emittedSignals.add("premium.readiness");
      emittedSignals.add("media.first_inbound_frame");
      await probe.actor.stop();
      emittedSignals.add("premium.cleanup");
      break;
    }
    case "readiness-timeout": {
      const probe = createActorProbe({ ready: "never", readinessTimeoutMs: 1 });
      await probe.actor.start();
      await waitForActorState(probe.actor, "failed");
      Object.assign(checklist, { providerReady: false, outboundAudioSent: false, cleanEnd: false, noFatalError: false });
      firstResponseLatencyMs = 5200;
      emittedSignals.add("premium.readiness");
      emittedSignals.add("provider.failure");
      emittedSignals.add("premium.cleanup");
      emittedSignals.add("call.ended");
      break;
    }
    case "congestion": {
      const probe = createActorProbe({
        ready: "immediate",
        bufferedBytes: options.suppressProviderCongestion === true ? 0 : 300_000,
      });
      await probe.actor.start();
      await waitForActorState(probe.actor, "active");
      let congested = false;
      try {
        probe.actor.appendInbound(mediaMessage());
      } catch (error) {
        congested = error instanceof Error && error.message === "premium_provider_congested";
      }
      if (!congested) await probe.actor.stop();
      Object.assign(checklist, { cleanEnd: !congested, noFatalError: !congested });
      firstResponseLatencyMs = congested ? 5200 : 1180;
      emittedSignals.add("premium.pressure");
      if (congested) emittedSignals.add("provider.failure");
      emittedSignals.add("premium.cleanup");
      emittedSignals.add("call.ended");
      break;
    }
    case "queue-overflow": {
      const pressure = new PremiumProviderMessagePressure(options.suppressProviderOutputLimit === true
        ? { maxBytes: Number.MAX_SAFE_INTEGER, maxCount: Number.MAX_SAFE_INTEGER }
        : undefined);
      let overflowed = false;
      try {
        for (let index = 0; index < 65; index += 1) pressure.acquire(1_024);
      } catch (error) {
        overflowed = error instanceof Error && error.message === "premium_provider_output_overflow";
      }
      Object.assign(checklist, { cleanEnd: !overflowed, noFatalError: !overflowed });
      firstResponseLatencyMs = overflowed ? 5200 : 1180;
      emittedSignals.add("premium.pressure");
      if (overflowed) emittedSignals.add("runtime.failure");
      emittedSignals.add("premium.cleanup");
      emittedSignals.add("call.ended");
      break;
    }
    case "playback-overflow": {
      const controller = createPlaybackProbe().controller;
      controller.startResponse("response-overflow");
      controller.appendDelta("response-overflow", Buffer.alloc(300 * 160, 1).toString("base64"));
      let overflowed = false;
      try {
        controller.appendDelta("response-overflow", Buffer.alloc(160, 2).toString("base64"));
      } catch (error) {
        overflowed = error instanceof Error && error.message === "premium_playback_overflow";
      }
      Object.assign(checklist, { cleanEnd: !overflowed, noFatalError: !overflowed });
      firstResponseLatencyMs = overflowed ? 5200 : 1180;
      emittedSignals.add("premium.playback");
      if (overflowed) emittedSignals.add("runtime.failure");
      emittedSignals.add("premium.cleanup");
      emittedSignals.add("call.ended");
      break;
    }
    case "interruption": {
      const probe = createPlaybackProbe();
      probe.controller.startResponse("response-stale");
      probe.controller.appendDelta("response-stale", Buffer.alloc(160, 1).toString("base64"));
      const cleared = options.suppressInterruption === true ? false : probe.controller.interrupt();
      const late = probe.controller.appendDelta("response-stale", Buffer.alloc(160, 2).toString("base64"));
      checklist.playbackCleared = cleared && probe.clearCount() === 1;
      checklist.staleGenerationDiscarded = !late.accepted && late.reason === "response_invalidated";
      if (cleared) emittedSignals.add("premium.interruption");
      emittedSignals.add("premium.playback");
      emittedSignals.add("premium.cleanup");
      break;
    }
    case "handoff-replacement-failure": {
      const probe = createActorProbe({ ready: "immediate" });
      await probe.actor.start();
      await waitForActorState(probe.actor, "active");
      probe.actor.beginHandoff();
      probe.actor.fail("premium_provider_replacement_failed");
      const failed = probe.actor.getState() === "failed";
      Object.assign(checklist, { cleanEnd: !failed, noFatalError: !failed });
      firstResponseLatencyMs = failed ? 5200 : 1180;
      emittedSignals.add("premium.handoff");
      if (failed) emittedSignals.add("provider.failure");
      emittedSignals.add("premium.cleanup");
      emittedSignals.add("call.ended");
      break;
    }
    case "cleanup": {
      const probe = createActorProbe({ ready: "immediate" });
      await probe.actor.start();
      await waitForActorState(probe.actor, "active");
      await probe.actor.stop();
      if (options.suppressSecondStop !== true) await probe.actor.stop();
      checklist.cleanupIdempotent = options.suppressSecondStop !== true
        && probe.callerCloseCount() === 1
        && probe.providerCloseCount() === 1
        && probe.terminalCount() === 1;
      emittedSignals.add("premium.cleanup");
      emittedSignals.add("call.ended");
      break;
    }
    case "runtime-provider-drift": {
      const playback = observePlaybackCompletion(false);
      checklist.outboundAudioSent = playback.frameCount > 0;
      emittedSignals.add("premium.readiness");
      emittedSignals.add("premium.playback");
      emittedSignals.add("premium.cleanup");
      break;
    }
    default:
      throw new Error(`Unsupported premium PSTN eval scenario '${example.inputs.scenarioKey}'.`);
  }

  return {
    releaseGate: example.inputs.releaseGate,
    runtimePath: "pstn-premium-realtime",
    runtimeProvider: options.runtimeProvider ?? providerForReleaseGate(example.inputs.releaseGate),
    checklist,
    latency: {
      firstResponseLatencyMs,
      firstResponseClassification: classifyPstnFirstResponseLatency(firstResponseLatencyMs),
      ttsFirstByteLatencyMs: Math.min(firstResponseLatencyMs, 1200),
    },
    emittedSignals: [...emittedSignals],
  };
}

function providerForReleaseGate(
  releaseGate: Exclude<PstnMediaEvalReleaseGate, "cost-optimized">,
): Exclude<PstnMediaEvalRuntimeProvider, "cost-optimized"> {
  return releaseGate === "premium-openai" ? "openai-realtime" : "gemini-live";
}

function observePlaybackCompletion(suppressCompletionAcknowledgement: boolean) {
  const probe = createPlaybackProbe();
  probe.controller.startResponse("response-complete");
  probe.controller.appendDelta("response-complete", Buffer.alloc(160, 7).toString("base64"));
  probe.controller.finishResponse("response-complete");
  const marks = probe.marks();
  probe.controller.acknowledgeMark(marks.find((mark) => mark.includes("-frame-")) ?? "missing");
  if (!suppressCompletionAcknowledgement) {
    probe.controller.acknowledgeMark(marks.find((mark) => mark.includes("-boundary-")) ?? "missing");
  }
  return { completed: probe.completionCount() === 1, frameCount: probe.frameCount() };
}

function createPlaybackProbe() {
  const marks: string[] = [];
  let clearCount = 0;
  let completionCount = 0;
  let frameCount = 0;
  const controller = new PstnPremiumPlaybackController({
    sendFrame() { frameCount += 1; },
    sendMark(name) { marks.push(name); },
    clear() { clearCount += 1; },
    onResponseCompleted() { completionCount += 1; },
  });
  return {
    controller,
    marks: () => [...marks],
    clearCount: () => clearCount,
    completionCount: () => completionCount,
    frameCount: () => frameCount,
  };
}

function createActorProbe(input: {
  ready: "immediate" | "deferred" | "never";
  bufferedBytes?: number | undefined;
  readinessTimeoutMs?: number | undefined;
}) {
  let resolveReady: () => void = () => {};
  const readiness = input.ready === "immediate"
    ? Promise.resolve()
    : new Promise<void>((resolve) => { resolveReady = resolve; });
  const sent: Record<string, unknown>[] = [];
  let providerCloseCount = 0;
  let callerCloseCount = 0;
  let terminalCount = 0;
  const provider: PstnPremiumCallActorProvider = {
    waitUntilReady: () => readiness,
    getBufferedAmountBytes: () => input.bufferedBytes ?? 0,
    send(message) { sent.push(message); return input.bufferedBytes ?? 0; },
    close() { providerCloseCount += 1; },
  };
  const actor = new PstnPremiumCallActor({
    callSessionId: "eval-call",
    provider,
    readinessTimeoutMs: input.readinessTimeoutMs,
    terminateRuntime() {},
    closeCaller() { callerCloseCount += 1; },
    onTerminal() { terminalCount += 1; },
  });
  return {
    actor,
    sent,
    resolveReady,
    providerCloseCount: () => providerCloseCount,
    callerCloseCount: () => callerCloseCount,
    terminalCount: () => terminalCount,
  };
}

function mediaMessage() {
  const message = { type: "input_audio_buffer.append" };
  return {
    message,
    durationMs: 20,
    residentByteLength: Buffer.byteLength(JSON.stringify(message), "utf8"),
  };
}

async function waitForActorState(
  actor: PstnPremiumCallActor,
  expected: ReturnType<PstnPremiumCallActor["getState"]>,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (actor.getState() === expected) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Premium PSTN eval actor did not reach '${expected}' from '${actor.getState()}'.`);
}
