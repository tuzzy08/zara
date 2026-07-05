import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompiledRuntimeManifest, CompiledRuntimeToolBinding } from "@zara/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileIntegrationStateRepository,
  type PersistedIntegrationStateRecord,
} from "./integrations-state.repository";
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

  it("stores connector tool grants with concrete agentId scopes", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connection = await integrationsService.configureZendeskApiToken("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      connectionScope: "workspace",
      subdomain: "roylessolutions",
      email: "support@roylessolutions.example",
      apiToken: "zendesk-api-token-123456",
      now: "2026-06-12T08:00:00.000Z",
    });
    const request = {
      actorUserId: "user-ops-lead",
      actorRole: "admin" as const,
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "zendesk.tickets.search",
      integrationConnectionId: connection.id,
      risk: "low" as const,
      approvalRequired: false,
      now: "2026-06-12T08:01:00.000Z",
    };

    const grant = await grantsService.grantToolPermission("tenant-west-africa", request);
    const grants = await grantsService.listToolPermissionGrants({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-customer-success",
    });

    expect(grant).toMatchObject({
      agentId: "agent-support",
      toolId: "zendesk.tickets.search",
    });
    expect(grant).not.toHaveProperty("roleId");
    expect(grants).toEqual([
      expect.objectContaining({
        agentId: "agent-support",
        toolId: "zendesk.tickets.search",
      }),
    ]);
    expect(grants[0]).not.toHaveProperty("roleId");
  });

  it("rejects legacy Zendesk API-token connections without persisted availability with a reconnect prompt", async () => {
    const { grantsService, repository } = createHarness();
    await repository.save({
      schemaVersion: 1,
      organizationId: "tenant-west-africa",
      pendingConnects: [],
      connections: [
        {
          id: "integration-zendesk-legacy",
          organizationId: "tenant-west-africa",
          provider: "zendesk",
          status: "connected",
          connectedBy: "user-ops-lead",
          scopes: ["tickets:read", "tickets:write"],
          credentialReference: {
            id: "credential-zendesk-legacy",
            provider: "zendesk",
            kind: "api-token",
            preview: "support@example.com / ...3456",
          },
          accountLabel: "roylessolutions.zendesk.com",
          connectedAt: "2026-06-10T19:00:00.000Z",
          health: {
            status: "unknown",
          },
          auditEvents: [],
        },
      ],
      credentials: [
        {
          connectionId: "integration-zendesk-legacy",
        },
      ],
      toolGrants: [],
    } as unknown as PersistedIntegrationStateRecord);

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-customer-success",
        agentId: "agent-support",
        toolId: "zendesk.tickets.search",
        integrationConnectionId: "integration-zendesk-legacy",
        risk: "low",
        approvalRequired: false,
        now: "2026-06-10T19:10:00.000Z",
      }),
    ).rejects.toThrow("Integration connection is missing scope metadata. Reconnect this provider before enabling tool access.");
  });

  it("rejects new workflow-scoped grants", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connection = await integrationsService.configureZendeskApiToken("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      connectionScope: "workspace",
      subdomain: "roylessolutions",
      email: "support@roylessolutions.example",
      apiToken: "zendesk-api-token-123456",
      now: "2026-06-12T08:00:00.000Z",
    });

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-customer-success",
        workflowId: "workflow-support-zendesk-v1",
        agentId: "agent-support",
        toolId: "zendesk.tickets.search",
        integrationConnectionId: connection.id,
        risk: "low",
        approvalRequired: false,
      } as Parameters<ToolPermissionGrantsService["grantToolPermission"]>[1] & { workflowId: string }),
    ).rejects.toThrow("Workflow-scoped tool grants are no longer supported.");
  });

  it("drops persisted legacy workflow-scoped grants instead of broadening them", async () => {
    const { integrationsService, grantsService, repository } = createHarness();
    const connection = await integrationsService.configureZendeskApiToken("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      connectionScope: "workspace",
      subdomain: "roylessolutions",
      email: "support@roylessolutions.example",
      apiToken: "zendesk-api-token-123456",
      now: "2026-06-12T08:00:00.000Z",
    });
    const persistedState = await repository.load("tenant-west-africa");

    expect(persistedState).toBeTruthy();
    await repository.save({
      ...persistedState!,
      toolGrants: [
        {
          id: "legacy-workflow-grant",
          organizationId: "tenant-west-africa",
          capability: "agent-tool",
          workspaceId: "workspace-customer-success",
          workflowId: "workflow-support-zendesk-v1",
          agentId: "agent-support",
          toolId: "zendesk.tickets.search",
          integrationConnectionId: connection.id,
          risk: "low",
          requiredScopes: ["tickets:read"],
          approvalRequired: false,
          status: "active",
          grantedBy: "user-ops-lead",
          createdAt: "2026-06-12T08:01:00.000Z",
        },
      ] as unknown as NonNullable<PersistedIntegrationStateRecord["toolGrants"]>,
    });

    await expect(
      grantsService.listToolPermissionGrants({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
      }),
    ).resolves.toEqual([]);
    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          workflowId: "workflow-support-zendesk-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "zendesk.tickets.search",
          integrationConnectionId: connection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "tool_permission_denied",
    });
  });

  it("denies granted tool execution after the integration connection is deleted", async () => {
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
      workspaceId: "workspace-default",
      agentId: "agent-front-desk",
      toolId: "hubspot.profile.lookup",
      integrationConnectionId: connection.id,
      risk: "medium",
      approvalRequired: false,
    });
    await integrationsService.deleteConnection("tenant-west-africa", connection.id, {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      reason: "Compromised token",
      now: "2026-05-17T10:02:00.000Z",
    });

    const decision = await grantsService.evaluateToolExecution({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      activeAgentId: "agent-front-desk",
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
      reason: "tool_permission_denied",
    });
  });

  it("allows draft sandbox execution from workflow-independent connector grants", async () => {
    const { integrationsService, grantsService } = createHarness();
    const zendeskConnection = await integrationsService.configureZendeskApiToken("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      connectionScope: "workspace",
      subdomain: "roylessolutions",
      email: "support@roylessolutions.example",
      apiToken: "zendesk-api-token-123456",
      now: "2026-06-11T21:00:00.000Z",
    });
    const hubspotConnect = await integrationsService.startOAuthConnect("tenant-west-africa", "hubspot", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/hubspot/callback",
      requestedScopes: ["crm.objects.contacts.read"],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-11T21:00:00.000Z",
    });
    const hubspotConnection = await integrationsService.completeOAuthCallback({
      provider: "hubspot",
      state: new URL(hubspotConnect.authorizationUrl).searchParams.get("state")!,
      code: "hubspot-oauth-code-draft-grant",
      now: "2026-06-11T21:01:00.000Z",
    });

    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "zendesk.tickets.search",
      integrationConnectionId: zendeskConnection.id,
      risk: "low",
      approvalRequired: false,
    });
    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "hubspot.profile.lookup",
      integrationConnectionId: hubspotConnection.id,
      risk: "medium",
      approvalRequired: false,
    });

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {} as CompiledRuntimeManifest,
        binding: {
          toolId: "zendesk.tickets.search",
          integrationConnectionId: zendeskConnection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "granted",
    });
    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {} as CompiledRuntimeManifest,
        binding: {
          toolId: "hubspot.profile.lookup",
          integrationConnectionId: hubspotConnection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "granted",
    });
  });

  it("allows runtime execution from workflow-independent grants across published version ids", async () => {
    const { integrationsService, grantsService } = createHarness();
    const zendeskConnection = await integrationsService.configureZendeskApiToken("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      connectionScope: "workspace",
      subdomain: "roylessolutions",
      email: "support@roylessolutions.example",
      apiToken: "zendesk-api-token-123456",
      now: "2026-06-12T07:00:00.000Z",
    });
    const hubspotConnect = await integrationsService.startOAuthConnect("tenant-west-africa", "hubspot", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/hubspot/callback",
      requestedScopes: ["crm.objects.contacts.read"],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-12T07:00:00.000Z",
    });
    const hubspotConnection = await integrationsService.completeOAuthCallback({
      provider: "hubspot",
      state: new URL(hubspotConnect.authorizationUrl).searchParams.get("state")!,
      code: "hubspot-oauth-code-runtime-grant",
      now: "2026-06-12T07:01:00.000Z",
    });

    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "zendesk.tickets.search",
      integrationConnectionId: zendeskConnection.id,
      risk: "low",
      approvalRequired: false,
    });
    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "hubspot.profile.lookup",
      integrationConnectionId: hubspotConnection.id,
      risk: "medium",
      approvalRequired: false,
    });

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-support-triage-v3",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "zendesk.tickets.search",
          integrationConnectionId: zendeskConnection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "granted",
    });
    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-support-triage-v3",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "hubspot.profile.lookup",
          integrationConnectionId: hubspotConnection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "granted",
    });
  });

  it("allows runtime execution from integration-scoped agent tool grants without a workflow id", async () => {
    const { integrationsService, grantsService } = createHarness();
    const zendeskConnection = await integrationsService.configureZendeskApiToken("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      connectionScope: "workspace",
      subdomain: "roylessolutions",
      email: "support@roylessolutions.example",
      apiToken: "zendesk-api-token-123456",
      now: "2026-06-12T08:00:00.000Z",
    });

    const grant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "zendesk.tickets.search",
      integrationConnectionId: zendeskConnection.id,
      risk: "low",
      approvalRequired: false,
      now: "2026-06-12T08:01:00.000Z",
    } as Parameters<ToolPermissionGrantsService["grantToolPermission"]>[1]);

    expect(grant).toMatchObject({
      agentId: "agent-support",
      toolId: "zendesk.tickets.search",
      integrationConnectionId: zendeskConnection.id,
    });
    expect(grant).not.toHaveProperty("workflowId");

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-support-triage-v3",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "zendesk.tickets.search",
          integrationConnectionId: zendeskConnection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "granted",
    });
  });

  it("auto-creates integration-scoped agent grants during publish instead of workflow-scoped grants", async () => {
    const { integrationsService, grantsService, repository } = createHarness();
    const zendeskConnection = await integrationsService.configureZendeskApiToken("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      connectionScope: "workspace",
      subdomain: "roylessolutions",
      email: "support@roylessolutions.example",
      apiToken: "zendesk-api-token-123456",
      now: "2026-06-12T09:00:00.000Z",
    });
    const toolBinding = {
      nodeId: "agent-support:assignment-zendesk-tickets-search",
      toolId: "zendesk.tickets.search",
      integrationConnectionId: zendeskConnection.id,
      risk: "low",
      requiresHumanApproval: false,
    };
    const agentAssignment = {
      id: toolBinding.nodeId,
      agentId: "agent-support",
      toolId: "zendesk.tickets.search",
    };

    await grantsService.ensureToolGrantsForPublish({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-customer-success",
      actorUserId: "user-ops-lead",
      now: "2026-06-12T09:01:00.000Z",
      manifest: {
        publishedVersionId: "workflow-support-zendesk-v2",
        toolBindings: [toolBinding],
        agentToolAssignments: [agentAssignment],
      } as CompiledRuntimeManifest,
    });

    const persistedState = await repository.load("tenant-west-africa");
    expect(persistedState?.toolGrants).toEqual([
      expect.objectContaining({
        agentId: "agent-support",
        toolId: "zendesk.tickets.search",
        integrationConnectionId: zendeskConnection.id,
        status: "active",
      }),
    ]);
    expect(persistedState?.toolGrants?.[0]).not.toHaveProperty("workflowId");

    await expect(
      grantsService.validateToolGrantsForPublish({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        manifest: {
          publishedVersionId: "workflow-support-zendesk-copy-v1",
          toolBindings: [toolBinding],
          agentToolAssignments: [agentAssignment],
        } as CompiledRuntimeManifest,
      }),
    ).resolves.toEqual({
      ok: true,
      errors: [],
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
      workspaceId: "workspace-customer-success",
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
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
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
        workspaceId: "workspace-customer-success",
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
      workspaceId: "workspace-growth",
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

  it("validates Salesforce additive write grants with approval posture and missing OAuth scopes", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "salesforce", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/salesforce/callback",
      requestedScopes: ["api", "refresh_token"],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-06T09:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "salesforce",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "salesforce-oauth-code-grants",
      now: "2026-06-06T09:01:00.000Z",
    });

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-builder",
        actorRole: "builder",
        workspaceId: "workspace-customer-success",
        agentId: "agent-support",
        toolId: "salesforce.tasks.create",
        integrationConnectionId: connection.id,
        risk: "medium",
        approvalRequired: true,
      }),
    ).rejects.toThrow("Tenant admin access is required to grant tool permissions.");

    const grant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "salesforce.tasks.create",
      integrationConnectionId: connection.id,
      risk: "medium",
      approvalRequired: true,
    });

    expect(grant).toMatchObject({
      capability: "agent-tool",
      toolId: "salesforce.tasks.create",
      requiredScopes: ["api", "refresh_token"],
      approvalRequired: true,
    });

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-salesforce-follow-up-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "salesforce.tasks.create",
          integrationConnectionId: connection.id,
          requiresHumanApproval: true,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: true,
      reason: "granted",
    });

    const insufficientScopeConnect = await integrationsService.startOAuthConnect("tenant-west-africa", "salesforce", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/salesforce/callback",
      requestedScopes: ["api"],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-06T10:00:00.000Z",
    });
    const insufficientScopeConnection = await integrationsService.completeOAuthCallback({
      provider: "salesforce",
      state: new URL(insufficientScopeConnect.authorizationUrl).searchParams.get("state")!,
      code: "salesforce-oauth-code-missing-refresh",
      now: "2026-06-06T10:01:00.000Z",
    });

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-customer-success",
        agentId: "agent-support",
        toolId: "salesforce.call_notes.create",
        integrationConnectionId: insufficientScopeConnection.id,
        risk: "medium",
        approvalRequired: true,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        reconnect: expect.objectContaining({
          provider: "salesforce",
          missingScopes: ["refresh_token"],
        }),
      }),
    });
  });

  it("validates Slack bounded notification grants with approval posture and missing OAuth scopes", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "slack", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/slack/callback",
      requestedScopes: ["chat:write"],
      connectionScope: "organization",
      now: "2026-06-06T11:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "slack",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "slack-oauth-code-grants",
      now: "2026-06-06T11:01:00.000Z",
    });

    const grant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "slack.escalations.post",
      integrationConnectionId: connection.id,
      risk: "medium",
      approvalRequired: true,
    });

    expect(grant).toMatchObject({
      capability: "agent-tool",
      toolId: "slack.escalations.post",
      requiredScopes: ["chat:write"],
      approvalRequired: true,
    });

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-slack-escalation-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "slack.escalations.post",
          integrationConnectionId: connection.id,
          requiresHumanApproval: true,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: true,
      reason: "granted",
    });

    const insufficientScopeConnect = await integrationsService.startOAuthConnect("tenant-west-africa", "slack", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/slack/callback",
      requestedScopes: ["channels:read"],
      connectionScope: "organization",
      now: "2026-06-06T12:00:00.000Z",
    });
    const insufficientScopeConnection = await integrationsService.completeOAuthCallback({
      provider: "slack",
      state: new URL(insufficientScopeConnect.authorizationUrl).searchParams.get("state")!,
      code: "slack-oauth-code-missing-chat-write",
      now: "2026-06-06T12:01:00.000Z",
    });

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-customer-success",
        agentId: "agent-support",
        toolId: "slack.call_summaries.post",
        integrationConnectionId: insufficientScopeConnection.id,
        risk: "medium",
        approvalRequired: true,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        reconnect: expect.objectContaining({
          provider: "slack",
          missingScopes: ["chat:write"],
        }),
      }),
    });
  });

  it("validates Microsoft 365 calendar grants with minimal scopes and approval posture", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "microsoft-365", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/microsoft-365/callback",
      requestedScopes: ["Calendars.ReadBasic", "Calendars.ReadWrite"],
      connectionScope: "organization",
      now: "2026-06-07T09:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "microsoft-365",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "microsoft-365-oauth-code-grants",
      now: "2026-06-07T09:01:00.000Z",
    });

    const availabilityGrant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "microsoft365.calendar.availability.read",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
    });
    const eventGrant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "microsoft365.calendar.events.create",
      integrationConnectionId: connection.id,
      risk: "medium",
      approvalRequired: true,
    });

    expect(availabilityGrant).toMatchObject({
      capability: "agent-tool",
      toolId: "microsoft365.calendar.availability.read",
      requiredScopes: ["Calendars.ReadBasic"],
      approvalRequired: false,
    });
    expect(eventGrant).toMatchObject({
      capability: "agent-tool",
      toolId: "microsoft365.calendar.events.create",
      requiredScopes: ["Calendars.ReadWrite"],
      approvalRequired: true,
    });

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-outlook-scheduler-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "microsoft365.calendar.availability.read",
          integrationConnectionId: connection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "granted",
    });
    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-outlook-scheduler-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "microsoft365.calendar.events.create",
          integrationConnectionId: connection.id,
          requiresHumanApproval: true,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: true,
      reason: "granted",
    });

    const insufficientScopeConnect = await integrationsService.startOAuthConnect("tenant-west-africa", "microsoft-365", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/microsoft-365/callback",
      requestedScopes: ["Calendars.ReadBasic"],
      connectionScope: "organization",
      now: "2026-06-07T10:00:00.000Z",
    });
    const insufficientScopeConnection = await integrationsService.completeOAuthCallback({
      provider: "microsoft-365",
      state: new URL(insufficientScopeConnect.authorizationUrl).searchParams.get("state")!,
      code: "microsoft-365-oauth-code-missing-readwrite",
      now: "2026-06-07T10:01:00.000Z",
    });

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-customer-success",
        agentId: "agent-support",
        toolId: "microsoft365.calendar.events.create",
        integrationConnectionId: insufficientScopeConnection.id,
        risk: "medium",
        approvalRequired: true,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        reconnect: expect.objectContaining({
          provider: "microsoft-365",
          missingScopes: ["Calendars.ReadWrite"],
        }),
      }),
    });
  });

  it("validates Intercom lookup and internal-note grants with scoped OAuth requirements", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "intercom", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/intercom/callback",
      requestedScopes: ["read_users", "read_companies", "read_conversations", "write_conversations"],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-07T11:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "intercom",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "intercom-oauth-code-grants",
      now: "2026-06-07T11:01:00.000Z",
    });

    const lookupGrant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "intercom.users.lookup",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
    });
    const noteGrant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "intercom.internal_notes.create",
      integrationConnectionId: connection.id,
      risk: "medium",
      approvalRequired: true,
    });

    expect(lookupGrant).toMatchObject({
      capability: "agent-tool",
      toolId: "intercom.users.lookup",
      requiredScopes: ["read_users"],
      approvalRequired: false,
    });
    expect(noteGrant).toMatchObject({
      capability: "agent-tool",
      toolId: "intercom.internal_notes.create",
      requiredScopes: ["write_conversations"],
      approvalRequired: true,
    });

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-intercom-support-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "intercom.users.lookup",
          integrationConnectionId: connection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "granted",
    });
    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-intercom-support-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "intercom.internal_notes.create",
          integrationConnectionId: connection.id,
          requiresHumanApproval: true,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: true,
      reason: "granted",
    });

    const insufficientScopeConnect = await integrationsService.startOAuthConnect("tenant-west-africa", "intercom", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/intercom/callback",
      requestedScopes: ["read_users"],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-07T12:00:00.000Z",
    });
    const insufficientScopeConnection = await integrationsService.completeOAuthCallback({
      provider: "intercom",
      state: new URL(insufficientScopeConnect.authorizationUrl).searchParams.get("state")!,
      code: "intercom-oauth-code-missing-write",
      now: "2026-06-07T12:01:00.000Z",
    });

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-customer-success",
        agentId: "agent-support",
        toolId: "intercom.call_summaries.create",
        integrationConnectionId: insufficientScopeConnection.id,
        risk: "medium",
        approvalRequired: true,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        reconnect: expect.objectContaining({
          provider: "intercom",
          missingScopes: ["write_conversations"],
        }),
      }),
    });
  });

  it("validates Shopify read-only commerce grants with scoped OAuth requirements", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "shopify", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/shopify/callback",
      requestedScopes: ["read_customers", "read_orders", "read_fulfillments"],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      shopDomain: "tuzzy-store.myshopify.com",
      now: "2026-06-05T17:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "shopify",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "shopify-oauth-code-grants",
      now: "2026-06-05T17:01:00.000Z",
    });

    const customerGrant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-commerce",
      toolId: "shopify.customers.lookup",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
      now: "2026-06-05T17:02:00.000Z",
    });
    const shippingGrant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-commerce",
      toolId: "shopify.shipping_status.lookup",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
      now: "2026-06-05T17:03:00.000Z",
    });

    expect(customerGrant).toMatchObject({
      toolId: "shopify.customers.lookup",
      requiredScopes: ["read_customers"],
      approvalRequired: false,
    });
    expect(shippingGrant).toMatchObject({
      toolId: "shopify.shipping_status.lookup",
      requiredScopes: ["read_orders", "read_fulfillments"],
      approvalRequired: false,
    });

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-commerce",
        manifest: {
          publishedVersionId: "workflow-shopify-support-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "shopify.shipping_status.lookup",
          integrationConnectionId: connection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "granted",
    });

    const insufficientScopeConnect = await integrationsService.startOAuthConnect("tenant-west-africa", "shopify", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/shopify/callback",
      requestedScopes: ["read_orders"],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      shopDomain: "tuzzy-store.myshopify.com",
      now: "2026-06-05T17:04:00.000Z",
    });
    const insufficientScopeConnection = await integrationsService.completeOAuthCallback({
      provider: "shopify",
      state: new URL(insufficientScopeConnect.authorizationUrl).searchParams.get("state")!,
      code: "shopify-oauth-code-missing-fulfillments",
      now: "2026-06-05T17:05:00.000Z",
    });

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-customer-success",
        agentId: "agent-commerce",
        toolId: "shopify.shipping_status.lookup",
        integrationConnectionId: insufficientScopeConnection.id,
        risk: "low",
        approvalRequired: false,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        reconnect: expect.objectContaining({
          provider: "shopify",
          missingScopes: ["read_fulfillments"],
        }),
      }),
    });
  });

  it("validates Stripe read-only billing grants with scoped OAuth requirements", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "stripe", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/stripe/callback",
      requestedScopes: ["read_only"],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-05T18:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "stripe",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "stripe-oauth-code-grants",
      now: "2026-06-05T18:01:00.000Z",
    });

    const customerGrant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-billing",
      toolId: "stripe.customers.lookup",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
      now: "2026-06-05T18:02:00.000Z",
    });
    const paymentGrant = await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-billing",
      toolId: "stripe.payment_status.lookup",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
      now: "2026-06-05T18:03:00.000Z",
    });

    expect(customerGrant).toMatchObject({
      toolId: "stripe.customers.lookup",
      requiredScopes: ["read_only"],
      approvalRequired: false,
    });
    expect(paymentGrant).toMatchObject({
      toolId: "stripe.payment_status.lookup",
      requiredScopes: ["read_only"],
      approvalRequired: false,
    });

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-billing",
        manifest: {
          publishedVersionId: "workflow-stripe-billing-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "stripe.payment_status.lookup",
          integrationConnectionId: connection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "granted",
    });

    const insufficientScopeConnect = await integrationsService.startOAuthConnect("tenant-west-africa", "stripe", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/stripe/callback",
      requestedScopes: [],
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-05T18:04:00.000Z",
    });
    const insufficientScopeConnection = await integrationsService.completeOAuthCallback({
      provider: "stripe",
      state: new URL(insufficientScopeConnect.authorizationUrl).searchParams.get("state")!,
      code: "stripe-oauth-code-missing-read",
      now: "2026-06-05T18:05:00.000Z",
    });

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-customer-success",
        agentId: "agent-billing",
        toolId: "stripe.payment_status.lookup",
        integrationConnectionId: insufficientScopeConnection.id,
        risk: "low",
        approvalRequired: false,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        reconnect: expect.objectContaining({
          provider: "stripe",
          missingScopes: ["read_only"],
        }),
      }),
    });
  });

  it("requires active agent-tool grants for every assigned agent during publish", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "hubspot", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/hubspot/callback",
      requestedScopes: ["crm.objects.contacts.read"],
      now: "2026-06-05T10:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "hubspot",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "hubspot-oauth-code-role-grant",
      now: "2026-06-05T10:01:00.000Z",
    });

    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "hubspot.profile.lookup",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
    });
    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      capability: "post-call-sync",
      workspaceId: "workspace-customer-success",
      agentId: "agent-billing",
      toolId: "hubspot.profile.lookup",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
    });

    const manifest = {
      publishedVersionId: "workflow-support-profile-v1",
      toolBindings: [
        {
          nodeId: "tool-profile",
          toolId: "hubspot.profile.lookup",
          integrationConnectionId: connection.id,
          requiresHumanApproval: false,
        },
      ],
      agentToolAssignments: [
        {
          id: "tool-profile",
          agentId: "agent-support",
          toolId: "hubspot.profile.lookup",
        },
        {
          id: "tool-profile",
          agentId: "agent-billing",
          toolId: "hubspot.profile.lookup",
        },
      ],
    } as CompiledRuntimeManifest;

    await expect(
      grantsService.validateToolGrantsForPublish({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        manifest,
      }),
    ).resolves.toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "tool_permission_denied",
          nodeId: "tool-profile",
          missingAgentIds: ["agent-billing"],
        }),
      ],
    });
  });

  it("keeps separate grants for each integration capability on the same tool binding", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "notion", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/notion/callback",
      requestedScopes: ["search:read"],
      now: "2026-06-05T11:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "notion",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "notion-oauth-code-capability-grants",
      now: "2026-06-05T11:01:00.000Z",
    });

    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      capability: "agent-tool",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "notion.knowledge.search",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
    });
    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      capability: "knowledge-source",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "notion.knowledge.search",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
    });

    await expect(
      grantsService.listToolPermissionGrants({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        capability: "knowledge-source",
        toolId: "notion.knowledge.search",
      }),
      expect.objectContaining({
        capability: "agent-tool",
        toolId: "notion.knowledge.search",
      }),
    ]);
  });

  it("does not allow runtime tool execution from a non-agent capability grant", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "notion", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/notion/callback",
      requestedScopes: ["search:read"],
      now: "2026-06-05T12:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "notion",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "notion-oauth-code-runtime-capability",
      now: "2026-06-05T12:01:00.000Z",
    });

    await grantsService.grantToolPermission("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      capability: "knowledge-source",
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
      toolId: "notion.knowledge.search",
      integrationConnectionId: connection.id,
      risk: "low",
      approvalRequired: false,
    });

    await expect(
      grantsService.evaluateToolExecution({
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        activeAgentId: "agent-support",
        manifest: {
          publishedVersionId: "workflow-support-knowledge-v1",
        } as CompiledRuntimeManifest,
        binding: {
          toolId: "notion.knowledge.search",
          integrationConnectionId: connection.id,
          requiresHumanApproval: false,
        } as CompiledRuntimeToolBinding,
      }),
    ).resolves.toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "tool_permission_denied",
    });
  });

  it("rejects capability grants that the connection provider does not support", async () => {
    const { integrationsService, grantsService } = createHarness();
    const connect = await integrationsService.startOAuthConnect("tenant-west-africa", "hubspot", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: "http://127.0.0.1:4173/integrations/hubspot/callback",
      requestedScopes: ["crm.objects.contacts.read"],
      now: "2026-06-05T13:00:00.000Z",
    });
    const connection = await integrationsService.completeOAuthCallback({
      provider: "hubspot",
      state: new URL(connect.authorizationUrl).searchParams.get("state")!,
      code: "hubspot-oauth-code-unsupported-capability",
      now: "2026-06-05T13:01:00.000Z",
    });

    await expect(
      grantsService.grantToolPermission("tenant-west-africa", {
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        capability: "knowledge-source",
        workspaceId: "workspace-customer-success",
        agentId: "agent-support",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: connection.id,
        risk: "low",
        approvalRequired: false,
      }),
    ).rejects.toThrow("Integration provider does not support this capability.");
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
    repository,
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
