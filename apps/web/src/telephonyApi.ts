import type {
  ImportedTelephonyPhoneNumber,
  OutboundCallPolicyChecks,
  TelephonyCallControlEvent,
  TelephonyConnection,
  TelephonyRecordingPolicy,
} from "@zara/core";

import { requestJson } from "./apiClient";

export interface TelephonyHealthCheck {
  id: string;
  connectionId: string;
  status: "unknown" | "healthy" | "warning" | "failed";
  blocking: boolean;
  checkedAt: string;
  message: string;
}

export type { TelephonyCallControlEvent } from "@zara/core";

export interface TelephonyDispatchRecord {
  id: string;
  tenantId: string;
  direction: "inbound" | "outbound";
  disposition: "routed" | "fallback" | "blocked" | "queued";
  reason: string;
  callSessionId?: string | undefined;
  phoneNumberId?: string | undefined;
  connectionId?: string | undefined;
  publishedVersionId?: string | undefined;
  workspaceId?: string | undefined;
  workflowLabel?: string | undefined;
  recording: TelephonyRecordingPolicy;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  createdAt: string;
  source: "manual" | "webhook";
  policyChecks?: OutboundCallPolicyChecks | undefined;
}

export interface TelephonyWebhookEvent {
  id: string;
  tenantId: string;
  connectionId: string;
  accountSid: string;
  callSid: string;
  eventSid: string;
  eventType: string;
  receivedAt: string;
  duplicate: boolean;
}

export interface TelephonyStateResponse {
  organizationId: string;
  connections: TelephonyConnection[];
  phoneNumbers: ImportedTelephonyPhoneNumber[];
  healthChecks: TelephonyHealthCheck[];
  dispatches: TelephonyDispatchRecord[];
  webhookEvents: TelephonyWebhookEvent[];
  callControlEvents: TelephonyCallControlEvent[];
}

interface TelephonyStateEnvelope {
  state: TelephonyStateResponse;
}

export async function fetchTelephonyState(organizationId: string) {
  return requestJson<TelephonyStateResponse>(`/organizations/${organizationId}/telephony/state`);
}

export async function createTwilioConnectionViaApi(input: {
  organizationId: string;
  actorUserId: string;
  label: string;
  region: string;
  accountSid: string;
  authToken: string;
  blockRoutingOnHealthFailure: boolean;
  recordingPolicy: TelephonyRecordingPolicy;
}) {
  return requestJson<TelephonyStateEnvelope>(`/organizations/${input.organizationId}/telephony/connections`, {
    method: "POST",
    body: JSON.stringify({
      actorUserId: input.actorUserId,
      label: input.label,
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: input.region,
      accountSid: input.accountSid,
      authToken: input.authToken,
      blockRoutingOnHealthFailure: input.blockRoutingOnHealthFailure,
      recordingPolicy: input.recordingPolicy,
    }),
  });
}

export async function createPlatformManagedConnectionViaApi(input: {
  organizationId: string;
  actorUserId: string;
  label: string;
  region: string;
  recordingPolicy: TelephonyRecordingPolicy;
  provider?: "twilio" | "signalwire" | "telnyx" | undefined;
}) {
  return requestJson<TelephonyStateEnvelope & { connection: TelephonyConnection }>(
    `/organizations/${input.organizationId}/telephony/connections`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        label: input.label,
        ownershipMode: "platform_managed",
        provider: input.provider ?? "twilio",
        region: input.region,
        blockRoutingOnHealthFailure: true,
        recordingPolicy: input.recordingPolicy,
      }),
    },
  );
}

export async function createSipConnectionViaApi(input: {
  organizationId: string;
  actorUserId: string;
  label: string;
  region: string;
  username: string;
  secret: string;
  sipDomain: string;
  codecs: string[];
  blockRoutingOnHealthFailure: boolean;
  recordingPolicy: TelephonyRecordingPolicy;
}) {
  return requestJson<TelephonyStateEnvelope & { connection: TelephonyConnection }>(
    `/organizations/${input.organizationId}/telephony/connections`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        label: input.label,
        ownershipMode: "byo_sip_trunk",
        provider: "custom-sip",
        region: input.region,
        username: input.username,
        secret: input.secret,
        sip: {
          domain: input.sipDomain,
          codecs: input.codecs,
        },
        blockRoutingOnHealthFailure: input.blockRoutingOnHealthFailure,
        recordingPolicy: input.recordingPolicy,
      }),
    },
  );
}

