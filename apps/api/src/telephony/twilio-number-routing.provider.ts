export const TWILIO_NUMBER_ROUTING_PROVIDER = Symbol("TWILIO_NUMBER_ROUTING_PROVIDER");

export interface TwilioNumberRoutingProvider {
  configureIncomingPhoneNumberWebhook(input: {
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
    voiceUrl: string;
  }): Promise<void>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class TwilioRestNumberRoutingProvider implements TwilioNumberRoutingProvider {
  constructor(private readonly fetchFn: FetchLike = globalThis.fetch.bind(globalThis)) {}

  async configureIncomingPhoneNumberWebhook(input: {
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
    voiceUrl: string;
  }): Promise<void> {
    const accountSid = input.accountSid.trim();
    const authToken = input.authToken.trim();
    const phoneNumberSid = input.phoneNumberSid.trim();
    const voiceUrl = input.voiceUrl.trim();

    if (accountSid.length === 0 || authToken.length === 0 || phoneNumberSid.length === 0 || voiceUrl.length === 0) {
      throw new Error("Twilio number webhook configuration requires connected account credentials and an imported number SID.");
    }

    const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
    const body = new URLSearchParams({
      VoiceMethod: "POST",
      VoiceUrl: voiceUrl,
    });

    let response: Response;
    try {
      response = await this.fetchFn(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberSid)}.json`,
        {
          body,
          headers: {
            Accept: "application/json",
            Authorization: authorization,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
      );
    } catch {
      throw new Error("Could not reach Twilio phone number routing.");
    }

    if (!response.ok) {
      throw new Error(resolveTwilioRoutingErrorMessage(response.status));
    }
  }
}

function resolveTwilioRoutingErrorMessage(status: number) {
  if (status === 401 || status === 403) {
    return "Twilio rejected the connected account credentials while configuring the number webhook.";
  }

  if (status === 404) {
    return "Twilio could not find the imported phone number in the connected account.";
  }

  if (status === 429) {
    return "Twilio rate-limited phone number routing configuration. Try again shortly.";
  }

  if (status >= 500) {
    return "Twilio phone number routing is temporarily unavailable.";
  }

  return "Twilio number webhook configuration failed.";
}
