export const TWILIO_NUMBER_ROUTING_PROVIDER = Symbol("TWILIO_NUMBER_ROUTING_PROVIDER");

export interface TwilioIncomingNumberRouteConfiguration {
  sid?: string | undefined;
  phoneNumber?: string | undefined;
  trunkSid?: string | null | undefined;
  voiceApplicationSid?: string | null | undefined;
  voiceMethod?: string | undefined;
  voiceUrl?: string | undefined;
  voiceReceiveMode?: string | undefined;
  statusCallback?: string | null | undefined;
  capabilities?: {
    voice?: boolean | undefined;
    sms?: boolean | undefined;
    mms?: boolean | undefined;
    fax?: boolean | undefined;
  } | undefined;
}

export interface TwilioRecentCallDiagnostic {
  sid?: string | undefined;
  status?: string | undefined;
  direction?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  phoneNumberSid?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  duration?: string | undefined;
}

export interface TwilioCallDiagnosticDetail extends TwilioRecentCallDiagnostic {
  apiVersion?: string | undefined;
  answeredBy?: string | null | undefined;
  callerName?: string | null | undefined;
  dateCreated?: string | undefined;
  dateUpdated?: string | undefined;
  forwardedFrom?: string | null | undefined;
  parentCallSid?: string | null | undefined;
  price?: string | null | undefined;
  priceUnit?: string | undefined;
  queueTime?: string | undefined;
  sipResponseCode?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  subresourceUris?: Record<string, string> | undefined;
}

export interface TwilioMonitorAlertDiagnostic {
  sid?: string | undefined;
  errorCode?: string | undefined;
  alertText?: string | undefined;
  logLevel?: string | undefined;
  moreInfo?: string | undefined;
  requestMethod?: string | undefined;
  requestUrl?: string | undefined;
  resourceSid?: string | undefined;
  serviceSid?: string | null | undefined;
  dateGenerated?: string | undefined;
  dateCreated?: string | undefined;
}

