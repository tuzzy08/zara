import { isDeepStrictEqual } from "node:util";
import type { Pool, QueryResultRow } from "pg";

export interface BillingChargePromotionRepositoryInput {
  promotionId: string;
  organizationId: string;
  outboxId: string;
  ledgerEntryId: string;
  releaseId: string;
  catalogId: string;
  actorUserId: string;
  actorRole: "billing_owner";
  reason: string;
  promotedAt: string;
}

export class PostgresBillingChargePromotionRepository {
  constructor(private readonly database: Pick<Pool, "connect">) {}

  async promote(input: BillingChargePromotionRepositoryInput) {
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const replay = await client.query(
        `select * from billing_charge_promotion_records
         where tenant_id = $1 and id = $2`,
        [input.organizationId, input.promotionId],
      );
      if (replay.rows[0] !== undefined) {
        if (!matchesReplay(replay.rows[0] as QueryResultRow, input)) {
          throw new Error("Charge promotion replay does not match the recorded evidence.");
        }
        const audit = await client.query(
          `select * from audit_logs where tenant_id = $1 and id = $2`,
          [input.organizationId, auditId(input)],
        );
        if (
          audit.rows[0] === undefined
          || !matchesAudit(audit.rows[0] as QueryResultRow, input)
        ) {
          throw new Error("Charge promotion audit evidence is missing or changed.");
        }
        await client.query("commit");
        return { promotionId: input.promotionId, duplicate: true };
      }
      const selected = await client.query(
        `select aggregate_id, payload, status, charge_release_id, charge_promoted_at
         from billing_outbox where tenant_id = $1 and id = $2 for update`,
        [input.organizationId, input.outboxId],
      );
      const row = selected.rows[0] as QueryResultRow | undefined;
      if (row === undefined) {
        throw new Error("The pending shadow outbox event was not found for this tenant.");
      }
      const payload = row.payload as Record<string, unknown>;
      if (
        row.status !== "pending"
        || payload.deliveryMode !== "shadow"
        || row.charge_release_id !== null
        || row.charge_promoted_at !== null
      ) {
        throw new Error("Only a pending shadow outbox event can be promoted.");
      }
      if (
        row.aggregate_id !== input.ledgerEntryId
        || payload.ledgerEntryId !== input.ledgerEntryId
      ) {
        throw new Error("The approved ledger entry does not own this outbox event.");
      }
      await client.query(
        `update billing_outbox
         set payload = $3::jsonb, charge_release_id = $4, charge_promoted_at = $5
         where tenant_id = $1 and id = $2`,
        [
          input.organizationId,
          input.outboxId,
          JSON.stringify({ ...payload, deliveryMode: "charge" }),
          input.releaseId,
          input.promotedAt,
        ],
      );
      await client.query(
        `insert into billing_charge_promotion_records (
          tenant_id,id,outbox_id,ledger_entry_id,release_id,catalog_id,
          actor_user_id,actor_role,reason,promoted_at,created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          input.organizationId,
          input.promotionId,
          input.outboxId,
          input.ledgerEntryId,
          input.releaseId,
          input.catalogId,
          input.actorUserId,
          input.actorRole,
          input.reason,
          input.promotedAt,
        ],
      );
      await client.query(
        `insert into audit_logs (
          id,tenant_id,actor_type,actor_id,action,target_type,target_id,metadata,occurred_at
        ) values ($1,$2,'user',$3,'billing.charge_event_promoted',
          'billing_outbox',$4,$5::jsonb,$6)`,
        [
          auditId(input),
          input.organizationId,
          input.actorUserId,
          input.outboxId,
          JSON.stringify(auditMetadata(input)),
          input.promotedAt,
        ],
      );
      await client.query("commit");
      return { promotionId: input.promotionId, duplicate: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function auditId(input: BillingChargePromotionRepositoryInput) {
  return `billing_charge_promotion:${input.organizationId}:${input.promotionId}`;
}

function auditMetadata(input: BillingChargePromotionRepositoryInput) {
  return {
    promotionId: input.promotionId,
    ledgerEntryId: input.ledgerEntryId,
    releaseId: input.releaseId,
    catalogId: input.catalogId,
    actorRole: input.actorRole,
    reason: input.reason,
  };
}

function matchesAudit(row: QueryResultRow, input: BillingChargePromotionRepositoryInput) {
  return isDeepStrictEqual({
    id: row.id,
    organizationId: row.tenant_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
    occurredAt: new Date(row.occurred_at).toISOString(),
  }, {
    id: auditId(input),
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "billing.charge_event_promoted",
    targetType: "billing_outbox",
    targetId: input.outboxId,
    metadata: auditMetadata(input),
    occurredAt: input.promotedAt,
  });
}

function matchesReplay(row: QueryResultRow, input: BillingChargePromotionRepositoryInput) {
  return isDeepStrictEqual({
    organizationId: row.tenant_id,
    promotionId: row.id,
    outboxId: row.outbox_id,
    ledgerEntryId: row.ledger_entry_id,
    releaseId: row.release_id,
    catalogId: row.catalog_id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    reason: row.reason,
    promotedAt: new Date(row.promoted_at).toISOString(),
  }, input);
}
