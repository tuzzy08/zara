import { describe, expect, it } from "vitest";

import {
  getIntegrationProviderCatalog,
  getIntegrationProviderCatalogEntry,
  integrationProviderIds,
} from "./provider-registry";

describe("integration provider registry", () => {
  it("serializes tenant-safe provider catalog metadata without server-only connector details", () => {
    const catalog = getIntegrationProviderCatalog();

    expect(integrationProviderIds).toEqual([
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
    ]);
    expect(catalog.map((provider) => provider.id)).toEqual(integrationProviderIds);
    expect(catalog).toContainEqual(
      expect.objectContaining({
        id: "zendesk",
        label: "Zendesk",
        category: "support",
        logoToken: "zendesk",
        capabilities: expect.arrayContaining(["ticketing", "agent-tool", "knowledge-source"]),
        knowledgeSource: {
          supported: true,
          modes: ["snapshot-import", "recurring-sync"],
        },
        setupSchema: expect.objectContaining({
          type: "oauth-or-api-token",
          fields: expect.arrayContaining([
            expect.objectContaining({
              id: "subdomain",
              label: "Zendesk subdomain",
              secret: false,
            }),
          ]),
        }),
        tools: expect.arrayContaining([
          expect.objectContaining({
            id: "zendesk.tickets.search",
            name: "Search tickets",
            riskPosture: "low",
            knowledgeSource: false,
            docs: expect.objectContaining({
              verifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            }),
          }),
          expect.objectContaining({
            id: "zendesk.tickets.create",
            name: "Create ticket",
            riskPosture: "medium",
          }),
        ]),
        docs: expect.objectContaining({
          references: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringContaining("Zendesk"),
              url: expect.stringMatching(/^https:\/\/developer\.zendesk\.com\//),
            }),
          ]),
          verifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      }),
    );

    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });

  it("returns undefined for unsupported provider IDs", () => {
    expect(getIntegrationProviderCatalogEntry("freshdesk-legacy")).toBeUndefined();
  });

  it("exposes Freshdesk Solutions and Salesforce Knowledge as knowledge-source-only providers", () => {
    expect(getIntegrationProviderCatalogEntry("freshdesk")).toEqual(
      expect.objectContaining({
        id: "freshdesk",
        label: "Freshdesk Solutions",
        category: "knowledge",
        logoToken: "freshdesk",
        capabilities: ["connection", "knowledge-source"],
        setupSchema: {
          type: "api-token",
          fields: expect.arrayContaining([
            expect.objectContaining({
              id: "subdomain",
              label: "Freshdesk subdomain",
              secret: false,
            }),
            expect.objectContaining({
              id: "apiToken",
              label: "Freshdesk API token",
              secret: true,
            }),
          ]),
        },
        knowledgeSource: {
          supported: true,
          modes: ["snapshot-import", "recurring-sync"],
        },
        tools: [
          expect.objectContaining({
            id: "freshdesk.solutions.import",
            name: "Import Freshdesk Solutions",
            riskPosture: "low",
            capabilities: ["knowledge-source"],
            knowledgeSource: true,
            requiredScopes: ["solutions:read"],
            docs: expect.objectContaining({
              references: expect.arrayContaining([
                expect.objectContaining({
                  label: expect.stringContaining("Freshdesk"),
                  url: "https://developers.freshdesk.com/api/#solutions",
                }),
              ]),
            }),
          }),
        ],
      }),
    );

    expect(getIntegrationProviderCatalogEntry("salesforce-knowledge")).toEqual(
      expect.objectContaining({
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
          expect.objectContaining({
            id: "salesforce-knowledge.articles.import",
            name: "Import Salesforce Knowledge",
            riskPosture: "low",
            capabilities: ["knowledge-source"],
            knowledgeSource: true,
            requiredScopes: ["api", "refresh_token"],
            docs: expect.objectContaining({
              references: expect.arrayContaining([
                expect.objectContaining({
                  label: expect.stringContaining("Knowledge"),
                  url: "https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_knowledge__kav.htm",
                }),
              ]),
            }),
          }),
        ],
      }),
    );
  });

  it("marks providers that can receive post-call sync grants", () => {
    expect(getIntegrationProviderCatalogEntry("hubspot")).toEqual(
      expect.objectContaining({
        capabilities: expect.arrayContaining(["post-call-sync"]),
      }),
    );
  });

  it("exposes Salesforce catalog metadata for safe CRM lookup and additive follow-up tools only", () => {
    const salesforce = getIntegrationProviderCatalogEntry("salesforce");

    expect(salesforce).toEqual(
      expect.objectContaining({
        id: "salesforce",
        label: "Salesforce",
        category: "crm",
        logoToken: "salesforce",
        capabilities: expect.arrayContaining(["crm", "agent-tool", "post-call-sync"]),
        setupSchema: {
          type: "oauth",
          fields: [],
        },
        knowledgeSource: {
          supported: false,
          modes: [],
        },
        docs: {
          references: expect.arrayContaining([
            expect.objectContaining({
              label: "Salesforce OAuth tokens and scopes",
              url: "https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_tokens_scopes.htm&type=5",
            }),
            expect.objectContaining({
              label: "Salesforce REST API Developer Guide",
              url: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_rest.htm",
            }),
          ]),
          verifiedAt: "2026-06-05",
        },
      }),
    );

    expect(salesforce?.tools).toEqual([
      expect.objectContaining({
        id: "salesforce.accounts.lookup",
        name: "Look up account",
        riskPosture: "low",
        capabilities: ["crm", "agent-tool"],
        requiredScopes: ["api", "refresh_token"],
      }),
      expect.objectContaining({
        id: "salesforce.contacts.lookup",
        name: "Look up contact",
        riskPosture: "low",
        capabilities: ["crm", "agent-tool"],
        requiredScopes: ["api", "refresh_token"],
      }),
      expect.objectContaining({
        id: "salesforce.cases.lookup",
        name: "Look up case",
        riskPosture: "low",
        capabilities: ["crm", "agent-tool"],
        requiredScopes: ["api", "refresh_token"],
      }),
      expect.objectContaining({
        id: "salesforce.tasks.create",
        name: "Create task",
        riskPosture: "medium",
        capabilities: ["crm", "agent-tool", "post-call-sync"],
        requiredScopes: ["api", "refresh_token"],
      }),
      expect.objectContaining({
        id: "salesforce.cases.create",
        name: "Create case",
        riskPosture: "medium",
        capabilities: ["crm", "agent-tool", "post-call-sync"],
        requiredScopes: ["api", "refresh_token"],
      }),
      expect.objectContaining({
        id: "salesforce.call_notes.create",
        name: "Add call note",
        riskPosture: "medium",
        capabilities: ["crm", "agent-tool", "post-call-sync"],
        requiredScopes: ["api", "refresh_token"],
      }),
    ]);

    const catalogText = JSON.stringify(salesforce);
    expect(catalogText).not.toMatch(/pipeline|stage|owner|delete|destroy|destructive|broad object|objects\.update/i);
  });

  it("exposes Slack catalog metadata for bounded escalation, alerts, and post-call summary posts only", () => {
    const slack = getIntegrationProviderCatalogEntry("slack");

    expect(slack).toEqual(
      expect.objectContaining({
        id: "slack",
        label: "Slack",
        category: "productivity",
        logoToken: "slack",
        capabilities: expect.arrayContaining(["agent-tool", "post-call-sync"]),
        setupSchema: {
          type: "oauth",
          fields: [],
        },
        knowledgeSource: {
          supported: false,
          modes: [],
        },
        docs: {
          references: expect.arrayContaining([
            expect.objectContaining({
              label: "Slack OAuth scopes",
              url: "https://api.slack.com/scopes",
            }),
            expect.objectContaining({
              label: "Slack chat.postMessage API",
              url: "https://api.slack.com/methods/chat.postMessage",
            }),
          ]),
          verifiedAt: "2026-06-05",
        },
      }),
    );

    expect(slack?.tools).toEqual([
      expect.objectContaining({
        id: "slack.escalations.post",
        name: "Post escalation",
        riskPosture: "medium",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["chat:write"],
      }),
      expect.objectContaining({
        id: "slack.alerts.post",
        name: "Post alert",
        riskPosture: "medium",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["chat:write"],
      }),
      expect.objectContaining({
        id: "slack.call_summaries.post",
        name: "Post call summary",
        riskPosture: "medium",
        capabilities: ["agent-tool", "post-call-sync"],
        knowledgeSource: false,
        requiredScopes: ["chat:write"],
      }),
    ]);

    const catalogText = JSON.stringify(slack);
    expect(catalogText).not.toMatch(/arbitrary|direct message|dm|im:|conversations\.history|history|delete|update|chat:write\.customize/i);
    expect(catalogText).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });

  it("exposes Microsoft 365 Outlook Calendar metadata without mailbox, Teams, or broad Graph access", () => {
    const microsoft365 = getIntegrationProviderCatalogEntry("microsoft-365");

    expect(microsoft365).toEqual(
      expect.objectContaining({
        id: "microsoft-365",
        label: "Microsoft 365",
        category: "productivity",
        logoToken: "microsoft-365",
        capabilities: expect.arrayContaining(["calendar", "agent-tool"]),
        setupSchema: {
          type: "oauth",
          fields: [],
        },
        knowledgeSource: {
          supported: false,
          modes: [],
        },
        docs: {
          references: expect.arrayContaining([
            expect.objectContaining({
              label: "Microsoft Graph getSchedule API",
              url: "https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0",
            }),
            expect.objectContaining({
              label: "Microsoft Graph create event API",
              url: "https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0",
            }),
            expect.objectContaining({
              label: "Microsoft Graph permissions reference",
              url: "https://learn.microsoft.com/en-us/graph/permissions-reference",
            }),
          ]),
          verifiedAt: "2026-06-05",
        },
      }),
    );

    expect(microsoft365?.tools).toEqual([
      expect.objectContaining({
        id: "microsoft365.calendar.availability.read",
        name: "Read calendar availability",
        riskPosture: "low",
        capabilities: ["calendar", "agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["Calendars.ReadBasic"],
      }),
      expect.objectContaining({
        id: "microsoft365.calendar.events.create",
        name: "Create calendar event",
        riskPosture: "medium",
        capabilities: ["calendar", "agent-tool", "post-call-sync"],
        knowledgeSource: false,
        requiredScopes: ["Calendars.ReadWrite"],
      }),
    ]);

    const catalogText = JSON.stringify(microsoft365);
    expect(catalogText).not.toMatch(/Mail\.|mailbox|email|message|Teams|teamwork|ChannelMessage|chatMessage/i);
    expect(catalogText).not.toMatch(/User\.ReadWrite\.All|Calendars\.ReadWrite\.Shared/i);
    expect(catalogText).not.toMatch(/calendar\.(events\.)?(update|delete)|events\.delete|events\.update/i);
    expect(catalogText).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });

  it("exposes Intercom catalog metadata for lookups, internal notes, call summaries, and Articles ingestion only", () => {
    const intercom = getIntegrationProviderCatalogEntry("intercom");

    expect(intercom).toEqual(
      expect.objectContaining({
        id: "intercom",
        label: "Intercom",
        category: "support",
        logoToken: "intercom",
        capabilities: expect.arrayContaining(["agent-tool", "post-call-sync", "knowledge-source"]),
        setupSchema: {
          type: "oauth",
          fields: [],
        },
        knowledgeSource: {
          supported: true,
          modes: ["snapshot-import", "recurring-sync"],
        },
        docs: {
          references: expect.arrayContaining([
            expect.objectContaining({
              label: "Intercom OAuth scopes",
              url: "https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/oauth-scopes",
            }),
            expect.objectContaining({
              label: "Intercom Conversations API",
              url: "https://developers.intercom.com/docs/references/2.11/rest-api/api.intercom.io/conversations",
            }),
            expect.objectContaining({
              label: "Intercom Notes API",
              url: "https://developers.intercom.com/docs/references/2.11/rest-api/api.intercom.io/notes/note",
            }),
            expect.objectContaining({
              label: "Intercom Articles API",
              url: "https://developers.intercom.com/docs/references/rest-api/api.intercom.io/articles",
            }),
          ]),
          verifiedAt: "2026-06-05",
        },
      }),
    );

    expect(intercom?.tools).toEqual([
      expect.objectContaining({
        id: "intercom.users.lookup",
        name: "Look up user or contact",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_users"],
      }),
      expect.objectContaining({
        id: "intercom.companies.lookup",
        name: "Look up company",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_companies"],
      }),
      expect.objectContaining({
        id: "intercom.conversations.lookup",
        name: "Look up open conversation",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_conversations"],
      }),
      expect.objectContaining({
        id: "intercom.internal_notes.create",
        name: "Create internal note",
        riskPosture: "medium",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["write_conversations"],
      }),
      expect.objectContaining({
        id: "intercom.call_summaries.create",
        name: "Create call summary",
        riskPosture: "medium",
        capabilities: ["agent-tool", "post-call-sync"],
        knowledgeSource: false,
        requiredScopes: ["write_conversations"],
      }),
    ]);

    const toolIds = new Set(intercom?.tools.map((tool) => tool.id));
    expect(toolIds.has("intercom.external_replies.create")).toBe(false);
    expect(toolIds.has("intercom.conversations.close")).toBe(false);
    expect(toolIds.has("intercom.conversations.assign")).toBe(false);
    expect(toolIds.has("intercom.users.update")).toBe(false);
    expect(toolIds.has("intercom.companies.update")).toBe(false);
    expect(toolIds.has("intercom.outbound_messages.create")).toBe(false);
    expect(toolIds.has("intercom.articles.search")).toBe(false);

    const catalogText = JSON.stringify(intercom);
    expect(catalogText).not.toMatch(/external[_ -]?reply|reply\.create|conversations\.close|conversations\.assign/i);
    expect(catalogText).not.toMatch(/users\.update|companies\.update|field mutation|outbound|messages\.create/i);
    expect(catalogText).not.toMatch(/articles\.search|knowledge\.search|live provider knowledge search/i);
    expect(catalogText).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });

  it("exposes Shopify catalog metadata for read-only commerce lookup tools only", () => {
    const shopify = getIntegrationProviderCatalogEntry("shopify");

    expect(shopify).toEqual(
      expect.objectContaining({
        id: "shopify",
        label: "Shopify",
        category: "ecommerce",
        logoToken: "shopify",
        capabilities: ["connection", "agent-tool"],
        setupSchema: {
          type: "oauth",
          fields: [
            {
              id: "shopDomain",
              label: "Shopify store domain",
              kind: "text",
              required: true,
              secret: false,
            },
          ],
        },
        knowledgeSource: {
          supported: false,
          modes: [],
        },
        docs: {
          references: expect.arrayContaining([
            expect.objectContaining({
              label: "Shopify Admin API access scopes",
              url: "https://shopify.dev/docs/api/usage/access-scopes",
            }),
            expect.objectContaining({
              label: "Shopify Admin GraphQL Order object",
              url: "https://shopify.dev/docs/api/admin-graphql/latest/objects/Order",
            }),
            expect.objectContaining({
              label: "Shopify Admin GraphQL Fulfillment object",
              url: "https://shopify.dev/docs/api/admin-graphql/latest/objects/Fulfillment",
            }),
          ]),
          verifiedAt: "2026-06-05",
        },
      }),
    );

    expect(shopify?.tools).toEqual([
      expect.objectContaining({
        id: "shopify.customers.lookup",
        name: "Look up customer",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_customers"],
      }),
      expect.objectContaining({
        id: "shopify.orders.lookup",
        name: "Look up order",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_orders"],
      }),
      expect.objectContaining({
        id: "shopify.fulfillments.lookup",
        name: "Look up fulfillment",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_fulfillments"],
      }),
      expect.objectContaining({
        id: "shopify.shipping_status.lookup",
        name: "Look up shipping status",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_orders", "read_fulfillments"],
      }),
    ]);
  });

  it("does not expose Shopify write, mutation, knowledge-source, post-call-sync, ticketing, or billing tools", () => {
    const shopify = getIntegrationProviderCatalogEntry("shopify");
    const toolIds = new Set(shopify?.tools.map((tool) => tool.id));

    for (const blockedToolId of [
      "shopify.refunds.create",
      "shopify.refunds.refund",
      "shopify.orders.cancel",
      "shopify.orders.update",
      "shopify.order_addresses.update",
      "shopify.customers.update",
      "shopify.customers.delete",
      "shopify.draft_orders.create",
      "shopify.discounts.create",
      "shopify.discounts.update",
      "shopify.inventory.update",
      "shopify.inventory.delete",
    ]) {
      expect(toolIds.has(blockedToolId)).toBe(false);
    }

    expect(shopify?.capabilities).not.toEqual(expect.arrayContaining([
      "knowledge-source",
      "post-call-sync",
      "ticketing",
      "billing",
    ]));

    const catalogText = JSON.stringify(shopify);
    expect(catalogText).not.toMatch(/\bwrite_|refund|cancel|address.*edit|draft[_ -]?order|discount|inventory/i);
    expect(catalogText).not.toMatch(/\.create|\.update|\.delete|\.refund|\.cancel/i);
    expect(catalogText).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });

  it("exposes Stripe catalog metadata for read-only billing lookup tools only", () => {
    const stripe = getIntegrationProviderCatalogEntry("stripe");

    expect(stripe).toEqual(
      expect.objectContaining({
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
        docs: {
          references: expect.arrayContaining([
            expect.objectContaining({
              label: "Stripe Connect OAuth reference",
              url: "https://docs.stripe.com/connect/oauth-reference",
            }),
            expect.objectContaining({
              label: "Stripe customer search API",
              url: "https://docs.stripe.com/api/customers/search",
            }),
            expect.objectContaining({
              label: "Stripe subscriptions API",
              url: "https://docs.stripe.com/api/subscriptions",
            }),
            expect.objectContaining({
              label: "Stripe invoices API",
              url: "https://docs.stripe.com/api/invoices",
            }),
            expect.objectContaining({
              label: "Stripe PaymentIntents API",
              url: "https://docs.stripe.com/api/payment_intents",
            }),
          ]),
          verifiedAt: "2026-06-05",
        },
      }),
    );

    expect(stripe?.tools).toEqual([
      expect.objectContaining({
        id: "stripe.customers.lookup",
        name: "Look up customer",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_only"],
      }),
      expect.objectContaining({
        id: "stripe.subscriptions.lookup",
        name: "Look up subscription",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_only"],
      }),
      expect.objectContaining({
        id: "stripe.invoices.lookup",
        name: "Look up invoice",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_only"],
      }),
      expect.objectContaining({
        id: "stripe.payment_status.lookup",
        name: "Look up payment status",
        riskPosture: "low",
        capabilities: ["agent-tool"],
        knowledgeSource: false,
        requiredScopes: ["read_only"],
      }),
    ]);
  });

  it("exposes Confluence as a knowledge-source connector without live search tools", () => {
    const confluence = getIntegrationProviderCatalogEntry("confluence");

    expect(confluence).toEqual(
      expect.objectContaining({
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
        docs: {
          references: expect.arrayContaining([
            expect.objectContaining({
              label: "Confluence REST API v2 pages",
              url: "https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/",
            }),
            expect.objectContaining({
              label: "Confluence REST API v2 spaces",
              url: "https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-space/",
            }),
          ]),
          verifiedAt: "2026-06-05",
        },
      }),
    );

    expect(confluence?.tools).toEqual([
      expect.objectContaining({
        id: "confluence.pages.import",
        name: "Import spaces or pages",
        riskPosture: "low",
        capabilities: ["knowledge-source"],
        knowledgeSource: true,
        requiredScopes: ["read:page:confluence", "read:space:confluence"],
      }),
    ]);

    const catalogText = JSON.stringify(confluence);
    expect(catalogText).not.toMatch(/confluence\.pages\.search|live provider knowledge search/i);
    expect(catalogText).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });

  it("exposes SharePoint as a knowledge-source connector separate from Microsoft 365 calendar scopes", () => {
    const sharepoint = getIntegrationProviderCatalogEntry("sharepoint");

    expect(sharepoint).toEqual(
      expect.objectContaining({
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
        docs: {
          references: expect.arrayContaining([
            expect.objectContaining({
              label: "Microsoft Graph drive item children API",
              url: "https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0",
            }),
            expect.objectContaining({
              label: "Microsoft Graph site pages API",
              url: "https://learn.microsoft.com/en-us/graph/api/sitepage-list?view=graph-rest-1.0",
            }),
          ]),
          verifiedAt: "2026-06-05",
        },
      }),
    );

    expect(sharepoint?.tools).toEqual([
      expect.objectContaining({
        id: "sharepoint.items.import",
        name: "Import sites, folders, or pages",
        riskPosture: "low",
        capabilities: ["knowledge-source"],
        knowledgeSource: true,
        requiredScopes: ["Files.Read", "Sites.Read.All"],
      }),
    ]);

    const catalogText = JSON.stringify(sharepoint);
    expect(catalogText).not.toMatch(/Calendars\.Read|Mail\.|Teams|calendar|mailbox/i);
    expect(catalogText).not.toMatch(/sharepoint\.items\.search|live provider knowledge search/i);
    expect(catalogText).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });

  it("does not expose Stripe payment-modifying or generic write tools", () => {
    const stripe = getIntegrationProviderCatalogEntry("stripe");
    const toolIds = new Set(stripe?.tools.map((tool) => tool.id));

    for (const blockedToolId of [
      "stripe.refunds.create",
      "stripe.refunds.refund",
      "stripe.subscriptions.cancel",
      "stripe.subscriptions.update",
      "stripe.payment_methods.update",
      "stripe.payment_methods.attach",
      "stripe.invoices.create",
      "stripe.invoices.update",
      "stripe.coupons.create",
      "stripe.coupons.update",
      "stripe.payment_intents.confirm",
      "stripe.payment_intents.capture",
      "stripe.payment_intents.cancel",
      "stripe.payments.retry",
      "stripe.customers.create",
      "stripe.customers.update",
      "stripe.customers.delete",
    ]) {
      expect(toolIds.has(blockedToolId)).toBe(false);
    }

    const catalogText = JSON.stringify(stripe);
    expect(catalogText).not.toMatch(/refund|cancel|payment[_ -]?method|invoice.*create|coupon|retry/i);
    expect(catalogText).not.toMatch(/\.create|\.update|\.delete|\.refund|\.cancel|\.confirm|\.capture/i);
    expect(catalogText).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });

  it("exposes safe required provider scopes for tenant reconnect prompts", () => {
    const catalog = getIntegrationProviderCatalog();
    const tools = new Map(catalog.flatMap((provider) => provider.tools.map((tool) => [tool.id, tool])));

    expect(tools.get("zendesk.tickets.search")).toEqual(
      expect.objectContaining({
        requiredScopes: ["tickets:read"],
      }),
    );
    expect(tools.get("zendesk.tickets.create")).toEqual(
      expect.objectContaining({
        requiredScopes: ["tickets:write"],
      }),
    );
    expect(tools.get("hubspot.notes.create")).toEqual(
      expect.objectContaining({
        requiredScopes: ["crm.objects.notes.write"],
      }),
    );
    expect(tools.get("google.calendar.events.create")).toEqual(
      expect.objectContaining({
        requiredScopes: ["calendar.events"],
      }),
    );
    expect(tools.get("notion.knowledge.search")).toEqual(
      expect.objectContaining({
        requiredScopes: ["search:read"],
      }),
    );
    expect(tools.get("salesforce.tasks.create")).toEqual(
      expect.objectContaining({
        requiredScopes: ["api", "refresh_token"],
      }),
    );
    expect(tools.get("slack.escalations.post")).toEqual(
      expect.objectContaining({
        requiredScopes: ["chat:write"],
      }),
    );
    expect(tools.get("microsoft365.calendar.availability.read")).toEqual(
      expect.objectContaining({
        requiredScopes: ["Calendars.ReadBasic"],
      }),
    );
    expect(tools.get("microsoft365.calendar.events.create")).toEqual(
      expect.objectContaining({
        requiredScopes: ["Calendars.ReadWrite"],
      }),
    );
    expect(tools.get("intercom.users.lookup")).toEqual(
      expect.objectContaining({
        requiredScopes: ["read_users"],
      }),
    );
    expect(tools.get("intercom.call_summaries.create")).toEqual(
      expect.objectContaining({
        requiredScopes: ["write_conversations"],
      }),
    );
    expect(tools.get("shopify.customers.lookup")).toEqual(
      expect.objectContaining({
        requiredScopes: ["read_customers"],
      }),
    );
    expect(tools.get("shopify.orders.lookup")).toEqual(
      expect.objectContaining({
        requiredScopes: ["read_orders"],
      }),
    );
    expect(tools.get("shopify.fulfillments.lookup")).toEqual(
      expect.objectContaining({
        requiredScopes: ["read_fulfillments"],
      }),
    );
    expect(tools.get("stripe.customers.lookup")).toEqual(
      expect.objectContaining({
        requiredScopes: ["read_only"],
      }),
    );
    expect(tools.get("stripe.subscriptions.lookup")).toEqual(
      expect.objectContaining({
        requiredScopes: ["read_only"],
      }),
    );
    expect(tools.get("stripe.invoices.lookup")).toEqual(
      expect.objectContaining({
        requiredScopes: ["read_only"],
      }),
    );
    expect(tools.get("stripe.payment_status.lookup")).toEqual(
      expect.objectContaining({
        requiredScopes: ["read_only"],
      }),
    );
    expect(tools.get("confluence.pages.import")).toEqual(
      expect.objectContaining({
        requiredScopes: ["read:page:confluence", "read:space:confluence"],
      }),
    );
    expect(tools.get("sharepoint.items.import")).toEqual(
      expect.objectContaining({
        requiredScopes: ["Files.Read", "Sites.Read.All"],
      }),
    );

    expect(JSON.stringify(catalog)).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });
});