export interface TwilioNumberRoutingProvider {
  configureIncomingPhoneNumberWebhook(input: {
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
    statusCallbackUrl?: string | undefined;
    voiceUrl: string;
  }): Promise<TwilioIncomingNumberRouteConfiguration>;
  inspectIncomingPhoneNumber(input: {
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
  }): Promise<TwilioIncomingNumberRouteConfiguration>;
  listRecentCallsForNumber(input: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    limit?: number | undefined;
  }): Promise<TwilioRecentCallDiagnostic[]>;
  retrieveCall(input: {
    accountSid: string;
    authToken: string;
    callSid: string;
  }): Promise<TwilioCallDiagnosticDetail>;
  terminateCall(input: {
    accountSid: string;
    authToken: string;
    callSid: string;
  }): Promise<TwilioCallDiagnosticDetail>;
  listRecentMonitorAlerts(input: {
    accountSid: string;
    authToken: string;
    startDate?: string | undefined;
    endDate?: string | undefined;
    limit?: number | undefined;
  }): Promise<TwilioMonitorAlertDiagnostic[]>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class TwilioRestNumberRoutingProvider implements TwilioNumberRoutingProvider {
  constructor(private readonly fetchFn: FetchLike = globalThis.fetch.bind(globalThis)) {}

  async configureIncomingPhoneNumberWebhook(input: {
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
    statusCallbackUrl?: string | undefined;
    voiceUrl: string;
  }): Promise<TwilioIncomingNumberRouteConfiguration> {
    const accountSid = input.accountSid.trim();
    const authToken = input.authToken.trim();
    const phoneNumberSid = input.phoneNumberSid.trim();
    const statusCallbackUrl = input.statusCallbackUrl?.trim();
    const voiceUrl = input.voiceUrl.trim();

    if (accountSid.length === 0 || authToken.length === 0 || phoneNumberSid.length === 0 || voiceUrl.length === 0) {
      throw new Error("Twilio number webhook configuration requires connected account credentials and an imported number SID.");
    }

    const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
    const body = new URLSearchParams({
      TrunkSid: "",
      VoiceApplicationSid: "",
      VoiceMethod: "POST",
      VoiceUrl: voiceUrl,
    });
    if (statusCallbackUrl !== undefined && statusCallbackUrl.length > 0) {
      body.set("StatusCallback", statusCallbackUrl);
      body.set("StatusCallbackMethod", "POST");
    }

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

    const payload = await readTwilioRoutingPayload(response);
    if (hasActiveVoiceApplicationOrTrunk(payload)) {
      throw new Error("Twilio still has a Voice Application or SIP Trunk attached to this number, so incoming calls would ignore Zara's Voice URL.");
    }

    const configuration = mapIncomingNumberRouteConfiguration(payload);
    if (
      configuration.voiceUrl !== undefined &&
      configuration.voiceUrl.trim().length > 0 &&
      configuration.voiceUrl.trim() !== voiceUrl
    ) {
      throw new Error("Twilio did not persist Zara's Voice URL for this number.");
    }

    if (
      configuration.voiceMethod !== undefined &&
      configuration.voiceMethod.trim().length > 0 &&
      configuration.voiceMethod.trim().toUpperCase() !== "POST"
    ) {
      throw new Error("Twilio did not persist Zara's Voice webhook method for this number.");
    }

    return configuration;
  }

  async inspectIncomingPhoneNumber(input: {
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
  }): Promise<TwilioIncomingNumberRouteConfiguration> {
    const accountSid = input.accountSid.trim();
    const authToken = input.authToken.trim();
    const phoneNumberSid = input.phoneNumberSid.trim();

    if (accountSid.length === 0 || authToken.length === 0 || phoneNumberSid.length === 0) {
      throw new Error("Twilio number webhook configuration requires connected account credentials and an imported number SID.");
    }

    let response: Response;
    try {
      response = await this.fetchFn(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberSid)}.json`,
        {
          headers: createTwilioRestHeaders(accountSid, authToken),
          method: "GET",
        },
      );
    } catch {
      throw new Error("Could not reach Twilio phone number routing.");
    }

    if (!response.ok) {
      throw new Error(resolveTwilioRoutingErrorMessage(response.status));
    }

    return mapIncomingNumberRouteConfiguration(await readTwilioRoutingPayload(response));
  }

  async listRecentCallsForNumber(input: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    limit?: number | undefined;
  }): Promise<TwilioRecentCallDiagnostic[]> {
    const accountSid = input.accountSid.trim();
    const authToken = input.authToken.trim();
    const phoneNumber = input.phoneNumber.trim();

    if (accountSid.length === 0 || authToken.length === 0 || phoneNumber.length === 0) {
      throw new Error("Twilio recent call diagnostics require connected account credentials and a phone number.");
    }

    const pageSize = Math.min(Math.max(Math.trunc(input.limit ?? 5), 1), 20);
    const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`);
    url.searchParams.set("To", phoneNumber);
    url.searchParams.set("PageSize", String(pageSize));

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        headers: createTwilioRestHeaders(accountSid, authToken),
        method: "GET",
      });
    } catch {
      throw new Error("Could not reach Twilio phone number routing.");
    }

    if (!response.ok) {
      throw new Error(resolveTwilioRoutingErrorMessage(response.status));
    }

    return readTwilioRecentCalls(await readTwilioRoutingPayload(response));
  }

  async retrieveCall(input: {
    accountSid: string;
    authToken: string;
    callSid: string;
  }): Promise<TwilioCallDiagnosticDetail> {
    const accountSid = input.accountSid.trim();
    const authToken = input.authToken.trim();
    const callSid = input.callSid.trim();

    if (accountSid.length === 0 || authToken.length === 0 || callSid.length === 0) {
      throw new Error("Twilio call diagnostics require connected account credentials and a Call SID.");
    }

    let response: Response;
    try {
      response = await this.fetchFn(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`,
        {
          headers: createTwilioRestHeaders(accountSid, authToken),
          method: "GET",
        },
      );
    } catch {
      throw new Error("Could not reach Twilio call diagnostics.");
    }

    if (!response.ok) {
      throw new Error(resolveTwilioDiagnosticsErrorMessage(response.status));
    }

    return mapTwilioCallDiagnosticDetail(await readTwilioRoutingPayload(response));
  }

  async terminateCall(input: {
    accountSid: string;
    authToken: string;
    callSid: string;
  }): Promise<TwilioCallDiagnosticDetail> {
    const accountSid = input.accountSid.trim();
    const authToken = input.authToken.trim();
    const callSid = input.callSid.trim();

    if (accountSid.length === 0 || authToken.length === 0 || callSid.length === 0) {
      throw new Error("Twilio call control requires connected account credentials and a Call SID.");
    }

    let response: Response;
    try {
      response = await this.fetchFn(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`,
        {
          body: new URLSearchParams({ Status: "completed" }),
          headers: {
            ...createTwilioRestHeaders(accountSid, authToken),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
      );
    } catch {
      throw new Error("Could not reach Twilio call control.");
    }

    if (!response.ok) {
      throw new Error(resolveTwilioDiagnosticsErrorMessage(response.status));
    }

    return mapTwilioCallDiagnosticDetail(await readTwilioRoutingPayload(response));
  }

  async listRecentMonitorAlerts(input: {
    accountSid: string;
    authToken: string;
    startDate?: string | undefined;
    endDate?: string | undefined;
    limit?: number | undefined;
  }): Promise<TwilioMonitorAlertDiagnostic[]> {
    const accountSid = input.accountSid.trim();
    const authToken = input.authToken.trim();

    if (accountSid.length === 0 || authToken.length === 0) {
      throw new Error("Twilio Monitor diagnostics require connected account credentials.");
    }

    const pageSize = Math.min(Math.max(Math.trunc(input.limit ?? 10), 1), 1000);
    const url = new URL("https://monitor.twilio.com/v1/Alerts");
    url.searchParams.set("LogLevel", "error");

    const startDate = input.startDate?.trim();
    if (startDate !== undefined && startDate.length > 0) {
      url.searchParams.set("StartDate", startDate);
    }

    const endDate = input.endDate?.trim();
    if (endDate !== undefined && endDate.length > 0) {
      url.searchParams.set("EndDate", endDate);
    }

    url.searchParams.set("PageSize", String(pageSize));

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        headers: createTwilioRestHeaders(accountSid, authToken),
        method: "GET",
      });
    } catch {
      throw new Error("Could not reach Twilio Monitor diagnostics.");
    }

    if (!response.ok) {
      throw new Error(resolveTwilioDiagnosticsErrorMessage(response.status));
    }

    return readTwilioMonitorAlerts(await readTwilioRoutingPayload(response));
  }
}

