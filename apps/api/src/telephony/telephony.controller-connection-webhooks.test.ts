import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import request from "supertest";
import { computeTwilioWebhookSignature } from "@zara/core";
import { withTestTenantAuth } from "../testing/tenant-auth-request";
import { createTestingApp, createCapturingTwilioRoutingProvider, activateRouteWithOverride } from "./telephony.controller.test-support";

describe("TelephonyController connection-webhooks", () => {
  afterEach(() => {
      vi.restoreAllMocks();
    });

  it("requires tenant membership for telephony control routes and derives the actor from tenant auth", async () => {
      const unauthenticatedApp = await createTestingApp({ installTenantAuth: false });

      const unauthenticatedState = await request(unauthenticatedApp.getHttpServer()).get(
        "/organizations/tenant-west-africa/telephony/state",
      );

      expect(unauthenticatedState.status).toBe(401);
      await unauthenticatedApp.close();

      const app = await createTestingApp();
      const connectionResponse = await withTestTenantAuth(
        request(app.getHttpServer()).post("/organizations/tenant-west-africa/telephony/connections"),
        { userId: "user-server-derived" },
      ).send({
        actorUserId: "attacker-controlled-user",
        label: "Tenant Twilio account",
        ownershipMode: "platform_managed",
        provider: "twilio",
        region: "us-east-1",
        blockRoutingOnHealthFailure: true,
      });

      expect(connectionResponse.status).toBe(201);
      expect(connectionResponse.body.connection.createdBy).toBe("user-server-derived");
      await app.close();
    });

  it("connects a BYO Twilio account, imports voice numbers, assigns routing, validates health, and dispatches inbound calls", async () => {
      const twilioRouting = createCapturingTwilioRoutingProvider();
      const app = await createTestingApp({ twilioRouting });

      const initialStateResponse = await request(app.getHttpServer()).get(
        "/organizations/tenant-west-africa/telephony/state",
      );

      expect(initialStateResponse.status).toBe(200);
      expect(initialStateResponse.body.connections).toEqual([]);

      const credentialValidationResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections/validate-twilio-credentials")
        .send({
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
        });

      expect(credentialValidationResponse.status).toBe(200);
      expect(credentialValidationResponse.body).toEqual({ valid: true, numberCount: 3 });
      expect((await request(app.getHttpServer())
        .get("/organizations/tenant-west-africa/telephony/state")).body.connections).toEqual([]);

      const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          blockRoutingOnHealthFailure: true,
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
          recordingPolicy: {
            enabled: true,
            consentMode: "single-party",
            consentMessage: "This call may be recorded for quality assurance.",
          },
        });

      expect(connectResponse.status).toBe(201);
      expect(connectResponse.body.state.connections).toHaveLength(1);
      expect(connectResponse.body.state.connections[0]).toMatchObject({
        label: "Tenant Twilio account",
        ownershipMode: "byo_provider_account",
        provider: "twilio",
        webhookStatus: "configured",
      });
      expect(connectResponse.body.state.connections[0].credentialReference.preview.endsWith("7890")).toBe(true);
      expect(connectResponse.body.state.connections[0].secret).toBeUndefined();

      const connectionId = connectResponse.body.state.connections[0].id as string;

      const validateResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/validate`)
        .send({
          actorUserId: "user-ops-lead",
        });

      expect(validateResponse.status).toBe(200);
      expect(validateResponse.body.healthCheck.status).toBe("healthy");
      expect(validateResponse.body.healthCheck.blocking).toBe(false);

      const importResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({
          actorUserId: "user-ops-lead",
        });

      expect(importResponse.status).toBe(201);
      expect(importResponse.body.state.phoneNumbers).toHaveLength(2);
      expect(
        importResponse.body.state.phoneNumbers.every((phoneNumber: { voiceCapable: boolean }) => phoneNumber.voiceCapable),
      ).toBe(true);

      const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;
      const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;
      const routingResponse = await request(app.getHttpServer())
        .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
        .send({
          actorUserId: "user-ops-lead",
          publishedVersionId: "workflow-support-v1",
          workflowLabel: "Support triage",
          workspaceId: "workspace-customer-success",
          recordingPolicy: {
            enabled: true,
            consentMode: "two-party",
            consentMessage: "Please note this call is being recorded.",
          },
        });

      expect(routingResponse.status).toBe(200);
      expect(routingResponse.body.state.phoneNumbers[0]).toMatchObject({
        liveRoute: {
          mode: "live_route",
          publishedVersionId: "workflow-support-v1",
          workflowLabel: "Support triage",
          workspaceId: "workspace-customer-success",
          runtimeProfile: "cost-optimized",
          activationStatus: "pending_activation",
        },
        webhookStatus: "configured",
      });
      expect(twilioRouting.requests).toEqual([
        {
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
          phoneNumberSid: "PN78901001",
          statusCallbackUrl: "http://127.0.0.1/telephony/webhooks/twilio/status",
          voiceUrl: "http://127.0.0.1/telephony/webhooks/twilio",
        },
      ]);

      const blockedBeforeActivationResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: phoneNumber,
          fromPhoneNumber: "+233201110001",
          callSid: "CA-dispatch-before-activation",
        });

      expect(blockedBeforeActivationResponse.status).toBe(201);
      expect(blockedBeforeActivationResponse.body.dispatch).toMatchObject({
        id: "CA-dispatch-before-activation:telephony:manual",
        disposition: "blocked",
        publishedVersionId: "workflow-support-v1",
      });
      expect(blockedBeforeActivationResponse.body.dispatch.reason).toContain("not active");

      await activateRouteWithOverride({
        app,
        phoneNumberId,
        now: "2026-05-14T12:12:00.000Z",
      });

      const dispatchResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: phoneNumber,
          fromPhoneNumber: "+233201110001",
          callSid: "CA-dispatch-1",
        });

      expect(dispatchResponse.status).toBe(201);
      expect(dispatchResponse.body.dispatch).toMatchObject({
        disposition: "routed",
        publishedVersionId: "workflow-support-v1",
        workspaceId: "workspace-customer-success",
        runtimePath: "pstn-sandwich",
      });
      expect(dispatchResponse.body.dispatch.recording.consentMode).toBe("two-party");
      const runtimePolicyResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(dispatchResponse.body.dispatch.callSessionId)}/runtime-policy`)
        .send({
          subscriptionStatus: "active",
          tenantStatus: "suspended",
          budgetAction: "allow",
          now: "2026-05-14T12:16:00.000Z",
        });
      expect(runtimePolicyResponse.status).toBe(201);
      expect(runtimePolicyResponse.body.session.status).toBe("terminated");
      expect(twilioRouting.terminationRequests).toEqual([
        {
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
          callSid: "CA-dispatch-1",
        },
      ]);

      const webhookPayload = {
        AccountSid: "AC1234567890abcdef1234567890abcd",
        CallSid: "CA-webhook-1",
        EventSid: "EVT-1",
        EventType: "incoming.call",
        To: phoneNumber,
        From: "+233201110001",
      };

      const twilioSignature = computeTwilioWebhookSignature({
        url: "http://127.0.0.1/telephony/webhooks/twilio",
        parameters: webhookPayload,
        authToken: "twilio-auth-token-1234567890",
      });

      const webhookResponse = await request(app.getHttpServer())
        .post("/telephony/webhooks/twilio")
        .set("x-twilio-signature", twilioSignature)
        .send(webhookPayload);

      expect(webhookResponse.status).toBe(200);
      expect(webhookResponse.headers["content-type"]).toContain("text/xml");
      expect(webhookResponse.text).toContain("<Connect>");
      expect(webhookResponse.text).toMatch(
        /<Stream url="wss:\/\/127\.0\.0\.1\/telephony\/twilio\/media-streams\/CA-webhook-1%3Atelephony">/,
      );
      expect(webhookResponse.text).not.toContain("?token=");
      expect(webhookResponse.text).toMatch(
        /<Parameter name="zaraStreamToken" value="[^"]+" \/>/,
      );
      expect(webhookResponse.text).toContain(
        '<Parameter name="zaraCallSessionId" value="CA-webhook-1:telephony" />',
      );
      expect(webhookResponse.text).toContain(
        '<Parameter name="zaraPublishedVersionId" value="workflow-support-v1" />',
      );
      expect(webhookResponse.text).toContain(
        '<Parameter name="zaraRuntimePath" value="pstn-sandwich" />',
      );
      const initialStreamToken = webhookResponse.text.match(
        /<Parameter name="zaraStreamToken" value="([^"]+)" \/>/,
      )?.[1];

      const duplicateWebhookResponse = await request(app.getHttpServer())
        .post("/telephony/webhooks/twilio")
        .set("x-twilio-signature", twilioSignature)
        .send(webhookPayload);

      expect(duplicateWebhookResponse.status).toBe(200);
      expect(duplicateWebhookResponse.headers["content-type"]).toContain("text/xml");
      expect(duplicateWebhookResponse.text).toContain("<Connect>");
      expect(duplicateWebhookResponse.text.match(
        /<Parameter name="zaraStreamToken" value="([^"]+)" \/>/,
      )?.[1]).toBe(initialStreamToken);

      await app.close();
    }, 30_000);

  it("answers real Twilio incoming voice webhooks that do not include an EventType", async () => {
      const app = await createTestingApp();

      const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          blockRoutingOnHealthFailure: true,
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
        });
      const connectionId = connectResponse.body.connection.id as string;

      const importResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({});
      const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;
      const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;

      await request(app.getHttpServer())
        .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
        .send({
          publishedVersionId: "workflow-support-v1",
          workflowLabel: "Support triage",
          workspaceId: "workspace-customer-success",
          runtimeProfile: "cost-optimized",
        })
        .expect(200);

      await activateRouteWithOverride({
        app,
        phoneNumberId,
        now: "2026-05-14T12:12:00.000Z",
      });

      const webhookPayload = {
        AccountSid: "AC1234567890abcdef1234567890abcd",
        ApiVersion: "2010-04-01",
        CallSid: "CA-real-incoming",
        CallStatus: "ringing",
        Direction: "inbound",
        From: "+233201110001",
        To: phoneNumber,
      };
      const signature = computeTwilioWebhookSignature({
        url: "http://127.0.0.1/telephony/webhooks/twilio",
        parameters: webhookPayload,
        authToken: "twilio-auth-token-1234567890",
      });

      const webhookResponse = await request(app.getHttpServer())
        .post("/telephony/webhooks/twilio")
        .set("x-twilio-signature", signature)
        .send(webhookPayload);

      expect(webhookResponse.status).toBe(200);
      expect(webhookResponse.text).toContain("<Connect>");

      const stateResponse = await request(app.getHttpServer()).get("/organizations/tenant-west-africa/telephony/state");

      expect(stateResponse.body.dispatches[0]).toMatchObject({
        disposition: "routed",
        source: "webhook",
        callSessionId: "CA-real-incoming:telephony",
        routeMode: "live_route",
      });

      await app.close();
    }, 30_000);

  it("terminates the provider call when an active PSTN phone test expires", async () => {
      const twilioRouting = createCapturingTwilioRoutingProvider();
      const app = await createTestingApp({ twilioRouting });

      const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          blockRoutingOnHealthFailure: true,
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
        });
      const connectionId = connectResponse.body.connection.id as string;

      const importResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({});
      const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;
      const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;

      const testRouteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
        .send({
          publishedVersionId: "workflow-support-v1",
          workflowLabel: "Support triage",
          workspaceId: "workspace-customer-success",
          runtimeProfile: "cost-optimized",
          allowedCallerNumbers: ["+233201110001"],
          expiresAt: "2026-05-14T12:25:00.000Z",
          now: "2026-05-14T12:15:00.000Z",
        });
      expect(testRouteResponse.status).toBe(201);
      const sessionId = testRouteResponse.body.phoneNumber.testRoute.waitingSession.id as string;

      const dispatchResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
        .send({
          toPhoneNumber: phoneNumber,
          fromPhoneNumber: "+233201110001",
          callSid: "CA-phone-test-expire",
          now: "2026-05-14T12:16:00.000Z",
        });
      expect(dispatchResponse.status).toBe(201);
      expect(dispatchResponse.body.dispatch.routeMode).toBe("test_route");
      expect(dispatchResponse.body.dispatch.testRouteSessionId).toBe(sessionId);

      const completeResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route/${sessionId}/complete`)
        .send({
          status: "expired",
          reason: "The waiting window ended before the phone test passed.",
          at: "2026-05-14T12:25:00.000Z",
        });
      expect(completeResponse.status).toBe(201);
      expect(completeResponse.body.phoneNumber.testRoute.waitingSession.status).toBe("expired");
      expect(twilioRouting.terminationRequests).toEqual([
        {
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
          callSid: "CA-phone-test-expire",
        },
      ]);

      const duplicateCompleteResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route/${sessionId}/complete`)
        .send({
          status: "expired",
          reason: "The waiting window ended before the phone test passed.",
          at: "2026-05-14T12:25:01.000Z",
        });
      expect(duplicateCompleteResponse.status).toBe(201);
      expect(twilioRouting.terminationRequests).toHaveLength(1);

      await app.close();
    }, 30_000);

  it("uses the public API URL for Twilio signature verification and media stream URLs", async () => {
      const previousApiPublicUrl = process.env.API_PUBLIC_URL;
      process.env.API_PUBLIC_URL = "https://api.zara.test";
      const app = await createTestingApp();

      try {
        const connectResponse = await request(app.getHttpServer())
          .post("/organizations/tenant-west-africa/telephony/connections")
          .send({
            actorUserId: "user-ops-lead",
            label: "Tenant Twilio account",
            ownershipMode: "byo_provider_account",
            provider: "twilio",
            region: "us-east-1",
            blockRoutingOnHealthFailure: true,
            accountSid: "AC1234567890abcdef1234567890abcd",
            authToken: "twilio-auth-token-1234567890",
          });
        const connectionId = connectResponse.body.connection.id as string;

        const importResponse = await request(app.getHttpServer())
          .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
          .send({});
        const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;
        const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;

        await request(app.getHttpServer())
          .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
          .send({
            publishedVersionId: "workflow-support-v1",
            workflowLabel: "Support triage",
            workspaceId: "workspace-customer-success",
            runtimeProfile: "cost-optimized",
          })
          .expect(200);

        await activateRouteWithOverride({
          app,
          phoneNumberId,
          now: "2026-05-14T12:12:00.000Z",
        });

        const webhookPayload = {
          AccountSid: "AC1234567890abcdef1234567890abcd",
          CallSid: "CA-public-url",
          EventSid: "EVT-public-url",
          EventType: "incoming.call",
          To: phoneNumber,
          From: "+233201110001",
        };
        const signature = computeTwilioWebhookSignature({
          url: "https://api.zara.test/telephony/webhooks/twilio",
          parameters: webhookPayload,
          authToken: "twilio-auth-token-1234567890",
        });

        const webhookResponse = await request(app.getHttpServer())
          .post("/telephony/webhooks/twilio")
          .set("x-twilio-signature", signature)
          .send(webhookPayload);

        expect(webhookResponse.status).toBe(200);
        expect(webhookResponse.text).toContain("<Connect>");
        expect(webhookResponse.text).toMatch(
          /<Stream url="wss:\/\/api\.zara\.test\/telephony\/twilio\/media-streams\/CA-public-url%3Atelephony">/,
        );
        expect(webhookResponse.text).not.toContain("?token=");
        expect(webhookResponse.text).toMatch(
          /<Parameter name="zaraStreamToken" value="[^"]+" \/>/,
        );
      } finally {
        if (previousApiPublicUrl === undefined) {
          delete process.env.API_PUBLIC_URL;
        } else {
          process.env.API_PUBLIC_URL = previousApiPublicUrl;
        }
        await app.close();
      }
    }, 30_000);

  it("logs Twilio PSTN route and webhook checkpoints without secrets", async () => {
      const logs: string[] = [];
      vi.spyOn(Logger.prototype, "log").mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
      const app = await createTestingApp();

      try {
        const connectResponse = await request(app.getHttpServer())
          .post("/organizations/tenant-west-africa/telephony/connections")
          .send({
            actorUserId: "user-ops-lead",
            label: "Tenant Twilio account",
            ownershipMode: "byo_provider_account",
            provider: "twilio",
            region: "us-east-1",
            blockRoutingOnHealthFailure: true,
            accountSid: "AC1234567890abcdef1234567890abcd",
            authToken: "twilio-auth-token-1234567890",
          });
        const connectionId = connectResponse.body.connection.id as string;

        const importResponse = await request(app.getHttpServer())
          .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
          .send({});
        const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;
        const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;

        await request(app.getHttpServer())
          .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
          .send({
            publishedVersionId: "workflow-support-v1",
            workflowLabel: "Support triage",
            workspaceId: "workspace-customer-success",
            runtimeProfile: "cost-optimized",
          })
          .expect(200);

        await activateRouteWithOverride({
          app,
          phoneNumberId,
          now: "2026-05-14T12:12:00.000Z",
        });

        const webhookPayload = {
          AccountSid: "AC1234567890abcdef1234567890abcd",
          CallSid: "CA-log-checkpoints",
          EventSid: "EVT-log-checkpoints",
          EventType: "incoming.call",
          To: phoneNumber,
          From: "+233201110001",
        };
        const signature = computeTwilioWebhookSignature({
          url: "http://127.0.0.1/telephony/webhooks/twilio",
          parameters: webhookPayload,
          authToken: "twilio-auth-token-1234567890",
        });

        const webhookResponse = await request(app.getHttpServer())
          .post("/telephony/webhooks/twilio")
          .set("x-twilio-signature", signature)
          .send(webhookPayload);

        expect(webhookResponse.status).toBe(200);
        expect(logs).toEqual(
          expect.arrayContaining([
            expect.stringContaining("[twilio-pstn] route_configuring"),
            expect.stringContaining("[twilio-pstn] route_configured"),
            expect.stringContaining("[twilio-pstn] webhook_received"),
            expect.stringContaining("[twilio-pstn] webhook_signature_verified"),
            expect.stringContaining("[twilio-pstn] webhook_incoming_resolved"),
            expect.stringContaining("[twilio-pstn] media_token_minted"),
            expect.stringContaining("[twilio-pstn] twiml_rendered"),
          ]),
        );
        const serializedLogs = logs.join("\n");
        expect(serializedLogs).not.toContain("twilio-auth-token-1234567890");
        expect(serializedLogs).not.toContain("+233201110001");
        expect(serializedLogs).not.toContain(phoneNumber);
        expect(serializedLogs).toContain("+*******7890");
      } finally {
        await app.close();
      }
    }, 30_000);

  it("rejects malformed Twilio webhook posts without raising a server error", async () => {
      const app = await createTestingApp();

      try {
        const response = await request(app.getHttpServer())
          .post("/telephony/webhooks/twilio");

        expect(response.status).toBe(401);
        expect(response.body).toMatchObject({
          message: "Twilio webhook signature is required.",
        });
      } finally {
        await app.close();
      }
    }, 30_000);

  it("logs signed Twilio call status callbacks for inbound failures", async () => {
      const logs: string[] = [];
      vi.spyOn(Logger.prototype, "log").mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
      const app = await createTestingApp();

      try {
        const connectResponse = await request(app.getHttpServer())
          .post("/organizations/tenant-west-africa/telephony/connections")
          .send({
            actorUserId: "user-ops-lead",
            label: "Tenant Twilio account",
            ownershipMode: "byo_provider_account",
            provider: "twilio",
            region: "us-east-1",
            blockRoutingOnHealthFailure: true,
            accountSid: "AC1234567890abcdef1234567890abcd",
            authToken: "twilio-auth-token-1234567890",
          });
        const connectionId = connectResponse.body.connection.id as string;

        const importResponse = await request(app.getHttpServer())
          .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
          .send({ actorUserId: "user-ops-lead" })
          .expect(201);
        const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;

        const statusPayload = {
          AccountSid: "AC1234567890abcdef1234567890abcd",
          CallSid: "CA-status-failed",
          CallStatus: "failed",
          Direction: "inbound",
          From: "+16368127159",
          To: phoneNumber,
          SipResponseCode: "603",
          ErrorCode: "11200",
          ErrorMessage: "HTTP retrieval failure",
        };
        const signature = computeTwilioWebhookSignature({
          url: "http://127.0.0.1/telephony/webhooks/twilio/status",
          parameters: statusPayload,
          authToken: "twilio-auth-token-1234567890",
        });

        await request(app.getHttpServer())
          .post("/telephony/webhooks/twilio/status")
          .set("x-twilio-signature", signature)
          .send(statusPayload)
          .expect(204);

        expect(logs).toEqual(
          expect.arrayContaining([
            expect.stringContaining("[twilio-pstn] status_callback_received"),
            expect.stringContaining("[twilio-pstn] status_callback_signature_verified"),
          ]),
        );
        const serializedLogs = logs.join("\n");
        expect(serializedLogs).toContain("CA-status-failed");
        expect(serializedLogs).toContain("failed");
        expect(serializedLogs).toContain("603");
        expect(serializedLogs).toContain("11200");
        expect(serializedLogs).toContain("+*******7159");
        expect(serializedLogs).toContain("+*******7890");
        expect(serializedLogs).not.toContain("+16368127159");
        expect(serializedLogs).not.toContain(phoneNumber);
        expect(serializedLogs).not.toContain("twilio-auth-token-1234567890");
      } finally {
        await app.close();
      }
    }, 30_000);

  it("logs Twilio provider number readback and recent calls during heartbeats", async () => {
      const logs: string[] = [];
      vi.spyOn(Logger.prototype, "log").mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
      const twilioRouting = createCapturingTwilioRoutingProvider({
        configuration: {
          sid: "PN1234567890abcdef1234567890abcd",
          phoneNumber: "+14155557890",
          trunkSid: null,
          voiceApplicationSid: null,
          voiceMethod: "POST",
          voiceUrl: "http://127.0.0.1/telephony/webhooks/twilio",
          voiceReceiveMode: "voice",
          capabilities: {
            voice: true,
            sms: true,
          },
        },
        recentCalls: [
          {
            sid: "CA-recent-busy",
            status: "busy",
            direction: "inbound",
            from: "+16368127159",
            to: "+14155557890",
            phoneNumberSid: "PN1234567890abcdef1234567890abcd",
            startTime: "Thu, 09 Jul 2026 13:45:52 +0000",
            duration: "0",
          },
        ],
        callDetails: [
          {
            sid: "CA-recent-busy",
            status: "busy",
            direction: "inbound",
            from: "+16368127159",
            to: "+14155557890",
            phoneNumberSid: "PN1234567890abcdef1234567890abcd",
            apiVersion: "2010-04-01",
            startTime: "Thu, 09 Jul 2026 13:45:52 +0000",
            duration: "0",
            queueTime: "0",
            sipResponseCode: "486",
            subresourceUris: {
              notifications: "/2010-04-01/Accounts/AC1234567890abcdef1234567890abcd/Calls/CA-recent-busy/Notifications.json",
            },
          },
        ],
        monitorAlerts: [
          {
            sid: "NOaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            errorCode: "11200",
            alertText: "HTTP retrieval failure",
            logLevel: "error",
            moreInfo: "https://www.twilio.com/docs/api/errors/11200",
            requestMethod: "POST",
            requestUrl: "https://api.zara.test/telephony/webhooks/twilio",
            resourceSid: "CA-recent-busy",
            dateGenerated: "2026-07-09T13:45:53Z",
          },
        ],
      });
      const app = await createTestingApp({ twilioRouting });

      try {
        const connectResponse = await request(app.getHttpServer())
          .post("/organizations/tenant-west-africa/telephony/connections")
          .send({
            actorUserId: "user-ops-lead",
            label: "Tenant Twilio account",
            ownershipMode: "byo_provider_account",
            provider: "twilio",
            region: "us-east-1",
            blockRoutingOnHealthFailure: true,
            accountSid: "AC1234567890abcdef1234567890abcd",
            authToken: "twilio-auth-token-1234567890",
          });
        const connectionId = connectResponse.body.connection.id as string;

        await request(app.getHttpServer())
          .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
          .send({ actorUserId: "user-ops-lead" })
          .expect(201);

        const stateResponse = await request(app.getHttpServer()).get(
          "/organizations/tenant-west-africa/telephony/state",
        );
        const phoneNumber = stateResponse.body.phoneNumbers[0] as {
          externalNumberId: string;
          id: string;
          phoneNumber: string;
        };

        await request(app.getHttpServer())
          .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumber.id}/routing`)
          .send({
            publishedVersionId: "workflow-support-v1",
            workflowLabel: "Support triage",
            workspaceId: "workspace-customer-success",
          })
          .expect(200);

        await request(app.getHttpServer())
          .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/heartbeat`)
          .send({ scheduled: false })
          .expect(201);

        expect(twilioRouting.inspections).toEqual([
          expect.objectContaining({
            accountSid: "AC1234567890abcdef1234567890abcd",
            phoneNumberSid: phoneNumber.externalNumberId,
          }),
        ]);
        expect(twilioRouting.recentCallRequests).toEqual([
          expect.objectContaining({
            accountSid: "AC1234567890abcdef1234567890abcd",
            phoneNumber: phoneNumber.phoneNumber,
            limit: 5,
          }),
        ]);
        expect(twilioRouting.monitorAlertRequests).toEqual([
          expect.objectContaining({
            accountSid: "AC1234567890abcdef1234567890abcd",
            limit: 10,
            startDate: "2026-07-09T13:40:52Z",
          }),
        ]);
        expect(twilioRouting.callDetailRequests).toEqual([
          expect.objectContaining({
            accountSid: "AC1234567890abcdef1234567890abcd",
            callSid: "CA-recent-busy",
          }),
        ]);
        expect(logs).toEqual(
          expect.arrayContaining([
            expect.stringContaining("[twilio-pstn] provider_number_readback"),
            expect.stringContaining("[twilio-pstn] provider_recent_calls"),
            expect.stringContaining("[twilio-pstn] provider_call_details"),
            expect.stringContaining("[twilio-pstn] provider_monitor_alerts"),
          ]),
        );
        const serializedLogs = logs.join("\n");
        expect(serializedLogs).not.toContain("twilio-auth-token-1234567890");
        expect(serializedLogs).not.toContain("+16368127159");
        expect(serializedLogs).not.toContain("+14155557890");
        expect(serializedLogs).toContain("11200");
        expect(serializedLogs).toContain("CA-recent-busy");
        expect(serializedLogs).toContain("486");
        expect(serializedLogs).toContain("+*******7159");
        expect(serializedLogs).toContain("+*******7890");
      } finally {
        await app.close();
      }
    }, 30_000);

  it("deletes a telephony connection and removes its active inventory and provider posture", async () => {
      const app = await createTestingApp();

      const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          blockRoutingOnHealthFailure: true,
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
        });
      const connectionId = connectResponse.body.connection.id as string;

      await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({ actorUserId: "user-ops-lead" })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/heartbeat`)
        .send({ scheduled: false })
        .expect(201);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/organizations/tenant-west-africa/telephony/connections/${connectionId}`)
        .send({ actorUserId: "user-ops-lead" });

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.deletedConnectionId).toBe(connectionId);
      expect(deleteResponse.body.state.connections).toEqual([]);
      expect(deleteResponse.body.state.phoneNumbers).toEqual([]);
      expect(deleteResponse.body.state.healthChecks).toEqual([]);
      expect(deleteResponse.body.state.providerHeartbeats).toEqual([]);

      const validateDeletedResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/validate`)
        .send({ actorUserId: "user-ops-lead" });
      expect(validateDeletedResponse.status).toBe(404);

      await app.close();
    }, 30_000);

  it("deletes one imported phone number without deleting the provider connection", async () => {
      const app = await createTestingApp();

      const connectResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/telephony/connections")
        .send({
          actorUserId: "user-ops-lead",
          label: "Tenant Twilio account",
          ownershipMode: "byo_provider_account",
          provider: "twilio",
          region: "us-east-1",
          blockRoutingOnHealthFailure: true,
          accountSid: "AC1234567890abcdef1234567890abcd",
          authToken: "twilio-auth-token-1234567890",
        });
      const connectionId = connectResponse.body.connection.id as string;

      const importResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
        .send({ actorUserId: "user-ops-lead" })
        .expect(201);
      const deletedNumberId = importResponse.body.state.phoneNumbers[0].id as string;
      const keptNumberId = importResponse.body.state.phoneNumbers[1].id as string;

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/organizations/tenant-west-africa/telephony/numbers/${deletedNumberId}`)
        .send({ actorUserId: "user-ops-lead" });

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.deletedPhoneNumberId).toBe(deletedNumberId);
      expect(deleteResponse.body.state.connections).toHaveLength(1);
      expect(deleteResponse.body.state.connections[0].id).toBe(connectionId);
      expect(deleteResponse.body.state.phoneNumbers.map((phoneNumber: { id: string }) => phoneNumber.id)).toEqual([
        keptNumberId,
      ]);

      const crossTenantDeleteResponse = await request(app.getHttpServer())
        .delete(`/organizations/tenant-east-africa/telephony/numbers/${keptNumberId}`)
        .send({ actorUserId: "user-ops-lead" });
      expect(crossTenantDeleteResponse.status).toBe(404);

      await app.close();
    }, 30_000);
});
