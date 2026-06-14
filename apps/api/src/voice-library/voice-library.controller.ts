import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { TenantRole } from "@zara/core";

import { VoiceLibraryService } from "./voice-library.service";

@Controller("organizations/:organizationId/voices")
export class VoiceLibraryController {
  constructor(private readonly voiceLibraryService: VoiceLibraryService) {}

  @Get()
  async listVoices(@Param("organizationId") organizationId: string) {
    return this.voiceLibraryService.listVoices(organizationId);
  }

  @Post("preview")
  async previewVoice(
    @Param("organizationId") organizationId: string,
    @Body() body: {
      actorUserId: string;
      actorRole: TenantRole;
      voiceId: string;
      text: string;
      speed?: number | undefined;
      volume?: number | undefined;
      emotion?: string | undefined;
    },
  ) {
    return this.voiceLibraryService.createPreview({
      organizationId,
      actorUserId: body.actorUserId,
      actorRole: body.actorRole,
      voiceId: body.voiceId,
      text: body.text,
      speed: body.speed,
      volume: body.volume,
      emotion: body.emotion,
    });
  }

  @Post("uploads")
  async uploadSourceAudio(
    @Param("organizationId") organizationId: string,
    @Body() body: {
      actorUserId: string;
      actorRole: TenantRole;
      fileName: string;
      contentType: string;
      contentBase64: string;
    },
  ) {
    return this.voiceLibraryService.uploadSourceAudio({
      organizationId,
      actorUserId: body.actorUserId,
      actorRole: body.actorRole,
      fileName: body.fileName,
      contentType: body.contentType,
      contentBase64: body.contentBase64,
    });
  }

  @Post("clones")
  async requestClone(
    @Param("organizationId") organizationId: string,
    @Body() body: {
      actorUserId: string;
      actorRole: TenantRole;
      label: string;
      sourceAudioRef: string;
      consentConfirmed: boolean;
    },
  ) {
    return this.voiceLibraryService.requestVoiceClone({
      organizationId,
      actorUserId: body.actorUserId,
      actorRole: body.actorRole,
      label: body.label,
      sourceAudioRef: body.sourceAudioRef,
      consentConfirmed: body.consentConfirmed,
    });
  }

  @Post("clones/:voiceId/approve")
  async approveClone(
    @Param("organizationId") organizationId: string,
    @Param("voiceId") voiceId: string,
    @Body() body: {
      actorUserId: string;
      actorRole: TenantRole;
    },
  ) {
    return this.voiceLibraryService.approveClonedVoice({
      organizationId,
      actorUserId: body.actorUserId,
      actorRole: body.actorRole,
      voiceId,
    });
  }

  @Post(":voiceId/disable")
  async disableVoice(
    @Param("organizationId") organizationId: string,
    @Param("voiceId") voiceId: string,
    @Body() body: {
      actorUserId: string;
      actorRole: TenantRole;
    },
  ) {
    return this.voiceLibraryService.disableVoice({
      organizationId,
      actorUserId: body.actorUserId,
      actorRole: body.actorRole,
      voiceId,
    });
  }

  @Post(":voiceId/delete")
  async deleteVoice(
    @Param("organizationId") organizationId: string,
    @Param("voiceId") voiceId: string,
    @Body() body: {
      actorUserId: string;
      actorRole: TenantRole;
    },
  ) {
    return this.voiceLibraryService.deleteVoice({
      organizationId,
      actorUserId: body.actorUserId,
      actorRole: body.actorRole,
      voiceId,
    });
  }
}
