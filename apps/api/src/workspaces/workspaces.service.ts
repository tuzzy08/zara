import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  archiveWorkspace,
  createDefaultWorkspaceSeedState,
  createWorkspace,
  createWorkspaceAuditEntry,
  restoreWorkspace,
  revokeWorkspaceMembership,
  setWorkspaceMembershipRole,
  slugifyWorkspaceName,
  validateWorkspaceCreate,
  renameWorkspace,
  type TenantRole,
  type Workspace,
  type WorkspaceAuditAction,
  type WorkspaceAuditEntry,
  type WorkspaceDirectoryUser,
  type WorkspaceMembership,
} from "@zara/core";

export interface WorkspaceStateResponse {
  organizationId: string;
  directoryUsers: WorkspaceDirectoryUser[];
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  auditEntries: WorkspaceAuditEntry[];
}

type WorkspaceStateStore = WorkspaceStateResponse;

@Injectable()
export class WorkspacesService {
  private readonly stateByOrganizationId = new Map<string, WorkspaceStateStore>();

  getWorkspaceState(organizationId: string): WorkspaceStateResponse {
    return cloneWorkspaceState(this.getOrCreateState(organizationId));
  }

  createWorkspace(input: {
    organizationId: string;
    name: string;
    actorUserId: string;
  }): WorkspaceStateResponse {
    const state = this.getOrCreateState(input.organizationId);
    const validation = validateWorkspaceCreate({
      tenantId: input.organizationId,
      name: input.name,
      existingWorkspaces: state.workspaces,
    });

    if (!validation.ok) {
      throw new ConflictException(validation.message);
    }

    const slug = slugifyWorkspaceName(input.name);
    const workspace = createWorkspace({
      id: `workspace-${slug}`,
      tenantId: input.organizationId,
      name: input.name,
      slug,
      createdBy: input.actorUserId,
    });

    state.workspaces = [...state.workspaces, workspace];
    state.auditEntries = [
      buildAuditEntry({
        organizationId: input.organizationId,
        workspaceId: workspace.id,
        actorUserId: input.actorUserId,
        action: "workspace.accessed",
        summary: `Created workspace ${workspace.name}.`,
        currentLength: state.auditEntries.length,
      }),
      ...state.auditEntries,
    ];

    return cloneWorkspaceState(state);
  }

  mutateWorkspace(input: {
    organizationId: string;
    workspaceId: string;
    actorUserId: string;
    action: "rename" | "archive" | "restore";
    nextName?: string | undefined;
    activeSessionCount?: number | undefined;
  }): WorkspaceStateResponse {
    const state = this.getOrCreateState(input.organizationId);
    const workspace = requireWorkspace(state.workspaces, input.organizationId, input.workspaceId);

    try {
      switch (input.action) {
        case "rename": {
          state.workspaces = renameWorkspace({
            workspaces: state.workspaces,
            workspaceId: input.workspaceId,
            tenantId: input.organizationId,
            nextName: input.nextName ?? workspace.name,
          });
          const renamedWorkspace = requireWorkspace(state.workspaces, input.organizationId, input.workspaceId);

          state.auditEntries = [
            buildAuditEntry({
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
              actorUserId: input.actorUserId,
              action: "workspace.renamed",
              summary: `Renamed workspace to ${renamedWorkspace.name}.`,
              currentLength: state.auditEntries.length,
            }),
            ...state.auditEntries,
          ];
          break;
        }
        case "archive": {
          state.workspaces = archiveWorkspace({
            workspaces: state.workspaces,
            workspaceId: input.workspaceId,
            tenantId: input.organizationId,
            activeSessionCount: input.activeSessionCount,
          });
          state.auditEntries = [
            buildAuditEntry({
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
              actorUserId: input.actorUserId,
              action: "workspace.archived",
              summary: `Archived workspace ${workspace.name}.`,
              currentLength: state.auditEntries.length,
            }),
            ...state.auditEntries,
          ];
          break;
        }
        case "restore": {
          state.workspaces = restoreWorkspace({
            workspaces: state.workspaces,
            workspaceId: input.workspaceId,
            tenantId: input.organizationId,
          });
          state.auditEntries = [
            buildAuditEntry({
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
              actorUserId: input.actorUserId,
              action: "workspace.restored",
              summary: `Restored workspace ${workspace.name}.`,
              currentLength: state.auditEntries.length,
            }),
            ...state.auditEntries,
          ];
          break;
        }
      }
    } catch (error) {
      throw toConflictException(error);
    }

    return cloneWorkspaceState(state);
  }

