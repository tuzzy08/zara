export interface BillingPolarMapping {
  catalogId: string;
  mappingType: string;
  internalKey: string;
  providerId: string;
  environment: "sandbox" | "production";
}

export interface BillingChargeDeliveryConfigInput {
  deliveryEnabled: boolean;
  accessToken: string;
  server: "sandbox" | "production";
  webhookSecret: string;
  catalogId: string;
  releaseId: string;
  mappings: BillingPolarMapping[];
}

export function validateBillingChargeDeliveryConfig(
  input: BillingChargeDeliveryConfigInput,
) {
  if (!input.deliveryEnabled) return input;
  if (input.accessToken.trim().length === 0) {
    throw new Error(
      "POLAR_ACCESS_TOKEN is required when charge delivery is enabled.",
    );
  }
  if (input.server !== "production") {
    throw new Error(
      "POLAR_SERVER must be production when charge delivery is enabled.",
    );
  }
  if (input.webhookSecret.trim().length === 0) {
    throw new Error(
      "POLAR_WEBHOOK_SECRET is required when charge delivery is enabled.",
    );
  }
  if (input.releaseId.trim().length === 0) {
    throw new Error(
      "ZARA_RELEASE_ID is required when charge delivery is enabled.",
    );
  }
  const requiredMappings = [
    "product:starter",
    "product:growth",
    "product:scale",
    "credit_pack:payg-5-usd",
    "meter:standard_runtime_seconds",
    "meter:premium_runtime_seconds",
    "meter:platform_telephony_charge_minor",
    "meter:payg_charge_minor",
    "benefit:premium-realtime",
    "price:starter-monthly",
    "price:growth-monthly",
    "price:scale-monthly",
  ];
  const configured = new Set(
    input.mappings
      .filter((mapping) =>
        mapping.catalogId === input.catalogId
        && mapping.environment === "production"
        && mapping.providerId.trim().length > 0
      )
      .map((mapping) => `${mapping.mappingType}:${mapping.internalKey}`),
  );
  const missing = requiredMappings.filter((key) => !configured.has(key));
  if (missing.length > 0) {
    throw new Error(`Missing production Polar mappings: ${missing.join(", ")}.`);
  }
  return input;
}
