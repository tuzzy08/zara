import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "@zara/core";
import request from "supertest";

import { AppModule } from "../app.module";

describe("Auth context controller", () => {
  it("returns a safe signed-out auth context", async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer()).get("/api/auth/context");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      authenticated: false,
      user: null,
      activeOrganization: null,
      memberships: [],
      activeWorkspace: null,
      platformRole: null,
      platformAuth: {
        role: null,
        assuranceLevel: "none",
        sessionAgeSeconds: null,
        mfaVerified: false,
        passkeyVerified: false,
        mutationAllowed: false,
        supportActionAllowed: false,
        impersonationSafe: false,
        reason: "signed_out",
      },
      permissions: {
        tenant: [],
        platform: [],
      },
    });

    await app.close();
  }, 15_000);

  it("returns the active tenant organization, membership, and default workspace for a signed-in tenant", async () => {
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `auth-context-${Date.now()}@example.com`;

    const signupResponse = await agent
      .post("/api/auth/onboarding/signup")
      .send({
        email,
        password: "password123",
        name: "Tenant Owner",
        organizationName: "Acme Voice Ops",
      });

    expect(signupResponse.status).toBe(200);

    const response = await agent.get("/api/auth/context");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      authenticated: true,
      user: {
        email,
        name: "Tenant Owner",
      },
      activeOrganization: {
        id: signupResponse.body.activeOrganization.id,
        name: "Acme Voice Ops",
        role: "owner",
      },
      memberships: [
        {
          organizationId: signupResponse.body.activeOrganization.id,
          role: "owner",
        },
      ],
      activeWorkspace: {
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
      },
      platformRole: null,
    });
    expect(response.body.permissions.tenant).toEqual(expect.arrayContaining([
      "workflow:read",
      "workflow:write",
      "workflow:publish",
      "telephony:write",
    ]));
    expect(response.body.permissions.platform).toEqual([]);

    await app.close();
  }, 15_000);

  it("repairs default workspace ownership when an active tenant owner has no workspace membership", async () => {
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `auth-context-no-workspace-${Date.now()}@example.com`;

    const signupResponse = await agent
      .post("/api/auth/sign-up/email")
      .send({
        email,
        password: "password123",
        name: "Tenant Owner",
      });

    expect(signupResponse.status).toBe(200);

    const organizationResponse = await agent
      .post("/api/auth/organization/create")
      .send({
        name: "No Workspace Tenant",
        slug: `no-workspace-tenant-${Date.now()}`,
      });

    expect(organizationResponse.status).toBe(200);

    const response = await agent.get("/api/auth/context");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      authenticated: true,
      activeOrganization: {
        id: organizationResponse.body.id,
        name: "No Workspace Tenant",
        role: "owner",
      },
      activeWorkspace: {
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
      },
    });
    const workspaceStateResponse = await agent.get(
      `/organizations/${organizationResponse.body.id}/workspaces/state`,
    );

    expect(workspaceStateResponse.status).toBe(200);
    expect(workspaceStateResponse.body.memberships).toContainEqual(expect.objectContaining({
      tenantId: organizationResponse.body.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: response.body.user.id,
      role: "owner",
    }));

    await app.close();
  }, 15_000);

  it("returns an authenticated context without tenant data when no organization is active", async () => {
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `auth-context-no-org-${Date.now()}@example.com`;

    const signupResponse = await agent
      .post("/api/auth/sign-up/email")
      .send({
        email,
        password: "password123",
        name: "Tenant User",
      });

    expect(signupResponse.status).toBe(200);

    const response = await agent.get("/api/auth/context");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      authenticated: true,
      user: {
        email,
        name: "Tenant User",
      },
      activeOrganization: null,
      memberships: [],
      activeWorkspace: null,
      platformRole: null,
      permissions: {
        tenant: [],
        platform: [],
      },
    });

    await app.close();
  }, 15_000);

  it("returns tenant memberships without choosing an active organization for multi-tenant users", async () => {
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `auth-context-multi-org-${Date.now()}@example.com`;

    const signupResponse = await agent
      .post("/api/auth/sign-up/email")
      .send({
        email,
        password: "password123",
        name: "Tenant User",
      });

    expect(signupResponse.status).toBe(200);

    const firstOrganizationResponse = await agent
      .post("/api/auth/organization/create")
      .send({
        name: "Acme Voice Ops",
        slug: `acme-voice-ops-${Date.now()}`,
        keepCurrentActiveOrganization: true,
      });

    expect(firstOrganizationResponse.status).toBe(200);

    const secondOrganizationResponse = await agent
      .post("/api/auth/organization/create")
      .send({
        name: "Northwind Support",
        slug: `northwind-support-${Date.now()}`,
        keepCurrentActiveOrganization: true,
      });

    expect(secondOrganizationResponse.status).toBe(200);

    const response = await agent.get("/api/auth/context");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      authenticated: true,
      user: {
        email,
      },
      activeOrganization: null,
      activeWorkspace: null,
      memberships: expect.arrayContaining([
        {
          organizationId: firstOrganizationResponse.body.id,
          organizationName: "Acme Voice Ops",
          role: "owner",
        },
        {
          organizationId: secondOrganizationResponse.body.id,
          organizationName: "Northwind Support",
          role: "owner",
        },
      ]),
    });

    await app.close();
  }, 15_000);

  it("returns signed-in platform role context without granting tenant access", async () => {
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `auth-context-platform-${Date.now()}@example.com`;

    const signupResponse = await agent
      .post("/api/auth/sign-up/email")
      .send({
        email,
        password: "password123",
        name: "Platform Staff",
      });

    expect(signupResponse.status).toBe(200);

    const response = await agent
      .get("/api/auth/context")
      .set("x-zara-test-platform-role", "platform_admin")
      .set("x-zara-test-auth-assurance", "mfa")
      .set("x-zara-test-session-authenticated-at", "2026-05-31T11:45:00.000Z")
      .set("x-zara-test-auth-now", "2026-05-31T12:00:00.000Z");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      authenticated: true,
      user: {
        email,
        name: "Platform Staff",
      },
      activeOrganization: null,
      memberships: [],
      activeWorkspace: null,
      platformRole: "platform_admin",
      platformAuth: {
        role: "platform_admin",
        assuranceLevel: "mfa",
        sessionAgeSeconds: 900,
        mfaVerified: true,
        passkeyVerified: false,
        mutationAllowed: true,
        supportActionAllowed: true,
        impersonationSafe: true,
        reason: "assured",
      },
    });
    expect(response.body.permissions.tenant).toEqual([]);
    expect(response.body.permissions.platform).toEqual(expect.arrayContaining([
      "platform:read",
      "platform:write",
    ]));

    await app.close();
  }, 15_000);

  it("resolves platform role from a configured staff email without tenant authority", async () => {
    const previousStaffRoles = process.env.ZARA_PLATFORM_STAFF_ROLES;
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `staff-context-${Date.now()}@zara.example`;

    process.env.ZARA_PLATFORM_STAFF_ROLES = `${email}=platform_support`;

    try {
      const signupResponse = await agent
        .post("/api/auth/sign-up/email")
        .send({
          email,
          password: "password123",
          name: "Staff Support",
        });

      expect(signupResponse.status).toBe(200);

      const response = await agent
        .get("/api/auth/context")
        .set("x-zara-test-auth-assurance", "password");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        authenticated: true,
        activeOrganization: null,
        memberships: [],
        platformRole: "platform_support",
        platformAuth: {
          role: "platform_support",
          assuranceLevel: "password",
          sessionAgeSeconds: expect.any(Number),
          mutationAllowed: false,
          supportActionAllowed: false,
          reason: "support_step_up_required",
        },
      });
    } finally {
      if (previousStaffRoles === undefined) {
        delete process.env.ZARA_PLATFORM_STAFF_ROLES;
      } else {
        process.env.ZARA_PLATFORM_STAFF_ROLES = previousStaffRoles;
      }
      await app.close();
    }
  }, 15_000);

  it("reports tenant-only sessions as missing platform authority", async () => {
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `auth-context-tenant-only-${Date.now()}@example.com`;

    const signupResponse = await agent
      .post("/api/auth/onboarding/signup")
      .send({
        email,
        password: "password123",
        name: "Tenant Owner",
        organizationName: "Tenant Only Voice Ops",
      });

    expect(signupResponse.status).toBe(200);

    const response = await agent
      .get("/api/auth/context")
      .set("x-zara-test-auth-assurance", "mfa")
      .set("x-zara-test-session-authenticated-at", "2026-05-31T11:45:00.000Z")
      .set("x-zara-test-auth-now", "2026-05-31T12:00:00.000Z");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      authenticated: true,
      activeOrganization: {
        role: "owner",
      },
      platformRole: null,
      platformAuth: {
        role: null,
        assuranceLevel: "mfa",
        sessionAgeSeconds: 900,
        mutationAllowed: false,
        supportActionAllowed: false,
        impersonationSafe: false,
        reason: "platform_role_required",
      },
    });

    await app.close();
  }, 15_000);
});

async function createTestApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return app;
}
