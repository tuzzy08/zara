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

export interface ImportedTelephonyPhoneNumber {
  id: ID;
  tenantId: ID;
  connectionId: ID;
  provider: "twilio";
  externalNumberId: string;
  phoneNumber: string;
  friendlyName: string;
  voiceCapable: boolean;
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
  connectionId?: ID | undefined;
  publishedVersionId?: ID | undefined;
  workspaceId?: ID | undefined;
  recording: TelephonyRecordingPolicy;
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

    imported.push({
      id: `phone-number-${number.sid.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      provider: "twilio",
      externalNumberId: number.sid,
      phoneNumber: normalizedPhoneNumber,
      friendlyName: number.friendlyName,
      voiceCapable: true,
      status: "imported",
      webhookStatus: "pending",
    });
  }

  return imported;
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
    };
  }

  if (
    connection.blockRoutingOnHealthFailure &&
    (connection.status === "disabled" || connection.healthStatus === "failed")
  ) {
    return {
      disposition: "blocked",
      reason: "Inbound routing is blocked because provider health checks are failing.",
      phoneNumberId: routedNumber.id,
      connectionId: connection.id,
      recording: cloneRecordingPolicy(routedNumber.recordingPolicy ?? connection.recordingPolicy),
    };
  }

  return {
    disposition: "routed",
    reason: `Routed ${normalizedDestination} to ${routedNumber.workflowLabel ?? routedNumber.publishedVersionId}.`,
    callSessionId: `${input.callSid}:telephony`,
    phoneNumberId: routedNumber.id,
    connectionId: connection.id,
    publishedVersionId: routedNumber.publishedVersionId,
    workspaceId: routedNumber.workspaceId,
    recording: cloneRecordingPolicy(routedNumber.recordingPolicy ?? connection.recordingPolicy),
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
}): EncryptedCredentialReference {
  return {
    id: `${input.connectionId}:cred`,
    provider: input.provider,
    keyVersion: 1,
    preview: maskSecret(input.secret),
  };
}

function maskSecret(value: string) {
  return `****${value.slice(-4)}`;
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

function cloneSipMetadata(sip: SipTrunkMetadata): SipTrunkMetadata {
  return {
    domain: sip.domain,
    codecs: [...sip.codecs],
  };
}
