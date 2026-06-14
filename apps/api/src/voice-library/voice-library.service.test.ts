import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { VoiceLibraryService } from "./voice-library.service";
import type { VoiceLibraryState } from "./voice-library.models";
import type { VoiceLibraryStateRepository } from "./voice-library-state.repository";
import type {
  VoiceCloneProvider,
  VoicePreviewSynthesizer,
  VoiceSourceAudioStorage,
} from "./voice-library.service";

describe("VoiceLibraryService", () => {
  it("lists safe selectable Cartesia voice metadata without exposing provider voice ids", async () => {
    const service = createService();

    const library = await service.listVoices("tenant-west-africa");

    expect(library.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cartesia-catalog-male-1",
          provider: "cartesia",
          label: "Male 1",
          sourceType: "catalog",
          status: "available",
        }),
        expect.objectContaining({ id: "cartesia-catalog-male-2", label: "Male 2" }),
        expect.objectContaining({ id: "cartesia-catalog-female-1", label: "Female 1" }),
        expect.objectContaining({ id: "cartesia-catalog-female-2", label: "Female 2" }),
        expect.objectContaining({ id: "cartesia-catalog-female-3", label: "Female 3" }),
      ]),
    );
    expect(JSON.stringify(library)).not.toContain("Ronald");
    expect(JSON.stringify(library)).not.toContain("5ee9feff-1265-424a-9d7f-8e4d431a12c7");
  });

  it("creates a voice preview request for builders before saving an agent role voice", async () => {
    const previewSynthesizer = new FakeVoicePreviewSynthesizer();
    const service = createService(
      new InMemoryVoiceLibraryStateRepository(),
      new FakeAuditLogService(),
      previewSynthesizer,
    );

    const preview = await service.createPreview({
      organizationId: "tenant-west-africa",
      actorUserId: "builder-1",
      actorRole: "builder",
      voiceId: "cartesia-catalog-male-1",
      text: "Thanks for calling Zara AI.",
      speed: 1.08,
      volume: 0.9,
      emotion: "calm",
    });

    expect(preview).toEqual({
      id: expect.stringMatching(/^voice_preview_/),
      provider: "cartesia",
      voice: {
        id: "cartesia-catalog-male-1",
        label: "Male 1",
        sourceType: "catalog",
      },
      text: "Thanks for calling Zara AI.",
      audioBase64: "UklGRg==",
      audioContentType: "audio/wav",
      generationConfig: {
        speed: 1.08,
        volume: 0.9,
        emotion: "calm",
      },
      status: "ready",
    });
    expect(previewSynthesizer.requests).toEqual([
      expect.objectContaining({
        providerVoiceId: "5ee9feff-1265-424a-9d7f-8e4d431a12c7",
        text: "Thanks for calling Zara AI.",
      }),
    ]);
  });

  it("stores uploaded source audio before a voice clone can be requested", async () => {
    const audioStorage = new FakeVoiceSourceAudioStorage();
    const audit = new FakeAuditLogService();
    const service = createService(
      new InMemoryVoiceLibraryStateRepository(),
      audit,
      new FakeVoicePreviewSynthesizer(),
      audioStorage,
    );

    await expect(service.uploadSourceAudio({
      organizationId: "tenant-west-africa",
      actorUserId: "builder-1",
      actorRole: "builder",
      fileName: "founder.wav",
      contentType: "audio/wav",
      contentBase64: "UklGRg==",
    })).rejects.toBeInstanceOf(ForbiddenException);

    const upload = await service.uploadSourceAudio({
      organizationId: "tenant-west-africa",
      actorUserId: "owner-1",
      actorRole: "owner",
      fileName: "founder.wav",
      contentType: "audio/wav",
      contentBase64: "UklGRg==",
    });

    expect(upload).toEqual({
      sourceAudioRef: expect.stringMatching(/^voice-upload:\/\/tenant-west-africa\//),
      fileName: "founder.wav",
      contentType: "audio/wav",
    });
    expect(audioStorage.uploads).toEqual([
      expect.objectContaining({
        organizationId: "tenant-west-africa",
        fileName: "founder.wav",
        contentType: "audio/wav",
      }),
    ]);
    expect(audit.actions).toEqual(["voice.source_audio_uploaded"]);
  });

  it("resolves safe library voice ids to provider ids only on the server", async () => {
    const service = createService();

    await expect(service.resolveProviderVoiceId({
      organizationId: "tenant-west-africa",
      voiceId: "cartesia-catalog-male-1",
    })).resolves.toBe("5ee9feff-1265-424a-9d7f-8e4d431a12c7");
  });

  it("requires owner or admin consent before cloned voices can be requested and approved", async () => {
    const repository = new InMemoryVoiceLibraryStateRepository();
    const audit = new FakeAuditLogService();
    const audioStorage = new FakeVoiceSourceAudioStorage();
    const cloneProvider = new FakeVoiceCloneProvider();
    const service = createService(repository, audit, new FakeVoicePreviewSynthesizer(), audioStorage, cloneProvider);

    await expect(service.requestVoiceClone({
      organizationId: "tenant-west-africa",
      actorUserId: "builder-1",
      actorRole: "builder",
      label: "Founder voice",
      sourceAudioRef: "voice-upload://tenant-west-africa/voice.wav",
      consentConfirmed: true,
    })).rejects.toBeInstanceOf(ForbiddenException);

    await expect(service.requestVoiceClone({
      organizationId: "tenant-west-africa",
      actorUserId: "owner-1",
      actorRole: "owner",
      label: "Founder voice",
      sourceAudioRef: "voice-upload://tenant-west-africa/voice.wav",
      consentConfirmed: false,
    })).rejects.toThrow("Voice cloning requires explicit consent confirmation.");

    const clone = await service.requestVoiceClone({
      organizationId: "tenant-west-africa",
      actorUserId: "owner-1",
      actorRole: "owner",
      label: "Founder voice",
      sourceAudioRef: "voice-upload://tenant-west-africa/voice.wav",
      consentConfirmed: true,
    });
    expect(clone).toMatchObject({
      label: "Founder voice",
      sourceType: "cloned",
      status: "pending",
    });

    const approved = await service.approveClonedVoice({
      organizationId: "tenant-west-africa",
      actorUserId: "admin-1",
      actorRole: "admin",
      voiceId: clone.id,
    });

    expect(approved).toMatchObject({
      id: clone.id,
      sourceType: "cloned",
      status: "available",
    });
    expect(JSON.stringify(await service.listVoices("tenant-west-africa"))).not.toContain(
      "cartesia-private-clone-id",
    );
    expect(cloneProvider.requests).toEqual([
      expect.objectContaining({
        name: "Founder voice",
        language: "en",
        contentType: "audio/wav",
      }),
    ]);
    expect(audit.actions).toEqual([
      "voice.clone_requested",
      "voice.clone_approved",
    ]);
  });

  it("disables and deletes cloned voices so they cannot be selected or used at runtime", async () => {
    const audit = new FakeAuditLogService();
    const service = createService(new InMemoryVoiceLibraryStateRepository(), audit);
    const clone = await service.requestVoiceClone({
      organizationId: "tenant-west-africa",
      actorUserId: "owner-1",
      actorRole: "owner",
      label: "Founder voice",
      sourceAudioRef: "voice-upload://tenant-west-africa/voice.wav",
      consentConfirmed: true,
    });
    await service.approveClonedVoice({
      organizationId: "tenant-west-africa",
      actorUserId: "admin-1",
      actorRole: "admin",
      voiceId: clone.id,
    });

    const disabled = await service.disableVoice({
      organizationId: "tenant-west-africa",
      actorUserId: "admin-1",
      actorRole: "admin",
      voiceId: clone.id,
    });
    expect(disabled.status).toBe("disabled");
    await expect(service.resolveProviderVoiceId({
      organizationId: "tenant-west-africa",
      voiceId: clone.id,
    })).rejects.toThrow("Selected voice is not available for runtime use.");

    const deleted = await service.deleteVoice({
      organizationId: "tenant-west-africa",
      actorUserId: "owner-1",
      actorRole: "owner",
      voiceId: clone.id,
    });

    expect(deleted.status).toBe("deleted");
    expect((await service.listVoices("tenant-west-africa")).voices).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: clone.id })]),
    );
    expect(audit.actions).toEqual([
      "voice.clone_requested",
      "voice.clone_approved",
      "voice.disabled",
      "voice.deleted",
    ]);
  });
});

