import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeTwilioWebhookSignature } from "@zara/core";
import { afterEach, describe, expect, it } from "vitest";

import { FileTelephonyStateRepository } from "./telephony-state.repository";
import { TelephonySecretVault } from "./telephony-secret-vault";
import { TelephonyService } from "./telephony.service";

describe("telephony persistence and secret storage", () => {
  let tempDirectory = "";

  afterEach(() => {
    if (tempDirectory.length > 0) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = "";
    }
  });

  it("persists tenant telephony state across service instances and keeps webhook dedupe after restart", () => {
    const { service, storePath } = createHarness();
    const organizationId = "tenant-west-africa";

    const connectResponse = service.createConnection({
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

    service.importTwilioNumbers({
      organizationId,
      connectionId,
    });
    const importedNumberId = service.getState(organizationId).phoneNumbers[0]!.id;
    service.assignNumberRoute({
      organizationId,
      numberId: importedNumberId,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-support",
    });

    expect(existsSync(join(storePath, `${organizationId}.json`))).toBe(true);

    const restartedService = recreateHarness(storePath).service;
    const restartedState = restartedService.getState(organizationId);

    expect(restartedState.connections).toHaveLength(1);
    expect(restartedState.phoneNumbers[0]).toMatchObject({
      phoneNumber: "+14155557890",
      publishedVersionId: "workflow-support-v1",
      workspaceId: "workspace-support",
    });

    expect(
      restartedService.validateConnection({
        organizationId,
        connectionId,
      }).healthCheck.status,
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
      restartedService.handleTwilioWebhook({
        signature,
        payload: webhookPayload,
      }).duplicate,
    ).toBe(false);

    const thirdService = recreateHarness(storePath).service;
    expect(
      thirdService.handleTwilioWebhook({
        signature,
        payload: webhookPayload,
      }).duplicate,
    ).toBe(true);
  });

  it("encrypts stored provider secrets at rest and records key version metadata", () => {
    const { service, storePath } = createHarness({
      keyVersion: 7,
    });
    const organizationId = "tenant-west-africa";

    service.createConnection({
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

  it("rotates stored telephony credential envelopes to the active key version without breaking validation", () => {
    const organizationId = "tenant-west-africa";
    const initialHarness = createHarness({
      masterSecret: "12345678901234567890123456789012",
      keyVersion: 7,
    });

    initialHarness.service.createConnection({
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

    const rotatedHarness = recreateHarness(initialHarness.storePath, {
      masterSecret: "abcdefghijklmnopqrstuvwxyz123456",
      keyVersion: 8,
      legacyMasterSecretsByVersion: {
        7: "12345678901234567890123456789012",
      },
    });

    const rotationResponse = rotatedHarness.service.rotateCredentialEnvelopes({
      organizationId,
    });

    expect(rotationResponse.rotatedConnectionCount).toBe(1);
    expect(
      rotatedHarness.service.validateConnection({
        organizationId,
        connectionId: rotationResponse.state.connections[0]!.id,
      }).healthCheck.status,
    ).toBe("healthy");

    const persistedSnapshot = readFileSync(
      join(initialHarness.storePath, `${organizationId}.json`),
      "utf8",
    );

    expect(persistedSnapshot).toContain("\"keyVersion\": 8");
    expect(persistedSnapshot).not.toContain("\"keyVersion\": 7");
  });

  it("degrades telephony connections safely when persisted secrets can no longer be decrypted", () => {
    const organizationId = "tenant-west-africa";
    const initialHarness = createHarness({
      masterSecret: "12345678901234567890123456789012",
      keyVersion: 1,
    });

    initialHarness.service.createConnection({
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
    const recoveredState = restartedService.getState(organizationId);

    expect(recoveredState.connections[0]).toMatchObject({
      status: "degraded",
      healthStatus: "failed",
    });
    expect(recoveredState.connections[0]?.credentialReference?.preview).toBe("unavailable");
    expect(recoveredState.healthChecks[0]?.message).toContain("could not be decrypted");
  });

  it("persists scheduled provider heartbeats when a sweep runs across tenant connections", () => {
    const { service, storePath } = createHarness();
    const organizationId = "tenant-west-africa";
    const connectionResponse = service.createConnection({
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

    service.importTwilioNumbers({
      organizationId,
      connectionId: connectionResponse.connection.id,
    });
    const numberId = service.getState(organizationId).phoneNumbers[0]!.id;
    service.assignNumberRoute({
      organizationId,
      numberId,
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-support",
    });

    const sweepResponse = service.runScheduledHeartbeatSweep();

    expect(sweepResponse.heartbeats).toHaveLength(1);
    expect(sweepResponse.heartbeats[0]).toMatchObject({
      scheduled: true,
      connectionId: connectionResponse.connection.id,
      status: "healthy",
    });

    const restartedService = recreateHarness(storePath).service;
    expect(restartedService.getState(organizationId).providerHeartbeats[0]).toMatchObject({
      scheduled: true,
      connectionId: connectionResponse.connection.id,
    });
  });

  it("recovers from a corrupt tenant snapshot by quarantining the broken file and starting empty", () => {
    const { storePath } = createHarness();
    const organizationId = "tenant-west-africa";

    mkdirSync(storePath, { recursive: true });
    writeFileSync(join(storePath, `${organizationId}.json`), "{\"broken\":", "utf8");

    const service = recreateHarness(storePath).service;
    const recoveredState = service.getState(organizationId);

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
  }) {
    tempDirectory = mkdtempSync(join(tmpdir(), "zara-telephony-"));
    const storePath = join(tempDirectory, "telephony-store");
    const secretVault = new TelephonySecretVault({
      masterSecret: input?.masterSecret ?? "12345678901234567890123456789012",
      keyVersion: input?.keyVersion ?? 1,
      legacyMasterSecretsByVersion: input?.legacyMasterSecretsByVersion,
    });
    const repository = new FileTelephonyStateRepository(storePath);

    return {
      storePath,
      service: new TelephonyService(repository, secretVault),
    };
  }

  function recreateHarness(
    storePath: string,
    input?: {
      masterSecret?: string;
      keyVersion?: number;
      legacyMasterSecretsByVersion?: Record<number, string>;
    },
  ) {
    const secretVault = new TelephonySecretVault({
      masterSecret: input?.masterSecret ?? "12345678901234567890123456789012",
      keyVersion: input?.keyVersion ?? 1,
      legacyMasterSecretsByVersion: input?.legacyMasterSecretsByVersion,
    });
    const repository = new FileTelephonyStateRepository(storePath);

    return {
      storePath,
      service: new TelephonyService(repository, secretVault),
    };
  }
});
