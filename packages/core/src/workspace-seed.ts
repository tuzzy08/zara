import type { ID } from "./index";
import {
  createWorkspace,
  createWorkspaceAuditEntry,
  createWorkspaceMembership,
  type Workspace,
  type WorkspaceAuditEntry,
  type WorkspaceMembership,
} from "./workspace";

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

  return {
    tenantId,
    directoryUsers: [
      { id: "user-ops-lead", name: "Operations lead", title: "Tenant owner" },
      { id: "user-support-manager", name: "Support manager", title: "Admin" },
      { id: "user-builder", name: "Workflow builder", title: "Builder" },
      { id: "user-finance", name: "Finance lead", title: "Billing" },
      { id: "user-qa", name: "QA supervisor", title: "Operator" },
    ],
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
