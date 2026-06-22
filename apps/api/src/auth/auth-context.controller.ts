import { Controller, Get, Optional, Req } from "@nestjs/common";
import { DEFAULT_WORKSPACE_ID, resolveDefaultWorkspace, type PlatformRole, type TenantRole, type Workspace } from "@zara/core";

import { PostgresPoolService } from "../database/postgres-pool.service";
import {
  resolvePlatformAuthPosture,
  resolvePlatformRoleAuthority,
} from "../platform-admin/platform-admin-auth-posture";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { resolveAuthDatabaseMode, zaraAuth } from "./better-auth.instance";
import {
  PostgresAuthContextMembershipReader,
  type AuthContextMembershipContext,
} from "./auth-context-membership-reader";

type Permission = `${string}:${string}`;

interface AuthContextHttpRequest {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  get: (header: string) => string | undefined;
}

interface AuthContextUser {
  id: string;
  name: string;
  email: string;
}

interface AuthContextOrganization {
  id: string;
  name: string;
  role: TenantRole;
}

interface AuthContextMembership {
  organizationId: string;
  organizationName: string;
  role: TenantRole;
}

interface AuthContextWorkspace {
  id: string;
  name: string;
}

@Controller("api/auth")
export class AuthContextController {
  constructor(
    private readonly workspacesService: WorkspacesService,
    @Optional() private readonly postgresPoolService?: PostgresPoolService,
  ) {}

  @Get("context")
  async getContext(@Req() request: AuthContextHttpRequest) {
    const sessionPayload = await requestAuthJson(request, "/get-session");
    const sessionRecord = asRecord(sessionPayload);
    const user = normalizeUser(sessionRecord["user"]);

    if (user === null) {
      return signedOutContext();
    }

    const session = asRecord(sessionRecord["session"]);
    const activeOrganizationId = stringValue(session["activeOrganizationId"]);
    const membershipContext = await this.resolveMembershipContext(request, user.id, activeOrganizationId);
    const memberships = membershipContext.memberships;
    const activeOrganization = membershipContext.activeOrganization;
    const platformRole = resolvePlatformRoleAuthority(request.headers, user.email);
    const platformAuth = resolvePlatformAuthPosture({
      authenticated: true,
      role: platformRole,
      serverSessionAuthenticatedAt: session["createdAt"],
      testAuthorityHeaders: request.headers,
    });

    return {
      authenticated: true,
      user,
      activeOrganization,
      memberships,
      activeWorkspace: activeOrganization === null
        ? null
        : this.resolveActiveWorkspace(activeOrganization.id, user.id, activeOrganization.role),
      platformRole,
      platformAuth,
      permissions: {
        tenant: activeOrganization === null ? [] : tenantPermissionsByRole[activeOrganization.role],
        platform: platformRole === null ? [] : platformPermissionsByRole[platformRole],
      },
    };
  }

  private async resolveMembershipContext(
    request: AuthContextHttpRequest,
    userId: string,
    activeOrganizationId: string,
  ): Promise<AuthContextMembershipContext> {
    if (resolveAuthDatabaseMode(process.env) === "postgres" && this.postgresPoolService !== undefined) {
      return await new PostgresAuthContextMembershipReader(this.postgresPoolService.pool)
        .readMembershipContext({ activeOrganizationId, userId });
    }

    const organizationPayload = activeOrganizationId.length > 0
      ? await requestAuthJson(request, "/organization/get-full-organization")
      : null;
    const activeMemberPayload = activeOrganizationId.length > 0
      ? await requestAuthJson(request, "/organization/get-active-member")
      : null;
    const organizationsPayload = await requestAuthJson(request, "/organization/list");
    const membershipOrganizationsPayload = await resolveMembershipOrganizations(request, organizationsPayload);
    const activeMember = asRecord(activeMemberPayload);

    return {
      activeOrganization: normalizeOrganization(organizationPayload, activeMember, userId),
      memberships: normalizeMemberships(membershipOrganizationsPayload, organizationPayload, activeMember, userId),
    };
  }

