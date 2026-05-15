import { describe, expect, it } from "vitest";

import {
  assignTelephonyNumberRoute,
  createTelephonyConnection,
  defaultRecordingPolicy,
  importTwilioPhoneNumbers,
  resolveInboundCall,
  verifyTwilioWebhookSignature,
} from "./telephony";

describe("telephony domain", () => {
  it("supports platform-managed, BYO SIP, and BYO Twilio connections without exposing raw credentials", () => {
    const platformManaged = createTelephonyConnection({
      id: "connection-platform",
      tenantId: "tenant-west-africa",
      label: "Zara shared edge",
      ownershipMode: "platform_managed",
      provider: "twilio",
      region: "eu-west-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy(),
      blockRoutingOnHealthFailure: true,
    });

    const sipTrunk = createTelephonyConnection({
      id: "connection-sip",
      tenantId: "tenant-west-africa",
      label: "Acme SIP trunk",
      ownershipMode: "byo_sip_trunk",
      provider: "custom-sip",
      region: "eu-west-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy({
        consentMode: "two-party",
      }),
      blockRoutingOnHealthFailure: true,
      credentials: {
        secret: "sip-secret-value-1234567890",
        username: "sip-user",
      },
      sip: {
        domain: "sip.acme.example",
        codecs: ["pcmu", "opus"],
      },
    });

    const byoTwilio = createTelephonyConnection({
      id: "connection-twilio",
      tenantId: "tenant-west-africa",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy(),
      blockRoutingOnHealthFailure: true,
      credentials: {
        accountSid: "AC1234567890abcdef1234567890abcd",
        secret: "twilio-auth-token-1234567890",
      },
      webhookBaseUrl: "https://app.zara.ai/telephony/webhooks/twilio",
    });

    expect(platformManaged.ownershipMode).toBe("platform_managed");
    expect(sipTrunk.ownershipMode).toBe("byo_sip_trunk");
    expect(byoTwilio.ownershipMode).toBe("byo_provider_account");
    expect(sipTrunk.credentialReference?.preview).toBe("****7890");
    expect(byoTwilio.credentialReference?.preview).toBe("****7890");
    expect(Object.prototype.hasOwnProperty.call(sipTrunk, "secret")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(byoTwilio, "secret")).toBe(false);
  });

  it("imports only voice-capable Twilio numbers and routes inbound calls to the assigned workflow", () => {
    const connection = createTelephonyConnection({
      id: "connection-twilio",
      tenantId: "tenant-west-africa",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy(),
      blockRoutingOnHealthFailure: true,
      credentials: {
        accountSid: "AC1234567890abcdef1234567890abcd",
        secret: "twilio-auth-token-1234567890",
      },
      webhookBaseUrl: "https://app.zara.ai/telephony/webhooks/twilio",
    });

    const importedNumbers = importTwilioPhoneNumbers({
      tenantId: "tenant-west-africa",
      connectionId: connection.id,
      existingNumbers: [],
      availableNumbers: [
        {
          sid: "PN_voice",
          phoneNumber: "+14155550100",
          friendlyName: "Support line",
          capabilities: {
            voice: true,
            sms: true,
          },
        },
        {
          sid: "PN_sms_only",
          phoneNumber: "+14155550101",
          friendlyName: "SMS campaign",
          capabilities: {
            voice: false,
            sms: true,
          },
        },
      ],
    });

    expect(importedNumbers.map((number) => number.phoneNumber)).toEqual(["+14155550100"]);

    const routedNumbers = assignTelephonyNumberRoute({
      phoneNumbers: importedNumbers,
      numberId: importedNumbers[0]!.id,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-support",
      recordingPolicy: defaultRecordingPolicy({
        consentMode: "single-party",
      }),
    });

    const dispatch = resolveInboundCall({
      toPhoneNumber: "+1 (415) 555-0100",
      fromPhoneNumber: "+233201110001",
      callSid: "CA123",
      phoneNumbers: routedNumbers,
      connections: [connection],
      now: "2026-05-14T16:00:00.000Z",
    });

    expect(dispatch.disposition).toBe("routed");
    expect(dispatch.publishedVersionId).toBe("workflow-support-v1");
    expect(dispatch.workspaceId).toBe("workspace-support");
    expect(dispatch.recording.enabled).toBe(true);
    expect(dispatch.recording.consentMode).toBe("single-party");
  });

  it("blocks inbound routing when the connection health fails and policy requires a stop", () => {
    const blockedConnection = {
      ...createTelephonyConnection({
        id: "connection-twilio",
        tenantId: "tenant-west-africa",
        label: "Tenant Twilio account",
        ownershipMode: "byo_provider_account",
        provider: "twilio",
        region: "us-east-1",
        createdBy: "user-ops-lead",
        recordingPolicy: defaultRecordingPolicy(),
        blockRoutingOnHealthFailure: true,
        credentials: {
          accountSid: "AC1234567890abcdef1234567890abcd",
          secret: "twilio-auth-token-1234567890",
        },
        webhookBaseUrl: "https://app.zara.ai/telephony/webhooks/twilio",
      }),
      healthStatus: "failed" as const,
    };

    const routedNumbers = assignTelephonyNumberRoute({
      phoneNumbers: importTwilioPhoneNumbers({
        tenantId: "tenant-west-africa",
        connectionId: blockedConnection.id,
        existingNumbers: [],
        availableNumbers: [
          {
            sid: "PN_voice",
            phoneNumber: "+14155550100",
            friendlyName: "Support line",
            capabilities: {
              voice: true,
              sms: true,
            },
          },
        ],
      }),
      numberId: "phone-number-pn-voice",
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-support",
    });

    const dispatch = resolveInboundCall({
      toPhoneNumber: "+14155550100",
      fromPhoneNumber: "+233201110001",
      callSid: "CA124",
      phoneNumbers: routedNumbers,
      connections: [blockedConnection],
      now: "2026-05-14T16:00:00.000Z",
    });

    expect(dispatch.disposition).toBe("blocked");
    expect(dispatch.reason).toContain("health checks");
  });

  it("verifies Twilio webhook signatures from the absolute callback URL and request fields", () => {
    const url = "https://api.zara.ai/telephony/webhooks/twilio";
    const params = {
      AccountSid: "AC1234567890abcdef1234567890abcd",
      CallSid: "CA123",
      EventType: "incoming.call",
      To: "+14155550100",
    };
    const authToken = "twilio-auth-token-1234567890";
    const signature = "xnfnBzQ/q4vbA8jkpK7WPDUmtlA=";

    expect(
      verifyTwilioWebhookSignature({
        url,
        parameters: params,
        authToken,
        signature,
      }),
    ).toBe(true);

    expect(
      verifyTwilioWebhookSignature({
        url,
        parameters: {
          ...params,
          EventType: "call.completed",
        },
        authToken,
        signature,
      }),
    ).toBe(false);
  });
});
