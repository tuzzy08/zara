import { Polar } from "@polar-sh/sdk";

export const BILLING_POLAR_CLIENT = Symbol("BILLING_POLAR_CLIENT");

export interface BillingPolarCheckoutInput {
  externalCustomerId: string;
  productId: string;
  successUrl: string;
  returnUrl?: string | undefined;
  metadata: Record<string, string | number | boolean>;
}

export interface BillingPolarPortalInput {
  externalCustomerId: string;
  returnUrl?: string | undefined;
}

export interface BillingPolarUsageInput {
  externalCustomerId: string;
  externalId: string;
  name: string;
  units: number;
  timestamp: string;
  metadata?: Record<string, string | number | boolean> | undefined;
}

export interface BillingPolarClient {
  createdCheckouts: BillingPolarCheckoutInput[];
  createdCustomerSessions: BillingPolarPortalInput[];
  ingestedUsageEvents: BillingPolarUsageInput[];
  createCheckout: (input: BillingPolarCheckoutInput) => Promise<{
    providerCheckoutId: string;
    checkoutUrl: string;
  }>;
  createCustomerPortal: (input: BillingPolarPortalInput) => Promise<{
    customerPortalUrl: string;
  }>;
  ingestUsageEvent: (input: BillingPolarUsageInput) => Promise<{
    providerEventId: string;
  }>;
}

export interface PolarBillingClientConfig {
  accessToken: string;
  server: "sandbox" | "production";
}

export class PolarSdkBillingClient implements BillingPolarClient {
  readonly createdCheckouts: BillingPolarCheckoutInput[] = [];
  readonly createdCustomerSessions: BillingPolarPortalInput[] = [];
  readonly ingestedUsageEvents: BillingPolarUsageInput[] = [];
  private readonly client: Polar;

  constructor(config: PolarBillingClientConfig) {
    this.client = new Polar({
      accessToken: config.accessToken,
      server: config.server,
    });
  }

  async createCheckout(input: BillingPolarCheckoutInput) {
    this.createdCheckouts.push(input);
    const checkout = await this.client.checkouts.create({
      products: [input.productId],
      externalCustomerId: input.externalCustomerId,
      successUrl: input.successUrl,
      returnUrl: input.returnUrl,
      metadata: input.metadata,
      customerMetadata: {
        organizationId: input.externalCustomerId,
      },
    });

    return {
      providerCheckoutId: checkout.id,
      checkoutUrl: checkout.url,
    };
  }

  async createCustomerPortal(input: BillingPolarPortalInput) {
    this.createdCustomerSessions.push(input);
    const session = await this.client.customerSessions.create({
      externalCustomerId: input.externalCustomerId,
      returnUrl: input.returnUrl,
    });

    return {
      customerPortalUrl: session.customerPortalUrl,
    };
  }

  async ingestUsageEvent(input: BillingPolarUsageInput) {
    this.ingestedUsageEvents.push(input);
    await this.client.events.ingest({
      events: [
        {
          externalCustomerId: input.externalCustomerId,
          externalId: input.externalId,
          name: input.name,
          timestamp: new Date(input.timestamp),
          metadata: {
            ...(input.metadata ?? {}),
            units: input.units,
          },
        },
      ],
    });

    return {
      providerEventId: input.externalId,
    };
  }
}

export function resolvePolarBillingClientConfig(env: Record<string, string | undefined>): PolarBillingClientConfig {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim() ?? "";
  const server = env.POLAR_SERVER === "production" ? "production" : "sandbox";

  return {
    accessToken,
    server,
  };
}
