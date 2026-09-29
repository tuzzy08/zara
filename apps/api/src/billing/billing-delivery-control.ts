import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { Pool } from "pg";
import { assertPlatformMutationAllowed } from "../platform-admin/platform-admin-auth-posture";
import type { PlatformAdminRequestContext } from "../platform-admin/platform-admin.guard";

export interface BillingDeliveryDecision {
  id: string;
  enabled: boolean;
  catalogId: string | null;
  releaseId: string | null;
  effectiveAt: string;
  actorUserId: string;
  reason: string;
  expectedDecisionId: string | null;
}

export class BillingDeliveryControlRepository {
  constructor(private readonly pool: Pool) {}

  async getState(): Promise<BillingDeliveryDecision | null> {
    const result = await this.pool.query("select * from billing_delivery_decisions order by sequence desc limit 1");
    return result.rows[0] ? decision(result.rows[0]) : null;
  }

  async change(input: Omit<BillingDeliveryDecision, "effectiveAt">): Promise<BillingDeliveryDecision> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // ponytail: serialize rare operator decisions; no per-tenant controls are needed.
      await client.query("lock table billing_delivery_decisions in exclusive mode");
      const existing = await client.query("select * from billing_delivery_decisions where id = $1", [input.id]);
      if (existing.rows[0]) {
        const saved = decision(existing.rows[0]);
        if (Object.entries(input).some(([key, value]) => saved[key as keyof BillingDeliveryDecision] !== value)) {
          throw new ConflictException("The request ID was used for a different billing decision.");
        }
        await client.query("commit");
        return saved;
      }
      const latest = await client.query("select id from billing_delivery_decisions order by sequence desc limit 1");
      if ((latest.rows[0]?.id ?? null) !== input.expectedDecisionId) {
        throw new ConflictException("Billing delivery changed. Read its current state and try again.");
      }
      const inserted = await client.query(`insert into billing_delivery_decisions
        (id, enabled, catalog_id, release_id, actor_user_id, reason, expected_decision_id)
        values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [input.id, input.enabled, input.catalogId, input.releaseId, input.actorUserId, input.reason, input.expectedDecisionId]);
      await client.query(`insert into audit_logs
        (id, tenant_id, actor_type, actor_id, action, target_type, target_id, metadata, occurred_at)
        select $1, null, 'user', $2, $3, 'billing_delivery', id, $4::jsonb, effective_at
        from billing_delivery_decisions where id = $5`, [
        `platform_audit_billing_delivery:${input.id}`, input.actorUserId,
        input.enabled ? "billing.delivery.enabled" : "billing.delivery.stopped",
        JSON.stringify({ actorRole: "platform_owner", outcome: "succeeded", reason: input.reason,
          ...(input.catalogId === null ? {} : { catalogId: input.catalogId, releaseId: input.releaseId }) }),
        input.id,
      ]);
      await client.query("commit");
      return decision(inserted.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
  }
}

export class BillingDeliveryControlService {
  constructor(
    private readonly repository: BillingDeliveryControlRepository,
    private readonly loadConfiguration: () => Promise<{ catalogId: string; releaseId: string }>,
  ) {}

  getState() { return this.repository.getState(); }

  async change(context: PlatformAdminRequestContext, body: unknown) {
    if (context.platformRole !== "platform_owner") throw new ForbiddenException("Only the platform owner can control billing delivery.");
    assertPlatformMutationAllowed(context.platformAuth);
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("A billing decision is required.");
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some(key => !["requestId", "enabled", "expectedDecisionId", "reason"].includes(key))
      || typeof value.enabled !== "boolean" || !validText(value.requestId, 128) || !validText(value.reason, 500)
      || !(value.expectedDecisionId === null || validText(value.expectedDecisionId, 128))) {
      throw new BadRequestException("Supply requestId, enabled, expectedDecisionId, and a reason only.");
    }
    const scope = value.enabled ? await this.loadConfiguration() : { catalogId: null, releaseId: null };
    return this.repository.change({ id: value.requestId as string, enabled: value.enabled,
      expectedDecisionId: value.expectedDecisionId as string | null, reason: value.reason as string,
      actorUserId: context.actorUserId, ...scope });
  }
}

function validText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && value === value.trim();
}

function decision(row: Record<string, unknown>): BillingDeliveryDecision {
  return { id: row.id as string, enabled: row.enabled as boolean, catalogId: row.catalog_id as string | null,
    releaseId: row.release_id as string | null, effectiveAt: new Date(row.effective_at as string | Date).toISOString(),
    actorUserId: row.actor_user_id as string, reason: row.reason as string, expectedDecisionId: row.expected_decision_id as string | null };
}
