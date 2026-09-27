import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";
import { TrustedBillingUsageProducer } from "./trusted-billing-usage-producer";
import { TrustedSubscriptionCallLifecycleService } from "./trusted-subscription-call-lifecycle.service";
import { TrustedTerminalBillingRecoveryService } from "./trusted-terminal-billing-recovery.service";
import { TerminalBillingRecoveryRepository } from "./terminal-billing-recovery.repository";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("mixed settlement on PostgreSQL", () => {
  const schema = `mixed_settlement_${randomUUID().replaceAll("-", "")}`;
  const options = { connectionString: process.env.ZARA_TEST_POSTGRES_URL, options: `-c search_path=${schema}` };
  let admin: Pool;
  let pool: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    await admin.query(`create schema "${schema}"`);
    pool = new Pool(options);
    // Use migrated columns, defaults, checks and indexes; keep fixtures isolated.
    for (const table of ["billing_price_catalogs", "billing_subscriptions", "billing_cycles",
      "billing_entitlements", "billing_budget_policies", "billing_platform_risk_limits",
      "billing_ledger_entries", "billing_payg_credit_entries", "billing_outbox",
      "billing_delivery_decisions", "billing_reservation_accounts",
      "billing_subscription_reservation_accounts", "billing_subscription_overage_accounts",
      "billing_subscription_call_reservations", "billing_terminal_recovery_jobs"]) {
      await pool.query(`create table ${table} (like public.${table} including all)`);
    }
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog({
      id: "catalog-mixed", version: 1, status: "active", currency: "usd",
      effectiveFrom: "2026-09-01T00:00:00.000Z", checksum: "a".repeat(64),
      document: { plans: { starter: { includedStandardRuntimeSeconds: 60,
        includedPremiumRuntimeSeconds: 0, standardRuntimePerMinuteMinor: 15,
        premiumRuntimePerMinuteMinor: 40 } } },
      approvedBy: "owner", approvedAt: "2026-09-01T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    await pool.query(`
      insert into billing_subscriptions
        (tenant_id,id,provider_subscription_id,catalog_id,plan_slug,status,current_period_end)
        values ('tenant-mixed','subscription-mixed','polar-subscription','catalog-mixed','starter','active','2026-10-01T00:00:00Z');
      insert into billing_cycles (tenant_id,id,catalog_id,starts_at,ends_at,status)
        values ('tenant-mixed','cycle-mixed','catalog-mixed','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z','active');
      insert into billing_entitlements (tenant_id,id,key,status)
        values ('tenant-mixed','runtime','runtime_access','active');
      insert into billing_budget_policies
        (tenant_id,currency,overage_limit_minor,over_budget_behavior,warning_threshold_percent,updated_by,updated_at)
        values ('tenant-mixed','usd',60,'block',80,'owner','2026-09-01T00:00:00Z');
      insert into billing_platform_risk_limits (tenant_id,currency,overage_limit_minor,updated_by,updated_at)
        values ('tenant-mixed','usd',60,'owner','2026-09-01T00:00:00Z');
      insert into billing_payg_credit_entries (tenant_id,id,entry_type,amount_minor,idempotency_key,created_at)
        values ('tenant-mixed','paid-credit','grant',40,'paid-credit','2026-09-01T00:00:00Z');
      insert into billing_delivery_decisions (id,enabled,catalog_id,release_id,effective_at,actor_user_id,reason)
        values ('enable-mixed',true,'catalog-mixed','release-mixed','2026-09-27T09:00:00Z','owner','Test new usage');
    `);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  });

  it("recovers one dollar of usage as 40 prepaid cents and 60 invoice cents without a second debit", async () => {
    const lifecycle = new TrustedSubscriptionCallLifecycleService(pool);
    const repository = new PostgresBillingLedgerRepository(pool);
    const jobs = new TerminalBillingRecoveryRepository(pool);
    await expect(lifecycle.start({
      organizationId: "tenant-mixed", reservationKey: "call-mixed", meterClass: "standard",
      billingMode: "byo", provider: "twilio", direction: "inbound", maximumRuntimeSeconds: 460,
      now: "2026-09-27T10:00:00.000Z", expiresAt: "2026-09-27T10:10:00.000Z",
    })).resolves.toMatchObject({ outcome: "reserved", reservation: {
      reservedIncludedSeconds: 60, reservedPaygMinor: 40, reservedOverageMinor: 60,
    } });
    const unavailablePool = new Pool(options);
    await unavailablePool.end();
    const payg = { finalizeTerminalCall: async () => { throw new Error("Unexpected PAYG-only finalization."); } };
    const interrupted = new TrustedTerminalBillingRecoveryService(jobs,
      new TrustedBillingUsageProducer(new PostgresBillingLedgerRepository(unavailablePool)), payg, lifecycle);
    const request = {
      id: "terminal-mixed", idempotencyKey: "terminal-mixed",
      usageFact: { organizationId: "tenant-mixed", callSessionId: "call-mixed", providerConnectionId: "byo",
        provider: "twilio", direction: "inbound" as const, ownershipMode: "byo" as const,
        routeMode: "live_route" as const, runtimePath: "pstn-sandwich" as const,
        outcome: "completed" as const, catalogId: "catalog-mixed", commercialMode: "subscription" as const,
        planSlug: "starter", runtimeSeconds: 460, usageStartedAt: "2026-09-27T10:00:00.000Z",
        occurredAt: "2026-09-27T10:07:40.000Z" },
      settlement: { commercialMode: "subscription" as const, fact: {
        organizationId: "tenant-mixed", reservationKey: "call-mixed", sessionId: "call-mixed",
        actualSeconds: 460, outcome: "completed" as const, runtimePath: "pstn-sandwich" as const,
        ownershipMode: "byo" as const, provider: "twilio", direction: "inbound" as const,
        catalogId: "catalog-mixed", planSlug: "starter", now: "2026-09-27T10:07:40.000Z",
      } }, now: "2026-09-27T10:07:40.000Z",
    };
    await expect(interrupted.submit(request)).resolves.toMatchObject({ status: "pending", paygAppliedMinor: 40 });
    expect(await repository.listLedgerEntries("tenant-mixed")).toEqual([]);
    expect((await repository.listPaygCreditEntries("tenant-mixed")).filter(entry => entry.entryType === "debit"))
      .toEqual([expect.objectContaining({ amountMinor: 40 })]);

    const recovered = new TrustedTerminalBillingRecoveryService(jobs,
      new TrustedBillingUsageProducer(repository), payg, lifecycle);
    await recovered.runDue("2026-09-27T10:08:10.000Z");
    await expect(recovered.submit(request)).resolves.toMatchObject({ status: "completed", attemptCount: 2 });
    expect(await repository.listLedgerEntries("tenant-mixed")).toEqual([expect.objectContaining({
      quantity: 460, customerAmountMinor: 60, metadata: expect.objectContaining({
        includedRuntimeSeconds: 60, paygAppliedMinor: 40, grossCustomerAmountMinor: 100,
      }),
    })]);
    expect((await repository.listPaygCreditEntries("tenant-mixed")).filter(entry => entry.entryType === "debit"))
      .toEqual([expect.objectContaining({ amountMinor: 40 })]);
    const due = await repository.claimDueOutbox("2026-09-27T10:09:00Z", 10, "2026-09-27T10:10:00Z", "release-mixed");
    expect(due).toHaveLength(2);
    expect(due.map(entry => entry.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ meterKey: "payg_charge_minor", quantity: 40, deliveryMode: "charge" }),
      expect.objectContaining({ meterKey: "subscription_charge_minor", quantity: 60, deliveryMode: "charge" }),
    ]));
    for (const event of due) await repository.markOutboxDelivered("tenant-mixed", event.id, "2026-09-27T10:09:01Z");
    await recovered.submit(request);
    expect(await repository.claimDueOutbox("2026-09-27T10:11:00Z", 10, "2026-09-27T10:12:00Z", "release-mixed")).toEqual([]);
  });
});
