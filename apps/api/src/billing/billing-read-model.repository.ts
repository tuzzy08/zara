import type { Pool } from "pg";

import type {
  BillingInvoiceResponse,
  BillingPlanResponse,
  BillingSubscriptionStatus,
  BillingUsageMetricResponse,
  TenantBillingStateResponse,
} from "./billing.models";

export const BILLING_READ_MODEL_REPOSITORY = Symbol("BILLING_READ_MODEL_REPOSITORY");

type QueryDatabase = Pick<Pool, "query">;

export interface BillingReadModelRepository {
  load: (organizationId: string) => Promise<TenantBillingStateResponse>;
  getPaygProductId: (environment: "sandbox" | "production") => Promise<string | null>;
  getSubscriptionProductId: (
    planSlug: "starter" | "growth" | "scale",
    environment: "sandbox" | "production",
  ) => Promise<string | null>;
}

export class PostgresBillingReadModelRepository implements BillingReadModelRepository {
  constructor(
    private readonly database: QueryDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getPaygProductId(environment: "sandbox" | "production") {
    return this.getProductId("payg-5-usd", "credit_pack", environment);
  }

  async getSubscriptionProductId(
    planSlug: "starter" | "growth" | "scale",
    environment: "sandbox" | "production",
  ) {
    return this.getProductId(planSlug, "product", environment);
  }

  private async getProductId(
    internalKey: string,
    mappingType: "credit_pack" | "product",
    environment: "sandbox" | "production",
  ) {
    const result = await this.database.query(
      `select m.provider_id from billing_polar_mappings m
       join billing_price_catalogs c on c.id = m.catalog_id
       where m.mapping_type = $1 and m.internal_key = $2 and m.environment = $3
         and c.effective_from <= $4
       order by c.effective_from desc, c.version desc limit 1`,
      [mappingType, internalKey, environment, this.now().toISOString()],
    );
    return result.rows[0]?.provider_id === undefined ? null : String(result.rows[0].provider_id);
  }

  async load(organizationId: string): Promise<TenantBillingStateResponse> {
    const now = this.now();
    const nowIso = now.toISOString();
    const [customerResult, subscriptionResult, cycleResult, budgetResult, ledgerResult,
      creditResult, orderResult, reservationResult, entitlementResult, invoiceResult,
      catalogResult] = await Promise.all([
      this.database.query(
        `select provider_customer_id, updated_at from billing_customers where tenant_id = $1`,
        [organizationId],
      ),
      this.database.query(
        `select s.id, s.provider_subscription_id, s.catalog_id, s.plan_slug, s.status,
                s.current_period_end, s.cancel_at_period_end, s.updated_at,
                c.currency, c.catalog_document
         from billing_subscriptions s
         join billing_price_catalogs c on c.id = s.catalog_id
         where s.tenant_id = $1 and c.effective_from <= $2
         order by s.updated_at desc, s.id asc
         limit 1`,
        [organizationId, nowIso],
      ),
      this.database.query(
        `select starts_at, ends_at from billing_cycles
         where tenant_id = $1 and status = 'active' and starts_at <= $2 and ends_at > $2
         order by starts_at desc limit 1`,
        [organizationId, nowIso],
      ),
      this.database.query(
        `select currency, overage_limit_minor, call_minute_limit,
                premium_runtime_minute_limit, over_budget_behavior,
                warning_threshold_percent, updated_by, updated_at
         from billing_budget_policies where tenant_id = $1`,
        [organizationId],
      ),
      this.database.query(
        `select ledger.id, ledger.entry_type, ledger.currency, ledger.customer_amount_minor,
                ledger.quantity, ledger.unit, ledger.occurred_at, ledger.metadata,
                delivered.aggregate_id as delivered_aggregate_id
         from billing_ledger_entries ledger
         left join (
           select distinct tenant_id, aggregate_id from billing_outbox
           where aggregate_type = 'billing_ledger_entry'
             and event_type = 'polar.usage.report'
             and status = 'delivered'
             and tenant_id = $1
         ) delivered on delivered.tenant_id = ledger.tenant_id
           and delivered.aggregate_id = ledger.id
         where ledger.tenant_id = $1
         order by ledger.occurred_at asc, ledger.id asc`,
        [organizationId],
      ),
      this.database.query(
        `select id, order_id, session_id, entry_type, amount_minor, expires_at, created_at
         from billing_payg_credit_entries where tenant_id = $1
         order by created_at desc, id asc`,
        [organizationId],
      ),
      this.database.query(
        `select id, granted_credit_minor, status from billing_payg_orders
         where tenant_id = $1 order by created_at desc, id asc`,
        [organizationId],
      ),
      this.database.query(
        `select reserved_amount_minor, expires_at from billing_charge_reservations
         where tenant_id = $1 and status = 'active'`,
        [organizationId],
      ),
      this.database.query(
        `select id, key, status, updated_at from billing_entitlements
         where tenant_id = $1 order by updated_at desc, id asc`,
        [organizationId],
      ),
      this.database.query(
        `select id, provider_order_id, invoice_number, currency, amount_minor,
                status, issued_at from billing_invoices
         where tenant_id = $1 order by issued_at desc, id asc`,
        [organizationId],
      ),
      this.database.query(
        `select currency, catalog_document from billing_price_catalogs
         where effective_from <= $1 order by effective_from desc, version desc limit 1`,
        [nowIso],
      ),
    ]);

    const subscriptionRow = subscriptionResult.rows[0];
    const customerRow = customerResult.rows[0];
    const cycleRow = cycleResult.rows[0];
    const budgetRow = budgetResult.rows[0];
    const catalogRow = subscriptionRow ?? catalogResult.rows[0];
    const currency = readCurrency(catalogRow?.currency ?? budgetRow?.currency ?? "usd");
    const ledgerRows = ledgerResult.rows.filter((row) => isInCycle(row.occurred_at, cycleRow));
    const usage = createUsage(ledgerRows);
    const currentSpendMinor = usage.reduce(
      (total, metric) => total + (metric.disposition === "posted" ? metric.costMinor ?? 0 : 0),
      0,
    );
    const plan = createPlan(subscriptionRow, currentSpendMinor, budgetRow);
    const credits = creditResult.rows;
    const ordersById = new Map(
      orderResult.rows.map((row) => [String(row.id), String(row.status)]),
    );
    const paidCreditMinor = credits.reduce((total, row) => {
      if (typeof row.order_id !== "string" || ordersById.get(row.order_id) !== "paid") {
        return total;
      }
      if (row.entry_type === "grant" && !isExpired(row.expires_at, now)) {
        return total + toInteger(row.amount_minor);
      }
      return row.entry_type === "reversal" ? total - toInteger(row.amount_minor) : total;
    }, 0);
    const consumedCreditMinor = credits
      .filter((row) => row.entry_type === "debit")
      .reduce((total, row) => total + toInteger(row.amount_minor), 0);
    const balanceMinor = Math.max(0, credits.reduce((total, row) => {
      if (row.entry_type === "grant" && !isExpired(row.expires_at, now)) {
        return total + toInteger(row.amount_minor);
      }
      return row.entry_type === "debit" || row.entry_type === "reversal"
        ? total - toInteger(row.amount_minor)
        : total;
    }, 0));
    const reservedCreditMinor = reservationResult.rows
      .filter((row) => !isExpired(row.expires_at, now))
      .reduce((total, row) => total + toInteger(row.reserved_amount_minor), 0);
    const latestPaidOrder = orderResult.rows.find((row) => row.status === "paid");
    const packAmountMinor = readPackAmount(latestPaidOrder, catalogRow?.catalog_document);

    return {
      organizationId,
      provider: "polar",
      currency,
      customerExternalId: organizationId,
      plan,
      subscription: {
        provider: "polar",
        ...(customerRow?.provider_customer_id === null || customerRow?.provider_customer_id === undefined
          ? {}
          : { providerCustomerId: String(customerRow.provider_customer_id) }),
        ...(subscriptionRow?.provider_subscription_id === undefined
          ? {}
          : { providerSubscriptionId: String(subscriptionRow.provider_subscription_id) }),
        status: readSubscriptionStatus(subscriptionRow?.status),
        ...(subscriptionRow?.current_period_end === null || subscriptionRow?.current_period_end === undefined
          ? {}
          : { currentPeriodEnd: toIso(subscriptionRow.current_period_end) }),
        cancelAtPeriodEnd: subscriptionRow?.cancel_at_period_end === true,
      },
      usage,
      budgetPolicy: budgetRow === undefined ? null : {
        monthlyBudgetUsd: toInteger(budgetRow?.overage_limit_minor) / 100,
        monthlyBudgetMinor: toInteger(budgetRow?.overage_limit_minor),
        currency,
        callMinuteLimit: toNumber(budgetRow?.call_minute_limit),
        premiumRuntimeMinuteLimit: toNumber(budgetRow?.premium_runtime_minute_limit),
        overBudgetBehavior: budgetRow?.over_budget_behavior === "warn" ? "warn" : "block",
        warningThresholdPercent: toInteger(budgetRow?.warning_threshold_percent) || 80,
        updatedBy: budgetRow?.updated_by === undefined ? "system" : String(budgetRow.updated_by),
        updatedAt: budgetRow?.updated_at === undefined ? now.toISOString() : toIso(budgetRow.updated_at),
      },
      budgetWarnings: [],
      usageAggregates: [],
      telephonyMinuteAggregates: [],
      runtimeCostEvents: [],
      entitlements: entitlementResult.rows.map((row) => ({
        id: String(row.id),
        label: String(row.key),
        status: row.status === "active" || row.status === "granted" ? "granted" : "revoked",
        source: "polar" as const,
      })),
      invoices: invoiceResult.rows.map(mapInvoice),
      payg: {
        packAmountMinor,
        paidCreditMinor: Math.max(0, paidCreditMinor),
        consumedCreditMinor,
        balanceMinor,
        reservedCreditMinor,
        remainingCreditMinor: Math.max(0, balanceMinor - reservedCreditMinor),
        sessionDebits: credits
          .filter((row) => row.entry_type === "debit" && typeof row.session_id === "string")
          .map((row) => ({
            id: String(row.id),
            sessionId: String(row.session_id),
            amountMinor: toInteger(row.amount_minor),
            createdAt: toIso(row.created_at),
          })),
      },
      updatedAt: latestTimestamp([
        customerRow?.updated_at,
        subscriptionRow?.updated_at,
        budgetRow?.updated_at,
        ...ledgerRows.map((row) => row.occurred_at),
      ], now.toISOString()),
    };
  }
}

function createPlan(row: Record<string, unknown> | undefined, spendMinor: number, budgetRow: Record<string, unknown> | undefined): BillingPlanResponse | null {
  if (row?.plan_slug === null || row?.plan_slug === undefined) return null;
  const slug = String(row.plan_slug);
  if (slug !== "starter" && slug !== "growth" && slug !== "scale") return null;
  const document = readRecord(row.catalog_document);
  const planDocument = readRecord(readRecord(document?.plans)?.[slug]);
  const monthlyBaseMinor = readNullableInteger(planDocument?.baseFeeMinor ?? planDocument?.monthlyBaseMinor);
  const includedStandardRuntimeSeconds = readNullableInteger(planDocument?.includedStandardRuntimeSeconds);
  const includedPremiumRuntimeSeconds = readNullableInteger(planDocument?.includedPremiumRuntimeSeconds);
  const budgetLimitMinor = toInteger(budgetRow?.overage_limit_minor);
  const warningThreshold = (toInteger(budgetRow?.warning_threshold_percent) || 80) / 100;
  return {
    slug,
    name: typeof planDocument?.name === "string" ? planDocument.name : slug,
    status: readSubscriptionStatus(row.status),
    monthlyBaseUsd: (monthlyBaseMinor ?? 0) / 100,
    includedMinutes: (includedStandardRuntimeSeconds ?? 0) / 60,
    budgetLimitUsd: budgetLimitMinor / 100,
    budgetUsedUsd: spendMinor / 100,
    budgetWarning: budgetLimitMinor > 0 && spendMinor / budgetLimitMinor >= warningThreshold,
    currency: readCurrency(row.currency),
    monthlyBaseMinor,
    includedStandardRuntimeSeconds,
    includedPremiumRuntimeSeconds,
  };
}

function createUsage(rows: Array<Record<string, unknown>>): BillingUsageMetricResponse[] {
  const totals = new Map<string, {
    used: number;
    costMinor: number | null;
    unit: string;
    disposition: NonNullable<BillingUsageMetricResponse["disposition"]>;
  }>();
  for (const row of rows) {
    const billingClass = readRecord(row.metadata)?.billingClass;
    if (typeof billingClass !== "string") continue;
    const disposition = readUsageDisposition(row);
    const amount = disposition === "posted" || disposition === "shadow_estimate"
      ? readNullableInteger(row.customer_amount_minor)
      : null;
    const aggregateKey = `${billingClass}:${disposition}`;
    const current = totals.get(aggregateKey) ?? {
      used: 0,
      costMinor: 0,
      unit: String(row.unit),
      disposition,
    };
    current.used += toNumber(row.quantity);
    current.costMinor = current.costMinor === null || amount === null
      ? null
      : current.costMinor + amount;
    totals.set(aggregateKey, current);
  }
  const order = ["standard_runtime_seconds", "premium_runtime_seconds", "platform_telephony_charge_minor"];
  const dispositions = ["posted", "shadow_estimate", "incomplete", "blocked", "non_billable"] as const;
  return order.flatMap((id) => dispositions.flatMap((disposition) => {
    const total = totals.get(`${id}:${disposition}`);
    if (total === undefined) return [];
    return [{
      id: `${id}:${disposition}`,
      label: id === "standard_runtime_seconds" ? "Standard runtime"
        : id === "premium_runtime_seconds" ? "Premium runtime" : "Platform telephony",
      used: total.used,
      unit: total.unit,
      costMinor: total.costMinor,
      costUsd: total.costMinor === null ? null : total.costMinor / 100,
      disposition: total.disposition,
    }];
  }));
}

function mapInvoice(row: Record<string, unknown>): BillingInvoiceResponse {
  const amountMinor = toInteger(row.amount_minor);
  const status = row.status === "paid" || row.status === "open" || row.status === "void"
    || row.status === "refunded" ? row.status : "unknown";
  return {
    id: String(row.id), provider: "polar", providerOrderId: String(row.provider_order_id),
    invoiceNumber: String(row.invoice_number), amountUsd: amountMinor / 100,
    amountMinor, currency: readCurrency(row.currency), status, createdAt: toIso(row.issued_at),
  };
}

function readPackAmount(orderRow: Record<string, unknown> | undefined, documentValue: unknown) {
  if (orderRow !== undefined) return toInteger(orderRow.granted_credit_minor);
  const payg = readRecord(readRecord(documentValue)?.payg);
  return readNullableInteger(payg?.creditPackMinor ?? readRecord(documentValue)?.paygPackMinor);
}

function isInCycle(value: unknown, cycle: Record<string, unknown> | undefined) {
  if (cycle === undefined) return false;
  const time = Date.parse(toIso(value));
  return time >= Date.parse(toIso(cycle.starts_at)) && time < Date.parse(toIso(cycle.ends_at));
}

function readUsageDisposition(
  row: Record<string, unknown>,
): NonNullable<BillingUsageMetricResponse["disposition"]> {
  const metadata = readRecord(row.metadata);
  const value = metadata?.billingDisposition;
  if (value === "incomplete" || row.customer_amount_minor === null || row.customer_amount_minor === undefined) {
    return "incomplete";
  }
  if (row.delivered_aggregate_id !== null && row.delivered_aggregate_id !== undefined) {
    return "posted";
  }
  if (value === "blocked") return "blocked";
  if (value === "non_billable") return "non_billable";
  return "shadow_estimate";
}

function isExpired(value: unknown, now: Date) {
  return value !== null && value !== undefined && Date.parse(toIso(value)) <= now.getTime();
}

function readSubscriptionStatus(value: unknown): BillingSubscriptionStatus {
  return value === "trialing" || value === "active" || value === "past_due" || value === "canceled"
    ? value : "none";
}

function readCurrency(value: unknown): "usd" {
  if (value !== "usd") throw new Error("Tenant billing read models require one USD catalog.");
  return "usd";
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function toInteger(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) ? number : 0;
}

function readNullableInteger(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toIso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}

function latestTimestamp(values: unknown[], fallback: string) {
  const timestamps = values
    .filter((value) => value !== undefined && value !== null)
    .map((value) => toIso(value))
    .sort();
  return timestamps.at(-1) ?? fallback;
}
