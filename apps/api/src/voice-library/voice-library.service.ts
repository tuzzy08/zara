import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { TenantRole } from "@zara/core";

import { AuditLogService } from "../compliance/audit-log.service";
import {
  VOICE_LIBRARY_STATE_REPOSITORY,
  type VoiceLibraryStateRepository,
} from "./voice-library-state.repository";
import type {
  ApproveClonedVoiceRequest,
  SafeVoiceLibraryVoice,
  VoiceCloneRequest,
  VoiceLibraryResponse,
  VoiceLibraryState,
  VoiceLibraryVoiceRecord,
  VoiceLifecycleRequest,
  VoicePreviewRequest,
  VoicePreviewResponse,
  VoiceSourceAudioUploadRequest,
  VoiceSourceAudioUploadResponse,
} from "./voice-library.models";

export const VOICE_PREVIEW_SYNTHESIZER = Symbol("VOICE_PREVIEW_SYNTHESIZER");
export const VOICE_SOURCE_AUDIO_STORAGE = Symbol("VOICE_SOURCE_AUDIO_STORAGE");
export const VOICE_CLONE_PROVIDER = Symbol("VOICE_CLONE_PROVIDER");

export interface VoicePreviewSynthesizer {
  synthesize(input: {
    providerVoiceId: string;
    text: string;
    language: string;
    speed?: number | undefined;
    volume?: number | undefined;
    emotion?: string | undefined;
  }): Promise<{
    audioBase64?: string | undefined;
    audioContentType?: "audio/wav" | undefined;
  }>;
}

export interface VoiceSourceAudioStorage {
  save(input: {
    organizationId: string;
    fileName: string;
    contentType: string;
    contentBase64: string;
  }): Promise<VoiceSourceAudioUploadResponse>;
  load(input: {
    organizationId: string;
    sourceAudioRef: string;
  }): Promise<VoiceSourceAudioUploadResponse & {
    content: Buffer;
  }>;
}

export interface VoiceCloneProvider {
  clone(input: {
    name: string;
    language: "en";
    fileName: string;
    contentType: string;
    content: Buffer;
  }): Promise<{
    providerVoiceId: string;
  }>;
}

