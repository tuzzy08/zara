import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CompiledRuntimeManifest, CompiledRuntimeToolBinding } from "@zara/core";

import type {
  GrantToolPermissionRequest,
  ToolPermissionGrantResponse,
} from "./integrations.models";
import {
  INTEGRATION_STATE_REPOSITORY,
  type IntegrationStateRepository,
  type PersistedIntegrationStateRecord,
} from "./integrations-state.repository";

export interface ToolPermissionDecision {
  allowed: boolean;
  approvalRequired: boolean;
  reason: "granted" | "not_required" | "tool_permission_denied" | "integration_connection_revoked";
}

@Injectable()
export class ToolPermissionGrantsService {
  constructor(
    @Inject(INTEGRATION_STATE_REPOSITORY)
    private readonly stateRepository: IntegrationStateRepository,
  ) {}

  async grantToolPermission(
    organizationId: string,
    input: GrantToolPermissionRequest,
  ): Promise<ToolPermissionGrantResponse> {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new ForbiddenException("Tenant admin access is required to grant tool permissions.");
    }

    const state = await this.loadState(organizationId);
    const grant: ToolPermissionGrantResponse = {
      id: `tool_grant_${organizationId}_${state.toolGrants.length + 1}`,
      organizationId,
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
      toolId: input.toolId,
      integrationConnectionId: input.integrationConnectionId,
      risk: input.risk,
      approvalRequired: input.approvalRequired,
      status: "active",
      grantedBy: input.actorUserId,
      createdAt: input.now ?? new Date().toISOString(),
    };

    state.toolGrants = [
      grant,
      ...state.toolGrants.filter(
        (candidate) =>
          candidate.workspaceId !== grant.workspaceId
          || candidate.workflowId !== grant.workflowId
          || candidate.roleId !== grant.roleId
          || candidate.toolId !== grant.toolId
          || candidate.integrationConnectionId !== grant.integrationConnectionId,
      ),
    ];
    await this.saveState(state);

    return cloneGrant(grant);
  }

  async listToolPermissionGrants(input: {
    organizationId: string;
    workspaceId?: string | undefined;
    workflowId?: string | undefined;
  }): Promise<ToolPermissionGrantResponse[]> {
    const state = await this.loadState(input.organizationId);

    return state.toolGrants
      .filter((grant) => grant.status === "active")
      .filter((grant) => input.workspaceId === undefined || grant.workspaceId === input.workspaceId)
      .filter((grant) => input.workflowId === undefined || grant.workflowId === input.workflowId)
      .map(cloneGrant);
  }

  async evaluateToolExecution(input: {
    organizationId: string;
    workspaceId: string;
    activeRoleId: string;
    manifest: CompiledRuntimeManifest;
    binding: CompiledRuntimeToolBinding;
  }): Promise<ToolPermissionDecision> {
    void input.organizationId;
    void input.workspaceId;
    void input.activeRoleId;
    void input.manifest;

    if (input.binding.integrationConnectionId === undefined) {
      return {
        allowed: true,
        approvalRequired: input.binding.requiresHumanApproval,
        reason: "not_required",
      };
    }

    const state = await this.loadState(input.organizationId);
    const connection = state.connections.find(
      (candidate) => candidate.id === input.binding.integrationConnectionId,
    );

    if (connection?.status === "revoked") {
      return {
        allowed: false,
        approvalRequired: false,
        reason: "integration_connection_revoked",
      };
    }

    const matchingGrant = state.toolGrants.find(
      (grant) =>
        grant.status === "active"
        && grant.workspaceId === input.workspaceId
        && grant.workflowId === input.manifest.publishedVersionId
        && grant.toolId === input.binding.toolId
        && grant.integrationConnectionId === input.binding.integrationConnectionId
        && (grant.roleId === undefined || grant.roleId === input.activeRoleId),
    );

    if (matchingGrant !== undefined) {
      return {
        allowed: true,
        approvalRequired: matchingGrant.approvalRequired,
        reason: "granted",
      };
    }

    return {
      allowed: false,
      approvalRequired: false,
      reason: "tool_permission_denied",
    };
  }

  private async loadState(organizationId: string): Promise<PersistedIntegrationStateRecord & {
    toolGrants: ToolPermissionGrantResponse[];
  }> {
    const persistedState = await this.stateRepository.load(organizationId);

    if (persistedState === null) {
      return {
        schemaVersion: 1,
        organizationId,
        pendingConnects: [],
        connections: [],
        credentials: [],
        toolGrants: [],
      };
    }

    return {
      ...persistedState,
      pendingConnects: [...persistedState.pendingConnects],
      connections: persistedState.connections.map((connection) => ({
        ...connection,
        scopes: [...connection.scopes],
        credentialReference: { ...connection.credentialReference },
      })),
      credentials: [...persistedState.credentials],
      toolGrants: (persistedState.toolGrants ?? []).map(cloneGrant),
    };
  }

  private async saveState(state: PersistedIntegrationStateRecord & {
    toolGrants: ToolPermissionGrantResponse[];
  }) {
    await this.stateRepository.save({
      ...state,
      toolGrants: state.toolGrants.map(cloneGrant),
    });
  }
}

function cloneGrant(grant: ToolPermissionGrantResponse): ToolPermissionGrantResponse {
  return {
    ...grant,
  };
}
