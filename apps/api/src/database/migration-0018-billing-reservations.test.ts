import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const migrationPath = "apps/api/src/database/migrations/0018_dear_pretty_boy.sql";
const finalizationMigrationPath = "apps/api/src/database/migrations/0020_secret_dreadnoughts.sql";
const releaseMigrationPath = "apps/api/src/database/migrations/0021_ambiguous_trauma.sql";
const catalogPinMigrationPath = "apps/api/src/database/migrations/0022_billing_reservation_catalog_pin.sql";
const rollbackPath = "docs/Runbooks/rollback-0018-billing-reservations.sql";

describe("billing reservation migration 0018", () => {
  it("creates reservation tables and rolls them back before the billing foundation", () => {
    const migration = readFileSync(resolve(repositoryRoot, migrationPath), "utf8");
    const finalizationMigration = readFileSync(
      resolve(repositoryRoot, finalizationMigrationPath),
      "utf8",
    );
    const releaseMigration = readFileSync(
      resolve(repositoryRoot, releaseMigrationPath),
      "utf8",
    );
    const catalogPinMigration = readFileSync(
      resolve(repositoryRoot, catalogPinMigrationPath),
      "utf8",
    );
    const rollback = readFileSync(resolve(repositoryRoot, rollbackPath), "utf8");
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/migration-check.yml"),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "billing_reservation_accounts"');
    expect(migration).toContain('CREATE TABLE "billing_charge_reservations"');
    expect(finalizationMigration).toContain('ADD COLUMN "actual_amount_minor" bigint');
    expect(finalizationMigration).toContain('ADD COLUMN "session_id" text');
    expect(finalizationMigration).toContain('ADD COLUMN "finalized_at" timestamp with time zone');
    expect(finalizationMigration).toContain("in ('active', 'expired', 'finalized')");
    expect(releaseMigration).toContain('ADD COLUMN "released_at" timestamp with time zone');
    expect(releaseMigration).toContain("in ('active', 'expired', 'finalized', 'released')");
    expect(catalogPinMigration).toContain('ADD COLUMN "catalog_id" text');
    expect(catalogPinMigration).toContain('billing_charge_reservations_catalog_id_billing_price_catalogs_id_fk');
    expect(catalogPinMigration).toContain("New billing reservations require a catalog pin");
    expect(catalogPinMigration).toContain("NEW.catalog_id IS DISTINCT FROM OLD.catalog_id");
    expect(catalogPinMigration).toContain("billing_charge_reservations_catalog_pin_trigger");
    expect(rollback).toContain('DROP TABLE IF EXISTS "billing_charge_reservations"');
    expect(rollback).toContain('DROP TABLE IF EXISTS "billing_reservation_accounts"');
    expect(workflow).toContain(rollbackPath);
    expect(workflow.indexOf("await pool.query(billingReservationRollback);")).toBeLessThan(
      workflow.indexOf("await pool.query(billingRollback);"),
    );
  });
});
