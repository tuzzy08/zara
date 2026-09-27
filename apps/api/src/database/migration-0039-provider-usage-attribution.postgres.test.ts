import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("provider usage attribution guards", () => {
  it("saves concurrent final usage once and rejects changed results and scope", async () => {
    await withSchema(async (client, parallel) => {
      const repositories = [client, parallel].map(database => new ProviderUsageRecordingRepository(database));
      const scope = { organizationId: "tenant-a", sessionId: "premium-1", externalScopeId: "proj-shared",
        provider: "openai", model: "gpt-realtime-2.1", occurredAt: "2026-09-08T23:59:59Z" };
      const connectionId = await repositories[0]!.beginConnection({ ...scope, callSessionId: "call-1" });
      const input = { ...scope, connectionId };
      const result = { providerRequestId: "response-1", totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 } };
      const saved = await Promise.all(repositories.map(repository => repository.beginObserved(input, "response-1", result)));
      expect(saved[0]).toEqual(saved[1]);
      const replay = await repositories[1]!.beginObserved({ ...input, occurredAt: "2026-09-09T00:00:01Z" }, "response-1", result);
      expect(replay.occurredAt).toBe("2026-09-08T23:59:59.000Z");
      const conflicts = await Promise.allSettled([
        repositories[0]!.beginObserved(input, "response-1", { ...result, totals: { inputTokens: 99 } }),
        repositories[1]!.beginObserved({ ...input, model: "changed" }, "response-1", result),
      ]);
      expect(conflicts.map(value => value.status)).toEqual(["rejected", "rejected"]);
      await expect(repositories[1]!.beginObserved({ ...input, organizationId: "tenant-b" }, "response-1", result)).rejects.toThrow();
      expect(await repositories[0]!.listTenantRequests("tenant-a")).toMatchObject([{ connectionId, callSessionId: "call-1",
        result: { ...result, occurredAt: "2026-09-08T23:59:59.000Z" } }]);
      expect(await repositories[1]!.listTenantRequests("tenant-b")).toEqual([]);

      await repositories[0]!.beginObserved(input, "response-2");
      const raced = await Promise.allSettled(repositories.map((repository, index) => repository.beginObserved(input,
        "response-2", { providerRequestId: "response-2", totals: { inputTokens: index + 1 } })));
      expect(raced.map(value => value.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(await repositories[0]!.listTenantRequests("tenant-a")).toHaveLength(2);
    });
  });
  it("keeps a committed final update when its acknowledgement is lost and accepts an exact retry", async () => {
    await withSchema(async (client, parallel) => {
      const repository = new ProviderUsageRecordingRepository(client);
      const input = { organizationId: "tenant-a", sessionId: "premium-1", externalScopeId: "proj-shared",
        provider: "openai", model: "gpt-realtime-2.1", occurredAt: "2026-09-08T23:59:59.000Z" };
      await repository.beginObserved(input, "response-1");
      const database = { query: async (...args: Parameters<typeof client.query>) => {
        const result = await client.query(...args);
        if (String(args[0]).startsWith("update provider_usage_requests")) throw new Error("acknowledgement lost");
        return result;
      } } as Pick<typeof client, "query">;
      const result = { providerRequestId: "response-1", totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 } };
      await expect(new ProviderUsageRecordingRepository(database).beginObserved(input, "response-1", result))
        .rejects.toThrow("acknowledgement lost");
      const restarted = new ProviderUsageRecordingRepository(parallel);
      await restarted.beginObserved({ ...input, occurredAt: "2026-09-09T00:00:01.000Z" }, "response-1", result);
      expect(await restarted.listTenantRequests("tenant-a")).toMatchObject([{ result: { ...result, occurredAt: input.occurredAt } }]);
    });
  });
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

async function withSchema(run: (client: import("pg").PoolClient, parallel: import("pg").PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
  const client = await pool.connect();
  const parallel = await pool.connect();
  const schema = `attribution_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`create schema ${schema}`);
    await client.query(`set search_path to ${schema}`);
    await parallel.query(`set search_path to ${schema}`);
    for (const name of ["0037_provider_usage_recording", "0038_provider_usage_connections", "0039_provider_usage_attribution"]) {
      await client.query(readFileSync(`apps/api/src/database/migrations/${name}.sql`, "utf8"));
    }
    await run(client, parallel);
  } finally {
    await client.query("rollback");
    await client.query("set search_path to public");
    await parallel.query("rollback");
    await parallel.query("set search_path to public");
    await client.query(`drop schema ${schema} cascade`);
    client.release();
    parallel.release();
    await pool.end();
  }
}
