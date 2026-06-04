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
  });
});
