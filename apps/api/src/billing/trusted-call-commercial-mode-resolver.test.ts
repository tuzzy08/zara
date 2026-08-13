import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import { TrustedCallCommercialModeResolver } from "./trusted-call-commercial-mode-resolver";

describe("TrustedCallCommercialModeResolver", () => {
  it("resolves durable commercial mode with current available allowance", async () => {
    const database = newDb();
    database.public.none(`
      create table billing_subscriptions (
        tenant_id text not null, id text not null, catalog_id text not null,
        plan_slug text, status text not null, current_period_end timestamptz,
        primary key (tenant_id, id)
      );
      create table billing_cycles (
        tenant_id text not null, id text not null, catalog_id text not null,
        status text not null, starts_at timestamptz not null, ends_at timestamptz not null
      );
      create table billing_price_catalogs (id text primary key, catalog_document jsonb not null);
      create table billing_entitlements (tenant_id text not null, key text not null, status text not null);
      create table billing_payg_credit_entries (
        tenant_id text not null, id text not null, entry_type text not null,
        amount_minor bigint not null, expires_at timestamptz
      );
      create table billing_reservation_accounts (
        tenant_id text primary key, reserved_amount_minor bigint not null, updated_at timestamptz not null
      );
      create table billing_subscription_reservation_accounts (
        tenant_id text not null, cycle_id text not null, meter_class text not null,
        reserved_included_seconds bigint not null, reserved_overage_minor bigint not null
      );
      create table billing_subscription_overage_accounts (
        tenant_id text not null, cycle_id text not null, reserved_overage_minor bigint not null
      );
      create table billing_budget_policies (
        tenant_id text primary key, currency text not null, overage_limit_minor bigint not null
      );
      create table billing_platform_risk_limits (
        tenant_id text primary key, currency text not null, overage_limit_minor bigint not null
      );
      create table billing_ledger_entries (
        tenant_id text not null, catalog_id text not null, entry_type text not null, customer_amount_minor bigint,
        quantity bigint not null, unit text not null, occurred_at timestamptz not null, metadata jsonb not null
      );

      insert into billing_subscriptions values
        ('tenant-sub','sub-1','catalog-1','growth','active','2026-09-01T00:00:00Z'),
        ('tenant-sub-exhausted','sub-x','catalog-1','growth','active','2026-09-01T00:00:00Z'),
        ('tenant-standard-spent','sub-std','catalog-1','growth','active','2026-09-01T00:00:00Z'),
        ('tenant-premium-spent','sub-prem','catalog-1','growth','active','2026-09-01T00:00:00Z'),
        ('tenant-conflict','sub-2','catalog-1','growth','active','2026-09-01T00:00:00Z'),
        ('tenant-conflict','sub-3','catalog-1','growth','trialing','2026-09-01T00:00:00Z');
      insert into billing_cycles values
        ('tenant-sub','cycle-1','catalog-1','active','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z'),
        ('tenant-sub-exhausted','cycle-x','catalog-1','active','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z'),
        ('tenant-standard-spent','cycle-std','catalog-1','active','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z'),
        ('tenant-premium-spent','cycle-prem','catalog-1','active','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z'),
        ('tenant-conflict','cycle-c','catalog-1','active','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z');
      insert into billing_price_catalogs values
        ('catalog-1','{"plans":{"growth":{"includedStandardRuntimeSeconds":120,"standardRuntimePerMinuteMinor":12,"includedPremiumRuntimeSeconds":120,"premiumRuntimePerMinuteMinor":30}}}'::jsonb);
      insert into billing_entitlements values
        ('tenant-sub','runtime_access','active'),
        ('tenant-sub-exhausted','runtime_access','active'),
        ('tenant-standard-spent','runtime_access','active'),
        ('tenant-premium-spent','runtime_access','active'),
        ('tenant-conflict','runtime_access','active');
      insert into billing_budget_policies values
        ('tenant-sub','usd',100), ('tenant-sub-exhausted','usd',0),
        ('tenant-standard-spent','usd',100), ('tenant-premium-spent','usd',100),
        ('tenant-conflict','usd',100);
      insert into billing_platform_risk_limits values
        ('tenant-sub','usd',100), ('tenant-sub-exhausted','usd',0),
        ('tenant-standard-spent','usd',100), ('tenant-premium-spent','usd',100),
        ('tenant-conflict','usd',100);
      insert into billing_subscription_reservation_accounts values
        ('tenant-sub','cycle-1','standard',0,0), ('tenant-sub-exhausted','cycle-x','standard',0,0),
        ('tenant-standard-spent','cycle-std','premium',0,0),
        ('tenant-premium-spent','cycle-prem','standard',0,0);
      insert into billing_subscription_overage_accounts values
        ('tenant-sub','cycle-1',0), ('tenant-sub-exhausted','cycle-x',0),
        ('tenant-standard-spent','cycle-std',0), ('tenant-premium-spent','cycle-prem',0);
      insert into billing_ledger_entries values
        ('tenant-sub-exhausted','catalog-1','runtime_charge',24,120,'second','2026-08-10T00:00:00Z',
          '{"billingClass":"standard_runtime_seconds"}'::jsonb),
        ('tenant-standard-spent','catalog-1','runtime_charge',0,620,'second','2026-08-10T00:00:00Z',
          '{"billingClass":"standard_runtime_seconds"}'::jsonb),
        ('tenant-standard-spent','catalog-1','runtime_charge',0,120,'second','2026-08-10T00:00:00Z',
          '{"billingClass":"premium_runtime_seconds"}'::jsonb),
        ('tenant-premium-spent','catalog-1','runtime_charge',0,320,'second','2026-08-10T00:00:00Z',
          '{"billingClass":"premium_runtime_seconds"}'::jsonb),
        ('tenant-premium-spent','catalog-1','runtime_charge',0,120,'second','2026-08-10T00:00:00Z',
          '{"billingClass":"standard_runtime_seconds"}'::jsonb);
      insert into billing_payg_credit_entries values
        ('tenant-payg','grant-1','grant',500,null),
        ('tenant-payg-exhausted','grant-x','grant',500,null),
        ('tenant-expired','grant-2','grant',500,'2026-08-10T00:00:00Z'),
        ('tenant-other','grant-3','grant',500,null);
      insert into billing_reservation_accounts values
        ('tenant-payg',100,'2026-08-11T09:00:00Z'),
        ('tenant-payg-exhausted',500,'2026-08-11T09:00:00Z'),
        ('tenant-sub',0,'2026-08-11T09:00:00Z'),
        ('tenant-sub-exhausted',0,'2026-08-11T09:00:00Z'),
        ('tenant-standard-spent',0,'2026-08-11T09:00:00Z'),
        ('tenant-premium-spent',0,'2026-08-11T09:00:00Z');
    `);
    const adapter = database.adapters.createPg();
    const pool = new adapter.Pool();
    const resolver = new TrustedCallCommercialModeResolver(pool);
    const now = "2026-08-11T10:00:00.000Z";

    await expect(resolver.resolve("tenant-sub", now, "standard")).resolves.toEqual({
      mode: "subscription", subscriptionId: "sub-1", catalogId: "catalog-1", planSlug: "growth",
      premiumAllowed: true, available: true, availableIncludedSeconds: 120,
      availablePaygMinor: 0, availableOverageMinor: 100,
    });
    await pool.query(`update billing_cycles set starts_at = '2026-08-01T10:30:00Z'
      where tenant_id = 'tenant-sub'`);
    await expect(resolver.resolve("tenant-sub", now)).resolves.toEqual({ mode: "unavailable" });
    await pool.query(`update billing_cycles set starts_at = '2026-08-01T00:00:00Z',
      ends_at = '2026-09-01T10:30:00Z' where tenant_id = 'tenant-sub'`);
    await expect(resolver.resolve("tenant-sub", now)).resolves.toEqual({ mode: "unavailable" });
    await pool.query(`update billing_cycles set ends_at = '2026-09-01T00:00:00Z'
      where tenant_id = 'tenant-sub'`);
    await expect(resolver.resolve("tenant-sub-exhausted", now, "standard")).resolves.toEqual(
      expect.objectContaining({ mode: "subscription", available: false }),
    );
    await expect(resolver.resolve("tenant-standard-spent", now, "premium")).resolves.toEqual(
      expect.objectContaining({ mode: "subscription", available: false, availableOverageMinor: 0 }),
    );
    await expect(resolver.resolve("tenant-premium-spent", now, "standard")).resolves.toEqual(
      expect.objectContaining({ mode: "subscription", available: false, availableOverageMinor: 0 }),
    );
    await expect(resolver.resolve("tenant-payg", now)).resolves.toEqual({
      mode: "payg", available: true, availablePaygMinor: 400,
    });
    await expect(resolver.resolve("tenant-payg-exhausted", now)).resolves.toEqual({
      mode: "payg", available: false, availablePaygMinor: 0,
    });
    await expect(resolver.resolve("tenant-conflict", now)).resolves.toEqual({ mode: "unavailable" });
    await expect(resolver.resolve("tenant-expired", now)).resolves.toEqual({ mode: "unavailable" });
    await expect(resolver.resolve("tenant-missing", now)).resolves.toEqual({ mode: "unavailable" });
    await pool.end();
  });
});
