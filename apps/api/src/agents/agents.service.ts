import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { ToolPermissionGrantsService } from "../integrations/tool-permission-grants.service";
import { RuntimePromptPolicyService } from "../runtime-prompt-policy/runtime-prompt-policy.service";
import {
  AGENTS_STATE_REPOSITORY,
  type AgentsStateRepository,
} from "./agents-state.repository";
import type {
  AgentsState,
  CreateReusableAgentInput,
  ListReusableAgentsInput,
  ReusableAgentRecord,
  ReusableAgentToolbeltAssignment,
  UpdateReusableAgentToolbeltInput,
} from "./agents.models";

@Injectable()
export class AgentsService {
  constructor(
    @Inject(AGENTS_STATE_REPOSITORY)
    private readonly repository: AgentsStateRepository,
    private readonly toolPermissionGrantsService: ToolPermissionGrantsService,
    private readonly runtimePromptPolicyService: RuntimePromptPolicyService,
  ) {}

  async listReusableAgents(input: ListReusableAgentsInput): Promise<ReusableAgentRecord[]> {
    if (input.workspaceId.trim().length === 0) {
      throw new BadRequestException("Workspace is required.");
    }

    const state = await this.loadState(input.organizationId);

    return state.agents
      .filter((agent) => agent.workspaceId === input.workspaceId)
      .map(cloneReusableAgent)
      .sort((left, right) => left.name.localeCompare(right.name) || left.createdAt.localeCompare(right.createdAt));
  }

  async createReusableAgent(input: CreateReusableAgentInput): Promise<ReusableAgentRecord> {
    authorizeBuilder(input.actorRole);
    const name = input.name.trim();
    const businessName = input.businessName.trim();
    const instructions = input.instructions.trim();
    const defaultLanguage = input.defaultLanguage.trim().toLowerCase();
    const agentClass = input.agentClass.trim().toLowerCase();

    if (input.workspaceId.trim().length === 0) {
      throw new BadRequestException("Workspace is required.");
    }

    if (name.length === 0) {
      throw new BadRequestException("Agent name is required.");
    }

    if (businessName.length === 0) {
      throw new BadRequestException("Business name is required.");
    }

    if (instructions.length === 0) {
      throw new BadRequestException("Agent instructions are required.");
    }

    if (defaultLanguage.length === 0) {
      throw new BadRequestException("Default language is required.");
    }

    await this.assertAgentClassExists(agentClass);

    const state = await this.loadState(input.organizationId);
    const now = input.now ?? new Date().toISOString();
    const agent: ReusableAgentRecord = {
      id: `agent-${slugifyAgentName(name)}`,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId.trim(),
      name,
      businessName,
      agentClass,
      instructions,
      defaultLanguage,
      runtimeProfile: input.runtimeProfile,
      toolbeltAssignments: [],
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    };

    state.agents = [
      agent,
      ...state.agents.filter(
        (candidate) =>
          candidate.workspaceId !== agent.workspaceId
          || candidate.id !== agent.id,
      ),
    ];
    await this.repository.save(state);

    return cloneReusableAgent(agent);
  }

  async listAgentClasses() {
    return this.runtimePromptPolicyService.listAgentClasses();
  }

  async replaceReusableAgentToolbelt(input: UpdateReusableAgentToolbeltInput): Promise<ReusableAgentRecord> {
    authorizeBuilder(input.actorRole);
    const workspaceId = input.workspaceId.trim();

    if (workspaceId.length === 0) {
      throw new BadRequestException("Workspace is required.");
    }

    const state = await this.loadState(input.organizationId);
    const agentIndex = state.agents.findIndex(
      (agent) =>
        agent.organizationId === input.organizationId
        && agent.workspaceId === workspaceId
        && agent.id === input.agentId,
    );

    if (agentIndex === -1) {
      throw new NotFoundException("Reusable agent was not found.");
    }
    const existingAgent = state.agents[agentIndex];
    if (existingAgent === undefined) {
      throw new NotFoundException("Reusable agent was not found.");
    }

    const toolbeltAssignments = await this.normalizeToolbeltAssignments({
      organizationId: input.organizationId,
      workspaceId,
      assignments: input.assignments,
    });
    const now = input.now ?? new Date().toISOString();
    const agent: ReusableAgentRecord = {
      ...existingAgent,
      toolbeltAssignments,
      updatedAt: now,
      updatedBy: input.actorUserId,
    };

    state.agents = state.agents.map((candidate, index) => (index === agentIndex ? agent : candidate));
    await this.repository.save(state);

    return cloneReusableAgent(agent);
  }

  private async loadState(organizationId: string): Promise<AgentsState> {
    const state = await this.repository.load(organizationId);

    return state ?? {
      schemaVersion: 1,
      organizationId,
      agents: [],
    };
  }

  private async assertAgentClassExists(agentClass: string) {
    if (!/^[a-z][a-z0-9-]{1,63}$/u.test(agentClass)) {
      throw new BadRequestException("Agent class is invalid.");
    }

    const policy = await this.runtimePromptPolicyService.getPromptPolicy();

    if (policy.agentClassTemplates[agentClass] === undefined) {
      throw new BadRequestException("Agent class is not available.");
    }
  }

