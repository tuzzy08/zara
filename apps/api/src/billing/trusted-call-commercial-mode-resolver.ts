import type { Pool } from "pg";

type Database = Pick<Pool, "connect">;
type MeterClass = "standard" | "premium";

export class TrustedCallCommercialModeResolver {
  constructor(private readonly database: Database) {}

  async resolve(organizationId: string, now: string, meterClass: MeterClass = "standard") {
    if (organizationId.trim() === "" || !Number.isFinite(Date.parse(now))) {
      return { mode: "unavailable" as const };
    }
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const [subscriptions, entitlements, credit, paygAccount] = await Promise.all([
        client.query(`select subscription.id, subscription.catalog_id, subscription.plan_slug,
            subscription.status, subscription.current_period_end, catalog.catalog_document
          from billing_subscriptions subscription
          join billing_price_catalogs catalog on catalog.id = subscription.catalog_id
          where subscription.tenant_id = $1`, [organizationId]),
        client.query(`select key, status from billing_entitlements
          where tenant_id = $1 and key = 'runtime_access'`, [organizationId]),
        client.query(`select coalesce(sum(case
          when entry_type = 'grant' and (expires_at is null or expires_at > $2) then amount_minor
          when entry_type in ('debit', 'reversal') then -amount_minor else 0 end), 0) as balance_minor
          from billing_payg_credit_entries where tenant_id = $1`, [organizationId, now]),
        client.query(`select reserved_amount_minor from billing_reservation_accounts
          where tenant_id = $1`, [organizationId]),
      ]);
      const grossPaygMinor = safeNonNegative(credit.rows[0]?.balance_minor);
      const reservedPaygMinor = safeNonNegative(paygAccount.rows[0]?.reserved_amount_minor);
      const availablePaygMinor = Math.max(0, grossPaygMinor - reservedPaygMinor);

      if (subscriptions.rows.length === 0 && entitlements.rows.length === 0) {
        await client.query("commit");
        return grossPaygMinor > 0
          ? { mode: "payg" as const, available: availablePaygMinor > 0, availablePaygMinor }
          : { mode: "unavailable" as const };
      }
      if (subscriptions.rows.length !== 1) {
        await client.query("commit");
        return { mode: "unavailable" as const };
      }

      const subscription = subscriptions.rows[0]!;
      const activeEntitlements = entitlements.rows.filter((entry) => entry.status === "active");
      if ((subscription.status !== "active" && subscription.status !== "trialing")
        || Date.parse(String(subscription.current_period_end)) <= Date.parse(now)
        || typeof subscription.id !== "string" || typeof subscription.catalog_id !== "string"
        || typeof subscription.plan_slug !== "string" || subscription.plan_slug.trim() === ""
        || activeEntitlements.length !== 1) {
        await client.query("commit");
        return { mode: "unavailable" as const };
      }

      const cycles = await client.query(`select id, catalog_id, starts_at, ends_at
        from billing_cycles where tenant_id = $1 and status = 'active'
          and starts_at <= $2 and ends_at > $2`, [organizationId, now]);
      if (cycles.rows.length !== 1 || cycles.rows[0].catalog_id !== subscription.catalog_id) {
        await client.query("commit");
        return { mode: "unavailable" as const };
      }
      const cycle = cycles.rows[0]!;
      if (!isUtcCalendarDayBoundary(cycle.starts_at)
        || !isUtcCalendarDayBoundary(cycle.ends_at)
        || !isUtcCalendarDayBoundary(subscription.current_period_end)
        || Date.parse(String(subscription.current_period_end)) !== Date.parse(String(cycle.ends_at))) {
        await client.query("commit");
        return { mode: "unavailable" as const };
      }
      const document = subscription.catalog_document as { plans?: Record<string, Record<string, unknown>> };
      const plan = document.plans?.[subscription.plan_slug];
      const includedField = meterClass === "standard"
        ? "includedStandardRuntimeSeconds" : "includedPremiumRuntimeSeconds";
      const rateField = meterClass === "standard"
        ? "standardRuntimePerMinuteMinor" : "premiumRuntimePerMinuteMinor";
      const includedSeconds = safeNonNegative(plan?.[includedField]);
      const runtimeRateMinor = safeNonNegative(plan?.[rateField]);
      if (plan === undefined || runtimeRateMinor === 0) {
        await client.query("commit");
        return { mode: "unavailable" as const };
      }

      const [usage, telephony, meterAccount, overageAccount, policy, risk] = await Promise.all([
        client.query(`select
            coalesce(sum(case when metadata->>'billingClass' = 'standard_runtime_seconds'
              then quantity else 0 end), 0) as standard_seconds,
            coalesce(sum(case when metadata->>'billingClass' = 'premium_runtime_seconds'
              then quantity else 0 end), 0) as premium_seconds
          from billing_ledger_entries where tenant_id = $1 and catalog_id = $2
            and entry_type = 'runtime_charge' and unit = 'second'
            and occurred_at >= $3 and occurred_at < $4`,
        [organizationId, subscription.catalog_id, cycle.starts_at, cycle.ends_at]),
        client.query(`select coalesce(sum(customer_amount_minor), 0) as amount_minor
          from billing_ledger_entries where tenant_id = $1 and catalog_id = $2
            and entry_type = 'telephony_charge' and unit = 'connected_second'
            and metadata->>'billingClass' = 'platform_telephony_charge_minor'
            and occurred_at >= $3 and occurred_at < $4`,
        [organizationId, subscription.catalog_id, cycle.starts_at, cycle.ends_at]),
        client.query(`select reserved_included_seconds from billing_subscription_reservation_accounts
          where tenant_id = $1 and cycle_id = $2 and meter_class = $3`,
        [organizationId, cycle.id, meterClass]),
        client.query(`select reserved_overage_minor from billing_subscription_overage_accounts
          where tenant_id = $1 and cycle_id = $2`, [organizationId, cycle.id]),
        client.query(`select currency, overage_limit_minor from billing_budget_policies
          where tenant_id = $1`, [organizationId]),
        client.query(`select currency, overage_limit_minor from billing_platform_risk_limits
          where tenant_id = $1`, [organizationId]),
      ]);
      if (policy.rows.length !== 1 || risk.rows.length !== 1
        || policy.rows[0].currency !== "usd" || risk.rows[0].currency !== "usd") {
        await client.query("commit");
        return { mode: "unavailable" as const };
      }
      const standardActualSeconds = safeNonNegative(usage.rows[0]?.standard_seconds);
      const premiumActualSeconds = safeNonNegative(usage.rows[0]?.premium_seconds);
      const actualSeconds = meterClass === "standard"
        ? standardActualSeconds
        : premiumActualSeconds;
      const reservedIncludedSeconds = safeNonNegative(meterAccount.rows[0]?.reserved_included_seconds);
      const availableIncludedSeconds = Math.max(0, includedSeconds - actualSeconds - reservedIncludedSeconds);
      const actualOverageMinor = priceSeconds(
        Math.max(0, standardActualSeconds - safeNonNegative(plan.includedStandardRuntimeSeconds)),
        safeNonNegative(plan.standardRuntimePerMinuteMinor),
      ) + priceSeconds(
        Math.max(0, premiumActualSeconds - safeNonNegative(plan.includedPremiumRuntimeSeconds)),
        safeNonNegative(plan.premiumRuntimePerMinuteMinor),
      )
        + safeNonNegative(telephony.rows[0]?.amount_minor);
      const globalReservedOverageMinor = safeNonNegative(overageAccount.rows[0]?.reserved_overage_minor);
      const availableOverageMinor = Math.max(0,
        Math.min(safeNonNegative(policy.rows[0].overage_limit_minor),
          safeNonNegative(risk.rows[0].overage_limit_minor))
          - actualOverageMinor - globalReservedOverageMinor);
      const premiumAllowed = safeNonNegative(plan.includedPremiumRuntimeSeconds) > 0
        || safeNonNegative(plan.premiumRuntimePerMinuteMinor) > 0;
      await client.query("commit");
      return {
        mode: "subscription" as const,
        subscriptionId: subscription.id as string,
        catalogId: subscription.catalog_id as string,
        planSlug: subscription.plan_slug as string,
        premiumAllowed,
        available: availableIncludedSeconds > 0 || availablePaygMinor > 0 || availableOverageMinor > 0,
        availableIncludedSeconds,
        availablePaygMinor,
        availableOverageMinor,
      };
    } catch {
      await client.query("rollback").catch(() => undefined);
      return { mode: "unavailable" as const };
    } finally {
      client.release();
    }
  }
}

function isUtcCalendarDayBoundary(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime())
    && date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0;
}

function safeNonNegative(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Billing availability is invalid.");
  return number;
}

function priceSeconds(seconds: number, rateMinorPerMinute: number) {
  return seconds === 0 ? 0 : Math.ceil(seconds * rateMinorPerMinute / 60);
}
