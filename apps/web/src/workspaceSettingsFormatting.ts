import type { ZaraInvitation } from "@zara/auth-client";
import type { TenantRole, WorkspaceAuditAction, WorkspaceDirectoryUser } from "@zara/core";

export const tenantRoleOrder: TenantRole[] = ["owner", "admin", "builder", "operator", "viewer"];

export function getUserLabel(directoryUsers: WorkspaceDirectoryUser[], userId: string) {
  return directoryUsers.find((user) => user.id === userId)?.name ?? userId;
}

export function formatTenantRole(role: TenantRole) {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "builder":
      return "Builder";
    case "operator":
      return "Operator";
    default:
      return "Viewer";
  }
}

export function formatAuditAction(action: WorkspaceAuditAction) {
  switch (action) {
    case "workspace.accessed":
      return "Access";
    case "workspace.renamed":
      return "Rename";
    case "workspace.archived":
      return "Archive";
    case "workspace.restored":
      return "Restore";
    case "membership.granted":
      return "Grant";
    case "membership.role_changed":
      return "Role";
    default:
      return "Revoke";
  }
}

export function formatAuditTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatSessionTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatInvitationStatus(status: ZaraInvitation["status"]) {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "revoked":
      return "Revoked";
    default:
      return "Pending";
  }
}
