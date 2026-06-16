import {
  createDefaultWorkspaceSeedState,
  DEFAULT_WORKSPACE_ID,
  normalizeDefaultWorkspaceSeedState,
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
  const seedState = normalizeDefaultWorkspaceSeedState(createDefaultWorkspaceSeedState({
    tenantId,
  }));

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

interface ActiveWorkspaceResolutionOptions {
  organizationId?: string | undefined;
  memberships?: WorkspaceMembership[] | undefined;
  userId?: string | undefined;
}

export function loadActiveWorkspaceId(workspaces: Workspace[], options?: ActiveWorkspaceResolutionOptions) {
  return resolveActiveWorkspaceId(workspaces, undefined, options);
}

export function resolveActiveWorkspaceId(
  workspaces: Workspace[],
  preferredWorkspaceId?: string | null,
  options?: ActiveWorkspaceResolutionOptions,
) {
  const activeWorkspaces = workspaces
    .filter((workspace) => workspace.status === "active")
    .filter((workspace) => canAccessWorkspace(workspace, options));

  if (preferredWorkspaceId !== undefined && preferredWorkspaceId !== null) {
    const preferredWorkspace = activeWorkspaces.find((workspace) => workspace.id === preferredWorkspaceId);

    if (preferredWorkspace !== undefined) {
      return preferredWorkspace.id;
    }
  }

  const storedWorkspaceId = getStorage()?.getItem(activeWorkspaceStorageKey(options?.organizationId));
  const storedWorkspace = activeWorkspaces.find((workspace) => workspace.id === storedWorkspaceId);

  if (storedWorkspace !== undefined) {
    return storedWorkspace.id;
  }

  return activeWorkspaces[0]?.id ?? workspaces[0]?.id ?? DEFAULT_WORKSPACE_ID;
}

export function saveActiveWorkspaceId(workspaceId: string, organizationId?: string | undefined) {
  getStorage()?.setItem(activeWorkspaceStorageKey(organizationId), workspaceId);
}

function getStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function activeWorkspaceStorageKey(organizationId: string | undefined) {
  return organizationId === undefined || organizationId.length === 0
    ? activeWorkspaceKey
    : `${activeWorkspaceKey}:${organizationId}`;
}

function canAccessWorkspace(workspace: Workspace, options: ActiveWorkspaceResolutionOptions | undefined) {
  if (
    options?.memberships === undefined ||
    options.userId === undefined ||
    options.userId.length === 0
  ) {
    return true;
  }

  return options.memberships.some((membership) =>
    membership.workspaceId === workspace.id &&
    membership.userId === options.userId &&
    (options.organizationId === undefined || membership.tenantId === options.organizationId),
  );
}
