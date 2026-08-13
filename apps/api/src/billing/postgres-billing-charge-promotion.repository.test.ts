import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PostgresBillingChargePromotionRepository } from "./postgres-billing-charge-promotion.repository";

describe("PostgresBillingChargePromotionRepository", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(async () => {
    const database = newDb();
    database.public.none(`
      create table billing_ledger_entries (
        tenant_id text not null, id text not null, primary key (tenant_id,id)
      );
      create table billing_outbox (
        tenant_id text not null, id text not null, aggregate_id text not null,
        payload jsonb not null, status text not null, charge_release_id text,
        charge_promoted_at timestamptz, primary key (tenant_id,id)
      );
      create table billing_charge_promotion_records (
        tenant_id text not null, id text not null, outbox_id text not null,
        ledger_entry_id text not null, release_id text not null, catalog_id text not null,
        actor_user_id text not null, actor_role text not null, reason text not null,
        promoted_at timestamptz not null, created_at timestamptz not null,
        primary key (tenant_id,id), unique (tenant_id,outbox_id)
      );
      create table audit_logs (
        id text primary key, tenant_id text, actor_type text not null,
        actor_id text not null, action text not null, target_type text not null,
        target_id text, metadata jsonb not null, occurred_at timestamptz not null
      );
      insert into billing_ledger_entries values ('tenant-selected','ledger-1');
      insert into billing_outbox values (
        'tenant-selected','outbox-1','ledger-1',
        '{"deliveryMode":"shadow","ledgerEntryId":"ledger-1"}',
        'pending',null,null
      );
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => pool.end());

  it("atomically promotes one pending shadow event and appends evidence", async () => {
    const repository = new PostgresBillingChargePromotionRepository(pool);

    await expect(repository.promote(input())).resolves.toEqual({
      promotionId: "promotion-1",
      duplicate: false,
    });
    await expect(pool.query(`select payload,charge_release_id from billing_outbox`))
      .resolves.toMatchObject({ rows: [{
        payload: expect.objectContaining({ deliveryMode: "charge" }),
        charge_release_id: "release-248",
      }] });
    await expect(pool.query(`select id from billing_charge_promotion_records`))
      .resolves.toMatchObject({ rows: [{ id: "promotion-1" }] });
    await expect(pool.query(`select action from audit_logs`))
      .resolves.toMatchObject({ rows: [{ action: "billing.charge_event_promoted" }] });
  });

  it("rejects cross-tenant and historical event selection", async () => {
    const repository = new PostgresBillingChargePromotionRepository(pool);

    await expect(repository.promote(input({ organizationId: "tenant-other" })))
      .rejects.toThrow("The pending shadow outbox event was not found for this tenant.");
    await pool.query(`update billing_outbox set status='delivered'`);
    await expect(repository.promote(input()))
      .rejects.toThrow("Only a pending shadow outbox event can be promoted.");
  });

  it("returns an exact replay and rejects a changed replay", async () => {
    const repository = new PostgresBillingChargePromotionRepository(pool);
    await repository.promote(input());

    await expect(repository.promote(input())).resolves.toEqual({
      promotionId: "promotion-1",
      duplicate: true,
    });
    await expect(repository.promote(input({ ledgerEntryId: "ledger-changed" })))
      .rejects.toThrow("Charge promotion replay does not match the recorded evidence.");
  });

  it("rolls back promotion when the audit insert fails", async () => {
    const commands: string[] = [];
    const repository = new PostgresBillingChargePromotionRepository({
      connect: async () => ({
        query: async (sql: string, parameters?: unknown[]) => {
          commands.push(sql.trim());
          if (sql.includes("insert into audit_logs")) {
            throw new Error("audit insert failed");
          }
          return pool.query(sql, parameters);
        },
        release: () => undefined,
      }),
    } as never);

    await expect(repository.promote(input())).rejects.toThrow("audit insert failed");
    expect(commands).toContain("rollback");
    expect(commands).not.toContain("commit");
  });

  it("fails a replay when its atomic audit evidence is missing", async () => {
    const repository = new PostgresBillingChargePromotionRepository(pool);
    await repository.promote(input());
    await pool.query(`delete from audit_logs`);

    await expect(repository.promote(input())).rejects.toThrow(
      "Charge promotion audit evidence is missing or changed.",
    );
  });
});

function input(overrides: Record<string, unknown> = {}) {
  return {
    promotionId: "promotion-1",
    organizationId: "tenant-selected",
    outboxId: "outbox-1",
    ledgerEntryId: "ledger-1",
    releaseId: "release-248",
    catalogId: "catalog-v1",
    actorUserId: "billing-owner",
    actorRole: "billing_owner" as const,
    reason: "Selected tenant charge canary.",
    promotedAt: "2026-08-12T12:00:00.000Z",
    ...overrides,
  } as never;
}
