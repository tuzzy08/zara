import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TrustedSubscriptionCallLifecycleService } from "./trusted-subscription-call-lifecycle.service";

describe("TrustedSubscriptionCallLifecycleService", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(async () => {
    const database = newDb();
    database.public.none(schema);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
    await seedEligibleSubscription(pool);
  });

  afterEach(async () => pool.end());

  it("atomically reserves included runtime before the lower approved overage allowance", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const input = {
      organizationId: "tenant-1",
      meterClass: "standard" as const,
      billingMode: "byo" as const,
      provider: "twilio",
      direction: "outbound" as const,
      maximumRuntimeSeconds: 120,
      expiresAt: "2026-08-11T10:10:00.000Z",
      now: "2026-08-11T10:00:00.000Z",
    };

    const [first, second] = await Promise.all([
      service.start({ ...input, reservationKey: "call-1" }),
      service.start({ ...input, reservationKey: "call-2" }),
    ]);
    const outcomes = [first, second].sort((left, right) =>
      left.outcome.localeCompare(right.outcome),
    );

    expect(outcomes).toEqual([
      { outcome: "denied", reason: "insufficient_subscription_allowance" },
      expect.objectContaining({
        outcome: "reserved",
        duplicate: false,
        reservation: expect.objectContaining({
          catalogId: "catalog-v1",
          planSlug: "growth",
          reservedSeconds: 120,
          reservedIncludedSeconds: 60,
          reservedOverageMinor: 12,
        }),
      }),
    ]);
  });

  it.each([
    ["start", "starts_at"],
    ["end", "ends_at"],
  ] as const)("rejects a subscription cycle with a non-UTC-midnight %s", async (_boundary, column) => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    await pool.query(`update billing_cycles
      set ${column} = ${column} + interval '10 hours 30 minutes'`);

    await expect(service.start({
      organizationId: "tenant-1",
      reservationKey: "partial-day-cycle",
      meterClass: "standard",
      billingMode: "byo",
      provider: "twilio",
      direction: "outbound",
      maximumRuntimeSeconds: 30,
      expiresAt: "2026-08-11T10:10:00.000Z",
      now: "2026-08-11T10:00:00.000Z",
    })).resolves.toEqual({
      outcome: "denied",
      reason: "subscription_state_unavailable",
    });
  });

  it.each([
    ["non-UTC-midnight", "2026-09-01T10:30:00.000Z"],
    ["different from the active cycle end", "2026-10-01T00:00:00.000Z"],
  ])("rejects a subscription period end that is %s", async (_case, currentPeriodEnd) => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    await pool.query(`update billing_subscriptions set current_period_end = $1`, [currentPeriodEnd]);

    await expect(service.start({
      organizationId: "tenant-1",
      reservationKey: "invalid-subscription-end",
      meterClass: "standard",
      billingMode: "byo",
      provider: "twilio",
      direction: "outbound",
      maximumRuntimeSeconds: 30,
      expiresAt: "2026-08-11T10:10:00.000Z",
      now: "2026-08-11T10:00:00.000Z",
    })).resolves.toEqual({
      outcome: "denied",
      reason: "subscription_state_unavailable",
    });
  });

  it("atomically uses included runtime, then paid PAYG credit, before approved overage", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    await pool.query(`update billing_budget_policies set overage_limit_minor = 0`);
    await pool.query(`update billing_platform_risk_limits set overage_limit_minor = 0`);
    await pool.query(`insert into billing_payg_credit_entries
      (tenant_id, id, entry_type, amount_minor, idempotency_key, created_at)
      values ('tenant-1', 'grant-1', 'grant', 12, 'grant-1', '2026-08-11T09:00:00.000Z')`);
    const input = { organizationId: "tenant-1", meterClass: "standard" as const,
      billingMode: "byo" as const, provider: "twilio", direction: "outbound" as const,
      maximumRuntimeSeconds: 120, expiresAt: "2026-08-11T10:10:00.000Z",
      now: "2026-08-11T10:00:00.000Z" };

    const [first, second] = await Promise.all([
      service.start({ ...input, reservationKey: "payg-waterfall-1" }),
      service.start({ ...input, reservationKey: "payg-waterfall-2" }),
    ]);

    expect([first, second].filter((result) => result.outcome === "reserved"))
      .toEqual([expect.objectContaining({ reservation: expect.objectContaining({
        reservedIncludedSeconds: 60, reservedPaygMinor: 12, reservedOverageMinor: 0,
      }) })]);
    expect([first, second].filter((result) => result.outcome === "denied"))
      .toEqual([{ outcome: "denied", reason: "insufficient_subscription_allowance" }]);
  });

  it("releases reserved PAYG credit and debits only the trusted finalized PAYG share", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    await pool.query(`update billing_budget_policies set overage_limit_minor = 0`);
    await pool.query(`update billing_platform_risk_limits set overage_limit_minor = 0`);
    await pool.query(`insert into billing_payg_credit_entries
      (tenant_id, id, entry_type, amount_minor, idempotency_key, created_at)
      values ('tenant-1', 'grant-accounting', 'grant', 24, 'grant-accounting', '2026-08-11T09:00:00.000Z')`);
    const common = { organizationId: "tenant-1", meterClass: "standard" as const,
      billingMode: "byo" as const, provider: "twilio", direction: "outbound" as const,
      maximumRuntimeSeconds: 120, expiresAt: "2026-08-11T10:10:00.000Z",
      now: "2026-08-11T10:00:00.000Z" };
    await service.start({ ...common, reservationKey: "payg-release" });
    await expect(service.releaseByReservationKey({ organizationId: "tenant-1",
      reservationKey: "payg-release", now: "2026-08-11T10:01:00.000Z" }))
      .resolves.toEqual({ outcome: "released", duplicate: false });
    await expect(pool.query(`select reserved_amount_minor from billing_reservation_accounts where tenant_id = 'tenant-1'`))
      .resolves.toMatchObject({ rows: [{ reserved_amount_minor: 0 }] });

    const started = await service.start({ ...common, reservationKey: "payg-finalize" });
    if (started.outcome !== "reserved") throw new Error("Expected a reservation.");
    const finalization = { organizationId: "tenant-1", reservationId: started.reservation.id,
      sessionId: "session-payg-finalize", actualSeconds: 90, now: "2026-08-11T10:02:00.000Z" };
    await expect(service.finalize(finalization)).resolves.toEqual({
      outcome: "finalized", duplicate: false, paygAppliedMinor: 6,
    });
    await expect(service.finalize(finalization)).resolves.toEqual({
      outcome: "finalized", duplicate: true, paygAppliedMinor: 6,
    });
    await expect(pool.query(`select reserved_amount_minor from billing_reservation_accounts where tenant_id = 'tenant-1'`))
      .resolves.toMatchObject({ rows: [{ reserved_amount_minor: 0 }] });
    await expect(pool.query(`select amount_minor, session_id from billing_payg_credit_entries where entry_type = 'debit'`))
      .resolves.toMatchObject({ rows: [{ amount_minor: 6, session_id: "session-payg-finalize" }] });
  });

  it("applies trusted actual usage once and releases unused allowance", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const common = {
      organizationId: "tenant-1", meterClass: "standard" as const,
      billingMode: "byo" as const, provider: "twilio", direction: "outbound" as const,
      expiresAt: "2026-08-11T10:10:00.000Z", now: "2026-08-11T10:00:00.000Z",
    };
    const started = await service.start({ ...common, reservationKey: "call-1", maximumRuntimeSeconds: 120 });
    if (started.outcome !== "reserved") throw new Error("Expected a reservation.");
    await pool.query(`insert into billing_ledger_entries
      (id, tenant_id, idempotency_key, entry_type, catalog_id, currency, quantity, unit, occurred_at, metadata, created_at)
      values ('usage-final', 'tenant-1', 'usage-final', 'runtime_charge', 'catalog-v1', 'usd', 30, 'second',
        '2026-08-11T10:02:00.000Z', '{"billingClass":"standard_runtime_seconds"}'::jsonb, '2026-08-11T10:02:00.000Z')`);

    await expect(service.finalize({
      organizationId: "tenant-1", reservationId: started.reservation.id,
      sessionId: "session-1", actualSeconds: 30, now: "2026-08-11T10:02:00.000Z",
    })).resolves.toEqual({ outcome: "finalized", duplicate: false, paygAppliedMinor: 0 });
    await expect(service.finalize({
      organizationId: "tenant-1", reservationId: started.reservation.id,
      sessionId: "session-1", actualSeconds: 30, now: "2026-08-11T10:03:00.000Z",
    })).resolves.toEqual({ outcome: "finalized", duplicate: true, paygAppliedMinor: 0 });

    await expect(service.start({ ...common, reservationKey: "call-2", maximumRuntimeSeconds: 120 }))
      .resolves.toEqual({ outcome: "denied", reason: "insufficient_subscription_allowance" });
    await expect(service.start({ ...common, reservationKey: "call-3", maximumRuntimeSeconds: 90 }))
      .resolves.toEqual(expect.objectContaining({ outcome: "reserved" }));
  });

  it("splits a later claim across remaining included runtime and approved overage", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const common = { organizationId: "tenant-1", meterClass: "standard" as const, billingMode: "byo" as const,
      provider: "twilio", direction: "outbound" as const, expiresAt: "2026-08-11T10:10:00.000Z", now: "2026-08-11T10:00:00.000Z" };
    await expect(service.start({ ...common, reservationKey: "call-1", maximumRuntimeSeconds: 30 }))
      .resolves.toEqual(expect.objectContaining({ outcome: "reserved" }));
    await expect(service.start({ ...common, reservationKey: "call-2", maximumRuntimeSeconds: 90 }))
      .resolves.toEqual(expect.objectContaining({
        outcome: "reserved",
        reservation: expect.objectContaining({ reservedIncludedSeconds: 30, reservedOverageMinor: 12 }),
      }));
  });

  it("returns one durable reservation for concurrent retries with the same key", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const input = { organizationId: "tenant-1", reservationKey: "same-call", meterClass: "standard" as const,
      billingMode: "byo" as const, provider: "twilio", direction: "outbound" as const,
      maximumRuntimeSeconds: 120, expiresAt: "2026-08-11T10:10:00.000Z", now: "2026-08-11T10:00:00.000Z" };
    const results = await Promise.all([service.start(input), service.start(input)]);
    expect(results.map((result) => result.outcome)).toEqual(["reserved", "reserved"]);
    expect(results.map((result) => result.outcome === "reserved" && result.duplicate).sort()).toEqual([false, true]);
  });

  it("rejects a same-key replay after the reservation was released", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const input = { organizationId: "tenant-1", reservationKey: "released-call", meterClass: "standard" as const,
      billingMode: "byo" as const, provider: "twilio", direction: "outbound" as const,
      maximumRuntimeSeconds: 120, expiresAt: "2026-08-11T10:10:00.000Z", now: "2026-08-11T10:00:00.000Z" };
    await service.start(input);
    await service.releaseByReservationKey({ organizationId: "tenant-1", reservationKey: "released-call",
      now: "2026-08-11T10:01:00.000Z" });

    await expect(service.start(input)).rejects.toThrow(
      "Subscription reservation key released-call has status expired and cannot be reused.",
    );
  });

  it("rejects a same-key replay after the reservation was finalized", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const input = { organizationId: "tenant-1", reservationKey: "finalized-call", meterClass: "standard" as const,
      billingMode: "byo" as const, provider: "twilio", direction: "outbound" as const,
      maximumRuntimeSeconds: 120, expiresAt: "2026-08-11T10:10:00.000Z", now: "2026-08-11T10:00:00.000Z" };
    const started = await service.start(input);
    if (started.outcome !== "reserved") throw new Error("Expected a reservation.");
    await service.finalize({ organizationId: "tenant-1", reservationId: started.reservation.id,
      sessionId: "session-finalized", actualSeconds: 30, now: "2026-08-11T10:01:00.000Z" });

    await expect(service.start(input)).rejects.toThrow(
      "Subscription reservation key finalized-call has status finalized and cannot be reused.",
    );
  });

  it("reserves and finalizes the approved platform route exposure from trusted connected seconds", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    await pool.query(`update billing_budget_policies set overage_limit_minor = 100`);
    await pool.query(`update billing_platform_risk_limits set overage_limit_minor = 100`);
    const started = await service.start({
      organizationId: "tenant-1", reservationKey: "platform-call", meterClass: "standard",
      billingMode: "platform_managed", provider: "twilio", direction: "outbound",
      routeIdentity: { rateId: "twilio-ng-outbound", provider: "twilio", direction: "outbound",
        sourceCountry: "NG", destinationZone: "nigeria-local-mobile",
        providerSku: "twilio-voice-ng-local-mobile-media-streams", currency: "usd",
        effectiveAt: "2026-08-11T10:00:00.000Z" }, maximumRuntimeSeconds: 30,
      expiresAt: "2026-08-11T10:10:00.000Z", now: "2026-08-11T10:00:00.000Z",
    });
    expect(started).toEqual(expect.objectContaining({ outcome: "reserved", reservation: expect.objectContaining({
      billingMode: "platform_managed", routeRateId: "twilio-ng-outbound", reservedTelephonyMinor: 35,
      reservedOverageMinor: 35,
    }) }));
    if (started.outcome !== "reserved") throw new Error("Expected a reservation.");
    await pool.query(`insert into billing_ledger_entries
      (id, tenant_id, idempotency_key, entry_type, catalog_id, currency, customer_amount_minor, quantity, unit, occurred_at, metadata, created_at)
      values ('usage-platform-runtime', 'tenant-1', 'usage-platform-runtime', 'runtime_charge', 'catalog-v1', 'usd', null, 10, 'second',
        '2026-08-11T10:02:00.000Z', '{"billingClass":"standard_runtime_seconds"}'::jsonb, '2026-08-11T10:02:00.000Z'),
      ('usage-platform-route', 'tenant-1', 'usage-platform-route', 'telephony_charge', 'catalog-v1', 'usd', 35, 10, 'connected_second',
        '2026-08-11T10:02:00.000Z', '{"billingClass":"platform_telephony_charge_minor"}'::jsonb, '2026-08-11T10:02:00.000Z')`);
    await expect(service.finalizeByReservationKey({ organizationId: "tenant-1", reservationKey: "platform-call",
      sessionId: "session-platform", actualSeconds: 10, providerConnectedSeconds: 10,
      now: "2026-08-11T10:02:00.000Z" })).resolves.toEqual({
        outcome: "finalized", duplicate: false, paygAppliedMinor: 0,
      });
    await expect(pool.query(`select customer_amount_minor, quantity from billing_ledger_entries where metadata->>'billingClass' = 'platform_telephony_charge_minor'`))
      .resolves.toMatchObject({ rows: [{ customer_amount_minor: 35, quantity: 10 }] });
  });

  it("rejects a same-key replay with changed route facts", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const input = { organizationId: "tenant-1", reservationKey: "route-pin", meterClass: "standard" as const,
      billingMode: "byo" as const, provider: "twilio", direction: "outbound" as const,
      maximumRuntimeSeconds: 30, expiresAt: "2026-08-11T10:10:00.000Z", now: "2026-08-11T10:00:00.000Z" };
    await service.start(input);
    await expect(service.start({ ...input, provider: "other-provider" })).rejects.toThrow("different data");
  });

  it("recovers an expired claim without leaving stale account totals", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const base = { organizationId: "tenant-1", meterClass: "standard" as const, billingMode: "byo" as const,
      provider: "twilio", direction: "outbound" as const, maximumRuntimeSeconds: 120 };
    await service.start({ ...base, reservationKey: "expired", now: "2026-08-11T10:00:00.000Z", expiresAt: "2026-08-11T10:01:00.000Z" });
    await expect(service.start({ ...base, reservationKey: "replacement", now: "2026-08-11T10:02:00.000Z", expiresAt: "2026-08-11T10:12:00.000Z" }))
      .resolves.toEqual(expect.objectContaining({ outcome: "reserved" }));
    await expect(pool.query(`select reserved_included_seconds, reserved_overage_minor from billing_subscription_reservation_accounts`))
      .resolves.toMatchObject({ rows: [{ reserved_included_seconds: 60, reserved_overage_minor: 12 }] });
  });

  it("releases expired PAYG and every meter account before a replacement claim", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    await pool.query(`update billing_budget_policies set overage_limit_minor = 0`);
    await pool.query(`update billing_platform_risk_limits set overage_limit_minor = 0`);
    await pool.query(`insert into billing_payg_credit_entries
      (tenant_id, id, entry_type, amount_minor, idempotency_key, created_at)
      values ('tenant-1', 'grant-expiry', 'grant', 100, 'grant-expiry', '2026-08-11T09:00:00.000Z')`);
    const common = { organizationId: "tenant-1", billingMode: "byo" as const,
      provider: "twilio", direction: "outbound" as const,
      now: "2026-08-11T10:00:00.000Z", expiresAt: "2026-08-11T10:01:00.000Z" };
    await service.start({ ...common, reservationKey: "expired-standard",
      meterClass: "standard", maximumRuntimeSeconds: 120 });
    await service.start({ ...common, reservationKey: "expired-premium",
      meterClass: "premium", maximumRuntimeSeconds: 180 });

    await service.start({ ...common, reservationKey: "replacement-standard",
      meterClass: "standard", maximumRuntimeSeconds: 120,
      now: "2026-08-11T10:02:00.000Z", expiresAt: "2026-08-11T10:12:00.000Z" });

    await expect(pool.query(`select reserved_amount_minor from billing_reservation_accounts
      where tenant_id = 'tenant-1'`)).resolves.toMatchObject({ rows: [{ reserved_amount_minor: 12 }] });
    await expect(pool.query(`select meter_class, reserved_included_seconds, reserved_overage_minor
      from billing_subscription_reservation_accounts order by meter_class`)).resolves.toMatchObject({ rows: [
        { meter_class: "premium", reserved_included_seconds: 0, reserved_overage_minor: 0 },
        { meter_class: "standard", reserved_included_seconds: 60, reserved_overage_minor: 0 },
      ] });
  });

  it("does not expire a reservation with a dead-letter terminal recovery job", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    await service.start({
      organizationId: "tenant-1", reservationKey: "dead-letter-call", meterClass: "standard",
      billingMode: "byo", provider: "twilio", direction: "outbound", maximumRuntimeSeconds: 120,
      now: "2026-08-11T10:00:00.000Z", expiresAt: "2026-08-11T10:01:00.000Z",
    });
    await pool.query(`insert into billing_terminal_recovery_jobs
      (tenant_id, reservation_id, commercial_mode, status)
      values ('tenant-1', 'dead-letter-call', 'subscription', 'dead_letter')`);

    await expect(service.start({
      organizationId: "tenant-1", reservationKey: "replacement-call", meterClass: "standard",
      billingMode: "byo", provider: "twilio", direction: "outbound", maximumRuntimeSeconds: 30,
      now: "2026-08-11T10:02:00.000Z", expiresAt: "2026-08-11T10:10:00.000Z",
    })).resolves.toEqual({ outcome: "denied", reason: "insufficient_subscription_allowance" });
    await expect(pool.query(`select status from billing_subscription_call_reservations
      where tenant_id = 'tenant-1' and reservation_key = 'dead-letter-call'`))
      .resolves.toMatchObject({ rows: [{ status: "active" }] });
  });

  it("serializes tenant overage across standard and premium meters", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    await pool.query(`update billing_budget_policies set overage_limit_minor = 30`);
    await pool.query(`update billing_platform_risk_limits set overage_limit_minor = 30`);
    const common = { organizationId: "tenant-1", billingMode: "byo" as const,
      provider: "twilio", direction: "outbound" as const, maximumRuntimeSeconds: 180,
      now: "2026-08-11T10:00:00.000Z", expiresAt: "2026-08-11T10:10:00.000Z" };

    const results = await settleWithin(Promise.all([
      service.start({ ...common, reservationKey: "cross-meter-standard", meterClass: "standard" }),
      service.start({ ...common, reservationKey: "cross-meter-premium", meterClass: "premium" }),
    ]), 5_000);

    expect(results.filter((result) => result.outcome === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "denied"))
      .toEqual([{ outcome: "denied", reason: "insufficient_subscription_allowance" }]);
  });

  it.each([
    {
      exhaustedMeter: "standard" as const,
      requestedMeter: "premium" as const,
      requestedSeconds: 130,
    },
    {
      exhaustedMeter: "premium" as const,
      requestedMeter: "standard" as const,
      requestedSeconds: 90,
    },
  ])(
    "blocks $requestedMeter when $exhaustedMeter actual usage exhausted the global overage limit",
    async ({ exhaustedMeter, requestedMeter, requestedSeconds }) => {
      const service = new TrustedSubscriptionCallLifecycleService(pool);
      if (exhaustedMeter === "standard") {
        await pool.query(`update billing_ledger_entries set quantity = 660 where id = 'usage-1'`);
      } else {
        await pool.query(`insert into billing_ledger_entries
          (id,tenant_id,idempotency_key,entry_type,catalog_id,currency,quantity,unit,occurred_at,metadata,created_at)
          values ('premium-actual','tenant-1','premium-actual','runtime_charge','catalog-v1','usd',
            180,'second','2026-08-11T09:30:00.000Z',
            '{"billingClass":"premium_runtime_seconds"}', '2026-08-11T09:30:00.000Z')`);
      }

      await expect(service.start({
        organizationId: "tenant-1",
        reservationKey: `${exhaustedMeter}-exhausts-${requestedMeter}`,
        meterClass: requestedMeter,
        billingMode: "byo",
        provider: "twilio",
        direction: "outbound",
        maximumRuntimeSeconds: requestedSeconds,
        now: "2026-08-11T10:00:00.000Z",
        expiresAt: "2026-08-11T10:10:00.000Z",
      })).resolves.toEqual({
        outcome: "denied",
        reason: "insufficient_subscription_allowance",
      });
    },
  );

  it("locks tenant PAYG before a meter-specific reservation account", async () => {
    const lockOrder: string[] = [];
    const database = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (text: string, values?: unknown[]) => {
            if (text.includes("insert into billing_subscription_reservation_accounts")) {
              lockOrder.push("meter");
            }
            if (text.includes("insert into billing_subscription_overage_accounts")) {
              lockOrder.push("global_overage");
            }
            if (text.includes("for update")) {
              if (text.includes("billing_reservation_accounts")) lockOrder.push("payg");
              if (text.includes("billing_subscription_call_reservations")) {
                lockOrder.push("reservation");
              }
              if (text.includes("billing_subscription_reservation_accounts")) {
                lockOrder.push("meter");
              }
            }
            if (text.includes("update billing_subscription_overage_accounts")) {
              lockOrder.push("global_overage");
            }
            return client.query(text, values);
          },
          release: () => client.release(),
        };
      },
    };
    const service = new TrustedSubscriptionCallLifecycleService(database as never);

    await service.start({
      organizationId: "tenant-1", reservationKey: "lock-order", meterClass: "standard",
      billingMode: "byo", provider: "twilio", direction: "outbound",
      maximumRuntimeSeconds: 30, now: "2026-08-11T10:00:00.000Z",
      expiresAt: "2026-08-11T10:10:00.000Z",
    });

    const lockStages = lockOrder.filter((stage, index) => stage !== lockOrder[index - 1]);
    expect(lockStages.slice(0, 4)).toEqual([
      "payg",
      "reservation",
      "meter",
      "global_overage",
    ]);
  });

  it("rejects cross-tenant finalization and rolls back an inconsistent account", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const started = await service.start({ organizationId: "tenant-1", reservationKey: "call-1", meterClass: "standard",
      billingMode: "byo", provider: "twilio", direction: "outbound", maximumRuntimeSeconds: 120,
      now: "2026-08-11T10:00:00.000Z", expiresAt: "2026-08-11T10:10:00.000Z" });
    if (started.outcome !== "reserved") throw new Error("Expected a reservation.");
    await expect(service.finalize({ organizationId: "tenant-other", reservationId: started.reservation.id,
      sessionId: "session-1", actualSeconds: 30, now: "2026-08-11T10:02:00.000Z" }))
      .rejects.toThrow("was not found");
    await pool.query(`update billing_subscription_reservation_accounts set reserved_included_seconds = 0, reserved_overage_minor = 0`);
    await expect(service.finalize({ organizationId: "tenant-1", reservationId: started.reservation.id,
      sessionId: "session-1", actualSeconds: 30, now: "2026-08-11T10:02:00.000Z" }))
      .rejects.toThrow("account is inconsistent");
    await expect(pool.query(`select status from billing_subscription_call_reservations where id = $1`, [started.reservation.id]))
      .resolves.toMatchObject({ rows: [{ status: "active" }] });
  });

  it("releases a failed downstream start once and restores the allowance", async () => {
    const service = new TrustedSubscriptionCallLifecycleService(pool);
    const common = { organizationId: "tenant-1", meterClass: "standard" as const, billingMode: "byo" as const,
      provider: "twilio", direction: "outbound" as const, maximumRuntimeSeconds: 120,
      now: "2026-08-11T10:00:00.000Z", expiresAt: "2026-08-11T10:10:00.000Z" };
    await service.start({ ...common, reservationKey: "failed-start" });
    await expect(service.releaseByReservationKey({ organizationId: "tenant-1", reservationKey: "failed-start",
      now: "2026-08-11T10:01:00.000Z" })).resolves.toEqual({ outcome: "released", duplicate: false });
    await expect(service.releaseByReservationKey({ organizationId: "tenant-1", reservationKey: "failed-start",
      now: "2026-08-11T10:02:00.000Z" })).resolves.toEqual({ outcome: "released", duplicate: true });
    await expect(service.start({ ...common, reservationKey: "replacement" }))
      .resolves.toEqual(expect.objectContaining({ outcome: "reserved" }));
  });
});

