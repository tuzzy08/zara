import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("provider usage storage guards", () => {
  it("deduplicates concurrent observed responses and rejects a changed tenant", async () => {
    const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    const schema = `usage_test_${randomUUID().replaceAll("-", "")}`;
    try {
      await clients[0]!.query(`create schema ${schema}`);
      for (const client of clients) await client.query(`set search_path to ${schema}`);
      await clients[0]!.query(readFileSync("apps/api/src/database/migrations/0037_provider_usage_recording.sql", "utf8"));
      await clients[0]!.query(readFileSync("apps/api/src/database/migrations/0038_provider_usage_connections.sql", "utf8"));
      await clients[0]!.query(readFileSync("apps/api/src/database/migrations/0039_provider_usage_attribution.sql", "utf8"));
      const repositories = clients.map(client => new ProviderUsageRecordingRepository(client));
      const input = { organizationId: "tuzzy-test", sessionId: "session-1", externalScopeId: "proj-shared",
        provider: "openai", model: "gpt-realtime-2.1", occurredAt: "2026-09-06T23:59:59.000Z" };
      const requests = await Promise.all(repositories.map(repository => repository.beginObserved(input, "realtime-response:resp-1")));
      expect(requests[0]).toEqual(requests[1]);
      const result = { providerRequestId: "resp-1", occurredAt: input.occurredAt,
        totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 } };
      await Promise.all(repositories.map(repository => repository.complete("tuzzy-test", requests[0]!.id, result)));
      expect(await repositories[0]!.listTenantRequests("tuzzy-test")).toHaveLength(1);
      await expect(repositories[1]!.beginObserved({ ...input, organizationId: "zara-ai-test" }, "realtime-response:resp-1"))
        .rejects.toThrow("Provider usage request identity changed.");
      expect(await repositories[1]!.listTenantRequests("zara-ai-test")).toEqual([]);
      expect(await repositories[1]!.beginObserved({ ...input, occurredAt: "2026-09-07T00:00:01.000Z" }, "realtime-response:resp-1"))
        .toEqual(requests[0]);
    } finally {
      for (const client of clients) await client.query("set search_path to public");
      await clients[0]!.query(`drop schema ${schema} cascade`);
      for (const client of clients) client.release();
      await pool.end();
    }
  });
  it("preserves request identity and final counts against direct SQL changes", async () => {
    const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    const client = await pool.connect();
    const schema = `usage_test_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema ${schema}`);
      await client.query(`set search_path to ${schema}`);
      await client.query(readFileSync("apps/api/src/database/migrations/0037_provider_usage_recording.sql", "utf8"));
      await client.query(`insert into provider_usage_requests (id,tenant_id,provider,model,occurred_at)
        values ('request-1','tuzzy-test','openai','gpt-4.1',now())`);
      await expect(client.query("update provider_usage_requests set tenant_id = 'other'"))
        .rejects.toThrow("provider usage records are immutable");
      await client.query(`update provider_usage_requests set result = '{"totals":{"inputTokens":20}}'`);
      await expect(client.query("update provider_usage_requests set result = null"))
        .rejects.toThrow("provider usage records are immutable");
      await expect(client.query("delete from provider_usage_requests"))
        .rejects.toThrow("provider usage records are immutable");
      await expect(client.query(readFileSync("docs/Runbooks/rollback-0037-provider-usage-recording.sql", "utf8")))
        .rejects.toThrow("provider usage records exist");
      await client.query("rollback");
    } finally {
      await client.query("set search_path to public");
      await client.query(`drop schema ${schema} cascade`);
      client.release();
      await pool.end();
    }
  });
});
