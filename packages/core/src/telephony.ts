import type { ID, TelephonyProvider } from "./index";

export const telephonyConnectionOwnershipModes = [
  "platform_managed",
  "byo_sip_trunk",
  "byo_provider_account",
] as const;
export type TelephonyConnectionOwnershipMode =
  (typeof telephonyConnectionOwnershipModes)[number];

export const telephonyConnectionStatuses = [
  "draft",
  "active",
  "degraded",
  "disabled",
] as const;
export type TelephonyConnectionStatus = (typeof telephonyConnectionStatuses)[number];

export const telephonyHealthStatuses = [
  "unknown",
  "healthy",
  "warning",
  "failed",
] as const;
export type TelephonyHealthStatus = (typeof telephonyHealthStatuses)[number];

export const telephonyRecordingConsentModes = [
  "disabled",
  "single-party",
  "two-party",
] as const;
export type TelephonyRecordingConsentMode =
  (typeof telephonyRecordingConsentModes)[number];

export interface TelephonyRecordingPolicy {
  enabled: boolean;
  consentMode: TelephonyRecordingConsentMode;
  consentMessage: string;
}

export type TelephonyRecordingConsentStateValue =
  | "not_required"
  | "notice_queued"
  | "recording_disabled";

export interface TelephonyRecordingConsentState {
  state: TelephonyRecordingConsentStateValue;
  noticeRequired: boolean;
  consentMode: TelephonyRecordingConsentMode;
  message: string;
  recordedAt: string;
  reason: string;
}

export interface EncryptedCredentialReference {
  id: ID;
  provider: TelephonyProvider;
  keyVersion: number;
  preview: string;
}

export interface SipTrunkMetadata {
  domain: string;
  codecs: string[];
}

export interface TelephonyConnection {
  id: ID;
  tenantId: ID;
  label: string;
  ownershipMode: TelephonyConnectionOwnershipMode;
  provider: TelephonyProvider;
  region: string;
  status: TelephonyConnectionStatus;
  healthStatus: TelephonyHealthStatus;
  recordingPolicy: TelephonyRecordingPolicy;
  blockRoutingOnHealthFailure: boolean;
  credentialReference?: EncryptedCredentialReference | undefined;
  externalReference?: string | undefined;
  sip?: SipTrunkMetadata | undefined;
  webhookBaseUrl?: string | undefined;
  webhookStatus: "missing" | "configured" | "invalid";
  createdBy: ID;
}

export interface AvailableTwilioPhoneNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: {
    voice: boolean;
    sms: boolean;
  };
}

export const telephonyPhoneNumberProvisionSources = [
  "provider-import",
  "platform-pool",
  "manual-did",
] as const;
export type TelephonyPhoneNumberProvisionSource =
  (typeof telephonyPhoneNumberProvisionSources)[number];

export interface ImportedTelephonyPhoneNumber {
  id: ID;
  tenantId: ID;
  connectionId: ID;
  provider: TelephonyProvider;
  provisionSource: TelephonyPhoneNumberProvisionSource;
  externalNumberId: string;
  phoneNumber: string;
  friendlyName: string;
  voiceCapable: boolean;
  callerIdEligible: boolean;
  status: "imported" | "routed" | "disabled";
  webhookStatus: "pending" | "configured" | "invalid";
  publishedVersionId?: ID | undefined;
  workflowLabel?: string | undefined;
  workspaceId?: ID | undefined;
  recordingPolicy?: TelephonyRecordingPolicy | undefined;
}

export interface InboundCallResolution {
  disposition: "routed" | "fallback" | "blocked";
  reason: string;
  callSessionId?: ID | undefined;
  phoneNumberId?: ID | undefined;
  fallbackPhoneNumberId?: ID | undefined;
  connectionId?: ID | undefined;
  publishedVersionId?: ID | undefined;
  workspaceId?: ID | undefined;
  outageMode?: "provider-fallback" | undefined;
  recording: TelephonyRecordingPolicy;
  recordingConsent: TelephonyRecordingConsentState;
}

export interface OutboundCallPolicyCheck {
  status: "passed" | "blocked";
  detail: string;
}

export interface OutboundCallPolicyChecks {
  dnc: OutboundCallPolicyCheck;
  timezone: OutboundCallPolicyCheck;
  consent: OutboundCallPolicyCheck;
  budget: OutboundCallPolicyCheck;
  callingWindow: OutboundCallPolicyCheck;
  callerId: OutboundCallPolicyCheck;
  abuse: OutboundCallPolicyCheck;
}

export interface OutboundCallResolution {
  disposition: "queued" | "blocked";
  reason: string;
  callSessionId?: ID | undefined;
  phoneNumberId?: ID | undefined;
  connectionId?: ID | undefined;
  publishedVersionId: ID;
  workspaceId: ID;
  workflowLabel: string;
  recording: TelephonyRecordingPolicy;
  recordingConsent: TelephonyRecordingConsentState;
  policyChecks: OutboundCallPolicyChecks;
}

export const telephonyCallControlEventTypes = [
  "dtmf.received",
  "voicemail.detected",
  "transfer.requested",
  "transfer.failed",
  "failover.triggered",
  "callback.scheduled",
] as const;
export type TelephonyCallControlEventType =
  (typeof telephonyCallControlEventTypes)[number];

export interface TelephonyCallControlEvent {
  id: ID;
  tenantId: ID;
  dispatchId: ID;
  callSessionId: ID;
  eventType: TelephonyCallControlEventType;
  at: string;
  summary: string;
  fallbackTarget?: string | undefined;
  payload: Record<string, string>;
}

export const telephonyExecutionSessionStatuses = [
  "ringing",
  "active",
  "transfer-pending",
  "failover-active",
  "voicemail",
  "completed",
  "blocked",
] as const;
export type TelephonyExecutionSessionStatus =
  (typeof telephonyExecutionSessionStatuses)[number];

export const telephonyExecutionBridgeKinds = [
  "platform-edge",
  "twilio-programmable-voice",
  "sip-trunk",
] as const;
export type TelephonyExecutionBridgeKind =
  (typeof telephonyExecutionBridgeKinds)[number];

export const telephonyExecutionCommandStatuses = ["queued", "applied"] as const;
export type TelephonyExecutionCommandStatus =
  (typeof telephonyExecutionCommandStatuses)[number];

