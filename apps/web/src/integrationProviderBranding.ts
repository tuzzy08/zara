import type { IntegrationProvider } from "./tenantIntegrationsApi";

interface IntegrationProviderBranding {
  label: string;
  logoText: string;
  logoClassName: string;
  ariaLabel: string;
}

const providerBranding: Record<IntegrationProvider, Omit<IntegrationProviderBranding, "ariaLabel">> = {
  zendesk: {
    label: "Zendesk Support",
    logoText: "Z",
    logoClassName: "integration-provider-logo integration-provider-logo-zendesk",
  },
  hubspot: {
    label: "HubSpot CRM",
    logoText: "H",
    logoClassName: "integration-provider-logo integration-provider-logo-hubspot",
  },
  "google-workspace": {
    label: "Google Workspace",
    logoText: "G",
    logoClassName: "integration-provider-logo integration-provider-logo-google-workspace",
  },
  notion: {
    label: "Notion",
    logoText: "N",
    logoClassName: "integration-provider-logo integration-provider-logo-notion",
  },
  "webhook-http": {
    label: "Webhook HTTP",
    logoText: "{}",
    logoClassName: "integration-provider-logo integration-provider-logo-webhook-http",
  },
  salesforce: {
    label: "Salesforce",
    logoText: "S",
    logoClassName: "integration-provider-logo integration-provider-logo-salesforce",
  },
  slack: {
    label: "Slack",
    logoText: "S",
    logoClassName: "integration-provider-logo integration-provider-logo-slack",
  },
};

export function getIntegrationProviderBranding(
  provider: IntegrationProvider,
  catalogMetadata: { label?: string | undefined; logoToken?: string | undefined } = {},
): IntegrationProviderBranding {
  const branding = providerBranding[provider];
  const label = catalogMetadata.label ?? branding.label;
  const logoToken = catalogMetadata.logoToken ?? provider;

  return {
    label,
    logoText: branding.logoText,
    logoClassName: `integration-provider-logo integration-provider-logo-${logoToken}`,
    ariaLabel: `${label} logo`,
  };
}