function createService(
  repository = new InMemoryVoiceLibraryStateRepository(),
  auditLogService = new FakeAuditLogService(),
  previewSynthesizer: VoicePreviewSynthesizer = new FakeVoicePreviewSynthesizer(),
  audioStorage: VoiceSourceAudioStorage = new FakeVoiceSourceAudioStorage(),
  cloneProvider: VoiceCloneProvider = new FakeVoiceCloneProvider(),
) {
  return new VoiceLibraryService(repository, auditLogService as never, previewSynthesizer, audioStorage, cloneProvider);
}

class InMemoryVoiceLibraryStateRepository implements VoiceLibraryStateRepository {
  private readonly records = new Map<string, VoiceLibraryState>();

  async load(organizationId: string) {
    return this.records.get(organizationId) ?? null;
  }

  async save(record: NonNullable<Awaited<ReturnType<VoiceLibraryStateRepository["load"]>>>) {
    this.records.set(record.organizationId, structuredClone(record));
  }
}

class FakeAuditLogService {
  readonly actions: string[] = [];

  async record(input: { action: string }) {
    this.actions.push(input.action);
    return {
      id: `audit-${this.actions.length}`,
      action: input.action,
    };
  }
}

class FakeVoicePreviewSynthesizer implements VoicePreviewSynthesizer {
  readonly requests: Array<Parameters<VoicePreviewSynthesizer["synthesize"]>[0]> = [];

