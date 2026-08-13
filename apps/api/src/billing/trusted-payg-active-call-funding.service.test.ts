import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";
import { TrustedPaygActiveCallFundingService } from "./trusted-payg-active-call-funding.service";
import type { TrustedSubscriptionCallLifecycleService } from "./trusted-subscription-call-lifecycle.service";

describe("TrustedPaygActiveCallFundingService", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;
  let service: TrustedPaygActiveCallFundingService;
  const subscriptionReservations = new Map<string, Record<string, unknown>>();

  beforeEach(async () => {
    subscriptionReservations.clear();
    const database = newDb();
    database.public.none(`
      create table billing_price_catalogs (
        id text primary key, version integer not null unique, status text not null,
        currency text not null, effective_from timestamptz not null, checksum text not null,
        catalog_document jsonb not null, approved_by text not null,
        approved_at timestamptz not null, created_at timestamptz not null
      );
      create table billing_payg_orders (
        tenant_id text not null, id text not null, provider_order_id text not null unique,
        currency text not null, paid_amount_minor bigint not null,
        granted_credit_minor bigint not null, status text not null,
        created_at timestamptz not null, primary key (tenant_id, id)
      );
      create table billing_payg_credit_entries (
        tenant_id text not null, id text not null, order_id text, session_id text,
        entry_type text not null, amount_minor bigint not null,
        idempotency_key text not null, expires_at timestamptz, created_at timestamptz not null,
        primary key (tenant_id, id), unique (tenant_id, idempotency_key)
      );
      create table billing_reservation_accounts (
        tenant_id text primary key, reserved_amount_minor bigint not null default 0,
        updated_at timestamptz not null
      );
      create table billing_charge_reservations (
        tenant_id text not null, id text not null, reservation_key text not null,
        catalog_id text not null, charge_context jsonb, funding_source text not null, status text not null,
        reserved_amount_minor bigint not null, actual_amount_minor bigint, session_id text,
        terminal_outcome text,
        currency text not null, expires_at timestamptz not null, finalized_at timestamptz,
        released_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null,
        primary key (tenant_id, id), unique (tenant_id, reservation_key)
      );
      create table billing_terminal_recovery_jobs (
        tenant_id text not null, reservation_id text not null,
        commercial_mode text not null, status text not null
      );
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
    const ledger = new PostgresBillingLedgerRepository(pool);
    const reservations = new BillingChargeReservationRepository(pool);
    await ledger.publishPriceCatalog({
      id: "catalog-payg-active-v1",
      version: 1,
      status: "active",
      currency: "usd",
      effectiveFrom: "2026-08-11T00:00:00.000Z",
      checksum: "a".repeat(64),
      document: {
        payg: {
          standardRuntimePerMinuteMinor: 18,
          premiumRuntimePerMinuteMinor: 45,
        },
        telephonyRoutes: {
          "twilio-ng-outbound": {
            provider: "twilio",
            direction: "outbound",
            sourceCountry: "NG",
            destinationZone: "nigeria-local-mobile",
            providerSku: "twilio-voice-ng-local-mobile-media-streams",
            currency: "usd",
            effectiveFrom: "2026-08-01T00:00:00.000Z",
            customerRateMinorPerMinute: 35,
            rounding: "next_full_minute",
          },
        },
      },
      approvedBy: "billing-approver",
      approvedAt: "2026-08-11T00:00:00.000Z",
      createdAt: "2026-08-11T00:00:00.000Z",
    });
    await ledger.applyPaidPaygOrder({
      order: {
        id: "payg-order-active",
        organizationId: "tenant-payg",
        providerOrderId: "polar-order-active",
        currency: "usd",
        paidAmountMinor: 500,
        grantedCreditMinor: 500,
        status: "paid",
        createdAt: "2026-08-11T08:00:00.000Z",
      },
      grant: {
        id: "payg-grant-active",
        organizationId: "tenant-payg",
        orderId: "payg-order-active",
        entryType: "grant",
        amountMinor: 500,
        idempotencyKey: "payg-grant:polar-order-active",
        createdAt: "2026-08-11T08:00:00.000Z",
      },
    });
    await reservations.reservePaygCredit({
      id: "payg-call-reservation:call-active",
      organizationId: "tenant-payg",
      reservationKey: "payg-call:call-active",
      catalogId: "catalog-payg-active-v1",
      chargeContext: {
        runtimePath: "pstn-sandwich",
        ownershipMode: "byo",
        provider: "twilio",
        direction: "inbound",
      },
      amountMinor: 28,
      currency: "usd",
      expiresAt: "2026-08-11T09:10:00.000Z",
      now: "2026-08-11T09:00:00.000Z",
    });
    await reservations.reservePaygCredit({
      id: "payg-call-reservation:call-platform",
      organizationId: "tenant-payg",
      reservationKey: "payg-call:call-platform",
      catalogId: "catalog-payg-active-v1",
      chargeContext: {
        runtimePath: "pstn-sandwich",
        ownershipMode: "platform-managed",
        provider: "twilio",
        direction: "outbound",
        routeIdentity: {
          rateId: "twilio-ng-outbound",
          provider: "twilio",
          direction: "outbound",
          sourceCountry: "NG",
          destinationZone: "nigeria-local-mobile",
          providerSku: "twilio-voice-ng-local-mobile-media-streams",
          currency: "usd",
          effectiveAt: "2026-08-11T09:00:00.000Z",
        },
      },
      amountMinor: 100,
      currency: "usd",
      expiresAt: "2026-08-11T09:10:00.000Z",
      now: "2026-08-11T09:00:00.000Z",
    });
    service = new TrustedPaygActiveCallFundingService(
      ledger,
      reservations,
      {
        async getReservationByKey(organizationId: string, reservationKey: string) {
          return subscriptionReservations.get(`${organizationId}:${reservationKey}`) ?? null;
        },
      } as unknown as TrustedSubscriptionCallLifecycleService,
    );
  });

  afterEach(async () => {
    await pool.end();
  });

  it("funds only a next safe segment covered by the active pinned reservation", async () => {
    const input = {
      organizationId: "tenant-payg",
      callSessionId: "call-active",
      now: "2026-08-11T09:02:00.000Z",
    };

    await expect(service.evaluateNextSafeSegment({
      ...input,
      runtimeSeconds: 61,
      nextSafeSegmentSeconds: 30,
    })).resolves.toEqual({
      billingAccessMode: "payg",
      outcome: "funded",
      catalogId: "catalog-payg-active-v1",
      projectedChargeMinor: 28,
      reservedAmountMinor: 28,
    });
  });

  it("fails closed when trusted platform duration is missing", async () => {
    await expect(service.evaluateNextSafeSegment({
      organizationId: "tenant-payg",
      callSessionId: "call-platform",
      runtimeSeconds: 61,
      nextSafeSegmentSeconds: 30,
      now: "2026-08-11T09:02:00.000Z",
    })).resolves.toEqual({ billingAccessMode: "payg", outcome: "unfunded" });
  });

  it("fails closed when the call has no tenant-qualified commercial reservation", async () => {
    await expect(service.evaluateNextSafeSegment({
      organizationId: "tenant-payg",
      callSessionId: "call-other",
      runtimeSeconds: 61,
      nextSafeSegmentSeconds: 30,
      now: "2026-08-11T09:02:00.000Z",
    })).resolves.toEqual({ billingAccessMode: "payg", outcome: "unfunded" });
  });

  it("uses an active tenant-qualified subscription reservation as explicit commercial state", async () => {
    subscriptionReservations.set("tenant-subscription:call-subscription", {
      organizationId: "tenant-subscription",
      reservationKey: "call-subscription",
      status: "active",
      expiresAt: "2026-08-11T09:10:00.000Z",
    });

    await expect(service.evaluateNextSafeSegment({
      organizationId: "tenant-subscription",
      callSessionId: "call-subscription",
      runtimeSeconds: 61,
      nextSafeSegmentSeconds: 30,
      now: "2026-08-11T09:02:00.000Z",
    })).resolves.toEqual({ billingAccessMode: "subscription" });
  });

  it("fails closed for an expired subscription reservation", async () => {
    subscriptionReservations.set("tenant-subscription:call-expired", {
      organizationId: "tenant-subscription",
      reservationKey: "call-expired",
      status: "active",
      expiresAt: "2026-08-11T09:01:00.000Z",
    });

    await expect(service.evaluateNextSafeSegment({
      organizationId: "tenant-subscription",
      callSessionId: "call-expired",
      runtimeSeconds: 61,
      nextSafeSegmentSeconds: 30,
      now: "2026-08-11T09:02:00.000Z",
    })).resolves.toEqual({ billingAccessMode: "payg", outcome: "unfunded" });
  });

  it("does not accept another tenant's subscription reservation", async () => {
    subscriptionReservations.set("tenant-other:call-subscription", {
      organizationId: "tenant-other",
      reservationKey: "call-subscription",
      status: "active",
      expiresAt: "2026-08-11T09:10:00.000Z",
    });

    await expect(service.evaluateNextSafeSegment({
      organizationId: "tenant-subscription",
      callSessionId: "call-subscription",
      runtimeSeconds: 61,
      nextSafeSegmentSeconds: 30,
      now: "2026-08-11T09:02:00.000Z",
    })).resolves.toEqual({ billingAccessMode: "payg", outcome: "unfunded" });
  });
});
