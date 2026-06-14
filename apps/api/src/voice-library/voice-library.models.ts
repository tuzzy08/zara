import type { AgentVoiceCloneStatus, AgentVoiceSourceType, TenantRole } from "@zara/core";

export interface VoiceLibraryVoiceRecord {
  id: string;
  provider: "cartesia";
  providerVoiceId: string;
  label: string;
  sourceType: AgentVoiceSourceType;
  cloneStatus?: AgentVoiceCloneStatus | undefined;
  disabled?: boolean | undefined;
  deleted?: boolean | undefined;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string | undefined;
  consentConfirmedAt?: string | undefined;
  sourceAudioRef?: string | undefined;
  approvedAt?: string | undefined;
  approvedByUserId?: string | undefined;
}

export interface VoiceLibraryState {
  organizationId: string;
  voices: VoiceLibraryVoiceRecord[];
}

export interface SafeVoiceLibraryVoice {
  id: string;
  provider: "cartesia";
  label: string;
  sourceType: AgentVoiceSourceType;
  status: "available" | "pending" | "disabled" | "deleted";
}

export interface VoiceLibraryResponse {
  voices: SafeVoiceLibraryVoice[];
}

export interface VoicePreviewResponse {
  id: string;
  provider: "cartesia";
  voice: {
    id: string;
    label: string;
    sourceType: AgentVoiceSourceType;
  };
  text: string;
  audioBase64?: string | undefined;
  audioContentType?: "audio/wav" | undefined;
  generationConfig: {
    speed?: number | undefined;
    volume?: number | undefined;
    emotion?: string | undefined;
  };
  status: "ready";
}

export interface VoicePreviewRequest {
  organizationId: string;
  actorUserId: string;
  actorRole: TenantRole;
  voiceId: string;
  text: string;
  speed?: number | undefined;
  volume?: number | undefined;
  emotion?: string | undefined;
}

export interface VoiceSourceAudioUploadRequest {
  organizationId: string;
  actorUserId: string;
  actorRole: TenantRole;
  fileName: string;
  contentType: string;
  contentBase64: string;
}

export interface VoiceSourceAudioUploadResponse {
  sourceAudioRef: string;
  fileName: string;
  contentType: string;
}

export interface VoiceCloneRequest {
  organizationId: string;
  actorUserId: string;
  actorRole: TenantRole;
  label: string;
  sourceAudioRef: string;
  consentConfirmed: boolean;
}

export interface ApproveClonedVoiceRequest {
  organizationId: string;
  actorUserId: string;
  actorRole: TenantRole;
  voiceId: string;
}

export interface VoiceLifecycleRequest {
  organizationId: string;
  actorUserId: string;
  actorRole: TenantRole;
  voiceId: string;
}
