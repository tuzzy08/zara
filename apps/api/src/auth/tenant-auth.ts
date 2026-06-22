import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate } from "@nestjs/common";
import type { TenantRole } from "@zara/core";

import { zaraAuth } from "./better-auth.instance";

export interface TenantAuthContext {
  organizationId: string;
  role: TenantRole;
  userId: string;
}

export function withTenantActor<TBody extends object>(
  body: TBody,
  tenantAuth: TenantAuthContext,
): TBody & {
  actorRole: TenantRole;
  actorUserId: string;
  approverRole: TenantRole;
  approverUserId: string;
} {
  return {
    ...body,
    actorRole: tenantAuth.role,
    actorUserId: tenantAuth.userId,
    approverRole: tenantAuth.role,
    approverUserId: tenantAuth.userId,
  };
}

interface TenantAuthRequest {
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  protocol: string;
  get: (header: string) => string | undefined;
  zaraTenant?: TenantAuthContext | undefined;
}

@Injectable()
export class TenantOrganizationGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<TenantAuthRequest>();
    const organizationId = request.params?.organizationId?.trim() ?? "";

    if (organizationId.length === 0) {
      throw new ForbiddenException("Tenant organization is required");
    }

    const nonProductionTenantAuth = resolveNonProductionTenantAuth(request, organizationId);

    if (nonProductionTenantAuth !== null) {
      request.zaraTenant = nonProductionTenantAuth;
      return true;
    }

    const sessionPayload = asRecord(await requestAuthJson(request, "/get-session"));
    const user = asRecord(sessionPayload["user"]);
    const session = asRecord(sessionPayload["session"]);
    const userId = stringValue(user["id"]);
    const activeOrganizationId = stringValue(session["activeOrganizationId"]);

    if (userId.length === 0) {
      throw new UnauthorizedException("Authentication is required");
    }

    if (activeOrganizationId !== organizationId) {
      throw new ForbiddenException("Active organization does not match the requested organization");
    }

    const activeMember = asRecord(await requestAuthJson(request, "/organization/get-active-member"));
    const role = normalizeTenantRole(activeMember["role"]);

    if (role === null || stringValue(activeMember["organizationId"]) !== organizationId) {
      throw new ForbiddenException("Organization membership is required");
    }

    request.zaraTenant = {
      organizationId,
      role,
      userId,
    };

    return true;
  }
}

function resolveNonProductionTenantAuth(
  request: TenantAuthRequest,
  organizationId: string,
): TenantAuthContext | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const headerOrganizationId = headerValue(request.headers["x-zara-test-organization-id"]);
  const userId = headerValue(request.headers["x-zara-test-user-id"]);
  const role = normalizeTenantRole(headerValue(request.headers["x-zara-test-tenant-role"]));

  if (headerOrganizationId.length === 0 && userId.length === 0 && role === null) {
    return null;
  }

  if (headerOrganizationId !== organizationId || userId.length === 0 || role === null) {
    throw new ForbiddenException("Valid non-production tenant auth headers are required");
  }

  return {
    organizationId,
    role,
    userId,
  };
}

export const TenantAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantAuthContext => {
    const request = context.switchToHttp().getRequest<TenantAuthRequest>();

    if (request.zaraTenant === undefined) {
      throw new UnauthorizedException("Authentication is required");
    }

    return request.zaraTenant;
  },
);

async function requestAuthJson(request: TenantAuthRequest, path: string) {
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

function toAuthRequest(request: TenantAuthRequest, path: string) {
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

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }

  return value?.trim() ?? "";
}
