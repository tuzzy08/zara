import { classifyPstnFirstResponseLatency } from "../runtime-observability/runtime-observability";

export const pstnMediaEvalDatasetId = "zara.pstn-media.v1";

export interface PstnMediaEvalExample {
  id: string;
  suite: typeof pstnMediaEvalDatasetId;
  inputs: {
    scenario: string;
    provider: "twilio";
    routeMode: "test_route" | "live_route";
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
  scores: Record<"checklist" | "latencyClassification" | "requiredSignals", 0 | 1>;
  explanations: Record<"checklist" | "latencyClassification" | "requiredSignals", string>;
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

export function loadPstnMediaEvalFixtures(): PstnMediaEvalExample[] {
  return [
    fixture("pstn-clean-successful-phone-test", "Clean successful phone test", successfulChecklist, "good", [
      "webhook.received",
      "route.selected",
      "media.websocket_connected",
      "media.first_inbound_frame",
      "transcript.created",
      "tts.first_byte",
      "media.first_outbound_frame",
      "call.ended",
    ]),
    fixture("pstn-no-frame-timeout", "No inbound frame timeout", {
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
    fixture("pstn-tts-first-byte-timeout", "TTS first-byte timeout", failedChecklist, "critical", [
      "webhook.received",
      "route.selected",
      "media.websocket_connected",
      "media.first_inbound_frame",
      "transcript.created",
      "tts.first_byte",
      "runtime.failure",
      "call.ended",
    ]),
    fixture("pstn-caller-barge-in", "Caller barge-in during response", successfulChecklist, "good", [
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
    fixture("pstn-provider-stop-before-response", "Provider stop before response", {
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
  const scores = {
    checklist: checklistPassed ? 1 : 0,
    latencyClassification: latencyPassed ? 1 : 0,
    requiredSignals: requiredSignalsPassed ? 1 : 0,
  } satisfies PstnMediaEvalScorecard["scores"];

  return {
    passed: Object.values(scores).every((score) => score === 1),
    scores,
    explanations: {
      checklist: "Expected PSTN phone-test checklist fields to match the scenario.",
      latencyClassification: `Expected first-response latency classification '${expectedClassification ?? "not-required"}'.`,
      requiredSignals: "Expected required PSTN observability signals to be emitted.",
    },
  };
}

export function createReferencePstnMediaEvalOutput(example: PstnMediaEvalExample): PstnMediaEvalOutput {
  const firstResponseLatencyMs = resolveReferenceLatency(example.referenceOutputs.firstResponseClassification);

  return {
    checklist: example.referenceOutputs.requiredChecklist,
    latency: {
      firstResponseLatencyMs,
      firstResponseClassification: example.referenceOutputs.firstResponseClassification,
      ttsFirstByteLatencyMs: Math.min(firstResponseLatencyMs, 1200),
    },
    emittedSignals: example.referenceOutputs.requiredSignals,
  };
}

function fixture(
  id: string,
  scenario: string,
  requiredChecklist: Record<string, boolean>,
  firstResponseClassification: "good" | "warning" | "critical",
  requiredSignals: string[],
): PstnMediaEvalExample {
  return {
    id,
    suite: pstnMediaEvalDatasetId,
    inputs: {
      scenario,
      provider: "twilio",
      routeMode: "test_route",
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

function resolveReferenceLatency(classification: "good" | "warning" | "critical" | undefined) {
  switch (classification) {
    case "good":
      return 1180;
    case "warning":
      return 2200;
    case "critical":
      return 5200;
    default:
      return 0;
  }
}
