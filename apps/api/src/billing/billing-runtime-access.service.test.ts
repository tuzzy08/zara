import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryBillingStateRepository } from "./billing-state.repository";
import { BillingService } from "./billing.service";
import type { BillingPolarClient } from "./polar-billing.client";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";

describe("BillingService runtime access", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;
  let repository: PostgresBillingLedgerRepository;
  let service: BillingService;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table billing_subscriptions (
        tenant_id text not null,
        id text not null,
        provider_subscription_id text not null unique,
        catalog_id text not null,
        plan_slug text,
        status text not null,
        current_period_end timestamptz,
        cancel_at_period_end boolean not null,
        version integer not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant_id, id)
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
    repository = new PostgresBillingLedgerRepository(pool);
    service = new BillingService(
      new InMemoryBillingStateRepository(),
      {} as BillingPolarClient,
      repository,
    );
  });

  afterEach(async () => {
    await pool.end();
  });

  it("blocks platform-managed PSTN as soon as durable payment state is past due", async () => {
    await seedPastDueSubscription(repository);

    await expect(service.getRuntimeAccessPosture({
      organizationId: "tenant-a",
      accessContext: "platform_managed_pstn",
      now: "2026-08-10T10:00:00.000Z",
    })).resolves.toEqual({
      subscriptionStatus: "past_due",
      accessAllowed: false,
      reason: "platform_pstn_payment_past_due",
    });
  });

  it("allows BYO live runtime only inside the 72-hour payment grace period", async () => {
    await seedPastDueSubscription(repository);

    await expect(service.getRuntimeAccessPosture({
      organizationId: "tenant-a",
      accessContext: "byo_live_runtime",
      now: "2026-08-13T08:59:59.999Z",
    })).resolves.toEqual({
      subscriptionStatus: "past_due",
      accessAllowed: true,
      reason: "byo_payment_grace",
      graceEndsAt: "2026-08-13T09:00:00.000Z",
    });
    await expect(service.getRuntimeAccessPosture({
      organizationId: "tenant-a",
      accessContext: "byo_live_runtime",
      now: "2026-08-13T09:00:00.000Z",
    })).resolves.toEqual({
      subscriptionStatus: "past_due",
      accessAllowed: false,
      reason: "payment_grace_expired",
      graceEndsAt: "2026-08-13T09:00:00.000Z",
    });
  });
});

async function seedPastDueSubscription(repository: PostgresBillingLedgerRepository) {
  await repository.upsertSubscriptionProjection({
    id: "polar-subscription-1",
    organizationId: "tenant-a",
    providerSubscriptionId: "polar-subscription-1",
    catalogId: "catalog-2026-08-v1",
    status: "past_due",
    currentPeriodEnd: "2026-09-10T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    version: 1,
    createdAt: "2026-07-10T09:00:00.000Z",
    updatedAt: "2026-08-10T09:00:00.000Z",
  });
}
