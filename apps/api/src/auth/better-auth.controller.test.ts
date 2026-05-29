import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AppModule } from "../app.module";

describe("Better Auth controller", () => {
  it("mounts the Better Auth health endpoint under /api/auth", async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer()).get("/api/auth/ok");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    await app.close();
  }, 15_000);

  it("supports email signup followed by email signin", async () => {
    const app = await createTestApp();
    const email = `tenant-${Date.now()}@example.com`;

    const signupResponse = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .send({
        email,
        password: "password123",
        name: "Tenant Builder",
      });

    expect(signupResponse.status).toBe(200);
    expect(signupResponse.body.user).toMatchObject({
      email,
      name: "Tenant Builder",
    });
    expect(signupResponse.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringContaining("better-auth.session_token=")]),
    );

    const signinResponse = await request(app.getHttpServer())
      .post("/api/auth/sign-in/email")
      .send({
        email,
        password: "password123",
      });

    expect(signinResponse.status).toBe(200);
    expect(signinResponse.body.user).toMatchObject({
      email,
      name: "Tenant Builder",
    });
    expect(signinResponse.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringContaining("better-auth.session_token=")]),
    );

    await app.close();
  }, 15_000);

  it("creates an active owner organization for self-serve tenant signup", async () => {
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `tenant-owner-${Date.now()}@example.com`;

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
    expect(organizationResponse.body).toMatchObject({
      name: "Acme Voice Ops",
    });

    const setActiveResponse = await agent
      .post("/api/auth/organization/set-active")
      .send({
        organizationId: organizationResponse.body.id,
      });

    expect(setActiveResponse.status).toBe(200);

    const sessionResponse = await agent.get("/api/auth/get-session");

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body.user).toMatchObject({
      email,
      name: "Tenant Owner",
    });
    expect(sessionResponse.body.session).toMatchObject({
      activeOrganizationId: organizationResponse.body.id,
    });

    const activeOrganizationResponse = await agent.get("/api/auth/organization/get-full-organization");
    const activeMemberResponse = await agent.get("/api/auth/organization/get-active-member");

    expect(activeOrganizationResponse.status).toBe(200);
    expect(activeOrganizationResponse.body).toMatchObject({
      name: "Acme Voice Ops",
    });
    expect(activeMemberResponse.status).toBe(200);
    expect(activeMemberResponse.body).toMatchObject({
      organizationId: organizationResponse.body.id,
      role: "owner",
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
