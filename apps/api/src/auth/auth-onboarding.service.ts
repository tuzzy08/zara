import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { slugifyWorkspaceName, type TenantRole } from "@zara/core";

import { WorkspacesService } from "../workspaces/workspaces.service";
import { PostgresPoolService } from "../database/postgres-pool.service";
import { resolveAuthDatabaseMode, zaraAuth } from "./better-auth.instance";
import { AuthOnboardingGateway, type AuthOnboardingHttpRequest, type AuthOnboardingHttpResponse, type AuthOnboardingSessionGateway } from "./auth-onboarding.gateway";

export interface AuthenticatedOnboardingUser {
  id: string;
  email: string;
  name: string;
}

export interface OnboardedOrganization {
  id: string;
  name: string;
  role: TenantRole;
}

export interface OnboardedWorkspace {
  id: string;
  name: string;
}

export interface AuthOnboardingSignupResponse {
  ok: true;
  onboarding: {
    status: "complete";
    resumed: boolean;
  };
  user: AuthenticatedOnboardingUser;
  activeOrganization: OnboardedOrganization;
  activeWorkspace: OnboardedWorkspace;
}

export interface VerificationRequiredResponse {
  ok: true;
  onboarding: { status: "verification_required" };
}

@Injectable()
export class AuthOnboardingService {
  private readonly onboardedTenantsBySlug = new Map<string, {
    organizationId: string;
    organizationName: string;
  }>();

  constructor(
    private readonly gateway: AuthOnboardingGateway,
    private readonly workspacesService: WorkspacesService,
    @Optional() private readonly postgres?: PostgresPoolService,
  ) {}

  async verificationStatus(request: AuthOnboardingHttpRequest) {
    const user = await this.requireVerifiedUser(request);
    return { ok: true, verified: true, email: user.email };
  }

