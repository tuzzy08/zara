import { createWorkspace, slugifyWorkspaceName, validateWorkspaceCreate, type Workspace } from "@zara/core";

export const tenantId = "tenant-west-africa";
const workspacesKey = "zara.web.workspaces.v1";
const activeWorkspaceKey = "zara.web.active-workspace.v1";

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

  return workspaces.some((workspace) => workspace.id === storedId)
    ? storedId!
    : workspaces[0]?.id ?? "workspace-operations";
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
    candidate.status === "active"
  );
}
