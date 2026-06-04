import type { ToolNodeConfig, ToolRequestConfig } from "@zara/core";

import type { IntegrationConnection } from "./tenantIntegrationsApi";

export interface ToolCatalogItem {
  toolId: string;
  toolName: string;
  connector: ToolNodeConfig["connector"];
  risk: ToolNodeConfig["risk"];
  requiresAuthorization: boolean;
  requiresHumanApproval: boolean;
  request: ToolRequestConfig;
}

export interface ToolProviderOption {
  connector: ToolNodeConfig["connector"];
  label: string;
  tools: ToolCatalogItem[];
}

export interface IntegrationOption {
  value: string;
  label: string;
  status: ToolNodeConfig["connectionStatus"];
}

export const toolCatalog: ToolCatalogItem[] = [
  {
    toolId: "zendesk.tickets.search",
    toolName: "Search tickets",
    connector: "zendesk",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: false,
    request: createConnectorToolRequest("zendesk", "zendesk.tickets.search", {
      query: "{{turn.transcript}}",
    }),
  },
  {
    toolId: "zendesk.tickets.create",
    toolName: "Create ticket",
    connector: "zendesk",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: true,
    request: createConnectorToolRequest("zendesk", "zendesk.tickets.create", {
      subject: "Caller follow-up",
      requesterEmail: "{{caller.email}}",
      body: "{{turn.transcript}}",
      priority: "normal",
    }),
  },
  {
    toolId: "zendesk.tickets.update",
    toolName: "Update ticket",
    connector: "zendesk",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: true,
    request: createConnectorToolRequest("zendesk", "zendesk.tickets.update", {
      ticketId: "{{ticket.id}}",
      status: "open",
      comment: "{{turn.transcript}}",
    }),
  },
  {
    toolId: "hubspot.contacts.lookup",
    toolName: "Lookup contact",
    connector: "hubspot",
    risk: "low",
    requiresAuthorization: true,
    requiresHumanApproval: false,
    request: createConnectorToolRequest("hubspot", "hubspot.contacts.lookup", {
      email: "{{caller.email}}",
    }),
  },
  {
    toolId: "hubspot.notes.create",
    toolName: "Create note",
    connector: "hubspot",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: true,
    request: createConnectorToolRequest("hubspot", "hubspot.notes.create", {
      contactId: "{{contact.id}}",
      body: "{{turn.transcript}}",
    }),
  },
  {
    toolId: "hubspot.pipeline.update",
    toolName: "Update pipeline",
    connector: "hubspot",
    risk: "high",
    requiresAuthorization: true,
    requiresHumanApproval: true,
    request: createConnectorToolRequest("hubspot", "hubspot.pipeline.update", {
      dealId: "{{deal.id}}",
      stage: "{{intent.stage}}",
    }),
  },
  {
    toolId: "google.calendar.availability.read",
    toolName: "Read availability",
    connector: "google-workspace",
    risk: "low",
    requiresAuthorization: true,
    requiresHumanApproval: false,
    request: createConnectorToolRequest("google-workspace", "google.calendar.availability.read", {
      calendarId: "primary",
      start: "{{schedule.start}}",
      end: "{{schedule.end}}",
      timezone: "{{caller.timezone}}",
    }),
  },
  {
    toolId: "google.calendar.events.create",
    toolName: "Create calendar event",
    connector: "google-workspace",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: true,
    request: createConnectorToolRequest("google-workspace", "google.calendar.events.create", {
      calendarId: "primary",
      title: "Caller appointment",
      start: "{{schedule.start}}",
      end: "{{schedule.end}}",
      timezone: "{{caller.timezone}}",
      attendeeEmail: "{{caller.email}}",
    }),
  },
  {
    toolId: "notion.knowledge.search",
    toolName: "Search knowledge",
    connector: "notion",
    risk: "low",
    requiresAuthorization: true,
    requiresHumanApproval: false,
    request: createConnectorToolRequest("notion", "notion.knowledge.search", {
      query: "{{turn.transcript}}",
    }),
  },
  {
    toolId: "notion.pages.create",
    toolName: "Create page",
    connector: "notion",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: true,
    request: createConnectorToolRequest("notion", "notion.pages.create", {
      title: "Caller follow-up",
      body: "{{turn.transcript}}",
    }),
  },
  {
    toolId: "notion.tasks.create",
    toolName: "Create task",
    connector: "notion",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: true,
    request: createConnectorToolRequest("notion", "notion.tasks.create", {
      title: "Caller follow-up",
      assigneeEmail: "{{team.assigneeEmail}}",
    }),
  },
  {
    toolId: "webhook.post",
    toolName: "Webhook action",
    connector: "webhook",
    risk: "high",
    requiresAuthorization: false,
    requiresHumanApproval: true,
    request: {
      method: "POST",
      url: "https://hooks.zara.ai/actions",
      authToken: "{{secrets.workflow_webhook_token}}",
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "X-Zara-Tenant", value: "{{tenant.id}}" },
      ],
      bodyTemplate: '{"callId":"{{call.id}}","intent":"{{call.intent}}"}',
    },
  },
];

