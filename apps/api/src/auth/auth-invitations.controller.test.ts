import { describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AppModule } from "../app.module";

describe("Auth invitations controller", () => {
  it("creates and accepts an existing-user invitation with workspace access and audit context", async () => {
    const app = await createTestApp();
    const ownerAgent = request.agent(app.getHttpServer());
    const invitedAgent = request.agent(app.getHttpServer());
    const suffix = Date.now();
    const invitedEmail = `invited-existing-${suffix}@example.com`;

    try {
      const ownerSignup = await ownerAgent
        .post("/api/auth/onboarding/signup")
        .send({
          email: `invite-owner-${suffix}@example.com`,
          password: "password123",
          name: "Tenant Owner",
          organizationName: `Invite Voice Ops ${suffix}`,
        });

      expect(ownerSignup.status).toBe(200);

      const invitedSignup = await invitedAgent
        .post("/api/auth/sign-up/email")
        .send({
          email: invitedEmail,
          password: "password123",
          name: "Invited Operator",
        });

      expect(invitedSignup.status).toBe(200);

      const invitationResponse = await ownerAgent
        .post("/api/auth/invitations")
        .send({
          organizationId: ownerSignup.body.activeOrganization.id,
          email: invitedEmail,
          role: "operator",
          workspaceAccess: {
            workspaceId: "workspace-default",
            role: "operator",
          },
        });

      expect(invitationResponse.status).toBe(201);
      expect(invitationResponse.body).toMatchObject({
        ok: true,
        invitation: {
          email: invitedEmail,
          organizationId: ownerSignup.body.activeOrganization.id,
          role: "operator",
          status: "pending",
          workspaceAccess: {
            workspaceId: "workspace-default",
            role: "operator",
          },
          audit: expect.arrayContaining([
            expect.objectContaining({
              action: "invitation.created",
              actorUserId: ownerSignup.body.user.id,
            }),
          ]),
        },
      });

      const acceptResponse = await invitedAgent
        .post(`/api/auth/invitations/${invitationResponse.body.invitation.id}/accept`)
        .send({});

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body).toMatchObject({
        ok: true,
        invitation: {
          id: invitationResponse.body.invitation.id,
          status: "accepted",
          audit: expect.arrayContaining([
            expect.objectContaining({
              action: "invitation.accepted",
              actorUserId: invitedSignup.body.user.id,
            }),
            expect.objectContaining({
              action: "workspace_access.granted",
              actorUserId: invitedSignup.body.user.id,
            }),
          ]),
        },
        user: {
          id: invitedSignup.body.user.id,
          email: invitedEmail,
        },
        activeOrganization: {
          id: ownerSignup.body.activeOrganization.id,
          name: ownerSignup.body.activeOrganization.name,
          role: "operator",
        },
        activeWorkspace: {
          id: "workspace-default",
          name: "Default workspace",
        },
      });

      const contextResponse = await invitedAgent.get("/api/auth/context");

      expect(contextResponse.status).toBe(200);
      expect(contextResponse.body).toMatchObject({
        authenticated: true,
        activeOrganization: {
          id: ownerSignup.body.activeOrganization.id,
          role: "operator",
        },
        activeWorkspace: {
          id: "workspace-default",
        },
      });

      const workspaceResponse = await request(app.getHttpServer())
        .get(`/organizations/${ownerSignup.body.activeOrganization.id}/workspaces/state`);

      expect(workspaceResponse.status).toBe(200);
      expect(workspaceResponse.body.memberships).toEqual(expect.arrayContaining([
        expect.objectContaining({
          workspaceId: "workspace-default",
          tenantId: ownerSignup.body.activeOrganization.id,
          userId: invitedSignup.body.user.id,
          role: "operator",
        }),
      ]));
      expect(workspaceResponse.body.auditEntries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          workspaceId: "workspace-default",
          actorUserId: invitedSignup.body.user.id,
          action: "membership.granted",
        }),
      ]));
    } finally {
      await app.close();
    }
  }, 15_000);

  it("accepts an invitation by creating a new user through the auth flow", async () => {
    const app = await createTestApp();
    const ownerAgent = request.agent(app.getHttpServer());
    const invitedAgent = request.agent(app.getHttpServer());
    const suffix = Date.now();
    const invitedEmail = `invited-new-${suffix}@example.com`;

    try {
      const ownerSignup = await ownerAgent
        .post("/api/auth/onboarding/signup")
        .send({
          email: `invite-new-owner-${suffix}@example.com`,
          password: "password123",
          name: "Tenant Owner",
          organizationName: `New Invite Voice Ops ${suffix}`,
        });

      expect(ownerSignup.status).toBe(200);

      const invitationResponse = await ownerAgent
        .post("/api/auth/invitations")
        .send({
          organizationId: ownerSignup.body.activeOrganization.id,
          email: invitedEmail,
          role: "builder",
          workspaceAccess: {
            workspaceId: "workspace-default",
            role: "builder",
          },
        });

      expect(invitationResponse.status).toBe(201);

      const acceptResponse = await invitedAgent
        .post(`/api/auth/invitations/${invitationResponse.body.invitation.id}/accept`)
        .send({
          email: invitedEmail,
          password: "password123",
          name: "New Builder",
        });

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.headers["set-cookie"]).toEqual(
        expect.arrayContaining([expect.stringContaining("better-auth.session_token=")]),
      );
      expect(acceptResponse.body).toMatchObject({
        ok: true,
        user: {
          email: invitedEmail,
          name: "New Builder",
        },
        activeOrganization: {
          id: ownerSignup.body.activeOrganization.id,
          name: ownerSignup.body.activeOrganization.name,
          role: "builder",
        },
        activeWorkspace: {
          id: "workspace-default",
        },
      });
    } finally {
      await app.close();
    }
  }, 15_000);

  it("fails safely for wrong-email and already-accepted invitations", async () => {
    const app = await createTestApp();
    const ownerAgent = request.agent(app.getHttpServer());
    const intendedAgent = request.agent(app.getHttpServer());
    const wrongAgent = request.agent(app.getHttpServer());
    const suffix = Date.now();
    const intendedEmail = `intended-${suffix}@example.com`;

    try {
      const ownerSignup = await ownerAgent
        .post("/api/auth/onboarding/signup")
        .send({
          email: `invite-failure-owner-${suffix}@example.com`,
          password: "password123",
          name: "Tenant Owner",
          organizationName: `Failure Invite Ops ${suffix}`,
        });

      expect(ownerSignup.status).toBe(200);

      const invitationResponse = await ownerAgent
        .post("/api/auth/invitations")
        .send({
          organizationId: ownerSignup.body.activeOrganization.id,
          email: intendedEmail,
          role: "viewer",
        });

      expect(invitationResponse.status).toBe(201);

      const wrongSignup = await wrongAgent
        .post("/api/auth/sign-up/email")
        .send({
          email: `wrong-${suffix}@example.com`,
          password: "password123",
          name: "Wrong Recipient",
        });

      expect(wrongSignup.status).toBe(200);

      const wrongAcceptResponse = await wrongAgent
        .post(`/api/auth/invitations/${invitationResponse.body.invitation.id}/accept`)
        .send({});

      expect(wrongAcceptResponse.status).toBe(403);
      expect(wrongAcceptResponse.body).toMatchObject({
        ok: false,
        code: "invitation_email_mismatch",
        recoverable: false,
      });

      const intendedSignup = await intendedAgent
        .post("/api/auth/sign-up/email")
        .send({
          email: intendedEmail,
          password: "password123",
          name: "Intended Recipient",
        });

      expect(intendedSignup.status).toBe(200);

      const acceptedResponse = await intendedAgent
        .post(`/api/auth/invitations/${invitationResponse.body.invitation.id}/accept`)
        .send({});

      expect(acceptedResponse.status).toBe(200);

      const secondAcceptResponse = await intendedAgent
        .post(`/api/auth/invitations/${invitationResponse.body.invitation.id}/accept`)
        .send({});

      expect(secondAcceptResponse.status).toBe(409);
      expect(secondAcceptResponse.body).toMatchObject({
        ok: false,
        code: "invitation_already_accepted",
        recoverable: false,
      });
    } finally {
      await app.close();
    }
  }, 15_000);

  it("fails safely for revoked, cross-tenant, and expired invitations", async () => {
    const app = await createTestApp();
    const ownerAgent = request.agent(app.getHttpServer());
    const otherOwnerAgent = request.agent(app.getHttpServer());
    const invitedAgent = request.agent(app.getHttpServer());
    const expiredAgent = request.agent(app.getHttpServer());
    const suffix = Date.now();
    const invitedEmail = `revoked-${suffix}@example.com`;
    const expiredEmail = `expired-${suffix}@example.com`;

    try {
      const ownerSignup = await ownerAgent
        .post("/api/auth/onboarding/signup")
        .send({
          email: `invite-revoke-owner-${suffix}@example.com`,
          password: "password123",
          name: "Tenant Owner",
          organizationName: `Revoke Invite Ops ${suffix}`,
        });
      const otherOwnerSignup = await otherOwnerAgent
        .post("/api/auth/onboarding/signup")
        .send({
          email: `other-invite-owner-${suffix}@example.com`,
          password: "password123",
          name: "Other Owner",
          organizationName: `Other Invite Ops ${suffix}`,
        });

      expect(ownerSignup.status).toBe(200);
      expect(otherOwnerSignup.status).toBe(200);

      const invitationResponse = await ownerAgent
        .post("/api/auth/invitations")
        .send({
          organizationId: ownerSignup.body.activeOrganization.id,
          email: invitedEmail,
          role: "operator",
        });

      expect(invitationResponse.status).toBe(201);

      const crossTenantRevokeResponse = await otherOwnerAgent
        .post(`/api/auth/invitations/${invitationResponse.body.invitation.id}/revoke`)
        .send({});

      expect(crossTenantRevokeResponse.status).toBe(403);
      expect(crossTenantRevokeResponse.body).toMatchObject({
        ok: false,
        code: "invitation_forbidden",
        recoverable: false,
      });

      const revokeResponse = await ownerAgent
        .post(`/api/auth/invitations/${invitationResponse.body.invitation.id}/revoke`)
        .send({});

      expect(revokeResponse.status).toBe(200);
      expect(revokeResponse.body).toMatchObject({
        ok: true,
        invitation: {
          id: invitationResponse.body.invitation.id,
          status: "revoked",
          audit: expect.arrayContaining([
            expect.objectContaining({
              action: "invitation.revoked",
              actorUserId: ownerSignup.body.user.id,
            }),
          ]),
        },
      });

      const invitedSignup = await invitedAgent
        .post("/api/auth/sign-up/email")
        .send({
          email: invitedEmail,
          password: "password123",
          name: "Revoked Recipient",
        });

      expect(invitedSignup.status).toBe(200);

      const revokedAcceptResponse = await invitedAgent
        .post(`/api/auth/invitations/${invitationResponse.body.invitation.id}/accept`)
        .send({});

      expect(revokedAcceptResponse.status).toBe(410);
      expect(revokedAcceptResponse.body).toMatchObject({
        ok: false,
        code: "invitation_revoked",
        recoverable: false,
      });

      const expiredInvitationResponse = await ownerAgent
        .post("/api/auth/invitations")
        .send({
          organizationId: ownerSignup.body.activeOrganization.id,
          email: expiredEmail,
          role: "viewer",
        });

      expect(expiredInvitationResponse.status).toBe(201);

      const expiredSignup = await expiredAgent
        .post("/api/auth/sign-up/email")
        .send({
          email: expiredEmail,
          password: "password123",
          name: "Expired Recipient",
        });

      expect(expiredSignup.status).toBe(200);

      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.now() + 49 * 60 * 60 * 1000));

      const expiredAcceptResponse = await expiredAgent
        .post(`/api/auth/invitations/${expiredInvitationResponse.body.invitation.id}/accept`)
        .send({});

      expect(expiredAcceptResponse.status).toBe(410);
      expect(expiredAcceptResponse.body).toMatchObject({
        ok: false,
        code: "invitation_expired",
        recoverable: false,
      });
    } finally {
      vi.useRealTimers();
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