  async complete(request: AuthOnboardingHttpRequest, response: AuthOnboardingHttpResponse) {
    const user = await this.requireVerifiedUser(request);
    const connection = resolveAuthDatabaseMode(process.env) === "postgres"
      ? await this.postgres!.pool.connect() : null;
    try {
      if (connection) {
        await connection.query("BEGIN");
        await connection.query("SET LOCAL lock_timeout = '5s'");
        await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`signup:${user.id}`]);
      }
      const result = await this.completeVerifiedUser(request, response);
      if (connection) await connection.query("COMMIT");
      return result;
    } catch (error) {
      if (connection) await connection.query("ROLLBACK");
      throw error;
    } finally { connection?.release(); }
  }

  private async requireVerifiedUser(request: AuthOnboardingHttpRequest) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join("; ") : value);
    }
    const session = await zaraAuth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!session) throw new UnauthorizedException("Open your verification email, or sign in to continue.");
    const context = await zaraAuth.$context;
    const user = await context.internalAdapter.findUserById(session.user.id);
    if (!user?.emailVerified) throw new UnauthorizedException("Verify your email before you continue.");
    return user;
  }

  private async completeVerifiedUser(request: AuthOnboardingHttpRequest, response: AuthOnboardingHttpResponse) {
    const user = await this.requireVerifiedUser(request);
    const context = await zaraAuth.$context;
    const name = stringValue(asRecord(user).signupOrganizationName);
    const slug = slugifyWorkspaceName(name);
    if (!slug) throw recoverableOnboardingError("organization", "Your saved setup details are unavailable. Contact Zara support.");
    const session = this.gateway.createSession(request, response);
    const organizations = await session.listOrganizations();
    if (!organizations.ok) throw recoverableOnboardingError("organization", organizations.message);
    const savedId = stringValue(asRecord(user).signupOrganizationId);
    let organization = organizations.body.map(asRecord).find((item) => savedId
      ? item.id === savedId : item.slug === slug);
    if (!organization && savedId) throw new UnauthorizedException("You no longer have access to this organization.");
    if (!organization) {
      const created = await session.createOrganization({ name, slug });
      if (!created.ok) {
        if (isOrganizationSlugTaken(created.message)) throw tenantNameUnavailable();
        throw recoverableOnboardingError("organization", created.message);
      }
      organization = asRecord(created.body);
    }
    const activeOrganization = normalizeOrganization(organization);
    const member = await context.adapter.findOne<{ role: string }>({ model: "member", where: [
      { field: "organizationId", value: activeOrganization.id }, { field: "userId", value: user.id },
    ] });
    if (member?.role !== "owner") throw new UnauthorizedException("Organization owner access is required.");
    await context.internalAdapter.updateUser(user.id, { signupOrganizationId: activeOrganization.id });
    const selected = await session.setActiveOrganization({ organizationId: activeOrganization.id });
    if (!selected.ok) throw recoverableOnboardingError("active_organization", selected.message);
    const activeWorkspace = await this.ensureDefaultWorkspaceOwner({ organizationId: activeOrganization.id, userId: user.id });
    return {
      ok: true, onboarding: { status: "complete", resumed: Boolean(savedId) },
      user: { id: user.id, email: user.email, name: user.name },
      activeOrganization: { ...activeOrganization, role: "owner" }, activeWorkspace,
    };
  }

  async signup(
    request: AuthOnboardingHttpRequest,
    response: AuthOnboardingHttpResponse,
    input: unknown,
  ): Promise<AuthOnboardingSignupResponse | VerificationRequiredResponse> {
    const normalizedInput = normalizeSignupInput(input);
    const slug = slugifyWorkspaceName(normalizedInput.organizationName);

    if (slug.length === 0) {
      throw new BadRequestException({
        ok: false,
        code: "tenant_name_required",
        recoverable: false,
        message: "Enter a tenant organization name to create your Zara account.",
      });
    }

    const session = this.gateway.createSession(request, response);
    const existingTenant = this.onboardedTenantsBySlug.get(slug);

    if (existingTenant !== undefined) {
      return this.resumeExistingTenantOnboarding({
        session,
        email: normalizedInput.email,
        password: normalizedInput.password,
        organizationId: existingTenant.organizationId,
        organizationName: existingTenant.organizationName,
      });
    }

    const authResult = await this.authenticateForOnboarding(session, normalizedInput);
    if (authResult === null) {
      return { ok: true, onboarding: { status: "verification_required" } };
    }
    const user = normalizeUser(authResult.body);
    const slugCheckResult = await session.checkOrganizationSlug({ slug });

    if (!slugCheckResult.ok) {
      if (isOrganizationSlugTaken(slugCheckResult.message)) {
        throw tenantNameUnavailable();
      }

      throw recoverableOnboardingError("organization", slugCheckResult.message);
    }

    if (slugCheckResult.body.status === false) {
      throw tenantNameUnavailable();
    }

    const organizationResult = await session.createOrganization({
      name: normalizedInput.organizationName,
      slug,
    });

    if (!organizationResult.ok) {
      if (isOrganizationSlugTaken(organizationResult.message)) {
        throw tenantNameUnavailable();
      }

      throw recoverableOnboardingError("organization", organizationResult.message);
    }

    const activeOrganization = normalizeOrganization(organizationResult.body);
    this.onboardedTenantsBySlug.set(slug, {
      organizationId: activeOrganization.id,
      organizationName: activeOrganization.name,
    });

    const setActiveResult = await session.setActiveOrganization({
      organizationId: activeOrganization.id,
    });

    if (!setActiveResult.ok) {
      throw recoverableOnboardingError("active_organization", setActiveResult.message);
    }

    const activeWorkspace = await this.ensureDefaultWorkspaceOwner({
      organizationId: activeOrganization.id,
      userId: user.id,
    });

    return {
      ok: true,
      onboarding: {
        status: "complete",
        resumed: authResult.resumed,
      },
      user,
      activeOrganization: {
        ...activeOrganization,
        role: "owner" as const,
      },
      activeWorkspace,
    };
  }

  private async authenticateForOnboarding(
    session: AuthOnboardingSessionGateway,
    input: NormalizedSignupInput,
  ) {
    if (input.resume) {
      const result = await session.signInEmail({
        email: input.email,
        password: input.password,
        ...(input.callbackURL ? { callbackURL: input.callbackURL } : {}),
      });
      if (!result.ok) {
        if (asRecord(result.body)["code"] === "EMAIL_NOT_VERIFIED") return null;
        throw new BadRequestException({ ok: false, message: result.message });
      }
      return { body: result.body, resumed: true };
    }
    const signupResult = await session.signUpEmail({
      email: input.email,
      password: input.password,
      name: input.name,
      organizationName: input.organizationName,
      ...(input.callbackURL ? { callbackURL: input.callbackURL } : {}),
    });

    if (signupResult.ok) {
      if (asRecord(signupResult.body)["token"] === null) return null;
      return {
        body: signupResult.body,
        resumed: false,
      };
    }

    const signinResult = await session.signInEmail({
      email: input.email,
      password: input.password,
    });

    if (signinResult.ok) {
      return {
        body: signinResult.body,
        resumed: true,
      };
    }

    throw new BadRequestException({
      ok: false,
      code: "tenant_onboarding_auth_failed",
      recoverable: false,
      message: signupResult.message,
    });
  }

  private async resumeExistingTenantOnboarding(input: {
    session: AuthOnboardingSessionGateway;
    email: string;
    password: string;
    organizationId: string;
    organizationName: string;
  }): Promise<AuthOnboardingSignupResponse> {
    const signinResult = await input.session.signInEmail({
      email: input.email,
      password: input.password,
    });

    if (!signinResult.ok) {
      throw tenantNameUnavailable();
    }

    const organizationsResult = await input.session.listOrganizations();

    if (!organizationsResult.ok) {
      throw tenantNameUnavailable();
    }

    const hasExistingMembership = organizationsResult.body.some(
      (organization) => stringValue(asRecord(organization)["id"]) === input.organizationId,
    );

    if (!hasExistingMembership) {
      throw tenantNameUnavailable();
    }

    const user = normalizeUser(signinResult.body);
    const setActiveResult = await input.session.setActiveOrganization({
      organizationId: input.organizationId,
    });

    if (!setActiveResult.ok) {
      throw recoverableOnboardingError("active_organization", setActiveResult.message);
    }

    const activeWorkspace = await this.ensureDefaultWorkspaceOwner({
      organizationId: input.organizationId,
      userId: user.id,
    });

    return {
      ok: true,
      onboarding: {
        status: "complete",
        resumed: true,
      },
      user,
      activeOrganization: {
        id: input.organizationId,
        name: input.organizationName,
        role: "owner" as const,
      },
      activeWorkspace,
    };
  }

  private async ensureDefaultWorkspaceOwner(input: {
    organizationId: string;
    userId: string;
  }) {
    const workspace = await this.workspacesService.ensureDefaultMembership({
      organizationId: input.organizationId, userId: input.userId, role: "owner",
    });
    if (workspace === null) {
      throw recoverableOnboardingError("workspace", "Default workspace access is unavailable. Contact your organization owner.");
    }

    return {
      id: workspace.id,
      name: workspace.name,
    };
  }
}

