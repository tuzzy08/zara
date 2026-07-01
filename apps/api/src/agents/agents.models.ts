import type { RuntimeProfileId, TenantRole } from "@zara/core";

export type ReusableAgentClass = string;

export type ReusableAgentRuntimeProfile = Exclude<RuntimeProfileId, "balanced">;

export interface ReusableAgentToolbeltAssignment {
  id: string;
  toolId: string;
  connector:
    | "zendesk"
    | "hubspot"
    | "google-workspace"
    | "notion"
    | "salesforce"
    | "slack"
    | "microsoft-365"
    | "intercom"
    | "shopify"
    | "stripe"
    | "webhook"
    | "internal";
  toolName: string;
  integrationConnectionId?: string | undefined;
  integrationLabel?: string | undefined;
  connectionStatus: "connected" | "missing" | "revoked";
  label: string;
  description: string;
  whenToUse: string;
  risk: "low" | "medium" | "high";
  requiresAuthorization: boolean;
  requiresHumanApproval: boolean;
}

export interface ReusableAgentRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  businessName: string;
  agentClass: ReusableAgentClass;
  instructions: string;
  defaultLanguage: string;
  runtimeProfile: ReusableAgentRuntimeProfile;
  toolbeltAssignments: ReusableAgentToolbeltAssignment[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface AgentsState {
  schemaVersion: 1;
  organizationId: string;
  agents: ReusableAgentRecord[];
}

export interface CreateReusableAgentRequest {
  workspaceId: string;
  name: string;
  businessName: string;
  agentClass: ReusableAgentClass;
  instructions: string;
  defaultLanguage: string;
  runtimeProfile: ReusableAgentRuntimeProfile;
}

export interface UpdateReusableAgentToolbeltRequest {
  workspaceId: string;
  assignments: ReusableAgentToolbeltAssignment[];
}

export interface CreateReusableAgentInput extends CreateReusableAgentRequest {
  organizationId: string;
  actorRole: TenantRole;
  actorUserId: string;
  now?: string | undefined;
}

export interface UpdateReusableAgentToolbeltInput extends UpdateReusableAgentToolbeltRequest {
  organizationId: string;
  agentId: string;
  actorRole: TenantRole;
  actorUserId: string;
  now?: string | undefined;
}

export interface ListReusableAgentsInput {
  organizationId: string;
  workspaceId: string;
}
