import { describe, expect, it, vi } from "vitest";

import { BillingPaygReservationQuoteService } from "../billing/billing-payg-reservation-quote.service";
import { TrustedPaygCallLifecycleService } from "../billing/trusted-payg-call-lifecycle.service";
import { TrustedPaygTelephonyCallStartService } from "./trusted-payg-telephony-call-start.service";

describe("TrustedPaygTelephonyCallStartService", () => {
  it("blocks platform-managed inbound PAYG before provider admission", async () => {
    const getEffectivePriceCatalog = vi.fn();
    const reservePaygCredit = vi.fn();
    const startProvider = vi.fn();
    const service = new TrustedPaygTelephonyCallStartService(
      new BillingPaygReservationQuoteService({ getEffectivePriceCatalog } as never),
      new TrustedPaygCallLifecycleService({ reservePaygCredit } as never),
    );

    await expect(service.start({
      organizationId: "tenant-payg",
      callSessionId: "call-inbound-platform",
      effectiveAt: "2026-08-11T09:00:00.000Z",
      maximumCallSeconds: 300,
      runtimePath: "pstn-sandwich",
      ownershipMode: "platform-managed",
      provider: "twilio",
      direction: "inbound",
      reservationExpiresAt: "2026-08-11T09:06:00.000Z",
      startProvider,
    })).resolves.toEqual({
      outcome: "blocked",
      reason: "unsupported_platform_managed_inbound_payg",
    });
    expect(getEffectivePriceCatalog).not.toHaveBeenCalled();
    expect(reservePaygCredit).not.toHaveBeenCalled();
    expect(startProvider).not.toHaveBeenCalled();
  });

  it("quotes and reserves before live provider start, blocks insufficient credit, and releases a failed start", async () => {
    const events: string[] = [];
    let availableMinor = 500;
    let reservationStatus: "active" | "released" | undefined;
    const ledger = {
      async getEffectivePriceCatalog() {
        events.push("catalog-quoted");
        return {
          id: "catalog-2026-08-v1",
          currency: "usd",
          document: {
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
          },
        };
      },
    };
    const reservations = {
      async reservePaygCredit(input: { amountMinor: number }) {
        events.push(`reserved:${input.amountMinor}`);
        if (input.amountMinor > availableMinor) {
          return {
            outcome: "denied" as const,
            reason: "insufficient_payg_credit" as const,
            availableMinor,
          };
        }
        availableMinor -= input.amountMinor;
        reservationStatus = "active";
        return {
          outcome: "reserved" as const,
          duplicate: false,
          availableMinor,
          reservation: { id: "reservation-1" },
        };
      },
      async releasePaygCredit() {
        events.push("released");
        reservationStatus = "released";
      },
    };
    const service = new TrustedPaygTelephonyCallStartService(
      new BillingPaygReservationQuoteService(ledger as never),
      new TrustedPaygCallLifecycleService(reservations as never),
    );
    const common = {
      organizationId: "tenant-payg",
      callSessionId: "call-1",
      effectiveAt: "2026-08-11T09:00:00.000Z",
      maximumCallSeconds: 300,
      runtimePath: "pstn-sandwich" as const,
      ownershipMode: "platform-managed" as const,
      provider: "twilio",
      fromPhoneNumber: "+2342012345678",
      toPhoneNumber: "+2348031234567",
      reservationExpiresAt: "2026-08-11T09:06:00.000Z",
    };

    const started = await service.startOutbound({
      ...common,
      startProvider: async () => {
        events.push("provider-started");
        return "provider-call";
      },
    });
    expect(started.outcome).toBe("started");
    expect(events).toEqual(["catalog-quoted", "reserved:265", "provider-started"]);

    const blocked = await service.startOutbound({
      ...common,
      callSessionId: "call-2",
      startProvider: async () => {
        events.push("provider-must-not-start");
      },
    });
    expect(blocked).toMatchObject({
      outcome: "blocked",
      reason: "insufficient_payg_credit",
    });
    expect(events).not.toContain("provider-must-not-start");

    availableMinor = 500;
    await expect(service.startOutbound({
      ...common,
      callSessionId: "call-3",
      startProvider: async () => {
        events.push("provider-failed");
        throw new Error("provider start failed");
      },
    })).rejects.toThrow("provider start failed");
    expect(reservationStatus).toBe("released");
    expect(events.slice(-3)).toEqual(["reserved:265", "provider-failed", "released"]);

    availableMinor = 500;
    const byo = await service.startOutbound({
      ...common,
      callSessionId: "call-byo",
      ownershipMode: "byo",
      toPhoneNumber: "+14155550100",
      startProvider: async () => {
        events.push("provider-started");
        return "provider-byo-call";
      },
    });
    expect(byo).toMatchObject({ outcome: "started" });
    expect(events.slice(-2)).toEqual(["reserved:90", "provider-started"]);
  });
});
