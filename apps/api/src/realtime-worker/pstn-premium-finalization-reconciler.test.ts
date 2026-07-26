import { describe, expect, it, vi } from "vitest";

import { PstnPremiumFinalizationReconciler } from "./pstn-premium-finalization-reconciler";

describe("PstnPremiumFinalizationReconciler", () => {
  it("reconciles one bounded batch on startup and emits the durable outcome", async () => {
    const calls: Array<{ before: string; limit: number }> = [];
    const outcomes: string[] = [];
    const runtime = createRuntime();
    const reconciler = new PstnPremiumFinalizationReconciler(
      {
        async reconcileExpiredPremiumCallOwners(input) {
          calls.push(input);
          return { reconciledCount: 2 };
        },
      },
      {
        recordFinalization(input: { outcome: string }) {
          outcomes.push(input.outcome);
        },
      } as never,
      runtime,
    );

    await reconciler.onApplicationBootstrap();

    expect(calls).toEqual([{
      before: "2026-07-26T20:00:00.000Z",
      limit: 100,
    }]);
    expect(outcomes).toEqual(["reconciled", "reconciled"]);
    expect(runtime.intervalMs).toBe(30_000);
  });

  it("suppresses overlapping reconciliation passes", async () => {
    const release = deferred<void>();
    let calls = 0;
    const reconciler = new PstnPremiumFinalizationReconciler(
      {
        async reconcileExpiredPremiumCallOwners() {
          calls += 1;
          await release.promise;
          return { reconciledCount: 0 };
        },
      },
      undefined,
      createRuntime(),
    );

    const first = reconciler.reconcileNow();
    const second = reconciler.reconcileNow();
    expect(calls).toBe(1);

    release.resolve();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  it("contains repository failures and retries on the next scheduled pass", async () => {
    let calls = 0;
    const outcomes: string[] = [];
    const runtime = createRuntime();
    const reconciler = new PstnPremiumFinalizationReconciler(
      {
        async reconcileExpiredPremiumCallOwners() {
          calls += 1;
          if (calls === 1) throw new Error("postgres unavailable");
          return { reconciledCount: 1 };
        },
      },
      {
        recordFinalization(input: { outcome: string }) {
          outcomes.push(input.outcome);
        },
      } as never,
      runtime,
    );

    await reconciler.onApplicationBootstrap();
    expect(outcomes).toEqual(["failed"]);

    await runtime.tick();
    expect(calls).toBe(2);
    expect(outcomes).toEqual(["failed", "reconciled"]);
  });

  it("stops the scheduled pass before worker shutdown", async () => {
    const runtime = createRuntime();
    const reconciler = new PstnPremiumFinalizationReconciler(
      {
        async reconcileExpiredPremiumCallOwners() {
          return { reconciledCount: 0 };
        },
      },
      undefined,
      runtime,
    );
    await reconciler.onApplicationBootstrap();

    reconciler.beforeApplicationShutdown();

    expect(runtime.cleared).toBe(true);
  });

  it("awaits an in-flight reconciliation before worker shutdown completes", async () => {
    const release = deferred<void>();
    let calls = 0;
    const runtime = createRuntime();
    const reconciler = new PstnPremiumFinalizationReconciler(
      {
        async reconcileExpiredPremiumCallOwners() {
          calls += 1;
          if (calls > 1) {
            await release.promise;
          }
          return { reconciledCount: 0 };
        },
      },
      undefined,
      runtime,
    );
    await reconciler.onApplicationBootstrap();
    const activePass = runtime.tick();
    expect(calls).toBe(2);

    let shutdownCompleted = false;
    const shutdown = Promise.resolve(reconciler.beforeApplicationShutdown())
      .then(() => {
        shutdownCompleted = true;
      });
    await Promise.resolve();

    expect(runtime.cleared).toBe(true);
    expect(shutdownCompleted).toBe(false);

    release.resolve();
    await Promise.all([activePass, shutdown]);
    expect(shutdownCompleted).toBe(true);
  });
});

function createRuntime() {
  let callback: (() => void | Promise<void>) | undefined;
  return {
    intervalMs: 0,
    cleared: false,
    now() {
      return new Date("2026-07-26T20:00:00.000Z");
    },
    setInterval(next: () => void | Promise<void>, intervalMs: number) {
      callback = next;
      this.intervalMs = intervalMs;
      return Symbol("reconciler-interval");
    },
    clearInterval() {
      this.cleared = true;
      callback = undefined;
    },
    async tick() {
      await callback?.();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
