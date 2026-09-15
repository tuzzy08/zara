import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("provider usage attribution guards", () => {
  it.each(["call", "request"])("refuses rollback when a %s link exists", async kind => {
    await withSchema(async client => {
      const repository = new ProviderUsageRecordingRepository(client);
      const scope = { organizationId: "tenant-a", sessionId: "premium-1", externalScopeId: "proj-shared",
        provider: "openai", model: "gpt-realtime-2.1", occurredAt: "2026-09-08T10:00:00.000Z" };
      const connectionId = await repository.beginConnection({ ...scope, callSessionId: kind === "call" ? "call-1" : null });
      if (kind === "request") await repository.beginObserved({ ...scope, connectionId }, "response-1");
      await expect(client.query(readFileSync("docs/Runbooks/rollback-0039-provider-usage-attribution.sql", "utf8")))
        .rejects.toThrow("provider usage attribution exists");
      await client.query("rollback");
      expect(await repository.listTenantConnections("tenant-a")).toMatchObject([{ id: connectionId }]);
      if (kind === "request") expect(await repository.listTenantRequests("tenant-a")).toMatchObject([{ connectionId }]);
    });
  });
  it("rolls back empty attribution columns without removing historical records", async () => {
    await withSchema(async client => {
      await client.query(`insert into provider_usage_connections (id,tenant_id,provider,model,started_at)
        values ('historic-connection','tenant-a','openai','gpt-realtime-2.1',now())`);
      await client.query(`insert into provider_usage_requests (id,tenant_id,provider,model,occurred_at)
        values ('historic-request','tenant-a','openai','gpt-realtime-2.1',now())`);
      await client.query(readFileSync("docs/Runbooks/rollback-0039-provider-usage-attribution.sql", "utf8"));
      expect((await client.query("select id from provider_usage_requests")).rows).toEqual([{ id: "historic-request" }]);
      expect((await client.query("select id from provider_usage_connections")).rows).toEqual([{ id: "historic-connection" }]);
      await client.query(readFileSync("apps/api/src/database/migrations/0039_provider_usage_attribution.sql", "utf8"));
      const repository = new ProviderUsageRecordingRepository(client);
      expect(await repository.listTenantRequests("tenant-a")).toMatchObject([{ connectionId: null, callSessionId: null }]);
      expect(await repository.listTenantConnections("tenant-a")).toMatchObject([{ callSessionId: null }]);
    });
  });
  it("rejects wrong connection scope in direct SQL, including missing connections", async () => {
    await withSchema(async client => {
      const repository = new ProviderUsageRecordingRepository(client);
      const connectionId = await repository.beginConnection({ organizationId: "tenant-a", sessionId: "premium-1",
        callSessionId: "call-1", externalScopeId: "proj-shared", provider: "openai", model: "gpt-realtime-2.1",
        occurredAt: "2026-09-08T10:00:00.000Z" });
      for (const scope of [
        ["other-tenant", "premium-1", "proj-shared", "openai", connectionId],
        ["tenant-a", "other-session", "proj-shared", "openai", connectionId],
        ["tenant-a", "premium-1", "other-project", "openai", connectionId],
        ["tenant-a", "premium-1", "proj-shared", "other", connectionId],
        ["tenant-a", "premium-1", "proj-shared", "openai", "missing"],
      ]) {
        await expect(client.query(`insert into provider_usage_requests
          (id,tenant_id,session_id,external_scope_id,provider,connection_id,model,occurred_at)
          values ('bad',$1,$2,$3,$4,$5,'gpt-realtime-whisper',now())`, scope))
          .rejects.toThrow("provider usage connection scope does not match");
      }
      // Transcription has a different model but the same connection scope.
      const request = await repository.beginObserved({ organizationId: "tenant-a", sessionId: "premium-1", connectionId,
        externalScopeId: "proj-shared", provider: "openai", model: "gpt-realtime-whisper",
        occurredAt: "2026-09-08T10:00:01.000Z" }, "transcription-1");
      expect(await repository.listTenantRequests("tenant-a")).toMatchObject([{ id: request.id, connectionId, callSessionId: "call-1" }]);
      await expect(client.query("update provider_usage_requests set connection_id = null"))
        .rejects.toThrow("provider usage records are immutable");
      await expect(client.query("update provider_usage_connections set call_session_id = 'other'"))
        .rejects.toThrow("provider connection records are immutable");
    });
  });
});

async function withSchema(run: (client: import("pg").PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
  const client = await pool.connect();
  const schema = `attribution_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`create schema ${schema}`);
    await client.query(`set search_path to ${schema}`);
    for (const name of ["0037_provider_usage_recording", "0038_provider_usage_connections", "0039_provider_usage_attribution"]) {
      await client.query(readFileSync(`apps/api/src/database/migrations/${name}.sql`, "utf8"));
    }
    await run(client);
  } finally {
    await client.query("rollback");
    await client.query("set search_path to public");
    await client.query(`drop schema ${schema} cascade`);
    client.release();
    await pool.end();
  }
}
