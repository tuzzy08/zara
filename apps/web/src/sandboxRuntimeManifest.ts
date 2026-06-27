import {
  compileRuntimeManifest,
  type ModelRoutingRule,
  type PublishedWorkflowVersion,
  type RuntimeProfileId,
  type TelemetryPolicy,
  type VoiceRuntimeKind,
} from "@zara/core";

const sandboxModelRouting: ModelRoutingRule[] = [
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

const sandboxTelemetry: TelemetryPolicy = {
  captureAudio: false,
  captureTranscript: true,
  redactSensitiveData: true,
  sinks: ["live-monitor", "opentelemetry"],
};

export function compilePublishedSandboxRuntimeManifest(publishedVersion: PublishedWorkflowVersion) {
  return compileRuntimeManifest({
    publishedVersion,
    modelRouting: sandboxModelRouting,
    telemetry: sandboxTelemetry,
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
  });
}

export function deriveRuntimeFromProfile(profile: RuntimeProfileId): VoiceRuntimeKind {
  return profile === "premium-realtime" ? "openai-realtime" : "sandwich-pipeline";
}
