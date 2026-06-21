import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import {
  getIntegrationProviderCatalogEntry,
  type CompiledRuntimeManifest,
  type CompiledRuntimeToolBinding,
} from "@zara/core";

import type {
  GrantToolPermissionRequest,
  IntegrationConnectionResponse,
  ToolPermissionGrantResponse,
} from "./integrations.models";
import { getConnectorToolSchemaById } from "./connector-tools.service";
import {
  INTEGRATION_STATE_REPOSITORY,
  type IntegrationStateRepository,
  type PersistedIntegrationStateRecord,
} from "./integrations-state.repository";

export interface ToolPermissionDecision {
  allowed: boolean;
  approvalRequired: boolean;
  reason:
    | "granted"
    | "not_required"
    | "tool_permission_denied"
    | "integration_connection_revoked"
    | "integration_connection_unavailable"
    | "integration_connection_missing_scopes";
  missingScopes?: string[] | undefined;
}

export interface ToolGrantPublishValidationError {
  code:
    | "tool_permission_denied"
    | "integration_connection_revoked"
    | "integration_connection_unavailable"
    | "integration_connection_missing_scopes";
  nodeId: string;
  toolId: string;
  integrationConnectionId: string;
  message: string;
  missingScopes?: string[] | undefined;
  missingRoleIds?: string[] | undefined;
}

export interface ToolGrantPublishValidationResult {
  ok: boolean;
  errors: ToolGrantPublishValidationError[];
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
    const connection = state.connections.find(
      (candidate) => candidate.id === input.integrationConnectionId,
    );
    const toolSchema = getConnectorToolSchemaById(input.toolId);

    if (connection === undefined) {
      throw new BadRequestException("Integration connection was not found.");
    }

    if (connection.status === "revoked") {
      throw new BadRequestException("Integration connection has been revoked.");
    }

    if (getConnectionAvailability(connection) === undefined) {
      throw new BadRequestException(
        "Integration connection is missing scope metadata. Reconnect this provider before enabling tool access.",
      );
    }

    if (!isConnectionAvailableInWorkspace(connection, input.workspaceId)) {
      throw new BadRequestException("Integration connection is not available to this workspace.");
    }

    if (toolSchema === undefined) {
      throw new BadRequestException("Connector tool is not supported by the provider catalog.");
    }

    if (connection.provider !== toolSchema.provider) {
      throw new BadRequestException("Integration connection provider does not match the requested tool.");
    }

    const capability = input.capability ?? "agent-tool";
    if (!isCapabilitySupportedByProvider(connection.provider, capability)) {
      throw new BadRequestException("Integration provider does not support this capability.");
    }

    const missingScopes = getMissingScopes(connection.scopes, toolSchema.requiredScopes);
    if (missingScopes.length > 0) {
      throw new BadRequestException({
        message: `Integration connection is missing required scope: ${missingScopes.join(", ")}`,
        reconnect: {
          provider: connection.provider,
          connectionId: connection.id,
          missingScopes,
        },
      });
    }

    const grant: ToolPermissionGrantResponse = {
      id: `tool_grant_${organizationId}_${state.toolGrants.length + 1}`,
      organizationId,
      capability,
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
      toolId: input.toolId,
      integrationConnectionId: input.integrationConnectionId,
      risk: input.risk,
      requiredScopes: toolSchema.requiredScopes,
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
          || candidate.capability !== grant.capability
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
      .filter((grant) => grant.status !== "revoked")
      .filter((grant) => input.workspaceId === undefined || grant.workspaceId === input.workspaceId)
      .filter((grant) => input.workflowId === undefined || grant.workflowId === input.workflowId)
      .map(cloneGrant);
  }

