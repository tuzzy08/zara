import { computeTwilioWebhookSignature } from "@zara/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditLogService } from "../compliance/audit-log.service";
import type {
  TelephonyIncrementalRepository,
} from "./telephony-incremental.repository";
import { InMemoryTelephonyIncrementalRepository } from "./telephony-incremental.repository.test-helper";
import type { PersistedTelephonyStateRecord, TelephonyStateRepository } from "./telephony-state.repository";
import { TelephonySecretVault } from "./telephony-secret-vault";
import { TelephonyService } from "./telephony.service";
import type { TwilioNumberInventoryProvider } from "./twilio-number-inventory.provider";
import type { TwilioNumberRoutingProvider } from "./twilio-number-routing.provider";

const organizationId = "tenant-incremental";
const accountSid = "AC1234567890abcdef1234567890abcd";
const authToken = "twilio-auth-token-1234567890";
const webhookUrl = "http://127.0.0.1/telephony/webhooks/twilio";

describe("TelephonyService incremental inbound persistence", () => {
  beforeEach(() => {
    vi.stubEnv("ZARA_TWILIO_WEBHOOK_URL", webhookUrl);
    vi.stubEnv("ZARA_STREAM_TOKEN_SECRET", "12345678901234567890123456789012");
  });

  it("durably records and atomically establishes an incoming call without a snapshot save", async () => {
    const harness = await createReadyHarness();
    harness.stateRepository.resetSaveCount();

    const response = await answer(harness.service, "CA-incremental-1", "EV-incremental-1");

    expect(response.twiml).toContain("<Connect>");
    expect(harness.stateRepository.saveCount).toBe(0);
    expect(harness.incrementalRepository.webhookEvents).toHaveLength(1);
    expect(harness.incrementalRepository.callSetups).toHaveLength(1);
    expect(harness.incrementalRepository.callSetups[0]).toMatchObject({
      dispatch: {
        tenantId: organizationId,
        callSessionId: "CA-incremental-1:telephony",
        source: "webhook",
      },
      executionSession: {
        callSessionId: "CA-incremental-1:telephony",
        status: "ringing",
      },
      mediaToken: {
        tenantId: organizationId,
        callSessionId: "CA-incremental-1:telephony",
      },
    });
    expect(harness.incrementalRepository.callSetups[0]!.mediaToken.tokenHash).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(JSON.stringify(harness.incrementalRepository.callSetups[0])).not.toContain(
      extractStreamToken(response.twiml),
    );
  });

  it("creates manual and loopback calls through row-owned persistence", async () => {
    const harness = await createReadyHarness();
    harness.stateRepository.resetSaveCount();

    const manual = await harness.service.dispatchInboundCall({
      organizationId,
      toPhoneNumber: "+14155557890",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-incremental-manual",
      source: "manual",
    });
    const loopback = await harness.service.runConnectionTestCall({
      organizationId,
      connectionId: manual.dispatch.connectionId!,
      phoneNumberId: manual.dispatch.phoneNumberId!,
      fromPhoneNumber: "+233201110001",
      callSid: "CA-incremental-loopback",
    });

    expect(harness.stateRepository.saveCount).toBe(0);
    const repository = harness.incrementalRepository as unknown as TelephonyIncrementalRepository & {
      loadCallMutationContext(input: {
        tenantId: string;
        callSessionId: string;
      }): Promise<{ outcome: string }>;
    };
    await expect(repository.loadCallMutationContext({
      tenantId: organizationId,
      callSessionId: manual.dispatch.callSessionId!,
    })).resolves.toMatchObject({ outcome: "found" });
    await expect(repository.loadCallMutationContext({
      tenantId: organizationId,
      callSessionId: loopback.dispatch.callSessionId!,
    })).resolves.toMatchObject({ outcome: "found" });
  });

  it("records call controls, runtime policy, and human fallback without a snapshot save", async () => {
    const harness = await createReadyHarness();
    const first = await harness.service.dispatchInboundCall({
      organizationId,
      toPhoneNumber: "+14155557890",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-incremental-controls",
      source: "manual",
    });
    harness.stateRepository.resetSaveCount();

    await harness.service.recordCallControlEvent({
      organizationId,
      callSessionId: first.dispatch.callSessionId!,
      dispatchId: first.dispatch.id,
      eventType: "dtmf.received",
      digit: "4",
      at: "2026-07-23T10:05:00.000Z",
    });
    await harness.service.applyCallRuntimePolicy({
      organizationId,
      callSessionId: first.dispatch.callSessionId!,
      subscriptionStatus: "past_due",
      tenantStatus: "active",
      budgetAction: "allow",
      now: "2026-07-23T10:06:00.000Z",
      graceUntil: "2026-07-23T10:36:00.000Z",
    });

    const second = await harness.service.dispatchInboundCall({
      organizationId,
      toPhoneNumber: "+14155557890",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-incremental-fallback",
      source: "manual",
    });
    harness.stateRepository.resetSaveCount();
    await harness.service.resolveHumanFallback({
      organizationId,
      callSessionId: second.dispatch.callSessionId!,
      dispatchId: second.dispatch.id,
      actorUserId: "operator-1",
      transferTarget: "+14155550888",
      callbackNumber: "+233201110001",
      now: "2026-07-23T10:07:00.000Z",
    });

    expect(harness.stateRepository.saveCount).toBe(0);
  });

  it("deletes retained call rows through the incremental repository", async () => {
    const harness = await createReadyHarness();
    const response = await harness.service.dispatchInboundCall({
      organizationId,
      toPhoneNumber: "+14155557890",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-incremental-retention",
      source: "manual",
      now: "2026-07-20T10:00:00.000Z",
    });

    await harness.service.deleteRetainedCallData({
      organizationId,
      retainAfter: "2026-07-21T10:00:00.000Z",
    });

    await expect(
      harness.incrementalRepository.loadCallMutationContext({
        tenantId: organizationId,
        callSessionId: response.dispatch.callSessionId!,
      }),
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("deletes an intentionally removed phone number through row-owned persistence", async () => {
    const harness = await createReadyHarness();
    const phoneNumber = (await harness.service.getState(organizationId)).phoneNumbers[0]!;

    await harness.service.deletePhoneNumber({
      organizationId,
      numberId: phoneNumber.id,
      actorUserId: "operator-1",
    });

    const repository = harness.incrementalRepository as unknown as {
      updatePhoneTestProjection(input: {
        tenantId: string;
        phoneNumberId: string;
        expectedTestRoute: null;
        expectedPhoneTestResults: null;
        testRoute: null;
        phoneTestResults: null;
      }): Promise<{ outcome: string }>;
    };
    await expect(
      repository.updatePhoneTestProjection({
        tenantId: organizationId,
        phoneNumberId: phoneNumber.id,
        expectedTestRoute: null,
        expectedPhoneTestResults: null,
        testRoute: null,
        phoneTestResults: null,
      }),
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("does not audit an outbound override before its atomic call write succeeds", async () => {
    const record = vi.fn();
    const harness = await createReadyHarness({
      auditLogService: { record } as unknown as AuditLogService,
    });
    record.mockClear();
    vi.spyOn(harness.incrementalRepository, "createCallExecution").mockResolvedValueOnce({
      outcome: "conflict",
    });

    await expect(
      harness.service.dispatchOutboundCall({
        organizationId,
        actorUserId: "operator-1",
        fromPhoneNumber: "+14155557890",
        toPhoneNumber: "+14155550996",
        callSid: "CA-outbound-audit-conflict",
        publishedVersionId: "workflow-v1",
        workflowLabel: "Support",
        workspaceId: "workspace-1",
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
          localTime: "2026-07-23T23:00:00-04:00",
          override: {
            reason: "Caller requested an emergency callback.",
            approvedByUserId: "platform-admin-1",
          },
        },
      }),
    ).rejects.toThrow("Outbound call execution conflicts with an existing call.");

    expect(record).not.toHaveBeenCalled();
  });

  it("re-establishes duplicate delivery after restart without duplicating owned rows", async () => {
    const harness = await createReadyHarness();
    harness.stateRepository.resetSaveCount();
    const first = await answer(harness.service, "CA-incremental-retry", "EV-incremental-retry");
    const restarted = createService(harness.stateRepository, harness.incrementalRepository);

    const retry = await answer(restarted, "CA-incremental-retry", "EV-incremental-retry");

    expect(first.twiml).toContain("<Connect>");
    expect(retry.twiml).toContain("<Connect>");
    expect(retry.duplicate).toBe(true);
    expect(extractStreamToken(retry.twiml)).toBe(extractStreamToken(first.twiml));
    expect(harness.stateRepository.saveCount).toBe(0);
    expect(harness.incrementalRepository.webhookEvents).toHaveLength(1);
    expect(harness.incrementalRepository.callSetups).toHaveLength(1);
  });

  it("returns one stable unclaimed credential to concurrent duplicate deliveries", async () => {
    const harness = await createReadyHarness();
    harness.stateRepository.resetSaveCount();

    const [first, duplicate] = await Promise.all([
      answer(harness.service, "CA-incremental-concurrent", "EV-incremental-concurrent"),
      answer(harness.service, "CA-incremental-concurrent", "EV-incremental-concurrent"),
    ]);

    expect(first.twiml).toContain("<Connect>");
    expect(duplicate.twiml).toContain("<Connect>");
    expect(extractStreamToken(first.twiml)).toBe(extractStreamToken(duplicate.twiml));
    expect(harness.incrementalRepository.webhookEvents).toHaveLength(1);
    expect(harness.incrementalRepository.callSetups).toHaveLength(1);
  });

  it("does not reconnect a duplicate delivery after its durable media credential expires", async () => {
    const harness = await createReadyHarness();
    await answer(harness.service, "CA-incremental-expired", "EV-incremental-expired");
    harness.incrementalRepository.webhookEvents[0]!.receivedAt = new Date(
      Date.now() - 6 * 60 * 1000,
    ).toISOString();
    const restarted = createService(harness.stateRepository, harness.incrementalRepository);

    const retry = await answer(restarted, "CA-incremental-expired", "EV-incremental-expired");

    expect(retry.twiml).not.toContain("<Connect>");
    expect("reasonCode" in retry ? retry.reasonCode : undefined).toBe("media_token_expired");
  });

  it("persists a blocked dispatch incrementally without creating a session or token", async () => {
    const harness = await createReadyHarness({ activateRoute: false });
    harness.stateRepository.resetSaveCount();

    const response = await answer(harness.service, "CA-incremental-blocked", "EV-incremental-blocked");

    expect(response.twiml).not.toContain("<Connect>");
    expect(response.twiml).toContain("temporarily unavailable");
    expect(harness.stateRepository.saveCount).toBe(0);
    expect(harness.incrementalRepository.dispatches).toHaveLength(1);
    expect(harness.incrementalRepository.dispatches[0]).toMatchObject({
      disposition: "blocked",
    });
    expect(harness.incrementalRepository.dispatches[0]).not.toHaveProperty("callSessionId");
    expect(harness.incrementalRepository.callSetups).toEqual([]);
  });

  it("records protected phone-test admission checkpoints before returning Connect", async () => {
    const harness = await createReadyHarness({ testRoute: true });
    harness.stateRepository.resetSaveCount();

    const response = await answer(
      harness.service,
      "CA-incremental-phone-test",
      "EV-incremental-phone-test",
    );

    expect(response.twiml).toContain("<Connect>");
    expect(harness.stateRepository.saveCount).toBe(0);
    expect(harness.incrementalRepository.phoneTestCheckpoints).toEqual([
      expect.objectContaining({
        tenantId: organizationId,
        callSessionId: "CA-incremental-phone-test:telephony",
        checkpoint: "allowedCallerMatched",
      }),
      expect.objectContaining({
        tenantId: organizationId,
        callSessionId: "CA-incremental-phone-test:telephony",
        checkpoint: "verifiedWebhook",
      }),
    ]);
  });

  it("never returns Connect when a protected phone-test checkpoint cannot be persisted", async () => {
    const harness = await createReadyHarness({ testRoute: true });
    harness.stateRepository.resetSaveCount();
    harness.incrementalRepository.failPhoneTestCheckpoint = true;

    const response = await answer(
      harness.service,
      "CA-incremental-phone-test-failure",
      "EV-incremental-phone-test-failure",
    );

    expect(response.twiml).not.toContain("<Connect>");
    expect(response.twiml).toContain("temporarily unavailable");
    expect("reasonCode" in response ? response.reasonCode : undefined).toBe(
      "phone_test_checkpoint_persistence_failed",
    );
    expect(harness.stateRepository.saveCount).toBe(0);
    const state = await harness.service.getState(organizationId);
    expect(state.dispatches).toEqual([]);
    expect(state.executionSessions).toEqual([]);
  });

  it("never returns Connect when durable call setup fails", async () => {
    const harness = await createReadyHarness();
    harness.stateRepository.resetSaveCount();
    harness.incrementalRepository.failCallSetup = true;

    const response = await answer(harness.service, "CA-incremental-failure", "EV-incremental-failure");

    expect(response.twiml).not.toContain("<Connect>");
    expect(response.twiml).toContain("temporarily unavailable");
    expect("reasonCode" in response ? response.reasonCode : undefined).toBe(
      "call_setup_persistence_failed",
    );
    expect(harness.stateRepository.saveCount).toBe(0);
    const state = await harness.service.getState(organizationId);
    expect(state.dispatches).toEqual([]);
    expect(state.executionSessions).toEqual([]);
  });

  it("authorizes and atomically claims a durable media token after process restart", async () => {
    const harness = await createReadyHarness();
    const response = await answer(
      harness.service,
      "CA-incremental-restart-auth",
      "EV-incremental-restart-auth",
    );
    const restarted = createService(harness.stateRepository, harness.incrementalRepository);
    harness.stateRepository.resetSaveCount();

    const authorization = await restarted.authorizeTwilioMediaStream({
      callSessionId: "CA-incremental-restart-auth:telephony",
      token: extractStreamToken(response.twiml),
    });

    expect(authorization).toMatchObject({
      organizationId,
      callSessionId: "CA-incremental-restart-auth:telephony",
      runtimePath: "pstn-sandwich",
    });
    expect(harness.stateRepository.saveCount).toBe(0);
    expect(harness.incrementalRepository.mediaTokenClaims).toHaveLength(1);
  });

  it("allows exactly one concurrent media-token claim", async () => {
    const harness = await createReadyHarness();
    const response = await answer(
      harness.service,
      "CA-incremental-concurrent-auth",
      "EV-incremental-concurrent-auth",
    );
    const token = extractStreamToken(response.twiml);
    const firstReplica = createService(harness.stateRepository, harness.incrementalRepository);
    const secondReplica = createService(harness.stateRepository, harness.incrementalRepository);

    const authorizations = await Promise.all([
      firstReplica.authorizeTwilioMediaStream({
        callSessionId: "CA-incremental-concurrent-auth:telephony",
        token,
      }),
      secondReplica.authorizeTwilioMediaStream({
        callSessionId: "CA-incremental-concurrent-auth:telephony",
        token,
      }),
    ]);

    expect(authorizations.filter((authorization) => authorization !== null)).toHaveLength(1);
    expect(harness.incrementalRepository.mediaTokenClaims).toHaveLength(2);
  });

  it("persists media lifecycle and phone-test checkpoints without a tenant snapshot save", async () => {
    const harness = await createReadyHarness({ testRoute: true });
    await answer(
      harness.service,
      "CA-incremental-lifecycle",
      "EV-incremental-lifecycle",
    );
    harness.stateRepository.resetSaveCount();

    await harness.service.recordTwilioMediaStreamLifecycle({
      organizationId,
      callSessionId: "CA-incremental-lifecycle:telephony",
      streamSid: "MZ-incremental-lifecycle",
      status: "active",
      at: "2026-07-23T12:00:01.000Z",
    });
    await harness.service.recordPstnPhoneTestCheckpoint({
      organizationId,
      callSessionId: "CA-incremental-lifecycle:telephony",
      checkpoint: "inboundFrameReceived",
      at: "2026-07-23T12:00:02.000Z",
    });
    await harness.service.recordTwilioMediaStreamLifecycle({
      organizationId,
      callSessionId: "CA-incremental-lifecycle:telephony",
      streamSid: "MZ-incremental-lifecycle",
      status: "completed",
      at: "2026-07-23T12:00:03.000Z",
    });

    expect(harness.stateRepository.saveCount).toBe(0);
    expect(harness.incrementalRepository.callLifecycleTransitions).toHaveLength(2);
    expect(harness.incrementalRepository.phoneTestCheckpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkpoint: "mediaWebSocketConnected" }),
        expect.objectContaining({ checkpoint: "inboundFrameReceived" }),
        expect.objectContaining({ checkpoint: "cleanEnd" }),
        expect.objectContaining({ checkpoint: "noFatalError" }),
      ]),
    );
  });

  it("does not discard a legal lifecycle transition after three CAS conflicts", async () => {
    const harness = await createReadyHarness();
    await answer(
      harness.service,
      "CA-incremental-contention",
      "EV-incremental-contention",
    );
    harness.incrementalRepository.callLifecycleConflictsRemaining = 3;

    await expect(
      harness.service.recordPstnCallLifecycle({
        organizationId,
        callSessionId: "CA-incremental-contention:telephony",
        stage: "media-connected",
        at: "2026-07-23T12:00:01.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "applied" });
    expect(
      harness.incrementalRepository.callSetups.find(
        (setup) =>
          setup.executionSession.callSessionId === "CA-incremental-contention:telephony",
      )?.executionSession.lifecycleState.stage,
    ).toBe("media-connected");
  });

  it("does not revive a completed session when an active media event arrives late", async () => {
    const harness = await createReadyHarness();
    await answer(
      harness.service,
      "CA-incremental-terminal",
      "EV-incremental-terminal",
    );
    harness.stateRepository.resetSaveCount();

    await harness.service.recordTwilioMediaStreamLifecycle({
      organizationId,
      callSessionId: "CA-incremental-terminal:telephony",
      streamSid: "MZ-incremental-terminal",
      status: "completed",
      at: "2026-07-23T12:00:03.000Z",
    });
    await harness.service.recordTwilioMediaStreamLifecycle({
      organizationId,
      callSessionId: "CA-incremental-terminal:telephony",
      streamSid: "MZ-incremental-terminal",
      status: "active",
      at: "2026-07-23T12:00:01.000Z",
    });

    expect(harness.stateRepository.saveCount).toBe(0);
    expect(
      harness.incrementalRepository.callSetups.find(
        (setup) =>
          setup.executionSession.callSessionId === "CA-incremental-terminal:telephony",
      )?.executionSession.status,
    ).toBe("completed");
  });

  it("applies duplicate and reordered Twilio status callbacks idempotently", async () => {
    const harness = await createReadyHarness();
    await answer(
      harness.service,
      "CA-incremental-status",
      "EV-incremental-status",
    );
    harness.stateRepository.resetSaveCount();

    await sendStatusCallback(harness.service, {
      CallSid: "CA-incremental-status",
      CallStatus: "completed",
      SequenceNumber: "4",
    });
    await sendStatusCallback(harness.service, {
      CallSid: "CA-incremental-status",
      CallStatus: "completed",
      SequenceNumber: "4",
    });
    await sendStatusCallback(harness.service, {
      CallSid: "CA-incremental-status",
      CallStatus: "in-progress",
      SequenceNumber: "3",
    });

    expect(harness.stateRepository.saveCount).toBe(0);
    expect(
      harness.incrementalRepository.callSetups.find(
        (setup) =>
          setup.executionSession.callSessionId === "CA-incremental-status:telephony",
      )?.executionSession.status,
    ).toBe("completed");
  });
});

async function createReadyHarness(
  input: {
    activateRoute?: boolean;
    testRoute?: boolean;
    auditLogService?: AuditLogService;
  } = {},
) {
  const stateRepository = new MemoryTelephonyStateRepository();
  const incrementalRepository = new InMemoryTelephonyIncrementalRepository();
  const service = createService(
    stateRepository,
    incrementalRepository,
    input.auditLogService,
  );
  const connection = await service.createConnection({
    organizationId,
    actorUserId: "operator-1",
    label: "Twilio",
    ownershipMode: "byo_provider_account",
    provider: "twilio",
    region: "us-east-1",
    blockRoutingOnHealthFailure: true,
    accountSid,
    authToken,
  });
  await service.importTwilioNumbers({
    organizationId,
    connectionId: connection.connection.id,
  });
  const phoneNumber = (await service.getState(organizationId)).phoneNumbers[0]!;
  await service.assignNumberRoute({
    organizationId,
    numberId: phoneNumber.id,
    publishedVersionId: "workflow-v1",
    workflowLabel: "Support",
    workspaceId: "workspace-1",
    runtimeProfile: "cost-optimized",
  });
  if (input.testRoute === true) {
    await service.createPstnTestRoute({
      organizationId,
      numberId: phoneNumber.id,
      publishedVersionId: "workflow-v1",
      workflowLabel: "Support",
      workspaceId: "workspace-1",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      now: "2026-07-23T10:00:00.000Z",
      expiresAt: "2099-07-23T10:30:00.000Z",
    });
  } else if (input.activateRoute !== false) {
    await service.activateLiveRoute({
      organizationId,
      numberId: phoneNumber.id,
      actorUserId: "operator-1",
      now: "2026-07-23T10:00:00.000Z",
      override: {
        actorUserId: "operator-1",
        approvedByUserId: "platform-admin-1",
        reason: "Incremental persistence fixture.",
      },
    });
  }
  incrementalRepository.loadPhoneNumberProjections(
    organizationId,
    (await service.getState(organizationId)).phoneNumbers,
  );
  return { service, stateRepository, incrementalRepository };
}

function createService(
  stateRepository: TelephonyStateRepository,
  incrementalRepository: TelephonyIncrementalRepository,
  auditLogService?: AuditLogService,
) {
  return new TelephonyService(
    stateRepository,
    new TelephonySecretVault({
      masterSecret: "12345678901234567890123456789012",
      keyVersion: 1,
    }),
    inventoryProvider(),
    routingProvider(),
    incrementalRepository,
    auditLogService,
    undefined,
    undefined,
  );
}

async function answer(service: TelephonyService, callSid: string, eventSid: string) {
  const payload = {
    AccountSid: accountSid,
    CallSid: callSid,
    EventSid: eventSid,
    EventType: "incoming.call",
    To: "+14155557890",
    From: "+233201110001",
  };
  return service.handleTwilioWebhook({
    signature: computeTwilioWebhookSignature({
      url: webhookUrl,
      parameters: payload,
      authToken,
    }),
    payload,
  });
}

async function sendStatusCallback(
  service: TelephonyService,
  input: {
    CallSid: string;
    CallStatus: string;
    SequenceNumber: string;
  },
) {
  const payload = {
    AccountSid: accountSid,
    Direction: "inbound",
    From: "+233201110001",
    To: "+14155557890",
    ...input,
  };
  return service.handleTwilioStatusCallback({
    signature: computeTwilioWebhookSignature({
      url: `${webhookUrl}/status`,
      parameters: payload,
      authToken,
    }),
    payload,
  });
}

function extractStreamToken(twiml: string) {
  const match = twiml.match(/<Parameter name="zaraStreamToken" value="([^"]+)" \/>/);
  if (match?.[1] === undefined) {
    throw new Error("Expected TwiML stream token.");
  }
  return match[1];
}

class MemoryTelephonyStateRepository implements TelephonyStateRepository {
  private record: PersistedTelephonyStateRecord | null = null;
  saveCount = 0;

  listOrganizationIds() {
    return this.record === null ? [] : [this.record.organizationId];
  }

  load(targetOrganizationId: string) {
    return this.record?.organizationId === targetOrganizationId
      ? structuredClone(this.record)
      : null;
  }

  save(record: PersistedTelephonyStateRecord) {
    this.saveCount += 1;
    this.record = structuredClone(record);
  }

  resetSaveCount() {
    this.saveCount = 0;
  }
}

function inventoryProvider(): TwilioNumberInventoryProvider {
  return {
    async listIncomingPhoneNumbers() {
      return [
        {
          sid: "PN78901001",
          phoneNumber: "+14155557890",
          friendlyName: "Support",
          capabilities: { voice: true, sms: true },
        },
      ];
    },
  };
}

function routingProvider(): TwilioNumberRoutingProvider {
  return {
    async configureIncomingPhoneNumberWebhook(input) {
      return {
        sid: input.phoneNumberSid,
        trunkSid: null,
        voiceApplicationSid: null,
        voiceMethod: "POST",
        voiceUrl: input.voiceUrl,
      };
    },
    async inspectIncomingPhoneNumber(input) {
      return {
        sid: input.phoneNumberSid,
        trunkSid: null,
        voiceApplicationSid: null,
        voiceMethod: "POST",
      };
    },
    async listRecentCallsForNumber() {
      return [];
    },
    async retrieveCall(input) {
      return { sid: input.callSid };
    },
    async terminateCall(input) {
      return { sid: input.callSid, status: "completed" };
    },
    async listRecentMonitorAlerts() {
      return [];
    },
  };
}
