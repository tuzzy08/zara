import type { AvailableTwilioPhoneNumber } from "@zara/core";

export const TWILIO_NUMBER_INVENTORY_PROVIDER = Symbol("TWILIO_NUMBER_INVENTORY_PROVIDER");

export interface TwilioNumberInventoryProvider {
  listIncomingPhoneNumbers(input: {
    accountSid: string;
    authToken: string;
  }): Promise<AvailableTwilioPhoneNumber[]>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class TwilioRestNumberInventoryProvider implements TwilioNumberInventoryProvider {
  constructor(private readonly fetchFn: FetchLike = globalThis.fetch.bind(globalThis)) {}

  async listIncomingPhoneNumbers(input: {
    accountSid: string;
    authToken: string;
  }): Promise<AvailableTwilioPhoneNumber[]> {
    const accountSid = input.accountSid.trim();
    const authToken = input.authToken.trim();

    if (accountSid.length === 0 || authToken.length === 0) {
      throw new Error("Twilio inventory import requires connected account credentials.");
    }

    const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
    const numbers: AvailableTwilioPhoneNumber[] = [];
    let nextUrl: string | null =
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=1000`;

    while (nextUrl !== null) {
      const response = await this.fetchTwilioPage(nextUrl, authorization);
      const payload = await readTwilioPayload(response);

      if (!response.ok) {
        throw new Error(resolveTwilioInventoryErrorMessage(response.status));
      }

      for (const item of readTwilioIncomingPhoneNumbers(payload)) {
        const number = normalizeTwilioIncomingPhoneNumber(item);

        if (number !== null) {
          numbers.push(number);
        }
      }

      nextUrl = resolveNextPageUrl(payload);
    }

    return numbers;
  }

  private async fetchTwilioPage(url: string, authorization: string) {
    try {
      return await this.fetchFn(url, {
        headers: {
          Accept: "application/json",
          Authorization: authorization,
        },
      });
    } catch {
      throw new Error("Could not reach Twilio phone number inventory.");
    }
  }
}

function readTwilioIncomingPhoneNumbers(payload: unknown): unknown[] {
  if (payload === null || typeof payload !== "object") {
    return [];
  }

  const incomingPhoneNumbers = (payload as { incoming_phone_numbers?: unknown }).incoming_phone_numbers;

  return Array.isArray(incomingPhoneNumbers) ? incomingPhoneNumbers : [];
}

function normalizeTwilioIncomingPhoneNumber(value: unknown): AvailableTwilioPhoneNumber | null {
  if (value === null || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    capabilities?: unknown;
    friendly_name?: unknown;
    phone_number?: unknown;
    sid?: unknown;
  };

  if (typeof candidate.sid !== "string" || typeof candidate.phone_number !== "string") {
    return null;
  }

  const capabilities = readCapabilityMap(candidate.capabilities);

  return {
    sid: candidate.sid,
    phoneNumber: candidate.phone_number,
    friendlyName:
      typeof candidate.friendly_name === "string" && candidate.friendly_name.trim().length > 0
        ? candidate.friendly_name
        : candidate.phone_number,
    capabilities: {
      voice: readCapabilityFlag(capabilities, "voice"),
      sms: readCapabilityFlag(capabilities, "sms") || readCapabilityFlag(capabilities, "SMS"),
    },
  };
}

function readCapabilityMap(value: unknown) {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readCapabilityFlag(capabilities: Record<string, unknown>, key: string) {
  return capabilities[key] === true;
}

async function readTwilioPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function resolveNextPageUrl(payload: unknown) {
  if (payload === null || typeof payload !== "object") {
    return null;
  }

  const nextPageUri = (payload as { next_page_uri?: unknown }).next_page_uri;

  if (typeof nextPageUri !== "string" || nextPageUri.trim().length === 0) {
    return null;
  }

  return nextPageUri.startsWith("http")
    ? nextPageUri
    : `https://api.twilio.com${nextPageUri.startsWith("/") ? "" : "/"}${nextPageUri}`;
}

function resolveTwilioInventoryErrorMessage(status: number) {
  if (status === 401 || status === 403) {
    return "Twilio rejected the connected account credentials.";
  }

  if (status === 429) {
    return "Twilio rate-limited phone number inventory import. Try again shortly.";
  }

  if (status >= 500) {
    return "Twilio phone number inventory is temporarily unavailable.";
  }

  return "Twilio phone number inventory request failed.";
}
