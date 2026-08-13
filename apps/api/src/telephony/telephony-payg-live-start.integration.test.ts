import type { INestApplication } from "@nestjs/common";
import { computeTwilioWebhookSignature } from "@zara/core";
import { newDb } from "pg-mem";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingChargeReservationRepository } from "../billing/billing-charge-reservation.repository";
import { BillingPaygReservationQuoteService } from "../billing/billing-payg-reservation-quote.service";
import { BillingPaygEligibilityService } from "../billing/billing-payg-eligibility.service";
import {
  BILLING_STATE_REPOSITORY,
  type BillingStateRepository,
} from "../billing/billing-state.repository";
import { PostgresBillingLedgerRepository } from "../billing/postgres-billing-ledger.repository";
import { TrustedPaygCallLifecycleService } from "../billing/trusted-payg-call-lifecycle.service";
import { TrustedCallCommercialModeResolver } from "../billing/trusted-call-commercial-mode-resolver";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import { createTestingApp } from "./telephony.controller.test-support";
import { TrustedPaygTelephonyCallStartService } from "./trusted-payg-telephony-call-start.service";
import { TELEPHONY_INCREMENTAL_REPOSITORY } from "./telephony-incremental.repository";
import type { InMemoryTelephonyIncrementalRepository } from "./telephony-incremental.repository.test-helper";

