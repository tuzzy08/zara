import { afterEach, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

import { configureCors } from "../config/cors";
import { IntegrationsModule } from "./integrations.module";
import { IntegrationSecretVault } from "./integrations-secret-vault";
import {
  FileIntegrationStateRepository,
  INTEGRATION_STATE_REPOSITORY,
} from "./integrations-state.repository";

describe("IntegrationsController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
        workspaceId: "workspace-support",
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
        workspaceId: "workspace-support",
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
        workspaceId: "workspace-support",
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

  it("creates Zendesk tickets through the documented Tickets API endpoint and payload", async () => {
    const app = await createTestingApp();
    const configureResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/zendesk/configure")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        subdomain: "tuzzy-support",
        email: "support@example.com",
        apiToken: "zendesk-api-token-123456",
      });
    const connectionId = configureResponse.body.connection.id as string;
    const fetchMock = vi.fn(async () => ({
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () =>
        JSON.stringify({
          ticket: {
            id: 4815162342,
            subject: "Refund request",
            status: "new",
            priority: "normal",
          },
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.create/execute")
      .send({
        connectionId,
        input: {
          subject: "Refund request",
          requesterEmail: "ada@example.com",
          body: "Caller needs help with a duplicate invoice.",
          priority: "normal",
        },
      });

    expect(createResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://tuzzy-support.zendesk.com/api/v2/tickets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from("support@example.com/token:zendesk-api-token-123456").toString("base64")}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          ticket: {
            subject: "Refund request",
            requester: {
              email: "ada@example.com",
            },
            comment: {
              body: "Caller needs help with a duplicate invoice.",
            },
            priority: "normal",
          },
        }),
      }),
    );
    expect(createResponse.body.result).toMatchObject({
      provider: "zendesk",
      toolId: "zendesk.tickets.create",
      ticket: {
        id: "4815162342",
        status: "new",
        subject: "Refund request",
        priority: "normal",
      },
    });
    expect(JSON.stringify(createResponse.body)).not.toContain("zendesk-api-token-123456");

    vi.unstubAllGlobals();
    await app.close();
  }, 15_000);

  it("starts a platform OAuth connection and creates a tenant-scoped masked connection on callback", async () => {
    const app = await createTestingApp();

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/zendesk/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations/zendesk/callback",
        requestedScopes: ["tickets:read", "tickets:write"],
      });

    expect(connectResponse.status).toBe(201);
    expect(connectResponse.body.connect).toMatchObject({
      provider: "zendesk",
      status: "pending",
      organizationId: "tenant-west-africa",
      actorUserId: "user-ops-lead",
      requestedScopes: ["tickets:read", "tickets:write"],
    });

    const authorizationUrl = new URL(connectResponse.body.connect.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");

    expect(authorizationUrl.hostname).toBe("oauth.zara.local");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("zara-zendesk-platform-app");
    expect(state).toBeTruthy();
    expect(state).not.toContain("tenant-west-africa");

    const callbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/zendesk/callback")
      .query({
        code: "zendesk-oauth-code-123456",
        state,
      });

    expect(callbackResponse.status).toBe(200);
    expect(callbackResponse.body.connection).toMatchObject({
      provider: "zendesk",
      organizationId: "tenant-west-africa",
      status: "connected",
      connectedBy: "user-ops-lead",
      scopes: ["tickets:read", "tickets:write"],
    });
    expect(callbackResponse.body.connection.credentialReference).toMatchObject({
      provider: "zendesk",
      kind: "oauth-token",
    });
    expect(callbackResponse.body.connection.credentialReference.preview).toBe("...3456");
    expect(callbackResponse.body.connection.accessToken).toBeUndefined();
    expect(callbackResponse.body.connection.refreshToken).toBeUndefined();

    await app.close();
  }, 15_000);

  it("keeps workspace-owned connections local until an audited organization promotion", async () => {
    const app = await createTestingApp();

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/notion/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations/notion/callback",
        requestedScopes: ["search:read"],
        connectionScope: "workspace",
        workspaceId: "workspace-support",
        now: "2026-06-05T08:00:00.000Z",
      });
    const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");
    const callbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/notion/callback")
      .query({
        code: "notion-oauth-code-workspace",
        state,
        now: "2026-06-05T08:01:00.000Z",
      });
    const connectionId = callbackResponse.body.connection.id;

    expect(callbackResponse.status).toBe(200);
    expect(callbackResponse.body.connection).toMatchObject({
      id: connectionId,
      availability: {
        scope: "workspace",
        workspaceId: "workspace-support",
      },
    });

    const supportConnectionsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections?workspaceId=workspace-support",
    );
    const salesConnectionsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections?workspaceId=workspace-sales",
    );

    expect(supportConnectionsResponse.body.connections).toEqual([
      expect.objectContaining({ id: connectionId }),
    ]);
    expect(salesConnectionsResponse.body.connections).toEqual([]);

    const promotionResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/integrations/connections/${connectionId}/promote`)
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-support",
        reason: "Make reviewed support knowledge available to every workspace.",
        now: "2026-06-05T08:02:00.000Z",
      });

    expect(promotionResponse.status).toBe(201);
    expect(promotionResponse.body.connection).toMatchObject({
      id: connectionId,
      availability: {
        scope: "organization",
      },
      auditEvents: expect.arrayContaining([
        expect.objectContaining({
          action: "promoted_to_organization",
          actorUserId: "user-ops-lead",
          actorRole: "admin",
          workspaceId: "workspace-support",
          reason: "Make reviewed support knowledge available to every workspace.",
          at: "2026-06-05T08:02:00.000Z",
        }),
      ]),
    });

    const salesAfterPromotionResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections?workspaceId=workspace-sales",
    );
    const grantsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/tool-grants?workspaceId=workspace-sales",
    );

    expect(salesAfterPromotionResponse.body.connections).toContainEqual(
      expect.objectContaining({ id: connectionId }),
    );
    expect(grantsResponse.body.grants).toEqual([]);

    await app.close();
  }, 15_000);

  it("rejects OAuth connect attempts from non-admin tenant actors", async () => {
    const app = await createTestingApp();

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/zendesk/connect")
      .send({
        actorUserId: "user-frontdesk-viewer",
        actorRole: "viewer",
        redirectUri: "http://127.0.0.1:4173/integrations/zendesk/callback",
        requestedScopes: ["tickets:read"],
      });

    expect(connectResponse.status).toBe(403);
    expect(connectResponse.body.message).toContain("Tenant admin");
    expect(connectResponse.body.connect).toBeUndefined();

    await app.close();
  }, 15_000);

  it("rejects expired OAuth callback state before creating a connection", async () => {
    const app = await createTestingApp();

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/zendesk/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations/zendesk/callback",
        requestedScopes: ["tickets:read"],
        stateTtlSeconds: 1,
        now: "2026-05-16T10:00:00.000Z",
      });

    const authorizationUrl = new URL(connectResponse.body.connect.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");

    const expiredCallbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/zendesk/callback")
      .query({
        code: "zendesk-oauth-code-123456",
        state,
        now: "2026-05-16T10:00:02.000Z",
      });

    expect(expiredCallbackResponse.status).toBe(400);
    expect(expiredCallbackResponse.body.message).toContain("expired");
    expect(expiredCallbackResponse.body.connection).toBeUndefined();

    await app.close();
  }, 15_000);

  it("rejects callback replay after a state has already created a connection", async () => {
    const app = await createTestingApp();

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/zendesk/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations/zendesk/callback",
        requestedScopes: ["tickets:read"],
      });

    const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");

    const firstCallbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/zendesk/callback")
      .query({
        code: "zendesk-oauth-code-123456",
        state,
      });

    expect(firstCallbackResponse.status).toBe(200);

    const replayCallbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/zendesk/callback")
      .query({
        code: "zendesk-oauth-code-replayed",
        state,
      });

    expect(replayCallbackResponse.status).toBe(400);
    expect(replayCallbackResponse.body.message).toContain("invalid or expired");

    const connectionsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections",
    );

    expect(connectionsResponse.status).toBe(200);
    expect(connectionsResponse.body.connections).toHaveLength(1);
    expect(connectionsResponse.body.connections[0].credentialReference.preview).toBe("...3456");

    await app.close();
  }, 15_000);

  it("lets tenant admins grant integration tools to workflows and roles", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "hubspot", ["crm.objects.contacts.read"]);

    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        workflowId: "workflow-live-sandbox-tool-execution-v1",
        roleId: "agent-front-desk",
        toolId: "hubspot.contacts.lookup",
        integrationConnectionId: connection.id,
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);
    expect(grantResponse.body.grant).toMatchObject({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-operations",
      workflowId: "workflow-live-sandbox-tool-execution-v1",
      roleId: "agent-front-desk",
      capability: "agent-tool",
      toolId: "hubspot.contacts.lookup",
      integrationConnectionId: connection.id,
      requiredScopes: ["crm.objects.contacts.read"],
      status: "active",
      approvalRequired: false,
      grantedBy: "user-ops-lead",
    });

    const grantsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/tool-grants?workspaceId=workspace-operations&workflowId=workflow-live-sandbox-tool-execution-v1",
    );

    expect(grantsResponse.status).toBe(200);
    expect(grantsResponse.body.grants).toHaveLength(1);
    expect(grantsResponse.body.grants[0]).toMatchObject({
      toolId: "hubspot.contacts.lookup",
      roleId: "agent-front-desk",
    });

    await app.close();
  }, 15_000);

  it("validates scoped tool grants against connection availability and provider scopes", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "google-workspace", ["calendar.freebusy"], {
      connectionScope: "workspace",
      workspaceId: "workspace-support",
    });

    const wrongWorkspaceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-sales",
        workflowId: "workflow-sales-scheduler-v1",
        roleId: "agent-sales",
        toolId: "google.calendar.availability.read",
        integrationConnectionId: connection.id,
        risk: "low",
        approvalRequired: false,
      });

    expect(wrongWorkspaceResponse.status).toBe(400);
    expect(wrongWorkspaceResponse.body.message).toContain("workspace");

    const missingScopeResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-support",
        workflowId: "workflow-support-scheduler-v1",
        roleId: "agent-support",
        toolId: "google.calendar.events.create",
        integrationConnectionId: connection.id,
        risk: "medium",
        approvalRequired: true,
      });

    expect(missingScopeResponse.status).toBe(400);
    expect(missingScopeResponse.body.message).toContain("calendar.events");
    expect(missingScopeResponse.body.reconnect).toMatchObject({
      provider: "google-workspace",
      connectionId: connection.id,
      missingScopes: ["calendar.events"],
    });

    const validGrantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-support",
        workflowId: "workflow-support-scheduler-v1",
        roleId: "agent-support",
        toolId: "google.calendar.availability.read",
        integrationConnectionId: connection.id,
        risk: "low",
        approvalRequired: false,
      });

    expect(validGrantResponse.status).toBe(201);
    expect(validGrantResponse.body.grant).toMatchObject({
      capability: "agent-tool",
      requiredScopes: ["calendar.freebusy"],
      workspaceId: "workspace-support",
      workflowId: "workflow-support-scheduler-v1",
      roleId: "agent-support",
      toolId: "google.calendar.availability.read",
      integrationConnectionId: connection.id,
    });

    await app.close();
  }, 15_000);

  it("lets tenant admins define masked webhook HTTP tools with timeout and retry policy", async () => {
    const app = await createTestingApp();

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/webhook-tools")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        toolName: "Lookup loyalty profile",
        method: "POST",
        url: "https://hooks.example.test/customers/lookup",
        headers: [{ name: "content-type", value: "application/json" }],
        bodyTemplate: '{"phone":"{{turn.transcript}}"}',
        authToken: "webhook-token-super-secret-1234",
        timeoutMs: 1_500,
        retryPolicy: {
          maxAttempts: 3,
          backoffMs: 25,
        },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.webhookTool).toMatchObject({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-operations",
      provider: "webhook-http",
      toolName: "Lookup loyalty profile",
      request: {
        method: "POST",
        url: "https://hooks.example.test/customers/lookup",
        headers: [{ name: "content-type", value: "application/json" }],
        bodyTemplate: '{"phone":"{{turn.transcript}}"}',
        timeoutMs: 1_500,
        retryPolicy: {
          maxAttempts: 3,
          backoffMs: 25,
        },
      },
    });
    expect(createResponse.body.webhookTool.toolId).toMatch(/^webhook_http_/);
    expect(createResponse.body.webhookTool.request.authToken).toBeUndefined();
    expect(createResponse.body.webhookTool.request.authTokenReference).toMatch(
      /^secret:\/\/webhook-http-tools\//,
    );
    expect(JSON.stringify(createResponse.body)).not.toContain("webhook-token-super-secret-1234");

    const listResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/webhook-tools?workspaceId=workspace-operations",
    );

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.webhookTools).toHaveLength(1);
    expect(listResponse.body.webhookTools[0].request.authToken).toBeUndefined();
    expect(JSON.stringify(listResponse.body)).not.toContain("webhook-token-super-secret-1234");

    await app.close();
  }, 15_000);

  it("shows connector health, revokes connections, and preserves audit history on reconnect", async () => {
    const app = await createTestingApp();

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/hubspot/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations/hubspot/callback",
        requestedScopes: ["crm.objects.contacts.read"],
        now: "2026-05-17T09:00:00.000Z",
      });
    const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");

    const callbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/hubspot/callback")
      .query({
        code: "hubspot-oauth-code-healthy",
        state,
        now: "2026-05-17T09:01:00.000Z",
      });
    const connectionId = callbackResponse.body.connection.id;

    const healthResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/integrations/connections/${connectionId}/health-check`)
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        now: "2026-05-17T09:02:00.000Z",
      });

    expect(healthResponse.status).toBe(201);
    expect(healthResponse.body.connection).toMatchObject({
      id: connectionId,
      provider: "hubspot",
      status: "connected",
      health: {
        status: "healthy",
        checkedAt: "2026-05-17T09:02:00.000Z",
      },
    });
    expect(healthResponse.body.connection.accessToken).toBeUndefined();

    const revokeResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/integrations/connections/${connectionId}/revoke`)
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        reason: "Rotating compromised CRM app access",
        now: "2026-05-17T09:03:00.000Z",
      });

    expect(revokeResponse.status).toBe(201);
    expect(revokeResponse.body.connection).toMatchObject({
      id: connectionId,
      provider: "hubspot",
      status: "revoked",
      revokedBy: "user-ops-lead",
      revokedAt: "2026-05-17T09:03:00.000Z",
      health: {
        status: "revoked",
      },
    });

    const reconnectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/hubspot/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations/hubspot/callback",
        requestedScopes: ["crm.objects.contacts.read"],
        reconnectConnectionId: connectionId,
        now: "2026-05-17T09:04:00.000Z",
      });
    const reconnectState = new URL(
      reconnectResponse.body.connect.authorizationUrl,
    ).searchParams.get("state");

    const reconnectCallbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/hubspot/callback")
      .query({
        code: "hubspot-oauth-code-reconnected",
        state: reconnectState,
        now: "2026-05-17T09:05:00.000Z",
      });

    expect(reconnectCallbackResponse.status).toBe(200);
    expect(reconnectCallbackResponse.body.connection).toMatchObject({
      provider: "hubspot",
      status: "connected",
      reconnectOfConnectionId: connectionId,
    });
    expect(reconnectCallbackResponse.body.connection.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "connected",
          actorUserId: "user-ops-lead",
        }),
        expect.objectContaining({
          action: "reconnect_started",
          priorConnectionId: connectionId,
          actorUserId: "user-ops-lead",
        }),
        expect.objectContaining({
          action: "reconnected",
          priorConnectionId: connectionId,
          actorUserId: "user-ops-lead",
        }),
      ]),
    );

    const connectionsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections",
    );

    expect(connectionsResponse.status).toBe(200);
    expect(connectionsResponse.body.connections).toHaveLength(2);
    expect(connectionsResponse.body.connections).toContainEqual(
      expect.objectContaining({
        id: connectionId,
        status: "revoked",
      }),
    );
    expect(JSON.stringify(connectionsResponse.body)).not.toContain("hubspot-access-token");

    await app.close();
  }, 15_000);

  it("blocks connection deletion with active dependencies and pauses grants on revoke", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "hubspot", ["crm.objects.contacts.read"]);

    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        workflowId: "workflow-support-crm-v1",
        roleId: "agent-support",
        toolId: "hubspot.contacts.lookup",
        integrationConnectionId: connection.id,
        risk: "low",
        approvalRequired: false,
      });
    const grantId = grantResponse.body.grant.id;

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/organizations/tenant-west-africa/integrations/connections/${connection.id}`)
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        reason: "Cleaning up duplicate CRM connection.",
      });

    expect(deleteResponse.status).toBe(409);
    expect(deleteResponse.body.dependencies).toMatchObject({
      activeToolGrantIds: [grantId],
    });

    const revokeResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/integrations/connections/${connection.id}/revoke`)
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        reason: "CRM access was rotated.",
        now: "2026-06-05T11:00:00.000Z",
      });

    expect(revokeResponse.status).toBe(201);

    const grantsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/tool-grants?workspaceId=workspace-operations",
    );

    expect(grantsResponse.body.grants).toContainEqual(
      expect.objectContaining({
        id: grantId,
        status: "paused",
        pausedReason: "integration_connection_revoked",
        pausedAt: "2026-06-05T11:00:00.000Z",
      }),
    );

    await app.close();
  }, 15_000);

  it("executes typed Zendesk ticket tools and returns retryable rate-limit errors", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "zendesk", [
      "tickets:read",
      "tickets:write",
    ]);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/zendesk/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "zendesk.tickets.search",
          requiredScopes: ["tickets:read"],
          inputSchema: expect.objectContaining({
            required: ["query"],
          }),
        }),
        expect.objectContaining({
          toolId: "zendesk.tickets.create",
          requiredScopes: ["tickets:write"],
          inputSchema: expect.objectContaining({
            required: ["subject", "requesterEmail", "body"],
          }),
        }),
        expect.objectContaining({
          toolId: "zendesk.tickets.update",
          requiredScopes: ["tickets:write"],
        }),
      ]),
    );

    const searchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.search/execute")
      .send({
        connectionId: connection.id,
        input: {
          query: "status:open requester:ada@example.com",
        },
      });

    expect(searchResponse.status).toBe(201);
    expect(searchResponse.body.result).toMatchObject({
      provider: "zendesk",
      toolId: "zendesk.tickets.search",
      tickets: [
        expect.objectContaining({
          id: "zd-ticket-1001",
          subject: "Ticket matching status:open requester:ada@example.com",
        }),
      ],
    });

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          subject: "Refund request",
          requesterEmail: "ada@example.com",
          body: "Caller needs help with a duplicate invoice.",
          priority: "normal",
        },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.result).toMatchObject({
      provider: "zendesk",
      ticket: {
        id: expect.stringMatching(/^zd-ticket-/),
        status: "new",
        subject: "Refund request",
      },
    });

    const updateResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.update/execute")
      .send({
        connectionId: connection.id,
        input: {
          ticketId: createResponse.body.result.ticket.id,
          status: "pending",
          comment: "Waiting for invoice confirmation.",
        },
      });

    expect(updateResponse.status).toBe(201);
    expect(updateResponse.body.result).toMatchObject({
      ticket: {
        id: createResponse.body.result.ticket.id,
        status: "pending",
      },
    });

    const rateLimitResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/zendesk/tools/zendesk.tickets.search/execute")
      .send({
        connectionId: connection.id,
        input: {
          query: "rate-limit",
        },
      });

    expect(rateLimitResponse.status).toBe(429);
    expect(rateLimitResponse.body.message).toContain("Zendesk rate limit");
    expect(rateLimitResponse.body.retryAfterSeconds).toBe(30);
    expect(JSON.stringify(rateLimitResponse.body)).not.toContain("zendesk-access-token");

    await app.close();
  }, 15_000);

  it("executes typed HubSpot contact note and pipeline tools with recoverable provider errors", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "hubspot", [
      "crm.objects.contacts.read",
      "crm.objects.notes.write",
      "crm.objects.deals.write",
    ]);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/hubspot/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "hubspot.contacts.lookup",
          requiredScopes: ["crm.objects.contacts.read"],
        }),
        expect.objectContaining({
          toolId: "hubspot.notes.create",
          requiredScopes: ["crm.objects.notes.write"],
        }),
        expect.objectContaining({
          toolId: "hubspot.pipeline.update",
          requiredScopes: ["crm.objects.deals.write"],
        }),
      ]),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          results: [
            {
              id: "hs-contact-ada-example-com",
              properties: {
                email: "ada@example.com",
                lifecyclestage: "customer",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: "hs-note-1001",
          properties: {
            hs_note_body: "Caller asked for a billing follow-up.",
            hs_timestamp: "2026-06-06T10:15:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: "deal-42",
          properties: {
            dealstage: "retention-review",
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          results: [
            {
              id: "hs-contact-1",
              properties: {
                email: "duplicate@example.com",
              },
            },
            {
              id: "hs-contact-2",
              properties: {
                email: "duplicate@example.com",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const lookupResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.contacts.lookup/execute")
      .send({
        connectionId: connection.id,
        input: {
          email: "ada@example.com",
        },
      });

    expect(lookupResponse.status).toBe(201);
    expect(lookupResponse.body.result).toMatchObject({
      provider: "hubspot",
      contact: {
        id: "hs-contact-ada-example-com",
        email: "ada@example.com",
      },
    });

    const noteResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.notes.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          contactId: "hs-contact-ada-example-com",
          body: "Caller asked for a billing follow-up.",
        },
      });

    expect(noteResponse.status).toBe(201);
    expect(noteResponse.body.result).toMatchObject({
      note: {
        contactId: "hs-contact-ada-example-com",
        body: "Caller asked for a billing follow-up.",
      },
    });

    const pipelineResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.pipeline.update/execute")
      .send({
        connectionId: connection.id,
        input: {
          dealId: "deal-42",
          stage: "retention-review",
        },
      });

    expect(pipelineResponse.status).toBe(201);
    expect(pipelineResponse.body.result).toMatchObject({
      deal: {
        id: "deal-42",
        stage: "retention-review",
      },
    });

    const duplicateResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/hubspot/tools/hubspot.contacts.lookup/execute")
      .send({
        connectionId: connection.id,
        input: {
          email: "duplicate@example.com",
        },
      });

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body).toMatchObject({
      provider: "hubspot",
      toolId: "hubspot.contacts.lookup",
      recoverable: true,
      code: "duplicate_contacts",
    });
    expect(JSON.stringify(duplicateResponse.body)).not.toContain("hubspot-access-token");

    await app.close();
  }, 15_000);

  it("executes Google Workspace calendar tools with minimal scopes and timezone-safe payloads", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "google-workspace", [
      "calendar.freebusy",
      "calendar.events",
    ]);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "google.calendar.availability.read",
          requiredScopes: ["calendar.freebusy"],
        }),
        expect.objectContaining({
          toolId: "google.calendar.events.create",
          requiredScopes: ["calendar.events"],
        }),
      ]),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          calendars: {
            primary: {
              busy: [],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: "gcal-event-controller-1",
          summary: "Billing review",
          start: {
            dateTime: "2026-05-21T09:00:00+01:00",
            timeZone: "Africa/Lagos",
          },
          end: {
            dateTime: "2026-05-21T09:30:00+01:00",
            timeZone: "Africa/Lagos",
          },
          attendees: [
            {
              email: "ada@example.com",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const availabilityResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.availability.read/execute")
      .send({
        connectionId: connection.id,
        input: {
          calendarId: "primary",
          start: "2026-05-21T09:00:00+01:00",
          end: "2026-05-21T10:00:00+01:00",
          timezone: "Africa/Lagos",
        },
      });

    expect(availabilityResponse.status).toBe(201);
    expect(availabilityResponse.body.result).toMatchObject({
      provider: "google-workspace",
      calendarId: "primary",
      timezone: "Africa/Lagos",
      busy: [],
      available: true,
    });

    const eventResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.events.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          calendarId: "primary",
          title: "Billing review",
          start: "2026-05-21T09:00:00+01:00",
          end: "2026-05-21T09:30:00+01:00",
          timezone: "Africa/Lagos",
          attendeeEmail: "ada@example.com",
        },
      });

    expect(eventResponse.status).toBe(201);
    expect(eventResponse.body.result).toMatchObject({
      event: {
        id: "gcal-event-controller-1",
        title: "Billing review",
        timezone: "Africa/Lagos",
        start: "2026-05-21T09:00:00+01:00",
        end: "2026-05-21T09:30:00+01:00",
      },
    });

    const limitedConnection = await connectIntegration(app, "google-workspace", [
      "calendar.freebusy",
    ]);
    const missingScopeResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/google-workspace/tools/google.calendar.events.create/execute")
      .send({
        connectionId: limitedConnection.id,
        input: {
          calendarId: "primary",
          title: "Blocked event",
          start: "2026-05-21T11:00:00+01:00",
          end: "2026-05-21T11:30:00+01:00",
          timezone: "Africa/Lagos",
        },
      });

    expect(missingScopeResponse.status).toBe(403);
    expect(missingScopeResponse.body.message).toContain("calendar.events");

    await app.close();
  }, 15_000);

  it("executes Notion knowledge page and task tools with workspace selection and clear permission failures", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "notion", [
      "search:read",
      "pages:write",
      "tasks:write",
    ]);

    const schemasResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connectors/notion/tools",
    );

    expect(schemasResponse.status).toBe(200);
    expect(schemasResponse.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "notion.knowledge.search",
          requiredScopes: ["search:read"],
        }),
        expect.objectContaining({
          toolId: "notion.pages.create",
          requiredScopes: ["pages:write"],
        }),
        expect.objectContaining({
          toolId: "notion.tasks.create",
          requiredScopes: ["tasks:write"],
        }),
      ]),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          results: [
            {
              id: "notion-result-refund",
              url: "https://notion.so/notion-result-refund",
              properties: {
                title: {
                  title: [
                    {
                      plain_text: "Knowledge result for refund policy",
                    },
                  ],
                },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: "notion-page-summary",
          url: "https://notion.so/notion-page-summary",
          properties: {
            title: {
              title: [
                {
                  plain_text: "Billing call summary",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: "notion-task-ada",
          url: "https://notion.so/notion-task-ada",
          properties: {
            title: {
              title: [
                {
                  plain_text: "Follow up with Ada",
                },
              ],
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const searchResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.knowledge.search/execute")
      .send({
        connectionId: connection.id,
        input: {
          query: "refund policy",
        },
      });

    expect(searchResponse.status).toBe(201);
    expect(searchResponse.body.result).toMatchObject({
      provider: "notion",
      workspaceId: "notion:local-account",
      results: [
        expect.objectContaining({
          title: "Knowledge result for refund policy",
        }),
      ],
    });

    const pageResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.pages.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          title: "Billing call summary",
          body: "Caller needs a refund policy follow-up.",
          parentPageId: "page-ops",
        },
      });

    expect(pageResponse.status).toBe(201);
    expect(pageResponse.body.result).toMatchObject({
      page: {
        id: "notion-page-summary",
        workspaceId: "notion:local-account",
        title: "Billing call summary",
      },
    });

    const taskResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.tasks.create/execute")
      .send({
        connectionId: connection.id,
        input: {
          title: "Follow up with Ada",
          assigneeEmail: "ops@example.com",
        },
      });

    expect(taskResponse.status).toBe(201);
    expect(taskResponse.body.result).toMatchObject({
      task: {
        id: "notion-task-ada",
        title: "Follow up with Ada",
        workspaceId: "notion:local-account",
      },
    });

    const limitedConnection = await connectIntegration(app, "notion", ["search:read"]);
    const permissionFailureResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/connectors/notion/tools/notion.pages.create/execute")
      .send({
        connectionId: limitedConnection.id,
        input: {
          title: "Blocked page",
          body: "Missing permission.",
        },
      });

    expect(permissionFailureResponse.status).toBe(403);
    expect(permissionFailureResponse.body.message).toContain("pages:write");

    await app.close();
  }, 15_000);

  it("does not expose integration connections webhook tools or tool grants across tenants", async () => {
    const app = await createTestingApp();

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/hubspot/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations/hubspot/callback",
        requestedScopes: ["crm.objects.contacts.read"],
      });
    const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");
    const callbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/hubspot/callback")
      .query({
        code: "hubspot-oauth-code-isolation",
        state,
      });
    const connectionId = callbackResponse.body.connection.id as string;

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/webhook-tools")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        toolName: "West tenant webhook",
        method: "POST",
        url: "https://hooks.example.test/west",
        authToken: "west-webhook-secret",
        timeoutMs: 1_000,
      });
    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        workflowId: "workflow-west",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: connectionId,
        risk: "medium",
        approvalRequired: false,
      });

    const crossTenantHealthResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/integrations/connections/${connectionId}/health-check`)
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
      });
    const eastConnectionsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-east-africa/integrations/connections",
    );
    const eastWebhookToolsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-east-africa/integrations/webhook-tools?workspaceId=workspace-operations",
    );
    const eastToolGrantsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-east-africa/integrations/tool-grants?workspaceId=workspace-operations",
    );

    expect(crossTenantHealthResponse.status).toBe(404);
    expect(eastConnectionsResponse.status).toBe(200);
    expect(eastConnectionsResponse.body.connections).toEqual([]);
    expect(eastWebhookToolsResponse.status).toBe(200);
    expect(eastWebhookToolsResponse.body.webhookTools).toEqual([]);
    expect(eastToolGrantsResponse.status).toBe(200);
    expect(eastToolGrantsResponse.body.grants).toEqual([]);
    expect(JSON.stringify(eastWebhookToolsResponse.body)).not.toContain("west-webhook-secret");
    expect(JSON.stringify(eastToolGrantsResponse.body)).not.toContain(connectionId);

    await app.close();
  }, 15_000);
});

