import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  normalizePaygCallChargeContext,
  type PaygCallChargeContext,
} from "./billing-payg-call-charge-policy";

type TransactionalDatabase = Pick<Pool, "query" | "connect">;

export interface BillingChargeReservation {
  id: string;
  organizationId: string;
  reservationKey: string;
  catalogId?: string | undefined;
  chargeContext?: PaygCallChargeContext | undefined;
  fundingSource: "payg_credit";
  status: "active" | "expired" | "finalized" | "released";
  reservedAmountMinor: number;
  actualAmountMinor?: number | undefined;
  sessionId?: string | undefined;
  terminalOutcome?: "completed" | "transferred" | "failed" | undefined;
  currency: "usd";
  expiresAt: string;
  finalizedAt?: string | undefined;
  releasedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export class BillingChargeReservationRepository {
  constructor(private readonly database: TransactionalDatabase) {}

  async reservePaygCredit(input: {
    id: string;
    organizationId: string;
    reservationKey: string;
    catalogId: string;
    chargeContext: PaygCallChargeContext;
    amountMinor: number;
    currency: "usd";
    expiresAt: string;
    now: string;
  }) {
    assertReservationInput(input);
    const client = await this.database.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into billing_reservation_accounts (
           tenant_id, reserved_amount_minor, updated_at
         ) values ($1, 0, $2)
         on conflict (tenant_id) do nothing`,
        [input.organizationId, input.now],
      );
      await client.query(
        `select tenant_id from billing_reservation_accounts
         where tenant_id = $1 for update`,
        [input.organizationId],
      );
      await expireReservationsUsing(client, input.organizationId, input.now);

      const existing = await findReservationByKey(
        client,
        input.organizationId,
        input.reservationKey,
      );
      const balanceMinor = await readPaygBalanceMinor(
        client,
        input.organizationId,
        input.now,
      );
      if (existing !== null) {
        if (!matchesReservationRequest(existing, input)) {
          throw new Error(
            `Reservation key ${input.reservationKey} already has different data.`,
          );
        }
        await client.query("commit");
        return {
          outcome: "reserved" as const,
          reservation: existing,
          duplicate: true,
          availableMinor: await readAccountAvailableMinor(
            client,
            input.organizationId,
            balanceMinor,
          ),
        };
      }

      const reserveResult = await client.query(
        `update billing_reservation_accounts
         set reserved_amount_minor = reserved_amount_minor + $2, updated_at = $3
         where tenant_id = $1
           and reserved_amount_minor + $2 <= $4
         returning reserved_amount_minor`,
        [input.organizationId, input.amountMinor, input.now, balanceMinor],
      );
      const reservedAfter = reserveResult.rows[0]?.reserved_amount_minor;
      if (reservedAfter === undefined) {
        const availableMinor = await readAccountAvailableMinor(
          client,
          input.organizationId,
          balanceMinor,
        );
        await client.query("commit");
        return {
          outcome: "denied" as const,
          reason: "insufficient_payg_credit" as const,
          availableMinor,
        };
      }

      const reservation = reservationFromInput(input);
      await client.query(
        `insert into billing_charge_reservations (
           tenant_id, id, reservation_key, catalog_id, charge_context, funding_source, status,
           reserved_amount_minor, currency, expires_at, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          reservation.organizationId,
          reservation.id,
          reservation.reservationKey,
          reservation.catalogId,
          JSON.stringify(reservation.chargeContext),
          reservation.fundingSource,
          reservation.status,
          reservation.reservedAmountMinor,
          reservation.currency,
          reservation.expiresAt,
          reservation.createdAt,
          reservation.updatedAt,
        ],
      );
      await client.query(
        "commit",
      );
      return {
        outcome: "reserved" as const,
        reservation,
        duplicate: false,
        availableMinor: balanceMinor - normalizeInteger(reservedAfter),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizePaygCredit(input: {
    organizationId: string;
    reservationId: string;
    sessionId: string;
    actualAmountMinor: number;
    terminalOutcome: "completed" | "transferred" | "failed";
    now: string;
  }) {
    assertFinalizationInput(input);
    const client = await this.database.connect();
    try {
      await client.query("begin");
      await client.query(
        `select tenant_id from billing_reservation_accounts
         where tenant_id = $1 for update`,
        [input.organizationId],
      );
      const reservation = await findReservationById(
        client,
        input.organizationId,
        input.reservationId,
      );
      if (reservation === null) {
        throw new Error(`Billing reservation ${input.reservationId} was not found.`);
      }
      if (reservation.status === "finalized") {
        if (
          reservation.actualAmountMinor !== input.actualAmountMinor
          || reservation.sessionId !== input.sessionId
          || reservation.terminalOutcome !== input.terminalOutcome
        ) {
          throw new Error(
            `Billing reservation ${input.reservationId} was finalized with different data.`,
          );
        }
        const balanceMinor = await readPaygBalanceMinor(
          client,
          input.organizationId,
          input.now,
        );
        const availableMinor = await readAccountAvailableMinor(
          client,
          input.organizationId,
          balanceMinor,
        );
        await client.query("commit");
        return finalizationResult(reservation, true, availableMinor);
      }
      if (reservation.status !== "active") {
        throw new Error(`Billing reservation ${input.reservationId} is not active.`);
      }
      if (input.actualAmountMinor > reservation.reservedAmountMinor) {
        throw new Error("Actual PAYG usage cannot exceed the reserved amount.");
      }

      const accountResult = await client.query(
        `update billing_reservation_accounts
         set reserved_amount_minor = reserved_amount_minor - $2, updated_at = $3
         where tenant_id = $1 and reserved_amount_minor >= $2
         returning reserved_amount_minor`,
        [input.organizationId, reservation.reservedAmountMinor, input.now],
      );
      if (accountResult.rows.length !== 1) {
        throw new Error(`Billing reservation ${input.reservationId} has no active claim.`);
      }
      await client.query(
        `insert into billing_payg_credit_entries (
           tenant_id, id, order_id, session_id, entry_type, amount_minor,
           idempotency_key, expires_at, created_at
         ) values ($1, $2, null, $3, 'debit', $4, $5, null, $6)`,
        [
          input.organizationId,
          paygDebitId(input.reservationId),
          input.sessionId,
          input.actualAmountMinor,
          paygDebitIdempotencyKey(input.reservationId),
          input.now,
        ],
      );
      await client.query(
        `update billing_charge_reservations
         set status = 'finalized', actual_amount_minor = $3, session_id = $4,
             terminal_outcome = $5,
             finalized_at = $6, updated_at = $6
         where tenant_id = $1 and id = $2 and status = 'active'`,
        [
          input.organizationId,
          input.reservationId,
          input.actualAmountMinor,
          input.sessionId,
          input.terminalOutcome,
          input.now,
        ],
      );
      const balanceMinor = await readPaygBalanceMinor(
        client,
        input.organizationId,
        input.now,
      );
      const availableMinor = await readAccountAvailableMinor(
        client,
        input.organizationId,
        balanceMinor,
      );
      await client.query("commit");
      return finalizationResult({
        ...reservation,
        status: "finalized",
        actualAmountMinor: input.actualAmountMinor,
        sessionId: input.sessionId,
        terminalOutcome: input.terminalOutcome,
        finalizedAt: input.now,
        updatedAt: input.now,
      }, false, availableMinor);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async releasePaygCredit(input: {
    organizationId: string;
    reservationId: string;
    now: string;
    terminalOutcome?: "completed" | "transferred" | "failed" | undefined;
  }) {
    assertReleaseInput(input);
    const client = await this.database.connect();
    try {
      await client.query("begin");
      await client.query(
        `select tenant_id from billing_reservation_accounts
         where tenant_id = $1 for update`,
        [input.organizationId],
      );
      const reservation = await findReservationById(
        client,
        input.organizationId,
        input.reservationId,
      );
      if (reservation === null) {
        throw new Error(`Billing reservation ${input.reservationId} was not found.`);
      }
      if (reservation.status === "released") {
        if (input.terminalOutcome !== undefined
          && reservation.terminalOutcome !== input.terminalOutcome) {
          throw new Error(
            `Billing reservation ${input.reservationId} was released with different terminal data.`,
          );
        }
        const balanceMinor = await readPaygBalanceMinor(
          client,
          input.organizationId,
          input.now,
        );
        const availableMinor = await readAccountAvailableMinor(
          client,
          input.organizationId,
          balanceMinor,
        );
        await client.query("commit");
        return releaseResult(reservation, true, availableMinor);
      }
      if (reservation.status !== "active") {
        throw new Error(`Billing reservation ${input.reservationId} is not active.`);
      }

      const accountResult = await client.query(
        `update billing_reservation_accounts
         set reserved_amount_minor = reserved_amount_minor - $2, updated_at = $3
         where tenant_id = $1 and reserved_amount_minor >= $2
         returning reserved_amount_minor`,
        [input.organizationId, reservation.reservedAmountMinor, input.now],
      );
      if (accountResult.rows[0]?.reserved_amount_minor === undefined) {
        throw new Error(`Billing reservation ${input.reservationId} has no active claim.`);
      }
      await client.query(
        `update billing_charge_reservations
         set status = 'released', terminal_outcome = $3, released_at = $4, updated_at = $4
         where tenant_id = $1 and id = $2 and status = 'active'`,
        [input.organizationId, input.reservationId, input.terminalOutcome ?? null, input.now],
      );
      const balanceMinor = await readPaygBalanceMinor(
        client,
        input.organizationId,
        input.now,
      );
      const availableMinor = await readAccountAvailableMinor(
        client,
        input.organizationId,
        balanceMinor,
      );
      await client.query("commit");
      return releaseResult({
        ...reservation,
        status: "released",
        ...(input.terminalOutcome === undefined ? {} : { terminalOutcome: input.terminalOutcome }),
        releasedAt: input.now,
        updatedAt: input.now,
      }, false, availableMinor);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listReservations(organizationId: string): Promise<BillingChargeReservation[]> {
    const result = await this.database.query(
      `select tenant_id, id, reservation_key, catalog_id, charge_context, funding_source, status,
              reserved_amount_minor, actual_amount_minor, session_id, terminal_outcome, currency,
              expires_at, finalized_at, released_at, created_at, updated_at
       from billing_charge_reservations
       where tenant_id = $1
       order by created_at asc, id asc`,
      [organizationId],
    );
    return result.rows.map(mapReservation);
  }

  async getReservation(organizationId: string, reservationId: string) {
    const result = await this.database.query(
      `select tenant_id, id, reservation_key, catalog_id, charge_context, funding_source, status,
              reserved_amount_minor, actual_amount_minor, session_id, terminal_outcome, currency,
              expires_at, finalized_at, released_at, created_at, updated_at
       from billing_charge_reservations
       where tenant_id = $1 and id = $2`,
      [organizationId, reservationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapReservation(row);
  }
}

function matchesReservationRequest(
  reservation: BillingChargeReservation,
  input: {
    id: string;
    organizationId: string;
    reservationKey: string;
    catalogId: string;
    chargeContext: PaygCallChargeContext;
    amountMinor: number;
    currency: "usd";
    expiresAt: string;
  },
) {
  return reservation.status === "active"
    && reservation.organizationId === input.organizationId
    && reservation.reservationKey === input.reservationKey
    && reservation.catalogId === input.catalogId
    && JSON.stringify(reservation.chargeContext) === JSON.stringify(
      normalizePaygCallChargeContext(input.chargeContext),
    )
    && reservation.reservedAmountMinor === input.amountMinor
    && reservation.currency === input.currency
    && reservation.expiresAt === input.expiresAt;
}

async function findReservationByKey(
  client: PoolClient,
  organizationId: string,
  reservationKey: string,
) {
  const result = await client.query(
    `select tenant_id, id, reservation_key, catalog_id, charge_context, funding_source, status,
            reserved_amount_minor, actual_amount_minor, session_id, terminal_outcome, currency,
            expires_at, finalized_at, released_at, created_at, updated_at
     from billing_charge_reservations
     where tenant_id = $1 and reservation_key = $2`,
    [organizationId, reservationKey],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapReservation(row);
}

async function findReservationById(
  client: PoolClient,
  organizationId: string,
  reservationId: string,
) {
  const result = await client.query(
    `select tenant_id, id, reservation_key, catalog_id, charge_context, funding_source, status,
            reserved_amount_minor, actual_amount_minor, session_id, terminal_outcome, currency,
            expires_at, finalized_at, released_at, created_at, updated_at
     from billing_charge_reservations
     where tenant_id = $1 and id = $2`,
    [organizationId, reservationId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapReservation(row);
}

async function readPaygBalanceMinor(
  client: PoolClient,
  organizationId: string,
  now: string,
) {
  const result = await client.query(
    `select coalesce(sum(case
       when entry_type = 'grant' and (expires_at is null or expires_at > $2) then amount_minor
       when entry_type in ('debit', 'reversal') then -amount_minor
       else 0 end), 0) as balance_minor
     from billing_payg_credit_entries where tenant_id = $1`,
    [organizationId, now],
  );
  return normalizeInteger(result.rows[0]?.balance_minor ?? 0);
}

async function readAccountAvailableMinor(
  client: PoolClient,
  organizationId: string,
  balanceMinor: number,
) {
  const result = await client.query(
    `select reserved_amount_minor from billing_reservation_accounts
     where tenant_id = $1`,
    [organizationId],
  );
  return Math.max(
    0,
    balanceMinor - normalizeInteger(result.rows[0]?.reserved_amount_minor ?? 0),
  );
}

function reservationFromInput(input: {
  id: string;
  organizationId: string;
  reservationKey: string;
  catalogId: string;
  chargeContext: PaygCallChargeContext;
  amountMinor: number;
  currency: "usd";
  expiresAt: string;
  now: string;
}): BillingChargeReservation {
  return {
    id: input.id,
    organizationId: input.organizationId,
    reservationKey: input.reservationKey,
    catalogId: input.catalogId,
    chargeContext: normalizePaygCallChargeContext(input.chargeContext),
    fundingSource: "payg_credit",
    status: "active",
    reservedAmountMinor: input.amountMinor,
    currency: input.currency,
    expiresAt: input.expiresAt,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function mapReservation(row: QueryResultRow): BillingChargeReservation {
  if (
    row.funding_source !== "payg_credit" ||
    (row.status !== "active"
      && row.status !== "expired"
      && row.status !== "finalized"
      && row.status !== "released") ||
    row.currency !== "usd"
  ) {
    throw new Error("Stored billing reservation has unsupported data.");
  }
  const actualAmountMinor = row.actual_amount_minor === null
    || row.actual_amount_minor === undefined
    ? undefined
    : normalizeInteger(row.actual_amount_minor);
  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    reservationKey: row.reservation_key as string,
    ...(row.catalog_id === null || row.catalog_id === undefined
      ? {}
      : { catalogId: row.catalog_id as string }),
    ...(row.charge_context === null || row.charge_context === undefined
      ? {}
      : { chargeContext: normalizePaygCallChargeContext(row.charge_context) }),
    fundingSource: row.funding_source,
    status: row.status,
    reservedAmountMinor: normalizeInteger(row.reserved_amount_minor),
    ...(actualAmountMinor === undefined ? {} : { actualAmountMinor }),
    ...(row.session_id === null || row.session_id === undefined
      ? {}
      : { sessionId: row.session_id as string }),
    ...(row.terminal_outcome === null || row.terminal_outcome === undefined
      ? {}
      : { terminalOutcome: requireTerminalOutcome(row.terminal_outcome) }),
    currency: row.currency,
    expiresAt: normalizeTimestamp(row.expires_at),
    ...(row.finalized_at === null || row.finalized_at === undefined
      ? {}
      : { finalizedAt: normalizeTimestamp(row.finalized_at) }),
    ...(row.released_at === null || row.released_at === undefined
      ? {}
      : { releasedAt: normalizeTimestamp(row.released_at) }),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function releaseResult(
  reservation: BillingChargeReservation,
  duplicate: boolean,
  availableMinor: number,
) {
  return {
    outcome: "released" as const,
    duplicate,
    releasedMinor: reservation.reservedAmountMinor,
    availableMinor,
  };
}

function finalizationResult(
  reservation: BillingChargeReservation,
  duplicate: boolean,
  availableMinor: number,
) {
  const chargedMinor = reservation.actualAmountMinor;
  if (chargedMinor === undefined) {
    throw new Error(`Billing reservation ${reservation.id} has no finalized amount.`);
  }
  return {
    outcome: "finalized" as const,
    duplicate,
    chargedMinor,
    releasedMinor: reservation.reservedAmountMinor - chargedMinor,
    availableMinor,
  };
}

function paygDebitId(reservationId: string) {
  return `payg-reservation-debit:${reservationId}`;
}

function paygDebitIdempotencyKey(reservationId: string) {
  return `payg-reservation:${reservationId}:finalize`;
}

async function expireReservationsUsing(
  client: PoolClient,
  organizationId: string,
  now: string,
) {
  const expiredClaims = await client.query(
    `select id, reserved_amount_minor
     from billing_charge_reservations
     where tenant_id = $1
       and status = 'active'
       and expires_at <= $2
       and id not in (
         select reservation_id from billing_terminal_recovery_jobs
         where tenant_id = $1 and commercial_mode = 'payg'
           and status in ('pending', 'processing', 'dead_letter')
       )`,
    [organizationId, now],
  );
  const releasedMinor = expiredClaims.rows.reduce(
    (total, row) => total + normalizeInteger(row.reserved_amount_minor),
    0,
  );
  if (releasedMinor === 0) return;
  const accountResult = await client.query(
    `update billing_reservation_accounts
     set reserved_amount_minor = reserved_amount_minor - $2, updated_at = $3
     where tenant_id = $1 and reserved_amount_minor >= $2
     returning reserved_amount_minor`,
    [organizationId, releasedMinor, now],
  );
  if (accountResult.rows.length !== 1) {
    throw new Error(
      `Billing reservation account ${organizationId} cannot release expired claims.`,
    );
  }
  const expirationResult = await client.query(
    `update billing_charge_reservations
     set status = 'expired', updated_at = $2
     where tenant_id = $1
       and status = 'active'
       and expires_at <= $2
       and id not in (
         select reservation_id from billing_terminal_recovery_jobs
         where tenant_id = $1 and commercial_mode = 'payg'
           and status in ('pending', 'processing', 'dead_letter')
       )
     returning id`,
    [organizationId, now],
  );
  if (expirationResult.rows.length !== expiredClaims.rows.length) {
    throw new Error(
      `Billing reservation account ${organizationId} has inconsistent expired claims.`,
    );
  }
}

function assertReservationInput(input: {
  id: string;
  organizationId: string;
  reservationKey: string;
  catalogId: string;
  chargeContext: PaygCallChargeContext;
  amountMinor: number;
  currency: "usd";
  expiresAt: string;
  now: string;
}) {
  if (
    input.id.trim() === "" ||
    input.organizationId.trim() === "" ||
    input.reservationKey.trim() === "" ||
    input.catalogId.trim() === ""
  ) {
    throw new Error("Billing reservation identity must be complete.");
  }
  normalizePaygCallChargeContext(input.chargeContext);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("Billing reservation amountMinor must be a positive safe integer.");
  }
  if (input.currency !== "usd") {
    throw new Error("Billing reservations must use USD.");
  }
  if (Date.parse(input.expiresAt) <= Date.parse(input.now)) {
    throw new Error("Billing reservation expiry must be after its creation time.");
  }
}

function assertFinalizationInput(input: {
  organizationId: string;
  reservationId: string;
  sessionId: string;
  actualAmountMinor: number;
  terminalOutcome: "completed" | "transferred" | "failed";
  now: string;
}) {
  if (
    input.organizationId.trim() === ""
    || input.reservationId.trim() === ""
    || input.sessionId.trim() === ""
  ) {
    throw new Error("Billing finalization identity must be complete.");
  }
  if (!Number.isSafeInteger(input.actualAmountMinor) || input.actualAmountMinor <= 0) {
    throw new Error("Billing finalization actualAmountMinor must be a positive safe integer.");
  }
  if (!Number.isFinite(Date.parse(input.now))) {
    throw new Error("Billing finalization time must be valid.");
  }
  requireTerminalOutcome(input.terminalOutcome);
}

function assertReleaseInput(input: {
  organizationId: string;
  reservationId: string;
  now: string;
  terminalOutcome?: "completed" | "transferred" | "failed" | undefined;
}) {
  if (input.organizationId.trim() === "" || input.reservationId.trim() === "") {
    throw new Error("Billing release identity must be complete.");
  }
  if (!Number.isFinite(Date.parse(input.now))) {
    throw new Error("Billing release time must be valid.");
  }
  if (input.terminalOutcome !== undefined) requireTerminalOutcome(input.terminalOutcome);
}

function requireTerminalOutcome(value: unknown): "completed" | "transferred" | "failed" {
  if (value !== "completed" && value !== "transferred" && value !== "failed") {
    throw new Error("Billing terminal outcome is invalid.");
  }
  return value;
}

function normalizeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Stored billing value is not a safe integer: ${String(value)}`);
  }
  return parsed;
}

function normalizeTimestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
