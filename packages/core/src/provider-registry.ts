export const integrationProviderIds = [
  "zendesk",
  "hubspot",
  "google-workspace",
  "notion",
  "webhook-http",
  "salesforce",
] as const;

export type IntegrationProviderId = (typeof integrationProviderIds)[number];
export type IntegrationProviderCategory =
  | "support"
  | "crm"
  | "productivity"
  | "knowledge"
  | "custom";
export type IntegrationProviderCapability =
  | "agent-tool"
  | "ticketing"
  | "crm"
  | "calendar"
  | "knowledge-source"
  | "post-call-sync"
  | "task-management"
  | "custom-webhook";
export type IntegrationProviderRiskPosture = "low" | "medium" | "high";
export type IntegrationProviderSetupType =
  | "oauth"
  | "api-token"
  | "oauth-or-api-token"
  | "tenant-defined-webhook";

export interface IntegrationProviderDocsReference {
  label: string;
  url: string;
}

export interface IntegrationProviderDocsMetadata {
  references: IntegrationProviderDocsReference[];
  verifiedAt: string;
}

export interface IntegrationProviderSetupField {
  id: string;
  label: string;
  kind: "text" | "url" | "email" | "secret" | "select";
  required: boolean;
  secret: boolean;
}

export interface IntegrationProviderSetupSchema {
  type: IntegrationProviderSetupType;
  fields: IntegrationProviderSetupField[];
}

export interface IntegrationProviderKnowledgeSourceMetadata {
  supported: boolean;
  modes: ("snapshot-import" | "recurring-sync")[];
}

export interface IntegrationProviderCatalogTool {
  id: string;
  name: string;
  riskPosture: IntegrationProviderRiskPosture;
  capabilities: IntegrationProviderCapability[];
  knowledgeSource: boolean;
  requiredScopes: string[];
  docs: IntegrationProviderDocsMetadata;
}

export interface IntegrationProviderCatalogEntry {
  id: IntegrationProviderId;
  label: string;
  category: IntegrationProviderCategory;
  logoToken: string;
  capabilities: IntegrationProviderCapability[];
  setupSchema: IntegrationProviderSetupSchema;
  knowledgeSource: IntegrationProviderKnowledgeSourceMetadata;
  tools: IntegrationProviderCatalogTool[];
  docs: IntegrationProviderDocsMetadata;
}

const verifiedAt = "2026-06-05";

