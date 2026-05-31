import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
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
        name: "Acme Voice Ops",
        slug: `acme-voice-ops-${Date.now()}`,
      });

    expect(organizationResponse.status).toBe(200);

    const setActiveResponse = await agent
      .post("/api/auth/organization/set-active")
      .send({
        organizationId: organizationResponse.body.id,
      });

    expect(setActiveResponse.status).toBe(200);

    const response = await agent.get("/api/auth/context");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      authenticated: true,
      user: {
        email,
        name: "Tenant Owner",
      },
      activeOrganization: {
        id: organizationResponse.body.id,
        name: "Acme Voice Ops",
        role: "owner",
      },
      memberships: [
        {
          organizationId: organizationResponse.body.id,
          role: "owner",
        },
      ],
      activeWorkspace: {
        id: "workspace-support",
        name: "Support",
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
      .set("x-zara-platform-role", "platform_admin");

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
    });
    expect(response.body.permissions.tenant).toEqual([]);
    expect(response.body.permissions.platform).toEqual(expect.arrayContaining([
      "platform:read",
      "platform:write",
    ]));

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
