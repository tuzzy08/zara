import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("telephony migration rollback chain", () => {
  it("reverses premium ownership before contracting incremental identities", async () => {
    const [workflow, ownerLeaseRollback, premiumOwnershipRollback] = await Promise.all([
      readFile(resolve(repositoryRoot, ".github/workflows/migration-check.yml"), "utf8"),
      readFile(
        resolve(
          repositoryRoot,
          "docs/Runbooks/rollback-0015-telephony-premium-owner-lease.sql",
        ),
        "utf8",
      ),
      readFile(
        resolve(
          repositoryRoot,
          "docs/Runbooks/rollback-0014-telephony-premium-dispatch-ownership.sql",
        ),
        "utf8",
      ),
    ]);

    expect(ownerLeaseRollback).toContain('DROP COLUMN IF EXISTS "owner_lease_expires_at"');
    expect(premiumOwnershipRollback).toContain(
      'DROP TABLE IF EXISTS "telephony_premium_dispatch_snapshots"',
    );
    expect(premiumOwnershipRollback).toContain(
      'DROP CONSTRAINT IF EXISTS "telephony_media_stream_tokens_owner_pair_check"',
    );
    expect(premiumOwnershipRollback).toContain(
      'DROP CONSTRAINT IF EXISTS "telephony_media_stream_tokens_owner_epoch_check"',
    );
    expect(premiumOwnershipRollback).toContain('DROP COLUMN IF EXISTS "owner_worker_id"');
    expect(premiumOwnershipRollback).toContain('DROP COLUMN IF EXISTS "owner_epoch"');

    const rollbackExecutionOrder = [
      "await pool.query(premiumOwnerLeaseRollback);",
      "await pool.query(premiumDispatchOwnershipRollback);",
      "await pool.query(abusePostureRollback);",
      "await pool.query(obsoleteDedupeRollback);",
      "await pool.query(tenantCompositeIdentityRollback);",
      "await pool.query(lifecycleRollback);",
      "await pool.query(incrementalRollback);",
    ].map((step) => workflow.indexOf(step));

    expect(rollbackExecutionOrder.every((position) => position >= 0)).toBe(true);
    expect(rollbackExecutionOrder).toEqual(
      [...rollbackExecutionOrder].sort((left, right) => left - right),
    );
    expect(workflow).toContain(
      "to_regclass('telephony_premium_dispatch_snapshots') as premium_snapshot_table",
    );
    expect(workflow).toContain("row.premium_snapshot_table !== null");
  });
});
