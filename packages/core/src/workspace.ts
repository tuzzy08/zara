import type { ID, TenantRole } from "./index";

export type WorkspaceStatus = "active" | "archived";

export interface Workspace {
  id: ID;
  tenantId: ID;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  createdAt: string;
  createdBy: ID;
}

export interface WorkspaceMembership {
  workspaceId: ID;
  tenantId: ID;
  userId: ID;
  role: TenantRole;
  createdAt: string;
}

export type WorkspaceCreateValidation =
  | { ok: true }
  | {
      ok: false;
      code: "workspace.duplicate_slug" | "workspace.invalid_name";
      message: string;
    };

export type WorkspaceAccessValidation =
  | {
      ok: true;
      role: TenantRole;
    }
  | {
      ok: false;
      code: "workspace.missing_membership" | "workspace.forbidden_role";
      message: string;
    };

export function createWorkspace(input: {
  id: ID;
  tenantId: ID;
  name: string;
  createdBy: ID;
  createdAt?: string | undefined;
  slug?: string | undefined;
  status?: WorkspaceStatus | undefined;
}): Workspace {
  const slug = input.slug ?? slugifyWorkspaceName(input.name);

  return {
    id: input.id,
    tenantId: input.tenantId,
    name: input.name.trim(),
    slug,
    status: input.status ?? "active",
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy,
  };
}

export function createWorkspaceMembership(input: {
  workspaceId: ID;
  tenantId: ID;
  userId: ID;
  role: TenantRole;
  createdAt?: string | undefined;
}): WorkspaceMembership {
  return {
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    userId: input.userId,
    role: input.role,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function validateWorkspaceCreate(input: {
  tenantId: ID;
  name: string;
  existingWorkspaces: Workspace[];
}): WorkspaceCreateValidation {
  const slug = slugifyWorkspaceName(input.name);

  if (slug.length === 0) {
    return {
      ok: false,
      code: "workspace.invalid_name",
      message: "Workspace name must contain at least one letter or number.",
    };
  }

  const duplicate = input.existingWorkspaces.some(
    (workspace) => workspace.tenantId === input.tenantId && workspace.slug === slug,
  );

  if (duplicate) {
    return {
      ok: false,
      code: "workspace.duplicate_slug",
      message: `Workspace slug '${slug}' already exists for this tenant.`,
    };
  }

  return { ok: true };
}

export function validateWorkspaceAccess(input: {
  tenantId: ID;
  workspaceId: ID;
  userId: ID;
  memberships: WorkspaceMembership[];
  allowedRoles: TenantRole[];
}): WorkspaceAccessValidation {
  const membership = input.memberships.find(
    (candidate) =>
      candidate.tenantId === input.tenantId &&
      candidate.workspaceId === input.workspaceId &&
      candidate.userId === input.userId,
  );

  if (membership === undefined) {
    return {
      ok: false,
      code: "workspace.missing_membership",
      message: `User '${input.userId}' is not a member of workspace '${input.workspaceId}'.`,
    };
  }

  if (!input.allowedRoles.includes(membership.role)) {
    return {
      ok: false,
      code: "workspace.forbidden_role",
      message: `Role '${membership.role}' cannot access workspace '${input.workspaceId}' for this action.`,
    };
  }

  return {
    ok: true,
    role: membership.role,
  };
}

export function slugifyWorkspaceName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
