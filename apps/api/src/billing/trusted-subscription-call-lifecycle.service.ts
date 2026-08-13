import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { validatePaygPlatformRoute, type PaygPlatformRouteIdentity } from "./billing-payg-call-charge-policy";

type Database = Pick<Pool, "connect">;
type MeterClass = "standard" | "premium";

interface StartInput {
  organizationId: string;
  reservationKey: string;
  meterClass: MeterClass;
  billingMode: "byo" | "platform_managed";
  provider: string;
  direction: "inbound" | "outbound";
  routeIdentity?: PaygPlatformRouteIdentity | undefined;
  maximumRuntimeSeconds: number;
  expiresAt: string;
  now: string;
}

export class TrustedSubscriptionCallLifecycleService {
  constructor(private readonly database: Database) {}

  async start(input: StartInput) {
    assertStartInput(input);
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const paygCredit = await lockAvailablePaygCredit(
        client,
        input.organizationId,
        input.now,
      );
      const existing = await client.query(
        `select * from billing_subscription_call_reservations
         where tenant_id = $1 and reservation_key = $2 for update`,
        [input.organizationId, input.reservationKey],
      );
      if (existing.rows[0]) {
        const reservation = mapReservation(existing.rows[0]);
        assertActiveReplay(reservation, input.reservationKey);
        if (!matchesStart(reservation, input)) {
          throw new Error(`Subscription reservation key ${input.reservationKey} has different data.`);
        }
        await client.query("commit");
        return { outcome: "reserved" as const, duplicate: true, reservation };
      }

      const state = await readEligibility(client, input);
      if (state === null) {
        await client.query("commit");
        return denied("subscription_state_unavailable");
      }
      const route = resolveRoute(state.catalog, input);
      if (input.billingMode === "platform_managed" && route === null) {
        await client.query("commit");
        return denied("route_unavailable");
      }

      const expiredPaygMinor = await expireActiveReservations(
        client,
        input.organizationId,
        input.now,
        { cycleId: state.cycleId, meterClass: input.meterClass },
      );
      const availablePaygMinor = paygCredit.availableMinor + expiredPaygMinor;
      const retry = await client.query(
        `select * from billing_subscription_call_reservations
         where tenant_id = $1 and reservation_key = $2`,
        [input.organizationId, input.reservationKey],
      );
      if (retry.rows[0]) {
        const reservation = mapReservation(retry.rows[0]);
        assertActiveReplay(reservation, input.reservationKey);
        if (!matchesStart(reservation, input)) {
          throw new Error(`Subscription reservation key ${input.reservationKey} has different data.`);
        }
        await client.query("commit");
        return { outcome: "reserved" as const, duplicate: true, reservation };
      }
      const active = await client.query(
        `select reserved_included_seconds, reserved_overage_minor
         from billing_subscription_call_reservations
         where tenant_id = $1 and cycle_id = $2 and meter_class = $3 and status = 'active'`,
        [input.organizationId, state.cycleId, input.meterClass],
      );
      const activeIncluded = sum(active.rows, "reserved_included_seconds");
      const activeOverage = sum(active.rows, "reserved_overage_minor");
      const globalActive = await client.query(
        `select reserved_overage_minor
         from billing_subscription_call_reservations
         where tenant_id = $1 and cycle_id = $2 and status = 'active'`,
        [input.organizationId, state.cycleId],
      );
      const globalActiveOverage = sum(globalActive.rows, "reserved_overage_minor");
      await client.query(
        `update billing_subscription_reservation_accounts
         set reserved_included_seconds = $4, reserved_overage_minor = $5, updated_at = $6
         where tenant_id = $1 and cycle_id = $2 and meter_class = $3`,
        [input.organizationId, state.cycleId, input.meterClass, activeIncluded, activeOverage, input.now],
      );

      const actualUsage = await readActualUsage(client, input, state);
      const actualSeconds = input.meterClass === "standard"
        ? actualUsage.standardRuntimeSeconds
        : actualUsage.premiumRuntimeSeconds;
      const includedRemaining = Math.max(0, state.includedSeconds - actualSeconds);
      const actualOverageMinor = priceSeconds(
        Math.max(0, actualUsage.standardRuntimeSeconds - state.standardIncludedSeconds),
        state.standardRuntimeRateMinor,
      ) + priceSeconds(
        Math.max(0, actualUsage.premiumRuntimeSeconds - state.premiumIncludedSeconds),
        state.premiumRuntimeRateMinor,
      ) + actualUsage.platformTelephonyMinor;
      const effectiveOverageRemaining = Math.max(
        0,
        Math.min(state.tenantOverageMinor, state.platformRiskMinor) - actualOverageMinor,
      );
      const requestedIncluded = Math.min(
        input.maximumRuntimeSeconds,
        Math.max(0, includedRemaining - activeIncluded),
      );
      const reservedTelephonyMinor = route === null ? 0
        : Math.ceil(input.maximumRuntimeSeconds / 60) * route.customerRateMinorPerMinute;
      const requestedChargeMinor = priceSeconds(
        input.maximumRuntimeSeconds - requestedIncluded,
        state.runtimeRateMinor,
      ) + reservedTelephonyMinor;
      const requestedPaygMinor = Math.min(requestedChargeMinor, availablePaygMinor);
      const requestedOverageMinor = requestedChargeMinor - requestedPaygMinor;
      if (requestedOverageMinor > Math.max(0, effectiveOverageRemaining - globalActiveOverage)) {
        await client.query("commit");
        const reservation = await findConcurrentReplay(client, input);
        if (reservation !== null) {
          return { outcome: "reserved" as const, duplicate: true, reservation };
        }
        return denied("insufficient_subscription_allowance");
      }

      const globalOverageClaim = await client.query(
        `update billing_subscription_overage_accounts
         set reserved_overage_minor = reserved_overage_minor + $3, updated_at = $4
         where tenant_id = $1 and cycle_id = $2
           and reserved_overage_minor + $3 <= $5
         returning tenant_id`,
        [input.organizationId, state.cycleId, requestedOverageMinor,
          input.now, effectiveOverageRemaining],
      );
      if (globalOverageClaim.rowCount !== 1) {
        await client.query("commit");
        const reservation = await findConcurrentReplay(client, input);
        if (reservation !== null) {
          return { outcome: "reserved" as const, duplicate: true, reservation };
        }
        return denied("insufficient_subscription_allowance");
      }

      const claim = await client.query(
        `update billing_subscription_reservation_accounts
         set reserved_included_seconds = reserved_included_seconds + $4,
             reserved_overage_minor = reserved_overage_minor + $5,
             updated_at = $6
         where tenant_id = $1 and cycle_id = $2 and meter_class = $3
           and reserved_included_seconds + $4 <= $7
           and reserved_overage_minor + $5 <= $8
         returning tenant_id`,
        [
          input.organizationId,
          state.cycleId,
          input.meterClass,
          requestedIncluded,
          requestedOverageMinor,
          input.now,
          includedRemaining,
          effectiveOverageRemaining,
        ],
      );
      if (claim.rows.length !== 1) {
        await releaseGlobalOverageClaim(client, input.organizationId, state.cycleId,
          requestedOverageMinor, input.now);
        const concurrentRetry = await client.query(
          `select * from billing_subscription_call_reservations
           where tenant_id = $1 and reservation_key = $2`,
          [input.organizationId, input.reservationKey],
        );
        if (concurrentRetry.rows[0]) {
          const reservation = mapReservation(concurrentRetry.rows[0]);
          assertActiveReplay(reservation, input.reservationKey);
          if (!matchesStart(reservation, input)) {
            throw new Error(`Subscription reservation key ${input.reservationKey} has different data.`);
          }
          await client.query("commit");
          return { outcome: "reserved" as const, duplicate: true, reservation };
        }
        await client.query("commit");
        const committedRetry = await client.query(
          `select * from billing_subscription_call_reservations
           where tenant_id = $1 and reservation_key = $2`,
          [input.organizationId, input.reservationKey],
        );
        if (committedRetry.rows[0]) {
          const reservation = mapReservation(committedRetry.rows[0]);
          assertActiveReplay(reservation, input.reservationKey);
          if (!matchesStart(reservation, input)) {
            throw new Error(`Subscription reservation key ${input.reservationKey} has different data.`);
          }
          return { outcome: "reserved" as const, duplicate: true, reservation };
        }
        return denied("insufficient_subscription_allowance");
      }
      const paygClaim = await client.query(
        `update billing_reservation_accounts
         set reserved_amount_minor = reserved_amount_minor + $2, updated_at = $3
         where tenant_id = $1 and reserved_amount_minor + $2 <= $4
         returning tenant_id`,
        [input.organizationId, requestedPaygMinor, input.now, paygCredit.balanceMinor],
      );
      if (paygClaim.rows.length !== 1) {
        throw new Error("Subscription PAYG credit claim changed during reservation.");
      }

      const reservation = {
        id: randomUUID(), organizationId: input.organizationId,
        reservationKey: input.reservationKey, subscriptionId: state.subscriptionId,
        cycleId: state.cycleId, catalogId: state.catalogId, planSlug: state.planSlug,
        meterClass: input.meterClass, status: "active" as const,
        reservedSeconds: input.maximumRuntimeSeconds,
        reservedIncludedSeconds: requestedIncluded,
        reservedPaygMinor: requestedPaygMinor,
        reservedOverageMinor: requestedOverageMinor,
        billingMode: input.billingMode, provider: input.provider, direction: input.direction,
        ...(route === null ? {} : { routeIdentity: route.identity, routeRateId: route.identity.rateId, routeRateMinorPerMinute: route.customerRateMinorPerMinute }),
        reservedTelephonyMinor,
        expiresAt: input.expiresAt, createdAt: input.now, updatedAt: input.now,
      };
      await client.query(
        `insert into billing_subscription_call_reservations (
           tenant_id, id, reservation_key, subscription_id, cycle_id, catalog_id, plan_slug,
           meter_class, status, reserved_seconds, reserved_included_seconds, reserved_payg_minor, reserved_overage_minor,
           billing_mode, provider, direction, route_rate_id, route_identity, route_rate_minor_per_minute,
           reserved_telephony_minor, expires_at, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21,$21)`,
        [input.organizationId, reservation.id, input.reservationKey, state.subscriptionId,
          state.cycleId, state.catalogId, state.planSlug, input.meterClass,
          input.maximumRuntimeSeconds, requestedIncluded, requestedPaygMinor, requestedOverageMinor,
          input.billingMode, input.provider, input.direction, route?.identity.rateId ?? null,
          route === null ? null : JSON.stringify(route.identity), route?.customerRateMinorPerMinute ?? null,
          reservedTelephonyMinor, input.expiresAt, input.now],
      );
      await client.query("commit");
      return { outcome: "reserved" as const, duplicate: false, reservation };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizeByReservationKey(input: {
    organizationId: string; reservationKey: string; sessionId: string;
    actualSeconds: number; providerConnectedSeconds?: number | undefined;
    outcome?: "completed" | "transferred" | "failed" | undefined; now: string;
  }) {
    const client = await this.database.connect();
    let reservationId: string | undefined;
    try {
      const result = await client.query(
        `select id from billing_subscription_call_reservations
         where tenant_id = $1 and reservation_key = $2`,
        [input.organizationId, input.reservationKey],
      );
      reservationId = result.rows[0]?.id === undefined ? undefined : String(result.rows[0].id);
      if (reservationId === undefined) {
        throw new Error(`Subscription reservation ${input.reservationKey} was not found.`);
      }
    } finally {
      client.release();
    }
    return this.finalize({
      organizationId: input.organizationId,
      reservationId,
      sessionId: input.sessionId,
      actualSeconds: input.actualSeconds,
      outcome: input.outcome ?? "completed",
      ...(input.providerConnectedSeconds === undefined ? {} : { providerConnectedSeconds: input.providerConnectedSeconds }),
      now: input.now,
    });
  }

  async getReservationByKey(organizationId: string, reservationKey: string) {
    const client = await this.database.connect();
    try {
      const result = await client.query(
        `select * from billing_subscription_call_reservations
         where tenant_id = $1 and reservation_key = $2`,
        [organizationId, reservationKey],
      );
      return result.rows[0] === undefined ? null : mapReservation(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async releaseByReservationKey(input: {
    organizationId: string;
    reservationKey: string;
    now: string;
  }) {
    const client = await this.database.connect();
    try {
      await client.query("begin");
      await lockAvailablePaygCredit(client, input.organizationId, input.now);
      const result = await client.query(
        `select * from billing_subscription_call_reservations
         where tenant_id = $1 and reservation_key = $2 for update`,
        [input.organizationId, input.reservationKey],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error(`Subscription reservation ${input.reservationKey} was not found.`);
      }
      if (row.status === "expired") {
        await client.query("commit");
        return { outcome: "released" as const, duplicate: true };
      }
      if (row.status !== "active") {
        throw new Error(`Subscription reservation ${input.reservationKey} cannot be released.`);
      }
      const account = await client.query(
        `update billing_subscription_reservation_accounts
         set reserved_included_seconds = reserved_included_seconds - $4,
             reserved_overage_minor = reserved_overage_minor - $5,
             updated_at = $6
         where tenant_id = $1 and cycle_id = $2 and meter_class = $3
           and reserved_included_seconds >= $4 and reserved_overage_minor >= $5
         returning tenant_id`,
        [input.organizationId, row.cycle_id, row.meter_class,
          row.reserved_included_seconds, row.reserved_overage_minor, input.now],
      );
      if (account.rowCount !== 1) {
        throw new Error("Subscription reservation account is inconsistent.");
      }
      await releaseGlobalOverageClaim(client, input.organizationId, String(row.cycle_id),
        Number(row.reserved_overage_minor), input.now);
      await releasePaygClaim(client, input.organizationId, Number(row.reserved_payg_minor ?? 0), input.now);
      const released = await client.query(
        `update billing_subscription_call_reservations
         set status = 'expired', expires_at = $3, updated_at = $3
         where tenant_id = $1 and id = $2 and status = 'active'
         returning id`,
        [input.organizationId, row.id, input.now],
      );
      if (released.rowCount !== 1) {
        throw new Error("Subscription reservation release lost its claim.");
      }
      await client.query("commit");
      return { outcome: "released" as const, duplicate: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async finalize(input: { organizationId: string; reservationId: string; sessionId: string; actualSeconds: number; providerConnectedSeconds?: number | undefined; outcome?: "completed" | "transferred" | "failed" | undefined; now: string }) {
    if (!Number.isSafeInteger(input.actualSeconds) || input.actualSeconds < 0) throw new Error("Actual seconds are invalid.");
    const client = await this.database.connect();
    try {
      await client.query("begin");
      await lockAvailablePaygCredit(client, input.organizationId, input.now);
      const result = await client.query(
        `select * from billing_subscription_call_reservations where tenant_id = $1 and id = $2 for update`,
        [input.organizationId, input.reservationId],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`Subscription reservation ${input.reservationId} was not found.`);
      if (row.status === "finalized") {
        const outcome = input.outcome ?? "completed";
        if (Number(row.actual_seconds) !== input.actualSeconds || row.session_id !== input.sessionId
          || row.terminal_outcome !== outcome
          || (row.billing_mode === "platform_managed" && Number(row.actual_provider_connected_seconds) !== input.providerConnectedSeconds)) throw new Error("Subscription reservation was finalized with different data.");
        const paygAppliedMinor = await readAppliedPaygMinor(
          client,
          input.organizationId,
          input.reservationId,
        );
        await client.query("commit");
        return { outcome: "finalized" as const, duplicate: true, paygAppliedMinor };
      }
      if (row.status !== "active" || input.actualSeconds > Number(row.reserved_seconds)) throw new Error("Subscription reservation cannot be finalized.");
      const connectedSeconds = row.billing_mode === "platform_managed" ? input.providerConnectedSeconds : 0;
      if (!Number.isSafeInteger(connectedSeconds) || Number(connectedSeconds) < 0 || Number(connectedSeconds) > Number(row.reserved_seconds)) throw new Error("Trusted provider-connected seconds are invalid.");
      const accountUpdate = await client.query(
        `update billing_subscription_reservation_accounts
         set reserved_included_seconds = reserved_included_seconds - $4,
             reserved_overage_minor = reserved_overage_minor - $5, updated_at = $6
         where tenant_id = $1 and cycle_id = $2 and meter_class = $3
           and reserved_included_seconds >= $4 and reserved_overage_minor >= $5
         returning tenant_id`,
        [input.organizationId, row.cycle_id, row.meter_class, row.reserved_included_seconds, row.reserved_overage_minor, input.now],
      );
      if (accountUpdate.rowCount !== 1) throw new Error("Subscription reservation account is inconsistent.");
      await releaseGlobalOverageClaim(client, input.organizationId, String(row.cycle_id),
        Number(row.reserved_overage_minor), input.now);
      const reservedPaygMinor = Number(row.reserved_payg_minor ?? 0);
      await releasePaygClaim(client, input.organizationId, reservedPaygMinor, input.now);
      const runtimeRateMinor = await readPinnedRuntimeRate(client, row);
      const actualRuntimeMinor = priceSeconds(
        Math.max(0, input.actualSeconds - Math.min(input.actualSeconds, Number(row.reserved_included_seconds))),
        runtimeRateMinor,
      );
      const actualTelephonyMinor = row.billing_mode === "platform_managed"
        ? Math.ceil(Number(connectedSeconds) / 60) * Number(row.route_rate_minor_per_minute)
        : 0;
      const actualPaygMinor = Math.min(
        reservedPaygMinor,
        actualRuntimeMinor + actualTelephonyMinor,
      );
      if (actualPaygMinor > 0) {
        await client.query(
          `insert into billing_payg_credit_entries
             (tenant_id, id, order_id, session_id, entry_type, amount_minor,
              idempotency_key, expires_at, created_at)
           values ($1, $2, null, $3, 'debit', $4, $5, null, $6)`,
          [input.organizationId, `subscription-payg-debit:${input.reservationId}`,
            input.sessionId, actualPaygMinor,
            `subscription-payg:${input.reservationId}:finalize`, input.now],
        );
      }
      const reservationUpdate = await client.query(
        `update billing_subscription_call_reservations set status = 'finalized', actual_seconds = $3,
           session_id = $4, actual_provider_connected_seconds = $6, terminal_outcome = $7,
           finalized_at = $5, updated_at = $5 where tenant_id = $1 and id = $2 and status = 'active'
         returning id`,
        [input.organizationId, input.reservationId, input.actualSeconds, input.sessionId, input.now,
          connectedSeconds, input.outcome ?? "completed"],
      );
      if (reservationUpdate.rowCount !== 1) throw new Error("Subscription reservation finalization lost its claim.");
      await client.query("commit");
      return { outcome: "finalized" as const, duplicate: false, paygAppliedMinor: actualPaygMinor };
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
}

async function readAppliedPaygMinor(
  client: PoolClient,
  organizationId: string,
  reservationId: string,
) {
  const result = await client.query(
    `select amount_minor from billing_payg_credit_entries
     where tenant_id = $1 and idempotency_key = $2 and entry_type = 'debit'`,
    [organizationId, `subscription-payg:${reservationId}:finalize`],
  );
  if (result.rows.length > 1) {
    throw new Error("Subscription PAYG settlement is inconsistent.");
  }
  const amountMinor = Number(result.rows[0]?.amount_minor ?? 0);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Subscription PAYG settlement is invalid.");
  }
  return amountMinor;
}

async function findConcurrentReplay(client: PoolClient, input: StartInput) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await client.query(
      `select * from billing_subscription_call_reservations
       where tenant_id = $1 and reservation_key = $2`,
      [input.organizationId, input.reservationKey],
    );
    if (result.rows[0] === undefined) continue;
    const reservation = mapReservation(result.rows[0]);
    assertActiveReplay(reservation, input.reservationKey);
    if (!matchesStart(reservation, input)) {
      throw new Error(`Subscription reservation key ${input.reservationKey} has different data.`);
    }
    return reservation;
  }
  return null;
}

async function readEligibility(client: PoolClient, input: StartInput) {
  const subscriptions = await client.query(
    `select id, catalog_id, plan_slug, current_period_end from billing_subscriptions
     where tenant_id = $1 and status in ('active','trialing') and current_period_end > $2`,
    [input.organizationId, input.now],
  );
  const cycles = await client.query(
    `select id, catalog_id, starts_at, ends_at from billing_cycles
     where tenant_id = $1 and status = 'active' and starts_at <= $2 and ends_at > $2`,
    [input.organizationId, input.now],
  );
  const entitlements = await client.query(
    `select key from billing_entitlements where tenant_id = $1 and key = 'runtime_access' and status = 'active'`,
    [input.organizationId],
  );
  const policy = await client.query(`select currency, overage_limit_minor from billing_budget_policies where tenant_id = $1`, [input.organizationId]);
  const risk = await client.query(`select currency, overage_limit_minor from billing_platform_risk_limits where tenant_id = $1`, [input.organizationId]);
  if (subscriptions.rows.length !== 1 || cycles.rows.length !== 1 || entitlements.rows.length !== 1 || policy.rows.length !== 1 || risk.rows.length !== 1) return null;
  const subscription = subscriptions.rows[0];
  const cycle = cycles.rows[0];
  if (!subscription.plan_slug || subscription.catalog_id !== cycle.catalog_id
    || !isUtcCalendarDayBoundary(subscription.current_period_end)
    || Date.parse(String(subscription.current_period_end)) !== Date.parse(String(cycle.ends_at))
    || !isUtcCalendarDayBoundary(cycle.starts_at)
    || !isUtcCalendarDayBoundary(cycle.ends_at)
    || policy.rows[0].currency !== "usd" || risk.rows[0].currency !== "usd") return null;
  const catalogResult = await client.query(`select catalog_document from billing_price_catalogs where id = $1`, [subscription.catalog_id]);
  if (catalogResult.rows.length !== 1) return null;
  const catalog = catalogResult.rows[0].catalog_document as Record<string, unknown>;
  const plan = (catalog.plans as Record<string, Record<string, unknown>> | undefined)?.[subscription.plan_slug];
  const standardIncludedSeconds = plan?.includedStandardRuntimeSeconds;
  const premiumIncludedSeconds = plan?.includedPremiumRuntimeSeconds;
  const standardRuntimeRateMinor = plan?.standardRuntimePerMinuteMinor;
  const premiumRuntimeRateMinor = plan?.premiumRuntimePerMinuteMinor;
  if (!Number.isSafeInteger(standardIncludedSeconds) || Number(standardIncludedSeconds) < 0
    || !Number.isSafeInteger(premiumIncludedSeconds) || Number(premiumIncludedSeconds) < 0
    || !Number.isSafeInteger(standardRuntimeRateMinor) || Number(standardRuntimeRateMinor) <= 0
    || !Number.isSafeInteger(premiumRuntimeRateMinor) || Number(premiumRuntimeRateMinor) <= 0) return null;
  const includedSeconds = input.meterClass === "standard"
    ? Number(standardIncludedSeconds) : Number(premiumIncludedSeconds);
  const runtimeRateMinor = input.meterClass === "standard"
    ? Number(standardRuntimeRateMinor) : Number(premiumRuntimeRateMinor);
  return {
    subscriptionId: String(subscription.id), cycleId: String(cycle.id), catalogId: String(subscription.catalog_id),
    planSlug: String(subscription.plan_slug), cycleStartsAt: cycle.starts_at, cycleEndsAt: cycle.ends_at,
    catalog, includedSeconds: Number(includedSeconds), runtimeRateMinor: Number(runtimeRateMinor),
    standardIncludedSeconds: Number(standardIncludedSeconds),
    premiumIncludedSeconds: Number(premiumIncludedSeconds),
    standardRuntimeRateMinor: Number(standardRuntimeRateMinor),
    premiumRuntimeRateMinor: Number(premiumRuntimeRateMinor),
    tenantOverageMinor: Number(policy.rows[0].overage_limit_minor), platformRiskMinor: Number(risk.rows[0].overage_limit_minor),
  };
}

function isUtcCalendarDayBoundary(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime())
    && date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0;
}

async function readActualUsage(client: PoolClient, input: StartInput, state: Awaited<ReturnType<typeof readEligibility>> & {}) {
  const result = await client.query(
    `select entry_type, quantity, unit, customer_amount_minor, metadata from billing_ledger_entries
     where tenant_id = $1 and catalog_id = $2 and occurred_at >= $3 and occurred_at < $4`,
    [input.organizationId, state.catalogId, state.cycleStartsAt, state.cycleEndsAt],
  );
  return {
    standardRuntimeSeconds: result.rows.filter((row) => row.entry_type === "runtime_charge"
      && row.unit === "second" && row.metadata?.billingClass === "standard_runtime_seconds")
      .reduce((total, row) => total + Number(row.quantity), 0),
    premiumRuntimeSeconds: result.rows.filter((row) => row.entry_type === "runtime_charge"
      && row.unit === "second" && row.metadata?.billingClass === "premium_runtime_seconds")
      .reduce((total, row) => total + Number(row.quantity), 0),
    platformTelephonyMinor: result.rows.filter((row) => row.entry_type === "telephony_charge" && row.unit === "connected_second" && row.metadata?.billingClass === "platform_telephony_charge_minor")
      .reduce((total, row) => total + Number(row.customer_amount_minor ?? 0), 0),
  };
}

async function lockAvailablePaygCredit(
  client: PoolClient,
  organizationId: string,
  now: string,
) {
  await client.query(
    `insert into billing_reservation_accounts (tenant_id, reserved_amount_minor, updated_at)
     values ($1, 0, $2) on conflict (tenant_id) do nothing`,
    [organizationId, now],
  );
  const account = await client.query(
    `select reserved_amount_minor from billing_reservation_accounts
     where tenant_id = $1 for update`,
    [organizationId],
  );
  const credit = await client.query(
    `select coalesce(sum(case
       when entry_type = 'grant' and (expires_at is null or expires_at > $2) then amount_minor
       when entry_type in ('debit', 'reversal') then -amount_minor
       else 0 end), 0) as balance_minor
     from billing_payg_credit_entries where tenant_id = $1`,
    [organizationId, now],
  );
  const balanceMinor = Number(credit.rows[0]?.balance_minor ?? 0);
  const reservedMinor = Number(account.rows[0]?.reserved_amount_minor ?? 0);
  return { balanceMinor, availableMinor: Math.max(0, balanceMinor - reservedMinor) };
}

async function expireActiveReservations(
  client: PoolClient,
  organizationId: string,
  now: string,
  requestedMeter: { cycleId: string; meterClass: MeterClass },
) {
  const expired = await client.query(
    `select reservation.id, reservation.cycle_id, reservation.meter_class,
            reservation.reserved_included_seconds, reservation.reserved_payg_minor,
            reservation.reserved_overage_minor
     from billing_subscription_call_reservations reservation
     where reservation.tenant_id = $1 and reservation.status = 'active' and reservation.expires_at <= $2
       and reservation.reservation_key not in (
         select recovery.reservation_id from billing_terminal_recovery_jobs recovery
         where recovery.tenant_id = $1 and recovery.commercial_mode = 'subscription'
           and recovery.status in ('pending', 'processing', 'dead_letter')
       )
     order by reservation.cycle_id, reservation.meter_class, reservation.id
     for update`,
    [organizationId, now],
  );
  const meterKeys = new Map<string, { cycleId: string; meterClass: MeterClass }>();
  meterKeys.set(
    `${requestedMeter.cycleId}:${requestedMeter.meterClass}`,
    requestedMeter,
  );
  for (const row of expired.rows) {
    const meterClass = row.meter_class as MeterClass;
    const cycleId = String(row.cycle_id);
    meterKeys.set(`${cycleId}:${meterClass}`, { cycleId, meterClass });
  }
  for (const meter of [...meterKeys.values()].sort((left, right) =>
    left.cycleId.localeCompare(right.cycleId)
      || left.meterClass.localeCompare(right.meterClass))) {
    await client.query(
      `insert into billing_subscription_reservation_accounts
         (tenant_id, cycle_id, meter_class, reserved_included_seconds, reserved_overage_minor, updated_at)
       values ($1, $2, $3, 0, 0, $4)
       on conflict (tenant_id, cycle_id, meter_class) do nothing`,
      [organizationId, meter.cycleId, meter.meterClass, now],
    );
    const locked = await client.query(
      `select tenant_id from billing_subscription_reservation_accounts
       where tenant_id = $1 and cycle_id = $2 and meter_class = $3 for update`,
      [organizationId, meter.cycleId, meter.meterClass],
    );
    if (locked.rowCount !== 1) {
      throw new Error("Subscription reservation account is unavailable.");
    }
  }
  const cycleIds = [...new Set([...meterKeys.values()].map((meter) => meter.cycleId))].sort();
  for (const cycleId of cycleIds) {
    await client.query(
      `insert into billing_subscription_overage_accounts
         (tenant_id, cycle_id, reserved_overage_minor, updated_at)
       values ($1, $2, 0, $3)
       on conflict (tenant_id, cycle_id) do nothing`,
      [organizationId, cycleId, now],
    );
    const locked = await client.query(
      `select tenant_id from billing_subscription_overage_accounts
       where tenant_id = $1 and cycle_id = $2 for update`,
      [organizationId, cycleId],
    );
    if (locked.rowCount !== 1) {
      throw new Error("Subscription global overage account is unavailable.");
    }
  }
  let releasedPaygMinor = 0;
  const releasedOverageByCycle = new Map<string, number>();
  for (const row of expired.rows) {
    const account = await client.query(
      `update billing_subscription_reservation_accounts
       set reserved_included_seconds = reserved_included_seconds - $4,
           reserved_overage_minor = reserved_overage_minor - $5,
           updated_at = $6
       where tenant_id = $1 and cycle_id = $2 and meter_class = $3
         and reserved_included_seconds >= $4 and reserved_overage_minor >= $5
       returning tenant_id`,
      [organizationId, row.cycle_id, row.meter_class,
        Number(row.reserved_included_seconds), Number(row.reserved_overage_minor), now],
    );
    if (account.rowCount !== 1) {
      throw new Error("Subscription reservation account is inconsistent.");
    }
    releasedPaygMinor += Number(row.reserved_payg_minor ?? 0);
    const cycleId = String(row.cycle_id);
    releasedOverageByCycle.set(cycleId,
      (releasedOverageByCycle.get(cycleId) ?? 0) + Number(row.reserved_overage_minor));
    const updated = await client.query(
      `update billing_subscription_call_reservations
       set status = 'expired', updated_at = $3
       where tenant_id = $1 and id = $2 and status = 'active'
       returning id`,
      [organizationId, row.id, now],
    );
    if (updated.rowCount !== 1) {
      throw new Error("Subscription expired reservation row is inconsistent.");
    }
  }
  for (const [cycleId, reservedOverageMinor] of releasedOverageByCycle) {
    await releaseGlobalOverageClaim(client, organizationId, cycleId, reservedOverageMinor, now);
  }
  await releasePaygClaim(client, organizationId, releasedPaygMinor, now);
  return releasedPaygMinor;
}

async function releaseGlobalOverageClaim(
  client: PoolClient,
  organizationId: string,
  cycleId: string,
  reservedOverageMinor: number,
  now: string,
) {
  if (reservedOverageMinor === 0) return;
  const released = await client.query(
    `update billing_subscription_overage_accounts
     set reserved_overage_minor = reserved_overage_minor - $3, updated_at = $4
     where tenant_id = $1 and cycle_id = $2 and reserved_overage_minor >= $3
     returning tenant_id`,
    [organizationId, cycleId, reservedOverageMinor, now],
  );
  if (released.rowCount !== 1) {
    throw new Error("Subscription global overage account is inconsistent.");
  }
}

async function releasePaygClaim(
  client: PoolClient,
  organizationId: string,
  reservedPaygMinor: number,
  now: string,
) {
  if (reservedPaygMinor === 0) return;
  const released = await client.query(
    `update billing_reservation_accounts
     set reserved_amount_minor = reserved_amount_minor - $2, updated_at = $3
     where tenant_id = $1 and reserved_amount_minor >= $2
     returning tenant_id`,
    [organizationId, reservedPaygMinor, now],
  );
  if (released.rowCount !== 1) {
    throw new Error("Subscription PAYG reservation account is inconsistent.");
  }
}

async function readPinnedRuntimeRate(client: PoolClient, row: Record<string, unknown>) {
  const catalog = await client.query(
    `select catalog_document from billing_price_catalogs where id = $1`,
    [row.catalog_id],
  );
  const document = catalog.rows[0]?.catalog_document as Record<string, unknown> | undefined;
  const plan = (document?.plans as Record<string, Record<string, unknown>> | undefined)?.[String(row.plan_slug)];
  const rate = plan?.[`${String(row.meter_class)}RuntimePerMinuteMinor`];
  if (!Number.isSafeInteger(rate) || Number(rate) <= 0) {
    throw new Error("Pinned subscription runtime rate is unavailable.");
  }
  return Number(rate);
}

function resolveRoute(catalog: Record<string, unknown>, input: StartInput) {
  if (input.billingMode === "byo") return null;
  const routeIdentity = input.routeIdentity;
  if (routeIdentity === undefined) return null;
  try {
    return validatePaygPlatformRoute({ catalogDocument: catalog, provider: input.provider,
      direction: input.direction, routeIdentity });
  } catch { return null; }
}
function priceSeconds(seconds: number, perMinuteMinor: number) { return seconds === 0 ? 0 : Math.ceil(seconds * perMinuteMinor / 60); }
function sum(rows: Record<string, unknown>[], key: string) { return rows.reduce((total, row) => total + Number(row[key]), 0); }
function denied(reason: "subscription_state_unavailable" | "route_unavailable" | "platform_telephony_reservation_unavailable" | "insufficient_subscription_allowance") { return { outcome: "denied" as const, reason }; }
function mapReservation(row: Record<string, unknown>) { return { id: String(row.id), organizationId: String(row.tenant_id), reservationKey: String(row.reservation_key), subscriptionId: String(row.subscription_id), cycleId: String(row.cycle_id), catalogId: String(row.catalog_id), planSlug: String(row.plan_slug), meterClass: row.meter_class as MeterClass, billingMode: row.billing_mode as StartInput["billingMode"], provider: String(row.provider), direction: row.direction as StartInput["direction"], ...(row.route_rate_id == null ? {} : { routeIdentity: row.route_identity as unknown as PaygPlatformRouteIdentity, routeRateId: String(row.route_rate_id), routeRateMinorPerMinute: Number(row.route_rate_minor_per_minute) }), status: row.status as "active" | "expired" | "finalized", ...(row.terminal_outcome == null ? {} : { terminalOutcome: row.terminal_outcome as "completed" | "transferred" | "failed" }), reservedSeconds: Number(row.reserved_seconds), reservedIncludedSeconds: Number(row.reserved_included_seconds), reservedPaygMinor: Number(row.reserved_payg_minor ?? 0), reservedOverageMinor: Number(row.reserved_overage_minor), reservedTelephonyMinor: Number(row.reserved_telephony_minor), expiresAt: new Date(String(row.expires_at)).toISOString(), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() }; }
function assertActiveReplay(reservation: ReturnType<typeof mapReservation>, reservationKey: string) { if (reservation.status !== "active") throw new Error(`Subscription reservation key ${reservationKey} has status ${reservation.status} and cannot be reused.`); }
function matchesStart(reservation: ReturnType<typeof mapReservation>, input: StartInput) { return reservation.meterClass === input.meterClass && reservation.billingMode === input.billingMode && reservation.provider === input.provider && reservation.direction === input.direction && JSON.stringify(reservation.routeIdentity) === JSON.stringify(input.routeIdentity) && reservation.reservedSeconds === input.maximumRuntimeSeconds && reservation.expiresAt === new Date(input.expiresAt).toISOString(); }
function assertStartInput(input: StartInput) { if (!input.organizationId || !input.reservationKey || !Number.isSafeInteger(input.maximumRuntimeSeconds) || input.maximumRuntimeSeconds <= 0 || !(new Date(input.expiresAt) > new Date(input.now))) throw new Error("Subscription reservation input is invalid."); }
