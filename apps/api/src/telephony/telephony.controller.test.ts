import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { computeTwilioWebhookSignature } from "@zara/core";

import { configureCors } from "../config/cors";
import { TelephonyModule } from "./telephony.module";

describe("TelephonyController", () => {
  it("connects a BYO Twilio account, imports voice numbers, assigns routing, validates health, and dispatches inbound calls", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelephonyModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    configureCors(app);
    await app.init();

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
        workspaceId: "workspace-support",
        recordingPolicy: {
          enabled: true,
          consentMode: "two-party",
          consentMessage: "Please note this call is being recorded.",
        },
      });

    expect(routingResponse.status).toBe(200);
    expect(routingResponse.body.state.phoneNumbers[0]).toMatchObject({
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-support",
      webhookStatus: "configured",
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
      workspaceId: "workspace-support",
    });
    expect(dispatchResponse.body.dispatch.recording.consentMode).toBe("two-party");

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
    expect(webhookResponse.body.dispatch).toMatchObject({
      disposition: "routed",
      publishedVersionId: "workflow-support-v1",
    });

    const duplicateWebhookResponse = await request(app.getHttpServer())
      .post("/telephony/webhooks/twilio")
      .set("x-twilio-signature", twilioSignature)
      .send(webhookPayload);

    expect(duplicateWebhookResponse.status).toBe(200);
    expect(duplicateWebhookResponse.body.duplicate).toBe(true);

    await app.close();
  }, 30_000);

  it("rejects invalid Twilio signatures and allows tenant web origins to preflight telephony routes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelephonyModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    configureCors(app);
    await app.init();

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
    const moduleRef = await Test.createTestingModule({
      imports: [TelephonyModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    configureCors(app);
    await app.init();

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

    await app.close();
  }, 30_000);

  it("supports provider heartbeats, loopback test calls, and credential rotation for telephony operations", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelephonyModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    configureCors(app);
    await app.init();

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
        workspaceId: "workspace-support",
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
});
