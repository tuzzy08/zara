import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresBillingReconciliationReportRepository } from "./billing-reconciliation-report.repository";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("reconciliation delivery scope", () => {
  it("reads eligibility from the latest stored decision and keeps all usage facts", async () => {
    const schema = `reconciliation_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    await admin.query(`create schema ${schema}`);
    const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL, options: `-c search_path=${schema}` });
    try {
      await pool.query(`
        create table billing_ledger_entries (tenant_id text, id text, entry_type text, quantity bigint,
          customer_amount_minor bigint, metadata jsonb, occurred_at timestamptz, unit text);
        create table billing_outbox (tenant_id text, id text, aggregate_type text, aggregate_id text,
          status text, payload jsonb, created_at timestamptz);
        create table billing_payg_orders (tenant_id text, id text, status text, paid_amount_minor bigint,
          granted_credit_minor bigint, created_at timestamptz);
        create table billing_payg_credit_entries (tenant_id text, id text, order_id text, entry_type text,
          amount_minor bigint, created_at timestamptz);
        create table billing_charge_reservations (tenant_id text, id text, status text, created_at timestamptz,
          expires_at timestamptz, finalized_at timestamptz, released_at timestamptz, reserved_amount_minor bigint,
          actual_amount_minor bigint);
        create table telephony_execution_sessions (tenant_id text, call_session_id text, dispatch_id text, lifecycle_state jsonb);
        create table telephony_dispatches (tenant_id text, id text, runtime_path text);
      `);
      await pool.query(readFileSync("apps/api/src/database/migrations/0041_billing_delivery_decisions.sql", "utf8").replaceAll('"public".', `"${schema}".`));
      await pool.query(`insert into billing_delivery_decisions(id,enabled,catalog_id,release_id,actor_user_id,reason)
        values ('old',true,'catalog','release','owner','Enable'), ('new',true,'catalog','release','owner','Enable again')`);
      for (const [id, decisionId, mode, status] of [
        ["shadow", null, "shadow", "pending"], ["old-pending", "old", "charge", "pending"],
        ["old-delivered", "old", "charge", "delivered"], ["new-pending", "new", "charge", "pending"],
      ]) {
        await pool.query(`insert into billing_ledger_entries values
          ('tenant-a',$1,'runtime_charge',60,100,'{"billingClass":"standard_runtime_seconds"}','2026-09-27T01:00:00Z','second')`, [id]);
        await pool.query(`insert into billing_outbox values ('tenant-a',$1,'billing_ledger_entry',$1,$2,$3::jsonb,'2026-09-27T01:00:00Z',$4)`,
          [id, status, JSON.stringify({ meterKey: "standard_runtime_seconds", quantity: 60, deliveryMode: mode }), decisionId]);
      }
      const repository = new PostgresBillingReconciliationReportRepository(pool);
      const scope = { organizationId: "tenant-a", cycleStartsAt: "2026-09-27T00:00:00Z", cycleEndsAt: "2026-09-28T00:00:00Z" };
      const evidence = await repository.loadLocalCycleEvidence(scope);
      expect(evidence.ledger).toHaveLength(4);
      expect(evidence.outbox.filter(entry => entry.deliveryEligible).map(entry => entry.id)).toEqual(["new-pending"]);
      expect(evidence.outbox.find(entry => entry.id === "old-delivered")?.status).toBe("delivered");
      await pool.query(`insert into billing_delivery_decisions(id,enabled,actor_user_id,reason) values ('stop',false,'owner','Stop')`);
      expect((await repository.loadLocalCycleEvidence(scope)).outbox.some(entry => entry.deliveryEligible)).toBe(false);
      expect((await repository.loadLocalCycleEvidence({ ...scope, organizationId: "tenant-b" })).outbox).toEqual([]);
    } finally {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  }, 30_000);
});
