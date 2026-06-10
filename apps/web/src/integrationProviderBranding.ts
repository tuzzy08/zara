import type { IntegrationProvider } from "./tenantIntegrationsApi";

interface IntegrationProviderBranding {
  label: string;
  logoToken: string;
  logoText: string;
  logoClassName: string;
  ariaLabel: string;
}

const providerBranding: Record<IntegrationProvider, Omit<IntegrationProviderBranding, "ariaLabel" | "logoToken">> = {
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
  "microsoft-365": {
    label: "Microsoft 365",
    logoText: "M",
    logoClassName: "integration-provider-logo integration-provider-logo-microsoft-365",
  },
  intercom: {
    label: "Intercom",
    logoText: "I",
    logoClassName: "integration-provider-logo integration-provider-logo-intercom",
  },
  shopify: {
    label: "Shopify",
    logoText: "S",
    logoClassName: "integration-provider-logo integration-provider-logo-shopify",
  },
  stripe: {
    label: "Stripe",
    logoText: "S",
    logoClassName: "integration-provider-logo integration-provider-logo-stripe",
  },
  confluence: {
    label: "Confluence",
    logoText: "C",
    logoClassName: "integration-provider-logo integration-provider-logo-confluence",
  },
  sharepoint: {
    label: "SharePoint",
    logoText: "SP",
    logoClassName: "integration-provider-logo integration-provider-logo-sharepoint",
  },
  freshdesk: {
    label: "Freshdesk Solutions",
    logoText: "FD",
    logoClassName: "integration-provider-logo integration-provider-logo-freshdesk",
  },
  "salesforce-knowledge": {
    label: "Salesforce Knowledge",
    logoText: "SK",
    logoClassName: "integration-provider-logo integration-provider-logo-salesforce-knowledge",
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
    logoToken,
    logoText: branding.logoText,
    logoClassName: `integration-provider-logo integration-provider-logo-${logoToken}`,
    ariaLabel: `${label} logo`,
  };
}