const catalog: IntegrationProviderCatalogEntry[] = [
  {
    id: "zendesk",
    label: "Zendesk",
    category: "support",
    logoToken: "zendesk",
    capabilities: ["ticketing", "agent-tool", "knowledge-source"],
    setupSchema: {
      type: "oauth-or-api-token",
      fields: [
        safeField("subdomain", "Zendesk subdomain", "text"),
        safeField("email", "Zendesk admin email", "email"),
        secretField("apiToken", "Zendesk API token"),
      ],
    },
    knowledgeSource: {
      supported: true,
      modes: ["snapshot-import", "recurring-sync"],
    },
    tools: [
      tool("zendesk.tickets.search", "Search tickets", "low", ["ticketing", "agent-tool"], false, ["tickets:read"], [
        zendeskTicketsApiReference(),
      ]),
      tool("zendesk.tickets.create", "Create ticket", "medium", ["ticketing", "agent-tool"], false, ["tickets:write"], [
        zendeskTicketsApiReference(),
      ]),
      tool("zendesk.tickets.update", "Update ticket", "medium", ["ticketing", "agent-tool"], false, ["tickets:write"], [
        zendeskTicketsApiReference(),
      ]),
    ],
    docs: docs([zendeskTicketsApiReference()]),
  },
  {
    id: "hubspot",
    label: "HubSpot",
    category: "crm",
    logoToken: "hubspot",
    capabilities: ["crm", "agent-tool", "post-call-sync"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: false,
      modes: [],
    },
    tools: [
      tool("hubspot.contacts.lookup", "Look up contact", "low", ["crm", "agent-tool"], false, ["crm.objects.contacts.read"], [
        {
          label: "HubSpot CRM contacts API",
          url: "https://developers.hubspot.com/docs/api/crm/contacts",
        },
      ]),
      tool("hubspot.notes.create", "Create note", "medium", ["crm", "agent-tool"], false, ["crm.objects.notes.write"], [
        {
          label: "HubSpot notes API",
          url: "https://developers.hubspot.com/docs/api/crm/notes",
        },
      ]),
      tool("hubspot.pipeline.update", "Update pipeline", "high", ["crm", "agent-tool"], false, ["crm.objects.deals.write"], [
        {
          label: "HubSpot deals API",
          url: "https://developers.hubspot.com/docs/api/crm/deals",
        },
      ]),
    ],
    docs: docs([
      {
        label: "HubSpot OAuth and CRM APIs",
        url: "https://developers.hubspot.com/docs/api/overview",
      },
    ]),
  },
  {
    id: "google-workspace",
    label: "Google Workspace",
    category: "productivity",
    logoToken: "google-workspace",
    capabilities: ["calendar", "agent-tool", "knowledge-source"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: true,
      modes: ["snapshot-import", "recurring-sync"],
    },
    tools: [
      tool("google.calendar.availability.read", "Read availability", "low", ["calendar", "agent-tool"], false, ["calendar.freebusy"], [
        {
          label: "Google Calendar FreeBusy API",
          url: "https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query",
        },
      ]),
      tool("google.calendar.events.create", "Create calendar event", "medium", ["calendar", "agent-tool"], false, ["calendar.events"], [
        {
          label: "Google Calendar events API",
          url: "https://developers.google.com/workspace/calendar/api/v3/reference/events/insert",
        },
      ]),
    ],
    docs: docs([
      {
        label: "Google Calendar API",
        url: "https://developers.google.com/workspace/calendar/api/guides/overview",
      },
    ]),
  },
  {
    id: "notion",
    label: "Notion",
    category: "knowledge",
    logoToken: "notion",
    capabilities: ["knowledge-source", "task-management", "agent-tool"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: true,
      modes: ["snapshot-import", "recurring-sync"],
    },
    tools: [
      tool("notion.knowledge.search", "Search knowledge", "low", ["knowledge-source", "agent-tool"], true, ["search:read"], [
        {
          label: "Notion search API",
          url: "https://developers.notion.com/reference/post-search",
        },
      ]),
      tool("notion.pages.create", "Create page", "medium", ["task-management", "agent-tool"], false, ["pages:write"], [
        {
          label: "Notion pages API",
          url: "https://developers.notion.com/reference/post-page",
        },
      ]),
      tool("notion.tasks.create", "Create task", "medium", ["task-management", "agent-tool"], false, ["tasks:write"], [
        {
          label: "Notion pages API",
          url: "https://developers.notion.com/reference/post-page",
        },
      ]),
    ],
    docs: docs([
      {
        label: "Notion API reference",
        url: "https://developers.notion.com/reference/intro",
      },
    ]),
  },
  {
    id: "webhook-http",
    label: "Webhook HTTP",
    category: "custom",
    logoToken: "webhook-http",
    capabilities: ["custom-webhook", "agent-tool"],
    setupSchema: {
      type: "tenant-defined-webhook",
      fields: [
        safeField("url", "HTTPS URL", "url"),
        safeField("method", "HTTP method", "select"),
        safeField("timeoutMs", "Timeout", "text"),
        secretField("authToken", "Bearer token"),
      ],
    },
    knowledgeSource: {
      supported: false,
      modes: [],
    },
    tools: [
      tool("webhook-http.request", "Call webhook", "high", ["custom-webhook", "agent-tool"], false, [], [
        {
          label: "Zara webhook HTTP tools",
          url: "https://docs.zara.ai/integrations/webhook-http-tools",
        },
      ]),
    ],
    docs: docs([
      {
        label: "Zara webhook HTTP tools",
        url: "https://docs.zara.ai/integrations/webhook-http-tools",
      },
    ]),
  },
  {
    id: "salesforce",
    label: "Salesforce",
    category: "crm",
    logoToken: "salesforce",
    capabilities: ["crm", "agent-tool", "post-call-sync"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: false,
      modes: [],
    },
    tools: [
      tool("salesforce.accounts.lookup", "Look up account", "low", ["crm", "agent-tool"], false, salesforceOAuthScopes(), [
        salesforceRestApiReference(),
      ]),
      tool("salesforce.contacts.lookup", "Look up contact", "low", ["crm", "agent-tool"], false, salesforceOAuthScopes(), [
        salesforceRestApiReference(),
      ]),
      tool("salesforce.cases.lookup", "Look up case", "low", ["crm", "agent-tool"], false, salesforceOAuthScopes(), [
        salesforceRestApiReference(),
      ]),
      tool("salesforce.tasks.create", "Create task", "medium", ["crm", "agent-tool", "post-call-sync"], false, salesforceOAuthScopes(), [
        salesforceRestApiReference(),
      ]),
      tool("salesforce.cases.create", "Create case", "medium", ["crm", "agent-tool", "post-call-sync"], false, salesforceOAuthScopes(), [
        salesforceRestApiReference(),
      ]),
      tool("salesforce.call_notes.create", "Add call note", "medium", ["crm", "agent-tool", "post-call-sync"], false, salesforceOAuthScopes(), [
        salesforceRestApiReference(),
      ]),
    ],
    docs: docs([salesforceOAuthReference(), salesforceRestApiReference()]),
  },
];

