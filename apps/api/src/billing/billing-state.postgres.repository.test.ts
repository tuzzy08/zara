import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PostgresBillingStateRepository,
  type PersistedBillingStateRecord,
} from "./billing-state.repository";

describe("PostgresBillingStateRepository", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table tenants (
        id text primary key,
        slug text not null unique,
        name text not null
      );
      create table billing_tenant_states (
        tenant_id text primary key references tenants(id),
        state jsonb not null,
        updated_at timestamptz not null
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => {
    await pool.end();
  });

  it("round-trips an honest empty tenant state through Postgres", async () => {
    const repository = new PostgresBillingStateRepository(pool);
    const state: PersistedBillingStateRecord = {
      schemaVersion: 1,
      organizationId: "tenant-new",
      customerExternalId: "tenant-new",
      plan: null,
      subscription: {
        provider: "polar",
        status: "none",
        cancelAtPeriodEnd: false,
      },
      usage: [],
      budgetPolicy: {
        monthlyBudgetUsd: 0,
        callMinuteLimit: 0,
        premiumRuntimeMinuteLimit: 0,
        overBudgetBehavior: "block",
        warningThresholdPercent: 80,
        updatedBy: "system",
        updatedAt: "2026-08-09T15:00:00.000Z",
      },
      budgetDecisions: [],
      entitlements: [],
      invoices: [],
      checkouts: [],
      usageEvents: [],
      telephonyMinuteEvents: [],
      runtimeCostEvents: [],
      processedWebhookIds: [],
      updatedAt: "2026-08-09T15:00:00.000Z",
    };

    await repository.save(state);

    await expect(repository.load(state.organizationId)).resolves.toEqual(state);
  });
});