  private async normalizeToolbeltAssignments(input: {
    organizationId: string;
    workspaceId: string;
    assignments: ReusableAgentToolbeltAssignment[];
  }) {
    if (!Array.isArray(input.assignments)) {
      throw new BadRequestException("Toolbelt assignments are required.");
    }

    const assignmentIds = new Set<string>();
    const assignments: ReusableAgentToolbeltAssignment[] = [];

    for (const assignment of input.assignments) {
      const normalized = normalizeToolbeltAssignment(assignment);

      if (assignmentIds.has(normalized.id)) {
        throw new BadRequestException("Toolbelt assignment IDs must be unique.");
      }
      assignmentIds.add(normalized.id);

      if (normalized.requiresAuthorization) {
        if (normalized.integrationConnectionId === undefined) {
          throw new BadRequestException("Integration connection is required for this tool.");
        }

        const validation = await this.toolPermissionGrantsService.validateReusableAgentToolbeltAssignment({
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          connector: normalized.connector,
          toolId: normalized.toolId,
          integrationConnectionId: normalized.integrationConnectionId,
        });

        assignments.push({
          ...normalized,
          integrationLabel: validation.integrationLabel,
          connectionStatus: validation.connectionStatus,
        });
        continue;
      }

      assignments.push({
        ...normalized,
        connectionStatus: "connected",
      });
    }

    return assignments;
  }
}

function authorizeBuilder(role: CreateReusableAgentInput["actorRole"]) {
  if (role !== "owner" && role !== "admin" && role !== "builder") {
    throw new ForbiddenException("Builder access is required to manage reusable agents.");
  }
}

function cloneReusableAgent(agent: ReusableAgentRecord): ReusableAgentRecord {
  return {
    ...agent,
    toolbeltAssignments: agent.toolbeltAssignments.map((assignment) => ({ ...assignment })),
  };
}

function normalizeToolbeltAssignment(assignment: ReusableAgentToolbeltAssignment): ReusableAgentToolbeltAssignment {
  if (typeof assignment !== "object" || assignment === null) {
    throw new BadRequestException("Toolbelt assignment is invalid.");
  }

  const requiresAuthorization = requireBoolean(
    assignment.requiresAuthorization,
    "Tool authorization posture is required.",
  );
  const requiresHumanApproval = requireBoolean(
    assignment.requiresHumanApproval,
    "Tool approval posture is required.",
  );
  const normalized: ReusableAgentToolbeltAssignment = {
    id: requireNonEmptyString(assignment.id, "Toolbelt assignment ID is required."),
    toolId: requireNonEmptyString(assignment.toolId, "Tool ID is required."),
    connector: assignment.connector,
    toolName: requireNonEmptyString(assignment.toolName, "Tool name is required."),
    ...(assignment.integrationConnectionId !== undefined
      ? { integrationConnectionId: requireNonEmptyString(assignment.integrationConnectionId, "Integration connection is required for this tool.") }
      : {}),
    ...(assignment.integrationLabel !== undefined
      ? { integrationLabel: requireNonEmptyString(assignment.integrationLabel, "Integration label is required.") }
      : {}),
    connectionStatus: isConnectionStatus(assignment.connectionStatus)
      ? assignment.connectionStatus
      : requiresAuthorization ? "missing" : "connected",
    label: requireNonEmptyString(assignment.label, "Toolbelt label is required."),
    description: requireNonEmptyString(assignment.description, "Toolbelt description is required."),
    whenToUse: requireNonEmptyString(assignment.whenToUse, "Toolbelt usage guidance is required."),
    risk: assignment.risk,
    requiresAuthorization,
    requiresHumanApproval,
  };

  if (!isReusableAgentToolConnector(normalized.connector)) {
    throw new BadRequestException("Tool connector is invalid.");
  }

  if (!isRisk(normalized.risk)) {
    throw new BadRequestException("Tool risk is invalid.");
  }

  return normalized;
}

function requireNonEmptyString(value: unknown, message: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(message);
  }

  return value.trim();
}

function requireBoolean(value: unknown, message: string) {
  if (typeof value !== "boolean") {
    throw new BadRequestException(message);
  }

  return value;
}

function isReusableAgentToolConnector(value: unknown): value is ReusableAgentToolbeltAssignment["connector"] {
  return value === "zendesk"
    || value === "hubspot"
    || value === "google-workspace"
    || value === "notion"
    || value === "salesforce"
    || value === "slack"
    || value === "microsoft-365"
    || value === "intercom"
    || value === "shopify"
    || value === "stripe"
    || value === "webhook"
    || value === "internal";
}

function isConnectionStatus(value: unknown): value is ReusableAgentToolbeltAssignment["connectionStatus"] {
  return value === "connected" || value === "missing" || value === "revoked";
}

function isRisk(value: unknown): value is ReusableAgentToolbeltAssignment["risk"] {
  return value === "low" || value === "medium" || value === "high";
}

function slugifyAgentName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "untitled";
}
