import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";
import { TrustedPaygCallLifecycleService } from "./trusted-payg-call-lifecycle.service";

describe("TrustedPaygCallLifecycleService", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;
  let reservations: BillingChargeReservationRepository;
  let ledger: PostgresBillingLedgerRepository;

  beforeEach(async () => {
    const database = newDb();
    database.public.none(`
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
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
    reservations = new BillingChargeReservationRepository(pool);
    ledger = new PostgresBillingLedgerRepository(pool);
    await ledger.applyPaidPaygOrder({
      order: {
        id: "payg-order-call-start",
        organizationId: "tenant-payg",
        providerOrderId: "polar-order-call-start",
        currency: "usd",
        paidAmountMinor: 500,
        grantedCreditMinor: 500,
        status: "paid",
        createdAt: "2026-08-10T09:00:00.000Z",
      },
      grant: {
        id: "payg-grant-call-start",
        organizationId: "tenant-payg",
        orderId: "payg-order-call-start",
        entryType: "grant",
        amountMinor: 500,
        idempotencyKey: "payg-grant:polar-order-call-start",
        createdAt: "2026-08-10T09:00:00.000Z",
      },
    });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("reserves before provider start and releases the claim when start fails", async () => {
    const service = new TrustedPaygCallLifecycleService(reservations);
    let reservationDuringProviderStart: unknown;

    await expect(service.startPaygCall({
      organizationId: "tenant-payg",
      callSessionId: "call-provider-failure",
      catalogId: "catalog-2026-08-v1",
      chargeContext: {
        runtimePath: "pstn-sandwich",
        ownershipMode: "byo",
        provider: "twilio",
        direction: "inbound",
      },
      maximumExpectedChargeMinor: 400,
      reservationExpiresAt: "2026-08-10T10:05:00.000Z",
      now: "2026-08-10T10:00:00.000Z",
      startProvider: async () => {
        reservationDuringProviderStart = await reservations.listReservations("tenant-payg");
        throw new Error("Provider start failed.");
      },
    })).rejects.toThrow("Provider start failed.");

    expect(reservationDuringProviderStart).toEqual([
      expect.objectContaining({
        id: "payg-call-reservation:call-provider-failure",
        status: "active",
        reservedAmountMinor: 400,
      }),
    ]);
    await expect(reservations.listReservations("tenant-payg")).resolves.toEqual([
      expect.objectContaining({
        id: "payg-call-reservation:call-provider-failure",
        status: "released",
      }),
    ]);
    await expect(ledger.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
    ]);
  });
});
