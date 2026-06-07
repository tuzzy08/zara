import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIntegrationProviderCatalog, type ToolNodeConfig } from "@zara/core";

import {
  createWorkflowToolCatalog,
  createToolConfigFromCatalogItem,
  getIntegrationOptionsForConnector,
  getToolCatalogItem,
  getToolProviderOptions,
} from "./workflowBuilderToolCatalog";
import { requestJson } from "./apiClient";
import { startIntegrationConnect } from "./tenantIntegrationsApi";

vi.mock("./apiClient", () => ({
  requestJson: vi.fn(async () => ({
    connect: {
      authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    },
  })),
}));

describe("workflow builder tool catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:4173",
      },
    });
  });

  it("groups all Zendesk ticket tools under the Zendesk provider", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const zendeskProvider = getToolProviderOptions(catalog).find((provider) => provider.connector === "zendesk");

    expect(zendeskProvider?.label).toBe("Zendesk");
    expect(zendeskProvider?.tools.map((tool) => tool.toolId)).toEqual([
      "zendesk.tickets.search",
      "zendesk.tickets.create",
      "zendesk.tickets.update",
    ]);
    expect(zendeskProvider?.tools.map((tool) => tool.toolName)).toEqual([
      "Search tickets",
      "Create ticket",
      "Update ticket",
    ]);
  });

  it("groups Salesforce lookup and additive write tools under the Salesforce provider", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const salesforceProvider = getToolProviderOptions(catalog).find((provider) => provider.connector === "salesforce");

    expect(salesforceProvider?.label).toBe("Salesforce");
    expect(salesforceProvider?.tools.map((tool) => tool.toolId)).toEqual([
      "salesforce.accounts.lookup",
      "salesforce.contacts.lookup",
      "salesforce.cases.lookup",
      "salesforce.tasks.create",
      "salesforce.cases.create",
      "salesforce.call_notes.create",
    ]);

    const createTask = getToolCatalogItem(catalog, "salesforce.tasks.create");
    expect(createTask).toMatchObject({
      connector: "salesforce",
      risk: "medium",
      requiresAuthorization: true,
      requiresHumanApproval: true,
    });
  });

  it("groups Slack bounded write tools under Slack and defaults them to human approval", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const slackProvider = getToolProviderOptions(catalog).find((provider) => provider.connector === "slack");

    expect(slackProvider?.label).toBe("Slack");
    expect(slackProvider?.tools.map((tool) => tool.toolId)).toEqual([
      "slack.escalations.post",
      "slack.alerts.post",
      "slack.call_summaries.post",
    ]);

    for (const toolId of [
      "slack.escalations.post",
      "slack.alerts.post",
      "slack.call_summaries.post",
    ]) {
      expect(getToolCatalogItem(catalog, toolId)).toMatchObject({
        connector: "slack",
        risk: "medium",
        requiresAuthorization: true,
        requiresHumanApproval: true,
      });
    }

    expect(getToolCatalogItem(catalog, "slack.messages.post")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "slack.dms.post")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "slack.conversations.history")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "slack.chat.update")).toBeUndefined();
  });

  it("groups Microsoft 365 Outlook Calendar tools and defaults event creation to approval", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const microsoft365Provider = getToolProviderOptions(catalog).find(
      (provider) => provider.connector === "microsoft-365",
    );

    expect(microsoft365Provider?.label).toBe("Microsoft 365");
    expect(microsoft365Provider?.tools.map((tool) => tool.toolId)).toEqual([
      "microsoft365.calendar.availability.read",
      "microsoft365.calendar.events.create",
    ]);

    expect(getToolCatalogItem(catalog, "microsoft365.calendar.availability.read")).toMatchObject({
      connector: "microsoft-365",
      risk: "low",
      requiresAuthorization: true,
      requiresHumanApproval: false,
    });
    expect(getToolCatalogItem(catalog, "microsoft365.calendar.events.create")).toMatchObject({
      connector: "microsoft-365",
      risk: "medium",
      requiresAuthorization: true,
      requiresHumanApproval: true,
    });

    expect(getToolCatalogItem(catalog, "microsoft365.mail.messages.read")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "microsoft365.mail.messages.send")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "microsoft365.mailbox.search")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "microsoft365.teams.notifications.post")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "microsoft365.calendar.events.update")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "microsoft365.calendar.events.delete")).toBeUndefined();
  });

  it("selects Slack connections only for Slack tool bindings", () => {
    const options = getIntegrationOptionsForConnector("slack", {
      connections: [
        {
          id: "slack-prod",
          provider: "slack",
          status: "connected",
          scopes: ["chat:write"],
          availability: { scope: "workspace", workspaceId: "workspace-support" },
          credentialReference: { kind: "oauth-token", preview: "...slack" },
          accountLabel: "Zara Support Slack",
          connectedAt: "2026-06-05T10:00:00.000Z",
          health: { status: "healthy" },
        },
        {
          id: "salesforce-prod",
          provider: "salesforce",
          status: "connected",
          scopes: ["api", "refresh_token"],
          availability: { scope: "organization" },
          credentialReference: { kind: "oauth-token", preview: "...1234" },
          accountLabel: "Salesforce",
          connectedAt: "2026-06-05T10:00:00.000Z",
          health: { status: "healthy" },
        },
      ],
    });

    expect(options).toEqual([
      { value: "slack-prod", label: "Zara Support Slack", status: "connected" },
    ]);
  });

  it("selects Microsoft 365 connections only for Microsoft 365 tool bindings", () => {
    const options = getIntegrationOptionsForConnector("microsoft-365", {
      connections: [
        {
          id: "microsoft-365-prod",
          provider: "microsoft-365",
          status: "connected",
          scopes: ["Calendars.ReadBasic", "Calendars.ReadWrite"],
          availability: { scope: "workspace", workspaceId: "workspace-support" },
          credentialReference: { kind: "oauth-token", preview: "...m365" },
          accountLabel: "Outlook Calendar",
          connectedAt: "2026-06-05T10:00:00.000Z",
          health: { status: "healthy" },
        },
        {
          id: "google-workspace-prod",
          provider: "google-workspace",
          status: "connected",
          scopes: ["calendar.events"],
          availability: { scope: "organization" },
          credentialReference: { kind: "oauth-token", preview: "...google" },
          accountLabel: "Google Calendar",
          connectedAt: "2026-06-05T10:00:00.000Z",
          health: { status: "healthy" },
        },
      ],
    });

    expect(options).toEqual([
      { value: "microsoft-365-prod", label: "Outlook Calendar", status: "connected" },
    ]);
  });

  it("requests minimal Microsoft 365 Outlook Calendar scopes when starting OAuth", async () => {
    await startIntegrationConnect("tenant-west-africa", "microsoft-365", {
      connectionScope: "workspace",
      workspaceId: "workspace-support",
    });

    expect(requestJson).toHaveBeenCalledWith(
      "/organizations/tenant-west-africa/integrations/microsoft-365/connect",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"requestedScopes":["Calendars.ReadBasic","Calendars.ReadWrite"]'),
      }),
    );
  });

  it("creates built-in tool configs without frontend endpoint or auth metadata", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const createTicket = getToolCatalogItem(catalog, "zendesk.tickets.create");

    expect(createTicket).toBeDefined();

    const config = createToolConfigFromCatalogItem(createTicket!);

    expect(config.connectionStatus).toBe("missing");
    expect(config.integrationConnectionId).toBeUndefined();
    expect(config.request).toBeUndefined();
    expect(JSON.stringify(config)).not.toMatch(/api\.zendesk|authHeader|secretSchema|executor/i);
  });

  it("preserves already-saved workflow tool nodes that predate the catalog IDs", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const savedTool: ToolNodeConfig = {
      connector: "zendesk",
      toolName: "Ticket lookup",
      integrationConnectionId: "zendesk-wa-prod",
      integrationLabel: "Zendesk - West Africa support",
      connectionStatus: "connected",
      risk: "medium",
      requiresAuthorization: true,
      requiresHumanApproval: false,
    };
    const zendeskProvider = getToolProviderOptions(catalog, {
      toolId: "zendesk.search",
      tool: savedTool,
    }).find((provider) => provider.connector === "zendesk");

    expect(zendeskProvider?.tools.map((tool) => tool.toolId)).toEqual([
      "zendesk.search",
      "zendesk.tickets.search",
      "zendesk.tickets.create",
      "zendesk.tickets.update",
    ]);
    expect(zendeskProvider?.tools[0]).toMatchObject({
      toolId: "zendesk.search",
      toolName: "Ticket lookup",
      connector: "zendesk",
    });
  });

  it("lists only real tenant connections for a connector and preserves the selected binding", () => {
    const options = getIntegrationOptionsForConnector("zendesk", {
      connections: [
        {
          id: "zendesk-prod",
          provider: "zendesk",
          status: "connected",
          scopes: ["tickets:read", "tickets:write"],
          availability: { scope: "organization" },
          credentialReference: { kind: "api-token", preview: "support@example.com" },
          accountLabel: "support.zendesk.com",
          connectedAt: "2026-06-04T10:00:00.000Z",
          health: { status: "healthy" },
        },
        {
          id: "hubspot-prod",
          provider: "hubspot",
          status: "connected",
          scopes: ["crm.objects.contacts.read"],
          availability: { scope: "organization" },
          credentialReference: { kind: "oauth-token", preview: "...1234" },
          accountLabel: "HubSpot",
          connectedAt: "2026-06-04T10:00:00.000Z",
          health: { status: "healthy" },
        },
      ],
      selectedConnection: {
        id: "zendesk-legacy",
        label: "Zendesk - Legacy workspace",
        status: "revoked",
      },
    });

    expect(options).toEqual([
      { value: "zendesk-prod", label: "support.zendesk.com", status: "connected" },
      { value: "zendesk-legacy", label: "Zendesk - Legacy workspace", status: "revoked" },
    ]);
  });
});
