import { Module } from "@nestjs/common";
import { join } from "node:path";

import { IntegrationsController } from "./integrations.controller";
import {
  IntegrationSecretVault,
  resolveIntegrationSecretVaultConfig,
} from "./integrations-secret-vault";
import { IntegrationsService } from "./integrations.service";
import {
  FileIntegrationStateRepository,
  INTEGRATION_STATE_REPOSITORY,
} from "./integrations-state.repository";
import {
  INTEGRATION_OAUTH_PROVIDER_CLIENT,
  LocalIntegrationOAuthProviderClient,
} from "./oauth-provider-client";
import { ConnectorToolsService } from "./connector-tools.service";
import { ProviderRegistryService } from "./provider-registry.service";
import { ToolPermissionGrantsService } from "./tool-permission-grants.service";
import { WebhookHttpToolsService } from "./webhook-http-tools.service";

@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    ConnectorToolsService,
    ProviderRegistryService,
    ToolPermissionGrantsService,
    WebhookHttpToolsService,
    {
      provide: INTEGRATION_STATE_REPOSITORY,
      useFactory: () =>
        new FileIntegrationStateRepository(
          resolveIntegrationStateDirectory(process.env, process.cwd()),
        ),
    },
    {
      provide: IntegrationSecretVault,
      useFactory: () => new IntegrationSecretVault(resolveIntegrationSecretVaultConfig(process.env)),
    },
    {
      provide: INTEGRATION_OAUTH_PROVIDER_CLIENT,
      useFactory: () => new LocalIntegrationOAuthProviderClient(),
    },
  ],
  exports: [
    IntegrationsService,
    ConnectorToolsService,
    ProviderRegistryService,
    ToolPermissionGrantsService,
    WebhookHttpToolsService,
  ],
})
export class IntegrationsModule {}

function resolveIntegrationStateDirectory(
  env: NodeJS.ProcessEnv,
  currentWorkingDirectory: string,
) {
  if (env.ZARA_INTEGRATION_STATE_DIR !== undefined && env.ZARA_INTEGRATION_STATE_DIR.trim().length > 0) {
    return env.ZARA_INTEGRATION_STATE_DIR;
  }

  return join(currentWorkingDirectory, ".zara", "integrations");
}
