import { requestJson } from "./apiClient";

export type TenantVoiceProvider = "cartesia";
export type TenantVoiceSourceType = "catalog" | "cloned";
export type TenantVoiceStatus = "available" | "pending" | "disabled" | "deleted";

export interface TenantVoiceLibraryVoice {
  id: string;
  provider: TenantVoiceProvider;
  label: string;
  sourceType: TenantVoiceSourceType;
  status: TenantVoiceStatus;
}

export interface TenantVoicePreviewDescriptor {
  id?: string;
  voiceId?: string;
  status?: string;
  message?: string;
  audioBase64?: string;
  audioContentType?: string;
  audioUrl?: string;
}

export interface TenantVoiceUploadResponse {
  sourceAudioRef: string;
  fileName: string;
  contentType: string;
}

export async function fetchTenantVoices(organizationId: string) {
  const response = await requestJson<{ voices: TenantVoiceLibraryVoice[] }>(
    `/organizations/${organizationId}/voices`,
  );

  return response.voices;
}

export async function previewTenantVoice(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  voiceId: string;
  text: string;
  speed?: number | undefined;
  volume?: number | undefined;
  emotion?: string | undefined;
}) {
  return requestJson<TenantVoicePreviewDescriptor>(
    `/organizations/${input.organizationId}/voices/preview`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        voiceId: input.voiceId,
        text: input.text,
        ...(input.speed !== undefined ? { speed: input.speed } : {}),
        ...(input.volume !== undefined ? { volume: input.volume } : {}),
        ...(input.emotion !== undefined && input.emotion.length > 0 ? { emotion: input.emotion } : {}),
      }),
    },
  );
}

export async function uploadTenantVoiceSourceAudio(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  fileName: string;
  contentType: string;
  contentBase64: string;
}) {
  return requestJson<TenantVoiceUploadResponse>(
    `/organizations/${input.organizationId}/voices/uploads`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        fileName: input.fileName,
        contentType: input.contentType,
        contentBase64: input.contentBase64,
      }),
    },
  );
}

export async function requestTenantVoiceClone(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  label: string;
  sourceAudioRef: string;
  consentConfirmed: boolean;
}) {
  return requestJson<TenantVoiceLibraryVoice>(
    `/organizations/${input.organizationId}/voices/clones`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        label: input.label,
        sourceAudioRef: input.sourceAudioRef,
        consentConfirmed: input.consentConfirmed,
      }),
    },
  );
}

export async function approveTenantVoiceClone(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  voiceId: string;
}) {
  return requestJson<TenantVoiceLibraryVoice>(
    `/organizations/${input.organizationId}/voices/clones/${input.voiceId}/approve`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      }),
    },
  );
}

export async function disableTenantVoice(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  voiceId: string;
}) {
  return requestJson<TenantVoiceLibraryVoice>(
    `/organizations/${input.organizationId}/voices/${input.voiceId}/disable`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      }),
    },
  );
}

export async function deleteTenantVoice(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  voiceId: string;
}) {
  return requestJson<TenantVoiceLibraryVoice>(
    `/organizations/${input.organizationId}/voices/${input.voiceId}/delete`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      }),
    },
  );
}
