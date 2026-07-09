import { describe, expect, it, vi } from "vitest";

import { TwilioRestNumberRoutingProvider } from "./twilio-number-routing.provider";

describe("TwilioRestNumberRoutingProvider", () => {
  it("configures an imported Twilio number to call the Zara webhook", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://api.twilio.com/2010-04-01/Accounts/AC1234567890abcdef1234567890abcd/IncomingPhoneNumbers/PN-real-voice.json",
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from("AC1234567890abcdef1234567890abcd:twilio-auth-token").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      });
      expect(init?.body).toBeInstanceOf(URLSearchParams);
      expect((init?.body as URLSearchParams).get("VoiceUrl")).toBe("https://api.zara.test/telephony/webhooks/twilio");
      expect((init?.body as URLSearchParams).get("VoiceMethod")).toBe("POST");
      expect((init?.body as URLSearchParams).get("VoiceApplicationSid")).toBe("");
      expect((init?.body as URLSearchParams).get("TrunkSid")).toBe("");

      return new Response(JSON.stringify({
        sid: "PN-real-voice",
        trunk_sid: null,
        voice_application_sid: null,
        voice_url: "https://api.zara.test/telephony/webhooks/twilio",
        voice_method: "POST",
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    });
    const provider = new TwilioRestNumberRoutingProvider(fetchMock);

    await provider.configureIncomingPhoneNumberWebhook({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token",
      phoneNumberSid: "PN-real-voice",
      voiceUrl: "https://api.zara.test/telephony/webhooks/twilio",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a route save when Twilio still reports an app or trunk that would ignore the Voice URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      sid: "PN-real-voice",
      trunk_sid: "TKaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      voice_application_sid: null,
      voice_url: "https://api.zara.test/telephony/webhooks/twilio",
      voice_method: "POST",
    }), {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    }));
    const provider = new TwilioRestNumberRoutingProvider(fetchMock);

    await expect(provider.configureIncomingPhoneNumberWebhook({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token",
      phoneNumberSid: "PN-real-voice",
      voiceUrl: "https://api.zara.test/telephony/webhooks/twilio",
    })).rejects.toThrow("Twilio still has a Voice Application or SIP Trunk attached to this number, so incoming calls would ignore Zara's Voice URL.");
  });

  it("maps Twilio routing failures to product-safe errors without leaking credentials", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 20003,
      message: "Authenticate",
    }), {
      status: 401,
    }));
    const provider = new TwilioRestNumberRoutingProvider(fetchMock);

    await expect(provider.configureIncomingPhoneNumberWebhook({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "secret-token",
      phoneNumberSid: "PN-real-voice",
      voiceUrl: "https://api.zara.test/telephony/webhooks/twilio",
    })).rejects.toThrow("Twilio rejected the connected account credentials while configuring the number webhook.");
    await expect(provider.configureIncomingPhoneNumberWebhook({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "secret-token",
      phoneNumberSid: "PN-real-voice",
      voiceUrl: "https://api.zara.test/telephony/webhooks/twilio",
    })).rejects.not.toThrow("secret-token");
  });
});
