import { describe, expect, it } from "vitest";

import {
  assertPstnCallAdmissionLeaseInput,
  assertPstnCallAdmissionInput,
  PSTN_CALL_ADMISSION,
  type PstnCallAdmissionInput,
} from "./pstn-call-admission";

const validInput: PstnCallAdmissionInput = {
  reservationId: "reservation-1",
  callSessionId: "call-1",
  tenantId: "tenant-1",
  providerAccountId: "account-1",
  workerId: "worker-1",
  provider: "twilio",
  runtime: "premium-realtime",
  limits: {
    global: 20,
    provider: 20,
    tenant: 5,
    runtime: 10,
    worker: 4,
  },
  cps: {
    global: {
      capacity: 10,
      refillPerSecond: 5,
    },
    providerAccount: {
      capacity: 4,
      refillPerSecond: 2,
    },
  },
  claimTtlMs: 10_000,
  activeTtlMs: 60_000,
};

describe("PstnCallAdmission contract", () => {
  it("exports the standard dependency-injection token", () => {
    expect(typeof PSTN_CALL_ADMISSION).toBe("symbol");
    expect(PSTN_CALL_ADMISSION.description).toBe("PSTN_CALL_ADMISSION");
  });

  it("accepts opaque identities, finite non-negative limits, and bounded lease TTLs", () => {
    expect(() => assertPstnCallAdmissionInput(validInput)).not.toThrow();
    expect(() =>
      assertPstnCallAdmissionInput({
        ...validInput,
        limits: { ...validInput.limits, provider: 0 },
      }),
    ).not.toThrow();
  });

  it("requires worker ownership on lease renewal", () => {
    expect(() =>
      assertPstnCallAdmissionLeaseInput({
        reservationId: validInput.reservationId,
        workerId: validInput.workerId,
        ownershipEpoch: 1,
        activeTtlMs: validInput.activeTtlMs,
      }),
    ).not.toThrow();
    expect(() =>
      assertPstnCallAdmissionLeaseInput({
        reservationId: validInput.reservationId,
        activeTtlMs: validInput.activeTtlMs,
      } as never),
    ).toThrow("Invalid PSTN call admission lease input.");
  });

  it.each([
    [
      "opaque identity",
      { ...validInput, providerAccountId: "" },
    ],
    [
      "concurrency",
      { ...validInput, limits: { ...validInput.limits, tenant: -1 } },
    ],
    [
      "CPS capacity",
      {
        ...validInput,
        cps: {
          ...validInput.cps,
          global: { ...validInput.cps.global, capacity: 0 },
        },
      },
    ],
    [
      "CPS refill",
      {
        ...validInput,
        cps: {
          ...validInput.cps,
          providerAccount: {
            ...validInput.cps.providerAccount,
            refillPerSecond: Number.NaN,
          },
        },
      },
    ],
    [
      "claim lease",
      {
        ...validInput,
        claimTtlMs: 300_001,
      },
    ],
    [
      "active lease",
      {
        ...validInput,
        activeTtlMs: 300_001,
      },
    ],
  ])("rejects an invalid %s setting", (_label, input) => {
    expect(() =>
      assertPstnCallAdmissionInput(input as PstnCallAdmissionInput),
    ).toThrow("Invalid PSTN call admission input.");
  });
});
