import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { PostgresPoolService } from "../database/postgres-pool.service";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";

import { IntegrationsRuntimeModule } from "../integrations/integrations-runtime.module";
import { RuntimePromptPolicyModule } from "../runtime-prompt-policy/runtime-prompt-policy.module";
import {
  createConfiguredRuntimeObservabilityRecorder,
  runtimeObservabilityRecorderToken,
} from "../runtime-observability/runtime-observability";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { VoiceLibraryModule } from "../voice-library/voice-library.module";
import { VoiceLibraryService } from "../voice-library/voice-library.service";
import { AssemblyAiSttProvider } from "./assemblyai-stt.provider";
import { CartesiaInkSttProvider } from "./cartesia-stt.provider";
import { CartesiaTtsProvider } from "./cartesia-tts.provider";
import {
  GeminiIntentClassifierProvider,
  UnavailableLiveSandboxIntentClassifierProvider,
} from "./sandbox-intent-classifier.provider";
import { resolveLiveSandboxProviderConfig } from "./sandbox-live-env";
import { RuntimeAgentToolExecutionModule } from "./runtime-agent-tool-execution.module";
import { createLiveSandboxTextModelProvider } from "./sandbox-text-model-provider-factory";
import { SandboxLiveSessionsController } from "./sandbox-live-sessions.controller";
import {
  liveSandboxIntentClassifierProviderToken,
  liveSandboxSttProviderToken,
  liveSandboxTextModelProviderToken,
  liveSandboxTtsProviderToken,
  UnavailableLiveSandboxSttProvider,
  UnavailableLiveSandboxTtsProvider,
} from "./sandbox-live-sessions.providers";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";
import { SandboxLiveSessionsWebSocketBridge } from "./sandbox-live-sessions.websocket-bridge";

@Module({
  imports: [
    DatabaseModule,
    IntegrationsRuntimeModule,
    RuntimeAgentToolExecutionModule,
    RuntimePromptPolicyModule,
    VoiceLibraryModule,
    WorkspacesModule,
  ],
  controllers: [SandboxLiveSessionsController],
  providers: [
    SandboxLiveSessionsService,
    SandboxLiveSessionsWebSocketBridge,
    {
      provide: runtimeObservabilityRecorderToken,
      useFactory: () => createConfiguredRuntimeObservabilityRecorder(process.env),
    },
    {
      provide: liveSandboxTextModelProviderToken,
      useFactory: (database: PostgresPoolService) => {
        const config = resolveLiveSandboxProviderConfig(process.env);
        return createLiveSandboxTextModelProvider(config, {
          usageRecorder: new ProviderUsageRecordingRepository(database.pool),
          openAiProjectId: process.env.OPENAI_PROJECT_ID,
        });
      },
      inject: [PostgresPoolService],
    },
    {
      provide: liveSandboxIntentClassifierProviderToken,
      useFactory: () => {
        const config = resolveLiveSandboxProviderConfig(process.env);

        if (config.geminiApiKey.length === 0) {
          return new UnavailableLiveSandboxIntentClassifierProvider();
        }

        return new GeminiIntentClassifierProvider({
          apiKey: config.geminiApiKey,
          baseUrl: config.geminiBaseUrl,
          modelId: config.intentClassifierModelId,
        });
      },
    },
    {
      provide: liveSandboxSttProviderToken,
      useFactory: (database: PostgresPoolService) => {
        const config = resolveLiveSandboxProviderConfig(process.env);

        if (config.liveSandboxSttProvider === "cartesia-ink-2") {
          if (config.cartesiaApiKey.length === 0) {
            return new UnavailableLiveSandboxSttProvider("cartesia-ink-2");
          }

          return new CartesiaInkSttProvider({
            apiKey: config.cartesiaApiKey,
            apiVersion: config.cartesiaApiVersion,
          });
        }

        if (config.assemblyAiApiKey.length === 0) {
          return new UnavailableLiveSandboxSttProvider();
        }

        return new AssemblyAiSttProvider({
          apiKey: config.assemblyAiApiKey,
          usageRecorder: new ProviderUsageRecordingRepository(database.pool),
        });
      },
      inject: [PostgresPoolService],
    },
    {
      provide: liveSandboxTtsProviderToken,
      useFactory: (voiceLibraryService: VoiceLibraryService) => {
        const config = resolveLiveSandboxProviderConfig(process.env);

        if (config.cartesiaApiKey.length === 0) {
          return new UnavailableLiveSandboxTtsProvider();
        }

        return new CartesiaTtsProvider({
          apiKey: config.cartesiaApiKey,
          apiVersion: config.cartesiaApiVersion,
          resolveVoiceId: (input) => voiceLibraryService.resolveProviderVoiceId(input),
        });
      },
      inject: [VoiceLibraryService],
    },
  ],
  exports: [
    RuntimeAgentToolExecutionModule,
    SandboxLiveSessionsService,
    liveSandboxIntentClassifierProviderToken,
  ],
})
export class SandboxLiveSessionsModule {}
