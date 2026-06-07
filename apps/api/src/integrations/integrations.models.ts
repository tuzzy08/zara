export type IntegrationProvider =
  | "zendesk"
  | "hubspot"
  | "google-workspace"
  | "notion"
  | "salesforce"
  | "slack"
  | "microsoft-365"
  | "webhook-http";
export type IntegrationActorRole = "owner" | "admin" | "builder" | "operator" | "viewer";
export type IntegrationConnectionScope = "organization" | "workspace";
export type IntegrationCapabilityGrant = "agent-tool" | "knowledge-source" | "post-call-sync";

export type IntegrationConnectionAvailability =
  | {
      scope: "organization";
    }
  | {
      scope: "workspace";
      workspaceId: string;
    };

export interface StartOAuthConnectRequest {
  actorUserId: string;
  actorRole?: IntegrationActorRole | undefined;
  redirectUri: string;
  requestedScopes?: string[] | undefined;
  connectionScope?: IntegrationConnectionScope | undefined;
  workspaceId?: string | undefined;
  reconnectConnectionId?: string | undefined;
  stateTtlSeconds?: number | undefined;
  now?: string | undefined;
}

export interface PendingOAuthConnectResponse {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  actorUserId: string;
  authorizationUrl: string;
  requestedScopes: string[];
  availability: IntegrationConnectionAvailability;
  status: "pending";
  expiresAt: string;
}

export interface IntegrationCredentialReference {
  id: string;
  provider: IntegrationProvider;
  kind: "oauth-token" | "api-token";
  preview: string;
}

export interface IntegrationConnectionHealth {
  status: "unknown" | "healthy" | "degraded" | "unhealthy" | "revoked";
  checkedAt?: string | undefined;
  message?: string | undefined;
}

export interface IntegrationConnectionAuditEvent {
  id: string;
  action:
    | "connected"
    | "health_checked"
    | "revoked"
    | "reconnect_started"
    | "reconnected"
    | "configured"
    | "promoted_to_organization";
  actorUserId: string;
  actorRole?: IntegrationActorRole | undefined;
  at: string;
  workspaceId?: string | undefined;
  priorConnectionId?: string | undefined;
  reason?: string | undefined;
  healthStatus?: IntegrationConnectionHealth["status"] | undefined;
}

export interface IntegrationConnectionResponse {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  status: "connected" | "revoked";
  connectedBy: string;
  scopes: string[];
  availability: IntegrationConnectionAvailability;
  credentialReference: IntegrationCredentialReference;
  accountLabel?: string | undefined;
  connectedAt: string;
  reconnectOfConnectionId?: string | undefined;
  revokedBy?: string | undefined;
  revokedAt?: string | undefined;
  revocationReason?: string | undefined;
  health: IntegrationConnectionHealth;
  auditEvents: IntegrationConnectionAuditEvent[];
}

export interface CheckIntegrationConnectionHealthRequest {
  actorUserId: string;
  actorRole?: IntegrationActorRole | undefined;
  now?: string | undefined;
}

export interface RevokeIntegrationConnectionRequest {
  actorUserId: string;
  actorRole?: IntegrationActorRole | undefined;
  reason?: string | undefined;
  now?: string | undefined;
}

export interface DeleteIntegrationConnectionRequest {
  actorUserId: string;
  actorRole?: IntegrationActorRole | undefined;
  reason?: string | undefined;
  now?: string | undefined;
}

export interface PromoteIntegrationConnectionRequest {
  actorUserId: string;
  actorRole?: IntegrationActorRole | undefined;
  workspaceId: string;
  reason: string;
  now?: string | undefined;
}

export interface ConfigureZendeskApiTokenRequest {
  actorUserId: string;
  actorRole?: IntegrationActorRole | undefined;
  subdomain: string;
  email: string;
  apiToken: string;
  connectionScope?: IntegrationConnectionScope | undefined;
  workspaceId?: string | undefined;
  now?: string | undefined;
}

export type SlackDestinationPurpose = "escalation" | "alert" | "post-call-summary";

export interface SlackDestinationConfig {
  id: string;
  label: string;
  channelId: string;
  channelName: string;
  purpose: SlackDestinationPurpose;
}

export interface ConfigureSlackDestinationsRequest {
  actorUserId: string;
  actorRole: IntegrationActorRole;
  connectionId: string;
  destinations: SlackDestinationConfig[];
}

export interface GrantToolPermissionRequest {
  actorUserId: string;
  actorRole?: IntegrationActorRole | undefined;
  capability?: IntegrationCapabilityGrant | undefined;
  workspaceId: string;
  workflowId: string;
  roleId?: string | undefined;
  toolId: string;
  integrationConnectionId: string;
  risk: "low" | "medium" | "high";
  approvalRequired: boolean;
  now?: string | undefined;
}

export interface ToolPermissionGrantResponse {
  id: string;
  organizationId: string;
  capability: IntegrationCapabilityGrant;
  workspaceId: string;
  workflowId: string;
  roleId?: string | undefined;
  toolId: string;
  integrationConnectionId: string;
  risk: "low" | "medium" | "high";
  requiredScopes: string[];
  approvalRequired: boolean;
  status: "active" | "paused" | "revoked";
  pausedAt?: string | undefined;
  pausedReason?: "integration_connection_revoked" | undefined;
  grantedBy: string;
  createdAt: string;
}

export interface WebhookHttpRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface CreateWebhookHttpToolRequest {
  actorUserId: string;
  actorRole?: "owner" | "admin" | "builder" | "operator" | "viewer" | undefined;
  workspaceId: string;
  toolName: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: { name: string; value: string }[] | undefined;
  bodyTemplate?: string | undefined;
  authToken?: string | undefined;
  timeoutMs: number;
  retryPolicy: WebhookHttpRetryPolicy;
  now?: string | undefined;
}

export interface WebhookHttpToolResponse {
  id: string;
  organizationId: string;
  workspaceId: string;
  provider: "webhook-http";
  toolId: string;
  toolName: string;
  createdBy: string;
  createdAt: string;
  request: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    headers: { name: string; value: string }[];
    bodyTemplate?: string | undefined;
    authTokenReference?: string | undefined;
    timeoutMs: number;
    retryPolicy: WebhookHttpRetryPolicy;
  };
}

export interface ConnectorToolSchemaResponse {
  provider: Exclude<IntegrationProvider, "webhook-http">;
  toolId: string;
  description: string;
  requiredScopes: string[];
  inputSchema: {
    type: "object";
    required: string[];
    properties: Record<string, { type: "string" | "number" | "boolean"; enum?: string[] | undefined }>;
  };
}

export interface ExecuteConnectorToolRequest {
  connectionId: string;
  idempotencyKey?: string | undefined;
  input?: Record<string, unknown> | undefined;
}
