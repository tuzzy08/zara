import type {
  ImportedTelephonyPhoneNumber,
  InboundCallPolicyChecks,
  OutboundCallPolicyChecks,
  TelephonyCallControlEvent,
  TelephonyCallControlEventType,
  TelephonyConnection,
  TelephonyExecutionCommand,
  TelephonyExecutionSession,
  TelephonyProviderHeartbeat,
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
  scheduled?: boolean | undefined;
  latencyMs?: number | undefined;
  diagnostics?: string[] | undefined;
}

export type { TelephonyCallControlEvent } from "@zara/core";

export interface TelephonyDispatchRecord {
  id: string;
  tenantId: string;
  direction: "inbound" | "outbound";
  disposition: "routed" | "fallback" | "blocked" | "queued";
  reason: string;
  routeMode?: "test_route" | "live_route" | undefined;
  callSessionId?: string | undefined;
  phoneNumberId?: string | undefined;
  fallbackPhoneNumberId?: string | undefined;
  connectionId?: string | undefined;
  publishedVersionId?: string | undefined;
  workspaceId?: string | undefined;
  workflowLabel?: string | undefined;
  runtimeProfile?: "cost-optimized" | "balanced" | "premium-realtime" | undefined;
  runtimePath?: "pstn-sandwich" | "pstn-premium-realtime" | undefined;
  testRouteSessionId?: string | undefined;
  outageMode?: "provider-fallback" | undefined;
  recording: TelephonyRecordingPolicy;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  createdAt: string;
  source: "manual" | "webhook";
  policyChecks?: InboundCallPolicyChecks | OutboundCallPolicyChecks | undefined;
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
  providerHeartbeats?: TelephonyProviderHeartbeat[] | undefined;
  dispatches: TelephonyDispatchRecord[];
  executionSessions?: TelephonyExecutionSession[] | undefined;
  executionCommands?: TelephonyExecutionCommand[] | undefined;
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

export async function runTelephonyHeartbeatViaApi(input: {
  organizationId: string;
  connectionId: string;
  scheduled?: boolean | undefined;
}) {
  return requestJson<
    TelephonyStateEnvelope & {
      heartbeat: TelephonyProviderHeartbeat;
      healthCheck: TelephonyHealthCheck;
    }
  >(`/organizations/${input.organizationId}/telephony/connections/${input.connectionId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({
      scheduled: input.scheduled ?? false,
    }),
  });
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
  runtimeProfile?: "cost-optimized" | "balanced" | "premium-realtime" | undefined;
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
        runtimeProfile: input.runtimeProfile,
        recordingPolicy: input.recordingPolicy,
      }),
    },
  );
}

export async function createPstnTestRouteViaApi(input: {
  organizationId: string;
  numberId: string;
  publishedVersionId: string;
  workflowLabel: string;
  workspaceId: string;
  runtimeProfile: "cost-optimized" | "balanced" | "premium-realtime";
  allowedCallerNumbers: string[];
  expiresAt: string;
}) {
  return requestJson<TelephonyStateEnvelope & { phoneNumber: ImportedTelephonyPhoneNumber }>(
    `/organizations/${input.organizationId}/telephony/numbers/${input.numberId}/pstn-test-route`,
    {
      method: "POST",
      body: JSON.stringify({
        publishedVersionId: input.publishedVersionId,
        workflowLabel: input.workflowLabel,
        workspaceId: input.workspaceId,
        runtimeProfile: input.runtimeProfile,
        allowedCallerNumbers: input.allowedCallerNumbers,
        expiresAt: input.expiresAt,
      }),
    },
  );
}

export async function completePstnTestRouteViaApi(input: {
  organizationId: string;
  numberId: string;
  sessionId: string;
  status: "failed" | "expired" | "unauthorized_caller" | "manually_ended";
  reason: string;
}) {
  return requestJson<TelephonyStateEnvelope & { phoneNumber: ImportedTelephonyPhoneNumber }>(
    `/organizations/${input.organizationId}/telephony/numbers/${input.numberId}/pstn-test-route/${encodeURIComponent(input.sessionId)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({
        status: input.status,
        reason: input.reason,
      }),
    },
  );
}

export async function activateTelephonyLiveRouteViaApi(input: {
  organizationId: string;
  numberId: string;
  actorUserId: string;
}) {
  return requestJson<
    TelephonyStateEnvelope & {
      phoneNumber: ImportedTelephonyPhoneNumber;
      activation: {
        status: "activated";
        activatedAt: string;
        activatedBy: string;
        summary: Record<string, unknown>;
      };
    }
  >(
    `/organizations/${input.organizationId}/telephony/numbers/${input.numberId}/live-route/activate`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
      }),
    },
  );
}

export async function pauseTelephonyLiveRouteViaApi(input: {
  organizationId: string;
  numberId: string;
  actorUserId: string;
}) {
  return requestJson<TelephonyStateEnvelope & { phoneNumber: ImportedTelephonyPhoneNumber }>(
    `/organizations/${input.organizationId}/telephony/numbers/${input.numberId}/live-route/pause`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
      }),
    },
  );
}

export async function resumeTelephonyLiveRouteViaApi(input: {
  organizationId: string;
  numberId: string;
  actorUserId: string;
}) {
  return requestJson<
    TelephonyStateEnvelope & {
      phoneNumber: ImportedTelephonyPhoneNumber;
      activation: {
        status: "activated";
        activatedAt: string;
        activatedBy: string;
        summary: Record<string, unknown>;
      };
    }
  >(
    `/organizations/${input.organizationId}/telephony/numbers/${input.numberId}/live-route/resume`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
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

export async function runTelephonyLoopbackTestViaApi(input: {
  organizationId: string;
  connectionId: string;
  phoneNumberId: string;
  fromPhoneNumber: string;
  callSid: string;
}) {
  return requestJson<
    TelephonyStateEnvelope & {
      dispatch: TelephonyDispatchRecord;
      session: TelephonyExecutionSession;
    }
  >(`/organizations/${input.organizationId}/telephony/connections/${input.connectionId}/test-call`, {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: input.phoneNumberId,
      fromPhoneNumber: input.fromPhoneNumber,
      callSid: input.callSid,
    }),
  });
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
  eventType: TelephonyCallControlEventType;
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

export async function rotateTelephonyCredentialsViaApi(input: {
  organizationId: string;
}) {
  return requestJson<TelephonyStateEnvelope & { rotatedConnectionCount: number }>(
    `/organizations/${input.organizationId}/telephony/credentials/rotate`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}
