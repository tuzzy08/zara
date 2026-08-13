import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalBillingRecoveryRepository } from "./terminal-billing-recovery.repository";
import { TrustedTerminalBillingRecoveryService } from "./trusted-terminal-billing-recovery.service";

const usageFact = {
  organizationId: "tenant-recovery",
  callSessionId: "call-recovery",
  providerConnectionId: "connection-1",
  provider: "twilio",
  direction: "inbound",
  ownershipMode: "byo",
  routeMode: "live_route",
  runtimePath: "pstn-sandwich",
  outcome: "transferred",
  catalogId: "catalog-pinned-v1",
  commercialMode: "payg",
  runtimeSeconds: 75,
  occurredAt: "2026-08-11T10:00:00.000Z",
} as const;

const paygFact = {
  organizationId: "tenant-recovery",
  reservationId: "payg-call-reservation:call-recovery",
  callSessionId: "call-recovery",
  runtimePath: "pstn-sandwich",
  outcome: "transferred",
  runtimeSeconds: 75,
  ownershipMode: "byo",
  provider: "twilio",
  direction: "inbound",
  occurredAt: "2026-08-11T10:00:00.000Z",
} as const;

describe("TrustedTerminalBillingRecoveryService", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table billing_terminal_recovery_jobs (
        tenant_id text not null,
        id text not null,
        idempotency_key text not null,
        call_session_id text not null,
        reservation_id text not null,
        commercial_mode text not null,
        usage_fact jsonb not null,
        settlement_fact jsonb not null,
        payg_applied_minor bigint,
        status text not null,
        attempt_count integer not null default 0,
        next_attempt_at timestamptz not null,
        lease_expires_at timestamptz,
        lease_token text,
        last_error text,
        completed_at timestamptz,
        dead_lettered_at timestamptz,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant_id, id),
        unique (tenant_id, idempotency_key)
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => {
    await pool.end();
  });

  it("persists pinned terminal facts before effects and completes a partial job after restart", async () => {
    const repository = new TerminalBillingRecoveryRepository(pool);
    const usage = {
      recordTerminalCall: vi.fn(async () => {
        await expect(repository.getJob("tenant-recovery", "terminal:call-recovery"))
          .resolves.toMatchObject({
            status: "processing",
            usageFact: expect.objectContaining({
              catalogId: "catalog-pinned-v1",
              outcome: "transferred",
            }),
          });
        return { recorded: 1, duplicates: 0, incomplete: 0 };
      }),
    };
    const payg = {
      finalizeTerminalCall: vi.fn()
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockResolvedValueOnce({ duplicate: false }),
    };
    const subscription = { finalizeByReservationKey: vi.fn() };
    const firstProcess = new TrustedTerminalBillingRecoveryService(
      repository,
      usage,
      payg,
      subscription,
    );

    await expect(firstProcess.submit({
      id: "terminal-job-call-recovery",
      idempotencyKey: "terminal:call-recovery",
      usageFact,
      settlement: { commercialMode: "payg", fact: paygFact },
      now: "2026-08-11T10:00:01.000Z",
    })).resolves.toMatchObject({ status: "pending" });

    await expect(repository.getJob("tenant-recovery", "terminal:call-recovery"))
      .resolves.toMatchObject({
        status: "pending",
        attemptCount: 1,
        usageFact,
        settlementFact: paygFact,
      });

    const restarted = new TrustedTerminalBillingRecoveryService(
      new TerminalBillingRecoveryRepository(pool),
      usage,
      payg,
      subscription,
    );
    await restarted.runDue("2026-08-11T10:00:31.000Z");

    expect(usage.recordTerminalCall).toHaveBeenCalledTimes(1);
    expect(payg.finalizeTerminalCall).toHaveBeenCalledTimes(2);
    expect(payg.finalizeTerminalCall).toHaveBeenLastCalledWith(paygFact);
    await expect(repository.getJob("tenant-recovery", "terminal:call-recovery"))
      .resolves.toMatchObject({ status: "completed", attemptCount: 2 });
  });

  it("keeps terminal job idempotency tenant-qualified and rejects changed replay facts", async () => {
    const repository = new TerminalBillingRecoveryRepository(pool);
    const effects = {
      recordTerminalCall: vi.fn().mockResolvedValue({ recorded: 1, duplicates: 0, incomplete: 0 }),
      finalizeTerminalCall: vi.fn().mockResolvedValue({ duplicate: false }),
      finalizeByReservationKey: vi.fn(),
    };
    const service = new TrustedTerminalBillingRecoveryService(
      repository,
      effects,
      effects,
      effects,
    );
    const request = {
      id: "terminal-job-call-recovery",
      idempotencyKey: "terminal:call-recovery",
      usageFact,
      settlement: { commercialMode: "payg" as const, fact: paygFact },
      now: "2026-08-11T10:00:01.000Z",
    };

    await service.submit(request);
    await expect(service.submit(request)).resolves.toMatchObject({ status: "completed" });
    await expect(service.submit({
      ...request,
      usageFact: { ...usageFact, runtimeSeconds: 76 },
      settlement: {
        commercialMode: "payg",
        fact: { ...paygFact, runtimeSeconds: 76 },
      },
    })).rejects.toThrow("already has different terminal facts");

    await expect(service.submit({
      ...request,
      id: "terminal-job-other",
      usageFact: { ...usageFact, organizationId: "tenant-other" },
      settlement: {
        commercialMode: "payg",
        fact: { ...paygFact, organizationId: "tenant-other" },
      },
    })).resolves.toMatchObject({ status: "completed" });
  });

  it("rejects subscription recovery when usage and pinned settlement facts differ", async () => {
    const repository = new TerminalBillingRecoveryRepository(pool);
    const service = new TrustedTerminalBillingRecoveryService(
      repository,
      { recordTerminalCall: vi.fn() },
      { finalizeTerminalCall: vi.fn() },
      { finalizeByReservationKey: vi.fn() },
    );
    const subscriptionUsage = {
      ...usageFact,
      commercialMode: "subscription" as const,
      planSlug: "growth",
      providerConnectedSeconds: 70,
    };
    const settlement = {
      organizationId: "tenant-recovery",
      reservationKey: "subscription-call:call-recovery",
      sessionId: "call-recovery",
      actualSeconds: 74,
      providerConnectedSeconds: 70,
      outcome: "transferred" as const,
      runtimePath: "pstn-sandwich" as const,
      ownershipMode: "byo" as const,
      provider: "twilio",
      direction: "inbound" as const,
      catalogId: "catalog-pinned-v1",
      planSlug: "growth",
      now: "2026-08-11T10:00:00.000Z",
    };

    await expect(service.submit({
      id: "subscription-terminal-mismatch",
      idempotencyKey: "terminal:subscription-mismatch",
      usageFact: subscriptionUsage,
      settlement: { commercialMode: "subscription", fact: settlement },
      now: "2026-08-11T10:00:01.000Z",
    })).rejects.toThrow("Subscription terminal billing recovery facts do not match.");
  });

  it("pins subscription PAYG settlement before forwarding terminal usage", async () => {
    const repository = new TerminalBillingRecoveryRepository(pool);
    const order: string[] = [];
    const usage = {
      recordTerminalCall: vi.fn(async (fact: Record<string, unknown>) => {
        order.push("usage");
        expect(fact.paygAppliedMinor).toBe(6);
        await expect(repository.getJob("tenant-recovery", "terminal:subscription-pinned"))
          .resolves.toMatchObject({ paygAppliedMinor: 6 });
        return { recorded: 1, duplicates: 0, incomplete: 0 };
      }),
    };
    const subscription = {
      finalizeByReservationKey: vi.fn(async () => {
        order.push("settlement");
        return { outcome: "finalized", duplicate: false, paygAppliedMinor: 6 };
      }),
    };
    const service = new TrustedTerminalBillingRecoveryService(
      repository,
      usage as never,
      { finalizeTerminalCall: vi.fn() },
      subscription as never,
    );
    const subscriptionUsage = {
      ...usageFact,
      commercialMode: "subscription" as const,
      planSlug: "growth",
      providerConnectedSeconds: 70,
    };

    await expect(service.submit({
      id: "subscription-terminal-pinned",
      idempotencyKey: "terminal:subscription-pinned",
      usageFact: subscriptionUsage,
      settlement: {
        commercialMode: "subscription",
        fact: {
          organizationId: "tenant-recovery",
          reservationKey: "subscription-call:call-recovery",
          sessionId: "call-recovery",
          actualSeconds: 75,
          providerConnectedSeconds: 70,
          outcome: "transferred",
          runtimePath: "pstn-sandwich",
          ownershipMode: "byo",
          provider: "twilio",
          direction: "inbound",
          catalogId: "catalog-pinned-v1",
          planSlug: "growth",
          now: "2026-08-11T10:00:00.000Z",
        },
      },
      now: "2026-08-11T10:00:01.000Z",
    })).resolves.toMatchObject({ status: "completed", paygAppliedMinor: 6 });

    expect(order).toEqual(["settlement", "usage"]);
  });

  it("fences a stale worker after an expired lease is reclaimed", async () => {
    const repository = new TerminalBillingRecoveryRepository(pool);
    await repository.enqueue({
      id: "terminal-job-lease",
      organizationId: "tenant-recovery",
      idempotencyKey: "terminal:lease",
      callSessionId: "call-recovery",
      reservationId: paygFact.reservationId,
      commercialMode: "payg",
      usageFact,
      settlementFact: paygFact,
      now: "2026-08-11T10:00:00.000Z",
    });

    const firstLease = await repository.claimJob(
      "tenant-recovery",
      "terminal:lease",
      "2026-08-11T10:00:00.000Z",
    );
    const secondLease = await repository.claimJob(
      "tenant-recovery",
      "terminal:lease",
      "2026-08-11T10:01:01.000Z",
    );

    expect(firstLease?.leaseToken).toEqual(expect.any(String));
    expect(secondLease?.leaseToken).toEqual(expect.any(String));
    expect(secondLease?.leaseToken).not.toBe(firstLease?.leaseToken);
    await expect(repository.markCompleted(
      firstLease!,
      "2026-08-11T10:01:02.000Z",
    )).resolves.toBe(false);
    await expect(repository.getJob("tenant-recovery", "terminal:lease"))
      .resolves.toMatchObject({ status: "processing", leaseToken: secondLease?.leaseToken });
    await expect(repository.markCompleted(
      secondLease!,
      "2026-08-11T10:01:03.000Z",
    )).resolves.toBe(true);
  });

  it("uses bounded exponential retry and dead-letters with an alert", async () => {
    const repository = new TerminalBillingRecoveryRepository(pool);
    const alerts = { terminalRecoveryDeadLettered: vi.fn() };
    const Recovery = TrustedTerminalBillingRecoveryService as unknown as new (
      ...args: unknown[]
    ) => TrustedTerminalBillingRecoveryService;
    const service = new Recovery(
      repository,
      { recordTerminalCall: vi.fn().mockRejectedValue(new Error("billing unavailable")) },
      { finalizeTerminalCall: vi.fn() },
      { finalizeByReservationKey: vi.fn() },
      alerts,
    );

    await service.submit({
      id: "terminal-job-dead-letter",
      idempotencyKey: "terminal:dead-letter",
      usageFact,
      settlement: { commercialMode: "payg", fact: paygFact },
      now: "2026-08-11T10:00:00.000Z",
    });
    await expect(repository.getJob("tenant-recovery", "terminal:dead-letter"))
      .resolves.toMatchObject({
        status: "pending",
        attemptCount: 1,
        nextAttemptAt: "2026-08-11T10:00:30.000Z",
      });

    for (const now of [
      "2026-08-11T10:00:30.000Z",
      "2026-08-11T10:01:30.000Z",
      "2026-08-11T10:03:30.000Z",
      "2026-08-11T10:07:30.000Z",
    ]) {
      await service.runDue(now);
    }

    await expect(repository.getJob("tenant-recovery", "terminal:dead-letter"))
      .resolves.toMatchObject({
        status: "dead_letter",
        attemptCount: 5,
        deadLetteredAt: "2026-08-11T10:07:30.000Z",
        lastError: "billing unavailable",
      });
    expect(alerts.terminalRecoveryDeadLettered).toHaveBeenCalledWith({
      commercialMode: "payg",
      attemptCount: 5,
    });
    await service.runDue("2026-08-11T11:00:00.000Z");
    expect(alerts.terminalRecoveryDeadLettered).toHaveBeenCalledTimes(1);
  }, 15_000);
});