  async synthesize(input: Parameters<VoicePreviewSynthesizer["synthesize"]>[0]) {
    this.requests.push(input);
    return {
      audioBase64: "UklGRg==",
      audioContentType: "audio/wav" as const,
    };
  }
}

class FakeVoiceSourceAudioStorage implements VoiceSourceAudioStorage {
  readonly uploads: Array<Parameters<VoiceSourceAudioStorage["save"]>[0]> = [];
  private readonly uploadedAudio = new Map<string, Awaited<ReturnType<VoiceSourceAudioStorage["load"]>>>();

  async save(input: Parameters<VoiceSourceAudioStorage["save"]>[0]) {
    this.uploads.push(input);
    const upload = {
      sourceAudioRef: `voice-upload://${input.organizationId}/source-audio-1`,
      fileName: input.fileName,
      contentType: input.contentType,
    };
    this.uploadedAudio.set(upload.sourceAudioRef, {
      ...upload,
      content: Buffer.from(input.contentBase64, "base64"),
    });
    return {
      sourceAudioRef: upload.sourceAudioRef,
      fileName: upload.fileName,
      contentType: upload.contentType,
    };
  }

  async load(input: Parameters<VoiceSourceAudioStorage["load"]>[0]) {
    return this.uploadedAudio.get(input.sourceAudioRef) ?? {
      sourceAudioRef: input.sourceAudioRef,
      fileName: "voice.wav",
      contentType: "audio/wav",
      content: Buffer.from("voice"),
    };
  }
}

class FakeVoiceCloneProvider implements VoiceCloneProvider {
  readonly requests: Array<Parameters<VoiceCloneProvider["clone"]>[0]> = [];

  async clone(input: Parameters<VoiceCloneProvider["clone"]>[0]) {
    this.requests.push(input);
    return {
      providerVoiceId: "cartesia-private-clone-id",
    };
  }
}
