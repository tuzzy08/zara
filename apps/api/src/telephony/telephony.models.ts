import type {
  ImportedTelephonyPhoneNumber,
  InboundCallResolution,
  TelephonyConnection,
  TelephonyHealthStatus,
} from "@zara/core";

export interface TelephonyHealthCheck {
  id: string;
  connectionId: string;
  status: TelephonyHealthStatus;
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
