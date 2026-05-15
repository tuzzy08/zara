import { describe, expect, it } from "vitest";

import {
  applyTelephonyCallControlEventToSession,
  createTelephonyExecutionSession,
  createTelephonyProviderHeartbeat,
  createTelephonyCallControlEvent,
  assignTelephonyNumberRoute,
  createTelephonyConnection,
  defaultRecordingPolicy,
  importTwilioPhoneNumbers,
  provisionTelephonyPhoneNumber,
  resolveOutboundCall,
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

  it("provisions platform and SIP numbers for direct routing without provider imports", () => {
    const platformConnection = createTelephonyConnection({
      id: "connection-platform",
      tenantId: "tenant-west-africa",
      label: "Zara Edge West",
      ownershipMode: "platform_managed",
      provider: "twilio",
      region: "eu-west-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy({
        consentMode: "two-party",
      }),
      blockRoutingOnHealthFailure: true,
    });

    const sipConnection = createTelephonyConnection({
      id: "connection-sip",
      tenantId: "tenant-west-africa",
      label: "Acme SIP trunk",
      ownershipMode: "byo_sip_trunk",
      provider: "custom-sip",
      region: "eu-west-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy(),
      blockRoutingOnHealthFailure: true,
      credentials: {
        username: "acme-trunk",
        secret: "sip-secret-value-1234567890",
      },
      sip: {
        domain: "sip.acme.example",
        codecs: ["opus", "pcmu"],
      },
    });

    const platformNumber = provisionTelephonyPhoneNumber({
      tenantId: "tenant-west-africa",
      connection: platformConnection,
      existingNumbers: [],
      phoneNumber: "+14155550110",
      friendlyName: "Premium support",
    });

    const sipDid = provisionTelephonyPhoneNumber({
      tenantId: "tenant-west-africa",
      connection: sipConnection,
      existingNumbers: [platformNumber],
      phoneNumber: "+233302001100",
      friendlyName: "Accra trunk DID",
    });

    expect(platformNumber).toMatchObject({
      provider: "twilio",
      provisionSource: "platform-pool",
      webhookStatus: "configured",
      callerIdEligible: true,
    });
    expect(sipDid).toMatchObject({
      provider: "custom-sip",
      provisionSource: "manual-did",
      webhookStatus: "configured",
      callerIdEligible: true,
    });
  });

  it("enforces consent, budget, calling windows, and caller ID policy before outbound calls queue", () => {
    const connection = createTelephonyConnection({
      id: "connection-platform",
      tenantId: "tenant-west-africa",
      label: "Zara outbound edge",
      ownershipMode: "platform_managed",
      provider: "twilio",
      region: "eu-west-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy(),
      blockRoutingOnHealthFailure: true,
    });

    const routedNumber = assignTelephonyNumberRoute({
      phoneNumbers: [
        provisionTelephonyPhoneNumber({
          tenantId: "tenant-west-africa",
          connection,
          existingNumbers: [],
          phoneNumber: "+14155550110",
          friendlyName: "Outbound desk",
        }),
      ],
      numberId: "phone-number-14155550110",
      publishedVersionId: "workflow-billing-v2",
      workflowLabel: "Billing specialist",
      workspaceId: "workspace-billing",
    });

    const blocked = resolveOutboundCall({
      toPhoneNumber: "+14155550199",
      fromPhoneNumber: "+14155550110",
      callSid: "CA-outbound-1",
      phoneNumbers: routedNumber,
      connections: [connection],
      publishedVersionId: "workflow-billing-v2",
      workflowLabel: "Billing specialist",
      workspaceId: "workspace-billing",
      consentGranted: false,
      budgetRemainingUsd: 4,
      estimatedCostUsd: 1.2,
      localHour: 14,
      callingWindow: {
        startHour: 8,
        endHour: 19,
      },
    });

    expect(blocked.disposition).toBe("blocked");
    expect(blocked.policyChecks.consent.status).toBe("blocked");

    const queued = resolveOutboundCall({
      toPhoneNumber: "+14155550199",
      fromPhoneNumber: "+14155550110",
      callSid: "CA-outbound-2",
      phoneNumbers: routedNumber,
      connections: [connection],
      publishedVersionId: "workflow-billing-v2",
      workflowLabel: "Billing specialist",
      workspaceId: "workspace-billing",
      consentGranted: true,
      budgetRemainingUsd: 4,
      estimatedCostUsd: 1.2,
      localHour: 14,
      callingWindow: {
        startHour: 8,
        endHour: 19,
      },
    });

    expect(queued.disposition).toBe("queued");
    expect(queued.policyChecks.callerId.status).toBe("passed");
    expect(queued.callSessionId).toBe("CA-outbound-2:telephony");
  });

  it("treats DTMF, voicemail, transfer, and failover as first-class call-control events with explicit fallback paths", () => {
    const dtmfEvent = createTelephonyCallControlEvent({
      tenantId: "tenant-west-africa",
      dispatchId: "dispatch-1",
      callSessionId: "CA-voice-1:telephony",
      eventType: "dtmf.received",
      digit: "7",
    });

    const transferFailure = createTelephonyCallControlEvent({
      tenantId: "tenant-west-africa",
      dispatchId: "dispatch-1",
      callSessionId: "CA-voice-1:telephony",
      eventType: "transfer.failed",
      transferTarget: "+14155550888",
      fallbackTarget: "Billing voicemail",
    });

    expect(dtmfEvent.summary).toContain("DTMF");
    expect(transferFailure.fallbackTarget).toBe("Billing voicemail");
    expect(transferFailure.payload.transferTarget).toBe("+14155550888");

    expect(() =>
      createTelephonyCallControlEvent({
        tenantId: "tenant-west-africa",
        dispatchId: "dispatch-1",
        callSessionId: "CA-voice-1:telephony",
        eventType: "failover.triggered",
      }),
    ).toThrowError(/fallback/i);
  });

  it("fails over to another healthy routed number when the primary provider is down", () => {
    const failedTwilio = {
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
      status: "degraded" as const,
    };
    const platformFallback = createTelephonyConnection({
      id: "connection-platform",
      tenantId: "tenant-west-africa",
      label: "Zara Edge West",
      ownershipMode: "platform_managed",
      provider: "twilio",
      region: "eu-west-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy({
        consentMode: "two-party",
      }),
      blockRoutingOnHealthFailure: true,
    });

    const routedNumbers = assignTelephonyNumberRoute({
      phoneNumbers: assignTelephonyNumberRoute({
        phoneNumbers: [
          provisionTelephonyPhoneNumber({
            tenantId: "tenant-west-africa",
            connection: failedTwilio,
            existingNumbers: [],
            phoneNumber: "+14155550100",
            friendlyName: "Primary support line",
          }),
          provisionTelephonyPhoneNumber({
            tenantId: "tenant-west-africa",
            connection: platformFallback,
            existingNumbers: [],
            phoneNumber: "+14155550110",
            friendlyName: "Fallback support line",
          }),
        ],
        numberId: "phone-number-14155550100",
        publishedVersionId: "workflow-support-v2",
        workflowLabel: "Support escalation",
        workspaceId: "workspace-support",
      }),
      numberId: "phone-number-14155550110",
      publishedVersionId: "workflow-support-v2",
      workflowLabel: "Support escalation",
      workspaceId: "workspace-support",
    });

    const dispatch = resolveInboundCall({
      toPhoneNumber: "+14155550100",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-fallback-1",
      phoneNumbers: routedNumbers,
      connections: [failedTwilio, platformFallback],
      now: "2026-05-15T10:00:00.000Z",
    });

    expect(dispatch.disposition).toBe("fallback");
    expect(dispatch.connectionId).toBe("connection-platform");
    expect(dispatch.outageMode).toBe("provider-fallback");
    expect(dispatch.fallbackPhoneNumberId).toBe("phone-number-14155550110");
    expect(dispatch.reason).toContain("failed over");
  });

  it("creates provider-specific execution sessions and advances them when transfer failover happens", () => {
    const sipConnection = createTelephonyConnection({
      id: "connection-sip",
      tenantId: "tenant-west-africa",
      label: "Accra SIP trunk",
      ownershipMode: "byo_sip_trunk",
      provider: "custom-sip",
      region: "eu-west-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy(),
      blockRoutingOnHealthFailure: true,
      credentials: {
        username: "acme-trunk",
        secret: "sip-secret-value-1234567890",
      },
      sip: {
        domain: "sip.acme.example",
        codecs: ["opus", "pcmu"],
      },
    });

    const queued = resolveOutboundCall({
      toPhoneNumber: "+14155550999",
      fromPhoneNumber: "+233302001100",
      callSid: "CA-sip-outbound-1",
      phoneNumbers: assignTelephonyNumberRoute({
        phoneNumbers: [
          provisionTelephonyPhoneNumber({
            tenantId: "tenant-west-africa",
            connection: sipConnection,
            existingNumbers: [],
            phoneNumber: "+233302001100",
            friendlyName: "Accra outbound DID",
          }),
        ],
        numberId: "phone-number-233302001100",
        publishedVersionId: "workflow-frontdesk-v1",
        workflowLabel: "Front desk",
        workspaceId: "workspace-frontdesk",
      }),
      connections: [sipConnection],
      publishedVersionId: "workflow-frontdesk-v1",
      workflowLabel: "Front desk",
      workspaceId: "workspace-frontdesk",
      consentGranted: true,
      budgetRemainingUsd: 12,
      estimatedCostUsd: 0.8,
      localHour: 11,
      callingWindow: {
        startHour: 8,
        endHour: 19,
      },
    });

    const session = createTelephonyExecutionSession({
      tenantId: "tenant-west-africa",
      dispatchId: "dispatch-1",
      connection: sipConnection,
      direction: "outbound",
      disposition: queued.disposition,
      toPhoneNumber: "+14155550999",
      fromPhoneNumber: "+233302001100",
      callSessionId: queued.callSessionId!,
      workflowLabel: queued.workflowLabel,
      workspaceId: queued.workspaceId,
      testCall: false,
      now: "2026-05-15T10:02:00.000Z",
    });

    expect(session.status).toBe("ringing");
    expect(session.diagnostics.join(" ")).toContain("SIP INVITE");

    const advanced = applyTelephonyCallControlEventToSession({
      session,
      event: createTelephonyCallControlEvent({
        tenantId: "tenant-west-africa",
        dispatchId: "dispatch-1",
        callSessionId: queued.callSessionId!,
        eventType: "transfer.failed",
        transferTarget: "+14155550888",
        fallbackTarget: "Billing voicemail",
      }),
    });

    expect(advanced.status).toBe("failover-active");
    expect(advanced.outageMode).toBe("provider-fallback");
    expect(advanced.fallbackTarget).toBe("Billing voicemail");
  });

  it("creates scheduled provider heartbeats with provider-specific diagnostics", () => {
    const platformConnection = createTelephonyConnection({
      id: "connection-platform",
      tenantId: "tenant-west-africa",
      label: "Zara Edge West",
      ownershipMode: "platform_managed",
      provider: "twilio",
      region: "eu-west-1",
      createdBy: "user-ops-lead",
      recordingPolicy: defaultRecordingPolicy(),
      blockRoutingOnHealthFailure: true,
    });

    const heartbeat = createTelephonyProviderHeartbeat({
      tenantId: "tenant-west-africa",
      connection: platformConnection,
      status: "healthy",
      blocking: false,
      scheduled: true,
      latencyMs: 84,
      at: "2026-05-15T10:04:00.000Z",
      routedNumberCount: 3,
    });

    expect(heartbeat.scheduled).toBe(true);
    expect(heartbeat.latencyMs).toBe(84);
    expect(heartbeat.diagnostics.join(" ")).toContain("platform edge");
  });
});
