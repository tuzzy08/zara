import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";
import { TrustedPaygTerminalFinalizationService } from "./trusted-payg-terminal-finalization.service";

describe("TrustedPaygTerminalFinalizationService", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;
  let reservations: BillingChargeReservationRepository;
  let ledger: PostgresBillingLedgerRepository;

  beforeEach(async () => {
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
      create table billing_charge_reservations (
        tenant_id text not null,
        id text not null,
        reservation_key text not null,
        catalog_id text not null,
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
    await ledger.publishPriceCatalog({
      id: "catalog-2026-08-v1",
      version: 1,
      status: "active",
      currency: "usd",
      effectiveFrom: "2026-08-09T00:00:00.000Z",
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
      approvedAt: "2026-08-09T00:00:00.000Z",
      createdAt: "2026-08-09T00:00:00.000Z",
    });
    await ledger.applyPaidPaygOrder({
      order: {
        id: "payg-order-terminal",
        organizationId: "tenant-payg",
        providerOrderId: "polar-order-terminal",
        currency: "usd",
        paidAmountMinor: 500,
        grantedCreditMinor: 500,
        status: "paid",
        createdAt: "2026-08-10T09:00:00.000Z",
      },
      grant: {
        id: "payg-grant-terminal",
        organizationId: "tenant-payg",
        orderId: "payg-order-terminal",
        entryType: "grant",
        amountMinor: 500,
        idempotencyKey: "payg-grant:polar-order-terminal",
        createdAt: "2026-08-10T09:00:00.000Z",
      },
    });
    await reservations.reservePaygCredit({
      id: "payg-call-reservation:call-terminal",
      organizationId: "tenant-payg",
      reservationKey: "payg-call:call-terminal",
      amountMinor: 265,
      currency: "usd",
      expiresAt: "2026-08-11T09:10:00.000Z",
      now: "2026-08-11T09:00:00.000Z",
      catalogId: "catalog-2026-08-v1",
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
    });
    await ledger.publishPriceCatalog({
      id: "catalog-2026-08-v2",
      version: 2,
      status: "active",
      currency: "usd",
      effectiveFrom: "2026-08-11T09:01:00.000Z",
      checksum: "b".repeat(64),
      document: {
        payg: {
          standardRuntimePerMinuteMinor: 36,
          premiumRuntimePerMinuteMinor: 90,
        },
        telephonyRoutes: {
          "twilio-ng-outbound": {
            provider: "twilio",
            direction: "outbound",
            sourceCountry: "NG",
            destinationZone: "nigeria-local-mobile",
            providerSku: "twilio-voice-ng-local-mobile-media-streams",
            currency: "usd",
            effectiveFrom: "2026-08-11T09:01:00.000Z",
            customerRateMinorPerMinute: 70,
            rounding: "next_full_minute",
          },
        },
      },
      approvedBy: "billing-approver",
      approvedAt: "2026-08-11T09:01:00.000Z",
      createdAt: "2026-08-11T09:01:00.000Z",
    });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("finalizes one catalog-backed actual PAYG charge and releases unused credit", async () => {
    const service = new TrustedPaygTerminalFinalizationService(ledger, reservations);
    const fact = {
      organizationId: "tenant-payg",
      reservationId: "payg-call-reservation:call-terminal",
      callSessionId: "call-terminal",
      runtimePath: "pstn-sandwich" as const,
      outcome: "completed" as const,
      runtimeSeconds: 125,
      ownershipMode: "platform-managed" as const,
      provider: "twilio",
      direction: "outbound" as const,
      routeIdentity: platformRouteIdentity("2026-08-11T09:00:00.000Z"),
      providerConnectedSeconds: 121,
      occurredAt: "2026-08-11T09:03:00.000Z",
    };

    const first = await service.finalizeTerminalCall(fact);
    const replay = await service.finalizeTerminalCall(fact);

    expect({ first, replay }).toEqual({
      first: {
        catalogId: "catalog-2026-08-v1",
        currency: "usd",
        components: { runtimeMinor: 38, telephonyMinor: 105 },
        actualChargeMinor: 143,
        duplicate: false,
        releasedMinor: 122,
        availableMinor: 357,
      },
      replay: {
        catalogId: "catalog-2026-08-v1",
        currency: "usd",
        components: { runtimeMinor: 38, telephonyMinor: 105 },
        actualChargeMinor: 143,
        duplicate: true,
        releasedMinor: 122,
        availableMinor: 357,
      },
    });
    await expect(ledger.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
      expect.objectContaining({
        entryType: "debit",
        sessionId: "call-terminal",
        amountMinor: 143,
      }),
    ]);
  });

  it("uses the immutable reservation charge context instead of terminal route input", async () => {
    const service = new TrustedPaygTerminalFinalizationService(ledger, reservations);

    await expect(service.finalizeTerminalCall({
      organizationId: "tenant-payg",
      reservationId: "payg-call-reservation:call-terminal",
      callSessionId: "call-terminal",
      runtimePath: "pstn-premium-realtime",
      outcome: "completed",
      runtimeSeconds: 125,
      ownershipMode: "byo",
      provider: "other-provider",
      direction: "inbound",
      providerConnectedSeconds: 121,
      occurredAt: "2026-08-11T09:03:00.000Z",
    })).resolves.toMatchObject({
      catalogId: "catalog-2026-08-v1",
      components: { runtimeMinor: 38, telephonyMinor: 105 },
      actualChargeMinor: 143,
    });
  });

  it("resolves terminal PAYG mode from the tenant-qualified durable reservation", async () => {
    const service = new TrustedPaygTerminalFinalizationService(ledger, reservations);

    await expect(service.resolveCallBillingMode({
      organizationId: "tenant-payg",
      callSessionId: "call-terminal",
    })).resolves.toBe("payg");
    await expect(service.resolveCallBillingMode({
      organizationId: "tenant-payg",
      callSessionId: "call-without-payg-reservation",
    })).resolves.toBe("subscription");
    await expect(service.resolveCallBillingMode({
      organizationId: "tenant-other",
      callSessionId: "call-terminal",
    })).resolves.toBe("subscription");
  });

  it("does not finalize when the trusted ownership fact is missing", async () => {
    const service = new TrustedPaygTerminalFinalizationService(ledger, reservations);

    await expect(service.finalizeTerminalCall({
      organizationId: "tenant-payg",
      reservationId: "payg-call-reservation:call-terminal",
      callSessionId: "call-terminal",
      runtimePath: "pstn-sandwich",
      outcome: "failed",
      runtimeSeconds: 125,
      ownershipMode: undefined as never,
      provider: "twilio",
      direction: "outbound",
      routeIdentity: platformRouteIdentity("2026-08-11T09:00:00.000Z"),
      providerConnectedSeconds: 121,
      occurredAt: "2026-08-11T09:03:00.000Z",
    })).rejects.toThrow("ownershipMode must be platform-managed or byo.");

    await expect(reservations.listReservations("tenant-payg")).resolves.toEqual([
      expect.objectContaining({
        id: "payg-call-reservation:call-terminal",
        status: "active",
      }),
    ]);
    await expect(ledger.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
    ]);
  });

  it("releases the reservation when a failed call has no billable usage", async () => {
    const service = new TrustedPaygTerminalFinalizationService(ledger, reservations);
    const fact = {
      organizationId: "tenant-payg",
      reservationId: "payg-call-reservation:call-terminal",
      callSessionId: "call-terminal",
      runtimePath: "pstn-sandwich" as const,
      outcome: "failed" as const,
      runtimeSeconds: 0,
      ownershipMode: "platform-managed" as const,
      provider: "twilio",
      direction: "outbound" as const,
      routeIdentity: platformRouteIdentity("2026-08-11T09:00:00.000Z"),
      providerConnectedSeconds: 0,
      occurredAt: "2026-08-11T09:00:10.000Z",
    };

    const first = await service.finalizeTerminalCall(fact);
    const replay = await service.finalizeTerminalCall(fact);

    expect({ first, replay }).toEqual({
      first: {
        catalogId: "catalog-2026-08-v1",
        currency: "usd",
        components: { runtimeMinor: 0, telephonyMinor: 0 },
        actualChargeMinor: 0,
        outcome: "released",
        duplicate: false,
        releasedMinor: 265,
        availableMinor: 500,
      },
      replay: {
        catalogId: "catalog-2026-08-v1",
        currency: "usd",
        components: { runtimeMinor: 0, telephonyMinor: 0 },
        actualChargeMinor: 0,
        outcome: "released",
        duplicate: true,
        releasedMinor: 265,
        availableMinor: 500,
      },
    });
    await expect(ledger.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
    ]);
  });
});

function platformRouteIdentity(effectiveAt: string) {
  return {
    rateId: "twilio-ng-outbound",
    provider: "twilio",
    direction: "outbound" as const,
    sourceCountry: "NG",
    destinationZone: "nigeria-local-mobile",
    providerSku: "twilio-voice-ng-local-mobile-media-streams",
    currency: "usd" as const,
    effectiveAt,
  };
}
