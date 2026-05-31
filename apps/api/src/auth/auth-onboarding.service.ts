import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { slugifyWorkspaceName, type TenantRole } from "@zara/core";

import { WorkspacesService } from "../workspaces/workspaces.service";
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

@Injectable()
export class AuthOnboardingService {
  private readonly onboardedTenantsBySlug = new Map<string, {
    organizationId: string;
    organizationName: string;
  }>();

  constructor(
    private readonly gateway: AuthOnboardingGateway,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async signup(
    request: AuthOnboardingHttpRequest,
    response: AuthOnboardingHttpResponse,
    input: unknown,
  ): Promise<AuthOnboardingSignupResponse> {
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

    const activeWorkspace = this.ensureDefaultWorkspaceOwner({
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
    const signupResult = await session.signUpEmail({
      email: input.email,
      password: input.password,
      name: input.name,
    });

    if (signupResult.ok) {
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

    const activeWorkspace = this.ensureDefaultWorkspaceOwner({
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

  private ensureDefaultWorkspaceOwner(input: {
    organizationId: string;
    userId: string;
  }) {
    const state = this.workspacesService.getWorkspaceState(input.organizationId);
    const workspace = state.workspaces.find((candidate) => candidate.id === "workspace-support")
      ?? state.workspaces.find((candidate) => candidate.status === "active")
      ?? state.workspaces[0];

    if (workspace === undefined) {
      throw recoverableOnboardingError("workspace", "No default workspace is available for this tenant.");
    }

    this.workspacesService.setMembershipRole({
      organizationId: input.organizationId,
      workspaceId: workspace.id,
      userId: input.userId,
      role: "owner",
      actorUserId: input.userId,
    });

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
}

function normalizeSignupInput(input: unknown): NormalizedSignupInput {
  const record = asRecord(input);

  return {
    email: stringValue(record["email"]).trim().toLowerCase(),
    password: stringValue(record["password"]),
    name: stringValue(record["name"]).trim(),
    organizationName: stringValue(record["organizationName"]).trim(),
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
