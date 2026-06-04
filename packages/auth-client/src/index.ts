import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export type ZaraTenantRole = "owner" | "admin" | "builder" | "operator" | "viewer";
export type ZaraPlatformRole = "platform_owner" | "platform_admin" | "platform_support" | "platform_readonly";
export type ZaraPlatformAuthAssuranceLevel = "none" | "password" | "mfa" | "passkey";
export type ZaraPlatformAuthReason =
  | "signed_out"
  | "platform_role_required"
  | "session_age_required"
  | "session_expired"
  | "mfa_required"
  | "readonly"
  | "support_step_up_required"
  | "assured";

export interface ZaraAuthUser {
  id: string;
  name: string;
  email: string;
}

export interface ZaraAuthOrganization {
  id: string;
  name: string;
  role: ZaraTenantRole;
}

export interface ZaraAuthMembership {
  organizationId: string;
  organizationName: string;
  role: ZaraTenantRole;
}

export interface ZaraAuthWorkspace {
  id: string;
  name: string;
}

export interface ZaraPlatformAuthPosture {
  role: ZaraPlatformRole | null;
  assuranceLevel: ZaraPlatformAuthAssuranceLevel;
  sessionAgeSeconds: number | null;
  mfaVerified: boolean;
  passkeyVerified: boolean;
  mutationAllowed: boolean;
  supportActionAllowed: boolean;
  impersonationSafe: boolean;
  reason: ZaraPlatformAuthReason;
}

export type ZaraInvitationStatus = "pending" | "accepted" | "revoked";

export interface ZaraInvitationWorkspaceAccess {
  workspaceId: string;
  role: ZaraTenantRole;
}

export interface ZaraInvitationAuditEntry {
  action: string;
  actorUserId: string;
  at: string;
  summary: string;
}

export interface ZaraInvitation {
  id: string;
  email: string;
  organizationId: string;
  role: ZaraTenantRole;
  status: ZaraInvitationStatus;
  inviterId: string;
  expiresAt: string;
  createdAt: string;
  workspaceAccess: ZaraInvitationWorkspaceAccess | null;
  audit: ZaraInvitationAuditEntry[];
}

export interface ZaraAuthContext {
  authenticated: boolean;
  user: ZaraAuthUser | null;
  activeOrganization: ZaraAuthOrganization | null;
  memberships: ZaraAuthMembership[];
  activeWorkspace: ZaraAuthWorkspace | null;
  platformRole: ZaraPlatformRole | null;
  platformAuth: ZaraPlatformAuthPosture;
  permissions: {
    tenant: string[];
    platform: string[];
  };
}

export interface ZaraAuthSession {
  user: ZaraAuthUser;
  organization: ZaraAuthOrganization | null;
  platformRole?: ZaraPlatformRole | undefined;
  platformAuth?: ZaraPlatformAuthPosture | undefined;
}

export interface ZaraSessionSnapshot {
  data: ZaraAuthSession | null;
  isPending: boolean;
  error: Error | null;
}

export interface ZaraSignInEmailInput {
  email: string;
  password: string;
  callbackURL?: string | undefined;
}

export interface ZaraSignUpEmailInput {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  callbackURL?: string | undefined;
}

export interface ZaraSelectOrganizationInput {
  organizationId: string;
}

export interface ZaraCreateInvitationInput {
  organizationId: string;
  email: string;
  role: ZaraTenantRole;
  workspaceAccess?: ZaraInvitationWorkspaceAccess | null | undefined;
}

export interface ZaraListInvitationsInput {
  organizationId: string;
}

export interface ZaraRevokeInvitationInput {
  invitationId: string;
}

export interface ZaraAcceptInvitationInput {
  invitationId: string;
  email?: string | undefined;
  password?: string | undefined;
  name?: string | undefined;
}

export interface ZaraRequestPasswordResetInput {
  email: string;
  redirectTo?: string | undefined;
}

export interface ZaraResetPasswordInput {
  token: string;
  newPassword: string;
}

export interface ZaraRequestEmailVerificationInput {
  callbackURL?: string | undefined;
}

export interface ZaraRevokeSessionInput {
  sessionId: string;
}

export type ZaraAuthActionResult =
  | { ok: true }
  | { ok: false; message: string };

export type ZaraInvitationActionResult =
  | { ok: true; invitation: ZaraInvitation }
  | { ok: false; message: string };

