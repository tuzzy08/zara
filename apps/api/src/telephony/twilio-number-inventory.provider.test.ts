import { describe, expect, it, vi } from "vitest";

import { TwilioRestNumberInventoryProvider } from "./twilio-number-inventory.provider";

describe("TwilioRestNumberInventoryProvider", () => {
  it("lists incoming phone numbers from Twilio and normalizes voice capabilities", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://api.twilio.com/2010-04-01/Accounts/AC1234567890abcdef1234567890abcd/IncomingPhoneNumbers.json?PageSize=1000",
      );
      expect(init?.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from("AC1234567890abcdef1234567890abcd:twilio-auth-token").toString("base64")}`,
        Accept: "application/json",
      });

      return new Response(JSON.stringify({
        incoming_phone_numbers: [
          {
            sid: "PN-real-voice",
            phone_number: "+14155550123",
            friendly_name: "Real support line",
            capabilities: {
              voice: true,
              SMS: true,
            },
          },
          {
            sid: "PN-sms-only",
            phone_number: "+14155550124",
            friendly_name: null,
            capabilities: {
              voice: false,
              sms: true,
            },
          },
        ],
        next_page_uri: null,
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    });
    const provider = new TwilioRestNumberInventoryProvider(fetchMock);

    await expect(provider.listIncomingPhoneNumbers({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token",
    })).resolves.toEqual([
      {
        sid: "PN-real-voice",
        phoneNumber: "+14155550123",
        friendlyName: "Real support line",
        capabilities: {
          voice: true,
          sms: true,
        },
      },
      {
        sid: "PN-sms-only",
        phoneNumber: "+14155550124",
        friendlyName: "+14155550124",
        capabilities: {
          voice: false,
          sms: true,
        },
      },
    ]);
  });

  it("maps Twilio authentication failures to product-safe errors without leaking credentials", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 20003,
      message: "Authenticate",
    }), {
      status: 401,
    }));
    const provider = new TwilioRestNumberInventoryProvider(fetchMock);

    await expect(provider.listIncomingPhoneNumbers({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "secret-token",
    })).rejects.toThrow("Twilio rejected the connected account credentials.");
    await expect(provider.listIncomingPhoneNumbers({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "secret-token",
    })).rejects.not.toThrow("secret-token");
  });
});
