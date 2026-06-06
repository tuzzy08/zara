import { describe, expect, it } from "vitest";
import { getIntegrationProviderCatalog, type ToolNodeConfig } from "@zara/core";

import {
  createWorkflowToolCatalog,
  createToolConfigFromCatalogItem,
  getIntegrationOptionsForConnector,
  getToolCatalogItem,
  getToolProviderOptions,
} from "./workflowBuilderToolCatalog";

describe("workflow builder tool catalog", () => {
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
