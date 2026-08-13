import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeTwilioWebhookSignature } from "@zara/core";
import { afterEach, describe, expect, it } from "vitest";

import { FileTelephonyStateRepository } from "./telephony-state.repository";
import { InMemoryTelephonyIncrementalRepository } from "./telephony-incremental.repository.test-helper";
import { InMemoryPstnCallAdmission } from "./in-memory-pstn-call-admission";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import { TelephonySecretVault } from "./telephony-secret-vault";
import { TelephonyService } from "./telephony.service";
import type { PersistedTelephonyStateRecord } from "./telephony-state.repository";
import type { TwilioNumberInventoryProvider } from "./twilio-number-inventory.provider";
import type { TwilioNumberRoutingProvider } from "./twilio-number-routing.provider";

describe("telephony persistence and secret storage", () => {
  let tempDirectory = "";

  afterEach(() => {
    if (tempDirectory.length > 0) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = "";
    }
  });

  it("persists tenant telephony state across service instances and keeps webhook dedupe after restart", async () => {
    const { incrementalRepository, service, storePath } = createHarness();
    const organizationId = "tenant-west-africa";

    const connectResponse = await service.createConnection({
      organizationId,
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token-1234567890",
    });
    const connectionId = connectResponse.connection.id;
    incrementalRepository.loadConnections(organizationId, [connectionId]);

    await service.importTwilioNumbers({
      organizationId,
      connectionId,
    });
    const importedNumberId = (await service.getState(organizationId)).phoneNumbers[0]!.id;
    await service.assignNumberRoute({
      organizationId,
      numberId: importedNumberId,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-customer-success",
    });
    await service.activateLiveRoute({
      organizationId,
      numberId: importedNumberId,
      actorUserId: "user-ops-lead",
      now: "2026-05-14T12:12:00.000Z",
      override: {
        actorUserId: "user-ops-lead",
        approvedByUserId: "platform-admin-1",
        reason: "Persistence test fixture activation override.",
      },
    });
    await service.dispatchInboundCall({
      organizationId,
      toPhoneNumber: "+14155557890",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-before-restart-1",
    });

    expect(existsSync(join(storePath, `${organizationId}.json`))).toBe(true);

    const restartedService = recreateHarness(storePath, { incrementalRepository }).service;
    const restartedState = await restartedService.getState(organizationId);

    expect(restartedState.connections).toHaveLength(1);
    expect(restartedState.phoneNumbers[0]).toMatchObject({
      phoneNumber: "+14155557890",
      liveRoute: {
        mode: "live_route",
        publishedVersionId: "workflow-support-v1",
        workspaceId: "workspace-customer-success",
      },
    });
    await expect(
      incrementalRepository.loadCallMutationContext({
        tenantId: organizationId,
        callSessionId: "CA-before-restart-1:telephony",
      }),
    ).resolves.toMatchObject({ outcome: "found" });

    expect(
      (await restartedService.validateConnection({
        organizationId,
        connectionId,
      })).healthCheck.status,
    ).toBe("healthy");

    const webhookPayload = {
      AccountSid: "AC1234567890abcdef1234567890abcd",
      CallSid: "CA-webhook-1",
      EventSid: "EVT-1",
      EventType: "incoming.call",
      To: "+14155557890",
      From: "+233201110001",
    };
    const signature = computeTwilioWebhookSignature({
      url: "http://127.0.0.1/telephony/webhooks/twilio",
      parameters: webhookPayload,
      authToken: "twilio-auth-token-1234567890",
    });

    expect(
      (await restartedService.handleTwilioWebhook({
        signature,
        payload: webhookPayload,
      })).duplicate,
    ).toBe(false);

    const thirdService = recreateHarness(storePath, { incrementalRepository }).service;
    expect(
      (await thirdService.handleTwilioWebhook({
        signature,
        payload: webhookPayload,
      })).duplicate,
    ).toBe(true);
    await expect(
      incrementalRepository.loadCallMutationContext({
        tenantId: organizationId,
        callSessionId: "CA-webhook-1:telephony",
      }),
    ).resolves.toMatchObject({ outcome: "found" });
  });

  it("removes connection-owned durable execution state when deleting a connection", async () => {
    const { service, storePath, incrementalRepository } = createHarness();
    const organizationId = "tenant-west-africa";
    const connection = await service.createConnection({
      organizationId,
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token-1234567890",
    });

    await service.importTwilioNumbers({ organizationId, connectionId: connection.connection.id });
    const phoneNumber = (await service.getState(organizationId)).phoneNumbers[0]!;
    await service.assignNumberRoute({
      organizationId,
      numberId: phoneNumber.id,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-customer-success",
    });
    await service.activateLiveRoute({
      organizationId,
      numberId: phoneNumber.id,
      actorUserId: "user-ops-lead",
      now: "2026-07-14T13:00:00.000Z",
      override: {
        actorUserId: "user-ops-lead",
        approvedByUserId: "platform-admin-1",
        reason: "Connection deletion persistence fixture.",
      },
    });

    const dispatched = await service.dispatchInboundCall({
      organizationId,
      toPhoneNumber: phoneNumber.phoneNumber,
      fromPhoneNumber: "+233201110001",
      callSid: "CA-delete-connection-1",
    });
    await expect(
      incrementalRepository.loadCallMutationContext({
        tenantId: organizationId,
        callSessionId: dispatched.dispatch.callSessionId!,
      }),
    ).resolves.toMatchObject({ outcome: "found" });

    const repository = new FileTelephonyStateRepository(storePath);
    const beforeDeletion = await repository.load(organizationId);
    expect(beforeDeletion?.executionSessions).toEqual([]);
    expect(beforeDeletion?.executionCommands).toEqual([]);
    expect(beforeDeletion?.webhookEvents).toEqual([]);

    await service.deleteConnection({ organizationId, connectionId: connection.connection.id });

    const afterDeletion = await repository.load(organizationId);
    expect(afterDeletion?.connections).toEqual([]);
    expect(afterDeletion?.executionSessions).toEqual([]);
    expect(afterDeletion?.executionCommands).toEqual([]);
    expect(afterDeletion?.webhookEvents).toEqual([]);
    expect(afterDeletion?.credentials).toEqual([]);
    await expect(
      incrementalRepository.loadCallMutationContext({
        tenantId: organizationId,
        callSessionId: dispatched.dispatch.callSessionId!,
      }),
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("encrypts stored provider secrets at rest and records key version metadata", async () => {
    const { service, storePath } = createHarness({
      keyVersion: 7,
    });
    const organizationId = "tenant-west-africa";

    await service.createConnection({
      organizationId,
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token-1234567890",
    });

    const persistedSnapshot = readFileSync(join(storePath, `${organizationId}.json`), "utf8");

    expect(persistedSnapshot).not.toContain("twilio-auth-token-1234567890");
    expect(persistedSnapshot).toContain("\"keyVersion\": 7");
    expect(persistedSnapshot).toContain("\"algorithm\": \"aes-256-gcm\"");
  });

  it("rotates stored telephony credential envelopes to the active key version without breaking validation", async () => {
    const organizationId = "tenant-west-africa";
    const initialHarness = createHarness({
      masterSecret: "12345678901234567890123456789012",
      keyVersion: 7,
    });

    const connectionResponse = await initialHarness.service.createConnection({
      organizationId,
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token-1234567890",
    });
    initialHarness.incrementalRepository.loadConnections(organizationId, [
      connectionResponse.connection.id,
    ]);

    const rotatedHarness = recreateHarness(initialHarness.storePath, {
      masterSecret: "abcdefghijklmnopqrstuvwxyz123456",
      keyVersion: 8,
      legacyMasterSecretsByVersion: {
        7: "12345678901234567890123456789012",
      },
      incrementalRepository: initialHarness.incrementalRepository,
    });

    const rotationResponse = await rotatedHarness.service.rotateCredentialEnvelopes({
      organizationId,
    });

    expect(rotationResponse.rotatedConnectionCount).toBe(1);
    expect(
      (await rotatedHarness.service.validateConnection({
        organizationId,
        connectionId: rotationResponse.state.connections[0]!.id,
      })).healthCheck.status,
    ).toBe("healthy");

    const persistedSnapshot = readFileSync(
      join(initialHarness.storePath, `${organizationId}.json`),
      "utf8",
    );

    expect(persistedSnapshot).toContain("\"keyVersion\": 8");
    expect(persistedSnapshot).not.toContain("\"keyVersion\": 7");
  });

  it("degrades telephony connections safely when persisted secrets can no longer be decrypted", async () => {
    const organizationId = "tenant-west-africa";
    const initialHarness = createHarness({
      masterSecret: "12345678901234567890123456789012",
      keyVersion: 1,
    });

    await initialHarness.service.createConnection({
      organizationId,
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token-1234567890",
    });

    const restartedService = recreateHarness(initialHarness.storePath, {
      masterSecret: "different-master-secret-123456789012",
      keyVersion: 1,
    }).service;
    const recoveredState = await restartedService.getState(organizationId);

    expect(recoveredState.connections[0]).toMatchObject({
      status: "degraded",
      healthStatus: "failed",
    });
    expect(recoveredState.connections[0]?.credentialReference?.preview).toBe("unavailable");
    expect(recoveredState.healthChecks[0]?.message).toContain("could not be decrypted");
  });

  it("persists scheduled provider heartbeats through the incremental repository", async () => {
    const { incrementalRepository, service } = createHarness();
    const organizationId = "tenant-west-africa";
    const connectionResponse = await service.createConnection({
      organizationId,
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token-1234567890",
    });
    incrementalRepository.loadConnections(organizationId, [connectionResponse.connection.id]);

    await service.importTwilioNumbers({
      organizationId,
      connectionId: connectionResponse.connection.id,
    });
    const numberId = (await service.getState(organizationId)).phoneNumbers[0]!.id;
    await service.assignNumberRoute({
      organizationId,
      numberId,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-customer-success",
    });

    const sweepResponse = await service.runScheduledHeartbeatSweep();

    expect(sweepResponse.heartbeats).toHaveLength(1);
    expect(sweepResponse.heartbeats[0]).toMatchObject({
      scheduled: true,
      connectionId: connectionResponse.connection.id,
      status: "healthy",
    });

    expect(incrementalRepository.connectionHealthObservations[0]?.heartbeat).toMatchObject({
      scheduled: true,
      connectionId: connectionResponse.connection.id,
    });
  });

  it("records concurrent tenant checkpoints incrementally without snapshot saves", async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), "zara-telephony-"));
    const repository = new DelayedFileTelephonyStateRepository(join(tempDirectory, "telephony-store"));
    const incrementalRepository = new InMemoryTelephonyIncrementalRepository();
    const service = new TelephonyService(
      repository,
      new TelephonySecretVault({
        masterSecret: "12345678901234567890123456789012",
        keyVersion: 1,
      }),
      createGeneratedTwilioInventoryProvider(),
      createNoopTwilioRoutingProvider(),
      incrementalRepository,
      createTestAdmissionCoordinator(),
      createUnusedPremiumSnapshotResolver(),
    );
    const organizationId = "tenant-west-africa";
    const connection = await service.createConnection({
      organizationId,
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token-1234567890",
    });
    await service.importTwilioNumbers({
      organizationId,
      connectionId: connection.connection.id,
    });
    const numberId = (await service.getState(organizationId)).phoneNumbers[0]!.id;
    await service.assignNumberRoute({
      organizationId,
      numberId,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-customer-success",
      runtimeProfile: "cost-optimized",
    });
    incrementalRepository.loadPhoneNumberProjections(
      organizationId,
      (await service.getState(organizationId)).phoneNumbers,
    );
    await service.createPstnTestRoute({
      organizationId,
      numberId,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-customer-success",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      now: "2026-07-17T20:00:00.000Z",
      expiresAt: "2026-07-17T20:30:00.000Z",
    });
    const routed = await service.dispatchInboundCall({
      organizationId,
      toPhoneNumber: "+14155557890",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-concurrent-checkpoints",
      now: "2026-07-17T20:01:00.000Z",
    });
    expect(routed.dispatch.routeMode).toBe("test_route");
    repository.delaySaves = true;

    await Promise.all([
      service.recordPstnPhoneTestCheckpoint({
        organizationId,
        callSessionId: routed.dispatch.callSessionId!,
        checkpoint: "outboundAudioSent",
      }),
      service.recordPstnPhoneTestCheckpoint({
        organizationId,
        callSessionId: routed.dispatch.callSessionId!,
        checkpoint: "agentResponseGenerated",
      }),
    ]);

    expect(repository.maximumConcurrentSaves).toBe(0);
    expect(
      incrementalRepository.phoneTestCheckpoints.map(({ checkpoint }) => checkpoint).sort(),
    ).toEqual(["agentResponseGenerated", "outboundAudioSent"]);
  });

  it("imports real Twilio inventory from the connected account instead of generated fixtures", async () => {
    const twilioInventory = createTwilioInventoryProvider([
      {
        sid: "PN-real-support",
        phoneNumber: "+14155550123",
        friendlyName: "Real support line",
        capabilities: {
          voice: true,
          sms: true,
        },
      },
    ]);
    const { service } = createHarness({ twilioInventory });
    const organizationId = "tenant-west-africa";
    const connectionResponse = await service.createConnection({
      organizationId,
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: "twilio-auth-token-1234567890",
    });

    const response = await service.importTwilioNumbers({
      organizationId,
      connectionId: connectionResponse.connection.id,
    });

    expect(twilioInventory.requests).toEqual([
      {
        accountSid: "AC1234567890abcdef1234567890abcd",
        authToken: "twilio-auth-token-1234567890",
      },
    ]);
    expect(response.importedNumbers).toHaveLength(1);
    expect(response.importedNumbers[0]).toMatchObject({
      externalNumberId: "PN-real-support",
      phoneNumber: "+14155550123",
      friendlyName: "Real support line",
    });
  });

  it("recovers from a corrupt tenant snapshot by quarantining the broken file and starting empty", async () => {
    const { storePath } = createHarness();
    const organizationId = "tenant-west-africa";

    mkdirSync(storePath, { recursive: true });
    writeFileSync(join(storePath, `${organizationId}.json`), "{\"broken\":", "utf8");

    const service = recreateHarness(storePath).service;
    const recoveredState = await service.getState(organizationId);

    expect(recoveredState.connections).toEqual([]);
    expect(recoveredState.phoneNumbers).toEqual([]);
    expect(
      readdirSync(storePath).some((fileName) => fileName.startsWith(`${organizationId}.corrupt-`)),
    ).toBe(true);
  });

  function createHarness(input?: {
    masterSecret?: string;
    keyVersion?: number;
    legacyMasterSecretsByVersion?: Record<number, string>;
    twilioInventory?: TwilioNumberInventoryProvider;
    twilioRouting?: TwilioNumberRoutingProvider;
    incrementalRepository?: InMemoryTelephonyIncrementalRepository;
  }) {
    process.env.PAYG_MAXIMUM_CALL_SECONDS ??= "300";
    process.env.PAYG_RESERVATION_TTL_SECONDS ??= "360";
    tempDirectory = mkdtempSync(join(tmpdir(), "zara-telephony-"));
    const storePath = join(tempDirectory, "telephony-store");
    const secretVault = new TelephonySecretVault({
      masterSecret: input?.masterSecret ?? "12345678901234567890123456789012",
      keyVersion: input?.keyVersion ?? 1,
      legacyMasterSecretsByVersion: input?.legacyMasterSecretsByVersion,
    });
    const repository = new FileTelephonyStateRepository(storePath);
    const incrementalRepository =
      input?.incrementalRepository ?? new InMemoryTelephonyIncrementalRepository();

    return {
      incrementalRepository,
      storePath,
      service: createTestTelephonyService(
        repository,
        secretVault,
        input?.twilioInventory ?? createGeneratedTwilioInventoryProvider(),
        input?.twilioRouting ?? createNoopTwilioRoutingProvider(),
        incrementalRepository,
        createTestAdmissionCoordinator(),
        createUnusedPremiumSnapshotResolver(),
      ),
    };
  }

  function recreateHarness(
    storePath: string,
    input?: {
      masterSecret?: string;
      keyVersion?: number;
      legacyMasterSecretsByVersion?: Record<number, string>;
      twilioInventory?: TwilioNumberInventoryProvider;
      twilioRouting?: TwilioNumberRoutingProvider;
      incrementalRepository?: InMemoryTelephonyIncrementalRepository;
    },
  ) {
    const secretVault = new TelephonySecretVault({
      masterSecret: input?.masterSecret ?? "12345678901234567890123456789012",
      keyVersion: input?.keyVersion ?? 1,
      legacyMasterSecretsByVersion: input?.legacyMasterSecretsByVersion,
    });
    const repository = new FileTelephonyStateRepository(storePath);
    const incrementalRepository =
      input?.incrementalRepository ?? new InMemoryTelephonyIncrementalRepository();

    return {
      incrementalRepository,
      storePath,
      service: createTestTelephonyService(
        repository,
        secretVault,
        input?.twilioInventory ?? createGeneratedTwilioInventoryProvider(),
        input?.twilioRouting ?? createNoopTwilioRoutingProvider(),
        incrementalRepository,
        createTestAdmissionCoordinator(),
        createUnusedPremiumSnapshotResolver(),
      ),
    };
  }

  function createTestAdmissionCoordinator() {
    return new PstnAdmissionCoordinator(new InMemoryPstnCallAdmission(), {
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
    });
  }

  function createTestTelephonyService(
    repository: FileTelephonyStateRepository,
    secretVault: TelephonySecretVault,
    inventory: TwilioNumberInventoryProvider,
    routing: TwilioNumberRoutingProvider,
    incrementalRepository: InMemoryTelephonyIncrementalRepository,
    admissionCoordinator: PstnAdmissionCoordinator,
    premiumResolver: never,
  ) {
    process.env.PAYG_MAXIMUM_CALL_SECONDS ??= "300";
    process.env.PAYG_RESERVATION_TTL_SECONDS ??= "360";
    return new TelephonyService(
      repository,
      secretVault,
      inventory,
      routing,
      incrementalRepository,
      admissionCoordinator,
      premiumResolver,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { async evaluateNextSafeSegment() { return { billingAccessMode: "subscription" }; } } as never,
      { async start() { return { outcome: "reserved", duplicate: false }; },
        async releaseByReservationKey() { return { outcome: "released", duplicate: false }; } } as never,
      { async getStatus() { return { outcome: "found", status: "active" }; } } as never,
      { async resolve() { return { mode: "subscription", subscriptionId: "test-subscription",
        catalogId: "test-catalog", planSlug: "growth", premiumAllowed: true,
        available: true, availableIncludedSeconds: 300,
        availablePaygMinor: 0, availableOverageMinor: 0 }; } } as never,
    );
  }

  function createUnusedPremiumSnapshotResolver() {
    return {
      async resolve() {
        throw new Error("Premium snapshot resolution is not expected in this test.");
      },
    } as never;
  }

  function createGeneratedTwilioInventoryProvider(): TwilioNumberInventoryProvider & {
    requests: Array<{ accountSid: string; authToken: string }>;
  } {
    return createTwilioInventoryProvider([
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
    ]);
  }

  function createTwilioInventoryProvider(
    numbers: Awaited<ReturnType<TwilioNumberInventoryProvider["listIncomingPhoneNumbers"]>>,
  ): TwilioNumberInventoryProvider & {
    requests: Array<{ accountSid: string; authToken: string }>;
  } {
    const requests: Array<{ accountSid: string; authToken: string }> = [];

    return {
      requests,
      async listIncomingPhoneNumbers(input) {
        requests.push(input);
        return numbers;
      },
    };
  }

  function createNoopTwilioRoutingProvider(): TwilioNumberRoutingProvider {
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
        return {
          sid: input.callSid,
        };
      },
      async terminateCall(input) {
        return {
          sid: input.callSid,
          status: "completed",
        };
      },
      async listRecentMonitorAlerts() {
        return [];
      },
    };
  }

  class DelayedFileTelephonyStateRepository extends FileTelephonyStateRepository {
    delaySaves = false;
    maximumConcurrentSaves = 0;
    private activeSaves = 0;

    override async save(record: PersistedTelephonyStateRecord) {
      if (!this.delaySaves) {
        await super.save(record);
        return;
      }

      this.activeSaves += 1;
      this.maximumConcurrentSaves = Math.max(this.maximumConcurrentSaves, this.activeSaves);
      try {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await super.save(record);
      } finally {
        this.activeSaves -= 1;
      }
    }
  }
});