  markWorkspaceAccessed(input: {
    organizationId: string;
    workspaceId: string;
    actorUserId: string;
  }): WorkspaceStateResponse {
    const state = this.getOrCreateState(input.organizationId);
    const workspace = requireWorkspace(state.workspaces, input.organizationId, input.workspaceId);

    state.auditEntries = [
      buildAuditEntry({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "workspace.accessed",
        summary: `Switched active workspace to ${workspace.name}.`,
        currentLength: state.auditEntries.length,
      }),
      ...state.auditEntries,
    ];

    return cloneWorkspaceState(state);
  }

  setMembershipRole(input: {
    organizationId: string;
    workspaceId: string;
    userId: string;
    role: TenantRole;
    actorUserId: string;
  }): WorkspaceStateResponse {
    const state = this.getOrCreateState(input.organizationId);
    requireWorkspace(state.workspaces, input.organizationId, input.workspaceId);

    try {
      state.memberships = setWorkspaceMembershipRole({
        memberships: state.memberships,
        workspaceId: input.workspaceId,
        tenantId: input.organizationId,
        userId: input.userId,
        role: input.role,
      });
    } catch (error) {
      throw toConflictException(error);
    }

    const userName = state.directoryUsers.find((user) => user.id === input.userId)?.name ?? input.userId;
    state.auditEntries = [
      buildAuditEntry({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "membership.role_changed",
        summary: `Changed ${userName} to ${input.role}.`,
        currentLength: state.auditEntries.length,
      }),
      ...state.auditEntries,
    ];

    return cloneWorkspaceState(state);
  }

  revokeMembership(input: {
    organizationId: string;
    workspaceId: string;
    userId: string;
    actorUserId: string;
  }): WorkspaceStateResponse {
    const state = this.getOrCreateState(input.organizationId);
    requireWorkspace(state.workspaces, input.organizationId, input.workspaceId);
    const userName = state.directoryUsers.find((user) => user.id === input.userId)?.name ?? input.userId;

    try {
      state.memberships = revokeWorkspaceMembership({
        memberships: state.memberships,
        workspaceId: input.workspaceId,
        tenantId: input.organizationId,
        userId: input.userId,
      });
    } catch (error) {
      throw toConflictException(error);
    }

    state.auditEntries = [
      buildAuditEntry({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "membership.revoked",
        summary: `Revoked access for ${userName}.`,
        currentLength: state.auditEntries.length,
      }),
      ...state.auditEntries,
    ];

    return cloneWorkspaceState(state);
  }

  private getOrCreateState(organizationId: string): WorkspaceStateStore {
    const existingState = this.stateByOrganizationId.get(organizationId);

    if (existingState !== undefined) {
      return existingState;
    }

    const seededState = createDefaultWorkspaceSeedState({
      tenantId: organizationId,
    });
    const nextState: WorkspaceStateStore = {
      organizationId,
      directoryUsers: seededState.directoryUsers,
      workspaces: seededState.workspaces,
      memberships: seededState.memberships,
      auditEntries: seededState.auditEntries,
    };

    this.stateByOrganizationId.set(organizationId, nextState);
    return nextState;
  }
}

function requireWorkspace(workspaces: Workspace[], organizationId: string, workspaceId: string) {
  const workspace = workspaces.find(
    (candidate) => candidate.id === workspaceId && candidate.tenantId === organizationId,
  );

  if (workspace === undefined) {
    throw new NotFoundException(`Workspace '${workspaceId}' was not found.`);
  }

  return workspace;
}

function buildAuditEntry(input: {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  action: WorkspaceAuditAction;
  summary: string;
  currentLength: number;
}) {
  return createWorkspaceAuditEntry({
    id: `audit-${input.workspaceId}-${input.currentLength + 1}`,
    workspaceId: input.workspaceId,
    tenantId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    summary: input.summary,
    at: new Date().toISOString(),
  });
}

function cloneWorkspaceState(state: WorkspaceStateStore): WorkspaceStateResponse {
  return {
    organizationId: state.organizationId,
    directoryUsers: state.directoryUsers.map((user) => ({
      id: user.id,
      name: user.name,
      title: user.title,
    })),
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
    })),
    memberships: state.memberships.map((membership) => ({
      ...membership,
    })),
    auditEntries: state.auditEntries.map((entry) => ({
      ...entry,
    })),
  };
}

function toConflictException(error: unknown) {
  return error instanceof Error ? new ConflictException(error.message) : new ConflictException("Workspace mutation failed.");
}
