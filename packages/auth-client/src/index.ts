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

  return {
    useSession: () => normalizeSessionSnapshot(
      client.useSession(),
      client.useActiveOrganization(),
      client.useActiveMember(),
    ),
    signInEmail: async (input) => {
      const result = await client.signIn.email({
        email: input.email,
        password: input.password,
        callbackURL: input.callbackURL,
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

      return normalizeActionResult(await client.organization.setActive({
        organizationId,
      }));
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
        callbackURL: input.callbackURL,
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

      return normalizeActionResult(await client.organization.setActive({
        organizationId,
      }));
    },
    signOut: async () => normalizeActionResult(await client.signOut()),
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
  const activeOrganizationPending = activeOrganizationRecord["isPending"] === true
    || activeOrganizationRecord["isLoading"] === true;
  const activeMemberPending = activeMemberRecord["isPending"] === true
    || activeMemberRecord["isLoading"] === true;

  return {
    data,
    isPending: record["isPending"] === true
      || record["isLoading"] === true
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
    organization: normalizeOrganization(activeOrganization, activeMember),
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
): ZaraAuthOrganization | null {
  const id = stringValue(value["id"]);
  const name = stringValue(value["name"]);
  const role = normalizeTenantRole(activeMember["role"] ?? value["role"]);

  if (id.length === 0 || name.length === 0 || role === null) {
    return null;
  }

  return { id, name, role };
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
