import {
  createDefaultWorkspaceSeedState,
  type Workspace,
  type WorkspaceAuditEntry,
  type WorkspaceDirectoryUser,
  type WorkspaceMembership,
} from "@zara/core";

export const tenantId = "tenant-west-africa";

const activeWorkspaceKey = "zara.web.active-workspace.v1";

export interface InitialWorkspaceState {
  directoryUsers: WorkspaceDirectoryUser[];
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  auditEntries: WorkspaceAuditEntry[];
}

export function createInitialWorkspaceState(): InitialWorkspaceState {
  const seedState = createDefaultWorkspaceSeedState({
    tenantId,
  });

  return {
    directoryUsers: seedState.directoryUsers.map((user) => ({
      ...user,
    })),
    workspaces: seedState.workspaces.map((workspace) => ({
      ...workspace,
    })),
    memberships: seedState.memberships.map((membership) => ({
      ...membership,
    })),
    auditEntries: seedState.auditEntries.map((entry) => ({
      ...entry,
    })),
  };
}

export function loadActiveWorkspaceId(workspaces: Workspace[]) {
  return resolveActiveWorkspaceId(workspaces);
}

export function resolveActiveWorkspaceId(workspaces: Workspace[], preferredWorkspaceId?: string | null) {
  const activeWorkspaces = workspaces.filter((workspace) => workspace.status === "active");

  if (preferredWorkspaceId !== undefined && preferredWorkspaceId !== null) {
    const preferredWorkspace = activeWorkspaces.find((workspace) => workspace.id === preferredWorkspaceId);

    if (preferredWorkspace !== undefined) {
      return preferredWorkspace.id;
    }
  }

  const storedWorkspaceId = getStorage()?.getItem(activeWorkspaceKey);
  const storedWorkspace = activeWorkspaces.find((workspace) => workspace.id === storedWorkspaceId);

  if (storedWorkspace !== undefined) {
    return storedWorkspace.id;
  }

  return activeWorkspaces[0]?.id ?? workspaces[0]?.id ?? "workspace-operations";
}

export function saveActiveWorkspaceId(workspaceId: string) {
  getStorage()?.setItem(activeWorkspaceKey, workspaceId);
}

function getStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}
