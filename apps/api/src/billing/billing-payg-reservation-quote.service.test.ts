import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BillingPaygReservationQuoteService } from "./billing-payg-reservation-quote.service";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";

describe("BillingPaygReservationQuoteService", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;
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
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
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
  });

  afterEach(async () => {
    await pool.end();
  });

  it("calculates the maximum PAYG call charge from the active catalog", async () => {
    const service = new BillingPaygReservationQuoteService(ledger);

    await expect(service.quoteCall({
      effectiveAt: "2026-08-11T09:00:00.000Z",
      maximumCallSeconds: 300,
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
    })).resolves.toEqual({
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
      currency: "usd",
      maximumCallSeconds: 300,
      components: {
        runtimeMinor: 90,
        telephonyMinor: 175,
      },
      maximumExpectedChargeMinor: 265,
    });
  });
});
