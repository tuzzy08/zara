import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TelephonyShutdownLifecycle } from "./telephony-shutdown.lifecycle";

describe("TelephonyShutdownLifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finishes admission cleanup after earlier shutdown stages fail", async () => {
    const phases: string[] = [];
    const errors: string[] = [];
    vi.spyOn(Logger.prototype, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    const lifecycle = new TelephonyShutdownLifecycle(
      {
        async shutdown() {
          phases.push("media");
          throw new Error("media terminalization failed");
        },
      } as never,
      {
        async shutdown() {
          phases.push("premium");
          throw new Error("premium persistence failed");
        },
      } as never,
      {
        async shutdown() {
          phases.push("admission");
        },
      } as never,
    );

    await expect(lifecycle.beforeApplicationShutdown()).resolves.toBeUndefined();
    await expect(lifecycle.beforeApplicationShutdown()).resolves.toBeUndefined();

    expect(phases).toEqual(["media", "premium", "admission"]);
    expect(errors).toEqual([
      expect.stringContaining(
        'telephony_shutdown_incomplete {"failedStages":["media","premium"]}',
      ),
    ]);
  });

  it("runs media, premium, and admission shutdown in order", async () => {
    const phases: string[] = [];
    const lifecycle = new TelephonyShutdownLifecycle(
      {
        async shutdown() {
          phases.push("media");
        },
      } as never,
      {
        async shutdown() {
          phases.push("premium");
        },
      } as never,
      {
        async shutdown() {
          phases.push("admission");
        },
      } as never,
    );

    await lifecycle.beforeApplicationShutdown();

    expect(phases).toEqual(["media", "premium", "admission"]);
  });
});
