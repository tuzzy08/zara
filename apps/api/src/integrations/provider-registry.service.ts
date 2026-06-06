import { Injectable, NotFoundException } from "@nestjs/common";
import {
  getIntegrationProviderCatalog,
  getIntegrationProviderCatalogEntry,
  type IntegrationProviderCatalogEntry,
  type IntegrationProviderId,
} from "@zara/core";

interface ServerProviderRegistryMetadata {
  provider: IntegrationProviderId;
  baseUrl?: string;
  authHeaderStrategy: string;
  secretSchemaId: string;
  executorId: string;
}

const serverProviderRegistryMetadata: Record<IntegrationProviderId, ServerProviderRegistryMetadata> = {
  zendesk: {
    provider: "zendesk",
    baseUrl: "https://{subdomain}.zendesk.com",
    authHeaderStrategy: "zendesk-basic-api-token",
    secretSchemaId: "zendesk-api-token-or-oauth-v1",
    executorId: "connector.zendesk.v1",
  },
  hubspot: {
    provider: "hubspot",
    baseUrl: "https://api.hubapi.com",
    authHeaderStrategy: "oauth-bearer",
    secretSchemaId: "hubspot-oauth-v1",
    executorId: "connector.hubspot.v1",
  },
  "google-workspace": {
    provider: "google-workspace",
    baseUrl: "https://www.googleapis.com",
    authHeaderStrategy: "oauth-bearer",
    secretSchemaId: "google-workspace-oauth-v1",
    executorId: "connector.google-workspace.v1",
  },
  notion: {
    provider: "notion",
    baseUrl: "https://api.notion.com",
    authHeaderStrategy: "oauth-bearer-with-notion-version",
    secretSchemaId: "notion-oauth-v1",
    executorId: "connector.notion.v1",
  },
  salesforce: {
    provider: "salesforce",
    baseUrl: "https://{myDomain}.my.salesforce.com",
    authHeaderStrategy: "oauth-bearer",
    secretSchemaId: "salesforce-oauth-v1",
    executorId: "connector.salesforce.v1",
  },
  slack: {
    provider: "slack",
    baseUrl: "https://slack.com/api",
    authHeaderStrategy: "oauth-bearer",
    secretSchemaId: "slack-oauth-v1",
    executorId: "connector.slack.v1",
  },
  "webhook-http": {
    provider: "webhook-http",
    authHeaderStrategy: "tenant-secret-reference",
    secretSchemaId: "webhook-http-auth-token-v1",
    executorId: "connector.webhook-http.v1",
  },
};

@Injectable()
export class ProviderRegistryService {
  listCatalog(): { providers: IntegrationProviderCatalogEntry[] } {
    return {
      providers: getIntegrationProviderCatalog(),
    };
  }

  getProviderCatalog(providerId: string): IntegrationProviderCatalogEntry {
    const provider = getIntegrationProviderCatalogEntry(providerId);

    if (provider === undefined) {
      throw new NotFoundException("Provider is not supported by the integration registry.");
    }

    return provider;
  }

  getServerMetadata(providerId: IntegrationProviderId): ServerProviderRegistryMetadata {
    return serverProviderRegistryMetadata[providerId];
  }
}
