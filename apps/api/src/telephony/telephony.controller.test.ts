import { afterEach, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { Logger, type INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { computeTwilioWebhookSignature, type AvailableTwilioPhoneNumber } from "@zara/core";

import {
  BILLING_POLAR_CLIENT,
  type BillingPolarClient,
} from "../billing/polar-billing.client";
import {
  BILLING_STATE_REPOSITORY,
  FileBillingStateRepository,
} from "../billing/billing-state.repository";
import { ComplianceModule } from "../compliance/compliance.module";
import {
  AUDIT_LOG_REPOSITORY,
  FileAuditLogRepository,
} from "../compliance/audit-log.repository";
import { configureCors } from "../config/cors";
import { installTestTenantAuth, withTestTenantAuth } from "../testing/tenant-auth-request";
import {
  FileTelephonyStateRepository,
  TELEPHONY_STATE_REPOSITORY,
} from "./telephony-state.repository";
import {
  TWILIO_NUMBER_INVENTORY_PROVIDER,
  type TwilioNumberInventoryProvider,
} from "./twilio-number-inventory.provider";
import {
  TWILIO_NUMBER_ROUTING_PROVIDER,
  type TwilioCallDiagnosticDetail,
  type TwilioIncomingNumberRouteConfiguration,
  type TwilioMonitorAlertDiagnostic,
  type TwilioNumberRoutingProvider,
  type TwilioRecentCallDiagnostic,
} from "./twilio-number-routing.provider";

describe("TelephonyController", () => {
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

    const duplicateWebhookResponse = await request(app.getHttpServer())
      .post("/telephony/webhooks/twilio")
      .set("x-twilio-signature", twilioSignature)
      .send(webhookPayload);

    expect(duplicateWebhookResponse.status).toBe(200);
    expect(duplicateWebhookResponse.headers["content-type"]).toContain("text/xml");
    expect(duplicateWebhookResponse.text).toContain("<Reject reason=\"busy\" />");

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

  it("creates premium realtime PSTN test routes and carries the premium runtime path into Twilio media", async () => {
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
    const connectionId = connectResponse.body.state.connections[0].id as string;

    const importResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
      .send({});
    const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;
    const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;

    const premiumTestRouteResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
      .send({
        publishedVersionId: "workflow-premium-test-v1",
        workflowLabel: "Premium realtime phone test",
        workspaceId: "workspace-premium",
        runtimeProfile: "premium-realtime",
        allowedCallerNumbers: ["+233201110001"],
        expiresAt: "2099-05-14T16:30:00.000Z",
        now: "2026-05-14T16:00:00.000Z",
      });

    expect(premiumTestRouteResponse.status).toBe(201);
    expect(premiumTestRouteResponse.body.phoneNumber.testRoute).toMatchObject({
      mode: "test_route",
      runtimeProfile: "premium-realtime",
    });

    const webhookPayload = {
      AccountSid: "AC1234567890abcdef1234567890abcd",
      CallSid: "CA-premium-phone-test",
      EventSid: "EVT-premium-phone-test",
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
    expect(webhookResponse.text).toContain("<Connect>");
    expect(webhookResponse.text).toContain(
      '<Parameter name="zaraRuntimePath" value="pstn-premium-realtime" />',
    );
    expect(webhookResponse.body.dispatch).toBeUndefined();

    const stateResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/telephony/state",
    );
    expect(stateResponse.body.dispatches[0]).toMatchObject({
      disposition: "routed",
      routeMode: "test_route",
      runtimeProfile: "premium-realtime",
      runtimePath: "pstn-premium-realtime",
      policyChecks: {
        premiumRealtime: {
          status: "passed",
        },
      },
    });

    await app.close();
  }, 30_000);

  it("creates a protected PSTN test route without replacing the live route", async () => {
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
    const connectionId = connectResponse.body.state.connections[0].id as string;

    const importResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
      .send({});
    const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;
    const phoneNumber = importResponse.body.state.phoneNumbers[0].phoneNumber as string;
    const secondPhoneNumberId = importResponse.body.state.phoneNumbers[1].id as string;
    const secondPhoneNumber = importResponse.body.state.phoneNumbers[1].phoneNumber as string;

    const liveRouteResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
      .send({
        publishedVersionId: "workflow-live-v1",
        workflowLabel: "Live reception",
        workspaceId: "workspace-live",
        runtimeProfile: "balanced",
      });

    expect(liveRouteResponse.status).toBe(200);

    const testRouteResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
      .send({
        publishedVersionId: "workflow-test-v2",
        workflowLabel: "Phone test",
        workspaceId: "workspace-test",
        runtimeProfile: "cost-optimized",
        allowedCallerNumbers: ["+233201110001"],
        expiresAt: "2026-05-14T16:30:00.000Z",
        now: "2026-05-14T16:00:00.000Z",
      });

    expect(testRouteResponse.status).toBe(201);
    expect(testRouteResponse.body.phoneNumber.liveRoute).toMatchObject({
      mode: "live_route",
      publishedVersionId: "workflow-live-v1",
      runtimeProfile: "balanced",
    });
    expect(testRouteResponse.body.phoneNumber.testRoute).toMatchObject({
      mode: "test_route",
      publishedVersionId: "workflow-test-v2",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      waitingSession: {
        status: "waiting",
        expiresAt: "2026-05-14T16:30:00.000Z",
      },
    });

    const duplicateTestRouteResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
      .send({
        publishedVersionId: "workflow-test-v3",
        workflowLabel: "Second phone test",
        workspaceId: "workspace-test",
        runtimeProfile: "balanced",
        allowedCallerNumbers: ["+233201110002"],
        expiresAt: "2026-05-14T16:45:00.000Z",
        now: "2026-05-14T16:05:00.000Z",
      });

    expect(duplicateTestRouteResponse.status).toBe(409);

    const crossTenantTestRouteResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
      .send({
        publishedVersionId: "workflow-test-v2",
        workflowLabel: "Cross tenant test",
        workspaceId: "workspace-test",
        runtimeProfile: "cost-optimized",
        allowedCallerNumbers: ["+233201110001"],
        expiresAt: "2026-05-14T16:45:00.000Z",
        now: "2026-05-14T16:05:00.000Z",
      });

    expect(crossTenantTestRouteResponse.status).toBe(404);

    const allowedDispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: phoneNumber,
        fromPhoneNumber: "+233201110001",
        callSid: "CA-phone-test",
        now: "2026-05-14T16:05:00.000Z",
      });

    expect(allowedDispatchResponse.status).toBe(201);
    expect(allowedDispatchResponse.body.dispatch).toMatchObject({
      disposition: "routed",
      routeMode: "test_route",
      publishedVersionId: "workflow-test-v2",
      workspaceId: "workspace-test",
      runtimeProfile: "cost-optimized",
    });

    const liveDispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: phoneNumber,
        fromPhoneNumber: "+233201110009",
        callSid: "CA-live",
        now: "2026-05-14T16:05:00.000Z",
      });

    expect(liveDispatchResponse.status).toBe(201);
    expect(liveDispatchResponse.body.dispatch).toMatchObject({
      disposition: "blocked",
      routeMode: "live_route",
      publishedVersionId: "workflow-live-v1",
      workspaceId: "workspace-live",
      runtimeProfile: "balanced",
    });
    expect(liveDispatchResponse.body.dispatch.reason).toContain("not active");

    const secondRouteResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/routing`)
      .send({
        publishedVersionId: "workflow-success-v1",
        workflowLabel: "Successful phone test",
        workspaceId: "workspace-success",
        runtimeProfile: "cost-optimized",
      });
    expect(secondRouteResponse.status).toBe(200);

    const successRouteResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/pstn-test-route`)
      .send({
        publishedVersionId: "workflow-success-v1",
        workflowLabel: "Successful phone test",
        workspaceId: "workspace-success",
        runtimeProfile: "cost-optimized",
        allowedCallerNumbers: ["+233201110001"],
        expiresAt: "2099-05-14T17:30:00.000Z",
        now: "2026-05-14T17:00:00.000Z",
      });

    expect(successRouteResponse.status).toBe(201);

    const webhookPayload = {
      AccountSid: "AC1234567890abcdef1234567890abcd",
      CallSid: "CA-phone-test-success",
      EventSid: "EVT-phone-test-success",
      EventType: "incoming.call",
      To: secondPhoneNumber,
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
    expect(webhookResponse.text).toContain("<Connect>");

    const callSessionId = "CA-phone-test-success:telephony";
    let checkpointResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/pstn-test-checkpoints`)
      .send({ checkpoint: "mediaWebSocketConnected", at: "2026-05-14T17:00:01.000Z" });
    expect(checkpointResponse.status).toBe(201);

    for (const checkpoint of [
      "inboundFrameReceived",
      "transcriptCreated",
      "agentResponseGenerated",
      "outboundAudioSent",
      "cleanEnd",
      "noFatalError",
    ] as const) {
      checkpointResponse = await request(app.getHttpServer())
        .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/pstn-test-checkpoints`)
        .send({ checkpoint, at: "2026-05-14T17:00:02.000Z" });
      expect(checkpointResponse.status).toBe(201);
    }

    const successfulNumber = checkpointResponse.body.state.phoneNumbers.find(
      (candidate: { id: string }) => candidate.id === secondPhoneNumberId,
    );
    expect(successfulNumber.phoneTestResults[0]).toMatchObject({
      status: "passed",
      numberId: secondPhoneNumberId,
      publishedVersionId: "workflow-success-v1",
      runtimeProfile: "cost-optimized",
      checklist: {
        verifiedWebhook: true,
        allowedCallerMatched: true,
        mediaWebSocketConnected: true,
        inboundFrameReceived: true,
        transcriptCreated: true,
        agentResponseGenerated: true,
        outboundAudioSent: true,
        cleanEnd: true,
        noFatalError: true,
      },
    });

    const activationResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/live-route/activate`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-14T17:05:00.000Z",
      });
    expect(activationResponse.status).toBe(201);
    expect(activationResponse.body.activation.summary).toMatchObject({
      number: secondPhoneNumber,
      workflowName: "Successful phone test",
      publishedVersionId: "workflow-success-v1",
      runtimeProfile: "cost-optimized",
      subscriptionPosture: {
        status: "active",
      },
      budgetPosture: {
        action: "allow",
      },
    });
    expect(activationResponse.body.phoneNumber.liveRoute).toMatchObject({
      activationStatus: "active",
      activationTestResultId: successfulNumber.phoneTestResults[0].id,
    });

    const crossTenantActivationResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/telephony/numbers/${secondPhoneNumberId}/live-route/activate`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-14T17:05:30.000Z",
      });
    expect(crossTenantActivationResponse.status).toBe(404);

    const activatedDispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: secondPhoneNumber,
        fromPhoneNumber: "+233201110002",
        callSid: "CA-live-activated",
        now: "2026-05-14T17:06:00.000Z",
      });
    expect(activatedDispatchResponse.status).toBe(201);
    expect(activatedDispatchResponse.body.dispatch).toMatchObject({
      disposition: "routed",
      routeMode: "live_route",
      publishedVersionId: "workflow-success-v1",
      workspaceId: "workspace-success",
    });

    const auditResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/compliance/audit-logs",
    );
    expect(auditResponse.body.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "telephony.live_route_activated",
          target: {
            type: "telephony_number",
            id: secondPhoneNumberId,
          },
          outcome: "succeeded",
        }),
      ]),
    );

    const unauthorizedRouteResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/pstn-test-route`)
      .send({
        publishedVersionId: "workflow-unauthorized-v1",
        workflowLabel: "Unauthorized caller test",
        workspaceId: "workspace-success",
        runtimeProfile: "cost-optimized",
        allowedCallerNumbers: ["+233201110777"],
        expiresAt: "2099-05-14T18:30:00.000Z",
        now: "2026-05-14T18:00:00.000Z",
      });
    expect(unauthorizedRouteResponse.status).toBe(201);

    const unauthorizedDispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: secondPhoneNumber,
        fromPhoneNumber: "+233201110999",
        callSid: "CA-phone-test-unauthorized",
        now: "2026-05-14T18:05:00.000Z",
      });
    expect(unauthorizedDispatchResponse.status).toBe(201);
    expect(unauthorizedDispatchResponse.body.dispatch).toMatchObject({
      disposition: "routed",
      routeMode: "live_route",
      publishedVersionId: "workflow-success-v1",
    });
    const unauthorizedNumber = unauthorizedDispatchResponse.body.state.phoneNumbers.find(
      (candidate: { id: string }) => candidate.id === secondPhoneNumberId,
    );
    expect(unauthorizedNumber.phoneTestResults[0]).toMatchObject({
      status: "unauthorized_caller",
      reason: "Caller number did not match the PSTN phone test allow list.",
    });

    const expiringRouteResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${secondPhoneNumberId}/pstn-test-route`)
      .send({
        publishedVersionId: "workflow-expired-v1",
        workflowLabel: "Expired phone test",
        workspaceId: "workspace-success",
        runtimeProfile: "cost-optimized",
        allowedCallerNumbers: ["+233201110001"],
        expiresAt: "2026-05-14T18:10:00.000Z",
        now: "2026-05-14T18:00:00.000Z",
      });
    expect(expiringRouteResponse.status).toBe(201);

    const expiredDispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: secondPhoneNumber,
        fromPhoneNumber: "+233201110001",
        callSid: "CA-phone-test-expired",
        now: "2026-05-14T18:11:00.000Z",
      });
    expect(expiredDispatchResponse.status).toBe(201);
    expect(expiredDispatchResponse.body.dispatch).toMatchObject({
      disposition: "routed",
      routeMode: "live_route",
      publishedVersionId: "workflow-success-v1",
    });
    const expiredNumber = expiredDispatchResponse.body.state.phoneNumbers.find(
      (candidate: { id: string }) => candidate.id === secondPhoneNumberId,
    );
    expect(expiredNumber.phoneTestResults[0]).toMatchObject({
      status: "expired",
      reason: "PSTN phone test expired before a matching caller connected.",
    });

    await app.close();
  }, 30_000);

  it("stores a manually ended protected PSTN phone-test result", async () => {
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
    const connectionId = connectResponse.body.state.connections[0].id as string;

    const importResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
      .send({});
    const phoneNumberId = importResponse.body.state.phoneNumbers[0].id as string;

    const testRouteResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route`)
      .send({
        publishedVersionId: "workflow-test-v2",
        workflowLabel: "Phone test",
        workspaceId: "workspace-test",
        runtimeProfile: "cost-optimized",
        allowedCallerNumbers: ["+233201110001"],
        expiresAt: "2026-05-14T16:30:00.000Z",
        now: "2026-05-14T16:00:00.000Z",
      });
    const sessionId = testRouteResponse.body.phoneNumber.testRoute.waitingSession.id as string;

    const completeResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/pstn-test-route/${encodeURIComponent(sessionId)}/complete`)
      .send({
        status: "manually_ended",
        reason: "Operator ended the sandbox test. raw payload auth_token=abc123",
        at: "2026-05-14T16:06:00.000Z",
      });

    expect(completeResponse.status).toBe(201);
    const completedNumber = completeResponse.body.state.phoneNumbers.find(
      (candidate: { id: string }) => candidate.id === phoneNumberId,
    );
    expect(completedNumber.testRoute.waitingSession.status).toBe("manually_ended");
    expect(completedNumber.phoneTestResults[0]).toMatchObject({
      status: "manually_ended",
      reason: "Operator ended the sandbox test.",
      publishedVersionId: "workflow-test-v2",
      runtimeProfile: "cost-optimized",
      completedAt: "2026-05-14T16:06:00.000Z",
    });
    expect(JSON.stringify(completedNumber.phoneTestResults[0])).not.toContain("abc123");

    const crossTenantCompleteResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/telephony/numbers/${phoneNumberId}/pstn-test-route/${encodeURIComponent(sessionId)}/complete`)
      .send({
        status: "manually_ended",
        reason: "Cross tenant attempt.",
        at: "2026-05-14T16:07:00.000Z",
      });
    expect(crossTenantCompleteResponse.status).toBe(404);

    await app.close();
  }, 30_000);

  it("enforces live activation policy gates, pause/resume, and mid-call runtime policy", async () => {
    const app = await createTestingApp();

    const connectionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/connections")
      .send({
        actorUserId: "user-ops-lead",
        label: "Zara Edge West",
        ownershipMode: "platform_managed",
        provider: "twilio",
        region: "eu-west-1",
        blockRoutingOnHealthFailure: true,
      });
    const connectionId = connectionResponse.body.connection.id as string;
    const numberResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/register-number`)
      .send({
        phoneNumber: "+14155550110",
        friendlyName: "Premium support",
      });
    const phoneNumberId = numberResponse.body.phoneNumber.id as string;
    await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
      .send({
        publishedVersionId: "workflow-vip-v1",
        workflowLabel: "VIP reception",
        workspaceId: "workspace-vip",
      });

    const budgetBlockPolicyResponse = await request(app.getHttpServer())
      .patch("/organizations/tenant-west-africa/billing/budget-policy")
      .send({
        actorUserId: "billing-admin",
        actorRole: "owner",
        monthlyBudgetUsd: 100,
        callMinuteLimit: 10000,
        premiumRuntimeMinuteLimit: 10000,
        overBudgetBehavior: "block",
      });
    expect(budgetBlockPolicyResponse.status).toBe(200);

    const budgetBlockedActivation = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/activate`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-20T10:00:00.000Z",
        override: {
          actorUserId: "user-ops-lead",
          approvedByUserId: "platform-admin-1",
          reason: "Emergency activation override request.",
        },
    });
    expect(budgetBlockedActivation.status).toBe(409);
    expect(resolveActivationBlocks(budgetBlockedActivation.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "budget_hard_block",
        }),
      ]),
    );

    await request(app.getHttpServer())
      .patch("/organizations/tenant-west-africa/billing/budget-policy")
      .send({
        actorUserId: "billing-admin",
        actorRole: "owner",
        monthlyBudgetUsd: 2000,
        callMinuteLimit: 10000,
        premiumRuntimeMinuteLimit: 10000,
        overBudgetBehavior: "block",
      });

    const canceledSubscriptionWebhook = await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-subscription-canceled")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "customer.state_changed",
        data: {
          customer: {
            id: "polar_customer_1",
            externalId: "tenant-west-africa",
          },
          activeSubscriptions: [
            {
              id: "polar_subscription_1",
              productId: "polar_product_growth",
              status: "canceled",
            },
          ],
          grantedBenefits: [],
        },
      });
    expect(canceledSubscriptionWebhook.status).toBe(201);

    const subscriptionBlockedActivation = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/activate`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-20T10:02:00.000Z",
        override: {
          actorUserId: "user-ops-lead",
          approvedByUserId: "platform-admin-1",
          reason: "Emergency activation override request.",
        },
    });
    expect(subscriptionBlockedActivation.status).toBe(409);
    expect(resolveActivationBlocks(subscriptionBlockedActivation.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "inactive_subscription",
        }),
      ]),
    );

    const suspendedActivation = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/activate`)
      .send({
        actorUserId: "user-ops-lead",
        tenantStatus: "suspended",
        now: "2026-05-20T10:03:00.000Z",
        override: {
          actorUserId: "user-ops-lead",
          approvedByUserId: "platform-admin-1",
          reason: "Emergency activation override request.",
        },
    });
    expect(suspendedActivation.status).toBe(409);
    expect(resolveActivationBlocks(suspendedActivation.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "tenant_suspended",
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post("/billing/polar/webhooks")
      .set("polar-webhook-id", "evt-subscription-active")
      .set("polar-webhook-signature", "test-signature")
      .send({
        type: "customer.state_changed",
        data: {
          customer: {
            id: "polar_customer_1",
            externalId: "tenant-west-africa",
          },
          activeSubscriptions: [
            {
              id: "polar_subscription_1",
              productId: "polar_product_growth",
              status: "active",
              currentPeriodEnd: "2026-06-22T00:00:00.000Z",
              cancelAtPeriodEnd: false,
            },
          ],
        },
      });

    await activateRouteWithOverride({
      app,
      phoneNumberId,
      now: "2026-05-20T10:04:00.000Z",
    });

    const pausedResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/pause`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-20T10:05:00.000Z",
      });
    expect(pausedResponse.status).toBe(201);
    expect(pausedResponse.body.phoneNumber.liveRoute).toMatchObject({
      activationStatus: "paused",
      pausedAt: "2026-05-20T10:05:00.000Z",
    });

    const pausedDispatch = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: "+14155550110",
        fromPhoneNumber: "+233201110001",
        callSid: "CA-paused-live-route",
      });
    expect(pausedDispatch.body.dispatch).toMatchObject({
      disposition: "blocked",
      publishedVersionId: "workflow-vip-v1",
    });
    expect(pausedDispatch.body.dispatch.reason).toContain("paused");

    const resumedResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/resume`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-20T10:06:00.000Z",
        override: {
          actorUserId: "user-ops-lead",
          approvedByUserId: "platform-admin-1",
          reason: "Resume from a previously authorized route setup.",
        },
      });
    expect(resumedResponse.status).toBe(201);
    expect(resumedResponse.body.phoneNumber.liveRoute.activationStatus).toBe("active");

    const liveDispatch = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: "+14155550110",
        fromPhoneNumber: "+233201110001",
        callSid: "CA-live-runtime-policy",
      });
    const callSessionId = liveDispatch.body.dispatch.callSessionId as string;

    const graceResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/runtime-policy`)
      .send({
        subscriptionStatus: "past_due",
        tenantStatus: "active",
        budgetAction: "allow",
        now: "2026-05-20T10:07:00.000Z",
        graceUntil: "2026-05-20T10:37:00.000Z",
      });
    expect(graceResponse.body.session).toMatchObject({
      status: "grace-active",
      policyState: {
        state: "subscription_grace",
        graceUntil: "2026-05-20T10:37:00.000Z",
      },
    });

    const closeoutResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/runtime-policy`)
      .send({
        subscriptionStatus: "active",
        tenantStatus: "active",
        budgetAction: "block",
        budgetReasons: ["monthly_budget_exceeded"],
        now: "2026-05-20T10:08:00.000Z",
      });
    expect(closeoutResponse.body.session.policyState.state).toBe("budget_closeout_after_turn");
    expect(closeoutResponse.body.session.status).toBe("closeout-pending");

    const terminatedResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/runtime-policy`)
      .send({
        subscriptionStatus: "active",
        tenantStatus: "suspended",
        budgetAction: "allow",
        now: "2026-05-20T10:09:00.000Z",
      });
    expect(terminatedResponse.body.session).toMatchObject({
      status: "terminated",
      policyState: {
        state: "terminated_for_suspension",
      },
    });

    await app.close();
  }, 30_000);

  it("rejects invalid Twilio signatures and allows tenant web origins to preflight telephony routes", async () => {
    const app = await createTestingApp();

    const invalidSignatureResponse = await request(app.getHttpServer())
      .post("/telephony/webhooks/twilio")
      .set("x-twilio-signature", "invalid")
      .send({
        AccountSid: "AC1234567890abcdef1234567890abcd",
        CallSid: "CA-webhook-invalid",
        EventSid: "EVT-invalid",
        EventType: "incoming.call",
        To: "+14155550100",
        From: "+233201110001",
      });

    expect(invalidSignatureResponse.status).toBe(401);
    expect(invalidSignatureResponse.body.message).toContain("signature");

    const corsResponse = await request(app.getHttpServer())
      .options("/organizations/tenant-west-africa/telephony/state")
      .set("Origin", "http://127.0.0.1:4173")
      .set("Access-Control-Request-Method", "GET");

    expect(corsResponse.status).toBe(204);
    expect(corsResponse.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4173");

    await app.close();
  }, 30_000);

  it("supports platform-managed numbers, SIP trunks, outbound policy checks, and call-control events", async () => {
    const app = await createTestingApp();

    const platformConnectionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/connections")
      .send({
        actorUserId: "user-ops-lead",
        label: "Zara Edge West",
        ownershipMode: "platform_managed",
        provider: "twilio",
        region: "eu-west-1",
        blockRoutingOnHealthFailure: true,
        recordingPolicy: {
          enabled: true,
          consentMode: "two-party",
          consentMessage: "This line records after consent.",
        },
      });

    expect(platformConnectionResponse.status).toBe(201);
    const platformConnectionId = platformConnectionResponse.body.connection.id as string;

    const platformNumberResponse = await request(app.getHttpServer())
      .post(
        `/organizations/tenant-west-africa/telephony/connections/${platformConnectionId}/register-number`,
      )
      .send({
        actorUserId: "user-ops-lead",
        phoneNumber: "+14155550110",
        friendlyName: "Premium support",
      });

    expect(platformNumberResponse.status).toBe(201);
    expect(platformNumberResponse.body.phoneNumber).toMatchObject({
      provisionSource: "platform-pool",
      webhookStatus: "configured",
    });
    const platformNumberId = platformNumberResponse.body.phoneNumber.id as string;

    const platformRouteResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${platformNumberId}/routing`)
      .send({
        actorUserId: "user-ops-lead",
        publishedVersionId: "workflow-vip-v1",
        workflowLabel: "VIP reception",
        workspaceId: "workspace-vip",
      });

    expect(platformRouteResponse.status).toBe(200);
    await activateRouteWithOverride({
      app,
      phoneNumberId: platformNumberId,
      now: "2026-05-14T12:12:00.000Z",
    });

    const inboundValidationResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: "+14155550110",
        fromPhoneNumber: "+233201110001",
        callSid: "CA-platform-inbound-1",
      });

    expect(inboundValidationResponse.status).toBe(201);
    expect(inboundValidationResponse.body.dispatch).toMatchObject({
      disposition: "routed",
      publishedVersionId: "workflow-vip-v1",
    });
    expect(inboundValidationResponse.body.dispatch.recording.consentMode).toBe("two-party");

    const sipConnectionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/connections")
      .send({
        actorUserId: "user-ops-lead",
        label: "Accra SIP trunk",
        ownershipMode: "byo_sip_trunk",
        provider: "custom-sip",
        region: "eu-west-1",
        blockRoutingOnHealthFailure: true,
        username: "acme-trunk",
        secret: "sip-secret-value-1234567890",
        sip: {
          domain: "sip.acme.example",
          codecs: ["opus", "pcmu"],
        },
      });

    expect(sipConnectionResponse.status).toBe(201);
    const sipConnectionId = sipConnectionResponse.body.connection.id as string;

    const sipValidateBeforeDid = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${sipConnectionId}/validate`)
      .send({
        actorUserId: "user-ops-lead",
      });

    expect(sipValidateBeforeDid.status).toBe(200);
    expect(sipValidateBeforeDid.body.healthCheck.status).toBe("warning");
    expect(sipValidateBeforeDid.body.healthCheck.message).toContain("DID");

    const sipNumberResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${sipConnectionId}/register-number`)
      .send({
        actorUserId: "user-ops-lead",
        phoneNumber: "+233302001100",
        friendlyName: "Accra trunk DID",
      });

    expect(sipNumberResponse.status).toBe(201);
    const sipNumberId = sipNumberResponse.body.phoneNumber.id as string;

    const sipRouteResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${sipNumberId}/routing`)
      .send({
        actorUserId: "user-ops-lead",
        publishedVersionId: "workflow-frontdesk-v1",
        workflowLabel: "Front desk",
        workspaceId: "workspace-frontdesk",
      });

    expect(sipRouteResponse.status).toBe(200);

    const sipValidateAfterRoute = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${sipConnectionId}/validate`)
      .send({
        actorUserId: "user-ops-lead",
      });

    expect(sipValidateAfterRoute.status).toBe(200);
    expect(sipValidateAfterRoute.body.healthCheck.status).toBe("healthy");

    const outboundBlockedResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/outbound")
      .send({
        fromPhoneNumber: "+14155550110",
        toPhoneNumber: "+14155550999",
        callSid: "CA-outbound-blocked-1",
        publishedVersionId: "workflow-vip-v1",
        workflowLabel: "VIP reception",
        workspaceId: "workspace-vip",
        consentGranted: false,
        budgetRemainingUsd: 5,
        estimatedCostUsd: 0.75,
        localHour: 11,
        callingWindow: {
          startHour: 8,
          endHour: 19,
        },
      });

    expect(outboundBlockedResponse.status).toBe(201);
    expect(outboundBlockedResponse.body.dispatch.disposition).toBe("blocked");
    expect(outboundBlockedResponse.body.dispatch.policyChecks.consent.status).toBe("blocked");

    const outboundQueuedResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/outbound")
      .send({
        fromPhoneNumber: "+14155550110",
        toPhoneNumber: "+14155550999",
        callSid: "CA-outbound-queued-1",
        publishedVersionId: "workflow-vip-v1",
        workflowLabel: "VIP reception",
        workspaceId: "workspace-vip",
        consentGranted: true,
        budgetRemainingUsd: 5,
        estimatedCostUsd: 0.75,
        localHour: 11,
        callingWindow: {
          startHour: 8,
          endHour: 19,
        },
      });

    expect(outboundQueuedResponse.status).toBe(201);
    expect(outboundQueuedResponse.body.dispatch).toMatchObject({
      direction: "outbound",
      disposition: "queued",
      publishedVersionId: "workflow-vip-v1",
    });
    expect(outboundQueuedResponse.body.state.executionSessions[0]).toMatchObject({
      status: "ringing",
      provider: "twilio",
      testCall: false,
      bridgeKind: "platform-edge",
      mediaPath: "provider-native",
    });
    const outboundCommands = outboundQueuedResponse.body.state.executionCommands.filter(
      (command: { callSessionId: string }) =>
        command.callSessionId === outboundQueuedResponse.body.dispatch.callSessionId,
    );
    expect(outboundCommands.map((command: { action: string }) => command.action)).toEqual([
      "telephony.recording.play-notice",
      "platform.edge.originate-call",
    ]);
    expect(outboundCommands[1]).toMatchObject({
      action: "platform.edge.originate-call",
      target: "eu-west-1",
      status: "applied",
    });

    const callSessionId = outboundQueuedResponse.body.dispatch.callSessionId as string;

    const dtmfEventResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/events`)
      .send({
        dispatchId: outboundQueuedResponse.body.dispatch.id,
        eventType: "dtmf.received",
        digit: "4",
      });

    expect(dtmfEventResponse.status).toBe(201);
    expect(dtmfEventResponse.body.event.summary).toContain("DTMF");

    const transferFailedResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(callSessionId)}/events`)
      .send({
        dispatchId: outboundQueuedResponse.body.dispatch.id,
        eventType: "transfer.failed",
        transferTarget: "+14155550888",
        fallbackTarget: "Billing voicemail",
      });

    expect(transferFailedResponse.status).toBe(201);
    expect(transferFailedResponse.body.event.fallbackTarget).toBe("Billing voicemail");
    expect(transferFailedResponse.body.session).toMatchObject({
      callSessionId,
      status: "failover-active",
      outageMode: "provider-fallback",
      fallbackTarget: "Billing voicemail",
    });
    expect(transferFailedResponse.body.state.executionCommands[0]).toMatchObject({
      action: "platform.edge.failover",
      target: "Billing voicemail",
      status: "applied",
    });

    await app.close();
  }, 30_000);

  it("enforces outbound abuse rate limits, pauses tenants, and writes review logs", async () => {
    const app = await createTestingApp();

    const connectionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/connections")
      .send({
        actorUserId: "user-ops-lead",
        label: "Zara campaign edge",
        ownershipMode: "platform_managed",
        provider: "twilio",
        region: "eu-west-1",
        blockRoutingOnHealthFailure: true,
      });
    const connectionId = connectionResponse.body.connection.id as string;
    const numberResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/register-number`)
      .send({
        actorUserId: "user-ops-lead",
        phoneNumber: "+14155550110",
        friendlyName: "Campaign caller ID",
      });
    const phoneNumberId = numberResponse.body.phoneNumber.id as string;
    await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
      .send({
        publishedVersionId: "workflow-campaign-v1",
        workflowLabel: "Campaign reception",
        workspaceId: "workspace-campaign",
      });

    const firstCampaignResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/outbound")
      .send({
        actorUserId: "user-campaign-operator",
        fromPhoneNumber: "+14155550110",
        toPhoneNumber: "+14155550998",
        callSid: "CA-outbound-campaign-1",
        publishedVersionId: "workflow-campaign-v1",
        workflowLabel: "Campaign reception",
        workspaceId: "workspace-campaign",
        consentGranted: true,
        budgetRemainingUsd: 5,
        estimatedCostUsd: 0.75,
        localHour: 11,
        callingWindow: {
          startHour: 8,
          endHour: 19,
        },
        abusePolicy: {
          maxCallsPerWindow: 1,
          windowSeconds: 60,
          pauseTenantOnViolation: true,
        },
        now: "2026-05-24T10:00:00.000Z",
      });

    expect(firstCampaignResponse.status).toBe(201);
    expect(firstCampaignResponse.body.dispatch.disposition).toBe("queued");
    expect(firstCampaignResponse.body.dispatch.policyChecks.consent.status).toBe("passed");
    expect(firstCampaignResponse.body.dispatch.policyChecks.abuse.status).toBe("passed");

    const burstBlockedResponse = await withTestTenantAuth(
      request(app.getHttpServer()).post("/organizations/tenant-west-africa/telephony/dispatch/outbound"),
      { userId: "user-campaign-operator" },
    ).send({
        actorUserId: "user-campaign-operator",
        fromPhoneNumber: "+14155550110",
        toPhoneNumber: "+14155550997",
        callSid: "CA-outbound-campaign-2",
        publishedVersionId: "workflow-campaign-v1",
        workflowLabel: "Campaign reception",
        workspaceId: "workspace-campaign",
        consentGranted: true,
        budgetRemainingUsd: 5,
        estimatedCostUsd: 0.75,
        localHour: 11,
        callingWindow: {
          startHour: 8,
          endHour: 19,
        },
        abusePolicy: {
          maxCallsPerWindow: 1,
          windowSeconds: 60,
          pauseTenantOnViolation: true,
        },
        now: "2026-05-24T10:00:30.000Z",
      });

    expect(burstBlockedResponse.status).toBe(201);
    expect(burstBlockedResponse.body.dispatch).toMatchObject({
      disposition: "blocked",
      reason: "Outbound abuse rate limit exceeded for this tenant.",
      policyChecks: {
        consent: {
          status: "passed",
        },
        abuse: {
          status: "blocked",
        },
      },
    });
    expect(burstBlockedResponse.body.state.connections[0]).toMatchObject({
      status: "disabled",
      healthStatus: "failed",
    });

    const auditResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/compliance/audit-logs",
    );

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "telephony.outbound_abuse_paused",
          actor: {
            type: "user",
            id: "user-campaign-operator",
          },
          target: {
            type: "tenant",
            id: "tenant-west-africa",
          },
          outcome: "failed",
          metadata: expect.objectContaining({
            recentOutboundCallCount: 1,
          }),
        }),
      ]),
    );

    await app.close();
  }, 30_000);

  it("blocks DNC and timezone-unsafe outbound calls unless an audited emergency override is supplied", async () => {
    const app = await createTestingApp();

    const connectionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/connections")
      .send({
        actorUserId: "user-ops-lead",
        label: "Zara compliance edge",
        ownershipMode: "platform_managed",
        provider: "twilio",
        region: "eu-west-1",
        blockRoutingOnHealthFailure: true,
      });
    const connectionId = connectionResponse.body.connection.id as string;
    const numberResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/register-number`)
      .send({
        actorUserId: "user-ops-lead",
        phoneNumber: "+14155550110",
        friendlyName: "Compliance caller ID",
      });
    const phoneNumberId = numberResponse.body.phoneNumber.id as string;
    await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
      .send({
        publishedVersionId: "workflow-compliance-v1",
        workflowLabel: "Compliance reception",
        workspaceId: "workspace-compliance",
      });

    const dncBlockedResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/outbound")
      .send({
        actorUserId: "user-campaign-operator",
        fromPhoneNumber: "+14155550110",
        toPhoneNumber: "+14155550997",
        callSid: "CA-dnc-blocked-1",
        publishedVersionId: "workflow-compliance-v1",
        workflowLabel: "Compliance reception",
        workspaceId: "workspace-compliance",
        consentGranted: true,
        budgetRemainingUsd: 5,
        estimatedCostUsd: 0.75,
        localHour: 11,
        callingWindow: {
          startHour: 8,
          endHour: 19,
        },
        compliancePolicy: {
          dncPhoneNumbers: ["+14155550997"],
          timezone: "Africa/Lagos",
          localTime: "2026-05-24T11:00:00+01:00",
        },
      });

    expect(dncBlockedResponse.status).toBe(201);
    expect(dncBlockedResponse.body.dispatch).toMatchObject({
      disposition: "blocked",
      reason: "Outbound call blocked because the destination is on the tenant do-not-call list.",
      policyChecks: {
        dnc: {
          status: "blocked",
        },
      },
    });

    const unknownTimezoneResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/outbound")
      .send({
        actorUserId: "user-campaign-operator",
        fromPhoneNumber: "+14155550110",
        toPhoneNumber: "+14155550996",
        callSid: "CA-timezone-unknown-1",
        publishedVersionId: "workflow-compliance-v1",
        workflowLabel: "Compliance reception",
        workspaceId: "workspace-compliance",
        consentGranted: true,
        budgetRemainingUsd: 5,
        estimatedCostUsd: 0.75,
        localHour: 11,
        callingWindow: {
          startHour: 8,
          endHour: 19,
        },
        compliancePolicy: {
          dncPhoneNumbers: [],
        },
      });

    expect(unknownTimezoneResponse.body.dispatch).toMatchObject({
      disposition: "blocked",
      policyChecks: {
        timezone: {
          status: "blocked",
        },
      },
    });

    const overrideResponse = await withTestTenantAuth(
      request(app.getHttpServer()).post("/organizations/tenant-west-africa/telephony/dispatch/outbound"),
      { userId: "user-campaign-operator" },
    ).send({
        actorUserId: "user-campaign-operator",
        fromPhoneNumber: "+14155550110",
        toPhoneNumber: "+14155550996",
        callSid: "CA-timezone-override-1",
        publishedVersionId: "workflow-compliance-v1",
        workflowLabel: "Compliance reception",
        workspaceId: "workspace-compliance",
        consentGranted: true,
        budgetRemainingUsd: 5,
        estimatedCostUsd: 0.75,
        localHour: 23,
        callingWindow: {
          startHour: 8,
          endHour: 19,
        },
        compliancePolicy: {
          dncPhoneNumbers: [],
          timezone: "America/New_York",
          localTime: "2026-05-24T23:00:00-04:00",
          override: {
            reason: "Emergency callback requested by caller",
            approvedByUserId: "user-compliance-admin",
          },
        },
      });

    expect(overrideResponse.status).toBe(201);
    expect(overrideResponse.body.dispatch).toMatchObject({
      disposition: "queued",
      policyChecks: {
        timezone: {
          status: "passed",
        },
      },
    });

    const auditResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/compliance/audit-logs",
    );

    expect(auditResponse.body.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "telephony.outbound_compliance_override",
          actor: {
            type: "user",
            id: "user-campaign-operator",
          },
          target: {
            type: "outbound_call",
            id: "CA-timezone-override-1",
          },
          outcome: "succeeded",
          metadata: expect.objectContaining({
            approvedByUserId: "user-compliance-admin",
            reason: "Emergency callback requested by caller",
          }),
        }),
      ]),
    );

    await app.close();
  }, 30_000);

  it("chooses human takeover or callback fallback by provider capability and audits the safe caller message", async () => {
    const app = await createTestingApp();

    const platformConnectionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/connections")
      .send({
        actorUserId: "user-ops-lead",
        label: "Zara Edge West",
        ownershipMode: "platform_managed",
        provider: "twilio",
        region: "eu-west-1",
        blockRoutingOnHealthFailure: true,
      });
    const platformConnectionId = platformConnectionResponse.body.connection.id as string;
    const platformNumberResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${platformConnectionId}/register-number`)
      .send({
        actorUserId: "user-ops-lead",
        phoneNumber: "+14155550110",
        friendlyName: "Premium support",
      });
    const platformNumberId = platformNumberResponse.body.phoneNumber.id as string;
    await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${platformNumberId}/routing`)
      .send({
        publishedVersionId: "workflow-vip-v1",
        workflowLabel: "VIP reception",
        workspaceId: "workspace-vip",
      });
    await activateRouteWithOverride({
      app,
      phoneNumberId: platformNumberId,
      now: "2026-05-19T15:55:00.000Z",
    });
    const platformDispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: "+14155550110",
        fromPhoneNumber: "+233201110001",
        callSid: "CA-human-fallback-platform-1",
      });
    const platformCallSessionId = platformDispatchResponse.body.dispatch.callSessionId as string;

    const takeoverResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(platformCallSessionId)}/human-fallback`)
      .send({
        dispatchId: platformDispatchResponse.body.dispatch.id,
        actorUserId: "user-ops-lead",
        transferTarget: "+14155550888",
        callbackNumber: "+233201110001",
        now: "2026-05-19T16:00:00.000Z",
      });

    expect(takeoverResponse.status).toBe(201);
    expect(takeoverResponse.body.fallback).toMatchObject({
      action: "takeover",
      providerCapability: "live-transfer",
      callerMessage: "I am connecting you with a specialist now. If the transfer drops, we will call you back using the number on this call.",
    });
    expect(takeoverResponse.body.event).toMatchObject({
      eventType: "transfer.requested",
      summary: "Human takeover requested. I am connecting you with a specialist now. If the transfer drops, we will call you back using the number on this call.",
      payload: expect.objectContaining({
        actorUserId: "user-ops-lead",
        callerMessage: "I am connecting you with a specialist now. If the transfer drops, we will call you back using the number on this call.",
        transferTarget: "+14155550888",
      }),
    });
    expect(takeoverResponse.body.state.executionCommands[0]).toMatchObject({
      action: "platform.edge.transfer",
      target: "+14155550888",
      payload: expect.objectContaining({
        actorUserId: "user-ops-lead",
      }),
    });

    const sipConnectionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/connections")
      .send({
        actorUserId: "user-ops-lead",
        label: "Accra SIP trunk",
        ownershipMode: "byo_sip_trunk",
        provider: "custom-sip",
        region: "eu-west-1",
        blockRoutingOnHealthFailure: true,
        username: "acme-trunk",
        secret: "sip-secret-value-1234567890",
        sip: {
          domain: "sip.acme.example",
          codecs: ["opus", "pcmu"],
        },
      });
    const sipConnectionId = sipConnectionResponse.body.connection.id as string;
    const sipNumberResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${sipConnectionId}/register-number`)
      .send({
        actorUserId: "user-ops-lead",
        phoneNumber: "+233302001100",
        friendlyName: "Accra trunk DID",
      });
    const sipNumberId = sipNumberResponse.body.phoneNumber.id as string;
    await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${sipNumberId}/routing`)
      .send({
        publishedVersionId: "workflow-frontdesk-v1",
        workflowLabel: "Front desk",
        workspaceId: "workspace-frontdesk",
      });
    await activateRouteWithOverride({
      app,
      phoneNumberId: sipNumberId,
      now: "2026-05-19T16:01:00.000Z",
    });
    const sipDispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: "+233302001100",
        fromPhoneNumber: "+233201110001",
        callSid: "CA-human-fallback-sip-1",
      });
    const sipCallSessionId = sipDispatchResponse.body.dispatch.callSessionId as string;

    const invalidCallbackResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(sipCallSessionId)}/human-fallback`)
      .send({
        dispatchId: sipDispatchResponse.body.dispatch.id,
        actorUserId: "user-ops-lead",
        transferTarget: "+14155550888",
        callbackNumber: "not-a-phone-number",
      });

    expect(invalidCallbackResponse.status).toBe(409);
    expect(invalidCallbackResponse.body.message).toContain("Callback number");

    const callbackResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/calls/${encodeURIComponent(sipCallSessionId)}/human-fallback`)
      .send({
        dispatchId: sipDispatchResponse.body.dispatch.id,
        actorUserId: "user-ops-lead",
        transferTarget: "+14155550888",
        callbackNumber: "+233201110001",
        now: "2026-05-19T16:05:00.000Z",
      });

    expect(callbackResponse.status).toBe(201);
    expect(callbackResponse.body.fallback).toMatchObject({
      action: "callback",
      providerCapability: "callback-only",
      callerMessage: "A specialist is not available on this line right now. We will call you back at the number we have for this call.",
    });
    expect(callbackResponse.body.event).toMatchObject({
      eventType: "callback.scheduled",
      fallbackTarget: "Callback +233201110001",
      payload: expect.objectContaining({
        actorUserId: "user-ops-lead",
        callbackNumber: "+233201110001",
        callerMessage: "A specialist is not available on this line right now. We will call you back at the number we have for this call.",
      }),
    });
    expect(callbackResponse.body.state.executionCommands[0]).toMatchObject({
      action: "sip.notify.callback",
      target: "Callback +233201110001",
      payload: expect.objectContaining({
        callerMessage: "A specialist is not available on this line right now. We will call you back at the number we have for this call.",
      }),
    });

    await app.close();
  }, 30_000);

  it("supports provider heartbeats, loopback test calls, and credential rotation for telephony operations", async () => {
    const app = await createTestingApp();

    const twilioConnectResponse = await request(app.getHttpServer())
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

    const connectionId = twilioConnectResponse.body.connection.id as string;

    await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
      .send({});

    const importedNumber = (
      await request(app.getHttpServer()).get("/organizations/tenant-west-africa/telephony/state")
    ).body.phoneNumbers[0] as { id: string; phoneNumber: string };

    await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${importedNumber.id}/routing`)
      .send({
        publishedVersionId: "workflow-support-v1",
        workflowLabel: "Support triage",
        workspaceId: "workspace-customer-success",
      });

    const heartbeatResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/heartbeat`)
      .send({
        scheduled: false,
      });

    expect(heartbeatResponse.status).toBe(201);
    expect(heartbeatResponse.body.heartbeat).toMatchObject({
      status: "healthy",
      scheduled: false,
      connectionId,
    });
    expect(heartbeatResponse.body.heartbeat.diagnostics.join(" ")).toContain("Twilio");

    await activateRouteWithOverride({
      app,
      phoneNumberId: importedNumber.id,
      now: "2026-05-20T12:01:00.000Z",
    });

    const testCallResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/test-call`)
      .send({
        phoneNumberId: importedNumber.id,
        fromPhoneNumber: "+233201110001",
        callSid: "CA-test-call-1",
      });

    expect(testCallResponse.status).toBe(201);
    expect(testCallResponse.body.dispatch).toMatchObject({
      disposition: "routed",
      publishedVersionId: "workflow-support-v1",
    });
    expect(testCallResponse.body.session).toMatchObject({
      callSessionId: "CA-test-call-1:telephony",
      status: "ringing",
      testCall: true,
    });

    const rotationResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/credentials/rotate")
      .send({});

    expect(rotationResponse.status).toBe(201);
    expect(rotationResponse.body.rotatedConnectionCount).toBe(1);

    await app.close();
  }, 30_000);

  it("does not expose telephony connections numbers or call sessions across tenants", async () => {
    const app = await createTestingApp();

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/connections")
      .send({
        actorUserId: "user-ops-lead",
        label: "West tenant edge",
        ownershipMode: "platform_managed",
        provider: "twilio",
        region: "eu-west-1",
        blockRoutingOnHealthFailure: true,
      });
    const connectionId = connectResponse.body.connection.id as string;

    const numberResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/register-number`)
      .send({
        actorUserId: "user-ops-lead",
        phoneNumber: "+14155550110",
        friendlyName: "West support",
      });
    const phoneNumberId = numberResponse.body.phoneNumber.id as string;

    await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
      .send({
        publishedVersionId: "workflow-west-v1",
        workflowLabel: "West support",
        workspaceId: "workspace-west",
      });

    const dispatchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/inbound")
      .send({
        toPhoneNumber: "+14155550110",
        fromPhoneNumber: "+233201110001",
        callSid: "CA-west-isolation-1",
      });
    const callSessionId = dispatchResponse.body.dispatch.callSessionId as string;
    const dispatchId = dispatchResponse.body.dispatch.id as string;

    const crossTenantValidateResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/telephony/connections/${connectionId}/validate`)
      .send({});
    const crossTenantRouteResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-east-africa/telephony/numbers/${phoneNumberId}/routing`)
      .send({
        publishedVersionId: "workflow-east-v1",
        workflowLabel: "East support",
        workspaceId: "workspace-east",
      });
    const crossTenantCallEventResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/telephony/calls/${encodeURIComponent(callSessionId)}/events`)
      .send({
        dispatchId,
        eventType: "dtmf.received",
        digit: "1",
      });
    const crossTenantHumanFallbackResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/telephony/calls/${encodeURIComponent(callSessionId)}/human-fallback`)
      .send({
        dispatchId,
        actorUserId: "user-ops-lead",
        transferTarget: "+14155550888",
        callbackNumber: "+233201110001",
      });
    const eastStateResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-east-africa/telephony/state",
    );
    const westStateResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/telephony/state",
    );

    expect(crossTenantValidateResponse.status).toBe(404);
    expect(crossTenantRouteResponse.status).toBe(404);
    expect(crossTenantCallEventResponse.status).toBe(404);
    expect(crossTenantHumanFallbackResponse.status).toBe(404);
    expect(eastStateResponse.status).toBe(200);
    expect(eastStateResponse.body.connections).toEqual([]);
    expect(eastStateResponse.body.phoneNumbers).toEqual([]);
    expect(eastStateResponse.body.dispatches).toEqual([]);
    expect(westStateResponse.body.dispatches).toHaveLength(1);
    expect(JSON.stringify(eastStateResponse.body)).not.toContain("CA-west-isolation-1");

    await app.close();
  }, 30_000);
});