export const defaultToolCatalogItem = toolCatalog[0]!;

export function getToolProviderOptions(): ToolProviderOption[] {
  return connectorDisplayOrder
    .map((connector) => {
      const tools = toolCatalog.filter((item) => item.connector === connector);

      return tools.length === 0
        ? null
        : {
            connector,
            label: formatToolConnectorLabel(connector),
            tools,
          };
    })
    .filter((option): option is ToolProviderOption => option !== null);
}

export function getToolCatalogItem(toolId: string) {
  return toolCatalog.find((item) => item.toolId === toolId);
}

export function getToolCatalogItemsForConnector(connector: ToolNodeConfig["connector"]) {
  return toolCatalog.filter((item) => item.connector === connector);
}

export function createToolConfigFromCatalogItem(
  catalogItem: ToolCatalogItem,
  integrationConnections: IntegrationConnection[] = [],
): ToolNodeConfig & { request: ToolRequestConfig } {
  const defaultConnection = getDefaultIntegrationOption(catalogItem.connector, integrationConnections);

  return {
    connector: catalogItem.connector,
    toolName: catalogItem.toolName,
    ...(defaultConnection !== undefined && defaultConnection.status !== "missing"
      ? {
          integrationConnectionId: defaultConnection.value,
          integrationLabel: defaultConnection.label,
        }
      : {}),
    connectionStatus: defaultConnection?.status ?? (catalogItem.requiresAuthorization ? "missing" : "connected"),
    risk: catalogItem.risk,
    requiresAuthorization: catalogItem.requiresAuthorization,
    requiresHumanApproval: catalogItem.requiresHumanApproval,
    request: cloneToolRequest(catalogItem.request),
  };
}

export function getIntegrationOptionsForConnector(
  connector: ToolNodeConfig["connector"],
  input: {
    connections: IntegrationConnection[];
    selectedConnection?: { id: string; label: string; status: ToolNodeConfig["connectionStatus"] } | undefined;
  },
): IntegrationOption[] {
  const provider = toIntegrationProvider(connector);

  if (provider === null) {
    return input.selectedConnection === undefined
      ? []
      : [{
          value: input.selectedConnection.id,
          label: input.selectedConnection.label,
          status: input.selectedConnection.status,
        }];
  }

  const options: IntegrationOption[] = input.connections
    .filter((connection) => connection.provider === provider)
    .map((connection) => ({
      value: connection.id,
      label: connection.accountLabel ?? `${formatToolConnectorLabel(connector)} ${connection.credentialReference.preview}`,
      status: connection.status,
    }));

  if (
    input.selectedConnection !== undefined &&
    !options.some((option) => option.value === input.selectedConnection?.id)
  ) {
    options.push({
      value: input.selectedConnection.id,
      label: input.selectedConnection.label,
      status: input.selectedConnection.status,
    });
  }

  return options;
}

export function cloneToolRequest(request: ToolRequestConfig): ToolRequestConfig {
  return {
    method: request.method,
    url: request.url,
    authToken: request.authToken,
    headers: request.headers.map((header) => ({ ...header })),
    ...(request.bodyTemplate !== undefined ? { bodyTemplate: request.bodyTemplate } : {}),
  };
}

export function formatToolConnectorLabel(connector: ToolNodeConfig["connector"]) {
  switch (connector) {
    case "zendesk":
      return "Zendesk";
    case "hubspot":
      return "HubSpot";
    case "google-workspace":
      return "Google Workspace";
    case "notion":
      return "Notion";
    case "webhook":
      return "Webhook";
    case "internal":
      return "Internal";
  }
}

const connectorDisplayOrder: ToolNodeConfig["connector"][] = [
  "zendesk",
  "hubspot",
  "google-workspace",
  "notion",
  "webhook",
  "internal",
];

function createConnectorToolRequest(
  provider: Exclude<IntegrationConnection["provider"], "webhook-http">,
  toolId: string,
  input: Record<string, string>,
): ToolRequestConfig {
  return {
    method: "POST",
    url: `/organizations/{{tenant.id}}/integrations/connectors/${provider}/tools/${toolId}/execute`,
    authToken: "{{integration.connection_token}}",
    headers: [
      { name: "Content-Type", value: "application/json" },
      { name: "X-Zara-Tenant", value: "{{tenant.id}}" },
    ],
    bodyTemplate: JSON.stringify({
      connectionId: "{{integration.connection_id}}",
      input,
    }),
  };
}

function getDefaultIntegrationOption(
  connector: ToolNodeConfig["connector"],
  integrationConnections: IntegrationConnection[],
) {
  return getIntegrationOptionsForConnector(connector, { connections: integrationConnections }).find(
    (option) => option.status === "connected",
  );
}

function toIntegrationProvider(connector: ToolNodeConfig["connector"]): IntegrationConnection["provider"] | null {
  switch (connector) {
    case "zendesk":
    case "hubspot":
    case "google-workspace":
    case "notion":
      return connector;
    case "webhook":
    case "internal":
      return null;
  }
}
