import { describe, expect, it } from "vitest";

import { calculatePaygCallCharge } from "./billing-payg-call-charge-policy";

const catalogDocument = {
  payg: {
    standardRuntimePerMinuteMinor: 18,
    premiumRuntimePerMinuteMinor: 45,
  },
  telephonyRoutes: {
    "twilio-ng-outbound": {
      provider: "twilio",
      direction: "outbound",
      sourceCountry: "NG",
      destinationZone: "nigeria-local-mobile",
      providerSku: "twilio-voice-ng-local-mobile-media-streams",
      currency: "usd",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      customerRateMinorPerMinute: 35,
      rounding: "next_full_minute",
    },
  },
};

describe("calculatePaygCallCharge", () => {
  it("calculates a platform call from trusted runtime and connected durations", () => {
    expect(calculatePaygCallCharge({
      catalogDocument,
      runtimePath: "pstn-sandwich",
      runtimeSeconds: 125,
      ownershipMode: "platform-managed",
      provider: "twilio",
      direction: "outbound",
      routeIdentity: {
        rateId: "twilio-ng-outbound",
        provider: "twilio",
        direction: "outbound",
        sourceCountry: "NG",
        destinationZone: "nigeria-local-mobile",
        providerSku: "twilio-voice-ng-local-mobile-media-streams",
        currency: "usd",
        effectiveAt: "2026-08-11T09:00:00.000Z",
      },
      providerConnectedSeconds: 121,
    })).toEqual({
      runtimeMinor: 38,
      telephonyMinor: 105,
      totalMinor: 143,
    });
  });

  it.each([
    ["sourceCountry", "US"],
    ["destinationZone", "global"],
    ["providerSku", "twilio-unknown"],
    ["currency", "ngn"],
    ["effectiveAt", "2026-07-31T23:59:59.000Z"],
  ] as const)("rejects a platform route with mismatched %s", (field, value) => {
    expect(() => calculatePaygCallCharge({
      catalogDocument,
      runtimePath: "pstn-sandwich",
      runtimeSeconds: 60,
      ownershipMode: "platform-managed",
      provider: "twilio",
      direction: "outbound",
      routeIdentity: {
        rateId: "twilio-ng-outbound",
        provider: "twilio",
        direction: "outbound",
        sourceCountry: "NG",
        destinationZone: "nigeria-local-mobile",
        providerSku: "twilio-voice-ng-local-mobile-media-streams",
        currency: "usd",
        effectiveAt: "2026-08-11T09:00:00.000Z",
        [field]: value,
      },
      providerConnectedSeconds: 60,
    })).toThrow(/does not match|is not effective|is unsupported/);
  });

  it("charges BYO calls only for runtime", () => {
    expect(calculatePaygCallCharge({
      catalogDocument,
      runtimePath: "pstn-premium-realtime",
      runtimeSeconds: 61,
      ownershipMode: "byo",
      provider: "twilio",
      direction: "inbound",
    })).toEqual({
      runtimeMinor: 46,
      telephonyMinor: 0,
      totalMinor: 46,
    });
  });
});
