import { Module } from "@nestjs/common";
import { join } from "node:path";

import { AuditLogModule } from "../compliance/audit-log.module";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";
import {
  CartesiaVoiceCloneProvider,
  UnavailableVoiceCloneProvider,
} from "./cartesia-voice-clone.provider";
import {
  CartesiaVoicePreviewSynthesizer,
  UnavailableVoicePreviewSynthesizer,
} from "./voice-preview-synthesizer";
import { FileVoiceSourceAudioStorage } from "./voice-source-audio-storage";
import { VoiceLibraryController } from "./voice-library.controller";
import {
  VOICE_CLONE_PROVIDER,
  VOICE_PREVIEW_SYNTHESIZER,
  VOICE_SOURCE_AUDIO_STORAGE,
  VoiceLibraryService,
} from "./voice-library.service";
import {
  FileVoiceLibraryStateRepository,
  VOICE_LIBRARY_STATE_REPOSITORY,
} from "./voice-library-state.repository";

@Module({
  imports: [AuditLogModule],
  controllers: [VoiceLibraryController],
  providers: [
    VoiceLibraryService,
    {
      provide: VOICE_LIBRARY_STATE_REPOSITORY,
      useFactory: () =>
        new FileVoiceLibraryStateRepository(
          process.env.ZARA_VOICE_LIBRARY_STATE_DIR ?? join(process.cwd(), ".zara", "voices"),
        ),
    },
    {
      provide: VOICE_PREVIEW_SYNTHESIZER,
      useFactory: () => {
        const config = resolveLiveSandboxProviderConfig(process.env);

        if (config.cartesiaApiKey.length === 0) {
          return new UnavailableVoicePreviewSynthesizer();
        }

        return new CartesiaVoicePreviewSynthesizer({
          apiKey: config.cartesiaApiKey,
          apiVersion: config.cartesiaApiVersion,
        });
      },
    },
    {
      provide: VOICE_SOURCE_AUDIO_STORAGE,
      useFactory: () =>
        new FileVoiceSourceAudioStorage(
          process.env.ZARA_VOICE_SOURCE_AUDIO_DIR ?? join(process.cwd(), ".zara", "voice-source-audio"),
        ),
    },
    {
      provide: VOICE_CLONE_PROVIDER,
      useFactory: () => {
        const config = resolveLiveSandboxProviderConfig(process.env);

        if (config.cartesiaApiKey.length === 0) {
          return new UnavailableVoiceCloneProvider();
        }

        return new CartesiaVoiceCloneProvider({
          apiKey: config.cartesiaApiKey,
          apiVersion: config.cartesiaApiVersion,
        });
      },
    },
  ],
  exports: [VoiceLibraryService],
})
export class VoiceLibraryModule {}
