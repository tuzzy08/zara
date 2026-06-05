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

  it("blocks publish when scoped grants are missing workspace access or provider scopes", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "google-workspace", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/google-workspace/callback",
      requestedScopes: ["calendar.freebusy"],
      connectionScope: "workspace",
      workspaceId: "workspace-support",
      now: "2026-06-05T09:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "google-workspace",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "google-workspace-oauth-code-123456",
      now: "2026-06-05T09:01:00.000Z",
    });

    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-support",
      workflowId: "workflow-support-scheduler-v1",
      roleId: "agent-support",
      toolId: "google.calendar.availability.read",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
    });

    const manifest = {
      publishedVersionId: "workflow-support-scheduler-v1",
      toolBindings: [
        {
          nodeId: "tool-availability",
          toolId: "google.calendar.availability.read",
          integrationConnectionId: connection.id,
          requiresHumanApproval: false,
        },
        {
          nodeId: "tool-event-create",
          toolId: "google.calendar.events.create",
          integrationConnectionId: connection.id,
          requiresHumanApproval: true,
        },
      ],
    } as CompiledRuntimeManifest;

    await expect(
      grantsService.validateToolGrantsForPublish({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-support",
        manifest,
      }),
    ).resolves.toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "integration_connection_missing_scopes",
          nodeId: "tool-event-create",
          missingScopes: ["calendar.events"],
        }),
      ],
    });

    const crossWorkspaceValidation = await grantsService.validateToolGrantsForPublish({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-sales",
      manifest,
    });

    expect(crossWorkspaceValidation.ok).toBe(false);
    expect(crossWorkspaceValidation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "integration_connection_unavailable",
          nodeId: "tool-availability",
        }),
        expect.objectContaining({
          code: "integration_connection_unavailable",
          nodeId: "tool-event-create",
        }),
      ]),
    );
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
