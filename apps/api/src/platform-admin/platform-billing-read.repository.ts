import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import type {
  PlatformBillingReadModel,
  PlatformOrganizationBillingReadModel,
} from "./platform-admin.models";

interface BillingReadRow {
  organization_id: string;
  organization_name: string;
  subscription_status: string | null;
  plan_slug: string | null;
  currency: string | null;
  shadow_estimate_minor: string | number | null;
  premium_shadow_estimate_minor: string | number | null;
  delivered_charge_minor: string | number | null;
  incomplete_usage_count: string | number | null;
  blocked_usage_count: string | number | null;
  call_seconds: string | number | null;
  premium_runtime_seconds: string | number | null;
  overage_limit_minor: string | number | null;
  paid_credit_minor: string | number | null;
  total_credit_minor: string | number | null;
  consumed_credit_minor: string | number | null;
  reserved_credit_minor: string | number | null;
}

@Injectable()
export class PostgresPlatformBillingReadRepository {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async read(now = new Date()): Promise<PlatformBillingReadModel> {
    const result = await this.pool.query<BillingReadRow>(BILLING_READ_SQL, [now]);
    const organizations = result.rows.map(mapOrganization);
    const organizationsWithUsage = organizations.filter((item) => item.usage !== null);
    const shadowEstimates = organizationsWithUsage
      .map((item) => item.usage?.shadowEstimateMinor ?? null)
      .filter((value): value is number => value !== null);
    const premiumShadowEstimates = organizationsWithUsage
      .map((item) => item.usage?.premiumShadowEstimateMinor ?? null)
      .filter((value): value is number => value !== null);
    const deliveredCharges = organizationsWithUsage
      .map((item) => item.usage?.deliveredChargeMinor ?? null)
      .filter((value): value is number => value !== null);

    return {
      currency: organizations.some((item) => item.hasBillingData) ? "USD" : null,
      shadowEstimateMinor: shadowEstimates.length === 0
        ? null
        : shadowEstimates.reduce((sum, value) => sum + value, 0),
      premiumShadowEstimateMinor: premiumShadowEstimates.length === 0
        ? null
        : premiumShadowEstimates.reduce((sum, value) => sum + value, 0),
      deliveredChargeMinor: deliveredCharges.length === 0
        ? null
        : deliveredCharges.reduce((sum, value) => sum + value, 0),
      incompleteUsageCount: organizationsWithUsage.reduce(
        (sum, item) => sum + (item.usage?.incompleteUsageCount ?? 0), 0,
      ),
      blockedUsageCount: organizationsWithUsage.reduce(
        (sum, item) => sum + (item.usage?.blockedUsageCount ?? 0), 0,
      ),
      tenantsOverBudget: organizations.filter((item) => item.budget?.overBudget === true).length,
      organizations,
    };
  }
}

