import { describe, expect, it } from "vitest";

import { PremiumProviderMessagePressure } from "./premium-provider-message-pressure";

describe("PremiumProviderMessagePressure", () => {
  it("rejects one oversized message without reserving control-queue capacity", () => {
    const pressure = new PremiumProviderMessagePressure({ maxBytes: 10, maxCount: 2 });

    expect(() => pressure.assertMessageWithinLimit(11)).toThrow("premium_provider_output_overflow");
    expect(pressure.getSnapshot()).toEqual({ bytes: 0, count: 0 });
  });

  it("rejects the attempted message without mutating its bounded ledger", () => {
    const pressure = new PremiumProviderMessagePressure({ maxBytes: 10, maxCount: 2 });

    expect(pressure.acquire(6)).toEqual({ bytes: 6, count: 1 });
    expect(() => pressure.acquire(5)).toThrow("premium_provider_output_overflow");
    expect(pressure.getSnapshot()).toEqual({ bytes: 6, count: 1 });
    expect(pressure.release(6)).toEqual({ bytes: 0, count: 0 });
  });
});
