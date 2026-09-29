import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { defaultRuntimePromptPolicy } from "../runtime-prompt-policy/runtime-prompt-policy.models";
import { PostgresRuntimePromptPolicyRepository } from "../runtime-prompt-policy/runtime-prompt-policy.repository";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("runtime prompt policy revision storage", () => {
  it("allows one concurrent expected-version write and keeps revisions immutable", async () => {
    const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    const schema = `prompt_policy_test_${randomUUID().replaceAll("-", "")}`;
    try {
      await clients[0]!.query(`create schema ${schema}`);
      for (const client of clients) await client.query(`set search_path to ${schema}`);
      await clients[0]!.query(readFileSync(
        "apps/api/src/database/migrations/0040_runtime_prompt_policy_revisions.sql",
        "utf8",
      ));
      const repositories = clients.map((client) => new PostgresRuntimePromptPolicyRepository(client));
      await Promise.all(repositories.map((repository) =>
        repository.loadOrCreateInitial(defaultRuntimePromptPolicy)));
      const policies = ["First revision.", "Second revision."].map((guardrail) => ({
        ...defaultRuntimePromptPolicy,
        version: 2,
        guardrails: [guardrail],
      }));

      const saved = await Promise.all(repositories.map((repository, index) =>
        repository.save(policies[index]!, 1)));

      expect(saved.filter(Boolean)).toHaveLength(1);
      expect((await repositories[0]!.loadRevision(1))?.guardrails)
        .toEqual(defaultRuntimePromptPolicy.guardrails);
      const firstPin = await repositories[0]!.pinCurrentRevision("pstn:tenant-a:call-a");
      await repositories[0]!.save({ ...policies[0]!, version: 3 }, 2);
      expect(await repositories[1]!.pinCurrentRevision("pstn:tenant-a:call-a")).toEqual(firstPin);
      await expect(clients[0]!.query("update runtime_prompt_policy_session_pins set revision = 3"))
        .rejects.toThrow("runtime prompt policy session pins are immutable");
      await expect(clients[0]!.query("delete from runtime_prompt_policy_session_pins"))
        .rejects.toThrow("runtime prompt policy session pins are immutable");
      expect((await repositories[0]!.load())?.version).toBe(3);
      await expect(clients[0]!.query("update runtime_prompt_policy_revisions set policy = '{}'"))
        .rejects.toThrow("runtime prompt policy revisions are immutable");
    } finally {
      for (const client of clients) await client.query("set search_path to public");
      await clients[0]!.query(`drop schema ${schema} cascade`);
      for (const client of clients) client.release();
      await pool.end();
    }
  });

  it("persists an imported revision seven as the restart baseline", async () => {
    const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    const client = await pool.connect();
    const schema = `prompt_policy_import_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema ${schema}`);
      await client.query(`set search_path to ${schema}`);
      await client.query(readFileSync(
        "apps/api/src/database/migrations/0040_runtime_prompt_policy_revisions.sql",
        "utf8",
      ));
      const repository = new PostgresRuntimePromptPolicyRepository(client);
      const legacyPolicy = {
        ...defaultRuntimePromptPolicy,
        version: 7,
        guardrails: ["Imported operator policy."],
      };

      await repository.loadOrCreateInitial(legacyPolicy);
      await repository.loadOrCreateInitial(defaultRuntimePromptPolicy);

      expect(await repository.load()).toEqual(legacyPolicy);
      expect(await repository.loadRevision(1)).toBeNull();
    } finally {
      await client.query("set search_path to public");
      await client.query(`drop schema ${schema} cascade`);
      client.release();
      await pool.end();
    }
  });
});
