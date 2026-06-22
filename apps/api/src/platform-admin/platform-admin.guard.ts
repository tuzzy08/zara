import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { platformRoles, type PlatformRole } from "@zara/core";

import { zaraAuth } from "../auth/better-auth.instance";
import {
  assertActivePlatformSession,
  type PlatformAuthPosture,
  resolvePlatformAuthPosture,
  resolvePlatformRoleAuthority,
} from "./platform-admin-auth-posture";

export interface PlatformAdminRequestContext {
  actorUserId: string;
  platformRole: PlatformRole;
  platformAuth: PlatformAuthPosture;
}

export const platformAdminContextKey = Symbol("platformAdminContext");

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PlatformAdminHttpRequest>();
    const headers = asHeaderRecord(request["headers"]);
    const sessionPayload = await requestAuthJson(request, "/get-session");
    const sessionRecord = asRecord(sessionPayload);
    const user = asRecord(sessionRecord["user"]);
    const session = asRecord(sessionRecord["session"]);
    const userEmail = stringValue(user["email"]);
    const authenticated = userEmail.length > 0 || process.env.NODE_ENV !== "production";
    const resolvedRole = resolvePlatformRoleAuthority(
      headers as Record<string, string | string[] | undefined>,
      userEmail.length > 0 ? userEmail : null,
    );
    const platformAuth = resolvePlatformAuthPosture({
      authenticated,
      role: resolvedRole,
      serverSessionAuthenticatedAt: userEmail.length > 0 ? session["createdAt"] : undefined,
      testAuthorityHeaders: headers as Record<string, string | string[] | undefined>,
    });
    const platformRole = platformAuth.role;

    if (platformRole === null) {
      throw new ForbiddenException("Platform role is required for Zara staff operations.");
    }

    assertActivePlatformSession(platformAuth);

    request[platformAdminContextKey] = {
      actorUserId: resolveActorUserId(user, headers),
      platformRole,
      platformAuth,
    } satisfies PlatformAdminRequestContext;

    return true;
  }
}

interface PlatformAdminHttpRequest extends Record<string | symbol, unknown> {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  get: (header: string) => string | undefined;
}

export function getPlatformAdminContext(request: Record<string | symbol, unknown>) {
  const value = request[platformAdminContextKey];

  if (isPlatformAdminRequestContext(value)) {
    return value;
  }

  throw new ForbiddenException("Platform admin context is missing.");
}

function normalizeHeader(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }

  return typeof value === "string" ? value.trim() : "";
}

function asHeaderRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function resolveActorUserId(user: Record<string, unknown>, headers: Record<string, unknown>) {
  const userId = stringValue(user["id"]);

  if (userId.length > 0) {
    return userId;
  }

  if (process.env.NODE_ENV !== "production") {
    return normalizeHeader(headers["x-zara-test-actor-user-id"]) || "platform-system";
  }

  return "platform-system";
}

async function requestAuthJson(request: PlatformAdminHttpRequest, path: string) {
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

function toAuthRequest(request: PlatformAdminHttpRequest, path: string) {
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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isPlatformAdminRequestContext(value: unknown): value is PlatformAdminRequestContext {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PlatformAdminRequestContext>;

  return (
    typeof candidate.actorUserId === "string" &&
    candidate.actorUserId.length > 0 &&
    candidate.platformRole !== undefined &&
    platformRoles.includes(candidate.platformRole) &&
    candidate.platformAuth !== undefined
  );
}
