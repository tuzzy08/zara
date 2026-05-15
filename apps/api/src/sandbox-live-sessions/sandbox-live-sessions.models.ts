import type {
  CompiledRuntimeManifest,
  RuntimeProfileId,
} from "@zara/core";

export type LiveSandboxManifestSource = "draft" | "published";
export type LiveSandboxInputMode = "voice" | "typed";
export type LiveSandboxSessionStatus = "ready" | "active" | "ended" | "expired";

export interface LiveSandboxProviderStack {
  stt: "assemblyai-streaming";
  tts: "cartesia-sonic-3";
}

export interface LiveSandboxSessionRecord {
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  source: LiveSandboxManifestSource;
  inputMode: LiveSandboxInputMode;
  entryRoleId: string;
  manifestId: string;
  publishedVersionId: string;
  runtimeProfile: RuntimeProfileId;
  transportUrl: string;
  transportTokenHash: string;
  providerStack: LiveSandboxProviderStack;
  createdAt: string;
  expiresAt: string;
  status: LiveSandboxSessionStatus;
  endedAt?: string | undefined;
}

export interface LiveSandboxSessionResponse {
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  source: LiveSandboxManifestSource;
  inputMode: LiveSandboxInputMode;
  entryRoleId: string;
  manifestId: string;
  publishedVersionId: string;
  runtimeProfile: RuntimeProfileId;
  transportUrl: string;
  providerStack: LiveSandboxProviderStack;
  createdAt: string;
  expiresAt: string;
  status: LiveSandboxSessionStatus;
  endedAt?: string | undefined;
  transportToken?: string | undefined;
}

export interface LiveSandboxStreamEvent {
  sessionId: string;
  sequence: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface LiveSandboxTextInputMessage {
  type: "input.text";
  transcript: string;
  callPhase?: string | undefined;
}

export interface LiveSandboxAudioAppendMessage {
  type: "input.audio.append";
  audioBase64: string;
}

export interface LiveSandboxAudioCommitMessage {
  type: "input.audio.commit";
  sampleRateHz?: number | undefined;
  callPhase?: string | undefined;
}

export interface UnknownLiveSandboxClientMessage {
  type: string;
  [key: string]: unknown;
}

export type LiveSandboxClientMessage =
  | LiveSandboxTextInputMessage
  | LiveSandboxAudioAppendMessage
  | LiveSandboxAudioCommitMessage
  | UnknownLiveSandboxClientMessage;

export interface CreateLiveSandboxSessionRequest {
  actorUserId: string;
  workspaceId: string;
  source: LiveSandboxManifestSource;
  inputMode: LiveSandboxInputMode;
  entryRoleId: string;
  manifest: CompiledRuntimeManifest;
  ttlMinutes?: number | undefined;
  now?: string | undefined;
}
