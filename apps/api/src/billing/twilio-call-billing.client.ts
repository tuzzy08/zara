import type {
  TwilioBillingCallClient,
  TwilioBillingCallRecord,
} from "./twilio-billing-evidence.source";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class TwilioRestCallBillingClient implements TwilioBillingCallClient {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async listCalls(input: {
    accountSid: string;
    authToken: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
    direction: "inbound" | "outbound";
    phoneNumber: string;
  }): Promise<TwilioBillingCallRecord[]> {
    const url = new URL(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Calls.json`,
    );
    url.searchParams.set("StartTimeAfter", dateOnly(input.cycleStartsAt));
    url.searchParams.set("StartTimeBefore", utcDateAfter(input.cycleEndsAt));
    url.searchParams.set(input.direction === "inbound" ? "To" : "From", input.phoneNumber);
    url.searchParams.set("PageSize", "1000");
    const authorization = `Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64")}`;
    const calls: TwilioBillingCallRecord[] = [];
    let nextUrl: string | null = url.toString();
    while (nextUrl !== null) {
      const response = await this.fetchFn(nextUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authorization,
        },
      });
      if (!response.ok) {
        throw new Error(`Twilio billing evidence request failed with status ${response.status}.`);
      }
      const payload = await response.json() as Record<string, unknown>;
      if (!Array.isArray(payload.calls)) throw new Error("Twilio billing evidence response is invalid.");
      calls.push(...payload.calls.map(mapCall));
      nextUrl = resolveNextPage(payload.next_page_uri);
    }
    return calls;
  }
}

function dateOnly(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Twilio billing evidence cycle time is invalid.");
  return new Date(parsed).toISOString().slice(0, 10);
}

function utcDateAfter(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Twilio billing evidence cycle time is invalid.");
  const date = new Date(parsed);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function mapCall(value: unknown): TwilioBillingCallRecord {
  const payload = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
      sid: text(payload.sid),
      accountSid: text(payload.account_sid),
      status: text(payload.status),
      direction: text(payload.direction),
      ...(payload.duration === null || payload.duration === undefined
        ? {} : { durationSeconds: Number(payload.duration) }),
      ...(payload.price === undefined ? {} : { price: payload.price === null ? null : String(payload.price) }),
      ...(payload.price_unit === undefined
        ? {} : { priceUnit: payload.price_unit === null ? null : String(payload.price_unit) }),
      ...(payload.start_time === undefined
        ? {} : { startedAt: providerTimestamp(payload.start_time) }),
      ...(payload.end_time === undefined
        ? {} : { endedAt: providerTimestamp(payload.end_time) }),
  };
}

function resolveNextPage(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Twilio billing evidence page link is invalid.");
  const url = new URL(value, "https://api.twilio.com");
  if (url.protocol !== "https:" || url.hostname !== "api.twilio.com"
    || !url.pathname.startsWith("/2010-04-01/Accounts/")) {
    throw new Error("Twilio billing evidence page link is invalid.");
  }
  return url.toString();
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function providerTimestamp(value: unknown) {
  if (value === null) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value);
}