const realPostgresUrl = process.env.ZARA_TEST_POSTGRES_URL;

describe.skipIf(realPostgresUrl === undefined)(
  "TrustedSubscriptionCallLifecycleService PostgreSQL concurrency",
  () => {
    let postgres: Pool;
    let testSchema: string;

    beforeEach(async () => {
      const { Pool: PostgresPool } = await import("pg");
      postgres = new PostgresPool({ connectionString: realPostgresUrl, max: 4 });
      testSchema = `subscription_locks_${randomUUID().replaceAll("-", "")}`;
      const client = await postgres.connect();
      try {
        await client.query(`create schema "${testSchema}"`);
        await client.query(`set search_path to "${testSchema}", public`);
        await client.query(schema);
        await seedEligibleSubscription(client);
        await client.query(`update billing_budget_policies set overage_limit_minor = 30`);
        await client.query(`update billing_platform_risk_limits set overage_limit_minor = 30`);
        await seedExpiredCrossMeterReservations(client);
      } finally {
        client.release();
      }
    });

    afterEach(async () => {
      const client = await postgres.connect();
      try {
        await client.query(`drop schema if exists "${testSchema}" cascade`);
      } finally {
        client.release();
        await postgres.end();
      }
    });

    it("avoids a cross-meter expiry deadlock and grants the shared limit once", async () => {
      const database = {
        connect: async () => {
          const client = await postgres.connect();
          await client.query(`set search_path to "${testSchema}", public`);
          return client;
        },
      };
      const service = new TrustedSubscriptionCallLifecycleService(database as never);
      const common = {
        organizationId: "tenant-1", billingMode: "byo" as const,
        provider: "twilio", direction: "outbound" as const,
        maximumRuntimeSeconds: 180, now: "2026-08-11T10:00:00.000Z",
        expiresAt: "2026-08-11T10:10:00.000Z",
      };

      const results = await settleWithin(Promise.all([
        service.start({ ...common, reservationKey: "real-standard", meterClass: "standard" }),
        service.start({ ...common, reservationKey: "real-premium", meterClass: "premium" }),
      ]), 8_000);

      expect(results.filter((result) => result.outcome === "reserved")).toHaveLength(1);
      expect(results.filter((result) => result.outcome === "denied")).toEqual([
        { outcome: "denied", reason: "insufficient_subscription_allowance" },
      ]);
    }, 15_000);

    it("does not deadlock when start expires a reservation while finalize locks it", async () => {
      const service = postgresLifecycleService(postgres, testSchema);
      const started = await service.start({
        organizationId: "tenant-1", reservationKey: "finalize-race-target",
        billingMode: "byo", provider: "twilio", direction: "outbound",
        meterClass: "standard", maximumRuntimeSeconds: 30,
        now: "2026-08-11T10:00:00.000Z", expiresAt: "2026-08-11T10:01:00.000Z",
      });
      if (started.outcome !== "reserved") throw new Error("Expected a reservation.");

      const results = await settleWithin(Promise.allSettled([
        service.start({
          organizationId: "tenant-1", reservationKey: "finalize-race-replacement",
          billingMode: "byo", provider: "twilio", direction: "outbound",
          meterClass: "standard", maximumRuntimeSeconds: 30,
          now: "2026-08-11T10:02:00.000Z", expiresAt: "2026-08-11T10:10:00.000Z",
        }),
        service.finalize({
          organizationId: "tenant-1", reservationId: started.reservation.id,
          sessionId: "finalize-race-session", actualSeconds: 15,
          now: "2026-08-11T10:02:00.000Z",
        }),
      ]), 8_000);

      expect(results[0]).toMatchObject({ status: "fulfilled", value: { outcome: "reserved" } });
      expect(results[1].status === "fulfilled"
        || (results[1].reason instanceof Error && results[1].reason.message.includes("cannot be finalized")))
        .toBe(true);
    }, 15_000);

    it("does not deadlock when start expires a reservation while release locks it", async () => {
      const service = postgresLifecycleService(postgres, testSchema);
      const started = await service.start({
        organizationId: "tenant-1", reservationKey: "release-race-target",
        billingMode: "byo", provider: "twilio", direction: "outbound",
        meterClass: "standard", maximumRuntimeSeconds: 30,
        now: "2026-08-11T10:00:00.000Z", expiresAt: "2026-08-11T10:01:00.000Z",
      });
      if (started.outcome !== "reserved") throw new Error("Expected a reservation.");

      const results = await settleWithin(Promise.allSettled([
        service.start({
          organizationId: "tenant-1", reservationKey: "release-race-replacement",
          billingMode: "byo", provider: "twilio", direction: "outbound",
          meterClass: "standard", maximumRuntimeSeconds: 30,
          now: "2026-08-11T10:02:00.000Z", expiresAt: "2026-08-11T10:10:00.000Z",
        }),
        service.releaseByReservationKey({
          organizationId: "tenant-1", reservationKey: "release-race-target",
          now: "2026-08-11T10:02:00.000Z",
        }),
      ]), 8_000);

      expect(results).toMatchObject([
        { status: "fulfilled", value: { outcome: "reserved" } },
        { status: "fulfilled", value: { outcome: "released" } },
      ]);
    }, 15_000);
  },
);

