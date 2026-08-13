import { afterEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { BillingModule } from "./billing.module";
import { ALLOW_LEGACY_BILLING_USAGE_TEST_FIXTURE } from "./billing.controller";
import {
  BILLING_STATE_REPOSITORY,
  InMemoryBillingStateRepository,
} from "./billing-state.repository";
import {
  BILLING_POLAR_CLIENT,
  type BillingPolarClient,
} from "./polar-billing.client";
import { installTestTenantAuth } from "../testing/tenant-auth-request";
import { BILLING_LEDGER_REPOSITORY } from "./postgres-billing-ledger.repository";
import { BILLING_READ_MODEL_REPOSITORY } from "./billing-read-model.repository";

describe("BillingController", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPolarWebhookSecret = process.env.POLAR_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalPolarWebhookSecret === undefined) {
      delete process.env.POLAR_WEBHOOK_SECRET;
    } else {
      process.env.POLAR_WEBHOOK_SECRET = originalPolarWebhookSecret;
    }
  });

  it("requires tenant membership for tenant billing routes", async () => {
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient, { tenantAuth: false });

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/checkout")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        planSlug: "growth",
        successUrl: "http://127.0.0.1:4173/billing/success",
      });

    expect(response.status).toBe(401);

    await app.close();
  }, 30_000);

  it("returns an honest empty state for a new tenant", async () => {
    const app = await createTestingApp(createPolarClient());

    const response = await request(app.getHttpServer())
      .get("/organizations/tenant-new/billing/state");

    expect(response.status).toBe(200);
    expect(response.body.billing).toMatchObject({
      organizationId: "tenant-new",
      customerExternalId: "tenant-new",
      plan: null,
      subscription: {
        provider: "polar",
        status: "none",
        cancelAtPeriodEnd: false,
      },
      usage: [],
      entitlements: [],
      invoices: [],
    });
    expect(JSON.stringify(response.body)).not.toContain("pending");

    await app.close();
  }, 30_000);

  it("rejects tenant-submitted billing usage facts in the production route graph", async () => {
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient, { legacyUsageFixture: false });

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/billing/usage-events")
        .send({ idempotencyKey: "client-usage", units: 1 }),
      request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/billing/telephony-minute-events")
        .send({ callSessionId: "client-call", billableMinutes: 99 }),
      request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/billing/runtime-cost-events")
        .send({ runtimeEventId: "client-runtime", totalUsd: 99 }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404]);
    expect(polarClient.ingestedUsageEvents).toEqual([]);

    await app.close();
  });

  it("creates organization-linked Polar checkout and customer portal sessions without exposing provider secrets", async () => {
    const polarClient = createPolarClient();
    const ledger = createWebhookReceiptRepository();
    const app = await createTestingApp(polarClient, { billingLedgerRepository: ledger });

    const checkoutResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/checkout")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        planSlug: "growth",
        successUrl: "http://127.0.0.1:4173/billing/success",
      });

    expect(checkoutResponse.status).toBe(201);
    expect(checkoutResponse.body.checkout).toMatchObject({
      organizationId: "tenant-west-africa",
      planSlug: "growth",
      provider: "polar",
      status: "open",
      checkoutUrl: "https://polar.sh/checkout/session_growth",
    });
    expect(polarClient.createdCheckouts[0]).toMatchObject({
      externalCustomerId: "tenant-west-africa",
      productId: "polar-catalog-growth-test",
      metadata: {
        organizationId: "tenant-west-africa",
        actorUserId: "user-ops-lead",
      },
    });
    expect(ledger.tenantAccounts).toEqual([
      expect.objectContaining({
        organizationId: "tenant-west-africa",
        provider: "polar",
      }),
    ]);
    expect(JSON.stringify(checkoutResponse.body)).not.toContain("polar-secret");

    const stateResponse = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/billing/state");
    expect(stateResponse.body.billing.plan).toMatchObject({
      slug: "growth",
      monthlyBaseMinor: null,
      includedStandardRuntimeSeconds: null,
      includedPremiumRuntimeSeconds: null,
    });
    expect(stateResponse.body.billing.plan).not.toMatchObject({
      monthlyBaseUsd: 149,
      includedMinutes: 1000,
    });

    const portalResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/customer-portal")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
      });

    expect(portalResponse.status).toBe(201);
    expect(portalResponse.body.portal).toMatchObject({
      provider: "polar",
      customerPortalUrl: "https://polar.sh/tuzzy/portal/session",
    });
    expect(JSON.stringify(portalResponse.body)).not.toContain("polar-secret");

    await app.close();
  }, 30_000);

  it("updates subscription, entitlement, order, and cancellation state from idempotent Polar webhooks", async () => {
    const polarClient = createPolarClient();
    const ledger = createWebhookReceiptRepository();
    const app = await createTestingApp(polarClient, { billingLedgerRepository: ledger });

    const firstWebhookResponse = await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-subscription-1")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "customer.state_changed",
        data: {
          customer: {
            id: "polar_customer_1",
            externalId: "tenant-west-africa",
          },
          activeSubscriptions: [
            {
              id: "polar_subscription_1",
              productId: "polar-catalog-product-7f31",
              status: "active",
              currentPeriodEnd: "2026-06-22T00:00:00.000Z",
              cancelAtPeriodEnd: false,
              createdAt: "2026-05-22T00:00:00.000Z",
              modifiedAt: "2026-05-23T00:00:00.000Z",
            },
          ],
          grantedBenefits: [
            {
              id: "polar-grant-premium-1",
              benefitId: "polar-benefit-premium",
              benefitType: "custom",
              type: "custom",
              description: "Premium realtime minutes",
              createdAt: "2026-05-22T00:00:00.000Z",
              modifiedAt: "2026-05-23T00:00:00.000Z",
            },
          ],
        },
      });

    expect(firstWebhookResponse.status).toBe(201);
    expect(firstWebhookResponse.body.webhook).toMatchObject({
      eventId: "evt-subscription-1",
      processed: true,
      organizationId: "tenant-west-africa",
    });
    expect(ledger.customerStateProjections).toEqual([
      expect.objectContaining({
        account: expect.objectContaining({
          organizationId: "tenant-west-africa",
          providerCustomerId: "polar_customer_1",
        }),
        subscriptions: [expect.objectContaining({
          providerSubscriptionId: "polar_subscription_1",
          catalogId: "catalog-2026-08-v1",
          status: "active",
          updatedAt: "2026-05-23T00:00:00.000Z",
        })],
        entitlements: [expect.objectContaining({
          providerBenefitId: "polar-benefit-premium",
          key: "premium-realtime",
          status: "active",
        })],
      }),
    ]);

    const replayWebhookResponse = await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-subscription-1")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "customer.state_changed",
        data: {
          customer: {
            id: "polar_customer_1",
            externalId: "tenant-west-africa",
          },
          activeSubscriptions: [
            {
              id: "polar_subscription_1",
              productId: "polar-catalog-product-7f31",
              status: "active",
              currentPeriodEnd: "2026-06-22T00:00:00.000Z",
              cancelAtPeriodEnd: false,
              createdAt: "2026-05-22T00:00:00.000Z",
              modifiedAt: "2026-05-23T00:00:00.000Z",
            },
          ],
          grantedBenefits: [
            {
              id: "polar-grant-premium-1",
              benefitId: "polar-benefit-premium",
              benefitType: "custom",
              type: "custom",
              description: "Premium realtime minutes",
              createdAt: "2026-05-22T00:00:00.000Z",
              modifiedAt: "2026-05-23T00:00:00.000Z",
            },
          ],
        },
      });

    expect(replayWebhookResponse.status).toBe(200);
    expect(replayWebhookResponse.body.webhook).toMatchObject({
      eventId: "evt-subscription-1",
      processed: false,
      replay: true,
    });

    const orderWebhookResponse = await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-order-1")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "order.paid",
        data: {
          id: "polar_order_1",
          status: "paid",
          paid: true,
          invoice_number: "INV-2026-051",
          total_amount: 12900,
          currency: "usd",
          customer: {
            id: "polar_customer_1",
            externalId: "tenant-west-africa",
          },
          product_id: "polar-catalog-product-7f31",
          created_at: "2026-05-22T10:00:00.000Z",
        },
      });

    expect(orderWebhookResponse.status).toBe(201);

    const stateResponse = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/billing/state");

    expect(stateResponse.status).toBe(200);
    expect(stateResponse.body.billing.plan).toMatchObject({
      slug: "growth",
      status: "active",
    });
    expect(stateResponse.body.billing.subscription).toMatchObject({
      providerSubscriptionId: "polar_subscription_1",
      status: "active",
    });
    expect(stateResponse.body.billing.entitlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "polar-grant-premium-1",
          label: "Premium realtime minutes",
        }),
      ]),
    );
    expect(stateResponse.body.billing.invoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerOrderId: "polar_order_1",
          invoiceNumber: "INV-2026-051",
        }),
      ]),
    );
    expect(ledger.invoiceProjections).toEqual([
      {
        id: "polar-invoice:polar_order_1",
        organizationId: "tenant-west-africa",
        providerOrderId: "polar_order_1",
        invoiceNumber: "INV-2026-051",
        currency: "usd",
        amountMinor: 12900,
        status: "paid",
        issuedAt: "2026-05-22T10:00:00.000Z",
        metadata: { productId: "polar-catalog-product-7f31" },
        createdAt: "2026-05-22T10:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(stateResponse.body)).not.toContain("polar-secret");

    await app.close();
  }, 30_000);

  it("rejects subscription checkout when the catalog has no Polar product mapping", async () => {
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient, { subscriptionProductIds: {} });

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/checkout")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        planSlug: "growth",
        successUrl: "http://127.0.0.1:4173/billing/success",
      });

    expect(response.status).toBe(404);
    expect(polarClient.createdCheckouts).toEqual([]);

    await app.close();
  }, 30_000);

  it("fails Polar webhooks closed in production when the webhook secret is unset", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.POLAR_WEBHOOK_SECRET;
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient);

    const response = await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-missing-secret")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "customer.state_changed",
        data: {
          customer: {
            id: "polar_customer_1",
            externalId: "tenant-west-africa",
          },
        },
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain("POLAR_WEBHOOK_SECRET is required");

    await app.close();
  });

  it("does not grant access for an unknown Polar subscription state", async () => {
    const app = await createTestingApp(createPolarClient());

    const webhookResponse = await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-unknown-subscription-state")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "customer.state_changed",
        data: {
          customer: {
            id: "polar_customer_unknown",
            externalId: "tenant-west-africa",
          },
          activeSubscriptions: [{
            id: "polar_subscription_unknown",
            productId: "polar_product_growth",
            status: "future_new_state",
          }],
        },
      });
    const stateResponse = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/billing/state");

    expect(webhookResponse.status).toBe(201);
    expect(stateResponse.body.billing.subscription.status).toBe("none");
    expect(stateResponse.body.billing.plan).toBeNull();

    await app.close();
  });

  it("projects a Polar payment failure as a durable past-due subscription", async () => {
    const ledger = createWebhookReceiptRepository();
    const app = await createTestingApp(createPolarClient(), {
      billingLedgerRepository: ledger,
    });

    const response = await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-subscription-past-due")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "subscription.past_due",
        timestamp: "2026-08-10T09:00:01.000Z",
        data: {
          id: "polar_subscription_failed",
          status: "past_due",
          amount: 12900,
          currency: "usd",
          product_id: "polar_product_growth",
          current_period_end: "2026-09-10T00:00:00.000Z",
          cancel_at_period_end: false,
          created_at: "2026-07-10T09:00:00.000Z",
          modified_at: "2026-08-10T09:00:00.000Z",
          customer: {
            id: "polar_customer_failed",
            external_id: "tenant-west-africa",
          },
        },
      });
    const state = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/billing/state");

    expect(response.status).toBe(201);
    expect(ledger.subscriptionProjections).toEqual([
      expect.objectContaining({
        organizationId: "tenant-west-africa",
        providerSubscriptionId: "polar_subscription_failed",
        catalogId: "catalog-2026-08-v1",
        status: "past_due",
        updatedAt: "2026-08-10T09:00:00.000Z",
      }),
    ]);
    expect(state.body.billing.subscription).toMatchObject({
      providerSubscriptionId: "polar_subscription_failed",
      status: "past_due",
    });

    await app.close();
  }, 30_000);

  it("detects a webhook replay after the billing service restarts", async () => {
    const receipts = createWebhookReceiptRepository();
    const payload = {
      type: "customer.state_changed" as const,
      data: {
        customer: {
          id: "polar_customer_restart",
          externalId: "tenant-west-africa",
        },
        activeSubscriptions: [{
          id: "polar_subscription_restart",
          productId: "polar_product_growth",
          status: "active",
        }],
      },
    };
    const firstApp = await createTestingApp(createPolarClient(), {
      billingLedgerRepository: receipts,
    });
    const first = await request(firstApp.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-restart-replay")
      .set("polar-webhook-signature", "test-signature")
      .send(payload);
    await firstApp.close();

    const restartedApp = await createTestingApp(createPolarClient(), {
      billingLedgerRepository: receipts,
    });
    const replay = await request(restartedApp.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-restart-replay")
      .set("polar-webhook-signature", "test-signature")
      .send(payload);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.webhook).toMatchObject({ processed: false, replay: true });

    await restartedApp.close();
  });

  it("selects the newest safe subscription when Polar returns more than one", async () => {
    const app = await createTestingApp(createPolarClient());

    await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-multiple-subscriptions")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "customer.state_changed",
        data: {
          customer: {
            id: "polar_customer_multiple",
            externalId: "tenant-west-africa",
          },
          activeSubscriptions: [
            {
              id: "polar_subscription_old",
              productId: "polar_product_starter",
              status: "active",
              modified_at: "2026-08-01T00:00:00.000Z",
            },
            {
              id: "polar_subscription_current",
              productId: "polar-catalog-product-7f31",
              status: "active",
              modified_at: "2026-08-10T00:00:00.000Z",
            },
          ],
        },
      });
    const state = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/billing/state");

    expect(state.body.billing.subscription.providerSubscriptionId).toBe(
      "polar_subscription_current",
    );
    expect(state.body.billing.plan.slug).toBe("growth");

    await app.close();
  });

  it("grants only the configured $5 PAYG credit pack from a paid order", async () => {
    const ledger = createWebhookReceiptRepository();
    const app = await createTestingApp(createPolarClient(), {
      billingLedgerRepository: ledger,
    });

    const response = await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-payg-order-paid")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "order.paid",
        data: {
          id: "polar-payg-order-1",
          status: "paid",
          paid: true,
          invoice_number: "INV-PAYG-2026-001",
          total_amount: 500,
          currency: "usd",
          productId: "polar-credit_pack-payg-5-usd",
          created_at: "2026-08-10T06:00:00.000Z",
          customer: { externalId: "tenant-west-africa" },
        },
      });

    expect(response.status).toBe(201);
    expect(ledger.paidPaygOrders).toHaveLength(1);
    expect(ledger.paidPaygOrders[0]).toMatchObject({
      order: { paidAmountMinor: 500, grantedCreditMinor: 500 },
      grant: { entryType: "grant", amountMinor: 500 },
    });

    await app.close();
  });

  it("reverses an unused $5 PAYG credit pack after Polar refunds the order", async () => {
    const ledger = createWebhookReceiptRepository();
    const app = await createTestingApp(createPolarClient(), {
      billingLedgerRepository: ledger,
    });
    const payload = {
      type: "order.refunded",
      data: {
        id: "polar-payg-order-1",
        total_amount: 500,
        refunded_amount: 500,
        currency: "usd",
        product_id: "polar-credit_pack-payg-5-usd",
        modified_at: "2026-08-10T07:00:00.000Z",
        customer: { external_id: "tenant-west-africa" },
      },
    };

    const sendRefund = (eventId: string, body = payload) => request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", eventId)
      .set("polar-webhook-signature", "test-signature")
      .send(body);

    const response = await sendRefund("evt-payg-order-refunded");
    const replay = await sendRefund("evt-payg-order-refunded");
    const partialRefund = await sendRefund("evt-payg-order-partial-refund", {
      ...payload,
      data: { ...payload.data, refunded_amount: 200 },
    });

    expect(response.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.webhook.replay).toBe(true);
    expect(partialRefund.status).toBe(400);
    expect(ledger.refundedPaygOrders).toEqual([{
      organizationId: "tenant-west-africa",
      providerOrderId: "polar-payg-order-1",
      reversal: {
        id: "payg-reversal:polar-payg-order-1",
        organizationId: "tenant-west-africa",
        orderId: "payg-order:polar-payg-order-1",
        entryType: "reversal",
        amountMinor: 500,
        idempotencyKey: "polar-order:polar-payg-order-1:refund",
        createdAt: "2026-08-10T07:00:00.000Z",
      },
    }]);

    await app.close();
  }, 15_000);

  it("deduplicates usage billing events before sending them to Polar", async () => {
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient);

    const usagePayload = {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      idempotencyKey: "usage-live-session-1",
      name: "zara_runtime_usage",
      units: 12,
      occurredAt: "2026-05-22T11:00:00.000Z",
      metadata: {
        workspaceId: "workspace-default",
        source: "premium-realtime",
      },
    };

    const firstUsageResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/usage-events")
      .send(usagePayload);

    const replayUsageResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/usage-events")
      .send(usagePayload);

    expect(firstUsageResponse.status).toBe(201);
    expect(firstUsageResponse.body.usageEvent).toMatchObject({
      organizationId: "tenant-west-africa",
      idempotencyKey: "usage-live-session-1",
      provider: "polar",
      status: "sent",
    });
    expect(replayUsageResponse.status).toBe(200);
    expect(replayUsageResponse.body.usageEvent).toMatchObject({
      idempotencyKey: "usage-live-session-1",
      duplicate: true,
    });
    expect(polarClient.ingestedUsageEvents).toHaveLength(1);
    expect(polarClient.ingestedUsageEvents[0]).toMatchObject({
      externalCustomerId: "tenant-west-africa",
      name: "zara_runtime_usage",
      metadata: {
        workspaceId: "workspace-default",
        source: "premium-realtime",
      },
    });

    await app.close();
  });

  it("aggregates idempotent usage billing events by tenant and feature", async () => {
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient);

    const firstRuntimeUsage = {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      idempotencyKey: "usage-runtime-1",
      name: "zara_runtime_usage",
      feature: "runtime_minutes",
      units: 8,
      occurredAt: "2026-05-22T10:00:00.000Z",
    };

    const secondRuntimeUsage = {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      idempotencyKey: "usage-runtime-2",
      name: "zara_runtime_usage",
      feature: "runtime_minutes",
      units: 4,
      occurredAt: "2026-05-22T10:05:00.000Z",
    };

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/usage-events")
      .send(firstRuntimeUsage);
    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/usage-events")
      .send(firstRuntimeUsage);
    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/usage-events")
      .send(secondRuntimeUsage);

    const stateResponse = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/billing/state");

    expect(stateResponse.status).toBe(200);
    expect(stateResponse.body.billing.usageAggregates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: "tenant-west-africa",
          feature: "runtime_minutes",
          units: 12,
          eventCount: 2,
          lastOccurredAt: "2026-05-22T10:05:00.000Z",
        }),
      ]),
    );
    expect(polarClient.ingestedUsageEvents).toHaveLength(2);

    await app.close();
  });

  it("accounts telephony minutes by tenant, provider connection, and failed-call classification", async () => {
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient);

    const completedResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/telephony-minute-events")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        callSessionId: "call-completed-1",
        provider: "twilio",
        providerConnectionId: "connection-twilio-west",
        startedAt: "2026-05-22T10:00:00.000Z",
        endedAt: "2026-05-22T10:01:01.000Z",
        outcome: "completed",
      });
    const failedResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/telephony-minute-events")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        callSessionId: "call-failed-1",
        provider: "twilio",
        providerConnectionId: "connection-twilio-west",
        startedAt: "2026-05-22T10:03:00.000Z",
        endedAt: "2026-05-22T10:03:07.000Z",
        outcome: "failed",
        failureReason: "provider_busy",
      });

    expect(completedResponse.status).toBe(201);
    expect(completedResponse.body.telephonyMinuteEvent).toMatchObject({
      organizationId: "tenant-west-africa",
      provider: "twilio",
      providerConnectionId: "connection-twilio-west",
      classification: "completed",
      durationSeconds: 61,
      billableMinutes: 2,
      roundingPolicy: "round_up_to_next_full_minute",
    });
    expect(failedResponse.status).toBe(201);
    expect(failedResponse.body.telephonyMinuteEvent).toMatchObject({
      classification: "failed",
      billableMinutes: 0,
      failureReason: "provider_busy",
    });

    const stateResponse = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/billing/state");

    expect(stateResponse.body.billing.telephonyMinuteAggregates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: "tenant-west-africa",
          provider: "twilio",
          providerConnectionId: "connection-twilio-west",
          billableMinutes: 2,
          completedCalls: 1,
          failedCalls: 1,
          transferredCalls: 0,
        }),
      ]),
    );

    await app.close();
  });

  it("maps runtime cost events into versioned model, STT, and TTS billing usage with unknown-rate flags", async () => {
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient);

    const accountedResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/runtime-cost-events")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        runtimeEventId: "turn-cost-1",
        sessionId: "sandbox-live-1",
        workspaceId: "workspace-default",
        occurredAt: "2026-05-22T12:00:00.000Z",
        modelTier: "standard",
        rateVersion: "runtime-rates-2026-05",
        providers: {
          stt: "assemblyai-streaming",
          model: "openai-chat",
          tts: "cartesia-sonic-3",
        },
        usage: {
          sttMinutes: 0.08,
          modelInputTokens: 120,
          modelOutputTokens: 96,
          ttsCharacters: 180,
        },
      });
    const unknownRateResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/runtime-cost-events")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        runtimeEventId: "turn-cost-unknown-rate",
        sessionId: "sandbox-live-2",
        occurredAt: "2026-05-22T12:01:00.000Z",
        modelTier: "experimental",
        rateVersion: "runtime-rates-2026-05",
        providers: {
          model: "unknown-model",
        },
        usage: {
          modelInputTokens: 55,
          modelOutputTokens: 33,
        },
      });

    expect(accountedResponse.status).toBe(201);
    expect(accountedResponse.body.runtimeCostEvent).toMatchObject({
      organizationId: "tenant-west-africa",
      sourceRuntimeEventId: "turn-cost-1",
      rateVersion: "runtime-rates-2026-05",
      complete: true,
      missingRates: [],
    });
    expect(accountedResponse.body.runtimeCostEvent.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "stt", feature: "stt_minutes", units: 0.08 }),
        expect.objectContaining({ kind: "model_input", feature: "model_input_tokens", units: 120 }),
        expect.objectContaining({ kind: "model_output", feature: "model_output_tokens", units: 96 }),
        expect.objectContaining({ kind: "tts", feature: "tts_characters", units: 180 }),
      ]),
    );
    expect(unknownRateResponse.status).toBe(201);
    expect(unknownRateResponse.body.runtimeCostEvent).toMatchObject({
      complete: false,
      missingRates: ["model_input:experimental", "model_output:experimental"],
    });

    const stateResponse = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/billing/state");

    expect(stateResponse.body.billing.runtimeCostEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRuntimeEventId: "turn-cost-1",
          rateVersion: "runtime-rates-2026-05",
          totalUsd: expect.any(Number),
        }),
        expect.objectContaining({
          sourceRuntimeEventId: "turn-cost-unknown-rate",
          complete: false,
        }),
      ]),
    );
    expect(stateResponse.body.billing.usageAggregates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ feature: "stt_minutes", units: 0.08 }),
        expect.objectContaining({ feature: "model_input_tokens", units: 120 }),
        expect.objectContaining({ feature: "model_output_tokens", units: 96 }),
        expect.objectContaining({ feature: "tts_characters", units: 180 }),
      ]),
    );
    expect(polarClient.ingestedUsageEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "zara_runtime_stt_minutes",
          externalId: "runtime-cost-turn-cost-1-stt_minutes",
          metadata: expect.objectContaining({
            runtimeEventId: "turn-cost-1",
            rateVersion: "runtime-rates-2026-05",
          }),
        }),
      ]),
    );

    await app.close();
  });

  it("enforces configurable tenant call and premium runtime budgets with admin-visible warnings", async () => {
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient);

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/checkout")
      .send({
        actorUserId: "user-finance-admin",
        actorRole: "admin",
        planSlug: "starter",
        successUrl: "http://127.0.0.1:4173/billing/success",
      });
    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/runtime-cost-events")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        runtimeEventId: "budget-runtime-cost",
        sessionId: "budget-session",
        occurredAt: "2026-05-22T12:00:00.000Z",
        modelTier: "standard",
        rateVersion: "runtime-rates-2026-05",
        providers: { stt: "assemblyai-streaming" },
        usage: { sttMinutes: 36_000 },
      });
    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/telephony-minute-events")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        callSessionId: "budget-call",
        provider: "twilio",
        providerConnectionId: "budget-connection",
        startedAt: "2026-05-22T12:00:00.000Z",
        endedAt: "2026-05-22T12:01:01.000Z",
        outcome: "completed",
      });
    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/usage-events")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        idempotencyKey: "budget-premium-runtime",
        name: "zara_premium_runtime",
        feature: "premium_runtime_minutes",
        units: 2,
        occurredAt: "2026-05-22T12:00:00.000Z",
      });

    const policyResponse = await request(app.getHttpServer())
      .patch("/organizations/tenant-west-africa/billing/budget-policy")
      .send({
        actorUserId: "user-finance-admin",
        actorRole: "admin",
        monthlyBudgetUsd: 10,
        callMinuteLimit: 2.5,
        premiumRuntimeMinuteLimit: 2.5,
        overBudgetBehavior: "block",
        warningThresholdPercent: 80,
      });

    expect(policyResponse.status).toBe(200);
    expect(policyResponse.body.budgetPolicy).toMatchObject({
      monthlyBudgetUsd: 10,
      callMinuteLimit: 2.5,
      premiumRuntimeMinuteLimit: 2.5,
      overBudgetBehavior: "block",
    });

    const decisionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/budget-checks")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        requestKind: "premium_runtime",
        estimatedCostUsd: 2,
        callMinutes: 1,
        premiumRuntimeMinutes: 1,
        now: "2026-05-22T12:30:00.000Z",
      });

    expect(decisionResponse.status).toBe(200);
    expect(decisionResponse.body.budgetDecision).toMatchObject({
      organizationId: "tenant-west-africa",
      allowed: false,
      action: "block",
      overBudgetBehavior: "block",
    });
    expect(decisionResponse.body.budgetDecision.reasons).toEqual(
      expect.arrayContaining([
        "monthly_budget_exceeded",
        "call_minute_limit_exceeded",
        "premium_runtime_limit_exceeded",
      ]),
    );

    const stateResponse = await request(app.getHttpServer())
      .get("/organizations/tenant-west-africa/billing/state");

    expect(stateResponse.body.billing.budgetPolicy).toMatchObject({
      monthlyBudgetUsd: 10,
      overBudgetBehavior: "block",
    });
    expect(stateResponse.body.billing.budgetWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "monthly_budget_near_limit",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "call_minutes_near_limit",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "premium_runtime_near_limit",
          severity: "warning",
        }),
      ]),
    );

    const warnPolicyResponse = await request(app.getHttpServer())
      .patch("/organizations/tenant-west-africa/billing/budget-policy")
      .send({
        actorUserId: "user-finance-admin",
        actorRole: "admin",
        monthlyBudgetUsd: 10,
        callMinuteLimit: 2.5,
        premiumRuntimeMinuteLimit: 2.5,
        overBudgetBehavior: "warn",
      });
    expect(warnPolicyResponse.status).toBe(200);

    const warnDecisionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/budget-checks")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        requestKind: "call",
        estimatedCostUsd: 2,
        callMinutes: 1,
        premiumRuntimeMinutes: 0,
      });

    expect(warnDecisionResponse.body.budgetDecision).toMatchObject({
      allowed: true,
      action: "warn",
      overBudgetBehavior: "warn",
    });

    await app.close();
  });
});

