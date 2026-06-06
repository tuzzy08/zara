import { requestJson } from "./apiClient";
import type { IntegrationProviderCatalogEntry, IntegrationProviderId } from "@zara/core";

export type IntegrationProvider = IntegrationProviderId;
export type IntegrationConnectionScope = "organization" | "workspace";
export type IntegrationCapabilityGrant = "agent-tool" | "knowledge-source" | "post-call-sync";

export type IntegrationConnectionAvailability =
  | { scope: "organization" }
  | { scope: "workspace"; workspaceId: string };

export interface IntegrationConnection {
  id: string;
  provider: IntegrationProvider;
  status: "connected" | "revoked";
  scopes: string[];
  availability: IntegrationConnectionAvailability;
  credentialReference: {
    kind?: "oauth-token" | "api-token";
    preview: string;
  };
  accountLabel?: string;
  connectedAt: string;
  health: {
    status: "unknown" | "healthy" | "degraded" | "unhealthy" | "revoked";
    checkedAt?: string;
    message?: string;
  };
  revocationReason?: string;
}

export interface ConnectorTool {
  provider: Exclude<IntegrationProvider, "webhook-http">;
  toolId: string;
  description: string;
  requiredScopes: string[];
}

export interface WebhookTool {
  id: string;
  toolName: string;
  workspaceId: string;
  request: {
    method: string;
    url: string;
    authTokenReference?: string;
  };
}

export interface ToolGrant {
  id: string;
  workspaceId: string;
  workflowId: string;
  capability?: IntegrationCapabilityGrant;
  toolId: string;
  integrationConnectionId: string;
  risk: "low" | "medium" | "high";
  requiredScopes?: string[];
  approvalRequired: boolean;
  status: "active" | "paused" | "revoked";
  pausedAt?: string;
  pausedReason?: string;
}

export async function fetchIntegrationConnections(organizationId: string, workspaceId?: string) {
  const query = workspaceId === undefined ? "" : `?workspaceId=${encodeURIComponent(workspaceId)}`;
  const response = await requestJson<{ connections: IntegrationConnection[] }>(
    `/organizations/${organizationId}/integrations/connections${query}`,
  );

  return response.connections;
}

export async function fetchIntegrationCatalog(organizationId: string) {
  const response = await requestJson<{ catalog: { providers: IntegrationProviderCatalogEntry[] } }>(
    `/organizations/${organizationId}/integrations/catalog`,
  );

  return response.catalog.providers;
}

export async function fetchConnectorTools(
  organizationId: string,
  provider: Exclude<IntegrationProvider, "webhook-http">,
) {
  const response = await requestJson<{ tools: ConnectorTool[] }>(
    `/organizations/${organizationId}/integrations/connectors/${provider}/tools`,
  );

  return response.tools;
}

export async function fetchWebhookTools(organizationId: string, workspaceId: string) {
  const response = await requestJson<{ webhookTools: WebhookTool[] }>(
    `/organizations/${organizationId}/integrations/webhook-tools?workspaceId=${encodeURIComponent(workspaceId)}`,
  );

  return response.webhookTools;
}

export async function fetchToolGrants(organizationId: string, workspaceId: string) {
  const response = await requestJson<{ grants: ToolGrant[] }>(
    `/organizations/${organizationId}/integrations/tool-grants?workspaceId=${encodeURIComponent(workspaceId)}`,
  );

  return response.grants;
}

export async function grantIntegrationCapability(
  organizationId: string,
  input: {
    workspaceId: string;
    workflowId: string;
    capability: IntegrationCapabilityGrant;
    toolId: string;
    integrationConnectionId: string;
    risk: ToolGrant["risk"];
    approvalRequired: boolean;
  },
) {
  const response = await requestJson<{ grant: ToolGrant }>(
    `/organizations/${organizationId}/integrations/tool-grants`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        capability: input.capability,
        toolId: input.toolId,
        integrationConnectionId: input.integrationConnectionId,
        risk: input.risk,
        approvalRequired: input.approvalRequired,
      }),
    },
  );

  return response.grant;
}

export async function startIntegrationConnect(
  organizationId: string,
  provider: IntegrationProvider,
  input: {
    connectionScope: IntegrationConnectionScope;
    workspaceId?: string;
    reconnectConnectionId?: string;
    requestedScopes?: string[];
  },
) {
  const response = await requestJson<{ connect: { authorizationUrl: string } }>(
    `/organizations/${organizationId}/integrations/${provider}/connect`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: `${window.location.origin}/integrations`,
        requestedScopes: mergeRequestedScopes(defaultScopesForProvider(provider), input.requestedScopes),
        connectionScope: input.connectionScope,
        ...(input.connectionScope === "workspace" && input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
        ...(input.reconnectConnectionId !== undefined ? { reconnectConnectionId: input.reconnectConnectionId } : {}),
      }),
    },
  );

  return response.connect;
}

export async function configureZendeskIntegration(
  organizationId: string,
  input: {
    subdomain: string;
    email: string;
    apiToken: string;
    connectionScope: IntegrationConnectionScope;
    workspaceId?: string;
  },
) {
  const response = await requestJson<{ connection: IntegrationConnection }>(
    `/organizations/${organizationId}/integrations/zendesk/configure`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        subdomain: input.subdomain,
        email: input.email,
        apiToken: input.apiToken,
        connectionScope: input.connectionScope,
        ...(input.connectionScope === "workspace" && input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      }),
    },
  );

  return response.connection;
}

export async function checkIntegrationHealth(organizationId: string, connectionId: string) {
  const response = await requestJson<{ connection: IntegrationConnection }>(
    `/organizations/${organizationId}/integrations/connections/${connectionId}/health-check`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
      }),
    },
  );

  return response.connection;
}

export async function revokeIntegrationConnection(organizationId: string, connectionId: string) {
  const response = await requestJson<{ connection: IntegrationConnection }>(
    `/organizations/${organizationId}/integrations/connections/${connectionId}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        reason: "Revoked from tenant integrations page.",
      }),
    },
  );

  return response.connection;
}

export async function promoteIntegrationConnection(
  organizationId: string,
  connectionId: string,
  input: {
    workspaceId: string;
    reason: string;
  },
) {
  const response = await requestJson<{ connection: IntegrationConnection }>(
    `/organizations/${organizationId}/integrations/connections/${connectionId}/promote`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: input.workspaceId,
        reason: input.reason,
      }),
    },
  );

  return response.connection;
}

function mergeRequestedScopes(defaultScopes: string[], requestedScopes: string[] | undefined) {
  return Array.from(new Set([...defaultScopes, ...(requestedScopes ?? [])]));
}

function defaultScopesForProvider(provider: IntegrationProvider) {
  switch (provider) {
    case "zendesk":
      return ["tickets:read", "tickets:write"];
    case "hubspot":
      return ["crm.objects.contacts.read", "crm.objects.contacts.write"];
    case "google-workspace":
      return ["calendar.events"];
    case "notion":
      return ["pages:read", "pages:write"];
    case "webhook-http":
      return [];
    case "salesforce":
      return ["api", "refresh_token"];
    case "slack":
      return ["chat:write"];
  }
}
