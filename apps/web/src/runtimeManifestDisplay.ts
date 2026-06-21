import {
  resolveRuntimeAgent,
  type CompiledRuntimeManifest,
  type ModelTier,
  type RealtimeProviderId,
  type RuntimeManifestPreview,
  type RuntimeProfileId,
} from "@zara/core";

import type { LiveSandboxProviderStack } from "./liveSandboxSessionApi";

export interface WorkflowSandboxRuntimeDisplay {
  label: string;
  runtimeProfile: RuntimeProfileId;
  isPremiumRealtime: boolean;
  voiceLabel: string;
  modelId?: string;
}

export function getRuntimeManifestEntryAgentName(manifest: CompiledRuntimeManifest): string {
  return resolveRuntimeAgent(manifest, manifest.entryAgentId)?.name ?? "Unknown";
}

export function getRuntimeManifestEntryModelTier(manifest: CompiledRuntimeManifest): ModelTier {
  return resolveRuntimeAgent(manifest, manifest.entryAgentId)?.defaultModelTier ?? "cheap";
}

export function resolveWorkflowSandboxRuntimeDisplay(input: {
  manifest: CompiledRuntimeManifest | null;
  runtimePreview: RuntimeManifestPreview;
}): WorkflowSandboxRuntimeDisplay {
  const entryAgent = input.manifest === null
    ? undefined
    : resolveRuntimeAgent(input.manifest, input.manifest.entryAgentId);
  const effectiveRuntimeProfile = entryAgent?.runtimeProfileOverride ?? input.runtimePreview.runtimeProfile;
  const voiceLabel = entryAgent?.voiceConfig?.label ?? formatVoiceProfileLabel(effectiveRuntimeProfile);

  if (effectiveRuntimeProfile === "premium-realtime") {
    const realtimeProvider = entryAgent?.realtimeProvider ?? "openai-realtime";
    const realtimeModelId = entryAgent?.realtimeModelId?.trim();

    return {
      label: formatRealtimeProviderLabel(realtimeProvider),
      runtimeProfile: effectiveRuntimeProfile,
      isPremiumRealtime: true,
      voiceLabel,
      ...(realtimeModelId !== undefined && realtimeModelId.length > 0 ? { modelId: realtimeModelId } : {}),
    };
  }

  return {
    label: input.runtimePreview.runtime,
    runtimeProfile: effectiveRuntimeProfile,
    isPremiumRealtime: false,
    voiceLabel,
  };
}

export function formatRuntimeManifestProviderSummary(input: {
  manifest: CompiledRuntimeManifest;
  providerStack?: LiveSandboxProviderStack | undefined;
}): string {
  const entryAgent = resolveRuntimeAgent(input.manifest, input.manifest.entryAgentId);
  const effectiveRuntimeProfile = entryAgent?.runtimeProfileOverride ?? input.manifest.runtimeProfile;

  if (effectiveRuntimeProfile === "premium-realtime") {
    const realtimeProvider = input.providerStack?.realtime ?? entryAgent?.realtimeProvider ?? "openai-realtime";
    const realtimeLabel = formatProviderLabel(realtimeProvider);
    const sttLabel = input.providerStack?.stt === undefined ? realtimeLabel : formatProviderLabel(input.providerStack.stt);
    const ttsLabel = input.providerStack?.tts === undefined ? realtimeLabel : formatProviderLabel(input.providerStack.tts);

    return `${realtimeLabel} / ${sttLabel} / ${ttsLabel}`;
  }

  const modelProviderLabel = entryAgent?.modelProvider === "google-gemini" ? "Gemini routing" : "OpenAI routing";
  const sttLabel = formatProviderLabel(input.providerStack?.stt ?? "assemblyai-streaming");
  const ttsLabel = formatProviderLabel(input.providerStack?.tts ?? "cartesia-sonic-3");

  return `${modelProviderLabel} / ${sttLabel} / ${ttsLabel}`;
}

export function formatRuntimeProfileLabel(profile: RuntimeProfileId): string {
  switch (profile) {
    case "balanced":
      return "Balanced profile";
    case "premium-realtime":
      return "Premium realtime";
    default:
      return "Cost optimized";
  }
}

export function formatRealtimeProviderLabel(provider: RealtimeProviderId): string {
  switch (provider) {
    case "gemini-live":
      return "Gemini Live";
    default:
      return "OpenAI Realtime";
  }
}

function formatProviderLabel(provider: LiveSandboxProviderStack["stt"] | LiveSandboxProviderStack["tts"] | NonNullable<LiveSandboxProviderStack["realtime"]>): string {
  switch (provider) {
    case "assemblyai-streaming":
      return "AssemblyAI";
    case "cartesia-sonic-3":
      return "Cartesia";
    case "gemini-live":
      return "Gemini Live";
    case "openai-realtime":
      return "OpenAI Realtime";
  }
}

export function formatWorkflowSandboxRealtimeDecisionCopy(display: WorkflowSandboxRuntimeDisplay): string {
  const modelCopy = display.modelId !== undefined
    ? ` with ${display.modelId}`
    : " with the provider default model";

  return `${display.label}${modelCopy} is selected for premium realtime voice turns.`;
}

function formatVoiceProfileLabel(profile: RuntimeProfileId): string {
  switch (profile) {
    case "balanced":
      return "Neural HD voice";
    case "premium-realtime":
      return "Expressive voice";
    default:
      return "Economy voice";
  }
}