const organizationId = "tenant-west-africa";
const accountSid = "AC1234567890abcdef1234567890abcd";
const authToken = "twilio-auth-token-1234567890";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("PAYG live webhook reservation", () => {
  it("blocks premium PAYG when active reservations exhaust the paid credit", async () => {
    const harness = await createPaygWebhookHarness({
      catalog: true,
      credit: true,
      reservedMinor: 500,
      runtimeProfile: "premium-realtime",
    });
    try {
      expect(harness.activationStatus).toBe(409);
      const admission = vi.spyOn(harness.app.get(PstnAdmissionCoordinator), "reserve");

      const response = await harness.answer("CA-payg-exhausted", "EV-payg-exhausted");

      expect(response.text).not.toContain("<Connect>");
      expect(admission).not.toHaveBeenCalled();
      await expect(harness.reservations.listReservations(organizationId)).resolves.toEqual([]);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it("durably reserves paid BYO premium credit before admission and Connect", async () => {
    const harness = await createPaygWebhookHarness({ catalog: true, credit: true, runtimeProfile: "premium-realtime" });
    try {
      expect(harness.commercialPosture).toEqual({
        mode: "payg",
        available: true,
        availablePaygMinor: 500,
      });
      expect(harness.activationStatus, JSON.stringify(harness.activationBody)).toBe(201);
      let reservationDuringAdmission: unknown;
      const coordinator = harness.app.get(PstnAdmissionCoordinator);
      const reserve = coordinator.reserve.bind(coordinator);
      vi.spyOn(coordinator, "reserve").mockImplementation(async (input) => {
        reservationDuringAdmission = await harness.reservations.listReservations(organizationId);
        return reserve(input);
      });

      const response = await harness.answer("CA-payg-paid", "EV-payg-paid");

      expect(response.text).toContain("<Connect>");
      expect(reservationDuringAdmission).toEqual([expect.objectContaining({
        id: "payg-call-reservation:CA-payg-paid:telephony", catalogId: "catalog-payg-v1",
        status: "active", reservedAmountMinor: 225,
      })]);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it("releases paid PAYG credit when premium call setup persistence fails", async () => {
    const harness = await createPaygWebhookHarness({
      catalog: true, credit: true, runtimeProfile: "premium-realtime",
    });
    try {
      const incrementalRepository = harness.app.get<InMemoryTelephonyIncrementalRepository>(
        TELEPHONY_INCREMENTAL_REPOSITORY,
      );
      vi.spyOn(incrementalRepository, "createCallSetup")
        .mockRejectedValueOnce(new Error("setup failed"));

      const response = await harness.answer("CA-payg-setup-failure", "EV-payg-setup-failure");

      expect(response.text).not.toContain("<Connect>");
      await expect(harness.reservations.listReservations(organizationId)).resolves.toEqual([
        expect.objectContaining({
          id: "payg-call-reservation:CA-payg-setup-failure:telephony",
          organizationId,
          status: "released",
        }),
      ]);
      await expect(harness.ledger.listPaygCreditEntries(organizationId)).resolves.toEqual([
        expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
      ]);
    } finally { await harness.close(); }
  }, 30_000);

  it("blocks paid BYO sandwich before reservation, admission, and Connect", async () => {
    const harness = await createPaygWebhookHarness({ catalog: true, credit: true });
    try {
      const admission = vi.spyOn(harness.app.get(PstnAdmissionCoordinator), "reserve");
      const response = await harness.answer("CA-payg-standard", "EV-payg-standard");
      expect(response.text).not.toContain("<Connect>");
      expect(admission).not.toHaveBeenCalled();
      await expect(harness.reservations.listReservations(organizationId)).resolves.toEqual([]);
    } finally { await harness.close(); }
  }, 30_000);

  it("blocks premium admission when plan-null billing has an ambiguous subscription state", async () => {
    const harness = await createPaygWebhookHarness({
      catalog: true, credit: true, runtimeProfile: "premium-realtime", subscriptionStatus: "past_due",
    });
    try {
      const admission = vi.spyOn(harness.app.get(PstnAdmissionCoordinator), "reserve");
      const response = await harness.answer("CA-payg-ambiguous", "EV-payg-ambiguous");
      expect(response.text).not.toContain("<Connect>");
      expect(admission).not.toHaveBeenCalled();
      await expect(harness.reservations.listReservations(organizationId)).resolves.toEqual([]);
    } finally { await harness.close(); }
  }, 30_000);

  it("returns unavailable and does not request admission without paid credit", async () => {
    const harness = await createPaygWebhookHarness({ catalog: true, credit: false });
    try {
      expect(harness.activationStatus).toBe(409);
      const admission = vi.spyOn(
        harness.app.get(PstnAdmissionCoordinator),
        "reserve",
      );

      const response = await harness.answer("CA-payg-empty", "EV-payg-empty");

      expect(response.text).not.toContain("<Connect>");
      expect(admission).not.toHaveBeenCalled();
      await expect(harness.reservations.listReservations(organizationId))
        .resolves.toEqual([]);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it("does not resume a PAYG live route after its paid credit is reversed", async () => {
    const harness = await createPaygWebhookHarness({ catalog: true, credit: true });
    try {
      expect(harness.activationStatus).toBe(201);
      await request(harness.app.getHttpServer())
        .post(`/organizations/${organizationId}/telephony/numbers/${harness.phoneNumberId}/live-route/pause`)
        .send({ actorUserId: "user-ops-lead" })
        .expect(201);
      await harness.ledger.applyPaygOrderRefund({
        organizationId,
        providerOrderId: "polar-order-http",
        reversal: {
          id: "payg-reversal-http",
          organizationId,
          orderId: "payg-order-http",
          entryType: "reversal",
          amountMinor: 500,
          idempotencyKey: "polar-order:polar-order-http:refund-reversal",
          createdAt: "2026-08-11T09:01:00.000Z",
        },
      });

      const resume = await request(harness.app.getHttpServer())
        .post(`/organizations/${organizationId}/telephony/numbers/${harness.phoneNumberId}/live-route/resume`)
        .send({
          actorUserId: "user-ops-lead",
          now: "2026-08-11T09:02:00.000Z",
          override: {
            actorUserId: "user-ops-lead",
            approvedByUserId: "platform-admin-1",
            reason: "PAYG resume credit test.",
          },
        });

      expect(resume.status).toBe(409);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it("does not create a sandwich claim when downstream admission would fail", async () => {
    const harness = await createPaygWebhookHarness({ catalog: true, credit: true });
    try {
      const admission = vi.spyOn(harness.app.get(PstnAdmissionCoordinator), "reserve")
        .mockResolvedValue({
          outcome: "denied",
          reasonCode: "global_concurrency_limit",
          limitingDimension: "global_concurrency",
        });

      const response = await harness.answer(
        "CA-payg-admission-denied",
        "EV-payg-admission-denied",
      );

      expect(response.text).not.toContain("<Connect>");
      expect(admission).not.toHaveBeenCalled();
      await expect(harness.reservations.listReservations(organizationId)).resolves.toEqual([]);
      await expect(harness.ledger.listPaygCreditEntries(organizationId))
        .resolves.toEqual([
          expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
        ]);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it("fails closed before admission when the price catalog is unknown", async () => {
    const harness = await createPaygWebhookHarness({ catalog: false, credit: true });
    try {
      const admission = vi.spyOn(
        harness.app.get(PstnAdmissionCoordinator),
        "reserve",
      );

      const response = await harness.answer(
        "CA-payg-unknown-catalog",
        "EV-payg-unknown-catalog",
      );

      expect(response.text).not.toContain("<Connect>");
      expect(admission).not.toHaveBeenCalled();
      await expect(harness.reservations.listReservations(organizationId))
        .resolves.toEqual([]);
    } finally {
      await harness.close();
    }
  }, 30_000);
});

async function createPaygWebhookHarness(input: {
  catalog: boolean;
  credit: boolean;
  reservedMinor?: number | undefined;
  runtimeProfile?: "cost-optimized" | "premium-realtime" | undefined;
  subscriptionStatus?: "none" | "past_due" | undefined;
}) {
  vi.stubEnv("PAYG_MAXIMUM_CALL_SECONDS", "300");
  vi.stubEnv("PAYG_RESERVATION_TTL_SECONDS", "360");
  vi.stubEnv("PSTN_ADMISSION_MODE", "memory");

  const database = newDb();
  database.public.none(`
    create table billing_price_catalogs (
      id text primary key,
      version integer not null unique,
      status text not null,
      currency text not null,
      effective_from timestamptz not null,
      checksum text not null,
      catalog_document jsonb not null,
      approved_by text not null,
      approved_at timestamptz not null,
      created_at timestamptz not null
    );
    create table billing_payg_orders (
      tenant_id text not null,
      id text not null,
      provider_order_id text not null unique,
      currency text not null,
      paid_amount_minor bigint not null,
      granted_credit_minor bigint not null,
      status text not null,
      created_at timestamptz not null,
      primary key (tenant_id, id)
    );
    create table billing_payg_credit_entries (
      tenant_id text not null,
      id text not null,
      order_id text,
      session_id text,
      entry_type text not null,
      amount_minor bigint not null,
      idempotency_key text not null,
      expires_at timestamptz,
      created_at timestamptz not null,
      primary key (tenant_id, id),
      unique (tenant_id, idempotency_key)
    );
    create table billing_reservation_accounts (
      tenant_id text primary key,
      reserved_amount_minor bigint not null default 0,
      updated_at timestamptz not null
    );
    create table billing_subscriptions (
      tenant_id text not null, id text not null, catalog_id text not null,
      plan_slug text, status text not null, current_period_end timestamptz,
      primary key (tenant_id, id)
    );
    create table billing_entitlements (
      tenant_id text not null, key text not null, status text not null
    );
    create table billing_charge_reservations (
      tenant_id text not null,
      id text not null,
      reservation_key text not null,
      catalog_id text,
      charge_context jsonb,
      funding_source text not null,
      status text not null,
      reserved_amount_minor bigint not null,
      actual_amount_minor bigint,
      session_id text,
      terminal_outcome text,
      currency text not null,
      expires_at timestamptz not null,
      finalized_at timestamptz,
      released_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (tenant_id, id),
      unique (tenant_id, reservation_key)
    );
    create table billing_terminal_recovery_jobs (
      tenant_id text not null,
      reservation_id text not null,
      commercial_mode text not null,
      status text not null
    )
  `);
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();
  const ledger = new PostgresBillingLedgerRepository(pool);
  const reservations = new BillingChargeReservationRepository(pool);
  if (input.catalog) {
    await ledger.publishPriceCatalog({
      id: "catalog-payg-v1",
      version: 1,
      status: "active",
      currency: "usd",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      checksum: "a".repeat(64),
      document: {
        payg: {
          standardRuntimePerMinuteMinor: 18,
          premiumRuntimePerMinuteMinor: 45,
        },
      },
      approvedBy: "billing-approver",
      approvedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }
  if (input.credit) {
    await ledger.applyPaidPaygOrder({
      order: {
        id: "payg-order-http",
        organizationId,
        providerOrderId: "polar-order-http",
        currency: "usd",
        paidAmountMinor: 500,
        grantedCreditMinor: 500,
        status: "paid",
        createdAt: "2026-08-11T08:00:00.000Z",
      },
      grant: {
        id: "payg-grant-http",
        organizationId,
        orderId: "payg-order-http",
        entryType: "grant",
        amountMinor: 500,
        idempotencyKey: "payg-grant:polar-order-http",
        createdAt: "2026-08-11T08:00:00.000Z",
      },
    });
  }
  if (input.reservedMinor !== undefined) {
    await pool.query(`insert into billing_reservation_accounts
      (tenant_id, reserved_amount_minor, updated_at) values ($1, $2, $3)`, [
      organizationId,
      input.reservedMinor,
      "2026-08-11T08:30:00.000Z",
    ]);
  }
  if (input.subscriptionStatus === "past_due") {
    await pool.query(`insert into billing_subscriptions
      (tenant_id, id, catalog_id, plan_slug, status, current_period_end)
      values ($1, $2, $3, $4, $5, $6)`, [
      organizationId,
      "subscription-ambiguous",
      "catalog-payg-v1",
      "growth",
      "past_due",
      "2026-09-01T00:00:00.000Z",
    ]);
  }
  const paygCallStart = new TrustedPaygTelephonyCallStartService(
    new BillingPaygReservationQuoteService(ledger),
    new TrustedPaygCallLifecycleService(reservations),
  );
  const commercialModeResolver = new TrustedCallCommercialModeResolver(pool);
  const commercialPosture = await commercialModeResolver.resolve(
    organizationId,
    "2026-08-11T09:00:00.000Z",
    input.runtimeProfile === "premium-realtime" ? "premium" : "standard",
  );
  const app = await createTestingApp({
    paygCallStart,
    paygEligibility: new BillingPaygEligibilityService(ledger, reservations),
    skipTestBillingPlan: true,
    billingService: {
      async getBillingState() {
        return {
          organizationId,
          provider: "polar" as const,
          customerExternalId: organizationId,
          plan: null,
          subscription: {
            provider: "polar" as const,
            status: input.subscriptionStatus ?? "none" as const,
            cancelAtPeriodEnd: false,
          },
          usage: [],
          budgetPolicy: {
            monthlyBudgetUsd: 0,
            callMinuteLimit: 0,
            premiumRuntimeMinuteLimit: 0,
            overBudgetBehavior: "block" as const,
            warningThresholdPercent: 80,
            updatedBy: "system",
            updatedAt: "2026-08-11T08:00:00.000Z",
          },
          budgetWarnings: [],
          usageAggregates: [],
          telephonyMinuteAggregates: [],
          runtimeCostEvents: [],
          entitlements: [],
          invoices: [],
          updatedAt: "2026-08-11T08:00:00.000Z",
        };
      },
    },
    tenantStatusRepository: {
      async getStatus(tenantId: string) {
        return tenantId === organizationId
          ? { outcome: "found" as const, status: "active" as const }
          : { outcome: "missing" as const };
      },
    },
    commercialModeResolver,
  });
  const route = await configureByoPaygRoute(app, input.runtimeProfile ?? "cost-optimized");

  return {
    app,
    ledger,
    reservations,
    commercialPosture,
    activationStatus: route.activationStatus,
    activationBody: route.activationBody,
    phoneNumberId: route.phoneNumberId,
    answer: (callSid: string, eventSid: string) =>
      answerWebhook(app, route.phoneNumber, callSid, eventSid),
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

async function configureByoPaygRoute(app: INestApplication, runtimeProfile: "cost-optimized" | "premium-realtime") {
  await request(app.getHttpServer())
    .post(`/organizations/${organizationId}/telephony/connections`)
    .send({
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid,
      authToken,
    });
  const state = (await request(app.getHttpServer())
    .get(`/organizations/${organizationId}/telephony/state`)).body;
  const connectionId = state.connections[0].id as string;
  const imported = await request(app.getHttpServer())
    .post(`/organizations/${organizationId}/telephony/connections/${connectionId}/import-twilio-numbers`)
    .send({ actorUserId: "user-ops-lead" });
  const phoneNumberId = imported.body.state.phoneNumbers[0].id as string;
  const phoneNumber = imported.body.state.phoneNumbers[0].phoneNumber as string;
  await request(app.getHttpServer())
    .patch(`/organizations/${organizationId}/telephony/numbers/${phoneNumberId}/routing`)
    .send({
      actorUserId: "user-ops-lead",
      publishedVersionId: "workflow-payg-v1",
      workflowLabel: "PAYG agent",
      workspaceId: "workspace-default",
      runtimeProfile,
    });
  const activation = await request(app.getHttpServer())
    .post(`/organizations/${organizationId}/telephony/numbers/${phoneNumberId}/live-route/activate`)
    .send({
      actorUserId: "user-ops-lead",
      now: "2026-08-11T09:00:00.000Z",
      override: {
        actorUserId: "user-ops-lead",
        approvedByUserId: "platform-admin-1",
        reason: "Test fixture override for PAYG activation coverage.",
      },
    });

  const billingRepository = app.get<BillingStateRepository>(BILLING_STATE_REPOSITORY);
  const billing = await billingRepository.load(organizationId);
  if (billing !== null) {
    await billingRepository.save({
      ...billing,
      plan: null,
      subscription: { ...billing.subscription, status: "none" },
    });
  }
  return { phoneNumber, phoneNumberId, activationStatus: activation.status,
    activationBody: activation.body as unknown };
}

async function answerWebhook(
  app: INestApplication,
  phoneNumber: string,
  callSid: string,
  eventSid: string,
) {
  const { payload, signature } = createSignedAnswer(phoneNumber, callSid, eventSid);
  return request(app.getHttpServer())
    .post("/telephony/webhooks/twilio")
    .set("x-twilio-signature", signature)
    .send(payload);
}

function createSignedAnswer(phoneNumber: string, callSid: string, eventSid: string) {
  const payload = {
    AccountSid: accountSid,
    CallSid: callSid,
    EventSid: eventSid,
    EventType: "incoming.call",
    To: phoneNumber,
    From: "+233201110001",
  };
  const signature = computeTwilioWebhookSignature({
    url: "http://127.0.0.1/telephony/webhooks/twilio",
    parameters: payload,
    authToken,
  });
  return { payload, signature };
}
