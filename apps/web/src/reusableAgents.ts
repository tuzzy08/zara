import { requestJson } from "./apiClient";

export type ReusableAgentRuntimeProfile = "cost-optimized" | "premium-realtime";

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

export interface ReusableAgent {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  agentClass: string;
  instructions: string;
  defaultLanguage: string;
  runtimeProfile: ReusableAgentRuntimeProfile;
  toolbeltAssignments: ReusableAgentToolbeltAssignment[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export async function fetchReusableAgents(input: {
  organizationId: string;
  workspaceId: string;
}): Promise<ReusableAgent[]> {
  const response = await requestJson<{ agents: ReusableAgent[] }>(
    `/organizations/${input.organizationId}/agents?workspaceId=${encodeURIComponent(input.workspaceId)}`,
  );

  return response.agents;
}

export async function createReusableAgent(input: {
  organizationId: string;
  workspaceId: string;
  name: string;
  agentClass: string;
  instructions: string;
  defaultLanguage: string;
  runtimeProfile: ReusableAgentRuntimeProfile;
}): Promise<ReusableAgent> {
  const response = await requestJson<{ agent: ReusableAgent }>(
    `/organizations/${input.organizationId}/agents`,
    {
      method: "POST",
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        name: input.name,
        agentClass: input.agentClass,
        instructions: input.instructions,
        defaultLanguage: input.defaultLanguage,
        runtimeProfile: input.runtimeProfile,
      }),
    },
  );

  return response.agent;
}

export async function updateReusableAgentToolbelt(input: {
  organizationId: string;
  workspaceId: string;
  agentId: string;
  assignments: ReusableAgentToolbeltAssignment[];
}): Promise<ReusableAgent> {
  const response = await requestJson<{ agent: ReusableAgent }>(
    `/organizations/${input.organizationId}/agents/${input.agentId}/toolbelt`,
    {
      method: "PUT",
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        assignments: input.assignments,
      }),
    },
  );

  return response.agent;
}