  async validateToolGrantsForPublish(input: {
    organizationId: string;
    workspaceId: string;
    manifest: Pick<CompiledRuntimeManifest, "publishedVersionId" | "workflowId" | "toolBindings" | "agentToolAssignments">;
  }): Promise<ToolGrantPublishValidationResult> {
    const state = await this.loadState(input.organizationId);
    const errors: ToolGrantPublishValidationError[] = [];
    const workflowGrantIds = resolveManifestWorkflowGrantIds(input.manifest);

    for (const binding of input.manifest.toolBindings) {
      if (binding.integrationConnectionId === undefined) {
        continue;
      }

      const connection = state.connections.find(
        (candidate) => candidate.id === binding.integrationConnectionId,
      );
      const baseError = {
        nodeId: binding.nodeId,
        toolId: binding.toolId,
        integrationConnectionId: binding.integrationConnectionId,
      };

      if (connection === undefined) {
        errors.push({
          ...baseError,
          code: "tool_permission_denied",
          message: "Integration connection was not found for this tool grant.",
        });
        continue;
      }

      if (connection.status === "revoked") {
        errors.push({
          ...baseError,
          code: "integration_connection_revoked",
          message: "Integration connection has been revoked.",
        });
        continue;
      }

      if (getConnectionAvailability(connection) === undefined) {
        errors.push({
          ...baseError,
          code: "integration_connection_unavailable",
          message: "Integration connection is missing scope metadata. Reconnect this provider before publishing.",
        });
        continue;
      }

      if (!isConnectionAvailableInWorkspace(connection, input.workspaceId)) {
        errors.push({
          ...baseError,
          code: "integration_connection_unavailable",
          message: "Integration connection is not available to this workspace.",
        });
        continue;
      }

      const toolSchema = getConnectorToolSchemaById(binding.toolId);
      if (toolSchema !== undefined) {
        const missingScopes = getMissingScopes(connection.scopes, toolSchema.requiredScopes);

        if (missingScopes.length > 0) {
          errors.push({
            ...baseError,
            code: "integration_connection_missing_scopes",
            message: `Integration connection is missing required scope: ${missingScopes.join(", ")}`,
            missingScopes,
          });
          continue;
        }
      }

      const roleIds = input.manifest.agentToolAssignments
        ?.filter((assignment) => assignment.id === binding.nodeId)
        .map((assignment) => assignment.roleId) ?? [];
      const matchingGrants = state.toolGrants.filter(
        (grant) =>
          grant.status === "active"
          && grant.capability === "agent-tool"
          && grant.workspaceId === input.workspaceId
          && workflowGrantIds.has(grant.workflowId)
          && grant.toolId === binding.toolId
          && grant.integrationConnectionId === binding.integrationConnectionId,
      );
      const missingRoleIds = roleIds.filter(
        (roleId) => !matchingGrants.some((grant) => grant.roleId === undefined || grant.roleId === roleId),
      );
      const hasGrant = roleIds.length === 0
        ? matchingGrants.length > 0
        : missingRoleIds.length === 0;

      if (!hasGrant) {
        errors.push({
          ...baseError,
          code: "tool_permission_denied",
          message:
            missingRoleIds.length === 0
              ? "Tool does not have an active scoped grant for this workflow."
              : "Tool does not have active scoped grants for every assigned role.",
          ...(missingRoleIds.length > 0 ? { missingRoleIds } : {}),
        });
      }
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  }

  async ensureToolGrantsForPublish(input: {
    organizationId: string;
    workspaceId: string;
    actorUserId: string;
    now?: string | undefined;
    manifest: Pick<CompiledRuntimeManifest, "publishedVersionId" | "workflowId" | "toolBindings" | "agentToolAssignments">;
  }): Promise<void> {
    const state = await this.loadState(input.organizationId);
    const workflowGrantIds = resolveManifestWorkflowGrantIds(input.manifest);
    let changed = false;

    for (const binding of input.manifest.toolBindings) {
      if (binding.integrationConnectionId === undefined) {
        continue;
      }

      const connection = state.connections.find(
        (candidate) => candidate.id === binding.integrationConnectionId,
      );
      const toolSchema = getConnectorToolSchemaById(binding.toolId);

      if (
        connection === undefined
        || connection.status === "revoked"
        || getConnectionAvailability(connection) === undefined
        || !isConnectionAvailableInWorkspace(connection, input.workspaceId)
        || toolSchema === undefined
        || connection.provider !== toolSchema.provider
        || getMissingScopes(connection.scopes, toolSchema.requiredScopes).length > 0
      ) {
        continue;
      }

      const roleIds = [
        ...new Set(
          input.manifest.agentToolAssignments
            ?.filter((assignment) => assignment.id === binding.nodeId)
            .map((assignment) => assignment.roleId) ?? [],
        ),
      ];
      const grantRoleIds = roleIds.length === 0 ? [undefined] : roleIds;

      for (const roleId of grantRoleIds) {
        if (
          hasMatchingAgentToolGrant({
            grants: state.toolGrants,
            workspaceId: input.workspaceId,
            workflowGrantIds,
            roleId,
            toolId: binding.toolId,
            integrationConnectionId: binding.integrationConnectionId,
          })
        ) {
          continue;
        }

        const grant: ToolPermissionGrantResponse = {
          id: `tool_grant_${input.organizationId}_${state.toolGrants.length + 1}`,
          organizationId: input.organizationId,
          capability: "agent-tool",
          workspaceId: input.workspaceId,
          workflowId: input.manifest.workflowId,
          ...(roleId !== undefined ? { roleId } : {}),
          toolId: binding.toolId,
          integrationConnectionId: binding.integrationConnectionId,
          risk: binding.risk,
          requiredScopes: toolSchema.requiredScopes,
          approvalRequired: binding.requiresHumanApproval,
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
              || candidate.capability !== grant.capability
              || candidate.toolId !== grant.toolId
              || candidate.integrationConnectionId !== grant.integrationConnectionId,
          ),
        ];
        changed = true;
      }
    }

    if (changed) {
      await this.saveState(state);
    }
  }

