import type {
  ImportedTelephonyPhoneNumber,
  OutboundCallPolicyChecks,
  TelephonyCallControlEvent,
  TelephonyConnection,
  TelephonyExecutionCommand,
  TelephonyExecutionSession,
  TelephonyHealthStatus,
  TelephonyProviderHeartbeat,
  TelephonyRecordingConsentState,
  TelephonyRecordingPolicy,
} from "@zara/core";

export interface TelephonyHealthCheck {
  id: string;
  connectionId: string;
  status: TelephonyHealthStatus;
  blocking: boolean;
  checkedAt: string;
  message: string;
  scheduled?: boolean | undefined;
  latencyMs?: number | undefined;
  diagnostics?: string[] | undefined;
}

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
  testRouteSessionId?: string | undefined;
  outageMode?: "provider-fallback" | undefined;
  recording: TelephonyRecordingPolicy;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  createdAt: string;
  source: "manual" | "webhook";
  recordingConsent: TelephonyRecordingConsentState;
  policyChecks?: OutboundCallPolicyChecks | undefined;
}

export interface TelephonyOutboundAbusePolicy {
  maxCallsPerWindow: number;
  windowSeconds: number;
  pauseTenantOnViolation: boolean;
}

export interface TelephonyOutboundCompliancePolicy {
  dncPhoneNumbers: string[];
  timezone?: string | undefined;
  localTime?: string | undefined;
  override?: {
    reason: string;
    approvedByUserId: string;
  } | undefined;
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
  providerHeartbeats: TelephonyProviderHeartbeat[];
  dispatches: TelephonyDispatchRecord[];
  executionSessions: TelephonyExecutionSession[];
  executionCommands: TelephonyExecutionCommand[];
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