const BILLING_READ_SQL = `
with current_subscription as (
  select distinct on (tenant_id) tenant_id, status, plan_slug
  from billing_subscriptions
  order by tenant_id, updated_at desc, id desc
), delivered_usage as (
  select tenant_id, aggregate_id as ledger_entry_id
  from billing_outbox
  where aggregate_type = 'billing_ledger_entry'
    and event_type = 'polar.usage.report'
    and status = 'delivered'
), month_usage as (
  select
    ledger.tenant_id,
    max(ledger.currency) as currency,
    sum(ledger.customer_amount_minor) filter (
      where ledger.customer_amount_minor is not null
        and ledger.metadata->>'billingDisposition' = 'shadow'
        and ledger.metadata->>'chargeDelivery' = 'shadow'
        and delivered.ledger_entry_id is null
    ) as shadow_estimate_minor,
    sum(ledger.customer_amount_minor) filter (
      where ledger.customer_amount_minor is not null
        and ledger.metadata->>'billingDisposition' = 'shadow'
        and ledger.metadata->>'chargeDelivery' = 'shadow'
        and ledger.metadata->>'runtimePath' = 'premium_realtime'
        and delivered.ledger_entry_id is null
    ) as premium_shadow_estimate_minor,
    sum(ledger.customer_amount_minor) filter (
      where ledger.customer_amount_minor is not null
        and delivered.ledger_entry_id is not null
    ) as delivered_charge_minor,
    count(*) filter (where ledger.metadata->>'billingDisposition' = 'incomplete') as incomplete_usage_count,
    count(*) filter (where ledger.metadata->>'chargeDelivery' = 'blocked') as blocked_usage_count,
    sum(ledger.quantity) filter (where ledger.entry_type = 'telephony_charge') as call_seconds,
    sum(ledger.quantity) filter (
      where ledger.entry_type = 'runtime_charge'
        and ledger.metadata->>'runtimePath' = 'premium_realtime'
    ) as premium_runtime_seconds
  from billing_ledger_entries ledger
  left join delivered_usage delivered
    on delivered.tenant_id = ledger.tenant_id and delivered.ledger_entry_id = ledger.id
  where ledger.occurred_at >= date_trunc('month', $1::timestamptz)
    and ledger.occurred_at < date_trunc('month', $1::timestamptz) + interval '1 month'
  group by ledger.tenant_id
), paid_order_credit as (
  select
    credit.tenant_id,
    credit.order_id,
    greatest(0, sum(case
      when credit.entry_type = 'grant' then credit.amount_minor
      when credit.entry_type = 'reversal' then -credit.amount_minor
      else 0 end)) as paid_order_net_minor
  from billing_payg_credit_entries credit
  inner join billing_payg_orders payg_order
    on payg_order.tenant_id = credit.tenant_id and payg_order.id = credit.order_id
  where credit.order_id is not null
  group by credit.tenant_id, credit.order_id
), paid_credit as (
  select
    order_credit.tenant_id,
    sum(order_credit.paid_order_net_minor) as paid_credit_minor
  from paid_order_credit order_credit
  group by order_credit.tenant_id
), payg_credit as (
  select
    credit.tenant_id,
    coalesce(paid.paid_credit_minor, 0) as paid_credit_minor,
    greatest(0, sum(case
      when credit.entry_type = 'grant'
        and (credit.expires_at is null or credit.expires_at > $1)
        then credit.amount_minor
      when credit.entry_type in ('debit', 'reversal') then -credit.amount_minor
      else 0 end)) as total_credit_minor,
    sum(case when credit.entry_type = 'debit' then credit.amount_minor else 0 end) as consumed_credit_minor
  from billing_payg_credit_entries credit
  left join paid_credit paid on paid.tenant_id = credit.tenant_id
  group by credit.tenant_id, paid.paid_credit_minor
), active_reservations as (
  select tenant_id, sum(reserved_amount_minor) as reserved_credit_minor
  from billing_charge_reservations
  where status = 'active' and expires_at > $1
  group by tenant_id
)
select
  tenant.id as organization_id,
  tenant.name as organization_name,
  subscription.status as subscription_status,
  subscription.plan_slug,
  usage.currency,
  usage.shadow_estimate_minor,
  usage.premium_shadow_estimate_minor,
  usage.delivered_charge_minor,
  usage.incomplete_usage_count,
  usage.blocked_usage_count,
  usage.call_seconds,
  usage.premium_runtime_seconds,
  budget.overage_limit_minor,
  credit.paid_credit_minor,
  credit.total_credit_minor,
  credit.consumed_credit_minor,
  reservations.reserved_credit_minor
from tenants tenant
left join current_subscription subscription on subscription.tenant_id = tenant.id
left join month_usage usage on usage.tenant_id = tenant.id
left join billing_budget_policies budget on budget.tenant_id = tenant.id
left join payg_credit credit on credit.tenant_id = tenant.id
left join active_reservations reservations on reservations.tenant_id = tenant.id
where tenant.status <> 'archived'
order by tenant.name, tenant.id`;

function mapOrganization(row: BillingReadRow): PlatformOrganizationBillingReadModel {
  const incompleteUsageCount = integer(row.incomplete_usage_count);
  const blockedUsageCount = integer(row.blocked_usage_count);
  const hasUsage = row.shadow_estimate_minor !== null || row.delivered_charge_minor !== null
    || incompleteUsageCount > 0 || blockedUsageCount > 0 || row.call_seconds !== null
    || row.premium_runtime_seconds !== null;
  const hasPayg = row.paid_credit_minor !== null || row.total_credit_minor !== null
    || row.consumed_credit_minor !== null
    || row.reserved_credit_minor !== null;
  const hasBillingData = row.subscription_status !== null || hasUsage
    || row.overage_limit_minor !== null || hasPayg;
  const paidCreditMinor = Math.max(0, integer(row.paid_credit_minor));
  const totalCreditMinor = Math.max(0, integer(row.total_credit_minor));
  const consumedCreditMinor = integer(row.consumed_credit_minor);
  const reservedCreditMinor = integer(row.reserved_credit_minor);
  const shadowEstimateMinor = optionalInteger(row.shadow_estimate_minor);
  const overageLimitMinor = integer(row.overage_limit_minor);

  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    hasBillingData,
    subscription: row.subscription_status === null
      ? null
      : { status: row.subscription_status, planSlug: row.plan_slug },
    usage: hasUsage
      ? {
          currency: "USD",
          shadowEstimateMinor,
          premiumShadowEstimateMinor: optionalInteger(row.premium_shadow_estimate_minor),
          deliveredChargeMinor: optionalInteger(row.delivered_charge_minor),
          incompleteUsageCount,
          blockedUsageCount,
          callSeconds: integer(row.call_seconds),
          premiumRuntimeSeconds: integer(row.premium_runtime_seconds),
        }
      : null,
    budget: row.overage_limit_minor === null
      ? null
      : {
          currency: "USD",
          overageLimitMinor,
          overBudget: shadowEstimateMinor !== null && shadowEstimateMinor > overageLimitMinor,
        },
    payg: hasPayg
      ? {
          currency: "USD",
          paidCreditMinor,
          totalCreditMinor,
          consumedCreditMinor,
          reservedCreditMinor,
          availableCreditMinor: Math.max(
            0,
            totalCreditMinor - reservedCreditMinor,
          ),
        }
      : null,
  };
}

function integer(value: string | number | null) {
  if (value === null) {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Platform billing read value is not a safe integer.");
  }
  return parsed;
}

function optionalInteger(value: string | number | null) {
  return value === null ? null : integer(value);
}
