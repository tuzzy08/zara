import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PostgresBillingReadModelRepository } from "./billing-read-model.repository";

describe("PostgresBillingReadModelRepository", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table billing_customers (
        tenant_id text primary key, provider text not null, provider_customer_id text,
        updated_at timestamptz not null
      );
      create table billing_price_catalogs (
        id text primary key, version integer not null, currency text not null,
        effective_from timestamptz not null, catalog_document jsonb not null
      );
      create table billing_subscriptions (
        tenant_id text not null, id text not null, provider_subscription_id text not null,
        catalog_id text not null, plan_slug text, status text not null,
        current_period_end timestamptz, cancel_at_period_end boolean not null,
        updated_at timestamptz not null, primary key (tenant_id, id)
      );
      create table billing_cycles (
        tenant_id text not null, id text not null, catalog_id text not null,
        starts_at timestamptz not null, ends_at timestamptz not null,
        status text not null, primary key (tenant_id, id)
      );
      create table billing_budget_policies (
        tenant_id text primary key, currency text not null, overage_limit_minor bigint not null,
        call_minute_limit real not null, premium_runtime_minute_limit real not null,
        over_budget_behavior text not null, warning_threshold_percent integer not null,
        updated_by text not null, updated_at timestamptz not null
      );
      create table billing_ledger_entries (
        tenant_id text not null, id text not null, entry_type text not null,
        currency text not null, customer_amount_minor bigint, quantity bigint not null,
        unit text not null, occurred_at timestamptz not null, metadata jsonb not null,
        primary key (tenant_id, id)
      );
      create table billing_outbox (
        tenant_id text not null, id text not null, aggregate_type text not null,
        aggregate_id text not null, event_type text not null, status text not null,
        primary key (tenant_id, id)
      );
      create table billing_payg_credit_entries (
        tenant_id text not null, id text not null, order_id text, session_id text,
        entry_type text not null, amount_minor bigint not null, expires_at timestamptz,
        created_at timestamptz not null, primary key (tenant_id, id)
      );
      create table billing_payg_orders (
        tenant_id text not null, id text not null, granted_credit_minor bigint not null,
        status text not null, created_at timestamptz not null, primary key (tenant_id, id)
      );
      create table billing_charge_reservations (
        tenant_id text not null, id text not null, status text not null,
        reserved_amount_minor bigint not null, expires_at timestamptz not null,
        primary key (tenant_id, id)
      );
      create table billing_entitlements (
        tenant_id text not null, id text not null, key text not null, status text not null,
        updated_at timestamptz not null, primary key (tenant_id, id)
      );
      create table billing_invoices (
        tenant_id text not null, id text not null, provider_order_id text not null,
        invoice_number text not null, currency text not null, amount_minor bigint not null,
        status text not null, issued_at timestamptz not null, primary key (tenant_id, id)
      );
      create table billing_polar_mappings (
        catalog_id text not null, mapping_type text not null, internal_key text not null,
        provider_id text not null, environment text not null
      );
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => pool.end());

  it("returns tenant-qualified subscription, usage, invoice, and PAYG facts", async () => {
    await pool.query(`
      insert into billing_customers values
        ('tenant-a', 'polar', 'customer-a', '2026-08-11T10:00:00Z'),
        ('tenant-b', 'polar', 'customer-b', '2026-08-11T10:00:00Z');
      insert into billing_price_catalogs values (
        'catalog-v1', 1, 'usd', '2026-08-01T00:00:00Z',
        '{"plans":{"growth":{"name":"Growth","baseFeeMinor":14900,"includedStandardRuntimeSeconds":60000,"includedPremiumRuntimeSeconds":3000}},"payg":{"creditPackMinor":500}}'
      );
      insert into billing_subscriptions values
        ('tenant-a', 'sub-a', 'polar-sub-a', 'catalog-v1', 'growth', 'active', '2099-09-01T00:00:00Z', false, '2026-08-11T10:00:00Z'),
        ('tenant-b', 'sub-b', 'polar-sub-b', 'catalog-v1', 'growth', 'active', '2099-09-01T00:00:00Z', false, '2026-08-11T10:00:00Z');
      insert into billing_cycles values
        ('tenant-a', 'cycle-a', 'catalog-v1', '2026-08-01T00:00:00Z', '2099-09-01T00:00:00Z', 'active');
      insert into billing_budget_policies values
        ('tenant-a', 'usd', 1000, 0, 0, 'block', 80, 'owner-a', '2026-08-11T09:00:00Z');
      insert into billing_ledger_entries values
        ('tenant-a', 'standard-a', 'runtime_charge', 'usd', 24, 120, 'second', '2026-08-11T09:00:00Z', '{"billingClass":"standard_runtime_seconds","billingDisposition":"shadow"}'),
        ('tenant-a', 'standard-shadow', 'runtime_charge', 'usd', 10, 50, 'second', '2026-08-11T09:00:30Z', '{"billingClass":"standard_runtime_seconds","billingDisposition":"shadow","chargeDelivery":"shadow"}'),
        ('tenant-a', 'premium-a', 'runtime_charge', 'usd', null, 60, 'second', '2026-08-11T09:01:00Z', '{"billingClass":"premium_runtime_seconds","billingDisposition":"shadow"}'),
        ('tenant-a', 'phone-a', 'telephony_charge', 'usd', 70, 75, 'connected_second', '2026-08-11T09:02:00Z', '{"billingClass":"platform_telephony_charge_minor","billingDisposition":"posted"}'),
        ('tenant-b', 'standard-b', 'runtime_charge', 'usd', 9999, 9999, 'second', '2026-08-11T09:00:00Z', '{"billingClass":"standard_runtime_seconds"}');
      insert into billing_outbox values
        ('tenant-a', 'outbox-standard', 'billing_ledger_entry', 'standard-a', 'polar.usage.report', 'delivered'),
        ('tenant-a', 'outbox-premium', 'billing_ledger_entry', 'premium-a', 'polar.usage.report', 'delivered'),
        ('tenant-a', 'outbox-phone', 'billing_ledger_entry', 'phone-a', 'polar.usage.report', 'delivered'),
        ('tenant-b', 'outbox-wrong-tenant', 'billing_ledger_entry', 'standard-shadow', 'polar.usage.report', 'delivered');
      insert into billing_payg_orders values
        ('tenant-a', 'order-a', 500, 'paid', '2026-08-10T08:00:00Z'),
        ('tenant-a', 'order-refunded', 500, 'refunded', '2026-08-10T08:01:00Z');
      insert into billing_payg_credit_entries values
        ('tenant-a', 'grant-a', 'order-a', null, 'grant', 500, null, '2026-08-10T08:00:00Z'),
        ('tenant-a', 'grant-promo', null, null, 'grant', 200, null, '2026-08-10T08:00:30Z'),
        ('tenant-a', 'grant-refunded', 'order-refunded', null, 'grant', 500, null, '2026-08-10T08:01:00Z'),
        ('tenant-a', 'reversal-refunded', 'order-refunded', null, 'reversal', 500, null, '2026-08-10T08:02:00Z'),
        ('tenant-a', 'reversal-paid', 'order-a', null, 'reversal', 100, null, '2026-08-10T08:03:00Z'),
        ('tenant-a', 'debit-a', null, 'session-a', 'debit', 120, null, '2026-08-11T09:03:00Z');
      insert into billing_charge_reservations values
        ('tenant-a', 'reservation-a', 'active', 80, '2099-08-11T11:00:00Z');
      insert into billing_entitlements values
        ('tenant-a', 'entitlement-a', 'runtime_access', 'active', '2026-08-11T10:00:00Z');
      insert into billing_invoices values
        ('tenant-a', 'invoice-a', 'order-sub-a', 'INV-A', 'usd', 14900, 'paid', '2026-08-01T00:00:00Z'),
        ('tenant-a', 'invoice-refund', 'order-refund', 'INV-R', 'usd', 500, 'refunded', '2026-08-02T00:00:00Z'),
        ('tenant-a', 'invoice-unknown', 'order-unknown', 'INV-U', 'usd', 700, 'provider_future', '2026-08-03T00:00:00Z');
    `);

    const billing = await new PostgresBillingReadModelRepository(
      pool,
      () => new Date("2026-08-11T10:00:00.000Z"),
    ).load("tenant-a");

    expect(billing).toMatchObject({
      organizationId: "tenant-a",
      currency: "usd",
      customerExternalId: "tenant-a",
      plan: {
        slug: "growth",
        name: "Growth",
        monthlyBaseMinor: 14900,
        includedStandardRuntimeSeconds: 60000,
        includedPremiumRuntimeSeconds: 3000,
      },
      subscription: { providerCustomerId: "customer-a", providerSubscriptionId: "polar-sub-a" },
      payg: {
        packAmountMinor: 500,
        paidCreditMinor: 400,
        consumedCreditMinor: 120,
        balanceMinor: 480,
        reservedCreditMinor: 80,
        remainingCreditMinor: 400,
        sessionDebits: [{ sessionId: "session-a", amountMinor: 120 }],
      },
      budgetPolicy: { monthlyBudgetMinor: 1000 },
      invoices: [
        { invoiceNumber: "INV-U", status: "unknown" },
        { invoiceNumber: "INV-R", status: "refunded" },
        { invoiceNumber: "INV-A", amountMinor: 14900, currency: "usd", status: "paid" },
      ],
    });
    expect(billing.usage).toEqual([
      expect.objectContaining({ id: "standard_runtime_seconds:posted", used: 120, costMinor: 24, disposition: "posted" }),
      expect.objectContaining({ id: "standard_runtime_seconds:shadow_estimate", used: 50, costMinor: 10, disposition: "shadow_estimate" }),
      expect.objectContaining({ id: "premium_runtime_seconds:incomplete", used: 60, costMinor: null, disposition: "incomplete" }),
      expect.objectContaining({ id: "platform_telephony_charge_minor:posted", used: 75, costMinor: 70, disposition: "posted" }),
    ]);
    expect(billing.usage.reduce((total, item) => total + (item.disposition === "posted" ? item.costMinor ?? 0 : 0), 0)).toBe(94);
  });

  it("returns an explicit empty state and does not read another tenant", async () => {
    await pool.query(`
      insert into billing_customers values
        ('tenant-b', 'polar', 'customer-b', '2026-08-11T10:00:00Z');
      insert into billing_payg_credit_entries values
        ('tenant-b', 'grant-b', null, null, 'grant', 500, null, '2026-08-10T08:00:00Z');
    `);

    const billing = await new PostgresBillingReadModelRepository(pool).load("tenant-new");

    expect(billing.plan).toBeNull();
    expect(billing.subscription.status).toBe("none");
    expect(billing.usage).toEqual([]);
    expect(billing.invoices).toEqual([]);
    expect(billing.budgetPolicy).toBeNull();
    expect(billing.payg).toEqual({
      packAmountMinor: null,
      paidCreditMinor: 0,
      consumedCreditMinor: 0,
      balanceMinor: 0,
      reservedCreditMinor: 0,
      remainingCreditMinor: 0,
      sessionDebits: [],
    });
  });

  it("resolves only the approved $5 PAYG product mapping for checkout", async () => {
    await pool.query(`
      insert into billing_price_catalogs values
        ('catalog-current', 1, 'usd', '2026-08-01T00:00:00Z', '{"payg":{"creditPackMinor":500}}'),
        ('catalog-future', 2, 'usd', '2026-09-01T00:00:00Z', '{"payg":{"creditPackMinor":500}}');
      insert into billing_polar_mappings values
        ('catalog-current', 'product', 'payg-5-usd', 'wrong-mapping-type', 'production'),
        ('catalog-current', 'credit_pack', 'payg-5-usd', 'polar-payg-current', 'production'),
        ('catalog-future', 'credit_pack', 'payg-5-usd', 'polar-payg-future', 'production'),
        ('catalog-current', 'product', 'starter', 'polar-starter', 'production');
    `);

    const repository = new PostgresBillingReadModelRepository(
      pool,
      () => new Date("2026-08-11T10:00:00.000Z"),
    );

    await expect(
      repository.getPaygProductId("production"),
    ).resolves.toBe("polar-payg-current");
    await expect(
      repository.getSubscriptionProductId("starter", "production"),
    ).resolves.toBe("polar-starter");
  });

  it("does not expose historical usage without an active billing cycle", async () => {
    await pool.query(`insert into billing_ledger_entries values
      ('tenant-a', 'old-usage', 'runtime_charge', 'usd', 900, 600, 'second',
       '2026-07-01T00:00:00Z', '{"billingClass":"standard_runtime_seconds","billingDisposition":"posted"}')`);

    const billing = await new PostgresBillingReadModelRepository(
      pool,
      () => new Date("2026-08-11T10:00:00.000Z"),
    ).load("tenant-a");

    expect(billing.usage).toEqual([]);
  });
});