export async function validateTelephonyConnectionViaApi(input: {
  organizationId: string;
  connectionId: string;
  actorUserId: string;
}) {
  return requestJson<TelephonyStateEnvelope & { healthCheck: TelephonyHealthCheck }>(
    `/organizations/${input.organizationId}/telephony/connections/${input.connectionId}/validate`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
      }),
    },
  );
}

export async function importTwilioNumbersViaApi(input: {
  organizationId: string;
  connectionId: string;
  actorUserId: string;
}) {
  return requestJson<TelephonyStateEnvelope>(
    `/organizations/${input.organizationId}/telephony/connections/${input.connectionId}/import-twilio-numbers`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
      }),
    },
  );
}

export async function registerTelephonyNumberViaApi(input: {
  organizationId: string;
  connectionId: string;
  phoneNumber: string;
  friendlyName: string;
  externalNumberId?: string | undefined;
}) {
  return requestJson<TelephonyStateEnvelope & { phoneNumber: ImportedTelephonyPhoneNumber }>(
    `/organizations/${input.organizationId}/telephony/connections/${input.connectionId}/register-number`,
    {
      method: "POST",
      body: JSON.stringify({
        phoneNumber: input.phoneNumber,
        friendlyName: input.friendlyName,
        externalNumberId: input.externalNumberId,
      }),
    },
  );
}

export async function assignTelephonyRouteViaApi(input: {
  organizationId: string;
  numberId: string;
  actorUserId: string;
  publishedVersionId: string;
  workflowLabel: string;
  workspaceId: string;
  recordingPolicy: TelephonyRecordingPolicy;
}) {
  return requestJson<TelephonyStateEnvelope>(
    `/organizations/${input.organizationId}/telephony/numbers/${input.numberId}/routing`,
    {
      method: "PATCH",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        publishedVersionId: input.publishedVersionId,
        workflowLabel: input.workflowLabel,
        workspaceId: input.workspaceId,
        recordingPolicy: input.recordingPolicy,
      }),
    },
  );
}

export async function dispatchInboundTelephonyTestViaApi(input: {
  organizationId: string;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  callSid: string;
}) {
  return requestJson<TelephonyStateEnvelope & { dispatch: TelephonyDispatchRecord }>(
    `/organizations/${input.organizationId}/telephony/dispatch/inbound`,
    {
      method: "POST",
      body: JSON.stringify({
        toPhoneNumber: input.toPhoneNumber,
        fromPhoneNumber: input.fromPhoneNumber,
        callSid: input.callSid,
      }),
    },
  );
}

export async function dispatchOutboundTelephonyCallViaApi(input: {
  organizationId: string;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  callSid: string;
  publishedVersionId: string;
  workflowLabel: string;
  workspaceId: string;
  consentGranted: boolean;
  budgetRemainingUsd: number;
  estimatedCostUsd: number;
  localHour: number;
  callingWindow: { startHour: number; endHour: number };
}) {
  return requestJson<TelephonyStateEnvelope & { dispatch: TelephonyDispatchRecord }>(
    `/organizations/${input.organizationId}/telephony/dispatch/outbound`,
    {
      method: "POST",
      body: JSON.stringify({
        toPhoneNumber: input.toPhoneNumber,
        fromPhoneNumber: input.fromPhoneNumber,
        callSid: input.callSid,
        publishedVersionId: input.publishedVersionId,
        workflowLabel: input.workflowLabel,
        workspaceId: input.workspaceId,
        consentGranted: input.consentGranted,
        budgetRemainingUsd: input.budgetRemainingUsd,
        estimatedCostUsd: input.estimatedCostUsd,
        localHour: input.localHour,
        callingWindow: input.callingWindow,
      }),
    },
  );
}

export async function recordTelephonyCallControlEventViaApi(input: {
  organizationId: string;
  callSessionId: string;
  dispatchId: string;
  eventType:
    | "dtmf.received"
    | "voicemail.detected"
    | "transfer.requested"
    | "transfer.failed"
    | "failover.triggered";
  digit?: string | undefined;
  transferTarget?: string | undefined;
  fallbackTarget?: string | undefined;
}) {
  return requestJson<TelephonyStateEnvelope & { event: TelephonyCallControlEvent }>(
    `/organizations/${input.organizationId}/telephony/calls/${encodeURIComponent(input.callSessionId)}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        dispatchId: input.dispatchId,
        eventType: input.eventType,
        digit: input.digit,
        transferTarget: input.transferTarget,
        fallbackTarget: input.fallbackTarget,
      }),
    },
  );
}