export interface TelephonyExecutionSession {
  id: ID;
  tenantId: ID;
  dispatchId: ID;
  callSessionId: ID;
  connectionId: ID;
  provider: TelephonyProvider;
  ownershipMode: TelephonyConnectionOwnershipMode;
  direction: "inbound" | "outbound";
  status: TelephonyExecutionSessionStatus;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  workflowLabel?: string | undefined;
  workspaceId?: ID | undefined;
  testCall: boolean;
  bridgeKind: TelephonyExecutionBridgeKind;
  bridgeTarget: string;
  mediaPath: "provider-native";
  outageMode?: "provider-fallback" | undefined;
  fallbackTarget?: string | undefined;
  recordingConsent?: TelephonyRecordingConsentState | undefined;
  diagnostics: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TelephonyExecutionCommand {
  id: ID;
  tenantId: ID;
  sessionId: ID;
  dispatchId: ID;
  callSessionId: ID;
  provider: TelephonyProvider;
  action: string;
  status: TelephonyExecutionCommandStatus;
  target: string;
  payload: Record<string, string>;
  requestedAt: string;
  appliedAt?: string | undefined;
}

export interface TelephonyProviderHeartbeat {
  id: ID;
  tenantId: ID;
  connectionId: ID;
  provider: TelephonyProvider;
  ownershipMode: TelephonyConnectionOwnershipMode;
  status: TelephonyHealthStatus;
  blocking: boolean;
  scheduled: boolean;
  latencyMs: number;
  routedNumberCount: number;
  at: string;
  message: string;
  diagnostics: string[];
}

export function defaultRecordingPolicy(
  overrides?: Partial<TelephonyRecordingPolicy>,
): TelephonyRecordingPolicy {
  return {
    enabled: true,
    consentMode: "single-party",
    consentMessage: "This call may be recorded for quality assurance.",
    ...overrides,
  };
}

export function createTelephonyConnection(input: {
  id: ID;
  tenantId: ID;
  label: string;
  ownershipMode: TelephonyConnectionOwnershipMode;
  provider: TelephonyProvider;
  region: string;
  createdBy: ID;
  recordingPolicy: TelephonyRecordingPolicy;
  blockRoutingOnHealthFailure: boolean;
  credentials?:
    | {
        username?: string | undefined;
        accountSid?: string | undefined;
        secret: string;
      }
    | undefined;
  credentialKeyVersion?: number | undefined;
  sip?: SipTrunkMetadata | undefined;
  webhookBaseUrl?: string | undefined;
}): TelephonyConnection {
  validateOwnershipProvider(input.ownershipMode, input.provider);

  if (input.ownershipMode === "byo_sip_trunk" && input.sip === undefined) {
    throw new Error("BYO SIP connections require SIP trunk metadata.");
  }

  if (
    input.ownershipMode !== "platform_managed" &&
    (input.credentials?.secret.trim().length ?? 0) === 0
  ) {
    throw new Error("Bring-your-own telephony connections require a secret.");
  }

  const credentialReference =
    input.ownershipMode === "platform_managed" || input.credentials === undefined
      ? undefined
        : createCredentialReference({
          connectionId: input.id,
          provider: input.provider,
          secret: input.credentials.secret,
          keyVersion: input.credentialKeyVersion ?? 1,
        });

  return {
    id: input.id,
    tenantId: input.tenantId,
    label: input.label,
    ownershipMode: input.ownershipMode,
    provider: input.provider,
    region: input.region,
    status: "active",
    healthStatus: "unknown",
    recordingPolicy: cloneRecordingPolicy(input.recordingPolicy),
    blockRoutingOnHealthFailure: input.blockRoutingOnHealthFailure,
    ...(credentialReference === undefined ? {} : { credentialReference }),
    ...(input.ownershipMode === "byo_provider_account" && input.credentials?.accountSid !== undefined
      ? { externalReference: input.credentials.accountSid }
      : {}),
    ...(input.sip === undefined ? {} : { sip: cloneSipMetadata(input.sip) }),
    ...(input.webhookBaseUrl === undefined ? {} : { webhookBaseUrl: input.webhookBaseUrl }),
    webhookStatus:
      input.ownershipMode === "byo_provider_account" && input.webhookBaseUrl !== undefined
        ? "configured"
        : "missing",
    createdBy: input.createdBy,
  };
}

export function importTwilioPhoneNumbers(input: {
  tenantId: ID;
  connectionId: ID;
  existingNumbers: ImportedTelephonyPhoneNumber[];
  availableNumbers: AvailableTwilioPhoneNumber[];
}): ImportedTelephonyPhoneNumber[] {
  const existingByPhoneNumber = new Map(
    input.existingNumbers.map((number) => [normalizePhoneNumber(number.phoneNumber), number] as const),
  );

  const imported: ImportedTelephonyPhoneNumber[] = [];

  for (const number of input.availableNumbers) {
    if (number.capabilities.voice === false) {
      continue;
    }

    const normalizedPhoneNumber = normalizePhoneNumber(number.phoneNumber);
    if (existingByPhoneNumber.has(normalizedPhoneNumber)) {
      continue;
    }

    imported.push(
      createImportedPhoneNumber({
        id: `phone-number-${number.sid.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        provider: "twilio",
        provisionSource: "provider-import",
        externalNumberId: number.sid,
        phoneNumber: normalizedPhoneNumber,
        friendlyName: number.friendlyName,
        voiceCapable: true,
        callerIdEligible: true,
        status: "imported",
        webhookStatus: "pending",
      }),
    );
  }

  return imported;
}

export function provisionTelephonyPhoneNumber(input: {
  tenantId: ID;
  connection: TelephonyConnection;
  existingNumbers: ImportedTelephonyPhoneNumber[];
  phoneNumber: string;
  friendlyName: string;
  externalNumberId?: string | undefined;
}) {
  const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber);
  const duplicate = input.existingNumbers.find(
    (candidate) => normalizePhoneNumber(candidate.phoneNumber) === normalizedPhoneNumber,
  );

  if (duplicate !== undefined) {
    throw new Error(`Phone number '${normalizedPhoneNumber}' already exists in telephony inventory.`);
  }

  const digits = normalizedPhoneNumber.replace(/\D+/g, "");

  return createImportedPhoneNumber({
    id: `phone-number-${digits}`,
    tenantId: input.tenantId,
    connectionId: input.connection.id,
    provider: input.connection.provider,
    provisionSource: resolveProvisionSource(input.connection),
    externalNumberId: input.externalNumberId ?? `${input.connection.id}:${digits}`,
    phoneNumber: normalizedPhoneNumber,
    friendlyName: input.friendlyName,
    voiceCapable: true,
    callerIdEligible: true,
    status: "imported",
    webhookStatus:
      input.connection.ownershipMode === "byo_provider_account" ? "pending" : "configured",
  });
}

export function assignTelephonyNumberRoute(input: {
  phoneNumbers: ImportedTelephonyPhoneNumber[];
  numberId: ID;
  publishedVersionId: ID;
  workflowLabel: string;
  workspaceId: ID;
  recordingPolicy?: TelephonyRecordingPolicy | undefined;
}): ImportedTelephonyPhoneNumber[] {
  return input.phoneNumbers.map((number) =>
    number.id === input.numberId
      ? {
          ...number,
          status: "routed",
          webhookStatus: "configured",
          publishedVersionId: input.publishedVersionId,
          workflowLabel: input.workflowLabel,
          workspaceId: input.workspaceId,
          ...(input.recordingPolicy === undefined
            ? {}
            : { recordingPolicy: cloneRecordingPolicy(input.recordingPolicy) }),
        }
      : { ...number },
  );
}

export function resolveInboundCall(input: {
  toPhoneNumber: string;
  fromPhoneNumber: string;
  callSid: ID;
  phoneNumbers: ImportedTelephonyPhoneNumber[];
  connections: TelephonyConnection[];
  now: string;
}): InboundCallResolution {
  const normalizedDestination = normalizePhoneNumber(input.toPhoneNumber);
  const routedNumber = input.phoneNumbers.find(
    (number) => normalizePhoneNumber(number.phoneNumber) === normalizedDestination,
  );

  if (routedNumber === undefined || routedNumber.publishedVersionId === undefined) {
    return {
      disposition: "fallback",
      reason: "No published workflow route is assigned to this number.",
      recording: defaultRecordingPolicy({
        enabled: false,
        consentMode: "disabled",
        consentMessage: "Recording disabled while Zara falls back safely.",
      }),
      recordingConsent: resolveRecordingConsentState(
        defaultRecordingPolicy({
          enabled: false,
          consentMode: "disabled",
          consentMessage: "Recording disabled while Zara falls back safely.",
        }),
        input.now,
      ),
    };
  }

  const connection = input.connections.find(
    (candidate) => candidate.id === routedNumber.connectionId && candidate.tenantId === routedNumber.tenantId,
  );

  if (connection === undefined) {
    return {
      disposition: "blocked",
      reason: "The telephony connection for this number no longer exists.",
      recording: cloneRecordingPolicy(routedNumber.recordingPolicy ?? defaultRecordingPolicy()),
      recordingConsent: resolveRecordingConsentState(
        routedNumber.recordingPolicy ?? defaultRecordingPolicy(),
        input.now,
      ),
    };
  }

  if (
    connection.blockRoutingOnHealthFailure &&
    (connection.status === "disabled" || connection.healthStatus === "failed")
  ) {
    const fallbackRoute = findFallbackRoute({
      routedNumber,
      phoneNumbers: input.phoneNumbers,
      connections: input.connections,
    });

    if (fallbackRoute !== undefined) {
      const recording = cloneRecordingPolicy(
        fallbackRoute.phoneNumber.recordingPolicy ?? fallbackRoute.connection.recordingPolicy,
      );

      return {
        disposition: "fallback",
        reason: `Inbound call failed over from ${routedNumber.friendlyName} to ${fallbackRoute.phoneNumber.friendlyName} because the primary provider is unavailable.`,
        callSessionId: `${input.callSid}:telephony`,
        phoneNumberId: routedNumber.id,
        fallbackPhoneNumberId: fallbackRoute.phoneNumber.id,
        connectionId: fallbackRoute.connection.id,
        publishedVersionId: fallbackRoute.phoneNumber.publishedVersionId,
        workspaceId: fallbackRoute.phoneNumber.workspaceId,
        outageMode: "provider-fallback",
        recording,
        recordingConsent: resolveRecordingConsentState(recording, input.now),
      };
    }

    const recording = cloneRecordingPolicy(routedNumber.recordingPolicy ?? connection.recordingPolicy);

    return {
      disposition: "blocked",
      reason: "Inbound routing is blocked because provider health checks are failing.",
      phoneNumberId: routedNumber.id,
      connectionId: connection.id,
      recording,
      recordingConsent: resolveRecordingConsentState(recording, input.now),
    };
  }

  const recording = cloneRecordingPolicy(routedNumber.recordingPolicy ?? connection.recordingPolicy);

  return {
    disposition: "routed",
    reason: `Routed ${normalizedDestination} to ${routedNumber.workflowLabel ?? routedNumber.publishedVersionId}.`,
    callSessionId: `${input.callSid}:telephony`,
    phoneNumberId: routedNumber.id,
    connectionId: connection.id,
    publishedVersionId: routedNumber.publishedVersionId,
    workspaceId: routedNumber.workspaceId,
    recording,
    recordingConsent: resolveRecordingConsentState(recording, input.now),
  };
}

export function resolveOutboundCall(input: {
  toPhoneNumber: string;
  fromPhoneNumber: string;
  callSid: ID;
  phoneNumbers: ImportedTelephonyPhoneNumber[];
  connections: TelephonyConnection[];
  publishedVersionId: ID;
  workflowLabel: string;
  workspaceId: ID;
  consentGranted: boolean;
  budgetRemainingUsd: number;
  estimatedCostUsd: number;
  localHour: number;
  callingWindow: { startHour: number; endHour: number };
  abuseAllowed?: boolean | undefined;
  abuseBlockedReason?: string | undefined;
  dncAllowed?: boolean | undefined;
  dncBlockedReason?: string | undefined;
  timezoneAllowed?: boolean | undefined;
  timezoneDetail?: string | undefined;
  timezoneBlockedReason?: string | undefined;
  callingWindowOverrideAllowed?: boolean | undefined;
}): OutboundCallResolution {
  const normalizedCallerId = normalizePhoneNumber(input.fromPhoneNumber);
  const routedNumber = input.phoneNumbers.find(
    (number) =>
      normalizePhoneNumber(number.phoneNumber) === normalizedCallerId &&
      number.callerIdEligible &&
      number.status === "routed",
  );

  const policyChecks: OutboundCallPolicyChecks = {
    dnc: buildPolicyCheck(
      input.dncAllowed ?? true,
      "Destination is not on the tenant do-not-call list.",
      input.dncBlockedReason ?? "Outbound call blocked by tenant do-not-call policy.",
    ),
    timezone: buildPolicyCheck(
      input.timezoneAllowed ?? true,
      input.timezoneDetail ?? "Destination timezone is known for safe calling.",
      input.timezoneBlockedReason ?? "Destination timezone is required before outbound calling.",
    ),
    consent: buildPolicyCheck(
      input.consentGranted,
      "Customer consent confirmed.",
      "Outbound calling requires customer consent before the session can start.",
    ),
    budget: buildPolicyCheck(
      input.budgetRemainingUsd >= input.estimatedCostUsd,
      `Budget check passed with $${input.budgetRemainingUsd.toFixed(2)} remaining.`,
      `Estimated spend of $${input.estimatedCostUsd.toFixed(2)} exceeds the remaining budget.`,
    ),
    callingWindow: buildPolicyCheck(
      (input.callingWindowOverrideAllowed ?? false) ||
        isWithinCallingWindow(input.localHour, input.callingWindow),
      `Local time ${input.localHour}:00 is inside the permitted calling window.`,
      input.callingWindowOverrideAllowed === true
        ? `Local time ${input.localHour}:00 is outside the permitted calling window but an audited override is present.`
        : `Local time ${input.localHour}:00 is outside the permitted calling window.`,
    ),
    callerId: buildPolicyCheck(
      routedNumber !== undefined,
      `Caller ID ${normalizedCallerId} is a routed Zara number.`,
      "Caller ID must match a routed Zara or tenant-owned number before outbound dispatch.",
    ),
    abuse: buildPolicyCheck(
      input.abuseAllowed ?? true,
      "Outbound abuse policy passed.",
      input.abuseBlockedReason ?? "Outbound abuse policy blocked this call.",
    ),
  };

  const blockedPolicy = Object.values(policyChecks).find((policy) => policy.status === "blocked");
  if (blockedPolicy !== undefined || routedNumber === undefined) {
    return {
      disposition: "blocked",
      reason: blockedPolicy?.detail ?? "Outbound dispatch policy failed.",
      publishedVersionId: input.publishedVersionId,
      workspaceId: input.workspaceId,
      workflowLabel: input.workflowLabel,
      recording: defaultRecordingPolicy({
        enabled: false,
        consentMode: "disabled",
        consentMessage: "Outbound recording is disabled while policy checks fail.",
      }),
      recordingConsent: resolveRecordingConsentState(
        defaultRecordingPolicy({
          enabled: false,
          consentMode: "disabled",
          consentMessage: "Outbound recording is disabled while policy checks fail.",
        }),
        new Date().toISOString(),
      ),
      policyChecks,
    };
  }

  const connection = input.connections.find(
    (candidate) =>
      candidate.id === routedNumber.connectionId && candidate.tenantId === routedNumber.tenantId,
  );

  if (connection === undefined) {
    return {
      disposition: "blocked",
      reason: "The telephony connection for this caller ID no longer exists.",
      phoneNumberId: routedNumber.id,
      publishedVersionId: input.publishedVersionId,
      workspaceId: input.workspaceId,
      workflowLabel: input.workflowLabel,
      recording: cloneRecordingPolicy(routedNumber.recordingPolicy ?? defaultRecordingPolicy()),
      recordingConsent: resolveRecordingConsentState(
        routedNumber.recordingPolicy ?? defaultRecordingPolicy(),
        new Date().toISOString(),
      ),
      policyChecks,
    };
  }

  if (
    connection.blockRoutingOnHealthFailure &&
    (connection.status === "disabled" || connection.healthStatus === "failed")
  ) {
    return {
      disposition: "blocked",
      reason: "Outbound routing is blocked because provider health checks are failing.",
      phoneNumberId: routedNumber.id,
      connectionId: connection.id,
      publishedVersionId: input.publishedVersionId,
      workspaceId: input.workspaceId,
      workflowLabel: input.workflowLabel,
      recording: cloneRecordingPolicy(routedNumber.recordingPolicy ?? connection.recordingPolicy),
      recordingConsent: resolveRecordingConsentState(
        routedNumber.recordingPolicy ?? connection.recordingPolicy,
        new Date().toISOString(),
      ),
      policyChecks,
    };
  }

  const recording = cloneRecordingPolicy(routedNumber.recordingPolicy ?? connection.recordingPolicy);

  return {
    disposition: "queued",
    reason: `Queued outbound call from ${normalizedCallerId} to ${normalizePhoneNumber(input.toPhoneNumber)}.`,
    callSessionId: `${input.callSid}:telephony`,
    phoneNumberId: routedNumber.id,
    connectionId: connection.id,
    publishedVersionId: input.publishedVersionId,
    workspaceId: input.workspaceId,
    workflowLabel: input.workflowLabel,
    recording,
    recordingConsent: resolveRecordingConsentState(recording, new Date().toISOString()),
    policyChecks,
  };
}

export function createTelephonyCallControlEvent(input: {
  tenantId: ID;
  dispatchId: ID;
  callSessionId: ID;
  eventType: TelephonyCallControlEventType;
  digit?: string | undefined;
  transferTarget?: string | undefined;
  fallbackTarget?: string | undefined;
  callbackNumber?: string | undefined;
  actorUserId?: string | undefined;
  callerMessage?: string | undefined;
  at?: string | undefined;
}): TelephonyCallControlEvent {
  const at = input.at ?? new Date().toISOString();
  const payload: Record<string, string> = {};
  let summary = "";

  switch (input.eventType) {
    case "dtmf.received":
      if (input.digit === undefined || /^[0-9*#]$/.test(input.digit) === false) {
        throw new Error("DTMF events require exactly one keypad digit.");
      }
      payload.digit = input.digit;
      summary = `DTMF ${input.digit} captured for live routing.`;
      break;
    case "voicemail.detected":
      if (input.fallbackTarget === undefined || input.fallbackTarget.trim().length === 0) {
        throw new Error("Voicemail detection requires a fallback target.");
      }
      payload.fallbackTarget = input.fallbackTarget;
      summary = `Voicemail detected. Fallback path '${input.fallbackTarget}' activated.`;
      break;
    case "transfer.requested":
      if (input.transferTarget === undefined || input.transferTarget.trim().length === 0) {
        throw new Error("Transfers require a target destination.");
      }
      payload.transferTarget = input.transferTarget;
      summary = input.callerMessage === undefined
        ? `Transfer requested to ${input.transferTarget}.`
        : `Human takeover requested. ${input.callerMessage}`;
      break;
    case "transfer.failed":
      if (input.transferTarget === undefined || input.transferTarget.trim().length === 0) {
        throw new Error("Transfer failures must include the original transfer target.");
      }
      if (input.fallbackTarget === undefined || input.fallbackTarget.trim().length === 0) {
        throw new Error("Transfer failures require an explicit fallback target.");
      }
      payload.transferTarget = input.transferTarget;
      payload.fallbackTarget = input.fallbackTarget;
      summary = `Transfer to ${input.transferTarget} failed. Fallback path '${input.fallbackTarget}' activated.`;
      break;
    case "failover.triggered":
      if (input.fallbackTarget === undefined || input.fallbackTarget.trim().length === 0) {
        throw new Error("Failover events require a configured fallback target.");
      }
      payload.fallbackTarget = input.fallbackTarget;
      summary = `Failover triggered. Route moved to '${input.fallbackTarget}'.`;
      break;
    case "callback.scheduled":
      if (input.callbackNumber === undefined || input.callbackNumber.trim().length === 0) {
        throw new Error("Callback fallback events require a callback number.");
      }
      payload.callbackNumber = input.callbackNumber;
      payload.fallbackTarget = input.fallbackTarget ?? `Callback ${input.callbackNumber}`;
      summary = input.callerMessage === undefined
        ? `Callback scheduled for ${input.callbackNumber}.`
        : `Callback scheduled. ${input.callerMessage}`;
      break;
  }

  if (input.actorUserId !== undefined) {
    payload.actorUserId = input.actorUserId;
  }

  if (input.callerMessage !== undefined) {
    payload.callerMessage = input.callerMessage;
  }

  return {
    id: `${input.callSessionId}:${input.eventType}:${at}`,
    tenantId: input.tenantId,
    dispatchId: input.dispatchId,
    callSessionId: input.callSessionId,
    eventType: input.eventType,
    at,
    summary,
    ...(payload.fallbackTarget === undefined ? {} : { fallbackTarget: payload.fallbackTarget }),
    payload,
  };
}

export function createTelephonyExecutionSession(input: {
  tenantId: ID;
  dispatchId: ID;
  connection: TelephonyConnection;
  direction: "inbound" | "outbound";
  disposition: InboundCallResolution["disposition"] | OutboundCallResolution["disposition"];
  toPhoneNumber: string;
  fromPhoneNumber: string;
  callSessionId: ID;
  workflowLabel?: string | undefined;
  workspaceId?: ID | undefined;
  testCall: boolean;
  outageMode?: "provider-fallback" | undefined;
  recordingConsent?: TelephonyRecordingConsentState | undefined;
  now: string;
}): TelephonyExecutionSession {
  return {
    id: `${input.callSessionId}:execution`,
    tenantId: input.tenantId,
    dispatchId: input.dispatchId,
    callSessionId: input.callSessionId,
    connectionId: input.connection.id,
    provider: input.connection.provider,
    ownershipMode: input.connection.ownershipMode,
    direction: input.direction,
    status: input.disposition === "blocked" ? "blocked" : "ringing",
    toPhoneNumber: normalizePhoneNumber(input.toPhoneNumber),
    fromPhoneNumber: normalizePhoneNumber(input.fromPhoneNumber),
    ...(input.workflowLabel === undefined ? {} : { workflowLabel: input.workflowLabel }),
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    testCall: input.testCall,
    bridgeKind: resolveBridgeKind(input.connection),
    bridgeTarget: resolveBridgeTarget(input.connection, input.toPhoneNumber),
    mediaPath: "provider-native",
    ...(input.outageMode === undefined ? {} : { outageMode: input.outageMode }),
    ...(input.recordingConsent === undefined
      ? {}
      : { recordingConsent: cloneRecordingConsentState(input.recordingConsent) }),
    diagnostics: buildExecutionDiagnostics({
      connection: input.connection,
      direction: input.direction,
      testCall: input.testCall,
    }),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createTelephonyExecutionCommands(input: {
  session: TelephonyExecutionSession;
  connection: TelephonyConnection;
  now: string;
}): TelephonyExecutionCommand[] {
  const bridgeCommand = {
    id: `${input.session.id}:bridge:1`,
    tenantId: input.session.tenantId,
    sessionId: input.session.id,
    dispatchId: input.session.dispatchId,
    callSessionId: input.session.callSessionId,
    provider: input.session.provider,
    action: resolveInitialBridgeAction(input.session),
    status: "applied" as const,
    target: resolveBridgeCommandTarget(input.session),
    payload: buildExecutionCommandPayload(input.session, input.connection),
    requestedAt: input.now,
    appliedAt: input.now,
  };

  if (input.session.recordingConsent?.noticeRequired !== true) {
    return [bridgeCommand];
  }

  return [
    {
      id: `${input.session.id}:recording-notice:1`,
      tenantId: input.session.tenantId,
      sessionId: input.session.id,
      dispatchId: input.session.dispatchId,
      callSessionId: input.session.callSessionId,
      provider: input.session.provider,
      action: "telephony.recording.play-notice",
      status: "applied",
      target: resolveBridgeCommandTarget(input.session),
      payload: {
        consentMessage: input.session.recordingConsent.message,
        consentMode: input.session.recordingConsent.consentMode,
        recordingConsentState: input.session.recordingConsent.state,
      },
      requestedAt: input.now,
      appliedAt: input.now,
    },
    bridgeCommand,
  ];
}

export function applyTelephonyCallControlEventToSession(input: {
  session: TelephonyExecutionSession;
  event: TelephonyCallControlEvent;
}): TelephonyExecutionSession {
  if (input.session.callSessionId !== input.event.callSessionId) {
    throw new Error("Telephony call-control events must target the active execution session.");
  }

  const diagnostics = [...input.session.diagnostics, input.event.summary];

  switch (input.event.eventType) {
    case "dtmf.received":
      return {
        ...input.session,
        status: "active",
        diagnostics,
        updatedAt: input.event.at,
      };
    case "voicemail.detected":
      return {
        ...input.session,
        status: "voicemail",
        fallbackTarget: input.event.fallbackTarget,
        diagnostics,
        updatedAt: input.event.at,
      };
    case "transfer.requested":
      return {
        ...input.session,
        status: "transfer-pending",
        diagnostics,
        updatedAt: input.event.at,
      };
    case "transfer.failed":
    case "failover.triggered":
      return {
        ...input.session,
        status: "failover-active",
        outageMode: "provider-fallback",
        fallbackTarget: input.event.fallbackTarget,
        diagnostics,
        updatedAt: input.event.at,
      };
    case "callback.scheduled":
      return {
        ...input.session,
        status: "completed",
        fallbackTarget: input.event.fallbackTarget,
        diagnostics,
        updatedAt: input.event.at,
      };
  }
}

export function createTelephonyCallControlCommands(input: {
  session: TelephonyExecutionSession;
  event: TelephonyCallControlEvent;
}): TelephonyExecutionCommand[] {
  return [
    {
      id: `${input.session.id}:${input.event.eventType}:${input.event.at}`,
      tenantId: input.session.tenantId,
      sessionId: input.session.id,
      dispatchId: input.session.dispatchId,
      callSessionId: input.session.callSessionId,
      provider: input.session.provider,
      action: resolveCallControlBridgeAction(input.session, input.event),
      status: "applied",
      target:
        input.event.fallbackTarget ??
        input.event.payload.transferTarget ??
        input.session.bridgeTarget,
      payload: {
        ...input.event.payload,
      },
      requestedAt: input.event.at,
      appliedAt: input.event.at,
    },
  ];
}

export function createTelephonyProviderHeartbeat(input: {
  tenantId: ID;
  connection: TelephonyConnection;
  status: TelephonyHealthStatus;
  blocking: boolean;
  scheduled: boolean;
  latencyMs: number;
  at: string;
  routedNumberCount: number;
}): TelephonyProviderHeartbeat {
  const diagnostics = buildHeartbeatDiagnostics({
    connection: input.connection,
    routedNumberCount: input.routedNumberCount,
  });

  return {
    id: `${input.connection.id}:heartbeat:${input.at}`,
    tenantId: input.tenantId,
    connectionId: input.connection.id,
    provider: input.connection.provider,
    ownershipMode: input.connection.ownershipMode,
    status: input.status,
    blocking: input.blocking,
    scheduled: input.scheduled,
    latencyMs: input.latencyMs,
    routedNumberCount: input.routedNumberCount,
    at: input.at,
    message: buildHeartbeatMessage({
      connection: input.connection,
      status: input.status,
      routedNumberCount: input.routedNumberCount,
      scheduled: input.scheduled,
    }),
    diagnostics,
  };
}

export function computeTwilioWebhookSignature(input: {
  url: string;
  parameters: Record<string, string>;
  authToken: string;
}) {
  const canonical = `${input.url}${Object.keys(input.parameters)
    .sort()
    .map((key) => `${key}${input.parameters[key] ?? ""}`)
    .join("")}`;

  return computeHmacSha1Base64(input.authToken, canonical);
}

export function verifyTwilioWebhookSignature(input: {
  url: string;
  parameters: Record<string, string>;
  authToken: string;
  signature: string;
}) {
  return computeTwilioWebhookSignature(input) === input.signature;
}

function createCredentialReference(input: {
  connectionId: ID;
  provider: TelephonyProvider;
  secret: string;
  keyVersion: number;
}): EncryptedCredentialReference {
  return {
    id: `${input.connectionId}:cred`,
    provider: input.provider,
    keyVersion: input.keyVersion,
    preview: maskSecret(input.secret),
  };
}

function findFallbackRoute(input: {
  routedNumber: ImportedTelephonyPhoneNumber;
  phoneNumbers: ImportedTelephonyPhoneNumber[];
  connections: TelephonyConnection[];
}) {
  return input.phoneNumbers
    .filter(
      (candidate) =>
        candidate.id !== input.routedNumber.id &&
        candidate.tenantId === input.routedNumber.tenantId &&
        candidate.status === "routed" &&
        candidate.publishedVersionId === input.routedNumber.publishedVersionId &&
        candidate.workspaceId === input.routedNumber.workspaceId,
    )
    .map((phoneNumber) => ({
      phoneNumber,
      connection: input.connections.find(
        (candidate) =>
          candidate.id === phoneNumber.connectionId && candidate.tenantId === phoneNumber.tenantId,
      ),
    }))
    .find(
      (candidate): candidate is {
        phoneNumber: ImportedTelephonyPhoneNumber;
        connection: TelephonyConnection;
      } =>
        candidate.connection !== undefined &&
        candidate.connection.status !== "disabled" &&
        candidate.connection.healthStatus !== "failed",
    );
}

function createImportedPhoneNumber(input: ImportedTelephonyPhoneNumber): ImportedTelephonyPhoneNumber {
  return {
    ...input,
    ...(input.recordingPolicy === undefined
      ? {}
      : {
          recordingPolicy: cloneRecordingPolicy(input.recordingPolicy),
        }),
  };
}

function resolveProvisionSource(
  connection: TelephonyConnection,
): TelephonyPhoneNumberProvisionSource {
  switch (connection.ownershipMode) {
    case "platform_managed":
      return "platform-pool";
    case "byo_sip_trunk":
      return "manual-did";
    case "byo_provider_account":
      return "provider-import";
  }
}

function buildPolicyCheck(
  passed: boolean,
  successDetail: string,
  failureDetail: string,
): OutboundCallPolicyCheck {
  return {
    status: passed ? "passed" : "blocked",
    detail: passed ? successDetail : failureDetail,
  };
}

function isWithinCallingWindow(
  localHour: number,
  callingWindow: { startHour: number; endHour: number },
) {
  if (callingWindow.startHour === callingWindow.endHour) {
    return true;
  }

  if (callingWindow.startHour < callingWindow.endHour) {
    return localHour >= callingWindow.startHour && localHour < callingWindow.endHour;
  }

  return localHour >= callingWindow.startHour || localHour < callingWindow.endHour;
}

function maskSecret(value: string) {
  return `****${value.slice(-4)}`;
}

function buildExecutionDiagnostics(input: {
  connection: TelephonyConnection;
  direction: "inbound" | "outbound";
  testCall: boolean;
}) {
  const routeLabel = input.direction === "inbound" ? "ingress" : "egress";

  switch (input.connection.ownershipMode) {
    case "platform_managed":
      return [
        `Zara platform edge reserved ${routeLabel} capacity in ${input.connection.region}.`,
        `Provider bridge is ready for ${input.testCall ? "loopback verification" : "live traffic"}.`,
      ];
    case "byo_provider_account":
      return [
        `Twilio programmable voice accepted the ${routeLabel} session.`,
        `Credential-backed provider bridge is ready for ${input.testCall ? "test audio" : "live traffic"}.`,
      ];
    case "byo_sip_trunk":
      return [
        `SIP INVITE prepared for ${input.connection.sip?.domain ?? "the configured trunk"}.`,
        `Preferred codecs: ${(input.connection.sip?.codecs ?? []).join(", ") || "default"}.`,
      ];
  }
}

function buildHeartbeatDiagnostics(input: {
  connection: TelephonyConnection;
  routedNumberCount: number;
}) {
  switch (input.connection.ownershipMode) {
    case "platform_managed":
      return [
        `Validated platform edge reachability for ${input.connection.region}.`,
        `${input.routedNumberCount} routed number${input.routedNumberCount === 1 ? "" : "s"} attached to the platform edge.`,
      ];
    case "byo_provider_account":
      return [
        "Twilio REST credential probe completed successfully.",
        `${input.routedNumberCount} routed number${input.routedNumberCount === 1 ? "" : "s"} available for provider dispatch.`,
      ];
    case "byo_sip_trunk":
      return [
        `SIP OPTIONS heartbeat completed for ${input.connection.sip?.domain ?? "the configured trunk"}.`,
        `${input.routedNumberCount} routed DID${input.routedNumberCount === 1 ? "" : "s"} available on the trunk.`,
      ];
  }
}

function resolveBridgeKind(connection: TelephonyConnection): TelephonyExecutionBridgeKind {
  switch (connection.ownershipMode) {
    case "platform_managed":
      return "platform-edge";
    case "byo_provider_account":
      return "twilio-programmable-voice";
    case "byo_sip_trunk":
      return "sip-trunk";
  }
}

function resolveBridgeTarget(connection: TelephonyConnection, toPhoneNumber: string) {
  switch (connection.ownershipMode) {
    case "platform_managed":
      return connection.region;
    case "byo_provider_account":
      return normalizePhoneNumber(toPhoneNumber);
    case "byo_sip_trunk":
      return connection.sip?.domain ?? "configured-sip-trunk";
  }
}

function resolveInitialBridgeAction(session: TelephonyExecutionSession) {
  switch (session.bridgeKind) {
    case "platform-edge":
      return session.direction === "inbound"
        ? "platform.edge.accept-call"
        : "platform.edge.originate-call";
    case "twilio-programmable-voice":
      return session.direction === "inbound"
        ? "twilio.calls.answer"
        : "twilio.calls.create";
    case "sip-trunk":
      return session.direction === "inbound" ? "sip.invite.accept" : "sip.invite.create";
  }
}

function resolveBridgeCommandTarget(session: TelephonyExecutionSession) {
  switch (session.bridgeKind) {
    case "platform-edge":
      return session.bridgeTarget;
    case "twilio-programmable-voice":
      return session.toPhoneNumber;
    case "sip-trunk":
      return session.bridgeTarget;
  }
}

function buildExecutionCommandPayload(
  session: TelephonyExecutionSession,
  connection: TelephonyConnection,
) {
  return {
    toPhoneNumber: session.toPhoneNumber,
    fromPhoneNumber: session.fromPhoneNumber,
    direction: session.direction,
    bridgeTarget: session.bridgeTarget,
    ...(session.workflowLabel === undefined ? {} : { workflowLabel: session.workflowLabel }),
    ...(connection.webhookBaseUrl === undefined
      ? {}
      : { webhookBaseUrl: connection.webhookBaseUrl }),
    ...(session.testCall ? { mode: "test-call" } : { mode: "live-call" }),
  };
}

function resolveCallControlBridgeAction(
  session: TelephonyExecutionSession,
  event: TelephonyCallControlEvent,
) {
  switch (session.bridgeKind) {
    case "platform-edge":
      switch (event.eventType) {
        case "dtmf.received":
          return "platform.edge.observe-dtmf";
        case "voicemail.detected":
          return "platform.edge.voicemail-fallback";
        case "transfer.requested":
          return "platform.edge.transfer";
        case "transfer.failed":
        case "failover.triggered":
          return "platform.edge.failover";
        case "callback.scheduled":
          return "platform.edge.callback-fallback";
      }
      return "platform.edge.observe-dtmf";
    case "twilio-programmable-voice":
      switch (event.eventType) {
        case "dtmf.received":
          return "twilio.calls.observe-dtmf";
        case "voicemail.detected":
          return "twilio.calls.redirect.voicemail";
        case "transfer.requested":
          return "twilio.calls.redirect.transfer";
        case "transfer.failed":
        case "failover.triggered":
          return "twilio.calls.redirect.fallback";
        case "callback.scheduled":
          return "twilio.calls.enqueue-callback";
      }
      return "twilio.calls.observe-dtmf";
    case "sip-trunk":
      switch (event.eventType) {
        case "dtmf.received":
          return "sip.info.dtmf";
        case "voicemail.detected":
          return "sip.reinvite.voicemail";
        case "transfer.requested":
          return "sip.refer";
        case "transfer.failed":
        case "failover.triggered":
          return "sip.reinvite.failover";
        case "callback.scheduled":
          return "sip.notify.callback";
      }
      return "sip.info.dtmf";
  }
}

function buildHeartbeatMessage(input: {
  connection: TelephonyConnection;
  status: TelephonyHealthStatus;
  routedNumberCount: number;
  scheduled: boolean;
}) {
  const scheduleLabel = input.scheduled ? "Scheduled" : "Manual";

  switch (input.connection.ownershipMode) {
    case "platform_managed":
      return `${scheduleLabel} platform edge heartbeat is ${input.status} with ${input.routedNumberCount} routed number${input.routedNumberCount === 1 ? "" : "s"}.`;
    case "byo_provider_account":
      return `${scheduleLabel} Twilio heartbeat is ${input.status} with ${input.routedNumberCount} routed number${input.routedNumberCount === 1 ? "" : "s"}.`;
    case "byo_sip_trunk":
      return `${scheduleLabel} SIP trunk heartbeat is ${input.status} with ${input.routedNumberCount} routed DID${input.routedNumberCount === 1 ? "" : "s"}.`;
  }
}

function normalizePhoneNumber(value: string) {
  const digits = value.replace(/\D+/g, "");

  if (digits.startsWith("1") && digits.length === 11) {
    return `+${digits}`;
  }

  if (value.trim().startsWith("+")) {
    return `+${digits}`;
  }

  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function computeHmacSha1Base64(secret: string, value: string) {
  const blockSize = 64;
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(value);
  let keyBytes = encoder.encode(secret);

  if (keyBytes.length > blockSize) {
    keyBytes = computeSha1(keyBytes);
  }

  const normalizedKey = new Uint8Array(blockSize);
  normalizedKey.set(keyBytes.slice(0, blockSize));

  const innerPad = new Uint8Array(blockSize);
  const outerPad = new Uint8Array(blockSize);

  for (let index = 0; index < blockSize; index += 1) {
    innerPad[index] = normalizedKey[index]! ^ 0x36;
    outerPad[index] = normalizedKey[index]! ^ 0x5c;
  }

  const innerHash = computeSha1(concatBytes(innerPad, messageBytes));
  const outerHash = computeSha1(concatBytes(outerPad, innerHash));

  return encodeBase64(outerHash);
}

function computeSha1(input: Uint8Array) {
  const padded = padSha1Input(input);
  const words = new Uint32Array(80);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      words[index] =
        ((padded[base] ?? 0) << 24)
        | ((padded[base + 1] ?? 0) << 16)
        | ((padded[base + 2] ?? 0) << 8)
        | (padded[base + 3] ?? 0);
    }

    for (let index = 16; index < 80; index += 1) {
      words[index] = leftRotate(
        (words[index - 3]! ^ words[index - 8]! ^ words[index - 14]! ^ words[index - 16]!) >>> 0,
        1,
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let index = 0; index < 80; index += 1) {
      const [f, k] = resolveSha1Round(b, c, d, index);
      const temp = (leftRotate(a, 5) + f + e + k + words[index]!) >>> 0;

      e = d;
      d = c;
      c = leftRotate(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const view = new DataView(digest.buffer);
  view.setUint32(0, h0);
  view.setUint32(4, h1);
  view.setUint32(8, h2);
  view.setUint32(12, h3);
  view.setUint32(16, h4);

  return digest;
}

function padSha1Input(input: Uint8Array) {
  const bitLength = input.length * 8;
  const totalLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(totalLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLength - 4, bitLength >>> 0);
  view.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000));

  return padded;
}

function resolveSha1Round(b: number, c: number, d: number, index: number): [number, number] {
  if (index < 20) {
    return [((b & c) | (~b & d)) >>> 0, 0x5a827999];
  }

  if (index < 40) {
    return [(b ^ c ^ d) >>> 0, 0x6ed9eba1];
  }

  if (index < 60) {
    return [((b & c) | (b & d) | (c & d)) >>> 0, 0x8f1bbcdc];
  }

  return [(b ^ c ^ d) >>> 0, 0xca62c1d6];
}

function leftRotate(value: number, bits: number) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}

function encodeBase64(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    output += alphabet[(chunk >>> 18) & 0x3f];
    output += alphabet[(chunk >>> 12) & 0x3f];
    output += second === undefined ? "=" : alphabet[(chunk >>> 6) & 0x3f];
    output += third === undefined ? "=" : alphabet[chunk & 0x3f];
  }

  return output;
}

function validateOwnershipProvider(
  ownershipMode: TelephonyConnectionOwnershipMode,
  provider: TelephonyProvider,
) {
  switch (ownershipMode) {
    case "platform_managed":
      if (provider === "browser-webrtc" || provider === "custom-sip") {
        throw new Error(`Provider '${provider}' is not valid for platform-managed telephony.`);
      }
      break;
    case "byo_sip_trunk":
      if (provider !== "custom-sip") {
        throw new Error("BYO SIP trunk connections must use the custom-sip provider.");
      }
      break;
    case "byo_provider_account":
      if (provider !== "twilio") {
        throw new Error("BYO provider accounts currently support Twilio only.");
      }
      break;
  }
}

function cloneRecordingPolicy(policy: TelephonyRecordingPolicy): TelephonyRecordingPolicy {
  return {
    enabled: policy.enabled,
    consentMode: policy.consentMode,
    consentMessage: policy.consentMessage,
  };
}

function resolveRecordingConsentState(
  policy: TelephonyRecordingPolicy,
  recordedAt: string,
): TelephonyRecordingConsentState {
  if (!policy.enabled || policy.consentMode === "disabled") {
    return {
      state: "recording_disabled",
      noticeRequired: false,
      consentMode: policy.consentMode,
      message: policy.consentMessage,
      recordedAt,
      reason: "Recording is disabled for this call.",
    };
  }

  if (policy.consentMode === "two-party") {
    return {
      state: "notice_queued",
      noticeRequired: true,
      consentMode: policy.consentMode,
      message: policy.consentMessage,
      recordedAt,
      reason: "Two-party recording consent requires a notice before call recording.",
    };
  }

  return {
    state: "not_required",
    noticeRequired: false,
    consentMode: policy.consentMode,
    message: policy.consentMessage,
    recordedAt,
    reason: "Single-party recording policy does not require a pre-recording notice.",
  };
}

function cloneRecordingConsentState(
  consent: TelephonyRecordingConsentState,
): TelephonyRecordingConsentState {
  return {
    ...consent,
  };
}

function cloneSipMetadata(sip: SipTrunkMetadata): SipTrunkMetadata {
  return {
    domain: sip.domain,
    codecs: [...sip.codecs],
  };
}
