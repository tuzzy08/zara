import { describe, expect, it, vi } from "vitest";

import { BillingCustomerStateReconciliationScheduler } from "./billing-customer-state-reconciliation.scheduler";

describe("BillingCustomerStateReconciliationScheduler", () => {
  it("runs at startup, schedules reconciliation, and stops cleanly", async () => {
    let scheduledPass: (() => void | Promise<void>) | undefined;
    const intervalHandle = { id: "billing-customer-state" };
    const runtime = {
      now: () => new Date("2026-08-10T03:00:00.000Z"),
      setInterval: vi.fn((callback: () => void | Promise<void>, intervalMs: number) => {
        scheduledPass = callback;
        expect(intervalMs).toBe(15 * 60_000);
        return intervalHandle;
      }),
      clearInterval: vi.fn(),
    };
    const reconciliation = {
      runOnce: vi.fn(async () => ({ checked: 1, repaired: 1, failed: 0 })),
    };
    const scheduler = new BillingCustomerStateReconciliationScheduler(
      reconciliation,
      runtime,
    );

    await scheduler.onApplicationBootstrap();
    await scheduledPass?.();
    await scheduler.beforeApplicationShutdown();

    expect(reconciliation.runOnce).toHaveBeenCalledTimes(2);
    expect(reconciliation.runOnce).toHaveBeenNthCalledWith(
      1,
      "2026-08-10T03:00:00.000Z",
    );
    expect(runtime.clearInterval).toHaveBeenCalledWith(intervalHandle);
  });
});
