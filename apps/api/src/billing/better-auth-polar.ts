import { checkout, polar, portal, usage, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";

import type { BillingPlanSlug, PolarWebhookPayload } from "./billing.models";

export interface BetterAuthPolarProductMapping {
  slug: BillingPlanSlug;
  productId: string;
}

export interface BetterAuthPolarConfig {
  accessToken: string;
  webhookSecret: string;
  server: "sandbox" | "production";
  products: BetterAuthPolarProductMapping[];
  successUrl: string;
  portalReturnUrl?: string | undefined;
  onCustomerStateChanged: (payload: PolarWebhookPayload) => Promise<void>;
  onOrderPaid: (payload: PolarWebhookPayload) => Promise<void>;
}

export function createBetterAuthPolarPlugin(config: BetterAuthPolarConfig) {
  const polarClient = new Polar({
    accessToken: config.accessToken,
    server: config.server,
  });

  return polar({
    client: polarClient,
    createCustomerOnSignUp: true,
    use: [
      checkout({
        products: config.products,
        successUrl: config.successUrl,
        authenticatedUsersOnly: true,
      }),
      portal({
        ...(config.portalReturnUrl !== undefined ? { returnUrl: config.portalReturnUrl } : {}),
      }),
      usage(),
      webhooks({
        secret: config.webhookSecret,
        onCustomerStateChanged: async (payload) => config.onCustomerStateChanged(payload as PolarWebhookPayload),
        onOrderPaid: async (payload) => config.onOrderPaid(payload as PolarWebhookPayload),
      }),
    ],
  });
}
