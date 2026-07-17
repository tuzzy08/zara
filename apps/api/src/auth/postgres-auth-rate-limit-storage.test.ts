import { newDb } from "pg-mem";
import { afterEach, describe, expect, it } from "vitest";

import { createPostgresAuthRateLimitStorage } from "./postgres-auth-rate-limit-storage";

describe("Postgres Better Auth rate-limit storage", () => {
  const pools: Array<{ end(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it("atomically creates one row for concurrent first requests", async () => {
    const pool = await createRateLimitPool();
    pools.push(pool);
    const storage = createPostgresAuthRateLimitStorage(pool as never);

    await Promise.all(Array.from({ length: 12 }, () => storage.set("ip|/get-session", {
      key: "ip|/get-session",
      count: 1,
      lastRequest: 1_721_234_567_890,
    })));

    await expect(storage.get("ip|/get-session")).resolves.toMatchObject({
      key: "ip|/get-session",
      count: 12,
      lastRequest: 1_721_234_567_890,
    });
  });

  it("increments from the stored count instead of a stale concurrent read", async () => {
    const pool = await createRateLimitPool();
    pools.push(pool);
    const storage = createPostgresAuthRateLimitStorage(pool as never);
    await storage.set("ip|/get-session", {
      key: "ip|/get-session",
      count: 1,
      lastRequest: 1_721_234_567_890,
    });

    await Promise.all(Array.from({ length: 8 }, () => storage.set("ip|/get-session", {
      key: "ip|/get-session",
      count: 2,
      lastRequest: 1_721_234_567_999,
    }, true)));

    await expect(storage.get("ip|/get-session")).resolves.toMatchObject({
      key: "ip|/get-session",
      count: 9,
      lastRequest: 1_721_234_567_999,
    });
  });

  it("resets one expired generation and counts every concurrent stale writer", async () => {
    const pool = await createRateLimitPool();
    pools.push(pool);
    const storage = createPostgresAuthRateLimitStorage(pool as never);
    await storage.set("ip|/get-session", {
      key: "ip|/get-session",
      count: 5,
      lastRequest: 1_721_234_567_890,
    });
    const staleBucket = await storage.get("ip|/get-session");
    expect(staleBucket).not.toBeNull();
    expect(staleBucket).toMatchObject({ id: expect.any(String) });

    await Promise.all(Array.from({ length: 8 }, (_, index) => storage.set(
      "ip|/get-session",
      {
        ...staleBucket!,
        count: 1,
        lastRequest: 1_721_234_627_891 + index,
      },
      true,
    )));

    await expect(storage.get("ip|/get-session")).resolves.toMatchObject({
      key: "ip|/get-session",
      count: 8,
      lastRequest: 1_721_234_627_898,
    });
  });

  it("does not move the window timestamp backward for a delayed stale write", async () => {
    const pool = await createRateLimitPool();
    pools.push(pool);
    const storage = createPostgresAuthRateLimitStorage(pool as never);
    await storage.set("ip|/get-session", {
      key: "ip|/get-session",
      count: 1,
      lastRequest: 300,
    });

    await storage.set("ip|/get-session", {
      key: "ip|/get-session",
      count: 2,
      lastRequest: 200,
    }, true);

    await expect(storage.get("ip|/get-session")).resolves.toMatchObject({
      key: "ip|/get-session",
      count: 2,
      lastRequest: 300,
    });
  });
});

async function createRateLimitPool() {
  const database = newDb();
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();
  await pool.query(`
    CREATE TABLE "rateLimit" (
      "id" text PRIMARY KEY,
      "key" text NOT NULL,
      "count" integer NOT NULL,
      "lastRequest" bigint NOT NULL
    );
    CREATE UNIQUE INDEX "auth_rate_limit_key_unique_idx" ON "rateLimit" ("key");
  `);
  return pool;
}