async function createTestingApp(
  polarClient: BillingPolarClient,
  options: {
    tenantAuth?: boolean | undefined;
    legacyUsageFixture?: boolean | undefined;
    billingLedgerRepository?: ReturnType<typeof createWebhookReceiptRepository> | undefined;
    subscriptionProductIds?: Partial<Record<"starter" | "growth" | "scale", string>> | undefined;
  } = {},
) {
  const moduleRef = await Test.createTestingModule({
    imports: [BillingModule],
  })
    .overrideProvider(BILLING_STATE_REPOSITORY)
    .useValue(new InMemoryBillingStateRepository())
    .overrideProvider(BILLING_POLAR_CLIENT)
    .useValue(polarClient)
    .overrideProvider(BILLING_LEDGER_REPOSITORY)
    .useValue(options.billingLedgerRepository ?? createWebhookReceiptRepository())
    .overrideProvider(BILLING_READ_MODEL_REPOSITORY)
    .useValue(createBillingReadModelFixture(options.subscriptionProductIds))
    .overrideProvider(ALLOW_LEGACY_BILLING_USAGE_TEST_FIXTURE)
    .useValue(options.legacyUsageFixture ?? true)
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  if (options.tenantAuth !== false) {
    installTestTenantAuth(app);
  }
  await app.init();
  return app;
}