  private resolveActiveWorkspace(organizationId: string, userId: string, tenantRole: TenantRole): AuthContextWorkspace | null {
    const state = this.workspacesService.getWorkspaceState(organizationId);
    const userMemberships = state.memberships.filter(
      (membership) => membership.tenantId === organizationId && membership.userId === userId,
    );
    const workspace =
      findActiveWorkspace(state.workspaces, userMemberships.map((membership) => membership.workspaceId))
      ?? this.repairDefaultWorkspaceMembership({
        organizationId,
        userId,
        tenantRole,
        workspaces: state.workspaces,
        existingMembershipCount: userMemberships.length,
      });

    return workspace === null
      ? null
      : {
          id: workspace.id,
          name: workspace.name,
        };
  }

  private repairDefaultWorkspaceMembership(input: {
    organizationId: string;
    userId: string;
    tenantRole: TenantRole;
    workspaces: Workspace[];
    existingMembershipCount: number;
  }): Workspace | null {
    if (input.existingMembershipCount > 0 || !canRepairWorkspaceMembership(input.tenantRole)) {
      return null;
    }

    const workspace = findDefaultWorkspace(input.workspaces);

    if (workspace === null) {
      return null;
    }

    this.workspacesService.setMembershipRole({
      organizationId: input.organizationId,
      workspaceId: workspace.id,
      userId: input.userId,
      role: input.tenantRole === "owner" ? "owner" : "admin",
      actorUserId: input.userId,
    });

    return workspace;
  }
}

async function resolveMembershipOrganizations(
  request: AuthContextHttpRequest,
  organizationsValue: unknown,
) {
  const organizations = Array.isArray(organizationsValue) ? organizationsValue : [];

  return Promise.all(organizations.map(async (organizationValue) => {
    const organizationId = stringValue(asRecord(organizationValue)["id"]);

    if (organizationId.length === 0) {
      return organizationValue;
    }

    return await requestAuthJson(
      request,
      `/organization/get-full-organization?organizationId=${encodeURIComponent(organizationId)}`,
    ) ?? organizationValue;
  }));
}

async function requestAuthJson(request: AuthContextHttpRequest, path: string) {
  const response = await zaraAuth.handler(toAuthRequest(request, path));

  if (!response.ok) {
    return null;
  }

  const text = await response.text();

  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toAuthRequest(request: AuthContextHttpRequest, path: string) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || key.toLowerCase() === "content-length") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  const host = request.get("host") ?? "127.0.0.1:4010";
  return new Request(`${request.protocol}://${host}/api/auth${path}`, {
    headers,
    method: "GET",
  });
}

function signedOutContext() {
  return {
    authenticated: false,
    user: null,
    activeOrganization: null,
    memberships: [],
    activeWorkspace: null,
    platformRole: null,
    platformAuth: resolvePlatformAuthPosture({
      authenticated: false,
    }),
    permissions: {
      tenant: [],
      platform: [],
    },
  };
}

function normalizeUser(value: unknown): AuthContextUser | null {
  const user = asRecord(value);
  const id = stringValue(user["id"]);
  const email = stringValue(user["email"]);
  const name = stringValue(user["name"]) || email;

  if (id.length === 0 || email.length === 0) {
    return null;
  }

  return {
    id,
    name,
    email,
  };
}

function normalizeOrganization(
  value: unknown,
  activeMember: Record<string, unknown>,
  userId: string,
): AuthContextOrganization | null {
  const organization = asRecord(value);
  const id = stringValue(organization["id"]);
  const name = stringValue(organization["name"]);
  const role = normalizeTenantRole(
    activeMember["role"] ?? organization["role"] ?? organizationMemberRole(organization["members"], userId),
  );

  if (id.length === 0 || name.length === 0 || role === null) {
    return null;
  }

  return { id, name, role };
}

