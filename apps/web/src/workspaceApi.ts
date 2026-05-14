import type {
  TenantRole,
  Workspace,
  WorkspaceAuditEntry,
  WorkspaceDirectoryUser,
  WorkspaceMembership,
} from "@zara/core";

import { requestJson } from "./apiClient";

export interface WorkspaceStateResponse {
  organizationId: string;
  directoryUsers: WorkspaceDirectoryUser[];
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  auditEntries: WorkspaceAuditEntry[];
}

export function fetchWorkspaceState(organizationId: string) {
  return requestJson<WorkspaceStateResponse>(`/organizations/${organizationId}/workspaces/state`);
}

export async function createWorkspaceViaApi(input: {
  organizationId: string;
  name: string;
  actorUserId: string;
}) {
  const response = await requestJson<{ state: WorkspaceStateResponse }>(
    `/organizations/${input.organizationId}/workspaces`,
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        actorUserId: input.actorUserId,
      }),
    },
  );

  return response.state;
}

export async function markWorkspaceAccessedViaApi(input: {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
}) {
  const response = await requestJson<{ state: WorkspaceStateResponse }>(
    `/organizations/${input.organizationId}/workspaces/${input.workspaceId}/accessed`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
      }),
    },
  );

  return response.state;
}

export async function renameWorkspaceViaApi(input: {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  nextName: string;
}) {
  return mutateWorkspaceViaApi({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "rename",
    nextName: input.nextName,
  });
}

export async function archiveWorkspaceViaApi(input: {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  activeSessionCount?: number | undefined;
}) {
  return mutateWorkspaceViaApi({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "archive",
    activeSessionCount: input.activeSessionCount,
  });
}

export async function restoreWorkspaceViaApi(input: {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
}) {
  return mutateWorkspaceViaApi({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "restore",
  });
}

export async function setWorkspaceMembershipRoleViaApi(input: {
  organizationId: string;
  workspaceId: string;
  userId: string;
  role: TenantRole;
  actorUserId: string;
}) {
  const response = await requestJson<{ state: WorkspaceStateResponse }>(
    `/organizations/${input.organizationId}/workspaces/${input.workspaceId}/memberships/${input.userId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        role: input.role,
        actorUserId: input.actorUserId,
      }),
    },
  );

  return response.state;
}

export async function revokeWorkspaceMembershipViaApi(input: {
  organizationId: string;
  workspaceId: string;
  userId: string;
  actorUserId: string;
}) {
  const response = await requestJson<{ state: WorkspaceStateResponse }>(
    `/organizations/${input.organizationId}/workspaces/${input.workspaceId}/memberships/${input.userId}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
      }),
    },
  );

  return response.state;
}

async function mutateWorkspaceViaApi(input: {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  action: "rename" | "archive" | "restore";
  nextName?: string | undefined;
  activeSessionCount?: number | undefined;
}) {
  const response = await requestJson<{ state: WorkspaceStateResponse }>(
    `/organizations/${input.organizationId}/workspaces/${input.workspaceId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: input.action,
        actorUserId: input.actorUserId,
        ...(input.nextName !== undefined ? { nextName: input.nextName } : {}),
        ...(input.activeSessionCount !== undefined ? { activeSessionCount: input.activeSessionCount } : {}),
      }),
    },
  );

  return response.state;
}
