import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const migrationPath = resolve(
  repositoryRoot,
  "apps/api/src/database/migrations/0027_lowly_maginty.sql",
);
const rollbackPath = resolve(
  repositoryRoot,
  "docs/Runbooks/rollback-0027-billing-charge-release.sql",
);

describe("billing charge release migration", () => {
  it("creates an empty fail-closed production release control table", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const database = newDb();
    database.public.none(`
      create table billing_price_catalogs (id text primary key);
      insert into billing_price_catalogs values ('catalog-v1');
    `);

    database.public.none(migration.replaceAll("--> statement-breakpoint", ""));

    expect(database.public.many(
      "select * from billing_charge_release_controls",
    )).toEqual([]);
    expect(() => database.public.none(`insert into billing_charge_release_controls (
      environment,catalog_id,release_id,approval_id,approved_by,approved_at,
      approval_expires_at,internal_canary_completed_at,internal_canary_expires_at,
      selected_tenant_canary_completed_at,selected_tenant_canary_expires_at,
      reconciliation_completed_at,reconciliation_expires_at,drills_completed_at,
      drills_expires_at,delivery_stopped,updated_at
    ) values (
      'sandbox','catalog-v1','release-248','approval-248','owner',now(),now()+interval '1 day',
      now(),now()+interval '1 day',now(),now()+interval '1 day',now(),now()+interval '1 day',
      now(),now()+interval '1 day',false,now()
    )`)).toThrow();
  });

  it("ships a transaction-wrapped rollback that refuses to delete release evidence", async () => {
    const rollback = await readFile(rollbackPath, "utf8");
    expect(rollback.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(rollback).toContain("Rollback 0027 blocked");
    expect(rollback.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
