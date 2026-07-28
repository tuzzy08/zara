import type { Pool } from "pg";
import { DataType, newDb } from "pg-mem";
import { afterEach, describe, expect, it } from "vitest";

import type {
  PstnCapacityPolicy,
  PstnCapacityPolicyAuditEntry,
} from "./pstn-capacity-policy.models";
import {
  PostgresPstnCapacityPolicyRepository,
} from "./postgres-pstn-capacity-policy.repository";

describe("PostgresPstnCapacityPolicyRepository", () => {
  let pool: Pool | null = null;

  afterEach(async () => {
    await pool?.end();
    pool = null;
  });

  it("atomically saves policy and before/after audit with optimistic concurrency", async () => {
    pool = await createPool();
    const repository = new PostgresPstnCapacityPolicyRepository(pool);
    const policy = samplePolicy(2);
    const audit = sampleAudit(policy);

    await expect(
      repository.save({
        expectedVersion: 1,
        policy,
        audit,
      }),
    ).resolves.toBe(true);
    await expect(repository.load()).resolves.toEqual(policy);
    await expect(repository.listAudit(10)).resolves.toEqual([audit]);

    await expect(
      repository.save({
        expectedVersion: 1,
        policy: samplePolicy(3),
        audit: sampleAudit(samplePolicy(3)),
      }),
    ).resolves.toBe(false);

    expect(
      (await pool.query("select count(*)::int as count from pstn_capacity_policy_audit"))
        .rows[0]?.count,
    ).toBe(1);
  });
});

async function createPool() {
  const database = newDb({ noAstCoverageCheck: true });
  database.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  const pg = database.adapters.createPg();
  const candidate = new pg.Pool() as Pool;
  await candidate.query(`
    create table pstn_capacity_policy (
      id text primary key,
      version integer not null,
      policy jsonb not null,
      updated_by text not null,
      updated_at timestamptz not null
    );
    create table pstn_capacity_policy_audit (
      id text primary key,
      policy_version integer not null unique,
      actor_user_id text not null,
      reason text not null,
      before_policy jsonb not null,
      after_policy jsonb not null,
      occurred_at timestamptz not null
    );
  `);
  return candidate;
}

function samplePolicy(version: number): PstnCapacityPolicy {
  return {
    schemaVersion: 1,
    version,
    limits: {
      global: 20,
      provider: 20,
      tenantDefault: 10,
      worker: 10,
      runtime: {
        "pstn-sandwich": 20,
        "pstn-premium-realtime": 10,
      },
    },
    cps: {
      global: { capacity: 10, refillPerSecond: 10 },
      providerAccount: { capacity: 5, refillPerSecond: 5 },
    },
    providerQuotas: { twilio: 20 },
    providerAccountQuotas: {},
    tenantAllowances: {},
    workerLimits: {},
    temporaryReductions: [],
    updatedBy: "admin-1",
    updatedAt: "2026-07-28T10:00:00.000Z",
  };
}

function sampleAudit(policy: PstnCapacityPolicy): PstnCapacityPolicyAuditEntry {
  return {
    id: `pstn-capacity-policy-${policy.version}`,
    policyVersion: policy.version,
    actorUserId: "admin-1",
    reason: "Operational reduction.",
    before: samplePolicy(policy.version - 1),
    after: policy,
    occurredAt: "2026-07-28T10:00:00.000Z",
  };
}
