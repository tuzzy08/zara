import { describe, expect, it } from "vitest";

import { PstnPremiumPlaybackAdmission } from "./pstn-premium-playback-admission";

describe("PstnPremiumPlaybackAdmission", () => {
  it("bounds aggregate queued playback bytes and releases each reservation exactly once", () => {
    const admission = new PstnPremiumPlaybackAdmission(300);

    const first = admission.acquire(200);
    expect(admission.getResidentBytes()).toBe(200);
    expect(() => admission.acquire(101)).toThrow("premium_playback_capacity_overflow");
    expect(admission.getResidentBytes()).toBe(200);

    first.release();
    first.release();
    expect(admission.getResidentBytes()).toBe(0);
    expect(admission.acquire(300)).toBeTruthy();
  });
});
