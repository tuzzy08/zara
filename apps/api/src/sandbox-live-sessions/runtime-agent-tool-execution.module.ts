import { Module } from "@nestjs/common";

import { ConnectorToolsService } from "../integrations/connector-tools.service";
import { IntegrationsRuntimeModule } from "../integrations/integrations-runtime.module";
import { WebhookHttpToolsService } from "../integrations/webhook-http-tools.service";
import { RuntimeAgentToolExecutorService } from "./runtime-agent-tool-executor.service";
import {
  DefaultLiveSandboxToolRegistry,
  liveSandboxToolRegistryToken,
} from "./sandbox-live-sessions.providers";

@Module({
  imports: [IntegrationsRuntimeModule],
  providers: [
    RuntimeAgentToolExecutorService,
    {
      provide: liveSandboxToolRegistryToken,
      useFactory: (
        webhookHttpToolsService: WebhookHttpToolsService,
        connectorToolsService: ConnectorToolsService,
      ) =>
        new DefaultLiveSandboxToolRegistry(
          webhookHttpToolsService,
          connectorToolsService,
        ),
      inject: [WebhookHttpToolsService, ConnectorToolsService],
    },
  ],
  exports: [RuntimeAgentToolExecutorService, liveSandboxToolRegistryToken],
})
export class RuntimeAgentToolExecutionModule {}
