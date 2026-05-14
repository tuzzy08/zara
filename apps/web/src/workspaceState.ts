import {
  createWorkspace,
  createWorkspaceAuditEntry,
  createWorkspaceMembership,
  slugifyWorkspaceName,
  validateWorkspaceCreate,
  type Workspace,
  type WorkspaceAuditEntry,
  type WorkspaceMembership,
} from "@zara/core";

export const tenantId = "tenant-west-africa";
const workspacesKey = "zara.web.workspaces.v1";
const activeWorkspaceKey = "zara.web.active-workspace.v1";
const workspaceMembershipsKey = "zara.web.workspace-memberships.v1";
const workspaceAuditEntriesKey = "zara.web.workspace-audit-entries.v1";

export interface TenantDirectoryUser {
  id: string;
  name: string;
  title: string;
}

export const tenantDirectory: TenantDirectoryUser[] = [
  { id: "user-ops-lead", name: "Operations lead", title: "Tenant owner" },
  { id: "user-support-manager", name: "Support manager", title: "Admin" },
  { id: "user-builder", name: "Workflow builder", title: "Builder" },
  { id: "user-finance", name: "Finance lead", title: "Billing" },
  { id: "user-qa", name: "QA supervisor", title: "Operator" },
];

export const defaultWorkspaces: Workspace[] = [
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
];

export const defaultWorkspaceMemberships: WorkspaceMembership[] = [
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
];

export const defaultWorkspaceAuditEntries: WorkspaceAuditEntry[] = [
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
];

export function loadWorkspaces(): Workspace[] {
  const storage = getStorage();

  if (storage === null) {
    return defaultWorkspaces;
  }

  try {
    const raw = storage.getItem(workspacesKey);
    const parsed = raw === null ? [] : JSON.parse(raw);
    const stored = Array.isArray(parsed) ? parsed.filter(isWorkspace) : [];
    const workspacesById = new Map(defaultWorkspaces.map((workspace) => [workspace.id, workspace]));

    for (const workspace of stored) {
      workspacesById.set(workspace.id, workspace);
    }

    return [...workspacesById.values()];
  } catch {
    return defaultWorkspaces;
  }
}

export function saveWorkspaces(workspaces: Workspace[]) {
  getStorage()?.setItem(workspacesKey, JSON.stringify(workspaces));
}

export function loadActiveWorkspaceId(workspaces: Workspace[]) {
  const storedId = getStorage()?.getItem(activeWorkspaceKey);
  const activeWorkspaces = workspaces.filter((workspace) => workspace.status === "active");

  return activeWorkspaces.some((workspace) => workspace.id === storedId)
    ? storedId!
    : activeWorkspaces[0]?.id ?? workspaces[0]?.id ?? "workspace-operations";
}

export function saveActiveWorkspaceId(workspaceId: string) {
  getStorage()?.setItem(activeWorkspaceKey, workspaceId);
}

export function createTenantWorkspace(input: {
  name: string;
  workspaces: Workspace[];
  createdBy: string;
}): Workspace {
  const validation = validateWorkspaceCreate({
    tenantId,
    name: input.name,
    existingWorkspaces: input.workspaces,
  });

  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const slug = slugifyWorkspaceName(input.name);

  return createWorkspace({
    id: `workspace-${slug}`,
    tenantId,
    name: input.name,
    slug,
    createdBy: input.createdBy,
  });
}

export function loadWorkspaceMemberships(): WorkspaceMembership[] {
  const storage = getStorage();

  if (storage === null) {
    return defaultWorkspaceMemberships;
  }

  try {
    const raw = storage.getItem(workspaceMembershipsKey);
    const parsed = raw === null ? [] : JSON.parse(raw);
    const stored = Array.isArray(parsed) ? parsed.filter(isWorkspaceMembership) : [];
    const membershipsByKey = new Map(
      defaultWorkspaceMemberships.map((membership) => [getMembershipKey(membership), membership]),
    );

    for (const membership of stored) {
      membershipsByKey.set(getMembershipKey(membership), membership);
    }

    return [...membershipsByKey.values()];
  } catch {
    return defaultWorkspaceMemberships;
  }
}

export function saveWorkspaceMemberships(memberships: WorkspaceMembership[]) {
  getStorage()?.setItem(workspaceMembershipsKey, JSON.stringify(memberships));
}

export function loadWorkspaceAuditEntries(): WorkspaceAuditEntry[] {
  const storage = getStorage();

  if (storage === null) {
    return defaultWorkspaceAuditEntries;
  }

  try {
    const raw = storage.getItem(workspaceAuditEntriesKey);
    const parsed = raw === null ? [] : JSON.parse(raw);
    const stored = Array.isArray(parsed) ? parsed.filter(isWorkspaceAuditEntry) : [];
    const entriesById = new Map(defaultWorkspaceAuditEntries.map((entry) => [entry.id, entry]));

    for (const entry of stored) {
      entriesById.set(entry.id, entry);
    }

    return [...entriesById.values()].sort((left, right) => right.at.localeCompare(left.at));
  } catch {
    return defaultWorkspaceAuditEntries;
  }
}

export function saveWorkspaceAuditEntries(entries: WorkspaceAuditEntry[]) {
  getStorage()?.setItem(workspaceAuditEntriesKey, JSON.stringify(entries));
}

function getStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isWorkspace(value: unknown): value is Workspace {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Workspace>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.slug === "string" &&
    (candidate.status === "active" || candidate.status === "archived")
  );
}

function isWorkspaceMembership(value: unknown): value is WorkspaceMembership {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkspaceMembership>;

  return (
    typeof candidate.workspaceId === "string" &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function isWorkspaceAuditEntry(value: unknown): value is WorkspaceAuditEntry {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkspaceAuditEntry>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.workspaceId === "string" &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.actorUserId === "string" &&
    typeof candidate.action === "string" &&
    typeof candidate.summary === "string" &&
    typeof candidate.at === "string"
  );
}

function getMembershipKey(membership: WorkspaceMembership) {
  return `${membership.workspaceId}:${membership.userId}`;
}
