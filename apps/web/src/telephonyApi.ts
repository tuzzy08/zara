import type {
  ImportedTelephonyPhoneNumber,
  InboundCallResolution,
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

export interface TelephonyDispatchRecord extends InboundCallResolution {
  id: string;
  tenantId: string;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  createdAt: string;
  source: "manual" | "webhook";
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
