import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileIntegrationStateRepository } from "./integrations-state.repository";
import { IntegrationSecretVault } from "./integrations-secret-vault";
import { IntegrationsService } from "./integrations.service";
import type { IntegrationOAuthProviderClient } from "./oauth-provider-client";
import { WebhookHttpToolsService } from "./webhook-http-tools.service";

let tempDirectory = "";

describe("integrations persistence and OAuth credential storage", () => {
  afterEach(() => {
    if (tempDirectory.length > 0) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = "";
    }
  });

  it("persists OAuth connections across service instances and encrypts provider tokens at rest", async () => {
    const { service, storePath, providerClient } = createHarness({
      keyVersion: 5,
    });

    const connect = await service.startOAuthConnect("tenant-west-africa", "zendesk", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/zendesk/callback",
      requestedScopes: ["tickets:read", "tickets:write"],
      now: "2026-05-16T10:00:00.000Z",
    });

    const connection = await service.completeOAuthCallback({
      provider: "zendesk",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "zendesk-oauth-code-123456",
      now: "2026-05-16T10:01:00.000Z",
    });

    expect(providerClient.exchanges).toEqual([
      {
        provider: "zendesk",
        code: "zendesk-oauth-code-123456",
        redirectUri: "http://127.0.0.1:4173/integrations/zendesk/callback",
      },
    ]);
    expect(connection.credentialReference.preview).toBe("...7890");
    expect(connection).not.toHaveProperty("accessToken");
    expect(connection).not.toHaveProperty("refreshToken");
    expect(existsSync(join(storePath, "tenant-west-africa.json"))).toBe(true);

    const persistedSnapshot = readFileSync(join(storePath, "tenant-west-africa.json"), "utf8");

    expect(persistedSnapshot).not.toContain("zendesk-access-token-7890");
    expect(persistedSnapshot).not.toContain("zendesk-refresh-token-2468");
    expect(persistedSnapshot).not.toContain("zendesk-oauth-code-123456");
    expect(persistedSnapshot).toContain("\"keyVersion\": 5");
    expect(persistedSnapshot).toContain("\"algorithm\": \"aes-256-gcm\"");

    const restarted = recreateHarness(storePath);
    const connections = await restarted.service.listConnections("tenant-west-africa");

    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      id: connection.id,
      organizationId: "tenant-west-africa",
      provider: "zendesk",
      status: "connected",
      connectedBy: "user-ops-lead",
      scopes: ["tickets:read", "tickets:write"],
    });
    expect(connections[0]?.credentialReference.preview).toBe("...7890");
  });

  it("persists webhook HTTP tool schemas while encrypting auth tokens at rest", async () => {
    const { webhookToolsService, storePath } = createHarness({
      keyVersion: 7,
    });

    const webhookTool = await webhookToolsService.createWebhookTool("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-operations",
      toolName: "Notify fulfillment",
      method: "POST",
      url: "https://hooks.example.test/fulfillment/notify",
      headers: [{ name: "content-type", value: "application/json" }],
      bodyTemplate: '{"message":"{{turn.transcript}}"}',
      authToken: "webhook-token-super-secret-5678",
      timeoutMs: 2_500,
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 50,
      },
      now: "2026-05-16T12:00:00.000Z",
    });

    const persistedSnapshot = readFileSync(join(storePath, "tenant-west-africa.json"), "utf8");

    expect(persistedSnapshot).not.toContain("webhook-token-super-secret-5678");
    expect(persistedSnapshot).toContain("\"keyVersion\": 7");
    expect(persistedSnapshot).toContain("\"algorithm\": \"aes-256-gcm\"");

    const restarted = recreateHarness(storePath, {
      keyVersion: 7,
    });
    const listedTools = await restarted.webhookToolsService.listWebhookTools({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-operations",
    });
    const resolvedToken = await restarted.webhookToolsService.resolveWebhookAuthToken({
      organizationId: "tenant-west-africa",
      toolId: webhookTool.toolId,
      authTokenReference: webhookTool.request.authTokenReference!,
    });

    expect(listedTools).toHaveLength(1);
    expect(listedTools[0]).toMatchObject({
      toolId: webhookTool.toolId,
      provider: "webhook-http",
      workspaceId: "workspace-operations",
      request: {
        authTokenReference: webhookTool.request.authTokenReference,
        timeoutMs: 2_500,
        retryPolicy: {
          maxAttempts: 2,
          backoffMs: 50,
        },
      },
    });
    expect(listedTools[0]?.request).not.toHaveProperty("authToken");
    expect(resolvedToken).toBe("webhook-token-super-secret-5678");
  });
});

function createHarness(input?: { keyVersion?: number }) {
  tempDirectory = mkdtempSync(join(tmpdir(), "zara-integrations-"));
  const storePath = join(tempDirectory, "integrations-store");

  return recreateHarness(storePath, input);
}

function recreateHarness(storePath: string, input?: { keyVersion?: number }) {
  const providerClient = new FakeIntegrationOAuthProviderClient();
  const stateRepository = new FileIntegrationStateRepository(storePath);
  const secretVault = new IntegrationSecretVault({
    masterSecret: "integration-secret-123456789012345678",
    keyVersion: input?.keyVersion ?? 5,
  });
  const service = new IntegrationsService(
    stateRepository,
    secretVault,
    providerClient,
  );
  const webhookToolsService = new WebhookHttpToolsService(stateRepository, secretVault);

  return {
    service,
    webhookToolsService,
    storePath,
    providerClient,
  };
}

class FakeIntegrationOAuthProviderClient implements IntegrationOAuthProviderClient {
  readonly exchanges: Array<{
    provider: string;
    code: string;
    redirectUri: string;
  }> = [];

  async exchangeAuthorizationCode(input: Parameters<IntegrationOAuthProviderClient["exchangeAuthorizationCode"]>[0]) {
    this.exchanges.push({
      provider: input.provider,
      code: input.code,
      redirectUri: input.redirectUri,
    });

    return {
      accessToken: `${input.provider}-access-token-7890`,
      refreshToken: `${input.provider}-refresh-token-2468`,
      externalAccountId: `${input.provider}-account-1`,
    };
  }
}
