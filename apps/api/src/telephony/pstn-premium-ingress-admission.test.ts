import { describe, expect, it } from "vitest";

import { PstnPremiumIngressAdmission } from "./pstn-premium-ingress-admission";

describe("PstnPremiumIngressAdmission", () => {
  it("admits aggregate resident payload bytes and releases them exactly once", () => {
    const admission = new PstnPremiumIngressAdmission(300);

    const first = admission.acquire(200);
    expect(admission.getResidentBytes()).toBe(200);
    expect(() => admission.acquire(101)).toThrow("premium_ingress_capacity_exhausted");
    expect(admission.getResidentBytes()).toBe(200);

    first.release();
    first.release();
    expect(admission.getResidentBytes()).toBe(0);
    expect(admission.acquire(300)).toBeTruthy();
  });
});
