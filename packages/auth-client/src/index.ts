import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export type ZaraTenantRole = "owner" | "admin" | "builder" | "operator" | "viewer";
export type ZaraPlatformRole = "platform_owner" | "platform_admin" | "platform_support" | "platform_readonly";

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

export interface ZaraAuthSession {
  user: ZaraAuthUser;
  organization: ZaraAuthOrganization | null;
  platformRole?: ZaraPlatformRole | undefined;
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

export type ZaraAuthActionResult =
  | { ok: true }
  | { ok: false; message: string };

export interface ZaraAuthClient {
  useSession: () => ZaraSessionSnapshot;
  signInEmail: (input: ZaraSignInEmailInput) => Promise<ZaraAuthActionResult>;
  signUpEmail: (input: ZaraSignUpEmailInput) => Promise<ZaraAuthActionResult>;
  signOut: () => Promise<ZaraAuthActionResult>;
}

export const authClientPackageName = "@zara/auth-client";

export const tenantAuthClient = createZaraBetterAuthClient("tenant");
export const platformAdminAuthClient = createZaraBetterAuthClient("platform-admin");

function createZaraBetterAuthClient(app: "tenant" | "platform-admin"): ZaraAuthClient {
  const client = createAuthClient({
    baseURL: resolveAuthBaseUrl(app),
    plugins: [organizationClient()],
  });
  let restoredTenantSession: ZaraAuthSession | null = null;

  return {
    useSession: () => {
      const snapshot = normalizeSessionSnapshot(
        client.useSession(),
        client.useActiveOrganization(),
        client.useActiveMember(),
      );

      if (app !== "tenant") {
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
    signInEmail: async (input) => {
      const result = await client.signIn.email({
        email: input.email,
        password: input.password,
      });

      const signInAction = normalizeActionResult(result);

      if (!signInAction.ok) {
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

      const organizationId = firstOrganizationId(organizationResult);

      if (organizationId.length === 0) {
        return signInAction;
      }

      const setActiveResult = await client.organization.setActive({
        organizationId,
      });
      const setActiveAction = normalizeActionResult(setActiveResult);

      if (setActiveAction.ok) {
        restoredTenantSession = await resolveRestoredTenantSession(result, setActiveResult, client);
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

      const signupResult = await client.signUp.email({
        email: input.email,
        password: input.password,
        name: input.name,
      });

      const signupAction = normalizeActionResult(signupResult);

      if (!signupAction.ok) {
        return signupAction;
      }

      const organizationResult = await client.organization.create({
        name: organizationName,
        slug: slugifyOrganizationName(organizationName),
      });
      const organizationAction = normalizeActionResult(organizationResult);

      if (!organizationAction.ok) {
        return organizationAction;
      }

      const organizationId = stringValue(asRecord(asRecord(organizationResult)["data"])["id"]);

      if (organizationId.length === 0) {
        return {
          ok: false,
          message: "Organization was created without an active organization id.",
        };
      }

      const setActiveResult = await client.organization.setActive({
        organizationId,
      });
      const setActiveAction = normalizeActionResult(setActiveResult);

      if (setActiveAction.ok) {
        restoredTenantSession = await resolveRestoredTenantSession(signupResult, organizationResult, client);
      }

      return setActiveAction;
    },
    signOut: async () => {
      restoredTenantSession = null;
      return normalizeActionResult(await client.signOut());
    },
  };
}

function resolveAuthBaseUrl(app: "tenant" | "platform-admin") {
  const env = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env;
  const configured = env?.VITE_AUTH_BASE_URL?.trim() || env?.VITE_API_BASE_URL?.trim();

  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  return app === "platform-admin" ? "http://127.0.0.1:4010" : "http://127.0.0.1:4010";
}

function slugifyOrganizationName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Date.now().toString(36);

  return `${slug.length > 0 ? slug : "tenant"}-${suffix}`;
}

function normalizeSessionSnapshot(
  value: unknown,
  activeOrganizationValue: unknown,
  activeMemberValue: unknown,
): ZaraSessionSnapshot {
  const record = asRecord(value);
  const sessionRecord = asRecord(record["data"]);
  const activeOrganizationRecord = asRecord(activeOrganizationValue);
  const activeMemberRecord = asRecord(activeMemberValue);
  const data = normalizeAuthSession(
    sessionRecord,
    asRecord(activeOrganizationRecord["data"]),
    asRecord(activeMemberRecord["data"]),
  );
  const errorValue = record["error"];
  const session = asRecord(sessionRecord["session"]);
  const hasActiveOrganizationId = stringValue(session["activeOrganizationId"]).length > 0;
  const activeOrganizationPending = isPendingSnapshot(activeOrganizationRecord);
  const activeMemberPending = isPendingSnapshot(activeMemberRecord);

  return {
    data,
    isPending: isPendingSnapshot(record)
      || (hasActiveOrganizationId && (activeOrganizationPending || activeMemberPending)),
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

async function resolveRestoredTenantSession(
  authResult: unknown,
  organizationResult: unknown,
  client: {
    organization: {
      getActiveMember: () => Promise<unknown>;
      getFullOrganization: () => Promise<unknown>;
    };
  },
): Promise<ZaraAuthSession | null> {
  const user = normalizeActionUser(authResult);

  if (user === null) {
    return null;
  }

  const organizationRecord = asRecord(asRecord(organizationResult)["data"]);
  const activeMemberRecord = asRecord(asRecord(await safeAuthResult(() => client.organization.getActiveMember()))["data"]);
  const organization = normalizeOrganization(organizationRecord, activeMemberRecord, user.id)
    ?? normalizeOrganization(
      asRecord(asRecord(await safeAuthResult(() => client.organization.getFullOrganization()))["data"]),
      {},
      user.id,
    );

  if (organization === null) {
    return null;
  }

  return {
    user,
    organization,
  };
}

async function safeAuthResult(callback: () => Promise<unknown>) {
  try {
    const result = await callback();
    const action = normalizeActionResult(result);

    return action.ok ? result : null;
  } catch {
    return null;
  }
}

function normalizeActionUser(value: unknown): ZaraAuthUser | null {
  const userRecord = asRecord(asRecord(value)["data"])["user"];
  const user = asRecord(userRecord);
  const id = stringValue(user["id"]);
  const email = stringValue(user["email"]);
  const name = stringValue(user["name"]) || email;

  if (id.length === 0 || email.length === 0) {
    return null;
  }

  return {
    id,
    email,
    name,
  };
}

function sameUser(left: ZaraAuthUser, right: ZaraAuthUser) {
  return left.id === right.id || left.email === right.email;
}

function firstOrganizationId(value: unknown) {
  const organizations = asRecord(value)["data"];

  if (!Array.isArray(organizations)) {
    return "";
  }

  for (const organization of organizations) {
    const id = stringValue(asRecord(organization)["id"]);

    if (id.length > 0) {
      return id;
    }
  }

  return "";
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
      ?? userRecord["platformRole"]
      ?? userRecord["role"],
    ),
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