async function createTestingApp(input: {
  installTenantAuth?: boolean | undefined;
  twilioRouting?: TwilioNumberRoutingProvider | undefined;
} = {}) {
  const moduleRef = await Test.createTestingModule({
    imports: [ComplianceModule],
  })
    .overrideProvider(TELEPHONY_STATE_REPOSITORY)
    .useValue(
      new FileTelephonyStateRepository(
        join(tmpdir(), "zara-telephony-tests", randomUUID()),
      ),
    )
    .overrideProvider(BILLING_STATE_REPOSITORY)
    .useValue(
      new FileBillingStateRepository(
        join(tmpdir(), "zara-telephony-billing-tests", randomUUID()),
      ),
    )
    .overrideProvider(AUDIT_LOG_REPOSITORY)
    .useValue(
      new FileAuditLogRepository(
        join(tmpdir(), "zara-telephony-audit-tests", randomUUID()),
      ),
    )
    .overrideProvider(TWILIO_NUMBER_INVENTORY_PROVIDER)
    .useValue(createGeneratedTwilioInventoryProvider())
    .overrideProvider(TWILIO_NUMBER_ROUTING_PROVIDER)
    .useValue(input.twilioRouting ?? createCapturingTwilioRoutingProvider())
    .overrideProvider(BILLING_POLAR_CLIENT)
    .useValue(createPolarClient())
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  configureCors(app);
  if (input.installTenantAuth !== false) {
    installTestTenantAuth(app);
  }
  await app.init();

  return app;
}

