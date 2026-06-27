import type { RuntimeProfileId, TenantRole } from "@zara/core";

export type ReusableAgentClass =
  | "receptionist"
  | "support-specialist"
  | "sales-specialist"
  | "scheduler"
  | "billing-specialist";

export type ReusableAgentRuntimeProfile = Exclude<RuntimeProfileId, "balanced">;

export interface ReusableAgentToolbeltAssignment {
  id: string;
  toolId: string;
  integrationConnectionId: string;
  label: string;
  description: string;
  whenToUse: string;
  risk: "low" | "medium" | "high";
  requiresHumanApproval: boolean;
}

export interface ReusableAgentRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
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
  agentClass: ReusableAgentClass;
  instructions: string;
  defaultLanguage: string;
  runtimeProfile: ReusableAgentRuntimeProfile;
}

export interface CreateReusableAgentInput extends CreateReusableAgentRequest {
  organizationId: string;
  actorRole: TenantRole;
  actorUserId: string;
  now?: string | undefined;
}

export interface ListReusableAgentsInput {
  organizationId: string;
  workspaceId: string;
}
