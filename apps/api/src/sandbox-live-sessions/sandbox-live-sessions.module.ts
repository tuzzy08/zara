import { Module } from "@nestjs/common";

import { IntegrationsModule } from "../integrations/integrations.module";
import { RuntimePromptPolicyModule } from "../runtime-prompt-policy/runtime-prompt-policy.module";
import { RuntimePromptPolicyService } from "../runtime-prompt-policy/runtime-prompt-policy.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AssemblyAiSttProvider } from "./assemblyai-stt.provider";
import { CartesiaTtsProvider } from "./cartesia-tts.provider";
import { resolveLiveSandboxProviderConfig } from "./sandbox-live-env";
import { createLiveSandboxTextModelProvider } from "./sandbox-text-model-provider-factory";
import { SandboxLiveSessionsController } from "./sandbox-live-sessions.controller";
import {
  DefaultLiveSandboxToolRegistry,
  liveSandboxSttProviderToken,
  liveSandboxTextModelProviderToken,
  liveSandboxToolRegistryToken,
  liveSandboxTtsProviderToken,
  UnavailableLiveSandboxSttProvider,
  UnavailableLiveSandboxTtsProvider,
} from "./sandbox-live-sessions.providers";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";
import { SandboxLiveSessionsWebSocketBridge } from "./sandbox-live-sessions.websocket-bridge";

@Module({
  imports: [IntegrationsModule, RuntimePromptPolicyModule, WorkspacesModule],
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
      useFactory: (runtimePromptPolicyService: RuntimePromptPolicyService) => {
        const config = resolveLiveSandboxProviderConfig(process.env);
        return createLiveSandboxTextModelProvider(config, {
          getPromptPolicy: () => runtimePromptPolicyService.getPromptPolicy(),
        });
      },
      inject: [RuntimePromptPolicyService],
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
