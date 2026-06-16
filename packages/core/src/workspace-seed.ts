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
export const LEGACY_DEFAULT_WORKSPACE_IDS = [
  "workspace-operations",
  "workspace-support",
  "workspace-sales",
] as const;

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
  legacySeedWorkspaces?: boolean | undefined;
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

  if (input?.legacySeedWorkspaces === true) {
    return createLegacyWorkspaceSeedState(baseState);
  }

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
  const nonLegacyWorkspaces = state.workspaces.filter((workspace) =>
    workspace.id === DEFAULT_WORKSPACE_ID || !isLegacyDefaultWorkspaceId(workspace.id),
  );
  const workspaces = [
    defaultWorkspace,
    ...nonLegacyWorkspaces.filter((workspace) => workspace.id !== DEFAULT_WORKSPACE_ID),
  ];
  const memberships = dedupeWorkspaceMemberships(state.memberships.map((membership) => ({
    ...membership,
    workspaceId: isLegacyDefaultWorkspaceId(membership.workspaceId) ? DEFAULT_WORKSPACE_ID : membership.workspaceId,
  })));
  const auditEntries = state.auditEntries.map((entry) => ({
    ...entry,
    id: isLegacyDefaultWorkspaceId(entry.workspaceId)
      ? entry.id.replace(entry.workspaceId, DEFAULT_WORKSPACE_ID)
      : entry.id,
    workspaceId: isLegacyDefaultWorkspaceId(entry.workspaceId) ? DEFAULT_WORKSPACE_ID : entry.workspaceId,
  }));

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

export function isLegacyDefaultWorkspaceId(workspaceId: ID) {
  return LEGACY_DEFAULT_WORKSPACE_IDS.some((legacyWorkspaceId) => legacyWorkspaceId === workspaceId);
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
  const existingDefault = workspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID);

  if (existingDefault !== undefined) {
    return existingDefault;
  }

  const firstLegacyWorkspace = workspaces.find((workspace) => isLegacyDefaultWorkspaceId(workspace.id));

  if (firstLegacyWorkspace === undefined) {
    return undefined;
  }

  return {
    ...firstLegacyWorkspace,
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
    slug: "default-workspace",
  };
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

function createLegacyWorkspaceSeedState(baseState: Pick<WorkspaceSeedState, "tenantId" | "directoryUsers">): WorkspaceSeedState {
  const tenantId = baseState.tenantId;

  return {
    ...baseState,
    workspaces: [
      createWorkspace({
        id: "workspace-operations",
        tenantId,
        name: "Operations",
        createdBy: "system",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      createWorkspace({
        id: "workspace-support",
        tenantId,
        name: "Support",
        createdBy: "system",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      createWorkspace({
        id: "workspace-sales",
        tenantId,
        name: "Sales",
        createdBy: "system",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
    ],
    memberships: [
      createWorkspaceMembership({
        workspaceId: "workspace-operations",
        tenantId,
        userId: "user-ops-lead",
        role: "owner",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      createWorkspaceMembership({
        workspaceId: "workspace-operations",
        tenantId,
        userId: "user-support-manager",
        role: "admin",
        createdAt: "2026-05-01T00:10:00.000Z",
      }),
      createWorkspaceMembership({
        workspaceId: "workspace-operations",
        tenantId,
        userId: "user-builder",
        role: "builder",
        createdAt: "2026-05-01T00:15:00.000Z",
      }),
      createWorkspaceMembership({
        workspaceId: "workspace-support",
        tenantId,
        userId: "user-support-manager",
        role: "owner",
        createdAt: "2026-05-01T01:00:00.000Z",
      }),
      createWorkspaceMembership({
        workspaceId: "workspace-support",
        tenantId,
        userId: "user-qa",
        role: "operator",
        createdAt: "2026-05-01T01:20:00.000Z",
      }),
      createWorkspaceMembership({
        workspaceId: "workspace-sales",
        tenantId,
        userId: "user-finance",
        role: "owner",
        createdAt: "2026-05-01T02:00:00.000Z",
      }),
    ],
    auditEntries: [
      createWorkspaceAuditEntry({
        id: "audit-workspace-operations-created",
        workspaceId: "workspace-operations",
        tenantId,
        actorUserId: "system",
        action: "workspace.accessed",
        summary: "Workspace initialized for tenant operations.",
        at: "2026-05-01T00:00:00.000Z",
      }),
      createWorkspaceAuditEntry({
        id: "audit-workspace-support-created",
        workspaceId: "workspace-support",
        tenantId,
        actorUserId: "system",
        action: "workspace.accessed",
        summary: "Workspace initialized for support queues.",
        at: "2026-05-01T01:00:00.000Z",
      }),
    ],
  };
}
