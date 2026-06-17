import type { ID } from "./index";
import {
  createWorkspace,
  createWorkspaceAuditEntry,
  createWorkspaceMembership,
  type Workspace,
  type WorkspaceAuditEntry,
  type WorkspaceMembership,
} from "./workspace";

export const DEFAULT_WORKSPACE_ID = "workspace-default";
export const DEFAULT_WORKSPACE_NAME = "Default workspace";

export interface WorkspaceDirectoryUser {
  id: ID;
  name: string;
  title: string;
}

export interface WorkspaceSeedState {
  tenantId: ID;
  directoryUsers: WorkspaceDirectoryUser[];
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  auditEntries: WorkspaceAuditEntry[];
}

export function createDefaultWorkspaceSeedState(input?: {
  tenantId?: ID | undefined;
}): WorkspaceSeedState {
  const tenantId = input?.tenantId ?? "tenant-west-africa";
  const baseState = {
    tenantId,
    directoryUsers: [
      { id: "user-ops-lead", name: "Operations lead", title: "Tenant owner" },
      { id: "user-support-manager", name: "Support manager", title: "Admin" },
      { id: "user-builder", name: "Workflow builder", title: "Builder" },
      { id: "user-finance", name: "Finance lead", title: "Billing" },
      { id: "user-qa", name: "QA supervisor", title: "Operator" },
    ],
  };

  return {
    ...baseState,
    workspaces: [
      createDefaultWorkspace(tenantId),
    ],
    memberships: [
      createWorkspaceMembership({
        workspaceId: DEFAULT_WORKSPACE_ID,
        tenantId,
        userId: "user-ops-lead",
        role: "owner",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
    ],
    auditEntries: [
      createWorkspaceAuditEntry({
        id: "audit-workspace-default-created",
        workspaceId: DEFAULT_WORKSPACE_ID,
        tenantId,
        actorUserId: "system",
        action: "workspace.accessed",
        summary: "Default workspace initialized for this tenant.",
        at: "2026-05-01T00:00:00.000Z",
      }),
    ],
  };
}

export function normalizeDefaultWorkspaceSeedState(state: WorkspaceSeedState): WorkspaceSeedState {
  const defaultWorkspace = findDefaultWorkspace(state.workspaces) ?? createDefaultWorkspace(state.tenantId);
  const workspaces = [
    defaultWorkspace,
    ...state.workspaces.filter((workspace) => workspace.id !== DEFAULT_WORKSPACE_ID),
  ];
  const memberships = dedupeWorkspaceMemberships(state.memberships);
  const auditEntries = state.auditEntries;

  return {
    ...state,
    workspaces,
    memberships,
    auditEntries,
  };
}

export function resolveDefaultWorkspace(workspaces: Workspace[]) {
  const activeWorkspaces = workspaces.filter((workspace) => workspace.status === "active");

  return activeWorkspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID)
    ?? activeWorkspaces[0]
    ?? workspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID)
    ?? workspaces[0];
}

function createDefaultWorkspace(tenantId: ID) {
  return createWorkspace({
    id: DEFAULT_WORKSPACE_ID,
    tenantId,
    name: DEFAULT_WORKSPACE_NAME,
    createdBy: "system",
    createdAt: "2026-05-01T00:00:00.000Z",
  });
}

function findDefaultWorkspace(workspaces: Workspace[]) {
  return workspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID);
}

function dedupeWorkspaceMemberships(memberships: WorkspaceMembership[]) {
  const membershipsByKey = new Map<string, WorkspaceMembership>();

  for (const membership of memberships) {
    const key = `${membership.tenantId}:${membership.workspaceId}:${membership.userId}`;
    const existing = membershipsByKey.get(key);

    if (existing === undefined || roleRank(membership.role) > roleRank(existing.role)) {
      membershipsByKey.set(key, membership);
    }
  }

  return [...membershipsByKey.values()];
}

function roleRank(role: WorkspaceMembership["role"]) {
  switch (role) {
    case "owner":
      return 5;
    case "admin":
      return 4;
    case "builder":
      return 3;
    case "operator":
      return 2;
    case "viewer":
      return 1;
  }
}
