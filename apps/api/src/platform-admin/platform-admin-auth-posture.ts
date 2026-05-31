import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { platformRoles, type PlatformRole } from "@zara/core";

export type PlatformAuthAssuranceLevel = "none" | "password" | "mfa" | "passkey";

export type PlatformAuthReason =
  | "signed_out"
  | "platform_role_required"
  | "session_age_required"
  | "session_expired"
  | "mfa_required"
  | "readonly"
  | "support_step_up_required"
  | "assured";

export interface PlatformAuthPosture {
  role: PlatformRole | null;
  assuranceLevel: PlatformAuthAssuranceLevel;
  sessionAgeSeconds: number | null;
  mfaVerified: boolean;
  passkeyVerified: boolean;
  mutationAllowed: boolean;
  supportActionAllowed: boolean;
  impersonationSafe: boolean;
  reason: PlatformAuthReason;
}

export interface PlatformAuthPostureInput {
  authenticated: boolean;
  headers: Record<string, string | string[] | undefined>;
  role?: PlatformRole | null | undefined;
}

export const platformStaffSessionMaxAgeSeconds = 8 * 60 * 60;
export const platformStaffStepUpMaxAgeSeconds = 15 * 60;

export function resolvePlatformAuthPosture(input: PlatformAuthPostureInput): PlatformAuthPosture {
  const platformRole = input.role ?? normalizePlatformRole(input.headers["x-zara-platform-role"]);

  if (!input.authenticated) {
    return basePosture({
      role: null,
      assuranceLevel: "none",
      sessionAgeSeconds: null,
      reason: "signed_out",
    });
  }

  const assuranceLevel = normalizeAssuranceLevel(input.headers["x-zara-auth-assurance"]);
  const sessionAgeSeconds = resolveSessionAgeSeconds(input.headers);

  if (platformRole === null) {
    return basePosture({
      role: null,
      assuranceLevel,
      sessionAgeSeconds,
      reason: "platform_role_required",
    });
  }

  if (sessionAgeSeconds === null) {
    return basePosture({
      role: platformRole,
      assuranceLevel,
      sessionAgeSeconds,
      reason: "session_age_required",
    });
  }

  if (sessionAgeSeconds > platformStaffSessionMaxAgeSeconds) {
    return basePosture({
      role: platformRole,
      assuranceLevel,
      sessionAgeSeconds,
      reason: "session_expired",
    });
  }

  const hasStepUp = assuranceLevel === "mfa" || assuranceLevel === "passkey";
  const isFresh = sessionAgeSeconds <= platformStaffStepUpMaxAgeSeconds;
  const canCoreMutate = (platformRole === "platform_owner" || platformRole === "platform_admin") && hasStepUp && isFresh;
  const canSupportMutate = platformRole === "platform_support" && hasStepUp && isFresh;

  if (canCoreMutate || canSupportMutate) {
    return basePosture({
      role: platformRole,
      assuranceLevel,
      sessionAgeSeconds,
      mutationAllowed: canCoreMutate,
      supportActionAllowed: canCoreMutate || canSupportMutate,
      impersonationSafe: canCoreMutate,
      reason: "assured",
    });
  }

  if (platformRole === "platform_readonly") {
    return basePosture({
      role: platformRole,
      assuranceLevel,
      sessionAgeSeconds,
      reason: "readonly",
    });
  }

  return basePosture({
    role: platformRole,
    assuranceLevel,
    sessionAgeSeconds,
    reason: platformRole === "platform_support" ? "support_step_up_required" : "mfa_required",
  });
}

export function assertActivePlatformSession(posture: PlatformAuthPosture) {
  if (posture.role === null) {
    throw new ForbiddenException("Platform role is required for Zara staff operations.");
  }

  if (posture.reason === "session_age_required") {
    throw new UnauthorizedException("Platform admin session age is required.");
  }

  if (posture.reason === "session_expired") {
    throw new UnauthorizedException("Platform admin session expired. Sign in again to continue.");
  }
}

export function assertPlatformMutationAllowed(posture: PlatformAuthPosture) {
  assertActivePlatformSession(posture);

  if (!posture.mutationAllowed) {
    throw new ForbiddenException("MFA or passkey verification is required for mutating platform operations.");
  }
}