function postgresLifecycleService(postgres: Pool, testSchema: string) {
  return new TrustedSubscriptionCallLifecycleService({
    connect: async () => {
      const client = await postgres.connect();
      await client.query(`set search_path to "${testSchema}", public`);
      return client;
    },
  } as never);
}

async function seedEligibleSubscription(pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) {
  await pool.query(`insert into tenants values ('tenant-1')`);
  await pool.query(`insert into billing_price_catalogs values (
    'catalog-v1', '{"plans":{"growth":{"includedStandardRuntimeSeconds":600,"includedPremiumRuntimeSeconds":120,"standardRuntimePerMinuteMinor":12,"premiumRuntimePerMinuteMinor":30}},"telephonyRoutes":{"twilio-ng-outbound":{"provider":"twilio","direction":"outbound","sourceCountry":"NG","destinationZone":"nigeria-local-mobile","providerSku":"twilio-voice-ng-local-mobile-media-streams","currency":"usd","effectiveFrom":"2026-08-01T00:00:00.000Z","customerRateMinorPerMinute":35,"rounding":"next_full_minute"}}}'::jsonb
  )`);
  await pool.query(`insert into billing_subscriptions values (
    'tenant-1', 'sub-1', 'catalog-v1', 'growth', 'active', '2026-09-01T00:00:00.000Z'
  )`);
  await pool.query(`insert into billing_cycles values (
    'tenant-1', 'cycle-1', 'catalog-v1', '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'active'
  )`);
  await pool.query(`insert into billing_entitlements values ('tenant-1', 'runtime_access', 'active')`);
  await pool.query(`insert into billing_budget_policies values ('tenant-1', 'usd', 24)`);
  await pool.query(`insert into billing_platform_risk_limits values ('tenant-1', 'usd', 12)`);
  await pool.query(`insert into billing_ledger_entries
    (id, tenant_id, idempotency_key, entry_type, catalog_id, currency, quantity, unit, occurred_at, metadata, created_at)
    values ('usage-1', 'tenant-1', 'usage-1', 'runtime_charge', 'catalog-v1', 'usd', 540, 'second',
      '2026-08-10T12:00:00.000Z', '{"billingClass":"standard_runtime_seconds"}'::jsonb, '2026-08-10T12:00:00.000Z')`);
}

