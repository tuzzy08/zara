import type { PoolClient } from "pg";

interface UsageRow {
  entry_type: string;
  unit: string;
  quantity: unknown;
  customer_amount_minor: unknown;
  metadata: Record<string, unknown>;
}

export async function readSubscriptionCycleRows(database: Pick<PoolClient, "query">, input: {
  organizationId: string; catalogId: string; cycleStartsAt: string; cycleEndsAt: string;
}): Promise<UsageRow[]> {
  // Read finalized claims first. The admission caller holds the tenant credit lock.
  const finalized = await database.query(`select reservation.*, catalog.catalog_document,
      debit.amount_minor as payg_applied_minor
    from billing_subscription_call_reservations reservation
    join billing_price_catalogs catalog on catalog.id = reservation.catalog_id
    left join billing_payg_credit_entries debit on debit.tenant_id = reservation.tenant_id
      and debit.id = 'subscription-payg-debit:' || reservation.id
    where reservation.tenant_id = $1 and reservation.catalog_id = $2
      and reservation.status = 'finalized' and reservation.finalized_at >= $3
      and reservation.finalized_at < $4`,
  [input.organizationId, input.catalogId, input.cycleStartsAt, input.cycleEndsAt]);
  const ledger = await database.query(`select entry_type, quantity, unit, customer_amount_minor, metadata
    from billing_ledger_entries where tenant_id = $1 and catalog_id = $2
      and occurred_at >= $3 and occurred_at < $4`,
  [input.organizationId, input.catalogId, input.cycleStartsAt, input.cycleEndsAt]);
  const rows: UsageRow[] = ledger.rows;
  const recorded = new Set(rows.map(row => JSON.stringify([row.entry_type, row.metadata.callSessionId])));
  for (const reservation of finalized.rows) {
    const seconds = Number(reservation.actual_seconds);
    const included = Math.min(seconds, Number(reservation.reserved_included_seconds));
    const plan = reservation.catalog_document.plans[reservation.plan_slug];
    const rate = Number(plan[reservation.meter_class === "standard"
      ? "standardRuntimePerMinuteMinor" : "premiumRuntimePerMinuteMinor"]);
    const runtimeMinor = Math.ceil((seconds - included) * rate / 60);
    const prepaid = Number(reservation.payg_applied_minor ?? 0);
    const metadata = { settlementMeterKey: "subscription_charge_minor", includedRuntimeSeconds: included };
    const hasLedger = (type: string) => recorded.has(JSON.stringify([type, reservation.session_id]));
    if (!hasLedger("runtime_charge")) rows.push({ entry_type: "runtime_charge", unit: "second",
      quantity: seconds, customer_amount_minor: Math.max(0, runtimeMinor - prepaid),
      metadata: { ...metadata, billingClass: `${reservation.meter_class}_runtime_seconds` } });
    if (reservation.billing_mode === "platform_managed" && !hasLedger("telephony_charge")) {
      rows.push({ entry_type: "telephony_charge", unit: "connected_second",
        quantity: Number(reservation.actual_provider_connected_seconds),
        customer_amount_minor: Math.ceil(Number(reservation.actual_provider_connected_seconds) / 60)
          * Number(reservation.route_rate_minor_per_minute) - Math.max(0, prepaid - runtimeMinor),
        metadata: { ...metadata, billingClass: "platform_telephony_charge_minor" } });
    }
  }
  return rows;
}

export function subscriptionCycleUsage(rows: UsageRow[], plan: {
  standardIncludedSeconds: number;
  premiumIncludedSeconds: number;
  standardRuntimeRateMinor: number;
  premiumRuntimeRateMinor: number;
}) {
  if (rows.some((row) => row.metadata.settlementMeterKey === "subscription_charge_minor"
    && (row.customer_amount_minor == null || !Number.isSafeInteger(Number(row.customer_amount_minor))
      || Number(row.customer_amount_minor) < 0))) {
    throw new Error("Subscription usage settlement is invalid.");
  }
  let overageMinor = 0;
  const seconds = { standard: 0, premium: 0 };
  for (const meter of ["standard", "premium"] as const) {
    const runtime = rows.filter((row) => row.entry_type === "runtime_charge"
      && row.unit === "second" && row.metadata.billingClass === `${meter}_runtime_seconds`);
    seconds[meter] = runtime.reduce((total, row) => total + Number(row.quantity), 0);
    const settled = runtime.filter((row) => row.metadata.settlementMeterKey === "subscription_charge_minor");
    const settledSeconds = settled.reduce((total, row) => total + Number(row.quantity), 0);
    const settledIncluded = settled.reduce((total, row) => total + Number(row.metadata.includedRuntimeSeconds), 0);
    const legacyIncluded = Math.max(0, plan[`${meter}IncludedSeconds`] - settledIncluded);
    const legacyBillable = Math.max(0, seconds[meter] - settledSeconds - legacyIncluded);
    overageMinor += Math.ceil(legacyBillable * plan[`${meter}RuntimeRateMinor`] / 60)
      + settled.reduce((total, row) => total + Number(row.customer_amount_minor), 0);
  }
  overageMinor += rows.filter((row) => row.entry_type === "telephony_charge"
    && row.unit === "connected_second" && row.metadata.billingClass === "platform_telephony_charge_minor")
    .reduce((total, row) => total + Number(row.customer_amount_minor ?? 0), 0);
  if (!Number.isSafeInteger(overageMinor) || overageMinor < 0) {
    throw new Error("Subscription usage settlement is invalid.");
  }
  return { standardRuntimeSeconds: seconds.standard, premiumRuntimeSeconds: seconds.premium, overageMinor };
}
