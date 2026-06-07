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
    expect(getIntegrationProviderCatalogEntry("intercom")).toBeUndefined();
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

    expect(JSON.stringify(catalog)).not.toMatch(/baseUrl|endpoint|authHeader|secretSchema|executor|clientFactory/i);
  });
});