export function getIntegrationProviderCatalog(): IntegrationProviderCatalogEntry[] {
  return catalog.map(cloneProviderCatalogEntry);
}

export function getIntegrationProviderCatalogEntry(
  providerId: string,
): IntegrationProviderCatalogEntry | undefined {
  const provider = catalog.find((entry) => entry.id === providerId);
  return provider === undefined ? undefined : cloneProviderCatalogEntry(provider);
}

function safeField(
  id: string,
  label: string,
  kind: IntegrationProviderSetupField["kind"],
): IntegrationProviderSetupField {
  return {
    id,
    label,
    kind,
    required: true,
    secret: false,
  };
}

function secretField(id: string, label: string): IntegrationProviderSetupField {
  return {
    id,
    label,
    kind: "secret",
    required: true,
    secret: true,
  };
}

function tool(
  id: string,
  name: string,
  riskPosture: IntegrationProviderRiskPosture,
  capabilities: IntegrationProviderCapability[],
  knowledgeSource: boolean,
  requiredScopes: string[],
  references: IntegrationProviderDocsReference[],
): IntegrationProviderCatalogTool {
  return {
    id,
    name,
    riskPosture,
    capabilities,
    knowledgeSource,
    requiredScopes,
    docs: docs(references),
  };
}

function docs(references: IntegrationProviderDocsReference[]): IntegrationProviderDocsMetadata {
  return {
    references,
    verifiedAt,
  };
}

function zendeskTicketsApiReference(): IntegrationProviderDocsReference {
  return {
    label: "Zendesk Tickets API",
    url: "https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/",
  };
}

function salesforceOAuthScopes(): string[] {
  return ["api", "refresh_token"];
}

function salesforceOAuthReference(): IntegrationProviderDocsReference {
  return {
    label: "Salesforce OAuth tokens and scopes",
    url: "https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_tokens_scopes.htm&type=5",
  };
}

function salesforceRestApiReference(): IntegrationProviderDocsReference {
  return {
    label: "Salesforce REST API Developer Guide",
    url: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_rest.htm",
  };
}

function cloneProviderCatalogEntry(
  entry: IntegrationProviderCatalogEntry,
): IntegrationProviderCatalogEntry {
  return {
    ...entry,
    capabilities: [...entry.capabilities],
    setupSchema: {
      ...entry.setupSchema,
      fields: entry.setupSchema.fields.map((field) => ({ ...field })),
    },
    knowledgeSource: {
      ...entry.knowledgeSource,
      modes: [...entry.knowledgeSource.modes],
    },
    tools: entry.tools.map((catalogTool) => ({
      ...catalogTool,
      capabilities: [...catalogTool.capabilities],
      requiredScopes: [...catalogTool.requiredScopes],
      docs: cloneDocs(catalogTool.docs),
    })),
    docs: cloneDocs(entry.docs),
  };
}

function cloneDocs(metadata: IntegrationProviderDocsMetadata): IntegrationProviderDocsMetadata {
  return {
    references: metadata.references.map((reference) => ({ ...reference })),
    verifiedAt: metadata.verifiedAt,
  };
}