export type ZaraInvitationListResult =
  | { ok: true; invitations: ZaraInvitation[] }
  | { ok: false; message: string };

export interface ZaraSessionMetadata {
  id: string;
  current: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export type ZaraSessionListResult =
  | { ok: true; sessions: ZaraSessionMetadata[] }
  | { ok: false; message: string };

export interface ZaraAuthClient {
  useSession: () => ZaraSessionSnapshot;
  getContext: () => Promise<ZaraAuthContext>;
  signInEmail: (input: ZaraSignInEmailInput) => Promise<ZaraAuthActionResult>;
  signUpEmail: (input: ZaraSignUpEmailInput) => Promise<ZaraAuthActionResult>;
  selectOrganization: (input: ZaraSelectOrganizationInput) => Promise<ZaraAuthActionResult>;
  requestPasswordReset: (input: ZaraRequestPasswordResetInput) => Promise<ZaraAuthActionResult>;
  resetPassword: (input: ZaraResetPasswordInput) => Promise<ZaraAuthActionResult>;
  requestEmailVerification: (input?: ZaraRequestEmailVerificationInput) => Promise<ZaraAuthActionResult>;
  listSessions: () => Promise<ZaraSessionListResult>;
  revokeSession: (input: ZaraRevokeSessionInput) => Promise<ZaraAuthActionResult>;
  createInvitation: (input: ZaraCreateInvitationInput) => Promise<ZaraInvitationActionResult>;
  listInvitations: (input: ZaraListInvitationsInput) => Promise<ZaraInvitationListResult>;
  revokeInvitation: (input: ZaraRevokeInvitationInput) => Promise<ZaraInvitationActionResult>;
  acceptInvitation: (input: ZaraAcceptInvitationInput) => Promise<ZaraAuthActionResult>;
  signOut: () => Promise<ZaraAuthActionResult>;
}

export const authClientPackageName = "@zara/auth-client";

export const tenantAuthClient = createZaraBetterAuthClient("tenant");
export const platformAdminAuthClient = createZaraBetterAuthClient("platform-admin");

function createZaraBetterAuthClient(app: "tenant" | "platform-admin"): ZaraAuthClient {
  const baseURL = resolveAuthBaseUrl(app);
  const client = createAuthClient({
    baseURL,
    plugins: [organizationClient()],
  });
  let restoredTenantSession: ZaraAuthSession | null = null;
  let restoredPlatformSession: ZaraAuthSession | null = null;

  return {
    useSession: () => {
      const snapshot = normalizeSessionSnapshot(
        client.useSession(),
      );

      if (app === "platform-admin") {
        if (snapshot.data?.platformRole !== undefined) {
          restoredPlatformSession = null;
          return snapshot;
        }

        if (
          restoredPlatformSession !== null
          && (snapshot.data === null || sameUser(snapshot.data.user, restoredPlatformSession.user))
        ) {
          return {
            ...snapshot,
            data: restoredPlatformSession,
            isPending: false,
          };
        }

        return snapshot;
      }

      if (snapshot.data?.organization !== null && snapshot.data !== null) {
        restoredTenantSession = null;
        return snapshot;
      }

      if (
        restoredTenantSession !== null
        && (snapshot.data === null || sameUser(snapshot.data.user, restoredTenantSession.user))
      ) {
        return {
          ...snapshot,
          data: restoredTenantSession,
          isPending: false,
        };
      }

      return snapshot;
    },
    getContext: async () => {
      const context = await fetchAuthContext(baseURL);

      if (app === "platform-admin") {
        restoredPlatformSession = contextToPlatformSession(context);
      } else {
        restoredTenantSession = contextToSession(context);
      }

      return context;
    },
    signInEmail: async (input) => {
      const result = await client.signIn.email({
        email: input.email,
        password: input.password,
      });

      const signInAction = normalizeActionResult(result);

      if (!signInAction.ok) {
        return signInAction;
      }

      if (app === "platform-admin") {
        const platformSession = contextToPlatformSession(await fetchAuthContext(baseURL));

        if (platformSession === null) {
          return {
            ok: false,
            message: "Platform access is required for Zara Admin.",
          };
        }

        restoredPlatformSession = platformSession;
        return signInAction;
      }

      if (app !== "tenant") {
        return signInAction;
      }

      const organizationResult = await client.organization.list();
      const organizationAction = normalizeActionResult(organizationResult);

      if (!organizationAction.ok) {
        return organizationAction;
      }

      const organizationIds = listedOrganizationIds(organizationResult);
      const organizationId = organizationIds[0] ?? "";

      if (organizationIds.length !== 1 || organizationId.length === 0) {
        restoredTenantSession = null;
        return signInAction;
      }

      const setActiveResult = await client.organization.setActive({
        organizationId,
      });
      const setActiveAction = normalizeActionResult(setActiveResult);

      if (setActiveAction.ok) {
        restoredTenantSession = contextToSession(await fetchAuthContext(baseURL));
      }

      return setActiveAction;
    },
    signUpEmail: async (input) => {
      const organizationName = input.organizationName.trim();

      if (organizationName.length === 0) {
        return {
          ok: false,
          message: "Enter a tenant organization name to create your Zara account.",
        };
      }

      const onboardingResult = await postTenantOnboardingSignup(baseURL, {
        email: input.email,
        password: input.password,
        name: input.name,
        organizationName,
      });

      if (!onboardingResult.ok) {
        return {
          ok: false,
          message: onboardingResult.message,
        };
      }

      restoredTenantSession = onboardingResult.session;
      return { ok: true };
    },
    selectOrganization: async (input) => {
      const setActiveResult = await client.organization.setActive({
        organizationId: input.organizationId,
      });
      const setActiveAction = normalizeActionResult(setActiveResult);

      if (!setActiveAction.ok) {
        return setActiveAction;
      }

      if (app === "tenant") {
        restoredTenantSession = contextToSession(await fetchAuthContext(baseURL));
      }

      return setActiveAction;
    },
    requestPasswordReset: async (input) => {
      const result = await requestProductJson(baseURL, "/api/auth/account-security/password-reset/request", {
        body: JSON.stringify({
          email: input.email,
          ...(input.redirectTo === undefined ? {} : { redirectTo: input.redirectTo }),
        }),
        method: "POST",
      });

      return result.ok ? { ok: true } : result;
    },
    resetPassword: async (input) => {
      const result = await requestProductJson(baseURL, "/api/auth/reset-password", {
        body: JSON.stringify({
          token: input.token,
          newPassword: input.newPassword,
        }),
        method: "POST",
      });

      return result.ok ? { ok: true } : result;
    },
    requestEmailVerification: async (input = {}) => {
      const result = await requestProductJson(baseURL, "/api/auth/account-security/email-verification/request", {
        body: JSON.stringify({
          ...(input.callbackURL === undefined ? {} : { callbackURL: input.callbackURL }),
        }),
        method: "POST",
      });

      return result.ok ? { ok: true } : result;
    },
    listSessions: async () => {
      const result = await requestProductJson(baseURL, "/api/auth/account-security/sessions");

      if (!result.ok) {
        return result;
      }

      return normalizeSessionListResult(result.payload);
    },
    revokeSession: async (input) => {
      const result = await requestProductJson(
        baseURL,
        `/api/auth/account-security/sessions/${encodeURIComponent(input.sessionId)}/revoke`,
        {
          method: "POST",
        },
      );

      return result.ok ? { ok: true } : result;
    },
    createInvitation: async (input) => {
      const result = await requestProductJson(baseURL, "/api/auth/invitations", {
        body: JSON.stringify({
          organizationId: input.organizationId,
          email: input.email,
          role: input.role,
          workspaceAccess: input.workspaceAccess ?? null,
        }),
        method: "POST",
      });

      if (!result.ok) {
        return result;
      }

      return normalizeInvitationActionResult(result.payload);
    },
    listInvitations: async (input) => {
      const result = await requestProductJson(
        baseURL,
        `/api/auth/invitations?organizationId=${encodeURIComponent(input.organizationId)}`,
      );

      if (!result.ok) {
        return result;
      }

      return normalizeInvitationListResult(result.payload);
    },
    revokeInvitation: async (input) => {
      const result = await requestProductJson(
        baseURL,
        `/api/auth/invitations/${encodeURIComponent(input.invitationId)}/revoke`,
        {
          method: "POST",
        },
      );

      if (!result.ok) {
        return result;
      }

      return normalizeInvitationActionResult(result.payload);
    },
    acceptInvitation: async (input) => {
      const result = await requestProductJson(
        baseURL,
        `/api/auth/invitations/${encodeURIComponent(input.invitationId)}/accept`,
        {
          body: JSON.stringify({
            ...(input.email === undefined ? {} : { email: input.email }),
            ...(input.password === undefined ? {} : { password: input.password }),
            ...(input.name === undefined ? {} : { name: input.name }),
          }),
          method: "POST",
        },
      );

      if (!result.ok) {
        return result;
      }

      const session = normalizeInvitationAcceptSession(result.payload);

      if (session === null) {
        return {
          ok: false,
          message: "Invitation was accepted without a usable tenant session.",
        };
      }

      restoredTenantSession = session;
      return { ok: true };
    },
    signOut: async () => {
      restoredTenantSession = null;
      restoredPlatformSession = null;
      return normalizeActionResult(await client.signOut());
    },
  };
}

async function postTenantOnboardingSignup(
  baseURL: string,
  input: ZaraSignUpEmailInput,
): Promise<
  | { ok: true; session: ZaraAuthSession }
  | { ok: false; message: string }
> {
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}/api/auth/onboarding/signup`, {
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        name: input.name,
        organizationName: input.organizationName,
      }),
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        message: serverMessage(payload),
      };
    }

    const session = normalizeOnboardingSession(payload);

    return session === null
      ? {
          ok: false,
          message: "Onboarding completed without a usable tenant session.",
        }
      : {
          ok: true,
          session,
        };
  } catch {
    return {
      ok: false,
      message: "Tenant onboarding request failed.",
    };
  }
}

async function fetchAuthContext(baseURL: string): Promise<ZaraAuthContext> {
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}/api/auth/context`, {
      credentials: "include",
    });

    if (!response.ok) {
      return signedOutAuthContext();
    }

    return normalizeAuthContext(await response.json());
  } catch {
    return signedOutAuthContext();
  }
}