function createTwilioRestHeaders(accountSid: string, authToken: string) {
  return {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
  };
}

async function readTwilioRoutingPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function hasActiveVoiceApplicationOrTrunk(payload: unknown) {
  return hasNonEmptyString(payload, "voice_application_sid") ||
    hasNonEmptyString(payload, "VoiceApplicationSid") ||
    hasNonEmptyString(payload, "trunk_sid") ||
    hasNonEmptyString(payload, "TrunkSid");
}

function hasNonEmptyString(payload: unknown, property: string) {
  if (payload === null || typeof payload !== "object") {
    return false;
  }

  const value = (payload as Record<string, unknown>)[property];

  return typeof value === "string" && value.trim().length > 0;
}

function mapIncomingNumberRouteConfiguration(payload: unknown): TwilioIncomingNumberRouteConfiguration {
  return {
    sid: readOptionalString(payload, "sid"),
    phoneNumber: readOptionalString(payload, "phone_number"),
    trunkSid: readNullableString(payload, "trunk_sid"),
    voiceApplicationSid: readNullableString(payload, "voice_application_sid"),
    voiceMethod: readOptionalString(payload, "voice_method"),
    voiceUrl: readOptionalString(payload, "voice_url"),
    voiceReceiveMode: readOptionalString(payload, "voice_receive_mode"),
    statusCallback: readNullableString(payload, "status_callback"),
    capabilities: readCapabilities(payload),
  };
}

