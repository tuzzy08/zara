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

  it("groups Intercom lookup and note tools under Intercom with write tools approval-required", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const intercomProvider = getToolProviderOptions(catalog).find((provider) => provider.connector === "intercom");

    expect(intercomProvider?.label).toBe("Intercom");
    expect(intercomProvider?.tools.map((tool) => tool.toolId)).toEqual([
      "intercom.users.lookup",
      "intercom.companies.lookup",
      "intercom.conversations.lookup",
      "intercom.internal_notes.create",
      "intercom.call_summaries.create",
    ]);

    for (const toolId of [
      "intercom.users.lookup",
      "intercom.companies.lookup",
      "intercom.conversations.lookup",
    ]) {
      expect(getToolCatalogItem(catalog, toolId)).toMatchObject({
        connector: "intercom",
        risk: "low",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      });
    }

    for (const toolId of [
      "intercom.internal_notes.create",
      "intercom.call_summaries.create",
    ]) {
      expect(getToolCatalogItem(catalog, toolId)).toMatchObject({
        connector: "intercom",
        risk: "medium",
        requiresAuthorization: true,
        requiresHumanApproval: true,
      });
    }

    expect(getToolCatalogItem(catalog, "intercom.external_replies.create")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "intercom.conversations.close")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "intercom.conversations.assign")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "intercom.users.update")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "intercom.companies.update")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "intercom.outbound_messages.create")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "intercom.articles.search")).toBeUndefined();
  });

  it("groups Shopify read-only commerce lookup tools under Shopify", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const shopifyProvider = getToolProviderOptions(catalog).find((provider) => provider.connector === "shopify");

    expect(shopifyProvider?.label).toBe("Shopify");
    expect(shopifyProvider?.tools.map((tool) => tool.toolId)).toEqual([
      "shopify.customers.lookup",
      "shopify.orders.lookup",
      "shopify.fulfillments.lookup",
      "shopify.shipping_status.lookup",
    ]);

    for (const toolId of [
      "shopify.customers.lookup",
      "shopify.orders.lookup",
      "shopify.fulfillments.lookup",
      "shopify.shipping_status.lookup",
    ]) {
      expect(getToolCatalogItem(catalog, toolId)).toMatchObject({
        connector: "shopify",
        risk: "low",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      });
    }

    for (const writeToolId of [
      "shopify.refunds.create",
      "shopify.refunds.refund",
      "shopify.orders.cancel",
      "shopify.orders.update",
      "shopify.order_addresses.update",
      "shopify.customers.update",
      "shopify.customers.delete",
      "shopify.draft_orders.create",
      "shopify.discounts.update",
      "shopify.inventory.update",
    ]) {
      expect(getToolCatalogItem(catalog, writeToolId)).toBeUndefined();
    }
  });

  it("groups Stripe read-only billing lookup tools under Stripe", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const stripeProvider = getToolProviderOptions(catalog).find((provider) => provider.connector === "stripe");

    expect(stripeProvider?.label).toBe("Stripe");
    expect(stripeProvider?.tools.map((tool) => tool.toolId)).toEqual([
      "stripe.customers.lookup",
      "stripe.subscriptions.lookup",
      "stripe.invoices.lookup",
      "stripe.payment_status.lookup",
    ]);

    for (const toolId of [
      "stripe.customers.lookup",
      "stripe.subscriptions.lookup",
      "stripe.invoices.lookup",
      "stripe.payment_status.lookup",
    ]) {
      expect(getToolCatalogItem(catalog, toolId)).toMatchObject({
        connector: "stripe",
        risk: "low",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      });
    }

    for (const writeToolId of [
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
      expect(getToolCatalogItem(catalog, writeToolId)).toBeUndefined();
    }
  });

  it("keeps knowledge-source-only providers out of workflow tool bindings", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const toolProviderConnectors = getToolProviderOptions(catalog).map((provider) => provider.connector);

    expect(getToolCatalogItem(catalog, "confluence.pages.import")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "sharepoint.items.import")).toBeUndefined();
    expect(toolProviderConnectors).not.toContain("confluence");
    expect(toolProviderConnectors).not.toContain("sharepoint");
  });

  it("keeps Freshdesk Solutions and Salesforce Knowledge imports out of workflow tool bindings", () => {
    const catalog = createWorkflowToolCatalog(getIntegrationProviderCatalog());
    const toolProviderConnectors = getToolProviderOptions(catalog).map((provider) => provider.connector);

    expect(getToolCatalogItem(catalog, "freshdesk.solutions.import")).toBeUndefined();
    expect(getToolCatalogItem(catalog, "salesforce-knowledge.articles.import")).toBeUndefined();
    expect(toolProviderConnectors).not.toContain("freshdesk");
    expect(toolProviderConnectors).not.toContain("salesforce-knowledge");
  });

  it("selects Slack connections only for Slack tool bindings", () => {
    const options = getIntegrationOptionsForConnector("slack", {
      connections: [
        {
          id: "slack-prod",
          provider: "slack",
          status: "connected",
          scopes: ["chat:write"],
          availability: { scope: "workspace", workspaceId: "workspace-customer-success" },
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
          availability: { scope: "workspace", workspaceId: "workspace-customer-success" },
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

  it("selects Intercom connections only for Intercom tool bindings", () => {
    const options = getIntegrationOptionsForConnector("intercom", {
      connections: [
        {
          id: "intercom-prod",
          provider: "intercom",
          status: "connected",
          scopes: ["read_users", "read_companies", "read_conversations", "write_conversations", "read_articles"],
          availability: { scope: "workspace", workspaceId: "workspace-customer-success" },
          credentialReference: { kind: "oauth-token", preview: "...intercom" },
          accountLabel: "Intercom Support",
          connectedAt: "2026-06-05T10:00:00.000Z",
          health: { status: "healthy" },
        },
        {
          id: "zendesk-prod",
          provider: "zendesk",
          status: "connected",
          scopes: ["tickets:read", "tickets:write"],
          availability: { scope: "organization" },
          credentialReference: { kind: "oauth-token", preview: "...zendesk" },
          accountLabel: "Zendesk",
          connectedAt: "2026-06-05T10:00:00.000Z",
          health: { status: "healthy" },
        },
      ],
    });

    expect(options).toEqual([
      { value: "intercom-prod", label: "Intercom Support", status: "connected" },
    ]);
  });

  it("selects Shopify connections only for Shopify tool bindings", () => {
    const options = getIntegrationOptionsForConnector("shopify", {
      connections: [
        {
          id: "shopify-prod",
          provider: "shopify",
          status: "connected",
          scopes: ["read_customers", "read_orders", "read_fulfillments"],
          availability: { scope: "workspace", workspaceId: "workspace-customer-success" },
          credentialReference: { kind: "oauth-token", preview: "...shop" },
          accountLabel: "Shopify Storefront",
          connectedAt: "2026-06-07T10:00:00.000Z",
          health: { status: "healthy" },
        },
        {
          id: "intercom-prod",
          provider: "intercom",
          status: "connected",
          scopes: ["read_users"],
          availability: { scope: "organization" },
          credentialReference: { kind: "oauth-token", preview: "...intercom" },
          accountLabel: "Intercom Support",
          connectedAt: "2026-06-07T10:00:00.000Z",
          health: { status: "healthy" },
        },
      ],
    });

    expect(options).toEqual([
      { value: "shopify-prod", label: "Shopify Storefront", status: "connected" },
    ]);
  });

  it("selects Stripe connections only for Stripe tool bindings", () => {
    const options = getIntegrationOptionsForConnector("stripe", {
      connections: [
        {
          id: "stripe-prod",
          provider: "stripe",
          status: "connected",
          scopes: ["read_only"],
          availability: { scope: "workspace", workspaceId: "workspace-customer-success" },
          credentialReference: { kind: "oauth-token", preview: "...stripe" },
          accountLabel: "Stripe Billing",
          connectedAt: "2026-06-07T10:00:00.000Z",
          health: { status: "healthy" },
        },
        {
          id: "shopify-prod",
          provider: "shopify",
          status: "connected",
          scopes: ["read_customers"],
          availability: { scope: "organization" },
          credentialReference: { kind: "oauth-token", preview: "...shop" },
          accountLabel: "Shopify Storefront",
          connectedAt: "2026-06-07T10:00:00.000Z",
          health: { status: "healthy" },
        },
      ],
    });

    expect(options).toEqual([
      { value: "stripe-prod", label: "Stripe Billing", status: "connected" },
    ]);
  });

  it("requests minimal Microsoft 365 Outlook Calendar scopes when starting OAuth", async () => {
    await startIntegrationConnect("tenant-west-africa", "microsoft-365", {
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
    });

    expect(requestJson).toHaveBeenCalledWith(
      "/organizations/tenant-west-africa/integrations/microsoft-365/connect",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"requestedScopes":["Calendars.ReadBasic","Calendars.ReadWrite"]'),
      }),
    );
  });

  it("requests minimal Intercom v1 scopes when starting OAuth", async () => {
    await startIntegrationConnect("tenant-west-africa", "intercom", {
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
    });

    expect(requestJson).toHaveBeenCalledWith(
      "/organizations/tenant-west-africa/integrations/intercom/connect",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(
          '"requestedScopes":["read_users","read_companies","read_conversations","write_conversations","read_articles"]',
        ),
      }),
    );
  });

  it("requests minimal Shopify read-only scopes when starting OAuth", async () => {
    await startIntegrationConnect("tenant-west-africa", "shopify", {
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      shopDomain: "tuzzy-store.myshopify.com",
    });

    expect(requestJson).toHaveBeenCalledWith(
      "/organizations/tenant-west-africa/integrations/shopify/connect",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"requestedScopes":["read_customers","read_orders","read_fulfillments"]'),
      }),
    );
    expect(requestJson).toHaveBeenCalledWith(
      "/organizations/tenant-west-africa/integrations/shopify/connect",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"shopDomain":"tuzzy-store.myshopify.com"'),
      }),
    );
  });

  it("requests Stripe read-only OAuth scope when starting OAuth", async () => {
    await startIntegrationConnect("tenant-west-africa", "stripe", {
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
    });

    expect(requestJson).toHaveBeenCalledWith(
      "/organizations/tenant-west-africa/integrations/stripe/connect",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"requestedScopes":["read_only"]'),
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
