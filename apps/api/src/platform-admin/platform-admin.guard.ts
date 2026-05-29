import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { platformRoles, type PlatformRole } from "@zara/core";

export interface PlatformAdminRequestContext {
  actorUserId: string;
  platformRole: PlatformRole;
}

export const platformAdminContextKey = Symbol("platformAdminContext");

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Record<string | symbol, unknown>>();
    const headers = asHeaderRecord(request["headers"]);
    const platformRole = normalizePlatformRole(headers["x-zara-platform-role"]);

    if (platformRole === null) {
      throw new ForbiddenException("Platform role is required for Zara staff operations.");
    }

    request[platformAdminContextKey] = {
      actorUserId: normalizeHeader(headers["x-zara-actor-user-id"]) || "platform-system",
      platformRole,
    } satisfies PlatformAdminRequestContext;

    return true;
  }
}

export function getPlatformAdminContext(request: Record<string | symbol, unknown>) {
  const value = request[platformAdminContextKey];

  if (isPlatformAdminRequestContext(value)) {
    return value;
  }

  throw new ForbiddenException("Platform admin context is missing.");
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

function asHeaderRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
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
    platformRoles.includes(candidate.platformRole)
  );
}
