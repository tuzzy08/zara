import { createTenantJsonStateRepository } from "../persistence/tenant-json-state.repository";
import type { VoiceLibraryState, VoiceLibraryVoiceRecord } from "./voice-library.models";

export const VOICE_LIBRARY_STATE_REPOSITORY = Symbol("VOICE_LIBRARY_STATE_REPOSITORY");

export interface VoiceLibraryStateRepository {
  load(organizationId: string): Promise<VoiceLibraryState | null> | VoiceLibraryState | null;
  save(record: VoiceLibraryState): Promise<void> | void;
}

export class FileVoiceLibraryStateRepository implements VoiceLibraryStateRepository {
  private readonly repository;

  constructor(directoryPath: string) {
    this.repository = createTenantJsonStateRepository<VoiceLibraryState>({
      directoryPath,
      validate: isVoiceLibraryState,
      normalize: normalizeVoiceLibraryState,
      encodeOrganizationId: true,
      trailingNewline: true,
    });
  }

  load(organizationId: string) {
    return this.repository.load(organizationId);
  }

  save(record: VoiceLibraryState) {
    this.repository.save(record);
  }
}

function normalizeVoiceLibraryState(record: VoiceLibraryState): VoiceLibraryState {
  return {
    organizationId: record.organizationId,
    voices: record.voices.map((voice) => ({ ...voice })),
  };
}

function isVoiceLibraryState(value: unknown, organizationId: string): value is VoiceLibraryState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<VoiceLibraryState>;
  return record.organizationId === organizationId
    && Array.isArray(record.voices)
    && record.voices.every(isVoiceLibraryVoiceRecord);
}

function isVoiceLibraryVoiceRecord(value: unknown): value is VoiceLibraryVoiceRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<VoiceLibraryVoiceRecord>;
  return typeof record.id === "string"
    && record.provider === "cartesia"
    && typeof record.providerVoiceId === "string"
    && typeof record.label === "string"
    && (record.sourceType === "catalog" || record.sourceType === "cloned")
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string";
}
