import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("provider connection storage guards", () => {
  it("permits empty rollback but refuses to remove an unresolved connection", async () => {
    await withSchema(async client => {
      const rollback = readFileSync("docs/Runbooks/rollback-0038-provider-usage-connections.sql", "utf8");
      await client.query(rollback);
      expect((await client.query("select to_regclass('provider_usage_connections') as table_name")).rows[0].table_name).toBeNull();
      await client.query(readFileSync("apps/api/src/database/migrations/0038_provider_usage_connections.sql", "utf8"));
      await client.query(`insert into provider_usage_connections (id,tenant_id,session_id,provider,model,started_at)
        values ('connection-1','tenant-a','session-1','openai','gpt-realtime-2.1',now())`);
      await expect(client.query(rollback)).rejects.toThrow("provider connection records exist");
      await client.query("rollback");
      expect((await client.query("select id from provider_usage_connections")).rows).toEqual([{ id: "connection-1" }]);
    });
  });
  it("preserves connection starts and final results against direct changes", async () => {
    await withSchema(async (client) => {
      await client.query(`insert into provider_usage_connections (id,tenant_id,session_id,provider,model,started_at)
        values ('connection-1','tenant-a','session-1','openai','gpt-realtime-2.1',now())`);
      await expect(client.query("update provider_usage_connections set tenant_id = 'other'"))
        .rejects.toThrow("provider connection records are immutable");
      await client.query("update provider_usage_connections set result = $1", [
        { outcome: "closed", endedAt: "2026-09-08T10:01:00.000Z", providerSessionId: "sess-1" },
      ]);
      await expect(client.query("update provider_usage_connections set result = null"))
        .rejects.toThrow("provider connection records are immutable");
      await expect(client.query("delete from provider_usage_connections"))
        .rejects.toThrow("provider connection records are immutable");
    });
  });
});

async function withSchema(run: (client: import("pg").PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
  const client = await pool.connect();
  const schema = `connection_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`create schema ${schema}`);
    await client.query(`set search_path to ${schema}`);
    await client.query(readFileSync("apps/api/src/database/migrations/0038_provider_usage_connections.sql", "utf8"));
    await run(client);
  } finally {
    await client.query("rollback");
    await client.query("set search_path to public");
    await client.query(`drop schema ${schema} cascade`);
    client.release();
    await pool.end();
  }
}
