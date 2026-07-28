import type { Pool } from "pg";
import { newDb } from "pg-mem";
import { afterEach, describe, expect, it } from "vitest";

import { PostgresPstnCapacityRejectionRepository } from "./postgres-pstn-capacity-rejection.repository";

describe("PostgresPstnCapacityRejectionRepository", () => {
  let pool: Pool | null = null;

  afterEach(async () => {
    await pool?.end();
    pool = null;
  });

  it("persists idempotent tenant-scoped rejection history newest first", async () => {
    pool = await createPool();
    const repository = new PostgresPstnCapacityRejectionRepository(pool);
    const earlier = {
      id: "rejection-a",
      tenantId: "tenant-a",
      reasonCode: "tenant_concurrency_limit" as const,
      occurredAt: "2026-07-28T09:59:00.000Z",
    };
    const later = {
      id: "rejection-b",
      tenantId: "tenant-a",
      reasonCode: "provider_account_concurrency_limit" as const,
      occurredAt: "2026-07-28T10:00:00.000Z",
    };

    await repository.insert(earlier);
    await repository.insert(later);
    await repository.insert(later);
    await repository.insert({
      ...later,
      id: "rejection-other",
      tenantId: "tenant-b",
      occurredAt: "2026-07-28T09:58:30.000Z",
    });

    await expect(repository.listForTenant("tenant-a", 10)).resolves.toEqual([
      later,
      earlier,
    ]);
    await expect(repository.listRecent(2)).resolves.toEqual([
      later,
      earlier,
    ]);
  });
});

async function createPool() {
  const database = newDb({ noAstCoverageCheck: true });
  const pg = database.adapters.createPg();
  const candidate = new pg.Pool() as Pool;
  await candidate.query(`
    create table pstn_capacity_rejections (
      id text primary key,
      tenant_id text not null,
      reason_code text not null,
      occurred_at timestamptz not null
    );
  `);
  return candidate;
}