function createBillingReadModelFixture(
  subscriptionProductIds: Partial<Record<"starter" | "growth" | "scale", string>> = {
    starter: "polar-catalog-starter-test",
    growth: "polar-catalog-growth-test",
    scale: "polar-catalog-scale-test",
  },
) {
  return {
    async load() {
      throw new Error("The in-memory controller fixture owns billing state reads.");
    },
    async getPaygProductId() {
      return "polar-credit_pack-payg-5-usd";
    },
    async getSubscriptionProductId(planSlug: "starter" | "growth" | "scale") {
      return subscriptionProductIds[planSlug] ?? null;
    },
  };
}

function createWebhookReceiptRepository() {
  const receipts = new Map<string, { eventType: string; payloadHash: string }>();
  const paidPaygOrders: unknown[] = [];
  const refundedPaygOrders: unknown[] = [];
  const tenantAccounts: unknown[] = [];
  const customerStateProjections: unknown[] = [];
  const invoiceProjections: unknown[] = [];
  const subscriptionProjections: unknown[] = [];
  return {
    paidPaygOrders,
    refundedPaygOrders,
    tenantAccounts,
    customerStateProjections,
    invoiceProjections,
    subscriptionProjections,
    async upsertTenantAccount(input: unknown) {
      tenantAccounts.push(input);
    },
    async listTenantAccounts() {
      return [];
    },
    async listSubscriptionProjections() {
      return [];
    },
    async applyPolarCustomerStateProjection(input: unknown) {
      customerStateProjections.push(input);
      return { changed: false };
    },
    async applyPaidInvoiceProjection(input: unknown) {
      invoiceProjections.push(input);
      return { duplicate: false };
    },
    async upsertSubscriptionProjection(input: unknown) {
      subscriptionProjections.push(input);
    },
    async recordPolarWebhookReceipt(input: {
      organizationId: string;
      eventId: string;
      eventType: string;
      payloadHash: string;
    }) {
      const key = `${input.organizationId}:${input.eventId}`;
      const existing = receipts.get(key);
      if (existing !== undefined) {
        if (
          existing.eventType !== input.eventType
          || existing.payloadHash !== input.payloadHash
        ) {
          throw new Error("Webhook replay payload does not match the original event.");
        }
        return { duplicate: true };
      }
      receipts.set(key, {
        eventType: input.eventType,
        payloadHash: input.payloadHash,
      });
      return { duplicate: false };
    },
    async markPolarWebhookProcessed() {},
    async findPolarMappingByProviderId(providerId: string) {
      const mapping = {
        "polar-credit_pack-payg-5-usd": ["credit_pack", "payg-5-usd"],
        "polar_product_starter": ["product", "starter"],
        "polar_product_growth": ["product", "growth"],
        "polar-catalog-product-7f31": ["product", "growth"],
        "polar-benefit-premium": ["benefit", "premium-realtime"],
      }[providerId];
      return mapping === undefined ? null : {
        catalogId: "catalog-2026-08-v1",
        mappingType: mapping[0],
        internalKey: mapping[1],
        providerId,
        environment: "sandbox",
      };
    },
    async applyPaidPaygOrder(input: unknown) {
      paidPaygOrders.push(input);
      return { duplicate: false };
    },
    async applyPaygOrderRefund(input: unknown) {
      refundedPaygOrders.push(input);
      return { duplicate: false };
    },
  };
}

function createPolarClient() {
  const createdCheckouts: BillingPolarClient["createdCheckouts"] = [];
  const createdCustomerSessions: BillingPolarClient["createdCustomerSessions"] = [];
  const ingestedUsageEvents: BillingPolarClient["ingestedUsageEvents"] = [];

  const client: BillingPolarClient = {
    createdCheckouts,
    createdCustomerSessions,
    ingestedUsageEvents,
    async createCheckout(input) {
      createdCheckouts.push(input);
      return {
        providerCheckoutId: "polar_checkout_growth",
        checkoutUrl: "https://polar.sh/checkout/session_growth",
      };
    },
    async createCustomerPortal(input) {
      createdCustomerSessions.push(input);
      return {
        customerPortalUrl: "https://polar.sh/tuzzy/portal/session",
      };
    },
    async ingestUsageEvent(input) {
      ingestedUsageEvents.push(input);
      return {
        providerEventId: "polar_usage_event_1",
      };
    },
    async getCustomerState(input) {
      return {
        customerId: `polar-customer:${input.externalCustomerId}`,
        externalCustomerId: input.externalCustomerId,
        activeSubscriptions: [],
        grantedBenefits: [],
      };
    },
  };

  return client;
}