function createGeneratedTwilioInventoryProvider(): TwilioNumberInventoryProvider {
  const numbers: AvailableTwilioPhoneNumber[] = [
    {
      sid: "PN78901001",
      phoneNumber: "+14155557890",
      friendlyName: "Support line",
      capabilities: {
        voice: true,
        sms: true,
      },
    },
    {
      sid: "PN78902002",
      phoneNumber: "+14156667890",
      friendlyName: "Reception line",
      capabilities: {
        voice: true,
        sms: false,
      },
    },
    {
      sid: "PN78903003",
      phoneNumber: "+14157777890",
      friendlyName: "SMS campaigns",
      capabilities: {
        voice: false,
        sms: true,
      },
    },
  ];

  return {
    async listIncomingPhoneNumbers() {
      return numbers;
    },
  };
}

function createCapturingTwilioRoutingProvider(options: {
  callDetails?: TwilioCallDiagnosticDetail[] | undefined;
  configuration?: TwilioIncomingNumberRouteConfiguration | undefined;
  monitorAlerts?: TwilioMonitorAlertDiagnostic[] | undefined;
  recentCalls?: TwilioRecentCallDiagnostic[] | undefined;
} = {}): TwilioNumberRoutingProvider & {
  callDetailRequests: Array<{
    accountSid: string;
    authToken: string;
    callSid: string;
  }>;
  terminationRequests: Array<{
    accountSid: string;
    authToken: string;
    callSid: string;
  }>;
  requests: Array<{
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
    statusCallbackUrl?: string | undefined;
    voiceUrl: string;
  }>;
  inspections: Array<{
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
  }>;
  recentCallRequests: Array<{
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    limit?: number | undefined;
  }>;
  monitorAlertRequests: Array<{
    accountSid: string;
    authToken: string;
    startDate?: string | undefined;
    endDate?: string | undefined;
    limit?: number | undefined;
  }>;
} {
  const requests: Array<{
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
    statusCallbackUrl?: string | undefined;
    voiceUrl: string;
  }> = [];
  const inspections: Array<{
    accountSid: string;
    authToken: string;
    phoneNumberSid: string;
  }> = [];
  const recentCallRequests: Array<{
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    limit?: number | undefined;
  }> = [];
  const monitorAlertRequests: Array<{
    accountSid: string;
    authToken: string;
    startDate?: string | undefined;
    endDate?: string | undefined;
    limit?: number | undefined;
  }> = [];
  const callDetailRequests: Array<{
    accountSid: string;
    authToken: string;
    callSid: string;
  }> = [];
  const terminationRequests: Array<{
    accountSid: string;
    authToken: string;
    callSid: string;
  }> = [];

  return {
    callDetailRequests,
    inspections,
    monitorAlertRequests,
    recentCallRequests,
    requests,
    terminationRequests,
    async configureIncomingPhoneNumberWebhook(input) {
      requests.push(input);
      return {
        sid: input.phoneNumberSid,
        trunkSid: null,
        voiceApplicationSid: null,
        voiceMethod: "POST",
        statusCallback: input.statusCallbackUrl,
        voiceUrl: input.voiceUrl,
        ...options.configuration,
      };
    },
    async inspectIncomingPhoneNumber(input) {
      inspections.push(input);
      return {
        sid: input.phoneNumberSid,
        trunkSid: null,
        voiceApplicationSid: null,
        voiceMethod: "POST",
        ...options.configuration,
      };
    },
    async listRecentCallsForNumber(input) {
      recentCallRequests.push(input);
      return options.recentCalls ?? [];
    },
    async retrieveCall(input) {
      callDetailRequests.push(input);
      return options.callDetails?.find((call) => call.sid === input.callSid) ?? {
        sid: input.callSid,
      };
    },
    async terminateCall(input) {
      terminationRequests.push(input);
      return {
        sid: input.callSid,
        status: "completed",
      };
    },
    async listRecentMonitorAlerts(input) {
      monitorAlertRequests.push(input);
      return options.monitorAlerts ?? [];
    },
  };
}

