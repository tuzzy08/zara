import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { TenantSessionBillingAudit } from "./tenant-session-billing-audit";

const cycle = { organizationId: "tuzzy-test", cycleStartsAt: "2026-08-01T00:00:00.000Z",
  cycleEndsAt: "2026-09-01T00:00:00.000Z" };

async function fixture() {
  const db = newDb();
  db.public.none(`
    create table telephony_execution_sessions (tenant_id text, call_session_id text,
      dispatch_id text, lifecycle_state jsonb);
    create table telephony_dispatches (tenant_id text, id text, runtime_path text);
    create table billing_ledger_entries (tenant_id text, id text, entry_type text,
      quantity bigint, unit text, occurred_at timestamptz, metadata jsonb);
  `);
  const pool = new (db.adapters.createPg().Pool)();
  for (const [tenant, seconds] of [["tuzzy-test", 60], ["zara-ai-test", 120]] as const) {
    await pool.query("insert into telephony_dispatches values ($1, 'dispatch-1', 'pstn-sandwich')", [tenant]);
    await pool.query("insert into telephony_execution_sessions values ($1, 'call-1', 'dispatch-1', $2)",
      [tenant, { stage: "completed", providerConnectedAt: "2026-08-03T10:00:00.000Z",
        observedAt: new Date(Date.parse("2026-08-03T10:00:00.000Z") + seconds * 1000).toISOString() }]);
    await pool.query("insert into billing_ledger_entries values ($1, 'ledger-1', 'runtime_charge', $2, 'second', '2026-08-03T10:02:00Z', $3)",
      [tenant, seconds, { callSessionId: "call-1", billingClass: "standard_runtime_seconds" }]);
  }
  return pool;
}

describe("tenant session billing audit", () => {
  it("checks a failed call that never connected as zero runtime", async () => {
    const pool = await fixture();
    try {
      await pool.query("update telephony_execution_sessions set lifecycle_state = $1 where tenant_id = 'tuzzy-test'",
        [{ stage: "failed", observedAt: "2026-08-03T10:01:00.000Z" }]);
      await pool.query("update billing_ledger_entries set quantity = 0 where tenant_id = 'tuzzy-test'");
      expect(await new TenantSessionBillingAudit(pool).auditCycle(cycle)).toMatchObject({
        status: "matched", runtimeSeconds: 0, ledgerSeconds: 0, issues: [],
      });
    } finally { await pool.end(); }
  });

  it("rejects reversed or partial-day periods", async () => {
    const pool = await fixture();
    try {
      const audit = new TenantSessionBillingAudit(pool);
      await expect(audit.auditCycle({ ...cycle, cycleEndsAt: cycle.cycleStartsAt })).rejects.toThrow("Invalid tenant audit period.");
      await expect(audit.auditCycle({ ...cycle, cycleStartsAt: "2026-08-01T12:00:00.000Z" })).rejects.toThrow("Invalid tenant audit period.");
    } finally { await pool.end(); }
  });
  it("does not qualify an empty tenant period", async () => {
    const pool = await fixture();
    try {
      expect(await new TenantSessionBillingAudit(pool).auditCycle({ ...cycle, organizationId: "empty" }))
        .toMatchObject({ status: "incomplete", issues: ["no_session_evidence"] });
    } finally { await pool.end(); }
  });

  it("keeps a missing successful-call connection time incomplete", async () => {
    const pool = await fixture();
    try {
      await pool.query("update telephony_execution_sessions set lifecycle_state = $1 where tenant_id = 'tuzzy-test'",
        [{ stage: "completed", observedAt: "2026-08-03T10:01:00.000Z" }]);
      const result = await new TenantSessionBillingAudit(pool).auditCycle(cycle);
      expect(result.status).toBe("incomplete");
      expect(result.issues).toContain("session_duration_missing");
      expect(result.runtimeSeconds).toBeNull();
    } finally { await pool.end(); }
  });
  it("detects swapped per-session quantities even when the sum matches", async () => {
    const pool = await fixture();
    try {
      await pool.query("insert into telephony_execution_sessions values ('tuzzy-test', 'call-2', 'dispatch-1', $1)",
        [{ stage: "completed", providerConnectedAt: "2026-08-03T10:00:00.000Z", observedAt: "2026-08-03T10:02:00.000Z" }]);
      await pool.query("update billing_ledger_entries set quantity = 120 where tenant_id = 'tuzzy-test'");
      await pool.query("insert into billing_ledger_entries values ('tuzzy-test', 'ledger-2', 'runtime_charge', 60, 'second', '2026-08-03T10:02:00Z', $1)",
        [{ callSessionId: "call-2", billingClass: "standard_runtime_seconds" }]);
      expect(await new TenantSessionBillingAudit(pool).auditCycle(cycle)).toMatchObject({
        status: "mismatch", runtimeSeconds: 180, ledgerSeconds: 180, issues: ["runtime_quantity_mismatch"],
      });
    } finally { await pool.end(); }
  });
  it.each([
    ["update billing_ledger_entries set quantity = 59 where tenant_id = 'tuzzy-test'", "runtime_quantity_mismatch"],
    ["insert into billing_ledger_entries select * from billing_ledger_entries where tenant_id = 'tuzzy-test'", "session_ledger_duplicate"],
    ["update billing_ledger_entries set unit = 'minute' where tenant_id = 'tuzzy-test'", "runtime_meter_mismatch"],
    ["update telephony_dispatches set runtime_path = 'pstn-premium-realtime' where tenant_id = 'tuzzy-test'", "runtime_meter_mismatch"],
  ])("rejects incorrect runtime ledger facts: %s", async (sql, issue) => {
    const pool = await fixture();
    try {
      await pool.query(sql);
      const result = await new TenantSessionBillingAudit(pool).auditCycle(cycle);
      expect(result.status).toBe("mismatch");
      expect(result.issues).toContain(issue);
    } finally { await pool.end(); }
  });
  it("rejects the wrong session even when tenant totals are equal", async () => {
    const pool = await fixture();
    try {
      await pool.query("update billing_ledger_entries set metadata = $1 where tenant_id = $2",
        [{ callSessionId: "other-call", billingClass: "standard_runtime_seconds" }, cycle.organizationId]);
      expect(await new TenantSessionBillingAudit(pool).auditCycle(cycle)).toMatchObject({
        status: "mismatch", issues: ["session_ledger_missing", "ledger_session_missing"],
      });
    } finally { await pool.end(); }
  });
  it("checks each tenant independently even when session IDs are the same", async () => {
    const pool = await fixture();
    try {
      const audit = new TenantSessionBillingAudit(pool);
      expect(await audit.auditCycle(cycle)).toMatchObject({ status: "matched", sessionCount: 1,
        runtimeSeconds: 60, ledgerSeconds: 60, issues: [] });
      expect(await audit.auditCycle({ ...cycle, organizationId: "zara-ai-test" }))
        .toMatchObject({ status: "matched", runtimeSeconds: 120, ledgerSeconds: 120, issues: [] });
    } finally { await pool.end(); }
  });
});
