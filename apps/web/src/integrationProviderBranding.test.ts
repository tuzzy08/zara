import { describe, expect, it } from "vitest";

import { getIntegrationProviderBranding } from "./integrationProviderBranding";

describe("integration provider branding", () => {
  it("returns accessible provider logo labels and stable brand classes", () => {
    expect(getIntegrationProviderBranding("zendesk")).toEqual({
      label: "Zendesk Support",
      logoText: "Z",
      logoClassName: "integration-provider-logo integration-provider-logo-zendesk",
      ariaLabel: "Zendesk Support logo",
    });
    expect(getIntegrationProviderBranding("hubspot")).toMatchObject({
      label: "HubSpot CRM",
      logoClassName: "integration-provider-logo integration-provider-logo-hubspot",
      ariaLabel: "HubSpot CRM logo",
    });
    expect(getIntegrationProviderBranding("salesforce")).toMatchObject({
      label: "Salesforce",
      logoClassName: "integration-provider-logo integration-provider-logo-salesforce",
      ariaLabel: "Salesforce logo",
    });
    expect(getIntegrationProviderBranding("slack")).toMatchObject({
      label: "Slack",
      logoText: "S",
      logoClassName: "integration-provider-logo integration-provider-logo-slack",
      ariaLabel: "Slack logo",
    });
    expect(getIntegrationProviderBranding("microsoft-365")).toMatchObject({
      label: "Microsoft 365",
      logoText: "M",
      logoClassName: "integration-provider-logo integration-provider-logo-microsoft-365",
      ariaLabel: "Microsoft 365 logo",
    });
  });
});
