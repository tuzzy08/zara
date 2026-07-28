import type { Pool } from "pg";

import type {
  PstnCapacityPolicy,
  PstnCapacityPolicyAuditEntry,
} from "./pstn-capacity-policy.models";
import type {
  PstnCapacityPolicyRepository,
} from "./pstn-capacity-policy.repository";

const singletonPolicyId = "global";

export class PostgresPstnCapacityPolicyRepository
  implements PstnCapacityPolicyRepository
{
  constructor(private readonly pool: Pool) {}

  async load() {
    const result = await this.pool.query<{
      policy: PstnCapacityPolicy | string;
    }>(
      `select policy
       from pstn_capacity_policy
       where id = $1`,
      [singletonPolicyId],
    );
    const stored = result.rows[0]?.policy;
    return stored === undefined ? null : parseJson<PstnCapacityPolicy>(stored);
  }

  async save(input: {
    expectedVersion: number;
    policy: PstnCapacityPolicy;
    audit: PstnCapacityPolicyAuditEntry;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(1265782391)");
      const current = await client.query<{ version: number }>(
        `select version
         from pstn_capacity_policy
         where id = $1
         for update`,
        [singletonPolicyId],
      );
      const currentVersion = current.rows[0]?.version ?? 1;
      if (currentVersion !== input.expectedVersion) {
        await client.query("rollback");
        return false;
      }
      await client.query(
        `insert into pstn_capacity_policy (
           id,
           version,
           policy,
           updated_by,
           updated_at
         )
         values ($1, $2, $3::jsonb, $4, $5::timestamptz)
         on conflict (id) do update
         set version = excluded.version,
             policy = excluded.policy,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        [
          singletonPolicyId,
          input.policy.version,
          JSON.stringify(input.policy),
          input.policy.updatedBy,
          input.policy.updatedAt,
        ],
      );
      await client.query(
        `insert into pstn_capacity_policy_audit (
           id,
           policy_version,
           actor_user_id,
           reason,
           before_policy,
           after_policy,
           occurred_at
         )
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::timestamptz)`,
        [
          input.audit.id,
          input.audit.policyVersion,
          input.audit.actorUserId,
          input.audit.reason,
          JSON.stringify(input.audit.before),
          JSON.stringify(input.audit.after),
          input.audit.occurredAt,
        ],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAudit(limit: number) {
    const result = await this.pool.query<{
      id: string;
      policy_version: number;
      actor_user_id: string;
      reason: string;
      before_policy: PstnCapacityPolicy | string;
      after_policy: PstnCapacityPolicy | string;
      occurred_at: Date | string;
    }>(
      `select
         id,
         policy_version,
         actor_user_id,
         reason,
         before_policy,
         after_policy,
         occurred_at
       from pstn_capacity_policy_audit
       order by policy_version desc
       limit $1`,
      [Math.max(1, Math.min(limit, 100))],
    );
    return result.rows.map((row) => ({
      id: row.id,
      policyVersion: row.policy_version,
      actorUserId: row.actor_user_id,
      reason: row.reason,
      before: parseJson<PstnCapacityPolicy>(row.before_policy),
      after: parseJson<PstnCapacityPolicy>(row.after_policy),
      occurredAt: toIso(row.occurred_at),
    }));
  }
}

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
