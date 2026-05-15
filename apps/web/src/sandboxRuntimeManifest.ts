import {
  compileRuntimeManifest,
  publishWorkflowVersion,
  type ModelRoutingRule,
  type PublishedWorkflowVersion,
  type RuntimeProfileId,
  type RuntimeManifestPreviewBudgetConfig,
  type RuntimeManifestPreviewMemoryConfig,
  type TenantEnvironment,
  type TelemetryPolicy,
  type VoiceRuntimeKind,
  type WorkflowGraph,
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

export function compileDraftSandboxRuntimeManifest(input: {
  workflowId: string;
  tenantId: string;
  workspaceId: string;
  environment: TenantEnvironment;
  createdBy: string;
  graph: WorkflowGraph;
  runtime: VoiceRuntimeKind;
  runtimeProfile: RuntimeProfileId;
  memory: RuntimeManifestPreviewMemoryConfig;
  budget: RuntimeManifestPreviewBudgetConfig;
}) {
  const ephemeralPublishedVersion = publishWorkflowVersion({
    workflowId: `${input.workflowId}-draft-sandbox`,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    environment: input.environment,
    createdBy: input.createdBy,
    graph: input.graph,
    existingVersions: [],
    runtime: input.runtime,
    runtimeProfile: input.runtimeProfile,
    telephonyProvider: "browser-webrtc",
    memory: input.memory,
    budget: input.budget,
  });

  return compilePublishedSandboxRuntimeManifest(ephemeralPublishedVersion);
}

export function deriveRuntimeFromProfile(profile: RuntimeProfileId): VoiceRuntimeKind {
  return profile === "premium-realtime" ? "openai-realtime" : "sandwich-pipeline";
}
