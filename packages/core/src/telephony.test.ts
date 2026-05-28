import { describe, expect, it } from "vitest";

import {
  applyTelephonyCallControlEventToSession,
  applyTelephonyActiveCallPolicy,
  createTelephonyCallControlCommands,
  createTelephonyExecutionSession,
  createTelephonyExecutionCommands,
  createTelephonyProviderHeartbeat,
  createTelephonyCallControlEvent,
  activateTelephonyLiveRoute,
  assignTelephonyNumberRoute,
  pauseTelephonyLiveRoute,
  resumeTelephonyLiveRoute,
  createPstnTestRoute,
  recordPstnPhoneTestCheckpoint,
  completePstnPhoneTest,
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

  it("imports only voice-capable Twilio numbers and keeps assigned workflow routes pending activation", () => {
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

    expect(dispatch.disposition).toBe("blocked");
    expect(dispatch.reason).toContain("not active");
    expect(dispatch.publishedVersionId).toBe("workflow-support-v1");
    expect(dispatch.workspaceId).toBe("workspace-support");
    expect(dispatch.recording.enabled).toBe(true);
    expect(dispatch.recording.consentMode).toBe("single-party");
  });

  it("keeps protected PSTN test routes separate from the live route", () => {
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
    const [importedNumber] = importTwilioPhoneNumbers({
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
      ],
    });

    const liveRoutedNumbers = assignTelephonyNumberRoute({
      phoneNumbers: [importedNumber!],
      numberId: importedNumber!.id,
      publishedVersionId: "workflow-live-v1",
      workflowLabel: "Live reception",
      workspaceId: "workspace-live",
      runtimeProfile: "balanced",
    });

    const testRoutedNumbers = createPstnTestRoute({
      phoneNumbers: liveRoutedNumbers,
      numberId: importedNumber!.id,
      publishedVersionId: "workflow-test-v2",
      workflowLabel: "Draft-approved phone test",
      workspaceId: "workspace-test",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      expiresAt: "2026-05-14T16:30:00.000Z",
      now: "2026-05-14T16:00:00.000Z",
    });

    const testNumber = testRoutedNumbers[0]!;
    expect(testNumber.liveRoute).toMatchObject({
      mode: "live_route",
      publishedVersionId: "workflow-live-v1",
      runtimeProfile: "balanced",
      activationStatus: "pending_activation",
    });
    expect(testNumber.testRoute).toMatchObject({
      mode: "test_route",
      publishedVersionId: "workflow-test-v2",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      waitingSession: {
        status: "waiting",
        expiresAt: "2026-05-14T16:30:00.000Z",
      },
    });

    const testDispatch = resolveInboundCall({
      toPhoneNumber: "+1 (415) 555-0100",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-test",
      phoneNumbers: testRoutedNumbers,
      connections: [connection],
      now: "2026-05-14T16:05:00.000Z",
    });

    expect(testDispatch.disposition).toBe("routed");
    expect(testDispatch.routeMode).toBe("test_route");
    expect(testDispatch.publishedVersionId).toBe("workflow-test-v2");
    expect(testDispatch.workspaceId).toBe("workspace-test");
    expect(testDispatch.testRouteSessionId).toBe(testNumber.testRoute?.waitingSession.id);

    const liveDispatch = resolveInboundCall({
      toPhoneNumber: "+1 (415) 555-0100",
      fromPhoneNumber: "+233201110009",
      callSid: "CA-live",
      phoneNumbers: testRoutedNumbers,
      connections: [connection],
      now: "2026-05-14T16:05:00.000Z",
    });

    expect(liveDispatch.disposition).toBe("blocked");
    expect(liveDispatch.routeMode).toBe("live_route");
    expect(liveDispatch.publishedVersionId).toBe("workflow-live-v1");
    expect(liveDispatch.workspaceId).toBe("workspace-live");
  });

  it("rejects unsafe PSTN test route setup", () => {
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
    const [importedNumber] = importTwilioPhoneNumbers({
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
      ],
    });

    expect(() =>
      createPstnTestRoute({
        phoneNumbers: [importedNumber!],
        numberId: importedNumber!.id,
        publishedVersionId: "workflow-test-v1",
        workflowLabel: "Phone test",
        workspaceId: "workspace-support",
        runtimeProfile: "cost-optimized",
        allowedCallerNumbers: [],
        expiresAt: "2026-05-14T16:30:00.000Z",
        now: "2026-05-14T16:00:00.000Z",
      }),
    ).toThrow("allowed caller");

    expect(() =>
      createPstnTestRoute({
        phoneNumbers: [importedNumber!],
        numberId: importedNumber!.id,
        publishedVersionId: "workflow-test-v1",
        workflowLabel: "Phone test",
        workspaceId: "workspace-support",
        runtimeProfile: "cost-optimized",
        allowedCallerNumbers: ["+233201110001"],
        expiresAt: "2026-05-14T15:59:59.000Z",
        now: "2026-05-14T16:00:00.000Z",
      }),
    ).toThrow("future");

    const waitingNumbers = createPstnTestRoute({
      phoneNumbers: [importedNumber!],
      numberId: importedNumber!.id,
      publishedVersionId: "workflow-test-v1",
      workflowLabel: "Phone test",
      workspaceId: "workspace-support",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      expiresAt: "2026-05-14T16:30:00.000Z",
      now: "2026-05-14T16:00:00.000Z",
    });

    expect(() =>
      createPstnTestRoute({
        phoneNumbers: waitingNumbers,
        numberId: importedNumber!.id,
        publishedVersionId: "workflow-test-v2",
        workflowLabel: "Second phone test",
        workspaceId: "workspace-support",
        runtimeProfile: "balanced",
        allowedCallerNumbers: ["+233201110002"],
        expiresAt: "2026-05-14T16:45:00.000Z",
        now: "2026-05-14T16:05:00.000Z",
      }),
    ).toThrow("one active waiting");
  });

  it("stores a successful PSTN phone test result only after every required checkpoint passes", () => {
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
    const [importedNumber] = importTwilioPhoneNumbers({
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
      ],
    });
    const waitingNumbers = createPstnTestRoute({
      phoneNumbers: [importedNumber!],
      numberId: importedNumber!.id,
      publishedVersionId: "workflow-test-v1",
      workflowLabel: "Phone test",
      workspaceId: "workspace-support",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      expiresAt: "2026-05-14T16:30:00.000Z",
      now: "2026-05-14T16:00:00.000Z",
    });
    const sessionId = waitingNumbers[0]!.testRoute!.waitingSession.id;

    const partialNumbers = recordPstnPhoneTestCheckpoint({
      phoneNumbers: waitingNumbers,
      numberId: importedNumber!.id,
      sessionId,
      checkpoint: "verifiedWebhook",
      at: "2026-05-14T16:01:00.000Z",
    });

    expect(partialNumbers[0]!.phoneTestResults ?? []).toEqual([]);
    expect(partialNumbers[0]!.testRoute?.waitingSession.checklist.verifiedWebhook).toBe(true);

    const completedNumbers = [
      "allowedCallerMatched",
      "mediaWebSocketConnected",
      "inboundFrameReceived",
      "transcriptCreated",
      "agentResponseGenerated",
      "outboundAudioSent",
      "cleanEnd",
      "noFatalError",
    ].reduce(
      (phoneNumbers, checkpoint) =>
        recordPstnPhoneTestCheckpoint({
          phoneNumbers,
          numberId: importedNumber!.id,
          sessionId,
          checkpoint: checkpoint as Parameters<typeof recordPstnPhoneTestCheckpoint>[0]["checkpoint"],
          at: "2026-05-14T16:03:00.000Z",
        }),
      partialNumbers,
    );

    expect(completedNumbers[0]!.testRoute?.waitingSession.status).toBe("completed");
    expect(completedNumbers[0]!.phoneTestResults?.[0]).toMatchObject({
      status: "passed",
      numberId: importedNumber!.id,
      sessionId,
      publishedVersionId: "workflow-test-v1",
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
    expect(JSON.stringify(completedNumbers[0]!.phoneTestResults)).not.toContain("twilio-auth-token");
    expect(JSON.stringify(completedNumbers[0]!.phoneTestResults)).not.toContain("payload");
  });

  it("activates a live PSTN route only from a recent successful phone test", () => {
    const connection = {
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
      healthStatus: "healthy" as const,
    };
    const [importedNumber] = importTwilioPhoneNumbers({
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
      ],
    });

    const assignedNumbers = assignTelephonyNumberRoute({
      phoneNumbers: [importedNumber!],
      numberId: importedNumber!.id,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-support",
      runtimeProfile: "cost-optimized",
      now: "2026-05-14T16:00:00.000Z",
    });

    const unactivatedDispatch = resolveInboundCall({
      toPhoneNumber: "+14155550100",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-before-activation",
      phoneNumbers: assignedNumbers,
      connections: [connection],
      now: "2026-05-14T16:01:00.000Z",
    });
    expect(unactivatedDispatch.disposition).toBe("blocked");
    expect(unactivatedDispatch.reason).toContain("not active");

    const waitingNumbers = createPstnTestRoute({
      phoneNumbers: assignedNumbers,
      numberId: importedNumber!.id,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-support",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      expiresAt: "2026-05-14T16:30:00.000Z",
      now: "2026-05-14T16:05:00.000Z",
    });
    const sessionId = waitingNumbers[0]!.testRoute!.waitingSession.id;
    const completedNumbers = [
      "verifiedWebhook",
      "allowedCallerMatched",
      "mediaWebSocketConnected",
      "inboundFrameReceived",
      "transcriptCreated",
      "agentResponseGenerated",
      "outboundAudioSent",
      "cleanEnd",
      "noFatalError",
    ].reduce(
      (phoneNumbers, checkpoint) =>
        recordPstnPhoneTestCheckpoint({
          phoneNumbers,
          numberId: importedNumber!.id,
          sessionId,
          checkpoint: checkpoint as Parameters<typeof recordPstnPhoneTestCheckpoint>[0]["checkpoint"],
          at: "2026-05-14T16:12:00.000Z",
        }),
      waitingNumbers,
    );

    const activation = activateTelephonyLiveRoute({
      phoneNumbers: completedNumbers,
      numberId: importedNumber!.id,
      connection,
      actorUserId: "user-ops-lead",
      now: "2026-05-14T16:15:00.000Z",
      policy: {
        subscriptionStatus: "active",
        tenantStatus: "active",
        budgetAction: "allow",
      },
    });

    expect(activation.activation.summary).toMatchObject({
      number: "+14155550100",
      workflowName: "Support triage",
      publishedVersionId: "workflow-support-v1",
      runtimeProfile: "cost-optimized",
      subscriptionPosture: {
        status: "active",
      },
      budgetPosture: {
        action: "allow",
      },
    });
    expect(activation.phoneNumbers[0]!.liveRoute).toMatchObject({
      activationStatus: "active",
      activatedAt: "2026-05-14T16:15:00.000Z",
      activatedBy: "user-ops-lead",
      activationTestResultId: `${sessionId}:passed`,
    });

    const liveDispatch = resolveInboundCall({
      toPhoneNumber: "+14155550100",
      fromPhoneNumber: "+233201110002",
      callSid: "CA-after-activation",
      phoneNumbers: activation.phoneNumbers,
      connections: [connection],
      now: "2026-05-14T16:16:00.000Z",
    });
    expect(liveDispatch).toMatchObject({
      disposition: "routed",
      routeMode: "live_route",
      publishedVersionId: "workflow-support-v1",
      workspaceId: "workspace-support",
    });
  });

  it("pauses and resumes live PSTN routes without losing route setup", () => {
    const { connection, phoneNumbers } = createActivatedSupportRoute();
    const pausedNumbers = pauseTelephonyLiveRoute({
      phoneNumbers,
      numberId: phoneNumbers[0]!.id,
      pausedAt: "2026-05-14T16:20:00.000Z",
    });

    expect(pausedNumbers[0]!.liveRoute).toMatchObject({
      publishedVersionId: "workflow-support-v1",
      activationStatus: "paused",
      pausedAt: "2026-05-14T16:20:00.000Z",
    });
    const pausedDispatch = resolveInboundCall({
      toPhoneNumber: "+14155550100",
      fromPhoneNumber: "+233201110002",
      callSid: "CA-paused-route",
      phoneNumbers: pausedNumbers,
      connections: [connection],
      now: "2026-05-14T16:21:00.000Z",
    });
    expect(pausedDispatch.disposition).toBe("blocked");
    expect(pausedDispatch.reason).toContain("paused");

    const resumed = resumeTelephonyLiveRoute({
      phoneNumbers: pausedNumbers,
      numberId: phoneNumbers[0]!.id,
      connection,
      actorUserId: "user-ops-lead",
      now: "2026-05-14T16:22:00.000Z",
      policy: {
        subscriptionStatus: "active",
        tenantStatus: "active",
        budgetAction: "allow",
      },
    });

    expect(resumed.phoneNumbers[0]!.liveRoute).toMatchObject({
      publishedVersionId: "workflow-support-v1",
      activationStatus: "active",
      activatedAt: "2026-05-14T16:22:00.000Z",
    });
  });

  it("stores safe failed PSTN phone test results without raw provider data", () => {
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
    const [importedNumber] = importTwilioPhoneNumbers({
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
      ],
    });
    const waitingNumbers = createPstnTestRoute({
      phoneNumbers: [importedNumber!],
      numberId: importedNumber!.id,
      publishedVersionId: "workflow-test-v1",
      workflowLabel: "Phone test",
      workspaceId: "workspace-support",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      expiresAt: "2026-05-14T16:30:00.000Z",
      now: "2026-05-14T16:00:00.000Z",
    });
    const sessionId = waitingNumbers[0]!.testRoute!.waitingSession.id;

    const failedNumbers = completePstnPhoneTest({
      phoneNumbers: waitingNumbers,
      numberId: importedNumber!.id,
      sessionId,
      status: "failed",
      reason: "Media stream closed before transcript creation. raw payload abc123 should not be stored.",
      at: "2026-05-14T16:02:00.000Z",
    });

    expect(failedNumbers[0]!.testRoute?.waitingSession.status).toBe("failed");
    expect(failedNumbers[0]!.phoneTestResults?.[0]).toMatchObject({
      status: "failed",
      reason: "Media stream closed before transcript creation.",
      numberId: importedNumber!.id,
      sessionId,
      publishedVersionId: "workflow-test-v1",
      runtimeProfile: "cost-optimized",
    });
    expect(JSON.stringify(failedNumbers[0]!.phoneTestResults)).not.toContain("raw payload");
    expect(JSON.stringify(failedNumbers[0]!.phoneTestResults)).not.toContain("abc123");
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

  it("applies mid-call subscription grace, budget closeout, and suspension termination policy", () => {
    const connection = createTelephonyConnection({
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
    const session = createTelephonyExecutionSession({
      tenantId: "tenant-west-africa",
      dispatchId: "dispatch-live-1",
      connection,
      direction: "inbound",
      disposition: "routed",
      toPhoneNumber: "+14155550110",
      fromPhoneNumber: "+233201110001",
      callSessionId: "CA-live-policy-1:telephony",
      workflowLabel: "VIP reception",
      workspaceId: "workspace-vip",
      testCall: false,
      now: "2026-05-15T10:00:00.000Z",
    });

    const graceSession = applyTelephonyActiveCallPolicy({
      session,
      now: "2026-05-15T10:05:00.000Z",
      graceUntil: "2026-05-15T10:35:00.000Z",
      policy: {
        subscriptionStatus: "past_due",
        tenantStatus: "active",
        budgetAction: "allow",
      },
    });
    expect(graceSession).toMatchObject({
      status: "grace-active",
      policyState: {
        state: "subscription_grace",
        graceUntil: "2026-05-15T10:35:00.000Z",
      },
    });

    const closeoutSession = applyTelephonyActiveCallPolicy({
      session: graceSession,
      now: "2026-05-15T10:06:00.000Z",
      policy: {
        subscriptionStatus: "active",
        tenantStatus: "active",
        budgetAction: "block",
      },
    });
    expect(closeoutSession).toMatchObject({
      status: "closeout-pending",
      policyState: {
        state: "budget_closeout_after_turn",
      },
    });

    const terminatedSession = applyTelephonyActiveCallPolicy({
      session: closeoutSession,
      now: "2026-05-15T10:07:00.000Z",
      policy: {
        subscriptionStatus: "active",
        tenantStatus: "suspended",
        budgetAction: "allow",
      },
    });
    expect(terminatedSession).toMatchObject({
      status: "terminated",
      policyState: {
        state: "terminated_for_suspension",
      },
    });
  });

  it("projects provider-native bridge commands for execution sessions and failover control", () => {
    const twilioConnection = createTelephonyConnection({
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
      webhookBaseUrl: "https://api.zara.ai/telephony/webhooks/twilio",
    });

    const twilioSession = createTelephonyExecutionSession({
      tenantId: "tenant-west-africa",
      dispatchId: "dispatch-outbound-1",
      connection: twilioConnection,
      direction: "outbound",
      disposition: "queued",
      toPhoneNumber: "+14155550999",
      fromPhoneNumber: "+14155550110",
      callSessionId: "CA-outbound-bridge-1:telephony",
      workflowLabel: "Billing specialist",
      workspaceId: "workspace-billing",
      testCall: false,
      now: "2026-05-15T10:05:00.000Z",
    });

    const twilioCommands = createTelephonyExecutionCommands({
      session: twilioSession,
      connection: twilioConnection,
      now: "2026-05-15T10:05:00.000Z",
    });

    expect(twilioSession.bridgeKind).toBe("twilio-programmable-voice");
    expect(twilioSession.mediaPath).toBe("provider-native");
    expect(twilioCommands[0]).toMatchObject({
      action: "twilio.calls.create",
      target: "+14155550999",
      status: "applied",
    });

    const failoverCommands = createTelephonyCallControlCommands({
      session: twilioSession,
      event: createTelephonyCallControlEvent({
        tenantId: "tenant-west-africa",
        dispatchId: "dispatch-outbound-1",
        callSessionId: "CA-outbound-bridge-1:telephony",
        eventType: "transfer.failed",
        transferTarget: "+14155550888",
        fallbackTarget: "Billing voicemail",
      }),
    });

    expect(failoverCommands[0]).toMatchObject({
      action: "twilio.calls.redirect.fallback",
      target: "Billing voicemail",
      status: "applied",
    });

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

    const sipSession = createTelephonyExecutionSession({
      tenantId: "tenant-west-africa",
      dispatchId: "dispatch-outbound-2",
      connection: sipConnection,
      direction: "outbound",
      disposition: "queued",
      toPhoneNumber: "+233201110001",
      fromPhoneNumber: "+233302001100",
      callSessionId: "CA-outbound-bridge-2:telephony",
      workflowLabel: "Front desk",
      workspaceId: "workspace-frontdesk",
      testCall: false,
      now: "2026-05-15T10:07:00.000Z",
    });

    const sipCommands = createTelephonyExecutionCommands({
      session: sipSession,
      connection: sipConnection,
      now: "2026-05-15T10:07:00.000Z",
    });

    expect(sipSession.bridgeKind).toBe("sip-trunk");
    expect(sipSession.mediaPath).toBe("provider-native");
    expect(sipCommands[0]).toMatchObject({
      action: "sip.invite.create",
      target: "sip.acme.example",
      status: "applied",
    });
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

function createActivatedSupportRoute() {
  const connection = {
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
    healthStatus: "healthy" as const,
  };
  const [importedNumber] = importTwilioPhoneNumbers({
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
    ],
  });
  const assignedNumbers = assignTelephonyNumberRoute({
    phoneNumbers: [importedNumber!],
    numberId: importedNumber!.id,
    publishedVersionId: "workflow-support-v1",
    workflowLabel: "Support triage",
    workspaceId: "workspace-support",
    runtimeProfile: "cost-optimized",
    now: "2026-05-14T16:00:00.000Z",
  });
  const waitingNumbers = createPstnTestRoute({
    phoneNumbers: assignedNumbers,
    numberId: importedNumber!.id,
    publishedVersionId: "workflow-support-v1",
    workflowLabel: "Support triage",
    workspaceId: "workspace-support",
    runtimeProfile: "cost-optimized",
    allowedCallerNumbers: ["+233201110001"],
    expiresAt: "2026-05-14T16:30:00.000Z",
    now: "2026-05-14T16:05:00.000Z",
  });
  const sessionId = waitingNumbers[0]!.testRoute!.waitingSession.id;
  const completedNumbers = [
    "verifiedWebhook",
    "allowedCallerMatched",
    "mediaWebSocketConnected",
    "inboundFrameReceived",
    "transcriptCreated",
    "agentResponseGenerated",
    "outboundAudioSent",
    "cleanEnd",
    "noFatalError",
  ].reduce(
    (phoneNumbers, checkpoint) =>
      recordPstnPhoneTestCheckpoint({
        phoneNumbers,
        numberId: importedNumber!.id,
        sessionId,
        checkpoint: checkpoint as Parameters<typeof recordPstnPhoneTestCheckpoint>[0]["checkpoint"],
        at: "2026-05-14T16:12:00.000Z",
      }),
    waitingNumbers,
  );
  const activation = activateTelephonyLiveRoute({
    phoneNumbers: completedNumbers,
    numberId: importedNumber!.id,
    connection,
    actorUserId: "user-ops-lead",
    now: "2026-05-14T16:15:00.000Z",
    policy: {
      subscriptionStatus: "active",
      tenantStatus: "active",
      budgetAction: "allow",
    },
  });

  return {
    connection,
    phoneNumbers: activation.phoneNumbers,
  };
}
