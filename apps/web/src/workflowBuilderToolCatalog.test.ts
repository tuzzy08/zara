import { describe, expect, it } from "vitest";

import {
  createToolConfigFromCatalogItem,
  getIntegrationOptionsForConnector,
  getToolCatalogItem,
  getToolProviderOptions,
} from "./workflowBuilderToolCatalog";

describe("workflow builder tool catalog", () => {
  it("groups all Zendesk ticket tools under the Zendesk provider", () => {
    const zendeskProvider = getToolProviderOptions().find((provider) => provider.connector === "zendesk");

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

  it("uses Zara-owned connector metadata without fake default connections", () => {
    const createTicket = getToolCatalogItem("zendesk.tickets.create");

    expect(createTicket).toBeDefined();

    const config = createToolConfigFromCatalogItem(createTicket!);

    expect(config.connectionStatus).toBe("missing");
    expect(config.integrationConnectionId).toBeUndefined();
    expect(config.request.url).toBe(
      "/organizations/{{tenant.id}}/integrations/connectors/zendesk/tools/zendesk.tickets.create/execute",
    );
    expect(config.request.url).not.toContain("api.zendesk.com");
  });

  it("lists only real tenant connections for a connector and preserves the selected binding", () => {
    const options = getIntegrationOptionsForConnector("zendesk", {
      connections: [
        {
          id: "zendesk-prod",
          provider: "zendesk",
          status: "connected",
          scopes: ["tickets:read", "tickets:write"],
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
