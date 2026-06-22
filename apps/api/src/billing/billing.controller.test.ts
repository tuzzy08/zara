import { afterEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { BillingModule } from "./billing.module";
import {
  BILLING_STATE_REPOSITORY,
  InMemoryBillingStateRepository,
} from "./billing-state.repository";
import {
  BILLING_POLAR_CLIENT,
  type BillingPolarClient,
} from "./polar-billing.client";
import { installTestTenantAuth } from "../testing/tenant-auth-request";

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

  it("creates organization-linked Polar checkout and customer portal sessions without exposing provider secrets", async () => {
    const polarClient = createPolarClient();
    const app = await createTestingApp(polarClient);

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
      metadata: {
        organizationId: "tenant-west-africa",
        actorUserId: "user-ops-lead",
      },
    });
    expect(JSON.stringify(checkoutResponse.body)).not.toContain("polar-secret");

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
    const app = await createTestingApp(polarClient);

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
              productId: "polar_product_growth",
              status: "active",
              currentPeriodEnd: "2026-06-22T00:00:00.000Z",
              cancelAtPeriodEnd: false,
            },
          ],
          grantedBenefits: [
            {
              id: "benefit-premium-runtime",
              type: "custom",
              description: "Premium realtime minutes",
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
          invoiceNumber: "INV-2026-051",
          amount: 12900,
          currency: "usd",
          customer: {
            id: "polar_customer_1",
            externalId: "tenant-west-africa",
          },
          productId: "polar_product_growth",
          createdAt: "2026-05-22T10:00:00.000Z",
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
          id: "benefit-premium-runtime",
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
    expect(JSON.stringify(stateResponse.body)).not.toContain("polar-secret");

    await app.close();
  });

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

    const policyResponse = await request(app.getHttpServer())
      .patch("/organizations/tenant-west-africa/billing/budget-policy")
      .send({
        actorUserId: "user-finance-admin",
        actorRole: "admin",
        monthlyBudgetUsd: 750,
        callMinuteLimit: 6231,
        premiumRuntimeMinuteLimit: 187,
        overBudgetBehavior: "block",
        warningThresholdPercent: 80,
      });

    expect(policyResponse.status).toBe(200);
    expect(policyResponse.body.budgetPolicy).toMatchObject({
      monthlyBudgetUsd: 750,
      callMinuteLimit: 6231,
      premiumRuntimeMinuteLimit: 187,
      overBudgetBehavior: "block",
    });

    const decisionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/budget-checks")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        requestKind: "premium_runtime",
        estimatedCostUsd: 20,
        callMinutes: 2,
        premiumRuntimeMinutes: 2,
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
      monthlyBudgetUsd: 750,
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
        monthlyBudgetUsd: 750,
        callMinuteLimit: 6231,
        premiumRuntimeMinuteLimit: 187,
        overBudgetBehavior: "warn",
      });
    expect(warnPolicyResponse.status).toBe(200);

    const warnDecisionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/billing/budget-checks")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        requestKind: "call",
        estimatedCostUsd: 20,
        callMinutes: 2,
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
  options: { tenantAuth?: boolean | undefined } = {},
) {
  const moduleRef = await Test.createTestingModule({
    imports: [BillingModule],
  })
    .overrideProvider(BILLING_STATE_REPOSITORY)
    .useValue(new InMemoryBillingStateRepository())
    .overrideProvider(BILLING_POLAR_CLIENT)
    .useValue(polarClient)
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  if (options.tenantAuth !== false) {
    installTestTenantAuth(app);
  }
  await app.init();
  return app;
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
  };

  return client;
}