function normalizeMemberships(
  organizationsValue: unknown,
  activeOrganizationValue: unknown,
  activeMember: Record<string, unknown>,
  userId: string,
): AuthContextMembership[] {
  const memberships = new Map<string, AuthContextMembership>();
  const organizations = Array.isArray(organizationsValue) ? organizationsValue : [];

  for (const organizationValue of organizations) {
    const organization = normalizeOrganization(organizationValue, activeMember, userId);

    if (organization !== null) {
      memberships.set(organization.id, {
        organizationId: organization.id,
        organizationName: organization.name,
        role: organization.role,
      });
    }
  }

  const activeOrganization = normalizeOrganization(activeOrganizationValue, activeMember, userId);

  if (activeOrganization !== null) {
    memberships.set(activeOrganization.id, {
      organizationId: activeOrganization.id,
      organizationName: activeOrganization.name,
      role: activeOrganization.role,
    });
  }

  return [...memberships.values()];
}

function organizationMemberRole(value: unknown, userId: string) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const member of value) {
    const record = asRecord(member);
    const memberUserId = stringValue(record["userId"]) || stringValue(asRecord(record["user"])["id"]);

    if (memberUserId === userId) {
      return record["role"];
    }
  }

  return undefined;
}

function findActiveWorkspace(workspaces: Workspace[], accessibleWorkspaceIds: string[]) {
  if (accessibleWorkspaceIds.length === 0) {
    return null;
  }

  const accessibleWorkspaceIdSet = new Set(accessibleWorkspaceIds);
  const activeWorkspaces = workspaces.filter((workspace) => workspace.status === "active");
  const accessibleActiveWorkspaces = activeWorkspaces.filter((workspace) => accessibleWorkspaceIdSet.has(workspace.id));

  return accessibleActiveWorkspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID)
    ?? accessibleActiveWorkspaces[0]
    ?? null;
}

function findDefaultWorkspace(workspaces: Workspace[]) {
  return resolveDefaultWorkspace(workspaces) ?? null;
}

function canRepairWorkspaceMembership(role: TenantRole) {
  return role === "owner" || role === "admin";
}

function normalizeTenantRole(value: unknown): TenantRole | null {
  switch (value) {
    case "owner":
    case "admin":
    case "builder":
    case "operator":
    case "viewer":
      return value;
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

const tenantPermissionsByRole: Record<TenantRole, Permission[]> = {
  owner: [
    "organization:update",
    "organization:delete",
    "member:create",
    "member:update",
    "member:delete",
    "invitation:create",
    "invitation:cancel",
    "workflow:read",
    "workflow:write",
    "workflow:publish",
    "monitoring:read",
    "integration:read",
    "integration:write",
    "telephony:read",
    "telephony:write",
  ],
  admin: [
    "organization:update",
    "member:create",
    "member:update",
    "member:delete",
    "invitation:create",
    "invitation:cancel",
    "workflow:read",
    "workflow:write",
    "workflow:publish",
    "monitoring:read",
    "integration:read",
    "integration:write",
    "telephony:read",
    "telephony:write",
  ],
  builder: [
    "workflow:read",
    "workflow:write",
    "workflow:publish",
    "monitoring:read",
    "integration:read",
    "telephony:read",
  ],
  operator: [
    "workflow:read",
    "monitoring:read",
    "integration:read",
    "telephony:read",
    "telephony:write",
  ],
  viewer: [
    "workflow:read",
    "monitoring:read",
    "integration:read",
    "telephony:read",
  ],
};

const platformPermissionsByRole: Record<PlatformRole, Permission[]> = {
  platform_owner: [
    "platform:read",
    "platform:write",
    "platform:impersonate",
    "platform:billing",
    "platform:policy",
  ],
  platform_admin: [
    "platform:read",
    "platform:write",
    "platform:impersonate",
    "platform:billing",
    "platform:policy",
  ],
  platform_support: [
    "platform:read",
    "platform:support",
  ],
  platform_readonly: [
    "platform:read",
  ],
};