  async evaluateToolExecution(input: {
    organizationId: string;
    workspaceId: string;
    activeAgentId: string;
    manifest: CompiledRuntimeManifest;
    binding: CompiledRuntimeToolBinding;
  }): Promise<ToolPermissionDecision> {
    void input.organizationId;
    void input.workspaceId;
    void input.activeAgentId;
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

    if (connection !== undefined && !isConnectionAvailableInWorkspace(connection, input.workspaceId)) {
      return {
        allowed: false,
        approvalRequired: false,
        reason: "integration_connection_unavailable",
      };
    }

    const toolSchema = getConnectorToolSchemaById(input.binding.toolId);
    if (connection !== undefined && toolSchema !== undefined) {
      const missingScopes = getMissingScopes(connection.scopes, toolSchema.requiredScopes);

      if (missingScopes.length > 0) {
        return {
          allowed: false,
          approvalRequired: false,
          reason: "integration_connection_missing_scopes",
          missingScopes,
        };
      }
    }

    const matchingGrant = state.toolGrants.find(
      (grant) =>
        grant.status === "active"
        && grant.capability === "agent-tool"
        && grant.workspaceId === input.workspaceId
        && resolveManifestWorkflowGrantIds(input.manifest).has(grant.workflowId)
        && grant.toolId === input.binding.toolId
        && grant.integrationConnectionId === input.binding.integrationConnectionId
        && (grant.roleId === undefined || grant.roleId === input.activeAgentId),
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
    capability: grant.capability ?? "agent-tool",
    requiredScopes: grant.requiredScopes === undefined ? [] : [...grant.requiredScopes],
  };
}

function isConnectionAvailableInWorkspace(
  connection: IntegrationConnectionResponse,
  workspaceId: string,
) {
  const availability = getConnectionAvailability(connection);
  return (
    availability?.scope === "organization" ||
    availability?.workspaceId === workspaceId
  );
}

function getConnectionAvailability(
  connection: Partial<Pick<IntegrationConnectionResponse, "availability">>,
) {
  return connection.availability;
}

function resolveManifestWorkflowGrantIds(
  manifest: Pick<CompiledRuntimeManifest, "publishedVersionId" | "workflowId">,
) {
  return new Set([
    manifest.workflowId,
    ...(manifest.publishedVersionId === undefined ? [] : [manifest.publishedVersionId]),
  ]);
}

function hasMatchingAgentToolGrant(input: {
  grants: ToolPermissionGrantResponse[];
  workspaceId: string;
  workflowGrantIds: Set<string>;
  roleId: string | undefined;
  toolId: string;
  integrationConnectionId: string;
}) {
  return input.grants.some(
    (grant) =>
      grant.status === "active"
      && grant.capability === "agent-tool"
      && grant.workspaceId === input.workspaceId
      && input.workflowGrantIds.has(grant.workflowId)
      && grant.toolId === input.toolId
      && grant.integrationConnectionId === input.integrationConnectionId
      && (input.roleId === undefined || grant.roleId === undefined || grant.roleId === input.roleId),
  );
}

function getMissingScopes(grantedScopes: string[], requiredScopes: string[]) {
  return requiredScopes.filter((scope) => !grantedScopes.includes(scope));
}

function isCapabilitySupportedByProvider(
  provider: IntegrationConnectionResponse["provider"],
  capability: ToolPermissionGrantResponse["capability"],
) {
  const providerCatalog = getIntegrationProviderCatalogEntry(provider);

  if (capability === "knowledge-source") {
    return providerCatalog?.knowledgeSource.supported === true
      || providerCatalog?.capabilities.includes("knowledge-source") === true;
  }

  return providerCatalog?.capabilities.includes(capability) === true;
}
