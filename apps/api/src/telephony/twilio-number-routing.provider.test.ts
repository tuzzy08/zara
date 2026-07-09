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

    const configuration = await provider.configureIncomingPhoneNumberWebhook({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token",
      phoneNumberSid: "PN-real-voice",
      voiceUrl: "https://api.zara.test/telephony/webhooks/twilio",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(configuration).toMatchObject({
      sid: "PN-real-voice",
      phoneNumber: undefined,
      trunkSid: null,
      voiceApplicationSid: null,
      voiceMethod: "POST",
      voiceUrl: "https://api.zara.test/telephony/webhooks/twilio",
    });
  });

  it("reads back the current Twilio number voice routing configuration", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://api.twilio.com/2010-04-01/Accounts/AC1234567890abcdef1234567890abcd/IncomingPhoneNumbers/PN-real-voice.json",
      );
      expect(init?.method).toBe("GET");

      return new Response(JSON.stringify({
        sid: "PN-real-voice",
        phone_number: "+14155557890",
        trunk_sid: null,
        voice_application_sid: "",
        voice_method: "POST",
        voice_url: "https://api.zara.test/telephony/webhooks/twilio",
        voice_receive_mode: "voice",
        status_callback: "",
        capabilities: {
          voice: true,
          sms: true,
        },
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    });
    const provider = new TwilioRestNumberRoutingProvider(fetchMock);

    await expect(provider.inspectIncomingPhoneNumber({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token",
      phoneNumberSid: "PN-real-voice",
    })).resolves.toMatchObject({
      sid: "PN-real-voice",
      phoneNumber: "+14155557890",
      trunkSid: null,
      voiceApplicationSid: "",
      voiceMethod: "POST",
      voiceUrl: "https://api.zara.test/telephony/webhooks/twilio",
      voiceReceiveMode: "voice",
      statusCallback: "",
      capabilities: {
        voice: true,
        sms: true,
      },
    });
  });

  it("lists recent Twilio inbound calls for a configured number", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://api.twilio.com/2010-04-01/Accounts/AC1234567890abcdef1234567890abcd/Calls.json?To=%2B14155557890&PageSize=3",
      );
      expect(init?.method).toBe("GET");

      return new Response(JSON.stringify({
        calls: [
          {
            sid: "CA-recent-busy",
            status: "busy",
            direction: "inbound",
            from: "+16368127159",
            to: "+14155557890",
            phone_number_sid: "PN-real-voice",
            start_time: "Thu, 09 Jul 2026 13:45:52 +0000",
            end_time: "Thu, 09 Jul 2026 13:45:54 +0000",
            duration: "0",
          },
        ],
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    });
    const provider = new TwilioRestNumberRoutingProvider(fetchMock);

    await expect(provider.listRecentCallsForNumber({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token",
      phoneNumber: "+14155557890",
      limit: 3,
    })).resolves.toEqual([
      {
        sid: "CA-recent-busy",
        status: "busy",
        direction: "inbound",
        from: "+16368127159",
        to: "+14155557890",
        phoneNumberSid: "PN-real-voice",
        startTime: "Thu, 09 Jul 2026 13:45:52 +0000",
        endTime: "Thu, 09 Jul 2026 13:45:54 +0000",
        duration: "0",
      },
    ]);
  });

  it("lists recent Twilio Monitor alerts for provider webhook diagnostics", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://monitor.twilio.com/v1/Alerts?LogLevel=error&StartDate=2026-07-09T13%3A40%3A52Z&PageSize=10",
      );
      expect(init?.method).toBe("GET");

      return new Response(JSON.stringify({
        alerts: [
          {
            sid: "NOaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            error_code: "11200",
            alert_text: "HTTP retrieval failure",
            log_level: "error",
            more_info: "https://www.twilio.com/docs/api/errors/11200",
            request_method: "POST",
            request_url: "https://api.zara.test/telephony/webhooks/twilio",
            resource_sid: "CA-recent-busy",
            service_sid: null,
            date_generated: "2026-07-09T13:45:53Z",
            date_created: "2026-07-09T13:45:54Z",
          },
        ],
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    });
    const provider = new TwilioRestNumberRoutingProvider(fetchMock);

    await expect(provider.listRecentMonitorAlerts({
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token",
      limit: 10,
      startDate: "2026-07-09T13:40:52Z",
    })).resolves.toEqual([
      {
        sid: "NOaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        errorCode: "11200",
        alertText: "HTTP retrieval failure",
        logLevel: "error",
        moreInfo: "https://www.twilio.com/docs/api/errors/11200",
        requestMethod: "POST",
        requestUrl: "https://api.zara.test/telephony/webhooks/twilio",
        resourceSid: "CA-recent-busy",
        serviceSid: null,
        dateGenerated: "2026-07-09T13:45:53Z",
        dateCreated: "2026-07-09T13:45:54Z",
      },
    ]);
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
