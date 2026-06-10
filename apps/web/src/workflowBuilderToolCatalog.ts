import type {
  IntegrationProviderCatalogEntry,
  IntegrationProviderId,
  ToolNodeConfig,
  ToolRequestConfig,
} from "@zara/core";

import type { IntegrationConnection } from "./tenantIntegrationsApi";

export interface ToolCatalogItem {
  toolId: string;
  toolName: string;
  connector: ToolNodeConfig["connector"];
  risk: ToolNodeConfig["risk"];
  requiresAuthorization: boolean;
  requiresHumanApproval: boolean;
  request?: ToolRequestConfig | undefined;
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

export function createWorkflowToolCatalog(
  providers: IntegrationProviderCatalogEntry[],
): ToolCatalogItem[] {
  return providers.flatMap((provider) =>
    provider.tools.flatMap((tool) => {
      const connector = toToolConnector(provider.id);

      if (connector === null) {
        return [];
      }

      return [
        {
          toolId: tool.id,
          toolName: tool.name,
          connector,
          risk: tool.riskPosture,
          requiresAuthorization: provider.id !== "webhook-http",
          requiresHumanApproval: tool.riskPosture !== "low",
          ...(provider.id === "webhook-http" ? { request: createDefaultWebhookToolRequest() } : {}),
        },
      ];
    }),
  );
}

export function getDefaultToolCatalogItem(catalog: ToolCatalogItem[]) {
  return catalog[0];
}

export function getToolProviderOptions(
  catalog: ToolCatalogItem[],
  selectedTool?: { toolId: string; tool: ToolNodeConfig } | undefined,
): ToolProviderOption[] {
  const providers = new Map<ToolNodeConfig["connector"], ToolProviderOption>();

  for (const item of catalog) {
    const provider = providers.get(item.connector) ?? {
      connector: item.connector,
      label: formatToolConnectorLabel(item.connector),
      tools: [],
    };
    provider.tools.push(item);
    providers.set(item.connector, provider);
  }

  if (selectedTool !== undefined) {
    const provider = providers.get(selectedTool.tool.connector);
    const hasSelectedTool = provider?.tools.some((item) => item.toolId === selectedTool.toolId) ?? false;

    if (!hasSelectedTool) {
      const compatibilityItem = createSavedToolCatalogItem(selectedTool.toolId, selectedTool.tool);

      if (provider === undefined) {
        providers.set(selectedTool.tool.connector, {
          connector: selectedTool.tool.connector,
          label: formatToolConnectorLabel(selectedTool.tool.connector),
          tools: [compatibilityItem],
        });
      } else {
        provider.tools = [compatibilityItem, ...provider.tools];
      }
    }
  }

  return Array.from(providers.values());
}

export function getToolCatalogItem(catalog: ToolCatalogItem[], toolId: string) {
  return catalog.find((item) => item.toolId === toolId);
}

export function createToolConfigFromCatalogItem(
  catalogItem: ToolCatalogItem,
  integrationConnections: IntegrationConnection[] = [],
): ToolNodeConfig {
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
    ...(catalogItem.request !== undefined ? { request: cloneToolRequest(catalogItem.request) } : {}),
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
    case "salesforce":
      return "Salesforce";
    case "slack":
      return "Slack";
    case "microsoft-365":
      return "Microsoft 365";
    case "intercom":
      return "Intercom";
    case "shopify":
      return "Shopify";
    case "stripe":
      return "Stripe";
    case "webhook":
      return "Webhook HTTP";
    case "internal":
      return "Internal";
  }
}

function createSavedToolCatalogItem(toolId: string, tool: ToolNodeConfig): ToolCatalogItem {
  return {
    toolId,
    toolName: tool.toolName,
    connector: tool.connector,
    risk: tool.risk,
    requiresAuthorization: tool.requiresAuthorization,
    requiresHumanApproval: tool.requiresHumanApproval,
    ...(tool.request !== undefined ? { request: cloneToolRequest(tool.request) } : {}),
  };
}

function createDefaultWebhookToolRequest(): ToolRequestConfig {
  return {
    method: "POST",
    url: "https://hooks.zara.ai/actions",
    authToken: "{{secrets.workflow_webhook_token}}",
    headers: [
      { name: "Content-Type", value: "application/json" },
      { name: "X-Zara-Tenant", value: "{{tenant.id}}" },
    ],
    bodyTemplate: '{"callId":"{{call.id}}","intent":"{{call.intent}}"}',
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
    case "salesforce":
    case "slack":
    case "microsoft-365":
    case "intercom":
    case "shopify":
    case "stripe":
      return connector;
    case "webhook":
    case "internal":
      return null;
  }
}

function toToolConnector(provider: IntegrationProviderId): ToolNodeConfig["connector"] | null {
  switch (provider) {
    case "zendesk":
    case "hubspot":
    case "google-workspace":
    case "notion":
    case "salesforce":
    case "slack":
    case "microsoft-365":
    case "intercom":
    case "shopify":
    case "stripe":
      return provider;
    case "webhook-http":
      return "webhook";
    case "confluence":
    case "sharepoint":
    case "freshdesk":
    case "salesforce-knowledge":
      return null;
  }
}