function createPolarClient(): BillingPolarClient {
  return {
    createdCheckouts: [],
    createdCustomerSessions: [],
    ingestedUsageEvents: [],
    async createCheckout(input) {
      this.createdCheckouts.push(input);
      return {
        providerCheckoutId: "polar_checkout_growth",
        checkoutUrl: "https://polar.sh/checkout/session_growth",
      };
    },
    async createCustomerPortal(input) {
      this.createdCustomerSessions.push(input);
      return {
        customerPortalUrl: "https://polar.sh/tuzzy/portal/session",
      };
    },
    async ingestUsageEvent(input) {
      this.ingestedUsageEvents.push(input);
      return {
        providerEventId: "polar_usage_event_1",
      };
    },
  };
}

async function activateRouteWithOverride(input: {
  app: INestApplication;
  organizationId?: string | undefined;
  phoneNumberId: string;
  actorUserId?: string | undefined;
  now?: string | undefined;
}) {
  const organizationId = input.organizationId ?? "tenant-west-africa";
  const actorUserId = input.actorUserId ?? "user-ops-lead";
  const response = await withTestTenantAuth(
    request(input.app.getHttpServer())
      .post(`/organizations/${organizationId}/telephony/numbers/${input.phoneNumberId}/live-route/activate`),
    { organizationId, userId: actorUserId },
  ).send({
      actorUserId,
      now: input.now ?? "2026-05-14T12:12:00.000Z",
      override: {
        actorUserId,
        approvedByUserId: "platform-admin-1",
        reason: "Test fixture override for non-PSTN activation coverage.",
      },
    });

  expect(response.status).toBe(201);
  expect(response.body.activation.summary.override).toMatchObject({
    approvedByUserId: actorUserId,
  });

  return response;
}

function resolveActivationBlocks(body: {
  blocks?: unknown;
  message?: { blocks?: unknown } | string;
}) {
  if (Array.isArray(body.blocks)) {
    return body.blocks;
  }

  if (typeof body.message === "object" && Array.isArray(body.message.blocks)) {
    return body.message.blocks;
  }

  return [];
}
