import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import { BillingPaygEligibilityService } from "./billing-payg-eligibility.service";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";

describe("BillingPaygEligibilityService", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;
  let ledger: PostgresBillingLedgerRepository;
  let reservations: BillingChargeReservationRepository;

  beforeEach(async () => {
    const database = newDb();
    database.public.none(`
      create table billing_payg_orders (
        tenant_id text not null, id text not null, provider_order_id text not null unique,
        currency text not null, paid_amount_minor bigint not null,
        granted_credit_minor bigint not null, status text not null,
        created_at timestamptz not null, primary key (tenant_id, id)
      );
      create table billing_payg_credit_entries (
        tenant_id text not null, id text not null, order_id text, session_id text,
        entry_type text not null, amount_minor bigint not null,
        idempotency_key text not null, expires_at timestamptz,
        created_at timestamptz not null, primary key (tenant_id, id),
        unique (tenant_id, idempotency_key)
      );
      create table billing_reservation_accounts (
        tenant_id text primary key, reserved_amount_minor bigint not null default 0,
        updated_at timestamptz not null
      );
      create table billing_charge_reservations (
        tenant_id text not null, id text not null, reservation_key text not null,
        catalog_id text, charge_context jsonb, funding_source text not null, status text not null,
        reserved_amount_minor bigint not null, actual_amount_minor bigint,
        session_id text, terminal_outcome text, currency text not null, expires_at timestamptz not null,
        finalized_at timestamptz, released_at timestamptz,
        created_at timestamptz not null, updated_at timestamptz not null,
        primary key (tenant_id, id), unique (tenant_id, reservation_key)
      );
      create table billing_terminal_recovery_jobs (
        tenant_id text not null, reservation_id text not null,
        commercial_mode text not null, status text not null
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
    ledger = new PostgresBillingLedgerRepository(pool);
    reservations = new BillingChargeReservationRepository(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("allows only the tenant with current paid available credit", async () => {
    await ledger.applyPaidPaygOrder({
      order: {
        id: "order-paid",
        organizationId: "tenant-paid",
        providerOrderId: "polar-paid",
        currency: "usd",
        paidAmountMinor: 500,
        grantedCreditMinor: 500,
        status: "paid",
        createdAt: "2026-08-11T08:00:00.000Z",
      },
      grant: {
        id: "grant-paid",
        organizationId: "tenant-paid",
        orderId: "order-paid",
        entryType: "grant",
        amountMinor: 500,
        idempotencyKey: "grant:paid",
        expiresAt: "2026-08-11T10:00:00.000Z",
        createdAt: "2026-08-11T08:00:00.000Z",
      },
    });
    await reservations.reservePaygCredit({
      id: "reservation-paid",
      organizationId: "tenant-paid",
      reservationKey: "pstn:paid",
      catalogId: "catalog-v1",
      chargeContext: {
        runtimePath: "pstn-sandwich",
        ownershipMode: "byo",
        provider: "twilio",
        direction: "inbound",
      },
      amountMinor: 265,
      currency: "usd",
      expiresAt: "2026-08-11T09:10:00.000Z",
      now: "2026-08-11T09:00:00.000Z",
    });
    const service = new BillingPaygEligibilityService(ledger, reservations);

    await expect(service.getEligibility({
      organizationId: "tenant-paid",
      now: "2026-08-11T09:01:00.000Z",
    })).resolves.toEqual({
      eligible: true,
      balanceMinor: 500,
      reservedMinor: 265,
      availableMinor: 235,
    });
    await expect(service.getEligibility({
      organizationId: "tenant-other",
      now: "2026-08-11T09:01:00.000Z",
    })).resolves.toEqual({
      eligible: false,
      balanceMinor: 0,
      reservedMinor: 0,
      availableMinor: 0,
    });
    await expect(service.getEligibility({
      organizationId: "tenant-paid",
      now: "2026-08-11T10:00:00.000Z",
    })).resolves.toEqual({
      eligible: false,
      balanceMinor: 0,
      reservedMinor: 0,
      availableMinor: 0,
    });
  });
});
