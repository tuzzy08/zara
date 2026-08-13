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

export interface BillingPolarCustomerState {
  customerId: string;
  externalCustomerId: string;
  activeSubscriptions: Array<{
    id: string;
    productId: string;
    status: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
    modifiedAt: string;
  }>;
  grantedBenefits: Array<{
    id: string;
    benefitId: string;
    benefitType: string;
    createdAt: string;
    modifiedAt: string;
  }>;
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
  getCustomerState: (input: { externalCustomerId: string }) => Promise<BillingPolarCustomerState>;
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

  async getCustomerState(input: { externalCustomerId: string }) {
    const state = await this.client.customers.getStateExternal({
      externalId: input.externalCustomerId,
    });
    return {
      customerId: state.id,
      externalCustomerId: state.externalId ?? input.externalCustomerId,
      activeSubscriptions: state.activeSubscriptions.map((subscription) => ({
        id: subscription.id,
        productId: subscription.productId,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        createdAt: subscription.createdAt.toISOString(),
        modifiedAt: (subscription.modifiedAt ?? subscription.createdAt).toISOString(),
      })),
      grantedBenefits: state.grantedBenefits.map((benefit) => ({
        id: benefit.id,
        benefitId: benefit.benefitId,
        benefitType: benefit.benefitType,
        createdAt: benefit.createdAt.toISOString(),
        modifiedAt: (benefit.modifiedAt ?? benefit.createdAt).toISOString(),
      })),
    };
  }

  async getMeterQuantity(input: {
    meterId: string;
    externalCustomerId: string;
    startTimestamp: string;
    endTimestamp: string;
  }) {
    const quantities = await this.client.meters.quantities({
      id: input.meterId,
      startTimestamp: new Date(input.startTimestamp),
      endTimestamp: new Date(input.endTimestamp),
      interval: "day",
      timezone: "UTC",
      externalCustomerId: input.externalCustomerId,
    });
    return { total: quantities.total };
  }

  async getCustomerMeterBalance(input: {
    externalCustomerId: string;
    meterId: string;
  }) {
    const state = await this.client.customers.getStateExternal({
      externalId: input.externalCustomerId,
    });
    const meter = state.activeMeters.find((candidate) => candidate.meterId === input.meterId);
    return meter === undefined ? null : { balance: meter.balance };
  }

  async listCycleOrders(input: {
    organizationId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }) {
    const iterator = await this.client.orders.list({
      externalCustomerId: input.organizationId,
      limit: 100,
    });
    const orders = [];
    for await (const page of iterator) {
      for (const order of page.result.items) {
        const occurredAt = order.modifiedAt ?? order.createdAt;
        if (
          occurredAt >= new Date(input.cycleStartsAt)
          && occurredAt < new Date(input.cycleEndsAt)
        ) {
          orders.push({
            id: order.id,
            totalAmount: order.totalAmount,
            currency: order.currency,
            createdAt: order.createdAt.toISOString(),
          });
        }
      }
    }
    return orders;
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