async function connectIntegration(
  app: INestApplication,
  provider: "zendesk" | "hubspot" | "google-workspace" | "notion",
  requestedScopes: string[],
  scope?: { connectionScope: "organization" | "workspace"; workspaceId?: string | undefined } | undefined,
) {
  const connectResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/integrations/${provider}/connect`)
    .send({
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: `http://127.0.0.1:4173/integrations/${provider}/callback`,
      requestedScopes,
      ...(scope ?? {}),
    });
  const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");
  const callbackResponse = await request(app.getHttpServer())
    .get(`/integrations/oauth/${provider}/callback`)
    .query({
      code: `${provider}-oauth-code-tools`,
      state,
    });

  return callbackResponse.body.connection as { id: string };
}

async function createTestingApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [IntegrationsModule],
  })
    .overrideProvider(INTEGRATION_STATE_REPOSITORY)
    .useValue(
      new FileIntegrationStateRepository(
        join(tmpdir(), "zara-integration-controller-tests", randomUUID()),
      ),
    )
    .overrideProvider(IntegrationSecretVault)
    .useValue(
      new IntegrationSecretVault({
        masterSecret: "integration-secret-123456789012345678",
        keyVersion: 1,
      }),
    )
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  configureCors(app);
  await app.init();

  return app;
}

function mockJsonResponse(status: number, body: unknown) {
  return {
    status,
    headers: new Headers({
      "content-type": "application/json",
    }),
    text: async () => JSON.stringify(body),
  };
}
