import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { Pool, QueryResultRow } from "pg";

import type { TrustedTerminalCallFact } from "./trusted-billing-usage-producer";
import type { TrustedPaygTerminalCallFact } from "./trusted-payg-terminal-finalization.service";

export interface SubscriptionTerminalSettlementFact {
  organizationId: string;
  reservationKey: string;
  sessionId: string;
  actualSeconds: number;
  providerConnectedSeconds?: number | undefined;
  outcome: "completed" | "transferred" | "failed";
  runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
  ownershipMode: "platform-managed" | "byo";
  provider: string;
  direction: "inbound" | "outbound";
  catalogId: string;
  planSlug: string;
  now: string;
}

export interface TerminalBillingRecoveryJob {
  id: string;
  organizationId: string;
  idempotencyKey: string;
  callSessionId: string;
  reservationId: string;
  commercialMode: "payg" | "subscription";
  usageFact: TrustedTerminalCallFact;
  settlementFact: TrustedPaygTerminalCallFact | SubscriptionTerminalSettlementFact;
  paygAppliedMinor?: number | undefined;
  status: "pending" | "processing" | "completed" | "dead_letter";
  attemptCount: number;
  nextAttemptAt: string;
  leaseExpiresAt?: string | undefined;
  leaseToken?: string | undefined;
  lastError?: string | undefined;
  completedAt?: string | undefined;
  deadLetteredAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export class TerminalBillingRecoveryRepository {
  constructor(private readonly database: Pool) {}

  async enqueue(input: {
    id: string;
    organizationId: string;
    idempotencyKey: string;
    callSessionId: string;
    reservationId: string;
    commercialMode: "payg" | "subscription";
    usageFact: TrustedTerminalCallFact;
    settlementFact: TrustedPaygTerminalCallFact | SubscriptionTerminalSettlementFact;
    now: string;
  }) {
    await this.database.query(
      `insert into billing_terminal_recovery_jobs (
         tenant_id, id, idempotency_key, call_session_id, reservation_id,
         commercial_mode, usage_fact, settlement_fact, status, attempt_count,
         next_attempt_at, lease_expires_at, last_error, completed_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 0, $9, null, null, null, $9, $9)
       on conflict (tenant_id, idempotency_key) do nothing`,
      [
        input.organizationId,
        input.id,
        input.idempotencyKey,
        input.callSessionId,
        input.reservationId,
        input.commercialMode,
        input.usageFact,
        input.settlementFact,
        input.now,
      ],
    );
    const existing = await this.getJob(input.organizationId, input.idempotencyKey);
    if (existing === null) {
      throw new Error("The terminal billing recovery job was not persisted.");
    }
    if (!matches(existing, input)) {
      throw new Error(
        `Terminal billing recovery key ${input.idempotencyKey} already has different terminal facts.`,
      );
    }
    return existing;
  }

  async getJob(organizationId: string, idempotencyKey: string) {
    const result = await this.database.query(
      `select * from billing_terminal_recovery_jobs
       where tenant_id = $1 and idempotency_key = $2`,
      [organizationId, idempotencyKey],
    );
    return result.rows[0] === undefined ? null : mapJob(result.rows[0]);
  }

  async claimJob(organizationId: string, idempotencyKey: string, now: string) {
    const leaseExpiresAt = new Date(Date.parse(now) + 60_000).toISOString();
    const leaseToken = randomUUID();
    const result = await this.database.query(
      `update billing_terminal_recovery_jobs
       set status = 'processing', attempt_count = attempt_count + 1,
           lease_expires_at = $3, lease_token = $5, updated_at = $2
       where tenant_id = $1 and idempotency_key = $4 and (
         (status = 'pending' and next_attempt_at <= $2)
         or (status = 'processing' and lease_expires_at <= $2)
       ) returning *`,
      [organizationId, now, leaseExpiresAt, idempotencyKey, leaseToken],
    );
    return result.rows[0] === undefined ? null : mapJob(result.rows[0]);
  }

  async listDue(now: string, limit = 25) {
    const result = await this.database.query(
      `select tenant_id, idempotency_key from billing_terminal_recovery_jobs
       where (status = 'pending' and next_attempt_at <= $1)
          or (status = 'processing' and lease_expires_at <= $1)
       order by next_attempt_at asc, created_at asc
       limit $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({
      organizationId: String(row.tenant_id),
      idempotencyKey: String(row.idempotency_key),
    }));
  }

  async markPending(job: TerminalBillingRecoveryJob, now: string, error: string) {
    const delayMs = Math.min(30_000 * 2 ** Math.max(0, job.attemptCount - 1), 900_000);
    const nextAttemptAt = new Date(Date.parse(now) + delayMs).toISOString();
    const result = await this.database.query(
      `update billing_terminal_recovery_jobs
       set status = 'pending', next_attempt_at = $4, lease_expires_at = null,
           lease_token = null,
           last_error = $5, updated_at = $3
       where tenant_id = $1 and id = $2 and status = 'processing'
         and lease_token = $6`,
      [job.organizationId, job.id, now, nextAttemptAt, error.slice(0, 500), job.leaseToken],
    );
    return result.rowCount === 1;
  }

  async pinPaygAppliedMinor(job: TerminalBillingRecoveryJob, amountMinor: number) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new Error("Subscription PAYG applied amount is invalid.");
    }
    const result = await this.database.query(
      `update billing_terminal_recovery_jobs
       set payg_applied_minor = coalesce(payg_applied_minor, $3)
       where tenant_id = $1 and id = $2 and status = 'processing'
         and lease_token = $4
         and (payg_applied_minor is null or payg_applied_minor = $3)
       returning payg_applied_minor`,
      [job.organizationId, job.id, amountMinor, job.leaseToken],
    );
    return result.rowCount === 1;
  }

  async markCompleted(job: TerminalBillingRecoveryJob, now: string) {
    const result = await this.database.query(
      `update billing_terminal_recovery_jobs
       set status = 'completed', lease_expires_at = null, lease_token = null,
           last_error = null,
           completed_at = $3, updated_at = $3
       where tenant_id = $1 and id = $2 and status = 'processing'
         and lease_token = $4`,
      [job.organizationId, job.id, now, job.leaseToken],
    );
    return result.rowCount === 1;
  }

  async markDeadLetter(job: TerminalBillingRecoveryJob, now: string, error: string) {
    const result = await this.database.query(
      `update billing_terminal_recovery_jobs
       set status = 'dead_letter', lease_expires_at = null, lease_token = null,
           last_error = $3, dead_lettered_at = $4, updated_at = $4
       where tenant_id = $1 and id = $2 and status = 'processing'
         and lease_token = $5`,
      [job.organizationId, job.id, error.slice(0, 500), now, job.leaseToken],
    );
    return result.rowCount === 1;
  }
}

function matches(
  job: TerminalBillingRecoveryJob,
  input: {
    id: string;
    organizationId: string;
    idempotencyKey: string;
    callSessionId: string;
    reservationId: string;
    commercialMode: "payg" | "subscription";
    usageFact: TrustedTerminalCallFact;
    settlementFact: TrustedPaygTerminalCallFact | SubscriptionTerminalSettlementFact;
  },
) {
  return job.id === input.id
    && job.organizationId === input.organizationId
    && job.callSessionId === input.callSessionId
    && job.reservationId === input.reservationId
    && job.commercialMode === input.commercialMode
    && isDeepStrictEqual(job.usageFact, input.usageFact)
    && isDeepStrictEqual(job.settlementFact, input.settlementFact);
}

function mapJob(row: QueryResultRow): TerminalBillingRecoveryJob {
  if (
    (row.commercial_mode !== "payg" && row.commercial_mode !== "subscription")
    || (row.status !== "pending" && row.status !== "processing"
      && row.status !== "completed" && row.status !== "dead_letter")
  ) {
    throw new Error("Stored terminal billing recovery data is invalid.");
  }
  return {
    id: String(row.id),
    organizationId: String(row.tenant_id),
    idempotencyKey: String(row.idempotency_key),
    callSessionId: String(row.call_session_id),
    reservationId: String(row.reservation_id),
    commercialMode: row.commercial_mode,
    usageFact: row.usage_fact as TrustedTerminalCallFact,
    settlementFact: row.settlement_fact as TrustedPaygTerminalCallFact | SubscriptionTerminalSettlementFact,
    ...(row.payg_applied_minor == null
      ? {}
      : { paygAppliedMinor: Number(row.payg_applied_minor) }),
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: timestamp(row.next_attempt_at),
    ...(row.lease_expires_at == null ? {} : { leaseExpiresAt: timestamp(row.lease_expires_at) }),
    ...(row.lease_token == null ? {} : { leaseToken: String(row.lease_token) }),
    ...(row.last_error == null ? {} : { lastError: String(row.last_error) }),
    ...(row.completed_at == null ? {} : { completedAt: timestamp(row.completed_at) }),
    ...(row.dead_lettered_at == null ? {} : { deadLetteredAt: timestamp(row.dead_lettered_at) }),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function timestamp(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
