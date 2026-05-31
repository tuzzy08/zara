import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AppModule } from "../app.module";
import {
  clearAuthEmailDeliveriesForTests,
  getAuthEmailDeliveriesForTests,
} from "./auth-email-delivery";

describe("Auth account security controller", () => {
  it("normalizes password reset requests so account existence is not exposed", async () => {
    clearAuthEmailDeliveriesForTests();
    const app = await createTestApp();
    const email = `reset-known-${Date.now()}@example.com`;

    try {
      const signupResponse = await request(app.getHttpServer())
        .post("/api/auth/sign-up/email")
        .send({
          email,
          password: "password123",
          name: "Reset Known",
        });

      expect(signupResponse.status).toBe(200);

      const knownResponse = await request(app.getHttpServer())
        .post("/api/auth/account-security/password-reset/request")
        .send({
          email,
          redirectTo: "http://localhost:5173/reset-password",
        });
      const unknownResponse = await request(app.getHttpServer())
        .post("/api/auth/account-security/password-reset/request")
        .send({
          email: `missing-${Date.now()}@example.com`,
          redirectTo: "http://localhost:5173/reset-password",
        });

      expect(knownResponse.status).toBe(200);
      expect(unknownResponse.status).toBe(200);
      expect(knownResponse.body).toEqual({
        ok: true,
        delivery: "queued",
        message: "If this email exists in Zara, a password reset link has been sent.",
      });
      expect(unknownResponse.body).toEqual(knownResponse.body);
      expect(getAuthEmailDeliveriesForTests()).toEqual([
        expect.objectContaining({
          kind: "password_reset",
          to: email,
          subject: "Reset your Zara password",
          url: expect.stringContaining("/api/auth/reset-password/"),
        }),
      ]);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("queues verification email for the signed-in user's account", async () => {
    clearAuthEmailDeliveriesForTests();
    const app = await createTestApp();
    const agent = request.agent(app.getHttpServer());
    const email = `verify-${Date.now()}@example.com`;

    try {
      const signupResponse = await agent
        .post("/api/auth/sign-up/email")
        .send({
          email,
          password: "password123",
          name: "Verify User",
        });

      expect(signupResponse.status).toBe(200);

      const response = await agent
        .post("/api/auth/account-security/email-verification/request")
        .send({
          callbackURL: "http://localhost:5173/settings",
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        delivery: "queued",
      });
      expect(getAuthEmailDeliveriesForTests()).toEqual([
        expect.objectContaining({
          kind: "email_verification",
          to: email,
          subject: "Verify your Zara email",
          url: expect.stringContaining("/api/auth/verify-email?token="),
        }),
      ]);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("lists safe session metadata and revokes a selected session without exposing tokens", async () => {
    const app = await createTestApp();
    const firstAgent = request.agent(app.getHttpServer());
    const secondAgent = request.agent(app.getHttpServer());
    const email = `sessions-${Date.now()}@example.com`;

    try {
      const signupResponse = await firstAgent
        .post("/api/auth/sign-up/email")
        .set("user-agent", "First browser")
        .send({
          email,
          password: "password123",
          name: "Session User",
        });
      const signinResponse = await secondAgent
        .post("/api/auth/sign-in/email")
        .set("user-agent", "Second browser")
        .send({
          email,
          password: "password123",
        });

      expect(signupResponse.status).toBe(200);
      expect(signinResponse.status).toBe(200);

      const listResponse = await firstAgent.get("/api/auth/account-security/sessions");

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.sessions).toHaveLength(2);
      expect(listResponse.body.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          current: true,
          userAgent: "First browser",
        }),
        expect.objectContaining({
          id: expect.any(String),
          current: false,
          userAgent: "Second browser",
        }),
      ]));
      expect(JSON.stringify(listResponse.body.sessions)).not.toContain("token");

      const sessionToRevoke = listResponse.body.sessions.find((session: { current: boolean }) => !session.current);

      expect(sessionToRevoke).toBeDefined();

      const revokeResponse = await firstAgent
        .post(`/api/auth/account-security/sessions/${encodeURIComponent(sessionToRevoke.id)}/revoke`)
        .send();

      expect(revokeResponse.status).toBe(200);
      expect(revokeResponse.body).toEqual({ ok: true });

      const revokedContextResponse = await secondAgent.get("/api/auth/context");

      expect(revokedContextResponse.status).toBe(200);
      expect(revokedContextResponse.body).toMatchObject({
        authenticated: false,
        user: null,
        activeOrganization: null,
        activeWorkspace: null,
        platformRole: null,
      });
    } finally {
      await app.close();
    }
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
