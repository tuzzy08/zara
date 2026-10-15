import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, type Workspace, type WorkspaceAuditEntry, type WorkspaceMembership } from "@zara/core";
import type { Pool, PoolClient } from "pg";
import type { WorkspaceRepository, WorkspaceStoredState } from "./workspace.repository";

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: Pool) {}

  read(organizationId: string) {
    return this.mutate(organizationId, state => structuredClone(state));
  }

  async mutate<T>(organizationId: string, operation: (state: WorkspaceStoredState) => T): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`workspaces:${organizationId}`]);
      await client.query(`INSERT INTO workspaces (tenant_id, id, name, slug, status, created_by)
        VALUES ($1, $2, $3, 'default-workspace', 'active', 'system') ON CONFLICT (tenant_id, id) DO NOTHING`,
      [organizationId, DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME]);
      const state = await this.load(client, organizationId);
      const before = structuredClone(state);
      const result = operation(state);
      await this.persist(client, before, state);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async load(client: PoolClient, organizationId: string): Promise<WorkspaceStoredState> {
    const workspaces = await client.query<Workspace>(`SELECT id, tenant_id AS "tenantId", name, slug, status,
      created_at AS "createdAt", created_by AS "createdBy" FROM workspaces WHERE tenant_id = $1 ORDER BY created_at, id`, [organizationId]);
    const memberships = await client.query<WorkspaceMembership & { revoked: boolean }>(`SELECT workspace_id AS "workspaceId",
      tenant_id AS "tenantId", user_id AS "userId", role, created_at AS "createdAt", revoked
      FROM workspace_memberships WHERE tenant_id = $1 ORDER BY created_at, workspace_id, user_id`, [organizationId]);
    const audit = await client.query<WorkspaceAuditEntry>(`SELECT id, workspace_id AS "workspaceId", tenant_id AS "tenantId",
      actor_user_id AS "actorUserId", action, summary, at FROM workspace_audit_entries
      WHERE tenant_id = $1 ORDER BY sequence DESC`, [organizationId]);
    const directory = await client.query<WorkspaceStoredState["directoryUsers"][number]>(`SELECT u.id, u.name, m.role AS title
      FROM "member" m JOIN "user" u ON u.id = m."userId" WHERE m."organizationId" = $1 ORDER BY u.name, u.id`, [organizationId]);
    const history = await client.query<{ userId: string }>(`SELECT user_id AS "userId"
      FROM workspace_membership_history WHERE tenant_id = $1`, [organizationId]);
    return { organizationId, directoryUsers: directory.rows,
      workspaces: workspaces.rows.map(row => ({ ...row, createdAt: toIso(row.createdAt) })),
      memberships: memberships.rows.filter(row => !row.revoked).map(row => ({
        tenantId: row.tenantId, workspaceId: row.workspaceId, userId: row.userId,
        role: row.role, createdAt: toIso(row.createdAt),
      })),
      auditEntries: audit.rows.map(row => ({ ...row, at: toIso(row.at) })),
      membershipHistoryUserIds: history.rows.map(row => row.userId) };
  }

  private async persist(client: PoolClient, before: WorkspaceStoredState, state: WorkspaceStoredState) {
    const tenantId = state.organizationId;
    for (const workspace of state.workspaces) {
      const previous = before.workspaces.find(row => row.id === workspace.id);
      if (JSON.stringify(previous) === JSON.stringify(workspace)) continue;
      await client.query(`INSERT INTO workspaces (tenant_id, id, name, slug, status, created_at, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, status=EXCLUDED.status`,
      [tenantId, workspace.id, workspace.name, workspace.slug, workspace.status, workspace.createdAt, workspace.createdBy]);
    }
    for (const membership of state.memberships) {
      const previous = before.memberships.find(row => row.workspaceId === membership.workspaceId && row.userId === membership.userId);
      if (JSON.stringify(previous) === JSON.stringify(membership)) continue;
      await client.query(`INSERT INTO workspace_memberships (tenant_id,workspace_id,user_id,role,created_at,revoked)
        VALUES ($1,$2,$3,$4,$5,false) ON CONFLICT (tenant_id,workspace_id,user_id)
        DO UPDATE SET role=EXCLUDED.role, created_at=EXCLUDED.created_at, revoked=false`,
      [tenantId, membership.workspaceId, membership.userId, membership.role, membership.createdAt]);
      await client.query(`INSERT INTO workspace_membership_history (tenant_id,user_id)
        VALUES ($1,$2) ON CONFLICT (tenant_id,user_id) DO NOTHING`, [tenantId, membership.userId]);
    }
    for (const membership of before.memberships) {
      if (state.memberships.some(row => row.workspaceId === membership.workspaceId && row.userId === membership.userId)) continue;
      await client.query("UPDATE workspace_memberships SET revoked=true WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3",
        [tenantId, membership.workspaceId, membership.userId]);
    }
    const priorAuditIds = new Set(before.auditEntries.map(entry => entry.id));
    for (const entry of state.auditEntries.filter(entry => !priorAuditIds.has(entry.id)).reverse()) {
      await client.query(`INSERT INTO workspace_audit_entries (id,tenant_id,workspace_id,actor_user_id,action,summary,at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [entry.id, tenantId, entry.workspaceId, entry.actorUserId, entry.action, entry.summary, entry.at]);
    }
  }
}

function toIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}