async function requestProductJson(
  baseURL: string,
  path: string,
  init: RequestInit = {},
): Promise<
  | { ok: true; payload: unknown }
  | { ok: false; message: string }
> {
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}${path}`, {
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
      ...init,
    });
    const payload = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        message: serverMessage(payload),
      };
    }

    return {
      ok: true,
      payload,
    };
  } catch {
    return {
      ok: false,
      message: "Request failed.",
    };
  }
}

function resolveAuthBaseUrl(app: "tenant" | "platform-admin") {
  const env = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env;
  const configured = env?.VITE_AUTH_BASE_URL?.trim() || env?.VITE_API_BASE_URL?.trim();

  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  return app === "platform-admin" ? "http://localhost:4010" : "http://localhost:4010";
}

function normalizeSessionSnapshot(
  value: unknown,
): ZaraSessionSnapshot {
  const record = asRecord(value);
  const sessionRecord = asRecord(record["data"]);
  const data = normalizeAuthSession(
    sessionRecord,
    {},
    {},
  );
  const errorValue = record["error"];

  return {
    data,
    isPending: isPendingSnapshot(record),
    error: errorValue instanceof Error ? errorValue : null,
  };
}

function normalizeActionResult(value: unknown): ZaraAuthActionResult {
  const record = asRecord(value);
  const error = record["error"];

  if (error === null || error === undefined) {
    return { ok: true };
  }

  const errorRecord = asRecord(error);
  const message = typeof errorRecord["message"] === "string"
    ? errorRecord["message"]
    : "Authentication request failed.";

  return { ok: false, message };
}

function sameUser(left: ZaraAuthUser, right: ZaraAuthUser) {
  return left.id === right.id || left.email === right.email;
}

function listedOrganizationIds(value: unknown) {
  const organizations = asRecord(value)["data"];

  if (!Array.isArray(organizations)) {
    return [];
  }

  return organizations.flatMap((organization) => {
    const id = stringValue(asRecord(organization)["id"]);
    return id.length > 0 ? [id] : [];
  });
}

function normalizeAuthSession(
  value: unknown,
  activeOrganizationRecord: Record<string, unknown>,
  activeMember: Record<string, unknown>,
): ZaraAuthSession | null {
  if (value === null || value === undefined) {
    return null;
  }

  const sessionRecord = asRecord(value);
  const nestedSessionRecord = asRecord(sessionRecord["session"]);
  const userRecord = asRecord(sessionRecord["user"]);
  const fallbackOrganization = asRecord(
    sessionRecord["activeOrganization"] ?? sessionRecord["organization"],
  );
  const activeOrganization = Object.keys(activeOrganizationRecord).length > 0
    ? activeOrganizationRecord
    : fallbackOrganization;

  const userId = stringValue(userRecord["id"]);
  const email = stringValue(userRecord["email"]);
  const name = stringValue(userRecord["name"]) || email;

  if (userId.length === 0 || email.length === 0) {
    return null;
  }

  return {
    user: {
      id: userId,
      name,
      email,
    },
    organization: normalizeOrganization(activeOrganization, activeMember, userId),
    platformRole: normalizePlatformRole(
      sessionRecord["platformRole"]
      ?? nestedSessionRecord["platformRole"]
      ?? userRecord["platformRole"]
      ?? userRecord["role"],
    ),
    platformAuth: normalizePlatformAuthPosture(
      sessionRecord["platformAuth"]
      ?? nestedSessionRecord["platformAuth"]
      ?? userRecord["platformAuth"],
      normalizePlatformRole(
        sessionRecord["platformRole"]
        ?? nestedSessionRecord["platformRole"]
        ?? userRecord["platformRole"]
        ?? userRecord["role"],
      ) ?? null,
    ),
  };
}

function normalizeOnboardingSession(value: unknown): ZaraAuthSession | null {
  const record = asRecord(value);
  const user = normalizeContextUser(record["user"]);
  const organization = normalizeContextOrganization(record["activeOrganization"]);

  if (user === null || organization === null) {
    return null;
  }

  return {
    user,
    organization,
  };
}

function normalizeInvitationAcceptSession(value: unknown): ZaraAuthSession | null {
  const record = asRecord(value);
  const user = normalizeContextUser(record["user"]);
  const organization = normalizeContextOrganization(record["activeOrganization"]);

  if (user === null || organization === null) {
    return null;
  }

  return {
    user,
    organization,
  };
}

function normalizeInvitationActionResult(value: unknown): ZaraInvitationActionResult {
  const invitation = normalizeInvitation(asRecord(value)["invitation"]);

  return invitation === null
    ? {
        ok: false,
        message: "Invitation response did not include a usable invitation.",
      }
    : {
        ok: true,
        invitation,
      };
}

function normalizeInvitationListResult(value: unknown): ZaraInvitationListResult {
  const invitations = asRecord(value)["invitations"];

  if (!Array.isArray(invitations)) {
    return {
      ok: false,
      message: "Invitation response did not include a usable invitation list.",
    };
  }

  return {
    ok: true,
    invitations: invitations.flatMap((item) => {
      const invitation = normalizeInvitation(item);
      return invitation === null ? [] : [invitation];
    }),
  };
}

function normalizeSessionListResult(value: unknown): ZaraSessionListResult {
  const sessions = asRecord(value)["sessions"];

  if (!Array.isArray(sessions)) {
    return {
      ok: false,
      message: "Session response did not include a usable session list.",
    };
  }

  return {
    ok: true,
    sessions: sessions.flatMap((item) => {
      const session = normalizeSessionMetadata(item);
      return session === null ? [] : [session];
    }),
  };
}

function normalizeSessionMetadata(value: unknown): ZaraSessionMetadata | null {
  const session = asRecord(value);
  const id = stringValue(session["id"]);
  const createdAt = stringValue(session["createdAt"]);
  const updatedAt = stringValue(session["updatedAt"]);
  const expiresAt = stringValue(session["expiresAt"]);

  if (id.length === 0 || createdAt.length === 0 || updatedAt.length === 0 || expiresAt.length === 0) {
    return null;
  }

  return {
    id,
    current: session["current"] === true,
    createdAt,
    updatedAt,
    expiresAt,
    ipAddress: nullableString(session["ipAddress"]),
    userAgent: nullableString(session["userAgent"]),
  };
}

function serverMessage(value: unknown) {
  const record = asRecord(value);
  const error = asRecord(record["error"]);

  return stringValue(record["message"])
    || stringValue(error["message"])
    || "Tenant onboarding request failed.";
}

function normalizeAuthContext(value: unknown): ZaraAuthContext {
  const record = asRecord(value);
  const user = normalizeContextUser(record["user"]);
  const activeOrganization = normalizeContextOrganization(record["activeOrganization"]);
  const memberships = normalizeContextMemberships(record["memberships"]);
  const activeWorkspace = normalizeContextWorkspace(record["activeWorkspace"]);
  const platformRole = normalizePlatformRole(record["platformRole"]) ?? null;
  const permissions = asRecord(record["permissions"]);
  const platformAuth = normalizePlatformAuthPosture(record["platformAuth"], platformRole);

  return {
    authenticated: record["authenticated"] === true && user !== null,
    user,
    activeOrganization,
    memberships,
    activeWorkspace,
    platformRole,
    platformAuth,
    permissions: {
      tenant: stringArray(permissions["tenant"]),
      platform: stringArray(permissions["platform"]),
    },
  };
}

function signedOutAuthContext(): ZaraAuthContext {
  return {
    authenticated: false,
    user: null,
    activeOrganization: null,
    memberships: [],
    activeWorkspace: null,
    platformRole: null,
    platformAuth: signedOutPlatformAuthPosture(),
    permissions: {
      tenant: [],
      platform: [],
    },
  };
}

function normalizePlatformAuthPosture(
  value: unknown,
  fallbackRole: ZaraPlatformRole | null,
): ZaraPlatformAuthPosture {
  const posture = asRecord(value);
  const role = normalizePlatformRole(posture["role"]) ?? fallbackRole;
  const assuranceLevel = normalizePlatformAuthAssuranceLevel(posture["assuranceLevel"]);

  return {
    role,
    assuranceLevel,
    sessionAgeSeconds: nullableNumber(posture["sessionAgeSeconds"]),
    mfaVerified: posture["mfaVerified"] === true,
    passkeyVerified: posture["passkeyVerified"] === true,
    mutationAllowed: posture["mutationAllowed"] === true,
    supportActionAllowed: posture["supportActionAllowed"] === true,
    impersonationSafe: posture["impersonationSafe"] === true,
    reason: normalizePlatformAuthReason(posture["reason"], role),
  };
}

function signedOutPlatformAuthPosture(): ZaraPlatformAuthPosture {
  return {
    role: null,
    assuranceLevel: "none",
    sessionAgeSeconds: null,
    mfaVerified: false,
    passkeyVerified: false,
    mutationAllowed: false,
    supportActionAllowed: false,
    impersonationSafe: false,
    reason: "signed_out",
  };
}

function contextToSession(context: ZaraAuthContext): ZaraAuthSession | null {
  if (!context.authenticated || context.user === null || context.activeOrganization === null) {
    return null;
  }

  return {
    user: context.user,
    organization: context.activeOrganization,
    platformRole: context.platformRole ?? undefined,
    platformAuth: context.platformAuth,
  };
}

function contextToPlatformSession(context: ZaraAuthContext): ZaraAuthSession | null {
  if (!context.authenticated || context.user === null || context.platformRole === null) {
    return null;
  }

  return {
    user: context.user,
    organization: null,
    platformRole: context.platformRole,
    platformAuth: context.platformAuth,
  };
}

function normalizeInvitation(value: unknown): ZaraInvitation | null {
  const invitation = asRecord(value);
  const id = stringValue(invitation["id"]);
  const email = stringValue(invitation["email"]);
  const organizationId = stringValue(invitation["organizationId"]);
  const role = normalizeTenantRole(invitation["role"]);
  const status = normalizeInvitationStatus(invitation["status"]);
  const inviterId = stringValue(invitation["inviterId"]);
  const expiresAt = stringValue(invitation["expiresAt"]);
  const createdAt = stringValue(invitation["createdAt"]);

  if (
    id.length === 0 ||
    email.length === 0 ||
    organizationId.length === 0 ||
    role === null ||
    status === null ||
    inviterId.length === 0 ||
    expiresAt.length === 0 ||
    createdAt.length === 0
  ) {
    return null;
  }

  return {
    id,
    email,
    organizationId,
    role,
    status,
    inviterId,
    expiresAt,
    createdAt,
    workspaceAccess: normalizeInvitationWorkspaceAccess(invitation["workspaceAccess"]),
    audit: normalizeInvitationAudit(invitation["audit"]),
  };
}

function normalizeInvitationWorkspaceAccess(value: unknown): ZaraInvitationWorkspaceAccess | null {
  const workspaceAccess = asRecord(value);
  const workspaceId = stringValue(workspaceAccess["workspaceId"]);
  const role = normalizeTenantRole(workspaceAccess["role"]);

  if (workspaceId.length === 0 || role === null) {
    return null;
  }

  return {
    workspaceId,
    role,
  };
}

function normalizeInvitationAudit(value: unknown): ZaraInvitationAuditEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const entry = asRecord(item);
    const action = stringValue(entry["action"]);
    const actorUserId = stringValue(entry["actorUserId"]);
    const at = stringValue(entry["at"]);
    const summary = stringValue(entry["summary"]);

    if (action.length === 0 || actorUserId.length === 0 || at.length === 0 || summary.length === 0) {
      return [];
    }

    return [{
      action,
      actorUserId,
      at,
      summary,
    }];
  });
}

function normalizeContextUser(value: unknown): ZaraAuthUser | null {
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

function normalizeContextOrganization(value: unknown): ZaraAuthOrganization | null {
  const organization = asRecord(value);
  const id = stringValue(organization["id"]);
  const name = stringValue(organization["name"]);
  const role = normalizeTenantRole(organization["role"]);

  if (id.length === 0 || name.length === 0 || role === null) {
    return null;
  }

  return {
    id,
    name,
    role,
  };
}

function normalizeContextMemberships(value: unknown): ZaraAuthMembership[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const membership = asRecord(item);
    const organizationId = stringValue(membership["organizationId"]);
    const organizationName = stringValue(membership["organizationName"]);
    const role = normalizeTenantRole(membership["role"]);

    if (organizationId.length === 0 || organizationName.length === 0 || role === null) {
      return [];
    }

    return [{
      organizationId,
      organizationName,
      role,
    }];
  });
}

function normalizeContextWorkspace(value: unknown): ZaraAuthWorkspace | null {
  const workspace = asRecord(value);
  const id = stringValue(workspace["id"]);
  const name = stringValue(workspace["name"]);

  if (id.length === 0 || name.length === 0) {
    return null;
  }

  return {
    id,
    name,
  };
}

function normalizeOrganization(
  value: Record<string, unknown>,
  activeMember: Record<string, unknown>,
  userId: string,
): ZaraAuthOrganization | null {
  const id = stringValue(value["id"]);
  const name = stringValue(value["name"]);
  const role = normalizeTenantRole(
    activeMember["role"] ?? value["role"] ?? organizationMemberRole(value["members"], userId),
  );

  if (id.length === 0 || name.length === 0 || role === null) {
    return null;
  }

  return { id, name, role };
}

function organizationMemberRole(value: unknown, userId: string) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const member of value) {
    const memberRecord = asRecord(member);
    const memberUserId = stringValue(memberRecord["userId"])
      || stringValue(asRecord(memberRecord["user"])["id"]);

    if (memberUserId === userId) {
      return memberRecord["role"];
    }
  }

  return undefined;
}

function normalizeTenantRole(value: unknown): ZaraTenantRole | null {
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

function normalizeInvitationStatus(value: unknown): ZaraInvitationStatus | null {
  switch (value) {
    case "pending":
    case "accepted":
    case "revoked":
      return value;
    default:
      return null;
  }
}

function normalizePlatformRole(value: unknown): ZaraPlatformRole | undefined {
  switch (value) {
    case "platform_owner":
    case "platform_admin":
    case "platform_support":
    case "platform_readonly":
      return value;
    default:
      return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function isPendingSnapshot(value: Record<string, unknown>) {
  return value["isPending"] === true
    || value["isLoading"] === true
    || value["isRefetching"] === true;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizePlatformAuthAssuranceLevel(value: unknown): ZaraPlatformAuthAssuranceLevel {
  switch (value) {
    case "none":
    case "password":
    case "mfa":
    case "passkey":
      return value;
    default:
      return "password";
  }
}

function normalizePlatformAuthReason(
  value: unknown,
  role: ZaraPlatformRole | null,
): ZaraPlatformAuthReason {
  switch (value) {
    case "signed_out":
    case "platform_role_required":
    case "session_age_required":
    case "session_expired":
    case "mfa_required":
    case "readonly":
    case "support_step_up_required":
    case "assured":
      return value;
    default:
      return role === null ? "platform_role_required" : "session_age_required";
  }
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