async function seedExpiredCrossMeterReservations(
  database: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
) {
  await database.query(`insert into billing_subscription_reservation_accounts values
    ('tenant-1','cycle-1','standard',0,0,'2026-08-11T09:50:00.000Z'),
    ('tenant-1','cycle-1','premium',0,0,'2026-08-11T09:50:00.000Z')`);
  await database.query(`insert into billing_subscription_call_reservations (
    tenant_id,id,reservation_key,subscription_id,cycle_id,catalog_id,plan_slug,meter_class,
    status,reserved_seconds,reserved_included_seconds,reserved_payg_minor,reserved_overage_minor,
    expires_at,billing_mode,provider,direction,reserved_telephony_minor,created_at,updated_at
  ) values
    ('tenant-1','expired-standard','expired-standard','sub-1','cycle-1','catalog-v1','growth',
     'standard','active',30,0,0,0,'2026-08-11T09:59:00.000Z','byo','twilio','outbound',0,
     '2026-08-11T09:50:00.000Z','2026-08-11T09:50:00.000Z'),
    ('tenant-1','expired-premium','expired-premium','sub-1','cycle-1','catalog-v1','growth',
     'premium','active',30,0,0,0,'2026-08-11T09:59:00.000Z','byo','twilio','outbound',0,
     '2026-08-11T09:50:00.000Z','2026-08-11T09:50:00.000Z')`);
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Concurrent billing work timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

const schema = `
  create table tenants (id text primary key);
  create table billing_price_catalogs (id text primary key, catalog_document jsonb not null);
  create table billing_subscriptions (
    tenant_id text not null, id text not null, catalog_id text not null, plan_slug text,
    status text not null, current_period_end timestamptz, primary key (tenant_id, id)
  );
  create table billing_cycles (
    tenant_id text not null, id text not null, catalog_id text not null, starts_at timestamptz not null,
    ends_at timestamptz not null, status text not null, primary key (tenant_id, id)
  );
  create table billing_entitlements (tenant_id text not null, key text not null, status text not null);
  create table billing_budget_policies (tenant_id text primary key, currency text not null, overage_limit_minor bigint not null);
  create table billing_platform_risk_limits (tenant_id text primary key, currency text not null, overage_limit_minor bigint not null);
  create table billing_ledger_entries (
    id text not null, tenant_id text not null, idempotency_key text not null, entry_type text not null,
    catalog_id text, currency text not null, customer_amount_minor bigint, supplier_cost_minor bigint,
    quantity bigint not null, unit text not null, occurred_at timestamptz not null, metadata jsonb not null,
    created_at timestamptz not null, primary key (tenant_id, id), unique (tenant_id, idempotency_key)
  );
  create table billing_subscription_reservation_accounts (
    tenant_id text not null, cycle_id text not null, meter_class text not null,
    reserved_included_seconds bigint not null, reserved_overage_minor bigint not null, updated_at timestamptz not null,
    primary key (tenant_id, cycle_id, meter_class)
  );
  create table billing_subscription_call_reservations (
    tenant_id text not null, id text not null, reservation_key text not null, subscription_id text not null,
    cycle_id text not null, catalog_id text not null, plan_slug text not null, meter_class text not null,
    status text not null, reserved_seconds bigint not null, reserved_included_seconds bigint not null,
    reserved_payg_minor bigint not null default 0, reserved_overage_minor bigint not null, expires_at timestamptz not null, actual_seconds bigint,
    billing_mode text not null, provider text not null, direction text not null, route_rate_id text,
    route_identity jsonb, route_rate_minor_per_minute bigint, reserved_telephony_minor bigint not null, actual_provider_connected_seconds bigint,
    session_id text, terminal_outcome text, finalized_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null,
    primary key (tenant_id, id), unique (tenant_id, reservation_key)
  );
  create table billing_subscription_overage_accounts (
    tenant_id text not null, cycle_id text not null, reserved_overage_minor bigint not null,
    updated_at timestamptz not null, primary key (tenant_id, cycle_id)
  );
  create table billing_terminal_recovery_jobs (
    tenant_id text not null, reservation_id text not null, commercial_mode text not null,
    status text not null
  );
  create table billing_payg_credit_entries (
    tenant_id text not null, id text not null, order_id text, session_id text, entry_type text not null, amount_minor bigint not null,
    idempotency_key text not null, expires_at timestamptz, created_at timestamptz not null,
    primary key (tenant_id, id), unique (tenant_id, idempotency_key)
  );
  create table billing_reservation_accounts (
    tenant_id text primary key, reserved_amount_minor bigint not null default 0, updated_at timestamptz not null
  );
`;
