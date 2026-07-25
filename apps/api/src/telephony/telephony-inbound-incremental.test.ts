import { computeTwilioWebhookSignature } from "@zara/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditLogService } from "../compliance/audit-log.service";
import type {
  TelephonyIncrementalRepository,
} from "./telephony-incremental.repository";
import { InMemoryPstnCallAdmission } from "./in-memory-pstn-call-admission";
import type { PstnAdmissionConfig } from "./pstn-admission-config";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
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

  it("fails a new call closed before setup when distributed admission denies it", async () => {
    const admissionCoordinator = createAdmissionCoordinator({
      reserve: vi.fn(async () => ({
        outcome: "denied" as const,
        reasonCode: "global_concurrency_limit" as const,
        limitingDimension: "global_concurrency" as const,
        remainingCapacity: 0,
      })),
    });
    const harness = await createReadyHarness({ admissionCoordinator });
    const setup = vi.spyOn(
      harness.incrementalRepository,
      "createCallSetup",
    );

    const response = await answer(
      harness.service,
      "CA-admission-denied",
      "EV-admission-denied",
    );

    expect(response).toMatchObject({
      reasonCode: "global_concurrency_limit",
    });
    expect(response.twiml).not.toContain("<Connect>");
    expect(setup).not.toHaveBeenCalled();
  });

  it("keeps provider admission available when failed health is configured as nonblocking", async () => {
    const harness = await createReadyHarness({
      blockRoutingOnHealthFailure: false,
      failedProviderHealth: true,
    });

    const response = await answer(
      harness.service,
      "CA-nonblocking-provider-health",
      "EV-nonblocking-provider-health",
    );

    expect(response).toHaveProperty("dispatch");
    expect(response.twiml).toContain("<Connect>");
  });

  it("uses fresh durable provider health for admission instead of cached service state", async () => {
    const harness = await createReadyHarness();
    const connectionId = [...harness.incrementalRepository.connectionTenants.keys()][0]!;
    harness.incrementalRepository.setConnectionAdmissionPosture(connectionId, {
      status: "active",
      healthStatus: "failed",
      blockRoutingOnHealthFailure: true,
    });
    const loadConnectionAdmissionPosture = vi.spyOn(
      harness.incrementalRepository,
      "loadConnectionAdmissionPosture",
    );

    const response = await answer(
      harness.service,
      "CA-fresh-provider-health",
      "EV-fresh-provider-health",
    );

    expect(loadConnectionAdmissionPosture).toHaveBeenCalledWith({
      tenantId: organizationId,
      connectionId,
    });
    expect(response).toMatchObject({
      dispatch: {
        disposition: "blocked",
        reason: expect.stringContaining("provider health checks are failing"),
      },
    });
    expect(response.twiml).not.toContain("<Connect>");
  });

  it("routes from fresh healthy posture when cached provider health is stale", async () => {
    const harness = await createReadyHarness({
      failedProviderHealth: true,
    });
    const connectionId =
      [...harness.incrementalRepository.connectionTenants.keys()][0]!;
    harness.incrementalRepository.setConnectionAdmissionPosture(connectionId, {
      status: "active",
      healthStatus: "healthy",
      blockRoutingOnHealthFailure: true,
    });

    const response = await answer(
      harness.service,
      "CA-fresh-healthy-provider",
      "EV-fresh-healthy-provider",
    );

    expect(response).toHaveProperty("dispatch");
    expect(response.twiml).toContain("<Connect>");
  });

  it("fails closed before reserve when the durable provider connection is missing", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const reserve = vi.spyOn(admissionCoordinator, "reserve");
    const harness = await createReadyHarness({ admissionCoordinator });
    const loadConnectionAdmissionPosture = vi.fn(async () => ({
      outcome: "not_found" as const,
    }));
    Object.assign(harness.incrementalRepository, {
      loadConnectionAdmissionPosture,
    });

    const response = await answer(
      harness.service,
      "CA-missing-durable-provider",
      "EV-missing-durable-provider",
    );

    expect(response).toMatchObject({
      reasonCode: "provider_health_posture_unavailable",
    });
    expect(response.twiml).not.toContain("<Connect>");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("fails closed before reserve when durable provider health cannot be read", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const reserve = vi.spyOn(admissionCoordinator, "reserve");
    const harness = await createReadyHarness({ admissionCoordinator });
    const loadConnectionAdmissionPosture = vi.fn().mockRejectedValue(
      new Error("provider health database unavailable"),
    );
    Object.assign(harness.incrementalRepository, {
      loadConnectionAdmissionPosture,
    });

    const response = await answer(
      harness.service,
      "CA-unavailable-durable-provider",
      "EV-unavailable-durable-provider",
    );

    expect(response).toMatchObject({
      reasonCode: "provider_health_posture_unavailable",
    });
    expect(response.twiml).not.toContain("<Connect>");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("retains a failed pre-setup admission only for the claim TTL", async () => {
    let nowMs = Date.parse("2030-01-01T00:00:00.000Z");
    const admissionCoordinator = createAdmissionCoordinator({}, () => nowMs);
    const reserve = vi.spyOn(admissionCoordinator, "reserve");
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({ admissionCoordinator });
    vi.spyOn(
      harness.incrementalRepository,
      "createCallSetup",
    ).mockRejectedValueOnce(new Error("setup failed"));

    const response = await answer(
      harness.service,
      "CA-admission-setup-failure",
      "EV-admission-setup-failure",
    );

    expect(response).toMatchObject({
      reasonCode: "call_setup_persistence_failed",
    });
    await expect(reserve.mock.results[0]!.value).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
      leaseExpiresAt: "2030-01-01T00:00:30.000Z",
    });
    expect(release).not.toHaveBeenCalled();

    nowMs += 30_001;
    const replayAfterExpiry = await answer(
      harness.service,
      "CA-admission-setup-failure",
      "EV-admission-setup-failure",
    );

    expect(replayAfterExpiry.twiml).toContain("<Connect>");
    await expect(reserve.mock.results[1]!.value).resolves.toMatchObject({
      outcome: "admitted",
      disposition: "created",
      leaseExpiresAt: "2030-01-01T00:01:00.001Z",
    });
  });

  it("reuses one admission and CPS debit when failed call setup is replayed", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const reserve = vi.spyOn(admissionCoordinator, "reserve");
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({ admissionCoordinator });
    vi.spyOn(
      harness.incrementalRepository,
      "createCallSetup",
    ).mockRejectedValueOnce(new Error("setup failed"));

    const first = await answer(
      harness.service,
      "CA-failed-setup-replay",
      "EV-failed-setup-replay",
    );
    const replay = await answer(
      createService(
        harness.stateRepository,
        harness.incrementalRepository,
        undefined,
        admissionCoordinator,
      ),
      "CA-failed-setup-replay",
      "EV-failed-setup-replay",
    );

    expect(first).toMatchObject({
      reasonCode: "call_setup_persistence_failed",
    });
    expect(replay.twiml).toContain("<Connect>");
    expect(replay.duplicate).toBe(true);
    expect(reserve).toHaveBeenCalledTimes(2);
    await expect(
      Promise.all(reserve.mock.results.map(({ value }) => value)),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: "admitted",
        disposition: "created",
      }),
      expect.objectContaining({
        outcome: "admitted",
        disposition: "existing",
      }),
    ]);
    expect(release).not.toHaveBeenCalled();
    expect(harness.incrementalRepository.callSetups).toHaveLength(1);
  });

  it("allows a retry when the first webhook event was not persisted", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const reserve = vi.spyOn(admissionCoordinator, "reserve");
    const harness = await createReadyHarness({ admissionCoordinator });
    vi.spyOn(
      harness.incrementalRepository,
      "insertWebhookEvent",
    ).mockRejectedValueOnce(new Error("webhook database unavailable"));

    const first = await answer(
      harness.service,
      "CA-webhook-persistence-retry",
      "EV-webhook-persistence-retry",
    );
    const retry = await answer(
      harness.service,
      "CA-webhook-persistence-retry",
      "EV-webhook-persistence-retry",
    );

    expect(first).toMatchObject({
      reasonCode: "webhook_event_persistence_failed",
    });
    expect(retry.twiml).toContain("<Connect>");
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it("does not release an existing active reservation when duplicate setup fails", async () => {
    const admissionCoordinator = createAdmissionCoordinator({
      reserve: vi.fn(async () => ({
        outcome: "admitted" as const,
        disposition: "existing" as const,
        leaseExpiresAt: "2030-01-01T00:02:00.000Z",
        limitingDimension: "global_concurrency" as const,
        remainingCapacity: 19,
      })),
    });
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({ admissionCoordinator });
    vi.spyOn(
      harness.incrementalRepository,
      "createCallSetup",
    ).mockRejectedValueOnce(new Error("duplicate setup failed"));

    const response = await answer(
      harness.service,
      "CA-existing-admission",
      "EV-existing-admission",
    );

    expect(response).toMatchObject({
      reasonCode: "call_setup_persistence_failed",
    });
    expect(release).not.toHaveBeenCalled();
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

  it("finalizes admission immediately when runtime policy terminates a call", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({ admissionCoordinator });
    const call = await answer(
      harness.service,
      "CA-policy-terminal",
      "EV-policy-terminal",
    );
    if (!("dispatch" in call)) {
      throw new Error("Expected the policy test call to be routed.");
    }

    await harness.service.applyCallRuntimePolicy({
      organizationId,
      callSessionId: call.dispatch.callSessionId!,
      subscriptionStatus: "active",
      tenantStatus: "suspended",
      budgetAction: "allow",
      now: "2026-07-23T10:06:00.000Z",
    });

    expect(release).toHaveBeenCalledWith(
      organizationId,
      call.dispatch.callSessionId,
    );
    await expect(
      harness.incrementalRepository.loadCallRuntimeContext({
        tenantId: organizationId,
        callSessionId: call.dispatch.callSessionId!,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      context: {
        lifecycleState: {
          stage: "failed",
        },
      },
    });
  });

  it("keeps admission active when a stale terminal lifecycle event is ignored", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({ admissionCoordinator });
    const call = await answer(
      harness.service,
      "CA-stale-terminal",
      "EV-stale-terminal",
    );
    if (!("dispatch" in call)) {
      throw new Error("Expected the stale lifecycle test call to be routed.");
    }

    await sendStatusCallback(harness.service, {
      CallSid: "CA-stale-terminal",
      CallStatus: "in-progress",
      SequenceNumber: "4",
    });
    release.mockClear();

    await sendStatusCallback(harness.service, {
      CallSid: "CA-stale-terminal",
      CallStatus: "failed",
      SequenceNumber: "3",
    });

    expect(release).not.toHaveBeenCalled();
    await expect(harness.incrementalRepository.loadCallRuntimeContext({
      tenantId: organizationId,
      callSessionId: call.dispatch.callSessionId!,
    })).resolves.toMatchObject({
      outcome: "found",
      context: {
        lifecycleState: {
          stage: "active",
          providerSequence: 4,
        },
      },
    });
  });

  it("finalizes admission when an active phone test is ended manually", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({
      admissionCoordinator,
      testRoute: true,
    });
    const response = await answer(
      harness.service,
      "CA-phone-test-terminal",
      "EV-phone-test-terminal",
    );
    if (!("dispatch" in response)) {
      throw new Error("Expected the phone test call to be routed.");
    }
    const phoneNumber = (await harness.service.getState(organizationId))
      .phoneNumbers[0]!;

    await harness.service.completePstnTestRoute({
      organizationId,
      numberId: phoneNumber.id,
      sessionId: phoneNumber.testRoute!.waitingSession.id,
      status: "manually_ended",
      reason: "Operator ended the test.",
      at: "2026-07-23T10:06:00.000Z",
    });

    expect(release).toHaveBeenCalledWith(
      organizationId,
      response.dispatch.callSessionId,
    );
  });

  it("persists independent checkpoints for two calls in one phone-test waiting session", async () => {
    const harness = await createReadyHarness({ testRoute: true });

    const [first, second] = await Promise.all([
      answer(
        harness.service,
        "CA-phone-test-first",
        "EV-phone-test-first",
      ),
      answer(
        harness.service,
        "CA-phone-test-second",
        "EV-phone-test-second",
      ),
    ]);

    expect(first).toMatchObject({
      dispatch: {
        callSessionId: "CA-phone-test-first:telephony",
        disposition: "routed",
        routeMode: "test_route",
      },
    });
    expect(second).toMatchObject({
      dispatch: {
        callSessionId: "CA-phone-test-second:telephony",
        disposition: "routed",
        routeMode: "test_route",
      },
    });
    expect(harness.incrementalRepository.phoneTestCheckpoints).toHaveLength(4);
    expect(
      harness.incrementalRepository.phoneTestCheckpoints.map(
        ({ callSessionId, checkpoint }) => `${callSessionId}:${checkpoint}`,
      ).sort(),
    ).toEqual([
      "CA-phone-test-first:telephony:allowedCallerMatched",
      "CA-phone-test-first:telephony:verifiedWebhook",
      "CA-phone-test-second:telephony:allowedCallerMatched",
      "CA-phone-test-second:telephony:verifiedWebhook",
    ]);
  });

  it("starts a protected phone test through the incremental projection without a snapshot save", async () => {
    const harness = await createReadyHarness({ activateRoute: false });
    const phoneNumber = (await harness.service.getState(organizationId)).phoneNumbers[0]!;
    const updateProjection = vi.spyOn(
      harness.incrementalRepository,
      "updatePhoneTestProjection",
    );
    harness.stateRepository.resetSaveCount();

    const response = await harness.service.createPstnTestRoute({
      organizationId,
      numberId: phoneNumber.id,
      publishedVersionId: "workflow-v1",
      workflowLabel: "Support",
      workspaceId: "workspace-1",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      now: "2026-07-23T10:00:00.000Z",
      expiresAt: "2026-07-23T10:30:00.000Z",
    });

    expect(harness.stateRepository.saveCount).toBe(0);
    expect(updateProjection).toHaveBeenCalledWith({
      tenantId: organizationId,
      phoneNumberId: phoneNumber.id,
      expectedTestRoute: null,
      expectedPhoneTestResults: null,
      testRoute: response.phoneNumber.testRoute,
      phoneTestResults: null,
    });
    expect(harness.incrementalRepository.phoneTestProjections[0]?.testRoute).toEqual(
      response.phoneNumber.testRoute,
    );
  });

  it("completes a protected phone test through the incremental projection without a snapshot save", async () => {
    const harness = await createReadyHarness({ testRoute: true });
    const phoneNumber = (await harness.service.getState(organizationId)).phoneNumbers[0]!;
    const sessionId = phoneNumber.testRoute!.waitingSession.id;
    const updateProjection = vi.spyOn(
      harness.incrementalRepository,
      "updatePhoneTestProjection",
    );
    harness.stateRepository.resetSaveCount();

    const response = await harness.service.completePstnTestRoute({
      organizationId,
      numberId: phoneNumber.id,
      sessionId,
      status: "manually_ended",
      reason: "Operator ended the phone test.",
      at: "2026-07-23T10:05:00.000Z",
    });

    expect(harness.stateRepository.saveCount).toBe(0);
    expect(updateProjection).toHaveBeenCalledWith({
      tenantId: organizationId,
      phoneNumberId: phoneNumber.id,
      expectedTestRoute: phoneNumber.testRoute,
      expectedPhoneTestResults: null,
      testRoute: response.phoneNumber.testRoute,
      phoneTestResults: response.phoneNumber.phoneTestResults,
    });
    expect(harness.incrementalRepository.phoneTestProjections[0]).toMatchObject({
      testRoute: response.phoneNumber.testRoute,
      phoneTestResults: response.phoneNumber.phoneTestResults,
    });
  });

  it("returns an explicit conflict without applying a stale phone-test completion", async () => {
    const harness = await createReadyHarness({ testRoute: true });
    const phoneNumber = (await harness.service.getState(organizationId)).phoneNumbers[0]!;
    vi.spyOn(
      harness.incrementalRepository,
      "updatePhoneTestProjection",
    ).mockResolvedValueOnce({ outcome: "conflict" });
    harness.stateRepository.resetSaveCount();

    await expect(
      harness.service.completePstnTestRoute({
        organizationId,
        numberId: phoneNumber.id,
        sessionId: phoneNumber.testRoute!.waitingSession.id,
        status: "manually_ended",
        reason: "Operator ended the phone test.",
        at: "2026-07-23T10:05:00.000Z",
      }),
    ).rejects.toThrow(
      "PSTN phone-test state changed while the phone test was being completed.",
    );

    expect(harness.stateRepository.saveCount).toBe(0);
    expect((await harness.service.getState(organizationId)).phoneNumbers[0]).toEqual(
      phoneNumber,
    );
  });

  it("removes only eligible terminal and blocked call graphs from the in-memory projection", async () => {
    const harness = await createReadyHarness();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-20T10:00:00.000Z"));
      const active = await answer(
        harness.service,
        "CA-retained-active",
        "EV-retained-active",
      );
      const terminal = await answer(
        harness.service,
        "CA-deleted-terminal",
        "EV-deleted-terminal",
      );
      const phoneNumber = (await harness.service.getState(organizationId))
        .phoneNumbers[0]!;
      await harness.service.pauseLiveRoute({
        organizationId,
        numberId: phoneNumber.id,
        actorUserId: "operator-1",
        now: "2026-07-20T10:00:30.000Z",
      });
      const blocked = await answer(
        harness.service,
        "CA-deleted-blocked",
        "EV-deleted-blocked",
      );
      if (
        !("dispatch" in active) ||
        !("dispatch" in terminal) ||
        !("dispatch" in blocked)
      ) {
        throw new Error("Expected routed and blocked inbound dispatches.");
      }
      expect(blocked.dispatch.disposition).toBe("blocked");
      await harness.service.recordCallControlEvent({
        organizationId,
        callSessionId: active.dispatch.callSessionId!,
        dispatchId: active.dispatch.id,
        eventType: "dtmf.received",
        digit: "1",
        at: "2026-07-20T10:01:00.000Z",
      });
      await harness.service.recordCallControlEvent({
        organizationId,
        callSessionId: terminal.dispatch.callSessionId!,
        dispatchId: terminal.dispatch.id,
        eventType: "dtmf.received",
        digit: "2",
        at: "2026-07-20T10:02:00.000Z",
      });
      await harness.service.recordPstnCallLifecycle({
        organizationId,
        callSessionId: terminal.dispatch.callSessionId!,
        stage: "completed",
        at: "2026-07-20T10:03:00.000Z",
      });
      vi.spyOn(
        harness.incrementalRepository,
        "deleteRetainedCallData",
      ).mockResolvedValueOnce({
        tenantId: organizationId,
        retainAfter: "2026-07-21T10:00:00.000Z",
        deletedCounts: {
          webhookEvents: 2,
          callControlEvents: 1,
          executionCommands: 1,
          executionSessions: 1,
          mediaTokens: 1,
          dispatches: 2,
        },
      });

      await harness.service.deleteRetainedCallData({
        organizationId,
        retainAfter: "2026-07-21T10:00:00.000Z",
      });

      const state = await harness.service.getState(organizationId);
      expect(state.dispatches.map(({ id }) => id)).toContain(active.dispatch.id);
      expect(state.executionSessions.map(({ callSessionId }) => callSessionId)).toContain(
        active.dispatch.callSessionId,
      );
      expect(state.executionCommands.map(({ callSessionId }) => callSessionId)).toContain(
        active.dispatch.callSessionId,
      );
      expect(state.callControlEvents.map(({ callSessionId }) => callSessionId)).toContain(
        active.dispatch.callSessionId,
      );
      expect(state.webhookEvents.map(({ callSid }) => callSid)).toContain(
        "CA-retained-active",
      );

      expect(state.dispatches.map(({ id }) => id)).not.toContain(terminal.dispatch.id);
      expect(state.executionSessions.map(({ callSessionId }) => callSessionId)).not.toContain(
        terminal.dispatch.callSessionId,
      );
      expect(state.executionCommands.map(({ callSessionId }) => callSessionId)).not.toContain(
        terminal.dispatch.callSessionId,
      );
      expect(state.callControlEvents.map(({ callSessionId }) => callSessionId)).not.toContain(
        terminal.dispatch.callSessionId,
      );
      expect(state.webhookEvents.map(({ callSid }) => callSid)).not.toContain(
        "CA-deleted-terminal",
      );
      expect(state.dispatches.map(({ id }) => id)).not.toContain(blocked.dispatch.id);
      expect(state.webhookEvents.map(({ callSid }) => callSid)).not.toContain(
        "CA-deleted-blocked",
      );
    } finally {
      vi.useRealTimers();
    }
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

  it("returns a blocked outbound result without a session when durable abuse posture wins", async () => {
    const harness = await createReadyHarness();
    vi.spyOn(harness.incrementalRepository, "createCallExecution").mockResolvedValueOnce({
      outcome: "blocked",
      reasonCode: "outbound_abuse_blocked",
    } as never);

    const result = await harness.service.dispatchOutboundCall({
      organizationId,
      fromPhoneNumber: "+14155557890",
      toPhoneNumber: "+14155550996",
      callSid: "CA-outbound-durable-abuse-block",
      publishedVersionId: "workflow-v1",
      workflowLabel: "Support",
      workspaceId: "workspace-1",
      consentGranted: true,
      budgetRemainingUsd: 5,
      estimatedCostUsd: 0.75,
      localHour: 12,
      callingWindow: {
        startHour: 8,
        endHour: 19,
      },
    });

    expect(result.dispatch).toMatchObject({
      direction: "outbound",
      disposition: "blocked",
      reason: "Outbound calling is paused pending abuse review.",
    });
    expect(result.dispatch.callSessionId).toBeUndefined();
    expect(result).not.toHaveProperty("session");
    expect(
      result.state.executionSessions.some(
        (session) => session.callSessionId === "CA-outbound-durable-abuse-block:telephony",
      ),
    ).toBe(false);
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

  it("does not reserve admission again when a terminal call webhook is replayed", async () => {
    const originalAdmission = createAdmissionCoordinator();
    const release = vi.spyOn(originalAdmission, "release");
    const harness = await createReadyHarness({
      admissionCoordinator: originalAdmission,
    });
    await answer(
      harness.service,
      "CA-terminal-webhook-replay",
      "EV-terminal-webhook-replay",
    );
    await harness.service.recordPstnCallLifecycle({
      organizationId,
      callSessionId: "CA-terminal-webhook-replay:telephony",
      stage: "completed",
      at: "2026-07-23T10:05:00.000Z",
    });
    expect(release).toHaveBeenCalledWith(
      organizationId,
      "CA-terminal-webhook-replay:telephony",
    );
    const restartedAdmission = createAdmissionCoordinator();
    const reserve = vi.spyOn(restartedAdmission, "reserve");
    const restarted = createService(
      harness.stateRepository,
      harness.incrementalRepository,
      undefined,
      restartedAdmission,
    );

    const replay = await answer(
      restarted,
      "CA-terminal-webhook-replay",
      "EV-terminal-webhook-replay",
    );

    expect(replay).toMatchObject({
      reasonCode: "call_setup_persistence_conflict",
    });
    expect(replay.twiml).not.toContain("<Connect>");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("fails a duplicate closed before reserve when its durable lifecycle cannot be read", async () => {
    const harness = await createReadyHarness();
    await answer(
      harness.service,
      "CA-unreadable-webhook-replay",
      "EV-unreadable-webhook-replay",
    );
    vi.spyOn(
      harness.incrementalRepository,
      "loadCallMutationContext",
    ).mockRejectedValueOnce(new Error("call lifecycle database unavailable"));
    const restartedAdmission = createAdmissionCoordinator();
    const reserve = vi.spyOn(restartedAdmission, "reserve");
    const restarted = createService(
      harness.stateRepository,
      harness.incrementalRepository,
      undefined,
      restartedAdmission,
    );

    const replay = await answer(
      restarted,
      "CA-unreadable-webhook-replay",
      "EV-unreadable-webhook-replay",
    );

    expect(replay).toMatchObject({
      reasonCode: "call_setup_persistence_failed",
    });
    expect(replay.twiml).not.toContain("<Connect>");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("replays an active durable call before consulting a changed route", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const reserve = vi.spyOn(admissionCoordinator, "reserve");
    const harness = await createReadyHarness({ admissionCoordinator });
    const first = await answer(
      harness.service,
      "CA-active-webhook-replay",
      "EV-active-webhook-replay",
    );
    const routedNumber = (
      await harness.service.getState(organizationId)
    ).phoneNumbers[0]!;
    await harness.service.pauseLiveRoute({
      organizationId,
      numberId: routedNumber.id,
      actorUserId: "operator-1",
      now: "2026-07-23T10:05:00.000Z",
    });
    harness.incrementalRepository.loadPhoneNumberProjections(
      organizationId,
      (await harness.service.getState(organizationId)).phoneNumbers,
    );

    const replay = await answer(
      harness.service,
      "CA-active-webhook-replay",
      "EV-active-webhook-replay",
    );

    expect(first.twiml).toContain("<Connect>");
    expect(replay.twiml).toContain("<Connect>");
    expect(replay.duplicate).toBe(true);
    expect(extractStreamToken(replay.twiml)).toBe(extractStreamToken(first.twiml));
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent deliveries onto one durable call setup", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const reserve = vi.spyOn(admissionCoordinator, "reserve");
    const harness = await createReadyHarness({ admissionCoordinator });
    harness.stateRepository.resetSaveCount();

    const responses = await Promise.all([
      answer(harness.service, "CA-incremental-concurrent", "EV-incremental-concurrent"),
      answer(harness.service, "CA-incremental-concurrent", "EV-incremental-concurrent"),
    ]);
    expect(responses).toHaveLength(2);
    expect(responses.every((response) => response.twiml.includes("<Connect>"))).toBe(true);
    expect(extractStreamToken(responses[0]!.twiml)).toBe(
      extractStreamToken(responses[1]!.twiml),
    );
    expect(reserve).toHaveBeenCalledTimes(2);
    await expect(
      Promise.all(reserve.mock.results.map(({ value }) => value)),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "admitted",
          disposition: "created",
        }),
        expect.objectContaining({
          outcome: "admitted",
          disposition: "existing",
        }),
      ]),
    );
    expect(harness.incrementalRepository.webhookEvents).toHaveLength(1);
    expect(harness.incrementalRepository.callSetups).toHaveLength(1);
  });

  it("converges concurrent duplicates when one setup write fails after the other persists", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const reserve = vi.spyOn(admissionCoordinator, "reserve");
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({ admissionCoordinator });
    const createCallSetup =
      harness.incrementalRepository.createCallSetup.bind(
        harness.incrementalRepository,
      );
    let setupInvocation = 0;
    let signalPersistedSetup!: () => void;
    const persistedSetup = new Promise<void>((resolve) => {
      signalPersistedSetup = resolve;
    });
    vi.spyOn(
      harness.incrementalRepository,
      "createCallSetup",
    ).mockImplementation(async (input) => {
      setupInvocation += 1;
      if (setupInvocation === 1) {
        await persistedSetup;
        throw new Error("ambiguous setup failure");
      }
      const outcome = await createCallSetup(input);
      signalPersistedSetup();
      return outcome;
    });

    const responses = await Promise.all([
      answer(
        harness.service,
        "CA-concurrent-ambiguous-setup",
        "EV-concurrent-ambiguous-setup",
      ),
      answer(
        harness.service,
        "CA-concurrent-ambiguous-setup",
        "EV-concurrent-ambiguous-setup",
      ),
    ]);

    expect(responses.every((response) => response.twiml.includes("<Connect>"))).toBe(
      true,
    );
    expect(extractStreamToken(responses[0]!.twiml)).toBe(
      extractStreamToken(responses[1]!.twiml),
    );
    await expect(
      Promise.all(reserve.mock.results.map(({ value }) => value)),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "admitted",
          disposition: "created",
        }),
        expect.objectContaining({
          outcome: "admitted",
          disposition: "existing",
        }),
      ]),
    );
    expect(release).not.toHaveBeenCalled();
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

  it("keeps operational health and retention writes off the aggregate snapshot path", async () => {
    const harness = await createReadyHarness();
    const connectionId = "telephony-tenant-incremental-1";

    harness.stateRepository.resetSaveCount();
    await harness.service.validateConnection({
      organizationId,
      connectionId,
    });
    expect(harness.stateRepository.saveCount).toBe(0);

    harness.stateRepository.resetSaveCount();
    await harness.service.runConnectionHeartbeat({
      organizationId,
      connectionId,
      scheduled: false,
    });
    expect(harness.stateRepository.saveCount).toBe(0);

    harness.stateRepository.resetSaveCount();
    await harness.service.deleteRetainedCallData({
      organizationId,
      retainAfter: "2026-07-24T00:00:00.000Z",
    });
    expect(harness.stateRepository.saveCount).toBe(0);
  });

  it("keeps health observation identities unique when checks share a timestamp", async () => {
    const harness = await createReadyHarness();
    const connectionId = "telephony-tenant-incremental-1";
    const toISOString = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(
      "2026-07-24T12:00:00.000Z",
    );

    try {
      await harness.service.validateConnection({
        organizationId,
        connectionId,
      });
      await harness.service.validateConnection({
        organizationId,
        connectionId,
      });
      await harness.service.runConnectionHeartbeat({
        organizationId,
        connectionId,
        scheduled: false,
      });
      await harness.service.runConnectionHeartbeat({
        organizationId,
        connectionId,
        scheduled: false,
      });
    } finally {
      toISOString.mockRestore();
    }

    const healthCheckIds = harness.incrementalRepository
      .connectionHealthObservations
      .map((observation) => observation.healthCheck.id);
    const heartbeatIds = harness.incrementalRepository
      .connectionHealthObservations
      .flatMap((observation) =>
        observation.heartbeat === undefined
          ? []
          : [observation.heartbeat.id],
      );
    expect(new Set(healthCheckIds).size).toBe(4);
    expect(new Set(heartbeatIds).size).toBe(2);
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
    await expect(
      harness.incrementalRepository.loadCallRuntimeContext({
        tenantId: organizationId,
        callSessionId: "CA-incremental-phone-test-failure:telephony",
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      context: {
        lifecycleState: {
          stage: "failed",
          reasonCode: "phone_test_checkpoint_persistence_failed",
        },
        status: "terminated",
      },
    });
  });

  it("terminalizes durable setup when the phone-test projection cannot be persisted", async () => {
    const harness = await createReadyHarness({ testRoute: true });
    harness.incrementalRepository.failPhoneTestProjection = true;

    const response = await answer(
      harness.service,
      "CA-incremental-phone-test-projection-failure",
      "EV-incremental-phone-test-projection-failure",
    );

    expect(response.twiml).not.toContain("<Connect>");
    expect("reasonCode" in response ? response.reasonCode : undefined).toBe(
      "phone_test_projection_persistence_failed",
    );
    await expect(
      harness.incrementalRepository.loadCallRuntimeContext({
        tenantId: organizationId,
        callSessionId:
          "CA-incremental-phone-test-projection-failure:telephony",
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      context: {
        lifecycleState: {
          stage: "failed",
          reasonCode: "phone_test_projection_persistence_failed",
        },
        status: "terminated",
      },
    });
  });

  it("does not terminalize an existing phone-test setup when duplicate checkpoint work fails", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({
      admissionCoordinator,
      testRoute: true,
    });
    const createCallSetup =
      harness.incrementalRepository.createCallSetup.bind(
        harness.incrementalRepository,
      );
    vi.spyOn(
      harness.incrementalRepository,
      "createCallSetup",
    ).mockImplementationOnce(async (input) => {
      await createCallSetup(input);
      return {
        outcome: "existing" as const,
        mediaToken: "retained" as const,
      };
    });
    vi.spyOn(
      harness.incrementalRepository,
      "recordPhoneTestCheckpoint",
    ).mockRejectedValueOnce(new Error("duplicate checkpoint failed"));

    const response = await answer(
      harness.service,
      "CA-existing-phone-test-checkpoint",
      "EV-existing-phone-test-checkpoint",
    );
    const persisted =
      await harness.incrementalRepository.loadCallRuntimeContext({
        tenantId: organizationId,
        callSessionId: "CA-existing-phone-test-checkpoint:telephony",
      });

    expect(response).toMatchObject({
      reasonCode: "phone_test_checkpoint_persistence_failed",
    });
    expect(persisted.outcome).toBe("found");
    if (persisted.outcome === "found") {
      expect(persisted.context.lifecycleState.stage).not.toBe("failed");
      expect(persisted.context.status).not.toBe("terminated");
    }
    expect(release).not.toHaveBeenCalled();
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

  it("retries setup after the original webhook delivery fails before call setup persists", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const reserve = vi.spyOn(admissionCoordinator, "reserve");
    const harness = await createReadyHarness({ admissionCoordinator });
    harness.incrementalRepository.failCallSetup = true;

    const failed = await answer(
      harness.service,
      "CA-incremental-setup-retry",
      "EV-incremental-setup-retry",
    );
    harness.incrementalRepository.failCallSetup = false;
    const retry = await answer(
      harness.service,
      "CA-incremental-setup-retry",
      "EV-incremental-setup-retry",
    );

    expect(failed.twiml).not.toContain("<Connect>");
    expect(retry.twiml).toContain("<Connect>");
    expect(retry.duplicate).toBe(true);
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(harness.incrementalRepository.webhookEvents).toHaveLength(1);
    expect(harness.incrementalRepository.callSetups).toHaveLength(1);
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
      providerAccountId: accountSid,
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
    const admissionCoordinator = createAdmissionCoordinator();
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({ admissionCoordinator });
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
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(
      organizationId,
      "CA-incremental-terminal:telephony",
    );
  });

  it("keeps admission active when terminal lifecycle persistence fails", async () => {
    const admissionCoordinator = createAdmissionCoordinator();
    const release = vi.spyOn(admissionCoordinator, "release");
    const harness = await createReadyHarness({ admissionCoordinator });
    await answer(
      harness.service,
      "CA-incremental-terminal-failure",
      "EV-incremental-terminal-failure",
    );
    vi.spyOn(
      harness.incrementalRepository,
      "loadCallRuntimeContext",
    ).mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      harness.service.recordPstnCallLifecycle({
        organizationId,
        callSessionId: "CA-incremental-terminal-failure:telephony",
        stage: "failed",
        reasonCode: "provider_failure",
      }),
    ).rejects.toThrow("database unavailable");
    expect(release).not.toHaveBeenCalled();
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
    admissionCoordinator?: PstnAdmissionCoordinator;
    blockRoutingOnHealthFailure?: boolean;
    failedProviderHealth?: boolean;
  } = {},
) {
  const stateRepository = new MemoryTelephonyStateRepository();
  const incrementalRepository = new InMemoryTelephonyIncrementalRepository();
  const admissionCoordinator =
    input.admissionCoordinator ?? createAdmissionCoordinator();
  let service = createService(
    stateRepository,
    incrementalRepository,
    input.auditLogService,
    admissionCoordinator,
  );
  const connection = await service.createConnection({
    organizationId,
    actorUserId: "operator-1",
    label: "Twilio",
    ownershipMode: "byo_provider_account",
    provider: "twilio",
    region: "us-east-1",
    blockRoutingOnHealthFailure:
      input.blockRoutingOnHealthFailure ?? true,
    accountSid,
    authToken,
  });
  incrementalRepository.loadConnections(organizationId, [
    connection.connection.id,
  ]);
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
  incrementalRepository.loadPhoneNumberProjections(
    organizationId,
    (await service.getState(organizationId)).phoneNumbers,
  );
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
  if (input.failedProviderHealth === true) {
    stateRepository.setConnectionHealth(connection.connection.id, "failed");
    incrementalRepository.setConnectionAdmissionPosture(
      connection.connection.id,
      {
        status: connection.connection.status,
        healthStatus: "failed",
        blockRoutingOnHealthFailure:
          input.blockRoutingOnHealthFailure ?? true,
      },
    );
    service = createService(
      stateRepository,
      incrementalRepository,
      input.auditLogService,
      admissionCoordinator,
    );
  }
  return { service, stateRepository, incrementalRepository };
}

function createService(
  stateRepository: TelephonyStateRepository,
  incrementalRepository: TelephonyIncrementalRepository,
  auditLogService?: AuditLogService,
  admissionCoordinator = createAdmissionCoordinator(),
) {
  return new TelephonyService(
    stateRepository,
    new TelephonySecretVault({
      masterSecret: "12345678901234567890123456789012",
      keyVersion: 1,
    }),
    inventoryProvider(),
    routingProvider(),
    incrementalRepository as never,
    admissionCoordinator,
    createUnusedPremiumSnapshotResolver(),
    auditLogService,
    undefined,
    undefined,
  );
}

function createUnusedPremiumSnapshotResolver() {
  return {
    async resolve() {
      throw new Error("Premium snapshot resolution is not expected in this test.");
    },
  } as never;
}

function createAdmissionCoordinator(
  overrides: Partial<PstnAdmissionCoordinator> = {},
  now: () => number = Date.now,
) {
  const admission = new InMemoryPstnCallAdmission(now);
  const config: PstnAdmissionConfig = {
    mode: "memory",
    workerId: "test-worker",
    limits: {
      global: 20,
      provider: 20,
      tenant: 20,
      worker: 20,
      runtime: {
        "pstn-sandwich": 20,
        "pstn-premium-realtime": 20,
      },
    },
    cps: {
      global: { capacity: 20, refillPerSecond: 20 },
      providerAccount: { capacity: 20, refillPerSecond: 20 },
    },
    claimTtlMs: 30_000,
    activeTtlMs: 120_000,
    renewIntervalMs: 30_000,
    commandTimeoutMs: 750,
  };
  const coordinator = new PstnAdmissionCoordinator(admission, config);
  Object.assign(coordinator, overrides);
  return coordinator;
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

  setConnectionHealth(
    connectionId: string,
    healthStatus: "failed",
  ) {
    if (this.record === null) {
      throw new Error("Expected persisted telephony state.");
    }
    this.record.connections = this.record.connections.map((connection) =>
      connection.id === connectionId
        ? {
            ...connection,
            status: "degraded",
            healthStatus,
          }
        : connection,
    );
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