export function assertSupportActionAllowed(posture: PlatformAuthPosture) {
  assertActivePlatformSession(posture);

  if (!posture.supportActionAllowed) {
    throw new ForbiddenException("MFA or passkey verification is required for support actions.");
  }
}

export function assertImpersonationSafe(posture: PlatformAuthPosture) {
  assertActivePlatformSession(posture);

  if (!posture.impersonationSafe) {
    throw new ForbiddenException("MFA or passkey verification is required for impersonation.");
  }
}

function basePosture(input: {
  role: PlatformRole | null;
  assuranceLevel: PlatformAuthAssuranceLevel;
  sessionAgeSeconds: number | null;
  reason: PlatformAuthReason;
  mutationAllowed?: boolean | undefined;
  supportActionAllowed?: boolean | undefined;
  impersonationSafe?: boolean | undefined;
}): PlatformAuthPosture {
  return {
    role: input.role,
    assuranceLevel: input.assuranceLevel,
    sessionAgeSeconds: input.sessionAgeSeconds,
    mfaVerified: input.assuranceLevel === "mfa",
    passkeyVerified: input.assuranceLevel === "passkey",
    mutationAllowed: input.mutationAllowed === true,
    supportActionAllowed: input.supportActionAllowed === true,
    impersonationSafe: input.impersonationSafe === true,
    reason: input.reason,
  };
}

export function normalizePlatformRole(value: unknown): PlatformRole | null {
  const normalized = normalizeHeader(value);

  return platformRoles.includes(normalized as PlatformRole) ? normalized as PlatformRole : null;
}

export function resolvePlatformRoleAuthority(
  headers: Record<string, string | string[] | undefined>,
  userEmail: string | null,
) {
  const configuredRole = resolveConfiguredStaffRole(userEmail);

  if (configuredRole !== null) {
    return configuredRole;
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return normalizePlatformRole(headers["x-zara-platform-role"]);
}

export function withSessionAuthenticatedAtFallback(
  headers: Record<string, string | string[] | undefined>,
  authenticatedAt: unknown,
) {
  if (
    normalizeHeader(headers["x-zara-session-age-seconds"]).length > 0
    || normalizeHeader(headers["x-zara-session-authenticated-at"]).length > 0
  ) {
    return headers;
  }

  const fallback = normalizeAuthenticatedAt(authenticatedAt);

  return fallback === null
    ? headers
    : {
        ...headers,
        "x-zara-session-authenticated-at": fallback,
      };
}

function normalizeAuthenticatedAt(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function resolveConfiguredStaffRole(userEmail: string | null) {
  const normalizedEmail = userEmail?.trim().toLowerCase() ?? "";

  if (normalizedEmail.length === 0) {
    return null;
  }

  const entries = (process.env.ZARA_PLATFORM_STAFF_ROLES ?? "")
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const [rawEmail, rawRole] = entry.includes("=") ? entry.split("=") : entry.split(":");
    const email = rawEmail?.trim().toLowerCase() ?? "";
    const role = normalizePlatformRole(rawRole?.trim());

    if (email === normalizedEmail && role !== null) {
      return role;
    }
  }

  return null;
}

function normalizeAssuranceLevel(value: unknown): PlatformAuthAssuranceLevel {
  switch (normalizeHeader(value)) {
    case "passkey":
      return "passkey";
    case "mfa":
    case "totp":
    case "otp":
      return "mfa";
    case "password":
      return "password";
    default:
      return "password";
  }
}

function resolveSessionAgeSeconds(headers: Record<string, string | string[] | undefined>) {
  const explicitAge = readNonNegativeInteger(normalizeHeader(headers["x-zara-session-age-seconds"]));

  if (explicitAge !== null) {
    return explicitAge;
  }

  const authenticatedAt = Date.parse(normalizeHeader(headers["x-zara-session-authenticated-at"]));

  if (!Number.isFinite(authenticatedAt)) {
    return null;
  }

  const nowHeader = Date.parse(normalizeHeader(headers["x-zara-auth-now"]));
  const now = Number.isFinite(nowHeader) ? nowHeader : Date.now();
  const ageSeconds = Math.floor((now - authenticatedAt) / 1000);

  return ageSeconds >= 0 ? ageSeconds : null;
}

function readNonNegativeInteger(value: string) {
  if (value.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeHeader(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim().toLowerCase() : "";
  }

  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
