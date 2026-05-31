import { Controller, Get, Req } from "@nestjs/common";
import { platformRoles, type PlatformRole, type TenantRole, type Workspace } from "@zara/core";

import { WorkspacesService } from "../workspaces/workspaces.service";
import { zaraAuth } from "./better-auth.instance";

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
  constructor(private readonly workspacesService: WorkspacesService) {}

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
    const organizationPayload = activeOrganizationId.length > 0
      ? await requestAuthJson(request, "/organization/get-full-organization")
      : null;
    const activeMemberPayload = activeOrganizationId.length > 0
      ? await requestAuthJson(request, "/organization/get-active-member")
      : null;
    const organizationsPayload = await requestAuthJson(request, "/organization/list");
    const activeMember = asRecord(activeMemberPayload);
    const memberships = normalizeMemberships(organizationsPayload, organizationPayload, activeMember, user.id);
    const activeOrganization = normalizeOrganization(organizationPayload, activeMember, user.id);
    const platformRole = normalizePlatformRole(request.headers["x-zara-platform-role"]);

    return {
      authenticated: true,
      user,
      activeOrganization,
      memberships,
      activeWorkspace: activeOrganization === null
        ? null
        : this.resolveActiveWorkspace(activeOrganization.id, user.id),
      platformRole,
      permissions: {
        tenant: activeOrganization === null ? [] : tenantPermissionsByRole[activeOrganization.role],
        platform: platformRole === null ? [] : platformPermissionsByRole[platformRole],
      },
    };
  }

  private resolveActiveWorkspace(organizationId: string, userId: string): AuthContextWorkspace | null {
    const state = this.workspacesService.getWorkspaceState(organizationId);
    const userMembership = state.memberships.find(
      (membership) => membership.tenantId === organizationId && membership.userId === userId,
    );
    const workspace = findActiveWorkspace(state.workspaces, userMembership?.workspaceId);

    return workspace === null
      ? null
      : {
          id: workspace.id,
          name: workspace.name,
        };
  }
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

function findActiveWorkspace(workspaces: Workspace[], preferredWorkspaceId: string | undefined) {
  const activeWorkspaces = workspaces.filter((workspace) => workspace.status === "active");
  const preferredWorkspace = activeWorkspaces.find((workspace) => workspace.id === preferredWorkspaceId);

  return preferredWorkspace
    ?? activeWorkspaces.find((workspace) => workspace.id === "workspace-support")
    ?? activeWorkspaces[0]
    ?? null;
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

function normalizePlatformRole(value: unknown): PlatformRole | null {
  const normalized = normalizeHeader(value);

  return platformRoles.includes(normalized as PlatformRole) ? normalized as PlatformRole : null;
}

function normalizeHeader(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }

  return typeof value === "string" ? value.trim() : "";
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