interface NormalizedSignupInput {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  resume: boolean;
  callbackURL: string;
}

function normalizeSignupInput(input: unknown): NormalizedSignupInput {
  const record = asRecord(input);

  return {
    email: stringValue(record["email"]).trim().toLowerCase(),
    password: stringValue(record["password"]),
    name: stringValue(record["name"]).trim(),
    organizationName: stringValue(record["organizationName"]).trim(),
    resume: record["resume"] === true,
    callbackURL: stringValue(record["callbackURL"]),
  };
}

function normalizeUser(value: unknown): AuthenticatedOnboardingUser {
  const user = asRecord(asRecord(value)["user"]);
  const id = stringValue(user["id"]);
  const email = stringValue(user["email"]);
  const name = stringValue(user["name"]) || email;

  if (id.length === 0 || email.length === 0) {
    throw recoverableOnboardingError("user", "Authentication completed without a usable user payload.");
  }

  return {
    id,
    email,
    name,
  };
}

function normalizeOrganization(value: unknown): Omit<OnboardedOrganization, "role"> {
  const organization = asRecord(value);
  const id = stringValue(organization["id"]);
  const name = stringValue(organization["name"]);

  if (id.length === 0 || name.length === 0) {
    throw recoverableOnboardingError("organization", "Organization was created without a usable organization payload.");
  }

  return {
    id,
    name,
  };
}

function tenantNameUnavailable() {
  return new ConflictException({
    ok: false,
    code: "tenant_name_unavailable",
    recoverable: false,
    message: "That tenant organization name is already in use. Choose a different name.",
  });
}

function recoverableOnboardingError(stage: "user" | "organization" | "active_organization" | "workspace", message: string) {
  return new ConflictException({
    ok: false,
    code: "tenant_onboarding_recoverable",
    recoverable: true,
    onboarding: {
      status: "recoverable",
      stage,
    },
    message,
  });
}

function isOrganizationSlugTaken(message: string) {
  return message.toLowerCase().includes("organization slug already taken");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
