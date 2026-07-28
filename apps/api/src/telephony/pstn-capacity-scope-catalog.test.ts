import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { PostgresPstnCapacityScopeCatalog } from "./pstn-capacity-scope-catalog";

describe("PostgresPstnCapacityScopeCatalog", () => {
  it("discovers active tenants and configured provider accounts", async () => {
    const database = newDb();
    database.public.none(`
      create table tenants (
        id text primary key,
        status text not null
      );
      create table telephony_connections (
        id text primary key,
        tenant_id text not null,
        provider text not null,
        external_reference text,
        status text not null,
        health_status text not null,
        block_routing_on_health_failure boolean not null
      );
      insert into tenants (id, status)
      values ('tenant-a', 'active'), ('tenant-b', 'suspended');
      insert into telephony_connections (
        id,
        tenant_id,
        provider,
        external_reference,
        status,
        health_status,
        block_routing_on_health_failure
      )
      values
        ('connection-a', 'tenant-a', 'twilio', 'AC123', 'active', 'healthy', true),
        ('connection-b', 'tenant-a', 'sip', null, 'degraded', 'failed', true);
    `);
    const { Pool } = database.adapters.createPg();

    const catalog = new PostgresPstnCapacityScopeCatalog(
      new Pool(),
      {
        listReadyWorkerIds: async () => ["worker-a", "worker-b"],
      },
    );

    await expect(catalog.listScopes()).resolves.toEqual({
      tenants: ["tenant-a"],
      providerAccounts: [
        {
          provider: "sip",
          providerAccountId: "connection-b",
          health: "unavailable",
        },
        {
          provider: "twilio",
          providerAccountId: "AC123",
          health: "healthy",
        },
      ],
      providerHealth: {
        sip: "unavailable",
        twilio: "healthy",
      },
      workers: ["worker-a", "worker-b"],
      page: {
        offset: 0,
        limit: 512,
        hasMore: false,
      },
    });
  });

  it("paginates discovery when a dimension exceeds one bounded page", async () => {
    const pool = {
      query: async (sql: string) => {
        if (sql.includes("from tenants")) {
          const offset = sql.includes("offset 512") ? 512 : 0;
          return {
            rows: Array.from(
              { length: offset === 0 ? 513 : 1 },
              (_, index) => ({
              id: `tenant-${offset + index}`,
            })),
          };
        }
        if (sql.includes("group by provider")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    const catalog = new PostgresPstnCapacityScopeCatalog(
      pool as unknown as Pick<Pool, "query">,
      {
        listReadyWorkerIds: async () => [],
      },
    );

    const first = await catalog.listScopes();
    const second = await catalog.listScopes({ offset: 512 });

    expect(first.tenants).toHaveLength(512);
    expect(first.page).toEqual({ offset: 0, limit: 512, hasMore: true });
    expect(second.tenants).toEqual(["tenant-512"]);
    expect(second.page).toEqual({ offset: 512, limit: 512, hasMore: false });
  });
});
