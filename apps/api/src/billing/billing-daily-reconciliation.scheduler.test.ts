import { describe, expect, it, vi } from "vitest";

import {
  BillingDailyReconciliationRunner,
  BillingDailyReconciliationScheduler,
} from "./billing-daily-reconciliation.scheduler";

describe("BillingDailyReconciliationRunner", () => {
  it("runs each configured-catalog tenant cycle with release-bound daily evidence", async () => {
    const repository = {
      listTenantCycles: vi.fn().mockResolvedValue([
        {
          organizationId: "tenant-a",
          catalogId: "catalog-1",
          cycleStartsAt: "2026-08-01T00:00:00.000Z",
          cycleEndsAt: "2026-09-01T00:00:00.000Z",
        },
        {
          organizationId: "tenant-old-catalog",
          catalogId: "catalog-old",
          cycleStartsAt: "2026-08-01T00:00:00.000Z",
          cycleEndsAt: "2026-09-01T00:00:00.000Z",
        },
      ]),
    };
    const reconciliation = { reconcileTenantCycle: vi.fn().mockResolvedValue({ status: "matched" }) };
    const providerEvidenceCollector = { collectTenantCycle: vi.fn().mockResolvedValue({ imported: 2 }) };
    const runner = new BillingDailyReconciliationRunner(repository, reconciliation, {
      releaseId: "release-1",
      catalogId: "catalog-1",
      validityMs: 86_400_000,
    }, providerEvidenceCollector);

    await runner.runOnce("2026-09-01T03:00:00.000Z");

    expect(reconciliation.reconcileTenantCycle).toHaveBeenCalledTimes(1);
    expect(providerEvidenceCollector.collectTenantCycle).toHaveBeenCalledWith({
      organizationId: "tenant-a",
      catalogId: "catalog-1",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    });
    expect(reconciliation.reconcileTenantCycle).toHaveBeenCalledWith({
      organizationId: "tenant-a",
      catalogId: "catalog-1",
      releaseId: "release-1",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      runKey: "daily:release-1:2026-09-01",
      validUntil: "2026-09-02T03:00:00.000Z",
      providerCollectionFailed: false,
    });
  });

  it("persists a missing-evidence report when provider collection fails", async () => {
    const cycle = {
      organizationId: "tenant-a",
      catalogId: "catalog-1",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    };
    const reconciliation = { reconcileTenantCycle: vi.fn().mockResolvedValue({ status: "mismatch" }) };
    const runner = new BillingDailyReconciliationRunner(
      { listTenantCycles: vi.fn().mockResolvedValue([cycle]) },
      reconciliation,
      { releaseId: "release-1", catalogId: "catalog-1", validityMs: 86_400_000 },
      { collectTenantCycle: vi.fn().mockRejectedValue(new Error("provider unavailable")) },
    );

    await expect(runner.runOnce("2026-09-01T03:00:00.000Z")).resolves.toBeUndefined();
    expect(reconciliation.reconcileTenantCycle).toHaveBeenCalledWith(expect.objectContaining({
      providerCollectionFailed: true,
    }));
  });

  it("skips a billing cycle that has not ended", async () => {
    const activeCycle = {
      organizationId: "tenant-a",
      catalogId: "catalog-1",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    };
    const reconciliation = { reconcileTenantCycle: vi.fn() };
    const providerEvidenceCollector = { collectTenantCycle: vi.fn() };
    const runner = new BillingDailyReconciliationRunner(
      { listTenantCycles: vi.fn().mockResolvedValue([activeCycle]) },
      reconciliation,
      { releaseId: "release-1", catalogId: "catalog-1", validityMs: 86_400_000 },
      providerEvidenceCollector,
    );

    await expect(runner.runOnce("2026-08-31T23:59:59.999Z")).resolves.toBeUndefined();
    expect(providerEvidenceCollector.collectTenantCycle).not.toHaveBeenCalled();
    expect(reconciliation.reconcileTenantCycle).not.toHaveBeenCalled();
  });
});

describe("BillingDailyReconciliationScheduler", () => {
  it("runs at bootstrap and daily, prevents overlap, and waits during shutdown", async () => {
    let finish: (() => void) | undefined;
    const pass = new Promise<void>((resolve) => { finish = resolve; });
    const runner = { runOnce: vi.fn().mockReturnValue(pass) };
    let callback: (() => void | Promise<void>) | undefined;
    const runtime = {
      now: () => new Date("2026-09-01T03:00:00.000Z"),
      setInterval: vi.fn((next: () => void | Promise<void>, intervalMs: number) => {
        callback = next;
        expect(intervalMs).toBe(86_400_000);
        return "daily-handle";
      }),
      clearInterval: vi.fn(),
    };
    const scheduler = new BillingDailyReconciliationScheduler(runner, runtime);

    const bootstrap = scheduler.onApplicationBootstrap();
    expect(runner.runOnce).toHaveBeenCalledTimes(1);
    expect(scheduler.runNow()).toBe(scheduler.runNow());
    finish?.();
    await bootstrap;
    expect(callback).toBeTypeOf("function");
    await callback?.();
    expect(runner.runOnce).toHaveBeenCalledTimes(2);
    await scheduler.beforeApplicationShutdown();
    expect(runtime.clearInterval).toHaveBeenCalledWith("daily-handle");
  });
});
