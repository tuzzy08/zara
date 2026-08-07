import { afterEach, describe, expect, it, vi } from "vitest";import { Test } from "@nestjs/testing";import type { INestApplication } from "@nestjs/common";import { existsSync, mkdtempSync, rmSync } from "node:fs";import { tmpdir } from "node:os";import { join } from "node:path";import request from "supertest";import { configureCors } from "../config/cors";import { installTestTenantAuth } from "../testing/tenant-auth-request";import { IntegrationsModule } from "./integrations.module";import { IntegrationSecretVault } from "./integrations-secret-vault";import { createTestingApp } from "./integrations.controller.test-support";

describe("IntegrationsController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires tenant membership for tenant integration routes", async () => {
    const app = await createTestingApp({ tenantAuth: false });

    const response = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog",
    );

    expect(response.status).toBe(401);

    await app.close();
  }, 15_000);

  it("serves a tenant-safe provider catalog without server-only connector metadata", async () => {
    const app = await createTestingApp();

    const catalogResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog",
    );

    expect(catalogResponse.status).toBe(200);
    expect(catalogResponse.body.catalog.providers.map((provider: { id: string }) => provider.id)).toEqual([
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
    expect(catalogResponse.body.catalog.providers).toContainEqual(
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
        }),
        tools: expect.arrayContaining([
          expect.objectContaining({
            id: "zendesk.tickets.create",
            name: "Create ticket",
            riskPosture: "medium",
            docs: expect.objectContaining({
              verifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            }),
          }),
        ]),
        docs: expect.objectContaining({
          references: expect.arrayContaining([
            expect.objectContaining({
              url: expect.stringMatching(/^https:\/\/developer\.zendesk\.com\//),
            }),
          ]),
          verifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      }),
    );
    expect(catalogResponse.body.catalog.providers).toContainEqual(
      expect.objectContaining({
        id: "freshdesk",
        label: "Freshdesk Solutions",
        capabilities: ["connection", "knowledge-source"],
        setupSchema: expect.objectContaining({
          type: "api-token",
        }),
        tools: [
          expect.objectContaining({
            id: "freshdesk.solutions.import",
            knowledgeSource: true,
          }),
        ],
      }),
    );
    expect(catalogResponse.body.catalog.providers).toContainEqual(
      expect.objectContaining({
        id: "salesforce-knowledge",
        label: "Salesforce Knowledge",
        capabilities: ["connection", "knowledge-source"],
        tools: [
          expect.objectContaining({
            id: "salesforce-knowledge.articles.import",
            knowledgeSource: true,
          }),
        ],
      }),
    );

    const serialized = JSON.stringify(catalogResponse.body);
    expect(serialized).not.toContain("tenant-west-africa");
    expect(serialized).not.toMatch(/baseUrl|endpointPath|authHeader|secretSchema|executor|clientFactory/i);

    await app.close();
  }, 15_000);

  it("serves the Salesforce provider catalog without server-owned connector metadata", async () => {
    const app = await createTestingApp();

    const salesforceResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog/salesforce",
    );

    expect(salesforceResponse.status).toBe(200);
    expect(salesforceResponse.body.provider).toMatchObject({
      id: "salesforce",
      label: "Salesforce",
      category: "crm",
      capabilities: expect.arrayContaining(["crm", "agent-tool", "post-call-sync"]),
      setupSchema: {
        type: "oauth",
        fields: [],
      },
      tools: expect.arrayContaining([
        expect.objectContaining({
          id: "salesforce.tasks.create",
          riskPosture: "medium",
          requiredScopes: ["api", "refresh_token"],
        }),
        expect.objectContaining({
          id: "salesforce.call_notes.create",
          riskPosture: "medium",
          requiredScopes: ["api", "refresh_token"],
        }),
      ]),
    });
    expect(JSON.stringify(salesforceResponse.body)).not.toMatch(/baseUrl|endpointPath|authHeader|secretSchema|executor|clientFactory/i);

    await app.close();
  }, 15_000);

  it("serves the Slack provider catalog without arbitrary messaging or server-owned connector metadata", async () => {
    const app = await createTestingApp();

    const slackResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog/slack",
    );

    expect(slackResponse.status).toBe(200);
    expect(slackResponse.body.provider).toMatchObject({
      id: "slack",
      label: "Slack",
      category: "productivity",
      capabilities: expect.arrayContaining(["agent-tool", "post-call-sync"]),
      setupSchema: {
        type: "oauth",
        fields: [],
      },
      tools: [
        expect.objectContaining({
          id: "slack.escalations.post",
          riskPosture: "medium",
          requiredScopes: ["chat:write"],
        }),
        expect.objectContaining({
          id: "slack.alerts.post",
          riskPosture: "medium",
          requiredScopes: ["chat:write"],
        }),
        expect.objectContaining({
          id: "slack.call_summaries.post",
          riskPosture: "medium",
          requiredScopes: ["chat:write"],
        }),
      ],
    });
    const serialized = JSON.stringify(slackResponse.body);
    expect(serialized).not.toMatch(/baseUrl|endpointPath|authHeader|secretSchema|executor|clientFactory/i);
    expect(serialized).not.toContain("slack.messages.post");
    expect(serialized).not.toContain("slack.dms.post");
    expect(serialized).not.toContain("slack.channels.history");
    expect(serialized).not.toContain("slack.chat.update");

    await app.close();
  }, 15_000);

  it("serves the Microsoft 365 provider catalog without mail, Teams, or server-owned connector metadata", async () => {
    const app = await createTestingApp();

    const microsoft365Response = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog/microsoft-365",
    );

    expect(microsoft365Response.status).toBe(200);
    expect(microsoft365Response.body.provider).toMatchObject({
      id: "microsoft-365",
      label: "Microsoft 365",
      category: "productivity",
      logoToken: "microsoft-365",
      capabilities: expect.arrayContaining(["calendar", "agent-tool"]),
      setupSchema: {
        type: "oauth",
        fields: [],
      },
      tools: [
        expect.objectContaining({
          id: "microsoft365.calendar.availability.read",
          requiredScopes: ["Calendars.ReadBasic"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "microsoft365.calendar.events.create",
          requiredScopes: ["Calendars.ReadWrite"],
          riskPosture: "medium",
        }),
      ],
    });
    const serialized = JSON.stringify(microsoft365Response.body);
    expect(serialized).not.toMatch(/Mail\.|mailbox|email|Teams|chatMessage/i);
    expect(serialized).not.toMatch(/User\.ReadWrite\.All|Calendars\.ReadWrite\.Shared/i);
    expect(serialized).not.toMatch(/baseUrl|endpointPath|authHeader|secretSchema|executor|clientFactory/i);

    await app.close();
  }, 15_000);

  it("serves the Intercom provider catalog without external replies, mutations, or server-owned connector metadata", async () => {
    const app = await createTestingApp();

    const intercomResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog/intercom",
    );

    expect(intercomResponse.status).toBe(200);
    expect(intercomResponse.body.provider).toMatchObject({
      id: "intercom",
      label: "Intercom",
      category: "support",
      logoToken: "intercom",
      capabilities: expect.arrayContaining(["agent-tool", "post-call-sync", "knowledge-source"]),
      knowledgeSource: {
        supported: true,
        modes: ["snapshot-import", "recurring-sync"],
      },
      setupSchema: {
        type: "oauth",
        fields: [],
      },
      tools: [
        expect.objectContaining({
          id: "intercom.users.lookup",
          requiredScopes: ["read_users"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "intercom.companies.lookup",
          requiredScopes: ["read_companies"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "intercom.conversations.lookup",
          requiredScopes: ["read_conversations"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "intercom.internal_notes.create",
          requiredScopes: ["write_conversations"],
          riskPosture: "medium",
        }),
        expect.objectContaining({
          id: "intercom.call_summaries.create",
          requiredScopes: ["write_conversations"],
          riskPosture: "medium",
        }),
      ],
    });
    const serialized = JSON.stringify(intercomResponse.body);
    expect(serialized).not.toMatch(/external[_ -]?reply|reply\.create|conversations\.close|conversations\.assign/i);
    expect(serialized).not.toMatch(/users\.update|companies\.update|outbound|messages\.create/i);
    expect(serialized).not.toMatch(/articles\.search|live provider knowledge search/i);
    expect(serialized).not.toMatch(/baseUrl|endpointPath|authHeader|secretSchema|executor|clientFactory/i);

    await app.close();
  }, 15_000);

  it("serves knowledge-source provider catalogs for Confluence and SharePoint without live search or server metadata", async () => {
    const app = await createTestingApp();

    const confluenceResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog/confluence",
    );
    const sharepointResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog/sharepoint",
    );

    expect(confluenceResponse.status).toBe(200);
    expect(confluenceResponse.body.provider).toMatchObject({
      id: "confluence",
      label: "Confluence",
      category: "knowledge",
      logoToken: "confluence",
      capabilities: ["connection", "knowledge-source"],
      knowledgeSource: {
        supported: true,
        modes: ["snapshot-import", "recurring-sync"],
      },
      setupSchema: {
        type: "oauth",
        fields: [],
      },
      tools: [
        expect.objectContaining({
          id: "confluence.pages.import",
          knowledgeSource: true,
          requiredScopes: ["read:page:confluence", "read:space:confluence"],
          riskPosture: "low",
        }),
      ],
    });

    expect(sharepointResponse.status).toBe(200);
    expect(sharepointResponse.body.provider).toMatchObject({
      id: "sharepoint",
      label: "SharePoint",
      category: "knowledge",
      logoToken: "sharepoint",
      capabilities: ["connection", "knowledge-source"],
      knowledgeSource: {
        supported: true,
        modes: ["snapshot-import", "recurring-sync"],
      },
      setupSchema: {
        type: "oauth",
        fields: [],
      },
      tools: [
        expect.objectContaining({
          id: "sharepoint.items.import",
          knowledgeSource: true,
          requiredScopes: ["Files.Read", "Sites.Read.All"],
          riskPosture: "low",
        }),
      ],
    });

    const serialized = `${JSON.stringify(confluenceResponse.body)} ${JSON.stringify(sharepointResponse.body)}`;
    expect(serialized).not.toMatch(/live provider knowledge search|\.search/i);
    expect(serialized).not.toMatch(/baseUrl|endpointPath|authHeader|secretSchema|executor|clientFactory/i);
    expect(JSON.stringify(sharepointResponse.body)).not.toMatch(/Calendars\.Read|Mail\.|Teams|mailbox/i);

    await app.close();
  }, 15_000);

  it("serves the Shopify provider catalog without write tools or server-owned connector metadata", async () => {
    const app = await createTestingApp();

    const shopifyResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog/shopify",
    );

    expect(shopifyResponse.status).toBe(200);
    expect(shopifyResponse.body.provider).toMatchObject({
      id: "shopify",
      label: "Shopify",
      category: "ecommerce",
      logoToken: "shopify",
      capabilities: expect.arrayContaining(["connection", "agent-tool"]),
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
      tools: [
        expect.objectContaining({
          id: "shopify.customers.lookup",
          requiredScopes: ["read_customers"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "shopify.orders.lookup",
          requiredScopes: ["read_orders"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "shopify.fulfillments.lookup",
          requiredScopes: ["read_fulfillments"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "shopify.shipping_status.lookup",
          requiredScopes: ["read_orders", "read_fulfillments"],
          riskPosture: "low",
        }),
      ],
    });
    const serialized = JSON.stringify(shopifyResponse.body);
    expect(serialized).not.toMatch(/\bwrite_|refund|cancel|address.*edit|draft[_ -]?order|discount|inventory/i);
    expect(serialized).not.toMatch(/\.create|\.update|\.delete|\.refund|\.cancel/i);
    expect(serialized).not.toMatch(/baseUrl|endpointPath|authHeader|secretSchema|executor|clientFactory/i);

    await app.close();
  }, 15_000);

  it("rejects unsupported provider catalog reads", async () => {
    const app = await createTestingApp();

    const unsupportedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog/unknown-crm",
    );

    expect(unsupportedResponse.status).toBe(404);
    expect(unsupportedResponse.body.message).toContain("Provider is not supported");
    expect(unsupportedResponse.body.provider).toBeUndefined();

    await app.close();
  }, 15_000);

  it("requires Shopify shop setup and normalizes the shop domain before OAuth", async () => {
    const app = await createTestingApp();

    const missingSetupResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/shopify/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations",
        requestedScopes: ["read_customers", "read_orders", "read_fulfillments"],
        connectionScope: "workspace",
        workspaceId: "workspace-customer-success",
      });

    expect(missingSetupResponse.status).toBe(400);
    expect(missingSetupResponse.body.message).toContain("Shopify store domain is required");

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/shopify/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations",
        requestedScopes: ["read_customers", "read_orders", "read_fulfillments"],
        connectionScope: "workspace",
        workspaceId: "workspace-customer-success",
        shopDomain: "tuzzy-store",
      });

    expect(connectResponse.status).toBe(201);
    const authorizationUrl = new URL(connectResponse.body.connect.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    expect(authorizationUrl.searchParams.get("shop")).toBe("tuzzy-store.myshopify.com");
    expect(state).toEqual(expect.any(String));
    expect(JSON.stringify(connectResponse.body)).not.toContain("admin/api");
    expect(JSON.stringify(connectResponse.body)).not.toContain("graphql.json");

    const callbackResponse = await request(app.getHttpServer()).get("/integrations/oauth/shopify/callback").query({
      organizationId: "tenant-west-africa",
      state,
      code: "shopify-oauth-code-controller",
    });

    expect(callbackResponse.status).toBe(200);
    expect(callbackResponse.body.connection).toMatchObject({
      provider: "shopify",
      accountLabel: "tuzzy-store.myshopify.com",
      credentialReference: {
        provider: "shopify",
        kind: "oauth-token",
      },
    });
    expect(JSON.stringify(callbackResponse.body)).not.toContain("shopify:access:shopify-oauth-code-controller");
    expect(JSON.stringify(callbackResponse.body)).not.toContain("admin/api");

    await app.close();
  }, 15_000);

  it("serves the Stripe provider catalog without billing write tools or server-owned connector metadata", async () => {
    const app = await createTestingApp();

    const stripeResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/catalog/stripe",
    );

    expect(stripeResponse.status).toBe(200);
    expect(stripeResponse.body.provider).toMatchObject({
      id: "stripe",
      label: "Stripe",
      category: "billing",
      logoToken: "stripe",
      capabilities: expect.arrayContaining(["connection", "agent-tool"]),
      setupSchema: {
        type: "oauth",
        fields: [],
      },
      tools: [
        expect.objectContaining({
          id: "stripe.customers.lookup",
          requiredScopes: ["read_only"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "stripe.subscriptions.lookup",
          requiredScopes: ["read_only"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "stripe.invoices.lookup",
          requiredScopes: ["read_only"],
          riskPosture: "low",
        }),
        expect.objectContaining({
          id: "stripe.payment_status.lookup",
          requiredScopes: ["read_only"],
          riskPosture: "low",
        }),
      ],
    });
    const serialized = JSON.stringify(stripeResponse.body);
    expect(serialized).not.toMatch(/refund|cancel|payment.?method|invoice.?create|coupon|retry/i);
    expect(serialized).not.toMatch(/\.create|\.update|\.delete|\.refund|\.cancel|\.confirm|\.capture/i);
    expect(serialized).not.toMatch(/baseUrl|endpointPath|authHeader|secretSchema|executor|clientFactory/i);

    await app.close();
  }, 15_000);

  it("starts Stripe read-only OAuth without exposing provider API details or brittle write scopes", async () => {
    const app = await createTestingApp();

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/stripe/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations",
        requestedScopes: ["read_only"],
        connectionScope: "workspace",
        workspaceId: "workspace-customer-success",
      });

    expect(connectResponse.status).toBe(201);
    const authorizationUrl = new URL(connectResponse.body.connect.authorizationUrl);
    expect(authorizationUrl.hostname).toBe("oauth.zara.local");
    expect(authorizationUrl.pathname).toBe("/stripe/authorize");
    expect(authorizationUrl.searchParams.get("scope")).toBeNull();
    expect(JSON.stringify(connectResponse.body)).not.toContain("api.stripe.com");
    expect(JSON.stringify(connectResponse.body)).not.toMatch(/read_write|secret|Bearer/i);

    await app.close();
  }, 15_000);

  it("lets tenant admins configure Zendesk API token credentials without tenant-owned API URLs", async () => {
    const app = await createTestingApp();

    const configureResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/zendesk/configure")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        subdomain: "tuzzy-support",
        email: "support@example.com",
        apiToken: "zendesk-api-token-123456",
        apiUrl: "https://tenant-controlled.example.test/api/v2/tickets",
      });

    expect(configureResponse.status).toBe(201);
    expect(configureResponse.body.connection).toMatchObject({
      provider: "zendesk",
      organizationId: "tenant-west-africa",
      status: "connected",
      connectedBy: "user-ops-lead",
      scopes: ["tickets:read", "tickets:write"],
      accountLabel: "tuzzy-support.zendesk.com",
      credentialReference: {
        provider: "zendesk",
        kind: "api-token",
      },
    });
    expect(configureResponse.body.connection.credentialReference.preview).toContain("support@example.com");
    expect(JSON.stringify(configureResponse.body)).not.toContain("zendesk-api-token-123456");
    expect(JSON.stringify(configureResponse.body)).not.toContain("tenant-controlled.example.test");

    const healthResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/integrations/connections/${configureResponse.body.connection.id}/health-check`)
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
      });

    expect(healthResponse.status).toBe(201);
    expect(healthResponse.body.connection.health).toMatchObject({
      status: "healthy",
      message: "Connector credentials are available.",
    });

    await app.close();
  }, 15_000);

  it("rotates Zendesk API-token connections through the credential configure endpoint", async () => {
    const app = await createTestingApp();

    const configureResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/zendesk/configure")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        subdomain: "tuzzy-support",
        email: "support@example.com",
        apiToken: "zendesk-api-token-123456",
        connectionScope: "workspace",
        workspaceId: "workspace-customer-success",
        now: "2026-06-10T19:00:00.000Z",
      });
    const priorConnectionId = configureResponse.body.connection.id;

    const reconnectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/zendesk/configure")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        reconnectConnectionId: priorConnectionId,
        subdomain: "roylessolutions",
        email: "support@roylessolutions.com",
        apiToken: "new-zendesk-api-token-987654",
        connectionScope: "workspace",
        workspaceId: "workspace-customer-success",
        now: "2026-06-10T19:10:00.000Z",
      });

    expect(reconnectResponse.status).toBe(201);
    expect(reconnectResponse.body.connection).toMatchObject({
      provider: "zendesk",
      status: "connected",
      reconnectOfConnectionId: priorConnectionId,
      availability: {
        scope: "workspace",
        workspaceId: "workspace-customer-success",
      },
      accountLabel: "roylessolutions.zendesk.com",
      credentialReference: {
        provider: "zendesk",
        kind: "api-token",
      },
    });
    expect(reconnectResponse.body.connection.id).not.toBe(priorConnectionId);
    expect(reconnectResponse.body.connection.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "reconnected",
          priorConnectionId: priorConnectionId,
        }),
      ]),
    );
    expect(JSON.stringify(reconnectResponse.body)).not.toContain("new-zendesk-api-token-987654");

    await app.close();
  }, 15_000);

  it("falls back to the default integration state directory when the env var is blank", async () => {
    const originalIntegrationStateDir = process.env.ZARA_INTEGRATION_STATE_DIR;
    const originalCwd = process.cwd();
    const tempRoot = mkdtempSync(join(tmpdir(), "zara-integration-state-default-"));
    let app: INestApplication | undefined;

    try {
      process.env.ZARA_INTEGRATION_STATE_DIR = "";
      process.chdir(tempRoot);

      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule],
      })
        .overrideProvider(IntegrationSecretVault)
        .useValue(
          new IntegrationSecretVault({
            masterSecret: "integration-secret-123456789012345678",
            keyVersion: 1,
          }),
        )
        .compile();

      app = moduleRef.createNestApplication();
      configureCors(app);
      installTestTenantAuth(app);
      await app.init();

      const configureResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/integrations/zendesk/configure")
        .send({
          actorUserId: "user-ops-lead",
          actorRole: "admin",
          subdomain: "tuzzy-support",
          email: "support@example.com",
          apiToken: "zendesk-api-token-123456",
        });

      expect(configureResponse.status).toBe(201);
      expect(
        existsSync(join(tempRoot, ".zara", "integrations", "tenant-west-africa.json")),
      ).toBe(true);
    } finally {
      await app?.close();
      process.chdir(originalCwd);

      if (originalIntegrationStateDir === undefined) {
        delete process.env.ZARA_INTEGRATION_STATE_DIR;
      } else {
        process.env.ZARA_INTEGRATION_STATE_DIR = originalIntegrationStateDir;
      }

      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 15_000);
});
