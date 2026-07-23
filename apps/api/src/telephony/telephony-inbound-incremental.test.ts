import { computeTwilioWebhookSignature } from "@zara/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});

async function createReadyHarness(
  input: { activateRoute?: boolean; testRoute?: boolean } = {},
) {
  const stateRepository = new MemoryTelephonyStateRepository();
  const incrementalRepository = new InMemoryTelephonyIncrementalRepository();
  const service = createService(stateRepository, incrementalRepository);
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
  return { service, stateRepository, incrementalRepository };
}

function createService(
  stateRepository: TelephonyStateRepository,
  incrementalRepository: TelephonyIncrementalRepository,
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
    undefined,
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
