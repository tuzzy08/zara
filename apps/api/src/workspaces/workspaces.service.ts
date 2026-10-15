import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import {
  archiveWorkspace,
  createWorkspace,
  DEFAULT_WORKSPACE_ID,
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

import { WORKSPACE_REPOSITORY, type WorkspaceRepository } from "./workspace.repository";

export interface WorkspaceStateResponse {
  organizationId: string;
  directoryUsers: WorkspaceDirectoryUser[];
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  auditEntries: WorkspaceAuditEntry[];
}

@Injectable()
export class WorkspacesService {
  constructor(@Inject(WORKSPACE_REPOSITORY) private readonly repository: WorkspaceRepository) {}

  async getWorkspaceState(organizationId: string): Promise<WorkspaceStateResponse> {
    return cloneWorkspaceState(await this.repository.read(organizationId));
  }

  ensureDefaultMembership(input: { organizationId: string; userId: string; role: TenantRole }): Promise<Workspace | null> {
    return this.repository.mutate(input.organizationId, state => {
      const workspace = state.workspaces.find(row => row.id === DEFAULT_WORKSPACE_ID && row.status === "active");
      if (workspace === undefined) return null;
      const existing = state.memberships.find(row => row.workspaceId === workspace.id && row.userId === input.userId);
      if (existing !== undefined) return { ...workspace };
      if (state.membershipHistoryUserIds.includes(input.userId)) return null;
      state.memberships = setWorkspaceMembershipRole({ memberships: state.memberships,
        tenantId: input.organizationId, workspaceId: workspace.id, userId: input.userId, role: input.role });
      state.auditEntries.unshift(buildAuditEntry({ organizationId: input.organizationId,
        workspaceId: workspace.id, actorUserId: input.userId, action: "membership.granted",
        summary: `Granted ${input.role} access to ${input.userId}.` }));
      return { ...workspace };
    });
  }

  createWorkspace(input: {
    organizationId: string;
    name: string;
    actorUserId: string;
  }): Promise<WorkspaceStateResponse> {
    return this.repository.mutate(input.organizationId, state => {
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
        id: `workspace-${randomUUID()}`,
      tenantId: input.organizationId,
      name: input.name,
      slug,
      createdBy: input.actorUserId,
    });

    state.workspaces = [...state.workspaces, workspace];
    state.memberships = setWorkspaceMembershipRole({ memberships: state.memberships,
      tenantId: input.organizationId, workspaceId: workspace.id, userId: input.actorUserId, role: "owner" });
    state.auditEntries = [
      buildAuditEntry({
        organizationId: input.organizationId,
        workspaceId: workspace.id,
        actorUserId: input.actorUserId,
        action: "workspace.accessed",
        summary: `Created workspace ${workspace.name}.`,
      }),
      ...state.auditEntries,
    ];

    return cloneWorkspaceState(state);
    });
  }

  mutateWorkspace(input: {
    organizationId: string;
    workspaceId: string;
    actorUserId: string;
    action: "rename" | "archive" | "restore";
    nextName?: string | undefined;
    activeSessionCount?: number | undefined;
  }): Promise<WorkspaceStateResponse> {
    return this.repository.mutate(input.organizationId, state => {
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
    });
  }

  markWorkspaceAccessed(input: {
    organizationId: string;
    workspaceId: string;
    actorUserId: string;
  }): Promise<WorkspaceStateResponse> {
    return this.repository.mutate(input.organizationId, state => {
      const workspace = requireWorkspace(state.workspaces, input.organizationId, input.workspaceId);

      state.auditEntries = [
        buildAuditEntry({
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: "workspace.accessed",
          summary: `Switched active workspace to ${workspace.name}.`,
        }),
        ...state.auditEntries,
      ];

      return cloneWorkspaceState(state);
    });
  }

  setMembershipRole(input: {
    organizationId: string;
    workspaceId: string;
    userId: string;
    role: TenantRole;
    actorUserId: string;
  }): Promise<WorkspaceStateResponse> {
    return this.repository.mutate(input.organizationId, state => {
    requireWorkspace(state.workspaces, input.organizationId, input.workspaceId);
    const existingMembership = state.memberships.find(
      (candidate) =>
        candidate.workspaceId === input.workspaceId &&
        candidate.tenantId === input.organizationId &&
        candidate.userId === input.userId,
    );

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
        action: existingMembership === undefined ? "membership.granted" : "membership.role_changed",
        summary: existingMembership === undefined
          ? `Granted ${input.role} access to ${userName}.`
          : `Changed ${userName} to ${input.role}.`,
      }),
      ...state.auditEntries,
    ];

    return cloneWorkspaceState(state);
    });
  }

  revokeMembership(input: {
    organizationId: string;
    workspaceId: string;
    userId: string;
    actorUserId: string;
  }): Promise<WorkspaceStateResponse> {
    return this.repository.mutate(input.organizationId, state => {
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
      }),
      ...state.auditEntries,
    ];

    return cloneWorkspaceState(state);
    });
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
}) {
  return createWorkspaceAuditEntry({
    id: `audit-${randomUUID()}`,
    workspaceId: input.workspaceId,
    tenantId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    summary: input.summary,
    at: new Date().toISOString(),
  });
}

function cloneWorkspaceState(state: WorkspaceStateResponse): WorkspaceStateResponse {
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
