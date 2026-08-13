import { describe, expect, it } from "vitest";

import { PostgresTenantStatusRepository } from "./tenant-status.repository";

describe("PostgresTenantStatusRepository", () => {
  it.each(["active", "suspended", "archived"] as const)(
    "reads the tenant-qualified %s status",
    async (status) => {
      const queries: Array<{ sql: string; values: unknown[] }> = [];
      const repository = new PostgresTenantStatusRepository({
        async query(sql: string, values: unknown[]) {
          queries.push({ sql, values });
          return { rows: [{ status }], rowCount: 1 };
        },
      } as never);

      await expect(repository.getStatus("tenant-a")).resolves.toEqual({
        outcome: "found",
        status,
      });
      expect(queries).toEqual([
        expect.objectContaining({ values: ["tenant-a"] }),
      ]);
      expect(queries[0]?.sql).toMatch(/where\s+id\s*=\s*\$1/i);
    },
  );

  it("returns missing only for the requested tenant", async () => {
    const repository = new PostgresTenantStatusRepository({
      async query(_sql: string, values: unknown[]) {
        return values[0] === "tenant-a"
          ? { rows: [], rowCount: 0 }
          : { rows: [{ status: "suspended" }], rowCount: 1 };
      },
    } as never);

    await expect(repository.getStatus("tenant-a")).resolves.toEqual({ outcome: "missing" });
    await expect(repository.getStatus("tenant-b")).resolves.toEqual({
      outcome: "found",
      status: "suspended",
    });
  });

  it("propagates read failure so callers can fail closed", async () => {
    const repository = new PostgresTenantStatusRepository({
      async query() {
        throw new Error("database unavailable");
      },
    } as never);

    await expect(repository.getStatus("tenant-a")).rejects.toThrow("database unavailable");
  });

  it("commits the tenant status and canonical audit row in one transaction", async () => {
    const queries: Array<{ sql: string; values?: unknown[] | undefined }> = [];
    const client = {
      async query(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (/update tenants/i.test(sql)) {
          return { rows: [{ status: "suspended" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const repository = new PostgresTenantStatusRepository({
      async query() {
        throw new Error("transaction client required");
      },
      async connect() {
        return client;
      },
    } as never);

    await expect(repository.updateStatusWithAudit({
      tenantId: "tenant-a",
      status: "suspended",
      audit: {
        id: "platform_audit_1",
        actorType: "user",
        actorId: "user-platform-admin",
        action: "platform.organization.status_updated",
        targetType: "organization",
        targetId: "tenant-a",
        metadata: { status: "suspended", reason: "Abuse review" },
        occurredAt: "2026-05-24T09:00:00.000Z",
      },
    })).resolves.toEqual({ outcome: "updated", status: "suspended" });

    expect(queries.map((query) => query.sql.trim().split(/\s+/)[0]?.toLowerCase())).toEqual([
      "begin",
      "update",
      "insert",
      "commit",
    ]);
    expect(queries[2]?.sql).toMatch(/insert into audit_logs/i);
    expect(queries[2]?.values).toEqual(expect.arrayContaining([
      "platform_audit_1",
      "tenant-a",
      "user-platform-admin",
      "platform.organization.status_updated",
    ]));
  });

  it("rolls back the tenant status when the canonical audit insert fails", async () => {
    const operations: string[] = [];
    const client = {
      async query(sql: string) {
        const operation = sql.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        operations.push(operation);
        if (operation === "update") {
          return { rows: [{ status: "suspended" }], rowCount: 1 };
        }
        if (operation === "insert") {
          throw new Error("audit insert failed");
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const repository = new PostgresTenantStatusRepository({
      async query() {
        throw new Error("transaction client required");
      },
      async connect() {
        return client;
      },
    } as never);

    await expect(repository.updateStatusWithAudit({
      tenantId: "tenant-a",
      status: "suspended",
      audit: {
        id: "platform_audit_rollback",
        actorType: "user",
        actorId: "user-platform-admin",
        action: "platform.organization.status_updated",
        targetType: "organization",
        targetId: "tenant-a",
        metadata: { status: "suspended" },
        occurredAt: "2026-05-24T09:00:00.000Z",
      },
    })).rejects.toThrow("audit insert failed");
    expect(operations).toEqual(["begin", "update", "insert", "rollback"]);
  });

  it("lists canonical audit rows with exact platform filters", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const repository = new PostgresTenantStatusRepository({
      async query(sql: string, values: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [{
            id: "platform_audit_00000000-0000-4000-8000-000000000001",
            tenantId: "tenant-a",
            actorType: "user",
            actorId: "user-platform-admin",
            action: "platform.organization.status_updated",
            targetType: "organization",
            targetId: "tenant-a",
            metadata: {
              actorRole: "platform_admin",
              outcome: "succeeded",
              status: "suspended",
            },
            occurredAt: new Date("2026-05-24T09:00:00.000Z"),
          }],
          rowCount: 1,
        };
      },
    } as never);

    await expect(repository.listAuditLogs({
      tenantId: "tenant-a",
      actorUserId: "user-platform-admin",
      action: "platform.organization.status_updated",
    })).resolves.toEqual([expect.objectContaining({
      tenantId: "tenant-a",
      actorId: "user-platform-admin",
      action: "platform.organization.status_updated",
      occurredAt: "2026-05-24T09:00:00.000Z",
    })]);
    expect(queries[0]?.values).toEqual([
      "tenant-a",
      "user-platform-admin",
      "platform.organization.status_updated",
    ]);
    expect(queries[0]?.sql).toMatch(/tenant_id\s*=\s*\$1/i);
    expect(queries[0]?.sql).toMatch(/actor_id\s*=\s*\$2/i);
    expect(queries[0]?.sql).toMatch(/action\s*=\s*\$3/i);
  });
});
