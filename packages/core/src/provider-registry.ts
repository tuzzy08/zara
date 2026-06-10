export const integrationProviderIds = [
  "zendesk",
  "hubspot",
  "google-workspace",
  "notion",
  "webhook-http",
  "salesforce",
  "slack",
  "microsoft-365",
  "intercom",
  "shopify",
  "stripe",
  "confluence",
  "sharepoint",
  "freshdesk",
  "salesforce-knowledge",
] as const;

export type IntegrationProviderId = (typeof integrationProviderIds)[number];
export type IntegrationProviderCategory =
  | "support"
  | "crm"
  | "productivity"
  | "knowledge"
  | "ecommerce"
  | "billing"
  | "custom";
export type IntegrationProviderCapability =
  | "connection"
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
  {
    id: "slack",
    label: "Slack",
    category: "productivity",
    logoToken: "slack",
    capabilities: ["agent-tool", "post-call-sync"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: false,
      modes: [],
    },
    tools: [
      tool("slack.escalations.post", "Post escalation", "medium", ["agent-tool"], false, slackOAuthScopes(), [
        slackChatPostMessageReference(),
      ]),
      tool("slack.alerts.post", "Post alert", "medium", ["agent-tool"], false, slackOAuthScopes(), [
        slackChatPostMessageReference(),
      ]),
      tool(
        "slack.call_summaries.post",
        "Post call summary",
        "medium",
        ["agent-tool", "post-call-sync"],
        false,
        slackOAuthScopes(),
        [slackChatPostMessageReference()],
      ),
    ],
    docs: docs([slackOAuthScopesReference(), slackChatPostMessageReference()]),
  },
  {
    id: "microsoft-365",
    label: "Microsoft 365",
    category: "productivity",
    logoToken: "microsoft-365",
    capabilities: ["calendar", "agent-tool"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: false,
      modes: [],
    },
    tools: [
      tool(
        "microsoft365.calendar.availability.read",
        "Read calendar availability",
        "low",
        ["calendar", "agent-tool"],
        false,
        ["Calendars.ReadBasic"],
        [microsoftGraphGetScheduleReference(), microsoftGraphPermissionsReference()],
      ),
      tool(
        "microsoft365.calendar.events.create",
        "Create calendar event",
        "medium",
        ["calendar", "agent-tool", "post-call-sync"],
        false,
        ["Calendars.ReadWrite"],
        [microsoftGraphCreateEventReference(), microsoftGraphPermissionsReference()],
      ),
    ],
    docs: docs([
      microsoftGraphGetScheduleReference(),
      microsoftGraphCreateEventReference(),
      microsoftGraphPermissionsReference(),
    ]),
  },
  {
    id: "intercom",
    label: "Intercom",
    category: "support",
    logoToken: "intercom",
    capabilities: ["agent-tool", "post-call-sync", "knowledge-source"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: true,
      modes: ["snapshot-import", "recurring-sync"],
    },
    tools: [
      tool("intercom.users.lookup", "Look up user or contact", "low", ["agent-tool"], false, ["read_users"], [
        intercomOAuthScopesReference(),
      ]),
      tool("intercom.companies.lookup", "Look up company", "low", ["agent-tool"], false, ["read_companies"], [
        intercomOAuthScopesReference(),
      ]),
      tool(
        "intercom.conversations.lookup",
        "Look up open conversation",
        "low",
        ["agent-tool"],
        false,
        ["read_conversations"],
        [intercomConversationsReference(), intercomOAuthScopesReference()],
      ),
      tool(
        "intercom.internal_notes.create",
        "Create internal note",
        "medium",
        ["agent-tool"],
        false,
        ["write_conversations"],
        [intercomNotesReference(), intercomOAuthScopesReference()],
      ),
      tool(
        "intercom.call_summaries.create",
        "Create call summary",
        "medium",
        ["agent-tool", "post-call-sync"],
        false,
        ["write_conversations"],
        [intercomNotesReference(), intercomOAuthScopesReference()],
      ),
    ],
    docs: docs([
      intercomOAuthScopesReference(),
      intercomConversationsReference(),
      intercomNotesReference(),
      intercomArticlesReference(),
    ]),
  },
  {
    id: "shopify",
    label: "Shopify",
    category: "ecommerce",
    logoToken: "shopify",
    capabilities: ["connection", "agent-tool"],
    setupSchema: {
      type: "oauth",
      fields: [safeField("shopDomain", "Shopify store domain", "text")],
    },
    knowledgeSource: {
      supported: false,
      modes: [],
    },
    tools: [
      tool("shopify.customers.lookup", "Look up customer", "low", ["agent-tool"], false, ["read_customers"], [
        shopifyAccessScopesReference(),
        shopifyCustomerReference(),
      ]),
      tool("shopify.orders.lookup", "Look up order", "low", ["agent-tool"], false, ["read_orders"], [
        shopifyAccessScopesReference(),
        shopifyOrderReference(),
      ]),
      tool("shopify.fulfillments.lookup", "Look up fulfillment", "low", ["agent-tool"], false, ["read_fulfillments"], [
        shopifyAccessScopesReference(),
        shopifyFulfillmentReference(),
      ]),
      tool(
        "shopify.shipping_status.lookup",
        "Look up shipping status",
        "low",
        ["agent-tool"],
        false,
        ["read_orders", "read_fulfillments"],
        [shopifyAccessScopesReference(), shopifyOrderReference(), shopifyFulfillmentReference()],
      ),
    ],
    docs: docs([
      shopifyAccessScopesReference(),
      shopifyCustomerReference(),
      shopifyOrderReference(),
      shopifyFulfillmentReference(),
    ]),
  },
  {
    id: "stripe",
    label: "Stripe",
    category: "billing",
    logoToken: "stripe",
    capabilities: ["connection", "agent-tool"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: false,
      modes: [],
    },
    tools: [
      tool("stripe.customers.lookup", "Look up customer", "low", ["agent-tool"], false, stripeReadOnlyScopes(), [
        stripeCustomerSearchReference(),
        stripeOAuthReference(),
      ]),
      tool("stripe.subscriptions.lookup", "Look up subscription", "low", ["agent-tool"], false, stripeReadOnlyScopes(), [
        stripeSubscriptionsReference(),
        stripeOAuthReference(),
      ]),
      tool("stripe.invoices.lookup", "Look up invoice", "low", ["agent-tool"], false, stripeReadOnlyScopes(), [
        stripeInvoicesReference(),
        stripeOAuthReference(),
      ]),
      tool("stripe.payment_status.lookup", "Look up payment status", "low", ["agent-tool"], false, stripeReadOnlyScopes(), [
        stripePaymentIntentsReference(),
        stripeOAuthReference(),
      ]),
    ],
    docs: docs([
      stripeOAuthReference(),
      stripeCustomerSearchReference(),
      stripeSubscriptionsReference(),
      stripeInvoicesReference(),
      stripePaymentIntentsReference(),
    ]),
  },
  {
    id: "confluence",
    label: "Confluence",
    category: "knowledge",
    logoToken: "confluence",
    capabilities: ["connection", "knowledge-source"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: true,
      modes: ["snapshot-import", "recurring-sync"],
    },
    tools: [
      tool(
        "confluence.pages.import",
        "Import spaces or pages",
        "low",
        ["knowledge-source"],
        true,
        confluenceKnowledgeScopes(),
        [confluencePagesReference(), confluenceSpacesReference()],
      ),
    ],
    docs: docs([confluencePagesReference(), confluenceSpacesReference()]),
  },
  {
    id: "sharepoint",
    label: "SharePoint",
    category: "knowledge",
    logoToken: "sharepoint",
    capabilities: ["connection", "knowledge-source"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: true,
      modes: ["snapshot-import", "recurring-sync"],
    },
    tools: [
      tool(
        "sharepoint.items.import",
        "Import sites, folders, or pages",
        "low",
        ["knowledge-source"],
        true,
        sharepointKnowledgeScopes(),
        [microsoftGraphDriveItemChildrenReference(), microsoftGraphDriveItemContentReference(), microsoftGraphSitePagesReference()],
      ),
    ],
    docs: docs([
      microsoftGraphDriveItemChildrenReference(),
      microsoftGraphDriveItemContentReference(),
      microsoftGraphSitePagesReference(),
      microsoftGraphPermissionsReference(),
    ]),
  },
  {
    id: "freshdesk",
    label: "Freshdesk Solutions",
    category: "knowledge",
    logoToken: "freshdesk",
    capabilities: ["connection", "knowledge-source"],
    setupSchema: {
      type: "api-token",
      fields: [
        safeField("subdomain", "Freshdesk subdomain", "text"),
        secretField("apiToken", "Freshdesk API token"),
      ],
    },
    knowledgeSource: {
      supported: true,
      modes: ["snapshot-import", "recurring-sync"],
    },
    tools: [
      tool(
        "freshdesk.solutions.import",
        "Import Freshdesk Solutions",
        "low",
        ["knowledge-source"],
        true,
        freshdeskSolutionsScopes(),
        [freshdeskSolutionsReference()],
      ),
    ],
    docs: docs([freshdeskSolutionsReference()]),
  },
  {
    id: "salesforce-knowledge",
    label: "Salesforce Knowledge",
    category: "knowledge",
    logoToken: "salesforce-knowledge",
    capabilities: ["connection", "knowledge-source"],
    setupSchema: {
      type: "oauth",
      fields: [],
    },
    knowledgeSource: {
      supported: true,
      modes: ["snapshot-import", "recurring-sync"],
    },
    tools: [
      tool(
        "salesforce-knowledge.articles.import",
        "Import Salesforce Knowledge",
        "low",
        ["knowledge-source"],
        true,
        salesforceOAuthScopes(),
        [salesforceKnowledgeObjectReference(), salesforceRestQueryReference(), salesforceOAuthReference()],
      ),
    ],
    docs: docs([salesforceKnowledgeObjectReference(), salesforceRestQueryReference(), salesforceOAuthReference()]),
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

function salesforceRestQueryReference(): IntegrationProviderDocsReference {
  return {
    label: "Salesforce REST API query resource",
    url: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query.htm",
  };
}

function salesforceKnowledgeObjectReference(): IntegrationProviderDocsReference {
  return {
    label: "Salesforce Knowledge__kav object",
    url: "https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_knowledge__kav.htm",
  };
}

function slackOAuthScopes(): string[] {
  return ["chat:write"];
}

function slackOAuthScopesReference(): IntegrationProviderDocsReference {
  return {
    label: "Slack OAuth scopes",
    url: "https://api.slack.com/scopes",
  };
}

function slackChatPostMessageReference(): IntegrationProviderDocsReference {
  return {
    label: "Slack chat.postMessage API",
    url: "https://api.slack.com/methods/chat.postMessage",
  };
}

function microsoftGraphGetScheduleReference(): IntegrationProviderDocsReference {
  return {
    label: "Microsoft Graph getSchedule API",
    url: "https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0",
  };
}

function microsoftGraphCreateEventReference(): IntegrationProviderDocsReference {
  return {
    label: "Microsoft Graph create event API",
    url: "https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0",
  };
}

function microsoftGraphPermissionsReference(): IntegrationProviderDocsReference {
  return {
    label: "Microsoft Graph permissions reference",
    url: "https://learn.microsoft.com/en-us/graph/permissions-reference",
  };
}

function intercomOAuthScopesReference(): IntegrationProviderDocsReference {
  return {
    label: "Intercom OAuth scopes",
    url: "https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/oauth-scopes",
  };
}

function intercomConversationsReference(): IntegrationProviderDocsReference {
  return {
    label: "Intercom Conversations API",
    url: "https://developers.intercom.com/docs/references/2.11/rest-api/api.intercom.io/conversations",
  };
}

function intercomNotesReference(): IntegrationProviderDocsReference {
  return {
    label: "Intercom Notes API",
    url: "https://developers.intercom.com/docs/references/2.11/rest-api/api.intercom.io/notes/note",
  };
}

function intercomArticlesReference(): IntegrationProviderDocsReference {
  return {
    label: "Intercom Articles API",
    url: "https://developers.intercom.com/docs/references/rest-api/api.intercom.io/articles",
  };
}

function shopifyAccessScopesReference(): IntegrationProviderDocsReference {
  return {
    label: "Shopify Admin API access scopes",
    url: "https://shopify.dev/docs/api/usage/access-scopes",
  };
}

function shopifyCustomerReference(): IntegrationProviderDocsReference {
  return {
    label: "Shopify Admin GraphQL Customer object",
    url: "https://shopify.dev/docs/api/admin-graphql/latest/objects/Customer",
  };
}

function shopifyOrderReference(): IntegrationProviderDocsReference {
  return {
    label: "Shopify Admin GraphQL Order object",
    url: "https://shopify.dev/docs/api/admin-graphql/latest/objects/Order",
  };
}

function shopifyFulfillmentReference(): IntegrationProviderDocsReference {
  return {
    label: "Shopify Admin GraphQL Fulfillment object",
    url: "https://shopify.dev/docs/api/admin-graphql/latest/objects/Fulfillment",
  };
}

function stripeReadOnlyScopes(): string[] {
  return ["read_only"];
}

function stripeOAuthReference(): IntegrationProviderDocsReference {
  return {
    label: "Stripe Connect OAuth reference",
    url: "https://docs.stripe.com/connect/oauth-reference",
  };
}

function stripeCustomerSearchReference(): IntegrationProviderDocsReference {
  return {
    label: "Stripe customer search API",
    url: "https://docs.stripe.com/api/customers/search",
  };
}

function stripeSubscriptionsReference(): IntegrationProviderDocsReference {
  return {
    label: "Stripe subscriptions API",
    url: "https://docs.stripe.com/api/subscriptions",
  };
}

function stripeInvoicesReference(): IntegrationProviderDocsReference {
  return {
    label: "Stripe invoices API",
    url: "https://docs.stripe.com/api/invoices",
  };
}

function stripePaymentIntentsReference(): IntegrationProviderDocsReference {
  return {
    label: "Stripe PaymentIntents API",
    url: "https://docs.stripe.com/api/payment_intents",
  };
}

function confluenceKnowledgeScopes(): string[] {
  return ["read:page:confluence", "read:space:confluence"];
}

function confluencePagesReference(): IntegrationProviderDocsReference {
  return {
    label: "Confluence REST API v2 pages",
    url: "https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/",
  };
}

function confluenceSpacesReference(): IntegrationProviderDocsReference {
  return {
    label: "Confluence REST API v2 spaces",
    url: "https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-space/",
  };
}

function sharepointKnowledgeScopes(): string[] {
  return ["Files.Read", "Sites.Read.All"];
}

function freshdeskSolutionsScopes(): string[] {
  return ["solutions:read"];
}

function freshdeskSolutionsReference(): IntegrationProviderDocsReference {
  return {
    label: "Freshdesk Solutions API",
    url: "https://developers.freshdesk.com/api/#solutions",
  };
}

function microsoftGraphDriveItemChildrenReference(): IntegrationProviderDocsReference {
  return {
    label: "Microsoft Graph drive item children API",
    url: "https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0",
  };
}

function microsoftGraphDriveItemContentReference(): IntegrationProviderDocsReference {
  return {
    label: "Microsoft Graph drive item content API",
    url: "https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0",
  };
}

function microsoftGraphSitePagesReference(): IntegrationProviderDocsReference {
  return {
    label: "Microsoft Graph site pages API",
    url: "https://learn.microsoft.com/en-us/graph/api/sitepage-list?view=graph-rest-1.0",
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
