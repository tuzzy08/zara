import type {
  ImportedTelephonyPhoneNumber,
  OutboundCallPolicyChecks,
  TelephonyCallControlEvent,
  TelephonyConnection,
  TelephonyHealthStatus,
  TelephonyRecordingPolicy,
} from "@zara/core";

export interface TelephonyHealthCheck {
  id: string;
  connectionId: string;
  status: TelephonyHealthStatus;
  blocking: boolean;
  checkedAt: string;
  message: string;
}

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

export interface TelephonyCredentialVaultEntry {
  accountSid?: string | undefined;
  authToken?: string | undefined;
  username?: string | undefined;
  secret?: string | undefined;
}

export interface TelephonyStateStore extends TelephonyStateResponse {
  credentialVault: Map<string, TelephonyCredentialVaultEntry>;
  processedWebhookEventIds: Set<string>;
}
