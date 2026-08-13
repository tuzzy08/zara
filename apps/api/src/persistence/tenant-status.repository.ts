import type { Pool, QueryResultRow } from "pg";

type TenantStatusDatabase = Pick<Pool, "query" | "connect">;

export type DurableTenantStatus = "active" | "suspended" | "archived";

export type TenantStatusReadResult =
  | { outcome: "found"; status: DurableTenantStatus }
  | { outcome: "missing" };

export interface TenantStatusAuditRecord {
  id: string;
  actorType: "system" | "user";
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | undefined;
  metadata: Record<string, string | number | boolean>;
  occurredAt: string;
}

export interface DurablePlatformAuditRecord extends TenantStatusAuditRecord {
  tenantId: string;
}

export class PostgresTenantStatusRepository {
  constructor(private readonly database: TenantStatusDatabase) {}

  async getStatus(tenantId: string): Promise<TenantStatusReadResult> {
    const result = await this.database.query<TenantStatusRow>(
      `select status
       from tenants
       where id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (row === undefined) return { outcome: "missing" };
    if (!isDurableTenantStatus(row.status)) {
      throw new Error(`Tenant '${tenantId}' has an invalid durable status.`);
    }
    return { outcome: "found", status: row.status };
  }

  async updateStatusWithAudit(input: {
    tenantId: string;
    status: DurableTenantStatus;
    audit: TenantStatusAuditRecord;
  }) {
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const updated = await client.query<TenantStatusRow>(
        `update tenants
         set status = $2, updated_at = now()
         where id = $1
         returning status`,
        [input.tenantId, input.status],
      );
      if (updated.rows[0] === undefined) {
        await client.query("rollback");
        return { outcome: "missing" as const };
      }
      await client.query(
        `insert into audit_logs (
           id, tenant_id, actor_type, actor_id, action,
           target_type, target_id, metadata, occurred_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.audit.id,
          input.tenantId,
          input.audit.actorType,
          input.audit.actorId,
          input.audit.action,
          input.audit.targetType,
          input.audit.targetId ?? null,
          input.audit.metadata,
          input.audit.occurredAt,
        ],
      );
      await client.query("commit");
      return { outcome: "updated" as const, status: input.status };
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Keep the transaction failure as the caller-visible error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listAuditLogs(filters: {
    tenantId?: string | undefined;
    actorUserId?: string | undefined;
    action?: string | undefined;
  }): Promise<DurablePlatformAuditRecord[]> {
    const values: string[] = [];
    const conditions: string[] = [];
    conditions.push("id like 'platform_audit_%'");
    if (filters.tenantId !== undefined) {
      values.push(filters.tenantId);
      conditions.push(`tenant_id = $${values.length}`);
    }
    if (filters.actorUserId !== undefined) {
      values.push(filters.actorUserId);
      conditions.push(`actor_id = $${values.length}`);
    }
    if (filters.action !== undefined) {
      values.push(filters.action);
      conditions.push(`action = $${values.length}`);
    }
    const result = await this.database.query<PlatformAuditRow>(
      `select id,
              tenant_id as "tenantId",
              actor_type as "actorType",
              actor_id as "actorId",
              action,
              target_type as "targetType",
              target_id as "targetId",
              metadata,
              occurred_at as "occurredAt"
       from audit_logs
       ${conditions.length === 0 ? "" : `where ${conditions.join(" and ")}`}
       order by occurred_at desc, id desc`,
      values,
    );
    return result.rows.map(normalizePlatformAuditRow);
  }
}

interface TenantStatusRow extends QueryResultRow {
  status: unknown;
}

interface PlatformAuditRow extends QueryResultRow {
  id: unknown;
  tenantId: unknown;
  actorType: unknown;
  actorId: unknown;
  action: unknown;
  targetType: unknown;
  targetId: unknown;
  metadata: unknown;
  occurredAt: unknown;
}

function isDurableTenantStatus(value: unknown): value is DurableTenantStatus {
  return value === "active" || value === "suspended" || value === "archived";
}

function normalizePlatformAuditRow(row: PlatformAuditRow): DurablePlatformAuditRecord {
  if (
    typeof row.id !== "string"
    || typeof row.tenantId !== "string"
    || (row.actorType !== "system" && row.actorType !== "user")
    || typeof row.actorId !== "string"
    || typeof row.action !== "string"
    || typeof row.targetType !== "string"
    || (row.targetId !== null && typeof row.targetId !== "string")
    || row.metadata === null
    || typeof row.metadata !== "object"
  ) {
    throw new Error("Canonical platform audit row is invalid.");
  }
  const occurredAt = row.occurredAt instanceof Date
    ? row.occurredAt.toISOString()
    : typeof row.occurredAt === "string"
      ? new Date(row.occurredAt).toISOString()
      : undefined;
  if (occurredAt === undefined) {
    throw new Error("Canonical platform audit timestamp is invalid.");
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    ...(row.targetId === null ? {} : { targetId: row.targetId }),
    metadata: row.metadata as Record<string, string | number | boolean>,
    occurredAt,
  };
}
