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
  "microsoft-365": {
    provider: "microsoft-365",
    baseUrl: "https://graph.microsoft.com/v1.0",
    authHeaderStrategy: "oauth-bearer",
    secretSchemaId: "microsoft-365-oauth-v1",
    executorId: "connector.microsoft-365.v1",
  },
  intercom: {
    provider: "intercom",
    baseUrl: "https://api.intercom.io",
    authHeaderStrategy: "oauth-bearer-with-intercom-version",
    secretSchemaId: "intercom-oauth-v1",
    executorId: "connector.intercom.v1",
  },
  shopify: {
    provider: "shopify",
    baseUrl: "https://{shop}.myshopify.com/admin/api/2026-04",
    authHeaderStrategy: "shopify-admin-access-token",
    secretSchemaId: "shopify-oauth-v1",
    executorId: "connector.shopify.v1",
  },
  stripe: {
    provider: "stripe",
    baseUrl: "https://api.stripe.com/v1",
    authHeaderStrategy: "oauth-bearer",
    secretSchemaId: "stripe-oauth-v1",
    executorId: "connector.stripe.v1",
  },
  confluence: {
    provider: "confluence",
    baseUrl: "https://api.atlassian.com",
    authHeaderStrategy: "oauth-bearer",
    secretSchemaId: "confluence-oauth-v1",
    executorId: "connector.confluence.v1",
  },
  sharepoint: {
    provider: "sharepoint",
    baseUrl: "https://graph.microsoft.com/v1.0",
    authHeaderStrategy: "oauth-bearer",
    secretSchemaId: "sharepoint-oauth-v1",
    executorId: "connector.sharepoint.v1",
  },
  freshdesk: {
    provider: "freshdesk",
    baseUrl: "https://{subdomain}.freshdesk.com",
    authHeaderStrategy: "freshdesk-basic-api-token",
    secretSchemaId: "freshdesk-api-token-v1",
    executorId: "connector.freshdesk.v1",
  },
  "salesforce-knowledge": {
    provider: "salesforce-knowledge",
    baseUrl: "https://{myDomain}.my.salesforce.com",
    authHeaderStrategy: "oauth-bearer",
    secretSchemaId: "salesforce-knowledge-oauth-v1",
    executorId: "connector.salesforce-knowledge.v1",
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
