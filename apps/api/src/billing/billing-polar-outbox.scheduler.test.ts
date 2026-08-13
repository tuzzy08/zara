import { describe, expect, it, vi } from "vitest";

import { BillingPolarOutboxScheduler } from "./billing-polar-outbox.scheduler";

describe("BillingPolarOutboxScheduler", () => {
  it("runs at startup, schedules recurring delivery, and stops cleanly", async () => {
    let scheduledPass: (() => void | Promise<void>) | undefined;
    const intervalHandle = { id: "billing-outbox" };
    const runtime = {
      now: () => new Date("2026-08-10T01:00:00.000Z"),
      setInterval: vi.fn((callback: () => void | Promise<void>, intervalMs: number) => {
        scheduledPass = callback;
        expect(intervalMs).toBe(30_000);
        return intervalHandle;
      }),
      clearInterval: vi.fn(),
    };
    const worker = {
      runOnce: vi.fn(async () => ({
        claimed: 0,
        delivered: 0,
        retried: 0,
        deadLettered: 0,
        disabled: true,
      })),
    };
    const scheduler = new BillingPolarOutboxScheduler(worker, runtime);

    await scheduler.onApplicationBootstrap();
    await scheduledPass?.();
    await scheduler.beforeApplicationShutdown();

    expect(worker.runOnce).toHaveBeenNthCalledWith(
      1,
      "2026-08-10T01:00:00.000Z",
    );
    expect(worker.runOnce).toHaveBeenNthCalledWith(
      2,
      "2026-08-10T01:00:00.000Z",
    );
    expect(runtime.setInterval).toHaveBeenCalledTimes(1);
    expect(runtime.clearInterval).toHaveBeenCalledWith(intervalHandle);
  });
});
