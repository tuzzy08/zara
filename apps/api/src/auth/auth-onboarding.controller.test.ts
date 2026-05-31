import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AppModule } from "../app.module";
import { AuthOnboardingGateway } from "./auth-onboarding.gateway";

describe("Auth onboarding controller", () => {
  it("creates a complete tenant owner onboarding state in one product action", async () => {
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `onboarding-owner-${Date.now()}@example.com`;

    try {
      const response = await agent
        .post("/api/auth/onboarding/signup")
        .send({
          email,
          password: "password123",
          name: "Tenant Owner",
          organizationName: "Acme Voice Ops",
        });

      expect(response.status).toBe(200);
      expect(response.headers["set-cookie"]).toEqual(
        expect.arrayContaining([expect.stringContaining("better-auth.session_token=")]),
      );
      expect(response.body).toMatchObject({
        ok: true,
        onboarding: {
          status: "complete",
          resumed: false,
        },
        user: {
          email,
          name: "Tenant Owner",
        },
        activeOrganization: {
          name: "Acme Voice Ops",
          role: "owner",
        },
        activeWorkspace: {
          id: "workspace-support",
          name: "Support",
        },
      });

      const contextResponse = await agent.get("/api/auth/context");

      expect(contextResponse.status).toBe(200);
      expect(contextResponse.body).toMatchObject({
        authenticated: true,
        user: {
          email,
        },
        activeOrganization: {
          id: response.body.activeOrganization.id,
          role: "owner",
        },
        activeWorkspace: {
          id: "workspace-support",
        },
      });

      const workspaceResponse = await request(app.getHttpServer())
        .get(`/organizations/${response.body.activeOrganization.id}/workspaces/state`);

      expect(workspaceResponse.status).toBe(200);
      expect(workspaceResponse.body.memberships).toEqual(expect.arrayContaining([
        expect.objectContaining({
          workspaceId: "workspace-support",
          userId: response.body.user.id,
          role: "owner",
        }),
      ]));
    } finally {
      await app.close();
    }
  }, 15_000);

  it("rejects blank tenant organization names before creating a user", async () => {
    const app = await createTestApp();
    const email = `onboarding-blank-${Date.now()}@example.com`;

    try {
      const response = await request(app.getHttpServer())
        .post("/api/auth/onboarding/signup")
        .send({
          email,
          password: "password123",
          name: "Tenant Owner",
          organizationName: "   ",
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        ok: false,
        code: "tenant_name_required",
        recoverable: false,
      });
      expect(response.headers["set-cookie"]).toBeUndefined();

      const signinResponse = await request(app.getHttpServer())
        .post("/api/auth/sign-in/email")
        .send({
          email,
          password: "password123",
        });

      expect(signinResponse.status).not.toBe(200);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("rejects duplicate tenant organization names before creating another user", async () => {
    const app = await createTestApp();
    const organizationName = `Duplicate Voice Ops ${Date.now()}`;
    const firstEmail = `onboarding-duplicate-owner-${Date.now()}@example.com`;
    const secondEmail = `onboarding-duplicate-blocked-${Date.now()}@example.com`;

    try {
      const firstResponse = await request(app.getHttpServer())
        .post("/api/auth/onboarding/signup")
        .send({
          email: firstEmail,
          password: "password123",
          name: "Tenant Owner",
          organizationName,
        });

      expect(firstResponse.status).toBe(200);

      const secondResponse = await request(app.getHttpServer())
        .post("/api/auth/onboarding/signup")
        .send({
          email: secondEmail,
          password: "password123",
          name: "Blocked Owner",
          organizationName,
        });

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body).toMatchObject({
        ok: false,
        code: "tenant_name_unavailable",
        recoverable: false,
      });
      expect(secondResponse.headers["set-cookie"]).toBeUndefined();

      const signinResponse = await request(app.getHttpServer())
        .post("/api/auth/sign-in/email")
        .send({
          email: secondEmail,
          password: "password123",
        });

      expect(signinResponse.status).not.toBe(200);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("treats a repeated completed onboarding request as a resumed success for the same user", async () => {
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const organizationName = `Repeated Voice Ops ${Date.now()}`;
    const email = `onboarding-repeat-${Date.now()}@example.com`;

    try {
      const firstResponse = await agent
        .post("/api/auth/onboarding/signup")
        .send({
          email,
          password: "password123",
          name: "Repeat Owner",
          organizationName,
        });

      expect(firstResponse.status).toBe(200);

      const retryResponse = await agent
        .post("/api/auth/onboarding/signup")
        .send({
          email,
          password: "password123",
          name: "Repeat Owner",
          organizationName,
        });

      expect(retryResponse.status).toBe(200);
      expect(retryResponse.body).toMatchObject({
        ok: true,
        onboarding: {
          status: "complete",
          resumed: true,
        },
        user: {
          email,
        },
        activeOrganization: {
          id: firstResponse.body.activeOrganization.id,
          role: "owner",
        },
        activeWorkspace: {
          id: "workspace-support",
        },
      });
    } finally {
      await app.close();
    }
  }, 15_000);

  it("maps an auth-provider slug collision to an actionable duplicate tenant-name error", async () => {
    const gateway = createUnavailableSlugGateway();
    const app = await createTestApp(gateway);
    const email = `onboarding-slug-collision-${Date.now()}@example.com`;

    try {
      const response = await request(app.getHttpServer())
        .post("/api/auth/onboarding/signup")
        .send({
          email,
          password: "password123",
          name: "Collision Owner",
          organizationName: "Unavailable Voice Ops",
        });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        ok: false,
        code: "tenant_name_unavailable",
        recoverable: false,
      });
    } finally {
      await app.close();
    }
  }, 15_000);

  it("surfaces recoverable partial onboarding failures and resumes safely on retry", async () => {
    const gateway = createRecoverableOrganizationGateway();
    const app = await createTestApp(gateway);
    const email = `onboarding-retry-${Date.now()}@example.com`;

    try {
      const firstResponse = await request(app.getHttpServer())
        .post("/api/auth/onboarding/signup")
        .send({
          email,
          password: "password123",
          name: "Retry Owner",
          organizationName: "Retry Voice Ops",
        });

      expect(firstResponse.status).toBe(409);
      expect(firstResponse.body).toMatchObject({
        ok: false,
        code: "tenant_onboarding_recoverable",
        recoverable: true,
        onboarding: {
          status: "recoverable",
          stage: "organization",
        },
      });

      const retryResponse = await request(app.getHttpServer())
        .post("/api/auth/onboarding/signup")
        .send({
          email,
          password: "password123",
          name: "Retry Owner",
          organizationName: "Retry Voice Ops",
        });

      expect(retryResponse.status).toBe(200);
      expect(retryResponse.body).toMatchObject({
        ok: true,
        onboarding: {
          status: "complete",
          resumed: true,
        },
        user: {
          id: "user-retry-owner",
          email,
        },
        activeOrganization: {
          id: "org-retry-voice-ops",
          name: "Retry Voice Ops",
          role: "owner",
        },
        activeWorkspace: {
          id: "workspace-support",
          name: "Support",
        },
      });

      const workspaceResponse = await request(app.getHttpServer())
        .get("/organizations/org-retry-voice-ops/workspaces/state");

      expect(workspaceResponse.status).toBe(200);
      expect(workspaceResponse.body.memberships).toEqual(expect.arrayContaining([
        expect.objectContaining({
          workspaceId: "workspace-support",
          userId: "user-retry-owner",
          role: "owner",
        }),
      ]));
    } finally {
      await app.close();
    }
  }, 15_000);
});

async function createTestApp(authOnboardingGateway?: AuthOnboardingGateway) {
  const testingModuleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (authOnboardingGateway !== undefined) {
    testingModuleBuilder.overrideProvider(AuthOnboardingGateway).useValue(authOnboardingGateway);
  }

  const moduleRef = await testingModuleBuilder.compile();

  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return app;
}

function createUnavailableSlugGateway(): AuthOnboardingGateway {
  return {
    createSession: () => ({
      signUpEmail: async (input: { email: string }) => ({
        ok: true,
        status: 200,
        body: {
          user: {
            id: "user-collision-owner",
            name: "Collision Owner",
            email: input.email,
          },
        },
      }),
      signInEmail: async () => ({
        ok: false,
        status: 401,
        message: "Invalid credentials.",
        body: {
          message: "Invalid credentials.",
        },
      }),
      checkOrganizationSlug: async () => ({
        ok: false,
        status: 400,
        message: "Organization slug already taken",
        body: {
          message: "Organization slug already taken",
        },
      }),
      createOrganization: async () => ({
        ok: true,
        status: 200,
        body: {
          id: "org-unavailable-voice-ops",
          name: "Unavailable Voice Ops",
          slug: "unavailable-voice-ops",
        },
      }),
      listOrganizations: async () => ({
        ok: true,
        status: 200,
        body: [],
      }),
      setActiveOrganization: async () => ({
        ok: true,
        status: 200,
        body: {},
      }),
    }),
  } as unknown as AuthOnboardingGateway;
}

function createRecoverableOrganizationGateway(): AuthOnboardingGateway {
  let createOrganizationAttempts = 0;

  return {
    createSession: () => ({
      signUpEmail: async () => (
        createOrganizationAttempts === 0
          ? {
              ok: true,
              status: 200,
              body: {
                user: {
                  id: "user-retry-owner",
                  name: "Retry Owner",
                  email: "onboarding-retry@example.com",
                },
              },
            }
          : {
              ok: false,
              status: 409,
              message: "User already exists.",
              body: {
                message: "User already exists.",
              },
            }
      ),
      signInEmail: async (input) => ({
        ok: true,
        status: 200,
        body: {
          user: {
            id: "user-retry-owner",
            name: "Retry Owner",
            email: input.email,
          },
        },
      }),
      checkOrganizationSlug: async () => ({
        ok: true,
        status: 200,
        body: {
          status: true,
        },
      }),
      createOrganization: async () => {
        createOrganizationAttempts += 1;

        return createOrganizationAttempts === 1
          ? {
              ok: false,
              status: 503,
              message: "Organization creation failed after the user account was created.",
              body: {
                message: "Organization creation failed after the user account was created.",
              },
            }
          : {
              ok: true,
              status: 200,
              body: {
                id: "org-retry-voice-ops",
                name: "Retry Voice Ops",
                slug: "retry-voice-ops",
              },
            };
      },
      listOrganizations: async () => ({
        ok: true,
        status: 200,
        body: [],
      }),
      setActiveOrganization: async () => ({
        ok: true,
        status: 200,
        body: {},
      }),
    }),
  } satisfies AuthOnboardingGateway;
}
