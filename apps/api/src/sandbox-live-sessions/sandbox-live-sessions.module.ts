import { Module } from "@nestjs/common";

import { IntegrationsModule } from "../integrations/integrations.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AssemblyAiSttProvider } from "./assemblyai-stt.provider";
import { CartesiaTtsProvider } from "./cartesia-tts.provider";
import { OpenAiChatTextProvider } from "./openai-chat-text.provider";
import { resolveLiveSandboxProviderConfig } from "./sandbox-live-env";
import { SandboxLiveSessionsController } from "./sandbox-live-sessions.controller";
import {
  DefaultLiveSandboxToolRegistry,
  liveSandboxSttProviderToken,
  liveSandboxTextModelProviderToken,
  liveSandboxToolRegistryToken,
  liveSandboxTtsProviderToken,
  UnavailableLiveSandboxSttProvider,
  UnavailableLiveSandboxTextModelProvider,
  UnavailableLiveSandboxTtsProvider,
} from "./sandbox-live-sessions.providers";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";
import { SandboxLiveSessionsWebSocketBridge } from "./sandbox-live-sessions.websocket-bridge";

@Module({
  imports: [IntegrationsModule, WorkspacesModule],
  controllers: [SandboxLiveSessionsController],
  providers: [
    SandboxLiveSessionsService,
    SandboxLiveSessionsWebSocketBridge,
    {
      provide: liveSandboxToolRegistryToken,
      useClass: DefaultLiveSandboxToolRegistry,
    },
    {
      provide: liveSandboxTextModelProviderToken,
      useFactory: () => {
        const config = resolveLiveSandboxProviderConfig(process.env);

        if (config.openAiApiKey.length === 0) {
          return new UnavailableLiveSandboxTextModelProvider();
        }

        return new OpenAiChatTextProvider({
          apiKey: config.openAiApiKey,
          baseUrl: config.openAiBaseUrl,
          modelByTier: config.openAiModelByTier,
        });
      },
    },
    {
      provide: liveSandboxSttProviderToken,
      useFactory: () => {
        const config = resolveLiveSandboxProviderConfig(process.env);

        if (config.assemblyAiApiKey.length === 0) {
          return new UnavailableLiveSandboxSttProvider();
        }

        return new AssemblyAiSttProvider({
          apiKey: config.assemblyAiApiKey,
        });
      },
    },
    {
      provide: liveSandboxTtsProviderToken,
      useFactory: () => {
        const config = resolveLiveSandboxProviderConfig(process.env);

        if (config.cartesiaApiKey.length === 0) {
          return new UnavailableLiveSandboxTtsProvider();
        }

        return new CartesiaTtsProvider({
          apiKey: config.cartesiaApiKey,
          apiVersion: config.cartesiaApiVersion,
        });
      },
    },
  ],
  exports: [SandboxLiveSessionsService],
})
export class SandboxLiveSessionsModule {}
