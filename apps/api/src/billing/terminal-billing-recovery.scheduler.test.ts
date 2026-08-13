import { describe, expect, it, vi } from "vitest";

import { TerminalBillingRecoveryScheduler } from "./terminal-billing-recovery.scheduler";

describe("TerminalBillingRecoveryScheduler", () => {
  it("retries durable terminal billing jobs at startup and on a bounded interval", async () => {
    let scheduled: (() => void | Promise<void>) | undefined;
    const handle = { id: "terminal-recovery" };
    const runtime = {
      now: () => new Date("2026-08-11T11:00:00.000Z"),
      setInterval: vi.fn((callback: () => void | Promise<void>, delay: number) => {
        scheduled = callback;
        expect(delay).toBe(30_000);
        return handle;
      }),
      clearInterval: vi.fn(),
    };
    const recovery = { runDue: vi.fn().mockResolvedValue(undefined) };
    const scheduler = new TerminalBillingRecoveryScheduler(recovery, runtime);

    await scheduler.onApplicationBootstrap();
    await scheduled?.();
    await scheduler.beforeApplicationShutdown();

    expect(recovery.runDue).toHaveBeenCalledTimes(2);
    expect(recovery.runDue).toHaveBeenNthCalledWith(1, "2026-08-11T11:00:00.000Z");
    expect(runtime.clearInterval).toHaveBeenCalledWith(handle);
  });
});
