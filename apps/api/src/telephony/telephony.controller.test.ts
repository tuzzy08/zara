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
  }, 15_000);

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
  }, 15_000);
});