const cartesiaCatalogVoices: VoiceLibraryVoiceRecord[] = [
  {
    id: "cartesia-catalog-male-1",
    provider: "cartesia",
    providerVoiceId: "5ee9feff-1265-424a-9d7f-8e4d431a12c7",
    label: "Male 1",
    sourceType: "catalog",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "cartesia-catalog-male-2",
    provider: "cartesia",
    providerVoiceId: "86e30c1d-714b-4074-a1f2-1cb6b552fb49",
    label: "Male 2",
    sourceType: "catalog",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "cartesia-catalog-female-1",
    provider: "cartesia",
    providerVoiceId: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
    label: "Female 1",
    sourceType: "catalog",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "cartesia-catalog-female-2",
    provider: "cartesia",
    providerVoiceId: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
    label: "Female 2",
    sourceType: "catalog",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "cartesia-catalog-female-3",
    provider: "cartesia",
    providerVoiceId: "e07c00bc-4134-4eae-9ea4-1a55fb45746b",
    label: "Female 3",
    sourceType: "catalog",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

@Injectable()
export class VoiceLibraryService {
  constructor(
    @Inject(VOICE_LIBRARY_STATE_REPOSITORY)
    private readonly repository: VoiceLibraryStateRepository,
    private readonly auditLogService: AuditLogService,
    @Inject(VOICE_PREVIEW_SYNTHESIZER)
    private readonly previewSynthesizer: VoicePreviewSynthesizer,
    @Inject(VOICE_SOURCE_AUDIO_STORAGE)
    private readonly sourceAudioStorage: VoiceSourceAudioStorage,
    @Inject(VOICE_CLONE_PROVIDER)
    private readonly voiceCloneProvider: VoiceCloneProvider,
  ) {}

  async listVoices(organizationId: string): Promise<VoiceLibraryResponse> {
    const state = await this.loadState(organizationId);

    return {
      voices: [...cartesiaCatalogVoices, ...state.voices]
        .filter((voice) => voice.deleted !== true)
        .map(toSafeVoice)
        .sort((left, right) => left.label.localeCompare(right.label)),
    };
  }

  async createPreview(input: VoicePreviewRequest): Promise<VoicePreviewResponse> {
    authorizeBuilder(input.actorRole);
    const voice = await this.resolveVoice(input.organizationId, input.voiceId);

    if (toSafeVoice(voice).status !== "available") {
      throw new BadRequestException("Only available voices can be previewed.");
    }

    const previewAudio = await this.previewSynthesizer.synthesize({
      providerVoiceId: voice.providerVoiceId,
      text: input.text,
      language: "en",
      speed: input.speed,
      volume: input.volume,
      emotion: input.emotion,
    });

    return {
      id: `voice_preview_${randomUUID()}`,
      provider: "cartesia",
      voice: {
        id: voice.id,
        label: voice.label,
        sourceType: voice.sourceType,
      },
      text: input.text,
      ...(previewAudio.audioBase64 !== undefined ? { audioBase64: previewAudio.audioBase64 } : {}),
      ...(previewAudio.audioContentType !== undefined ? { audioContentType: previewAudio.audioContentType } : {}),
      generationConfig: {
        ...(input.speed !== undefined ? { speed: input.speed } : {}),
        ...(input.volume !== undefined ? { volume: input.volume } : {}),
        ...(input.emotion !== undefined ? { emotion: input.emotion } : {}),
      },
      status: "ready",
    };
  }

  async uploadSourceAudio(input: VoiceSourceAudioUploadRequest): Promise<VoiceSourceAudioUploadResponse> {
    authorizeAdmin(input.actorRole);

    if (!input.contentType.toLowerCase().startsWith("audio/")) {
      throw new BadRequestException("Voice clone source must be an audio file.");
    }

    if (input.contentBase64.trim().length === 0) {
      throw new BadRequestException("Voice clone source audio is empty.");
    }

    const upload = await this.sourceAudioStorage.save({
      organizationId: input.organizationId,
      fileName: input.fileName,
      contentType: input.contentType,
      contentBase64: input.contentBase64,
    });

    await this.auditLogService.record({
      tenantId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "voice.source_audio_uploaded",
      target: {
        type: "voice",
        id: upload.sourceAudioRef,
      },
      outcome: "succeeded",
      metadata: {
        contentType: upload.contentType,
      },
    });

    return upload;
  }

  async requestVoiceClone(input: VoiceCloneRequest): Promise<SafeVoiceLibraryVoice> {
    authorizeAdmin(input.actorRole);

    if (input.consentConfirmed !== true) {
      throw new BadRequestException("Voice cloning requires explicit consent confirmation.");
    }

    if (input.sourceAudioRef.trim().length === 0) {
      throw new BadRequestException("Voice cloning requires a source audio upload reference.");
    }

    if (!input.sourceAudioRef.startsWith("voice-upload://")) {
      throw new BadRequestException("Voice cloning requires a stored source audio upload reference.");
    }

    const now = new Date().toISOString();
    const state = await this.loadState(input.organizationId);
    const voice: VoiceLibraryVoiceRecord = {
      id: `voice_clone_${randomUUID()}`,
      provider: "cartesia",
      providerVoiceId: "",
      label: input.label,
      sourceType: "cloned",
      cloneStatus: "pending",
      createdAt: now,
      updatedAt: now,
      createdByUserId: input.actorUserId,
      consentConfirmedAt: now,
      sourceAudioRef: input.sourceAudioRef,
    };

    state.voices = [...state.voices, voice];
    await this.repository.save(state);
    await this.auditLogService.record({
      tenantId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "voice.clone_requested",
      target: {
        type: "voice",
        id: voice.id,
      },
      outcome: "succeeded",
      metadata: {
        provider: voice.provider,
        sourceType: voice.sourceType,
      },
    });

    return toSafeVoice(voice);
  }

  async approveClonedVoice(input: ApproveClonedVoiceRequest): Promise<SafeVoiceLibraryVoice> {
    authorizeAdmin(input.actorRole);
    const state = await this.loadState(input.organizationId);
    const index = state.voices.findIndex((voice) => voice.id === input.voiceId);

    if (index < 0) {
      throw new NotFoundException("Voice clone request was not found.");
    }

    const voice = state.voices[index]!;
    if (voice.sourceType !== "cloned") {
      throw new BadRequestException("Only cloned voices require approval.");
    }

    if (voice.sourceAudioRef === undefined) {
      throw new BadRequestException("Voice clone is missing source audio.");
    }

    const sourceAudio = await this.sourceAudioStorage.load({
      organizationId: input.organizationId,
      sourceAudioRef: voice.sourceAudioRef,
    });
    const clone = await this.voiceCloneProvider.clone({
      name: voice.label,
      language: "en",
      fileName: sourceAudio.fileName,
      contentType: sourceAudio.contentType,
      content: sourceAudio.content,
    });

    const now = new Date().toISOString();
    const approvedVoice: VoiceLibraryVoiceRecord = {
      ...voice,
      providerVoiceId: clone.providerVoiceId,
      cloneStatus: "approved",
      approvedAt: now,
      approvedByUserId: input.actorUserId,
      updatedAt: now,
    };

    state.voices = [
      ...state.voices.slice(0, index),
      approvedVoice,
      ...state.voices.slice(index + 1),
    ];
    await this.repository.save(state);
    await this.auditLogService.record({
      tenantId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "voice.clone_approved",
      target: {
        type: "voice",
        id: approvedVoice.id,
      },
      outcome: "succeeded",
      metadata: {
        provider: approvedVoice.provider,
      },
    });

    return toSafeVoice(approvedVoice);
  }

  async resolveProviderVoiceId(input: {
    organizationId: string;
    voiceId: string;
  }): Promise<string> {
    const voice = await this.resolveVoice(input.organizationId, input.voiceId);

    if (toSafeVoice(voice).status !== "available") {
      throw new BadRequestException("Selected voice is not available for runtime use.");
    }

    if (voice.providerVoiceId.trim().length === 0) {
      throw new BadRequestException("Selected voice is missing a provider voice reference.");
    }

    return voice.providerVoiceId;
  }

  async disableVoice(input: VoiceLifecycleRequest): Promise<SafeVoiceLibraryVoice> {
    return this.updateVoiceLifecycle({
      ...input,
      action: "voice.disabled",
      cloneStatus: "disabled",
      disabled: true,
      deleted: false,
    });
  }

  async deleteVoice(input: VoiceLifecycleRequest): Promise<SafeVoiceLibraryVoice> {
    return this.updateVoiceLifecycle({
      ...input,
      action: "voice.deleted",
      cloneStatus: "deleted",
      disabled: false,
      deleted: true,
    });
  }

  private async resolveVoice(organizationId: string, voiceId: string): Promise<VoiceLibraryVoiceRecord> {
    const state = await this.loadState(organizationId);
    const voice = [...cartesiaCatalogVoices, ...state.voices].find((candidate) => candidate.id === voiceId);

    if (voice === undefined) {
      throw new NotFoundException("Voice was not found.");
    }

    return voice;
  }

  private async updateVoiceLifecycle(input: VoiceLifecycleRequest & {
    action: "voice.disabled" | "voice.deleted";
    cloneStatus: "disabled" | "deleted";
    disabled: boolean;
    deleted: boolean;
  }): Promise<SafeVoiceLibraryVoice> {
    authorizeAdmin(input.actorRole);
    const state = await this.loadState(input.organizationId);
    const index = state.voices.findIndex((voice) => voice.id === input.voiceId);

    if (index < 0) {
      throw new NotFoundException("Voice was not found.");
    }

    const voice = state.voices[index]!;
    if (voice.sourceType !== "cloned") {
      throw new BadRequestException("Only cloned voices can be disabled or deleted.");
    }

    const updatedVoice: VoiceLibraryVoiceRecord = {
      ...voice,
      cloneStatus: input.cloneStatus,
      disabled: input.disabled,
      deleted: input.deleted,
      updatedAt: new Date().toISOString(),
    };

    state.voices = [
      ...state.voices.slice(0, index),
      updatedVoice,
      ...state.voices.slice(index + 1),
    ];
    await this.repository.save(state);
    await this.auditLogService.record({
      tenantId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      target: {
        type: "voice",
        id: updatedVoice.id,
      },
      outcome: "succeeded",
      metadata: {
        provider: updatedVoice.provider,
      },
    });

    return toSafeVoice(updatedVoice);
  }

  private async loadState(organizationId: string): Promise<VoiceLibraryState> {
    return await this.repository.load(organizationId) ?? {
      organizationId,
      voices: [],
    };
  }
}

function toSafeVoice(voice: VoiceLibraryVoiceRecord): SafeVoiceLibraryVoice {
  return {
    id: voice.id,
    provider: voice.provider,
    label: voice.label,
    sourceType: voice.sourceType,
    status: resolveSafeVoiceStatus(voice),
  };
}

function resolveSafeVoiceStatus(voice: VoiceLibraryVoiceRecord): SafeVoiceLibraryVoice["status"] {
  if (voice.deleted === true || voice.cloneStatus === "deleted") {
    return "deleted";
  }

  if (voice.disabled === true || voice.cloneStatus === "disabled") {
    return "disabled";
  }

  if (voice.sourceType === "cloned" && voice.cloneStatus !== "approved") {
    return "pending";
  }

  return "available";
}

function authorizeBuilder(role: TenantRole) {
  if (role === "owner" || role === "admin" || role === "builder") {
    return;
  }

  throw new ForbiddenException("Builder access is required to configure agent voices.");
}

function authorizeAdmin(role: TenantRole) {
  if (role === "owner" || role === "admin") {
    return;
  }

  throw new ForbiddenException("Owner or admin access is required to manage cloned voices.");
}
