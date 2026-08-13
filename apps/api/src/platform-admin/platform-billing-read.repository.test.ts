import { describe, expect, it, vi } from "vitest";

import { PostgresPlatformBillingReadRepository } from "./platform-billing-read.repository";

describe("PostgresPlatformBillingReadRepository", () => {
  it("returns tenant-qualified billing facts and an explicit no-data state", async () => {
    const query = vi.fn(async (sql: string) => {
      void sql;
      return { rows: [
        {
          organization_id: "tenant-paid",
          organization_name: "Paid tenant",
          subscription_status: "active",
          plan_slug: "growth",
          currency: "usd",
          shadow_estimate_minor: "725",
          premium_shadow_estimate_minor: "225",
          delivered_charge_minor: null,
          incomplete_usage_count: "2",
          blocked_usage_count: "1",
          call_seconds: "180",
          premium_runtime_seconds: "90",
          overage_limit_minor: "1000",
          paid_credit_minor: "500",
          total_credit_minor: "325",
          consumed_credit_minor: "175",
          reserved_credit_minor: "100",
        },
        {
          organization_id: "tenant-empty",
          organization_name: "New tenant",
          subscription_status: null,
          plan_slug: null,
          currency: null,
          shadow_estimate_minor: null,
          premium_shadow_estimate_minor: null,
          delivered_charge_minor: null,
          incomplete_usage_count: null,
          blocked_usage_count: null,
          call_seconds: null,
          premium_runtime_seconds: null,
          overage_limit_minor: null,
          paid_credit_minor: null,
          total_credit_minor: null,
          consumed_credit_minor: null,
          reserved_credit_minor: null,
        },
      ] };
    });
    const repository = new PostgresPlatformBillingReadRepository({ query } as never);

    await expect(repository.read()).resolves.toEqual({
      currency: "USD",
      shadowEstimateMinor: 725,
      premiumShadowEstimateMinor: 225,
      deliveredChargeMinor: null,
      incompleteUsageCount: 2,
      blockedUsageCount: 1,
      tenantsOverBudget: 0,
      organizations: [
        {
          organizationId: "tenant-paid",
          organizationName: "Paid tenant",
          hasBillingData: true,
          subscription: { status: "active", planSlug: "growth" },
          usage: {
            currency: "USD",
            shadowEstimateMinor: 725,
            premiumShadowEstimateMinor: 225,
            deliveredChargeMinor: null,
            incompleteUsageCount: 2,
            blockedUsageCount: 1,
            callSeconds: 180,
            premiumRuntimeSeconds: 90,
          },
          budget: { currency: "USD", overageLimitMinor: 1000, overBudget: false },
          payg: {
            currency: "USD",
            paidCreditMinor: 500,
            totalCreditMinor: 325,
            consumedCreditMinor: 175,
            reservedCreditMinor: 100,
            availableCreditMinor: 225,
          },
        },
        {
          organizationId: "tenant-empty",
          organizationName: "New tenant",
          hasBillingData: false,
          subscription: null,
          usage: null,
          budget: null,
          payg: null,
        },
      ],
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("billing_ledger_entries");
    expect(query.mock.calls[0]?.[0]).toContain("billing_payg_credit_entries");
    expect(query.mock.calls[0]?.[0]).toContain("billing_payg_orders");
    expect(query.mock.calls[0]?.[0]).toContain("credit.order_id is not null");
    expect(query.mock.calls[0]?.[0]).toContain("group by credit.tenant_id, credit.order_id");
    expect(query.mock.calls[0]?.[0]).toContain("sum(order_credit.paid_order_net_minor)");
    expect(query.mock.calls[0]?.[0]).toContain("greatest(");
    expect(query.mock.calls[0]?.[0]).toContain("credit.expires_at is null or credit.expires_at > $1");
    expect(query.mock.calls[0]?.[0]).toContain("billingDisposition");
    expect(query.mock.calls[0]?.[0]).toContain("chargeDelivery");
    expect(query.mock.calls[0]?.[0]).toContain("billing_outbox");
    expect(query.mock.calls[0]?.[0]).toContain("delivered.ledger_entry_id is null");
    expect(query.mock.calls[0]?.[0]).toContain("billing_charge_reservations");
  });

  it("never exposes a negative paid credit after a refund reversal", async () => {
    const repository = new PostgresPlatformBillingReadRepository({
      query: async () => ({ rows: [{
        organization_id: "tenant-refunded",
        organization_name: "Refunded tenant",
        subscription_status: null,
        plan_slug: null,
        currency: null,
        shadow_estimate_minor: null,
        premium_shadow_estimate_minor: null,
        delivered_charge_minor: null,
        incomplete_usage_count: null,
        blocked_usage_count: null,
        call_seconds: null,
        premium_runtime_seconds: null,
        overage_limit_minor: null,
        paid_credit_minor: "-500",
        total_credit_minor: "0",
        consumed_credit_minor: "0",
        reserved_credit_minor: "0",
      }] }),
    } as never);

    const result = await repository.read();
    expect(result.organizations[0]?.payg).toMatchObject({
      paidCreditMinor: 0,
      availableCreditMinor: 0,
    });
  });

  it("uses a valid promo-only grant for total and available service credit", async () => {
    const repository = new PostgresPlatformBillingReadRepository({
      query: async () => ({ rows: [creditRow({
        organization_id: "tenant-promo",
        organization_name: "Promo tenant",
        paid_credit_minor: "0",
        total_credit_minor: "300",
        reserved_credit_minor: "50",
      })] }),
    } as never);

    expect((await repository.read()).organizations[0]?.payg).toMatchObject({
      paidCreditMinor: 0,
      totalCreditMinor: 300,
      reservedCreditMinor: 50,
      availableCreditMinor: 250,
    });
  });

  it("combines paid and promo grants in total credit without inflating paid credit", async () => {
    const repository = new PostgresPlatformBillingReadRepository({
      query: async () => ({ rows: [creditRow({
        organization_id: "tenant-mixed",
        organization_name: "Mixed credit tenant",
        paid_credit_minor: "500",
        total_credit_minor: "700",
        consumed_credit_minor: "100",
        reserved_credit_minor: "100",
      })] }),
    } as never);

    expect((await repository.read()).organizations[0]?.payg).toMatchObject({
      paidCreditMinor: 500,
      totalCreditMinor: 700,
      consumedCreditMinor: 100,
      availableCreditMinor: 600,
    });
  });

  it("keeps one live paid pack after a second paid pack is fully refunded", async () => {
    const repository = new PostgresPlatformBillingReadRepository({
      query: async () => ({ rows: [creditRow({
        organization_id: "tenant-multi-order",
        organization_name: "Multi-order tenant",
        paid_credit_minor: "500",
        total_credit_minor: "500",
      })] }),
    } as never);

    expect((await repository.read()).organizations[0]?.payg).toMatchObject({
      paidCreditMinor: 500,
      totalCreditMinor: 500,
      availableCreditMinor: 500,
    });
  });
});

function creditRow(overrides: Record<string, string>) {
  return {
    subscription_status: null,
    plan_slug: null,
    currency: null,
    shadow_estimate_minor: null,
    premium_shadow_estimate_minor: null,
    delivered_charge_minor: null,
    incomplete_usage_count: null,
    blocked_usage_count: null,
    call_seconds: null,
    premium_runtime_seconds: null,
    overage_limit_minor: null,
    paid_credit_minor: "0",
    total_credit_minor: "0",
    consumed_credit_minor: "0",
    reserved_credit_minor: "0",
    ...overrides,
  };
}
