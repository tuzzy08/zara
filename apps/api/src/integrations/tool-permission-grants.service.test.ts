import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompiledRuntimeManifest, CompiledRuntimeToolBinding } from "@zara/core";
import { afterEach, describe, expect, it } from "vitest";

import { FileIntegrationStateRepository } from "./integrations-state.repository";
import { IntegrationSecretVault } from "./integrations-secret-vault";
import { IntegrationsService } from "./integrations.service";
import type { IntegrationOAuthProviderClient } from "./oauth-provider-client";
import { ToolPermissionGrantsService } from "./tool-permission-grants.service";

let tempDirectory = "";

describe("ToolPermissionGrantsService", () => {
  afterEach(() => {
    if (tempDirectory.length > 0) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = "";
    }
  });

  it("denies granted tool execution when the integration connection has been revoked", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "hubspot", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/hubspot/callback",
      requestedScopes: ["crm.objects.contacts.read"],
      now: "2026-05-17T10:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "hubspot",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "hubspot-oauth-code-123456",
      now: "2026-05-17T10:01:00.000Z",
    });

    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-operations",
      workflowId: "workflow-live-sandbox-tool-execution-v1",
      roleId: "agent-front-desk",
      toolId: "hubspot.profile.lookup",
      integrationConnectionId: connection.id,
      risk: "medium",
      approvalRequired: false,
    });
    await integrationsService.revokeConnection("tenant-west-africa", connection.id, {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      reason: "Compromised token",
      now: "2026-05-17T10:02:00.000Z",
    });

    const decision = await grantsService.evaluateToolExecution({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-operations",
      activeRoleId: "agent-front-desk",
      manifest: {
        publishedVersionId: "workflow-live-sandbox-tool-execution-v1",
      } as CompiledRuntimeManifest,
      binding: {
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: connection.id,
        requiresHumanApproval: false,
      } as CompiledRuntimeToolBinding,
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "integration_connection_revoked",
    });
  });
});

function createHarness() {
  tempDirectory = mkdtempSync(join(tmpdir(), "zara-tool-grant-revocation-"));
  const repository = new FileIntegrationStateRepository(join(tempDirectory, "integrations-store"));
  const secretVault = new IntegrationSecretVault({
    masterSecret: "integration-secret-123456789012345678",
    keyVersion: 1,
  });
  const integrationsService = new IntegrationsService(
    repository,
    secretVault,
    new FakeIntegrationOAuthProviderClient(),
  );
  const grantsService = new ToolPermissionGrantsService(repository);

  return {
    integrationsService,
    grantsService,
  };
}

class FakeIntegrationOAuthProviderClient implements IntegrationOAuthProviderClient {
  async exchangeAuthorizationCode(input: Parameters<IntegrationOAuthProviderClient["exchangeAuthorizationCode"]>[0]) {
    return {
      accessToken: `${input.provider}-access-token-7890`,
      refreshToken: `${input.provider}-refresh-token-2468`,
      externalAccountId: `${input.provider}-account-1`,
    };
  }
}
