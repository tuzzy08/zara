import { describe, expect, it } from "vitest";

import { getIntegrationProviderBranding } from "./integrationProviderBranding";

describe("integration provider branding", () => {
  it.each([
    ["zendesk", "Zendesk Support"],
    ["hubspot", "HubSpot CRM"],
    ["salesforce", "Salesforce"],
    ["slack", "Slack"],
    ["microsoft-365", "Microsoft 365"],
    ["intercom", "Intercom"],
    ["shopify", "Shopify"],
    ["stripe", "Stripe"],
    ["confluence", "Confluence"],
    ["sharepoint", "SharePoint"],
    ["freshdesk", "Freshdesk Solutions"],
    ["salesforce-knowledge", "Salesforce Knowledge"],
  ] as const)("returns an accessible label for %s", (provider, label) => {
    expect(getIntegrationProviderBranding(provider)).toMatchObject({
      label,
      logoToken: provider,
      ariaLabel: `${label} logo`,
    });
  });
});
