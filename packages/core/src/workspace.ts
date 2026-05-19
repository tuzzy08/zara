import type { ID, TenantRole } from "./index";

export type WorkspaceStatus = "active" | "archived";
export type WorkspaceAuditAction =
  | "workspace.accessed"
  | "workspace.renamed"
  | "workspace.archived"
  | "workspace.restored"
  | "membership.granted"
  | "membership.role_changed"
  | "membership.revoked";

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

export interface WorkspaceAuditEntry {
  id: ID;
  workspaceId: ID;
  tenantId: ID;
  actorUserId: ID;
  action: WorkspaceAuditAction;
  summary: string;
  at: string;
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

export function createWorkspaceAuditEntry(input: WorkspaceAuditEntry): WorkspaceAuditEntry {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: input.action,
    summary: input.summary,
    at: input.at,
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

export function renameWorkspace(input: {
  workspaces: Workspace[];
  workspaceId: ID;
  tenantId: ID;
  nextName: string;
}): Workspace[] {
  const workspace = requireWorkspace(input.workspaces, input.workspaceId, input.tenantId);
  const validation = validateWorkspaceCreate({
    tenantId: input.tenantId,
    name: input.nextName,
    existingWorkspaces: input.workspaces.filter((candidate) => candidate.id !== input.workspaceId),
  });

  if (!validation.ok) {
    throw new Error(validation.message);
  }

  return input.workspaces.map((candidate) =>
    candidate.id === workspace.id
      ? {
          ...candidate,
          name: input.nextName.trim(),
          slug: slugifyWorkspaceName(input.nextName),
        }
      : candidate,
  );
}

export function archiveWorkspace(input: {
  workspaces: Workspace[];
  workspaceId: ID;
  tenantId: ID;
  activeSessionCount?: number | undefined;
}): Workspace[] {
  requireWorkspace(input.workspaces, input.workspaceId, input.tenantId);

  if ((input.activeSessionCount ?? 0) > 0) {
    throw new Error(
      `Workspace '${input.workspaceId}' cannot be archived while ${input.activeSessionCount} active calls or sandbox sessions exist.`,
    );
  }

  return input.workspaces.map((candidate) =>
    candidate.id === input.workspaceId
      ? {
          ...candidate,
          status: "archived" as const,
        }
      : candidate,
  );
}

export function restoreWorkspace(input: {
  workspaces: Workspace[];
  workspaceId: ID;
  tenantId: ID;
}): Workspace[] {
  requireWorkspace(input.workspaces, input.workspaceId, input.tenantId);

  return input.workspaces.map((candidate) =>
    candidate.id === input.workspaceId
      ? {
          ...candidate,
          status: "active" as const,
        }
      : candidate,
  );
}

export function setWorkspaceMembershipRole(input: {
  memberships: WorkspaceMembership[];
  workspaceId: ID;
  tenantId: ID;
  userId: ID;
  role: TenantRole;
  createdAt?: string | undefined;
}): WorkspaceMembership[] {
  const membershipIndex = input.memberships.findIndex(
    (candidate) =>
      candidate.workspaceId === input.workspaceId &&
      candidate.tenantId === input.tenantId &&
      candidate.userId === input.userId,
  );

  if (membershipIndex === -1) {
    return [
      ...input.memberships,
      createWorkspaceMembership({
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
      }),
    ];
  }

  const currentMembership = input.memberships[membershipIndex]!;

  if (currentMembership.role === "owner" && input.role !== "owner") {
    ensureWorkspaceHasAnotherOwner({
      memberships: input.memberships,
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      excludedUserId: input.userId,
    });
  }

  return input.memberships.map((candidate) =>
    candidate.workspaceId === input.workspaceId &&
    candidate.tenantId === input.tenantId &&
    candidate.userId === input.userId
      ? {
          ...candidate,
          role: input.role,
        }
      : candidate,
  );
}

export function revokeWorkspaceMembership(input: {
  memberships: WorkspaceMembership[];
  workspaceId: ID;
  tenantId: ID;
  userId: ID;
}): WorkspaceMembership[] {
  const membership = input.memberships.find(
    (candidate) =>
      candidate.workspaceId === input.workspaceId &&
      candidate.tenantId === input.tenantId &&
      candidate.userId === input.userId,
  );

  if (membership?.role === "owner") {
    ensureWorkspaceHasAnotherOwner({
      memberships: input.memberships,
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      excludedUserId: input.userId,
    });
  }

  return input.memberships.filter(
    (candidate) =>
      !(
        candidate.workspaceId === input.workspaceId &&
        candidate.tenantId === input.tenantId &&
        candidate.userId === input.userId
      ),
  );
}

export function slugifyWorkspaceName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requireWorkspace(workspaces: Workspace[], workspaceId: ID, tenantId: ID) {
  const workspace = workspaces.find(
    (candidate) => candidate.id === workspaceId && candidate.tenantId === tenantId,
  );

  if (workspace === undefined) {
    throw new Error(`Workspace '${workspaceId}' does not exist for tenant '${tenantId}'.`);
  }

  return workspace;
}

function ensureWorkspaceHasAnotherOwner(input: {
  memberships: WorkspaceMembership[];
  workspaceId: ID;
  tenantId: ID;
  excludedUserId: ID;
}) {
  const hasAnotherOwner = input.memberships.some(
    (candidate) =>
      candidate.workspaceId === input.workspaceId &&
      candidate.tenantId === input.tenantId &&
      candidate.role === "owner" &&
      candidate.userId !== input.excludedUserId,
  );

  if (!hasAnotherOwner) {
    throw new Error(`Workspace '${input.workspaceId}' must keep at least one owner.`);
  }
}
