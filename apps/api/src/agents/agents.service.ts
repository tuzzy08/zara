import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";

import {
  AGENTS_STATE_REPOSITORY,
  type AgentsStateRepository,
} from "./agents-state.repository";
import type {
  AgentsState,
  CreateReusableAgentInput,
  ListReusableAgentsInput,
  ReusableAgentRecord,
} from "./agents.models";

@Injectable()
export class AgentsService {
  constructor(
    @Inject(AGENTS_STATE_REPOSITORY)
    private readonly repository: AgentsStateRepository,
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
    const instructions = input.instructions.trim();
    const defaultLanguage = input.defaultLanguage.trim().toLowerCase();

    if (input.workspaceId.trim().length === 0) {
      throw new BadRequestException("Workspace is required.");
    }

    if (name.length === 0) {
      throw new BadRequestException("Agent name is required.");
    }

    if (instructions.length === 0) {
      throw new BadRequestException("Agent instructions are required.");
    }

    if (defaultLanguage.length === 0) {
      throw new BadRequestException("Default language is required.");
    }

    const state = await this.loadState(input.organizationId);
    const now = input.now ?? new Date().toISOString();
    const agent: ReusableAgentRecord = {
      id: `agent-${slugifyAgentName(name)}`,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId.trim(),
      name,
      agentClass: input.agentClass,
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

  private async loadState(organizationId: string): Promise<AgentsState> {
    const state = await this.repository.load(organizationId);

    return state ?? {
      schemaVersion: 1,
      organizationId,
      agents: [],
    };
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

function slugifyAgentName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "untitled";
}