function mapTwilioCallDiagnosticDetail(payload: unknown): TwilioCallDiagnosticDetail {
  return {
    sid: readOptionalString(payload, "sid"),
    status: readOptionalString(payload, "status"),
    direction: readOptionalString(payload, "direction"),
    from: readOptionalString(payload, "from"),
    to: readOptionalString(payload, "to"),
    phoneNumberSid: readOptionalString(payload, "phone_number_sid"),
    startTime: readOptionalString(payload, "start_time"),
    endTime: readOptionalString(payload, "end_time"),
    duration: readOptionalString(payload, "duration"),
    apiVersion: readOptionalString(payload, "api_version"),
    answeredBy: readNullableString(payload, "answered_by"),
    callerName: readNullableString(payload, "caller_name"),
    dateCreated: readOptionalString(payload, "date_created"),
    dateUpdated: readOptionalString(payload, "date_updated"),
    forwardedFrom: readNullableString(payload, "forwarded_from"),
    parentCallSid: readNullableString(payload, "parent_call_sid"),
    price: readNullableString(payload, "price"),
    priceUnit: readOptionalString(payload, "price_unit"),
    queueTime: readOptionalString(payload, "queue_time"),
    sipResponseCode: readOptionalString(payload, "sip_response_code"),
    errorCode: readOptionalString(payload, "error_code"),
    errorMessage: readOptionalString(payload, "error_message"),
    subresourceUris: readOptionalStringRecord(payload, "subresource_uris"),
  };
}

function readTwilioRecentCalls(payload: unknown): TwilioRecentCallDiagnostic[] {
  if (payload === null || typeof payload !== "object") {
    return [];
  }

  const calls = (payload as Record<string, unknown>).calls;
  if (!Array.isArray(calls)) {
    return [];
  }

  return calls
    .filter((call): call is Record<string, unknown> => call !== null && typeof call === "object")
    .map((call) => ({
      sid: readOptionalString(call, "sid"),
      status: readOptionalString(call, "status"),
      direction: readOptionalString(call, "direction"),
      from: readOptionalString(call, "from"),
      to: readOptionalString(call, "to"),
      phoneNumberSid: readOptionalString(call, "phone_number_sid"),
      startTime: readOptionalString(call, "start_time"),
      endTime: readOptionalString(call, "end_time"),
      duration: readOptionalString(call, "duration"),
    }));
}

function readTwilioMonitorAlerts(payload: unknown): TwilioMonitorAlertDiagnostic[] {
  if (payload === null || typeof payload !== "object") {
    return [];
  }

  const alerts = (payload as Record<string, unknown>).alerts;
  if (!Array.isArray(alerts)) {
    return [];
  }

  return alerts
    .filter((alert): alert is Record<string, unknown> => alert !== null && typeof alert === "object")
    .map((alert) => ({
      sid: readOptionalString(alert, "sid"),
      errorCode: readOptionalString(alert, "error_code"),
      alertText: readOptionalString(alert, "alert_text"),
      logLevel: readOptionalString(alert, "log_level"),
      moreInfo: readOptionalString(alert, "more_info"),
      requestMethod: readOptionalString(alert, "request_method"),
      requestUrl: readOptionalString(alert, "request_url"),
      resourceSid: readOptionalString(alert, "resource_sid"),
      serviceSid: readNullableString(alert, "service_sid"),
      dateGenerated: readOptionalString(alert, "date_generated"),
      dateCreated: readOptionalString(alert, "date_created"),
    }));
}

function readOptionalString(payload: unknown, property: string) {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[property];
  return typeof value === "string" ? value : undefined;
}

function readOptionalStringRecord(payload: unknown, property: string) {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[property];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function readNullableString(payload: unknown, property: string) {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[property];
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : undefined;
}

function readCapabilities(payload: unknown): TwilioIncomingNumberRouteConfiguration["capabilities"] {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  const capabilities = (payload as Record<string, unknown>).capabilities;
  if (capabilities === null || typeof capabilities !== "object") {
    return undefined;
  }

  return {
    voice: readOptionalBoolean(capabilities, "voice"),
    sms: readOptionalBoolean(capabilities, "sms"),
    mms: readOptionalBoolean(capabilities, "mms"),
    fax: readOptionalBoolean(capabilities, "fax"),
  };
}

function readOptionalBoolean(payload: unknown, property: string) {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[property];
  return typeof value === "boolean" ? value : undefined;
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

function resolveTwilioDiagnosticsErrorMessage(status: number) {
  if (status === 401 || status === 403) {
    return "Twilio rejected the connected account credentials while reading provider diagnostics.";
  }

  if (status === 429) {
    return "Twilio rate-limited provider diagnostics. Try again shortly.";
  }

  if (status >= 500) {
    return "Twilio provider diagnostics are temporarily unavailable.";
  }

  return "Twilio provider diagnostics request failed.";
}
