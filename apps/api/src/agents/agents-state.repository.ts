import { createTenantJsonStateRepository } from "../persistence/tenant-json-state.repository";
import type { AgentsState, ReusableAgentRecord, ReusableAgentRuntimeProfile } from "./agents.models";

export const AGENTS_STATE_REPOSITORY = Symbol("AGENTS_STATE_REPOSITORY");

export interface AgentsStateRepository {
  load(organizationId: string): AgentsState | null | Promise<AgentsState | null>;
  save(record: AgentsState): void | Promise<void>;
}

export class FileAgentsStateRepository implements AgentsStateRepository {
  private readonly repository;

  constructor(directoryPath: string) {
    this.repository = createTenantJsonStateRepository<AgentsState>({
      directoryPath,
      validate: isAgentsState,
      normalize: normalizeAgentsState,
      trailingNewline: true,
    });
  }

  load(organizationId: string) {
    return this.repository.load(organizationId);
  }

  save(record: AgentsState) {
    this.repository.save(record);
  }
}

function normalizeAgentsState(record: AgentsState): AgentsState {
  return {
    schemaVersion: 1,
    organizationId: record.organizationId,
    agents: record.agents.map((agent) => ({
      ...agent,
      toolbeltAssignments: agent.toolbeltAssignments.map((assignment) => ({ ...assignment })),
    })),
  };
}

function isAgentsState(value: unknown, organizationId: string): value is AgentsState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<AgentsState>;
  return record.schemaVersion === 1
    && record.organizationId === organizationId
    && Array.isArray(record.agents)
    && record.agents.every((agent) => isReusableAgentRecord(agent, organizationId));
}

function isReusableAgentRecord(value: unknown, organizationId: string): value is ReusableAgentRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<ReusableAgentRecord>;
  return typeof record.id === "string"
    && record.organizationId === organizationId
    && typeof record.workspaceId === "string"
    && typeof record.name === "string"
    && typeof record.businessName === "string"
    && isReusableAgentClass(record.agentClass)
    && typeof record.instructions === "string"
    && typeof record.defaultLanguage === "string"
    && isReusableAgentRuntimeProfile(record.runtimeProfile)
    && Array.isArray(record.toolbeltAssignments)
    && record.toolbeltAssignments.every(isReusableAgentToolbeltAssignment)
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string"
    && typeof record.createdBy === "string"
    && typeof record.updatedBy === "string";
}

function isReusableAgentClass(value: unknown) {
  return value === "receptionist"
    || value === "support-specialist"
    || value === "sales-specialist"
    || value === "scheduler"
    || value === "billing-specialist";
}

function isReusableAgentRuntimeProfile(value: unknown): value is ReusableAgentRuntimeProfile {
  return value === "cost-optimized" || value === "premium-realtime";
}

function isReusableAgentToolbeltAssignment(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<ReusableAgentRecord["toolbeltAssignments"][number]>;
  return typeof record.id === "string"
    && typeof record.toolId === "string"
    && (record.connector === "zendesk"
      || record.connector === "hubspot"
      || record.connector === "google-workspace"
      || record.connector === "notion"
      || record.connector === "salesforce"
      || record.connector === "slack"
      || record.connector === "microsoft-365"
      || record.connector === "intercom"
      || record.connector === "shopify"
      || record.connector === "stripe"
      || record.connector === "webhook"
      || record.connector === "internal")
    && typeof record.toolName === "string"
    && (record.integrationConnectionId === undefined || typeof record.integrationConnectionId === "string")
    && (record.integrationLabel === undefined || typeof record.integrationLabel === "string")
    && (record.connectionStatus === "connected"
      || record.connectionStatus === "missing"
      || record.connectionStatus === "revoked")
    && typeof record.label === "string"
    && typeof record.description === "string"
    && typeof record.whenToUse === "string"
    && (record.risk === "low" || record.risk === "medium" || record.risk === "high")
    && typeof record.requiresAuthorization === "boolean"
    && typeof record.requiresHumanApproval === "boolean";
}
