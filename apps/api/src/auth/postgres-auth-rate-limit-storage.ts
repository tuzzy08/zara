import { randomUUID } from "node:crypto";
import type { BetterAuthRateLimitOptions } from "better-auth";
import type { Pool } from "pg";

type BetterAuthRateLimitStorage = NonNullable<BetterAuthRateLimitOptions["customStorage"]>;

interface StoredRateLimit {
  id: string;
  key: string;
  count: number;
  lastRequest: string | number;
}

export function createPostgresAuthRateLimitStorage(
  pool: Pick<Pool, "query">,
): BetterAuthRateLimitStorage {
  return {
    async get(key) {
      const result = await pool.query<StoredRateLimit>(`
        SELECT "id", "key", "count", "lastRequest"
        FROM "rateLimit"
        WHERE "key" = $1
        LIMIT 1
      `, [key]);
      const row = result.rows[0];
      if (row === undefined) return null;
      const storedValue = {
        id: row.id,
        key: row.key,
        count: row.count,
        lastRequest: Number(row.lastRequest),
      };
      return storedValue;
    },
    async set(key, value, update = false) {
      const observedId = readObservedGenerationId(value);
      const resetGeneration = update && value.count === 1 && observedId !== undefined;
      await pool.query(`
        INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE
            WHEN $5 = TRUE AND "rateLimit"."id" = $6 THEN 1
            ELSE "rateLimit"."count" + 1
          END,
          "lastRequest" = CASE
            WHEN "rateLimit"."lastRequest" > EXCLUDED."lastRequest"
              THEN "rateLimit"."lastRequest"
            ELSE EXCLUDED."lastRequest"
          END,
          "id" = CASE
            WHEN $5 = TRUE AND "rateLimit"."id" = $6 THEN EXCLUDED."id"
            ELSE "rateLimit"."id"
          END
      `, [randomUUID(), key, value.count, value.lastRequest, resetGeneration, observedId ?? ""]);
    },
  };
}

function readObservedGenerationId(value: object) {
  const id = "id" in value ? value.id : undefined;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
