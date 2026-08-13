import { describe, expect, it, vi } from "vitest";

import { TwilioRestCallBillingClient } from "./twilio-call-billing.client";

describe("Twilio REST Call billing client", () => {
  it("reads provider-owned duration, cost, time, and identity from the authenticated Call resource", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://api.twilio.com/2010-04-01/Accounts/AC-account-a/Calls.json?StartTimeAfter=2026-08-01&StartTimeBefore=2026-09-02&From=%2B14155550100&PageSize=1000",
      );
      expect(init).toMatchObject({
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from("AC-account-a:twilio-auth-token").toString("base64")}`,
        },
      });
      return new Response(JSON.stringify({ calls: [{
          sid: "CA-call-a",
          account_sid: "AC-account-a",
          status: "completed",
          direction: "outbound-api",
          duration: "61",
          price: "-0.024",
          price_unit: "USD",
          start_time: "Wed, 12 Aug 2026 09:00:10 +0000",
          end_time: "Wed, 12 Aug 2026 09:01:11 +0000",
        }], next_page_uri: null }), { status: 200 });
    });

    await expect(new TwilioRestCallBillingClient(fetchMock).listCalls({
      accountSid: "AC-account-a",
      authToken: "twilio-auth-token",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      direction: "outbound",
      phoneNumber: "+14155550100",
    })).resolves.toEqual([{
      sid: "CA-call-a",
      accountSid: "AC-account-a",
      status: "completed",
      direction: "outbound-api",
      durationSeconds: 61,
      price: "-0.024",
      priceUnit: "USD",
      startedAt: "2026-08-12T09:00:10.000Z",
      endedAt: "2026-08-12T09:01:11.000Z",
    }]);
  });

  it("fails closed when Twilio rejects the evidence request", async () => {
    const client = new TwilioRestCallBillingClient(vi.fn(async () =>
      new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 })));

    await expect(client.listCalls({
      accountSid: "AC-account-a",
      authToken: "wrong-token",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      direction: "inbound",
      phoneNumber: "+14155550100",
    })).rejects.toThrow("Twilio billing evidence request failed with status 401.");
  });

  it("uses the next UTC date so a strict upper bound includes a mid-day cycle end", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("StartTimeBefore=2026-08-16");
      return new Response(JSON.stringify({ calls: [], next_page_uri: null }), { status: 200 });
    });

    await new TwilioRestCallBillingClient(fetchMock).listCalls({
      accountSid: "AC-account-a",
      authToken: "twilio-auth-token",
      cycleStartsAt: "2026-08-12T09:00:00.000Z",
      cycleEndsAt: "2026-08-15T13:30:00.000Z",
      direction: "outbound",
      phoneNumber: "+14155550100",
    });
  });
});
