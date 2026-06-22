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
  role?: PlatformRole | null | undefined;
  serverAssuranceLevel?: PlatformAuthAssuranceLevel | null | undefined;
  serverSessionAgeSeconds?: number | null | undefined;
  serverSessionAuthenticatedAt?: unknown;
  serverNow?: unknown;
  testAuthorityHeaders?: Record<string, string | string[] | undefined> | undefined;
}

export const platformStaffSessionMaxAgeSeconds = 8 * 60 * 60;
export const platformStaffStepUpMaxAgeSeconds = 15 * 60;

export function resolvePlatformAuthPosture(input: PlatformAuthPostureInput): PlatformAuthPosture {
  const platformRole = input.role
    ?? (isNonProductionRuntime() && input.testAuthorityHeaders !== undefined
      ? normalizePlatformRole(input.testAuthorityHeaders["x-zara-test-platform-role"])
      : null);

  if (!input.authenticated) {
    return basePosture({
      role: null,
      assuranceLevel: "none",
      sessionAgeSeconds: null,
      reason: "signed_out",
    });
  }

  const assuranceLevel = input.serverAssuranceLevel
    ?? (isNonProductionRuntime() && input.testAuthorityHeaders !== undefined
      ? normalizeAssuranceLevel(input.testAuthorityHeaders["x-zara-test-auth-assurance"])
      : "password");
  const sessionAgeSeconds = resolveServerSessionAgeSeconds(input);

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

  if (!isNonProductionRuntime()) {
    return null;
  }

  return normalizePlatformRole(headers["x-zara-test-platform-role"]);
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

function resolveServerSessionAgeSeconds(input: PlatformAuthPostureInput) {
  if (input.serverSessionAgeSeconds !== undefined) {
    return normalizeNonNegativeInteger(input.serverSessionAgeSeconds);
  }

  if (isNonProductionRuntime() && input.testAuthorityHeaders !== undefined) {
    const explicitAge = readNonNegativeInteger(
      normalizeHeader(input.testAuthorityHeaders["x-zara-test-session-age-seconds"]),
    );

    if (explicitAge !== null) {
      return explicitAge;
    }
  }

  return resolveSessionAgeFromAuthenticatedAt({
    authenticatedAt: input.serverSessionAuthenticatedAt,
    now: input.serverNow,
    testAuthorityHeaders: input.testAuthorityHeaders,
  });
}

function resolveSessionAgeFromAuthenticatedAt(input: {
  authenticatedAt: unknown;
  now: unknown;
  testAuthorityHeaders?: Record<string, string | string[] | undefined> | undefined;
}) {
  const explicitAuthenticatedAt = isNonProductionRuntime() && input.testAuthorityHeaders !== undefined
    ? normalizeHeader(input.testAuthorityHeaders["x-zara-test-session-authenticated-at"])
    : "";
  const authenticatedAt = Date.parse(
    explicitAuthenticatedAt.length > 0
      ? explicitAuthenticatedAt
      : normalizeAuthenticatedAt(input.authenticatedAt) ?? "",
  );

  if (!Number.isFinite(authenticatedAt)) {
    return null;
  }

  const testNow = isNonProductionRuntime() && input.testAuthorityHeaders !== undefined
    ? Date.parse(normalizeHeader(input.testAuthorityHeaders["x-zara-test-auth-now"]))
    : Number.NaN;
  const serverNow = input.now instanceof Date ? input.now.getTime() : Date.parse(normalizeAuthenticatedAt(input.now) ?? "");
  const now = Number.isFinite(testNow) ? testNow : Number.isFinite(serverNow) ? serverNow : Date.now();
  const ageSeconds = Math.floor((now - authenticatedAt) / 1000);

  return ageSeconds >= 0 ? ageSeconds : null;
}

function normalizeNonNegativeInteger(value: number | null) {
  if (value === null) {
    return null;
  }

  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isNonProductionRuntime() {
  return process.env.NODE_ENV !== "production";
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
