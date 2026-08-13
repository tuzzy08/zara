import { describe, expect, it } from "vitest";

import { validateBillingChargeDeliveryConfig } from "./billing-polar-outbox.config";

describe("billing Polar outbox configuration", () => {
  it("rejects enabled delivery without a Polar access token", () => {
    expect(() => validateBillingChargeDeliveryConfig({
      deliveryEnabled: true,
      accessToken: "",
      server: "production",
      webhookSecret: "whsec_test",
      catalogId: "catalog-v1",
      releaseId: "release-248",
      mappings: [],
    })).toThrow("POLAR_ACCESS_TOKEN is required when charge delivery is enabled.");
  });

  it("rejects enabled delivery against the Polar sandbox server", () => {
    expect(() => validateBillingChargeDeliveryConfig({
      deliveryEnabled: true,
      accessToken: "polar-production-token",
      server: "sandbox",
      webhookSecret: "whsec_test",
      catalogId: "catalog-v1",
      releaseId: "release-248",
      mappings: [],
    })).toThrow("POLAR_SERVER must be production when charge delivery is enabled.");
  });

  it("rejects enabled delivery without a webhook secret", () => {
    expect(() => validateBillingChargeDeliveryConfig({
      deliveryEnabled: true,
      accessToken: "polar-production-token",
      server: "production",
      webhookSecret: "",
      catalogId: "catalog-v1",
      releaseId: "release-248",
      mappings: [],
    })).toThrow("POLAR_WEBHOOK_SECRET is required when charge delivery is enabled.");
  });

  it("rejects enabled delivery without a release candidate ID", () => {
    expect(() => validateBillingChargeDeliveryConfig({
      deliveryEnabled: true,
      accessToken: "polar-production-token",
      server: "production",
      webhookSecret: "whsec_production",
      catalogId: "catalog-v1",
      releaseId: "",
      mappings: [],
    })).toThrow("ZARA_RELEASE_ID is required when charge delivery is enabled.");
  });

  it("rejects enabled delivery when the approved PAYG meter mapping is missing", () => {
    expect(() => validateBillingChargeDeliveryConfig({
      deliveryEnabled: true,
      accessToken: "polar-production-token",
      server: "production",
      webhookSecret: "whsec_production",
      catalogId: "catalog-v1",
      releaseId: "release-248",
      mappings: [
        mapping("product", "starter"),
        mapping("product", "growth"),
        mapping("product", "scale"),
        mapping("credit_pack", "payg-5-usd"),
        mapping("meter", "standard_runtime_seconds"),
        mapping("meter", "premium_runtime_seconds"),
        mapping("meter", "platform_telephony_charge_minor"),
        mapping("benefit", "premium-realtime"),
        mapping("price", "starter-monthly"),
        mapping("price", "growth-monthly"),
        mapping("price", "scale-monthly"),
      ],
    })).toThrow("Missing production Polar mappings: meter:payg_charge_minor.");
  });
});

function mapping(mappingType: string, internalKey: string) {
  return {
    catalogId: "catalog-v1",
    mappingType,
    internalKey,
    providerId: `polar-${mappingType}-${internalKey}`,
    environment: "production" as const,
  };
}
