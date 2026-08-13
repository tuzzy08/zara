import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("subscription reservation migration 0023", () => {
  it("adds pinned plan and separate platform risk and reservation state", () => {
    const migration = readFileSync(
      resolve(root, "apps/api/src/database/migrations/0023_subscription_reservations.sql"),
      "utf8",
    );

    expect(migration).toContain('ADD COLUMN "plan_slug" text');
    expect(migration).toContain('CREATE TABLE "billing_platform_risk_limits"');
    expect(migration).toContain('CREATE TABLE "billing_subscription_reservation_accounts"');
    expect(migration).toContain('CREATE TABLE "billing_subscription_call_reservations"');
    expect(migration).toContain('CREATE UNIQUE INDEX "billing_subscription_call_reservations_tenant_key_unique"');
  });
});
