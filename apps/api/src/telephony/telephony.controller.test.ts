import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { computeTwilioWebhookSignature } from "@zara/core";

import { ComplianceModule } from "../compliance/compliance.module";
import { configureCors } from "../config/cors";
import {
  FileTelephonyStateRepository,
  TELEPHONY_STATE_REPOSITORY,
} from "./telephony-state.repository";

describe("TelephonyController", () => {
  it("connects a BYO Twilio account, imports voice numbers, assigns routing, validates health, and dispatches inbound calls", async () => {
    const app = await createTestingApp();

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
    expect(webhookResponse.headers["content-type"]).toContain("text/xml");
    expect(webhookResponse.text).toContain("<Connect>");
    expect(webhookResponse.text).toContain(
      '<Stream url="wss://127.0.0.1/telephony/twilio/media-streams/CA-webhook-1%3Atelephony">',
    );
    expect(webhookResponse.text).toContain(
      '<Parameter name="zaraCallSessionId" value="CA-webhook-1:telephony" />',
    );
    expect(webhookResponse.text).toContain(
      '<Parameter name="zaraPublishedVersionId" value="workflow-support-v1" />',
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

    const burstBlockedResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/outbound")
      .send({
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

    const overrideResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/telephony/dispatch/outbound")
      .send({
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

async function createTestingApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [ComplianceModule],
  })
    .overrideProvider(TELEPHONY_STATE_REPOSITORY)
    .useValue(
      new FileTelephonyStateRepository(
        join(tmpdir(), "zara-telephony-tests", randomUUID()),
      ),
    )
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  configureCors(app);
  await app.init();

  return app;
}
