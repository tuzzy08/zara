import { afterEach, describe, expect, it, vi } from "vitest";import request from "supertest";import { withTestTenantAuth } from "../testing/tenant-auth-request";import { connectIntegration, createTestingApp } from "./integrations.controller.test-support";

describe("IntegrationsController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
        workspaceId: "workspace-customer-success",
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
        workspaceId: "workspace-customer-success",
      },
    });

    const supportConnectionsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections?workspaceId=workspace-customer-success",
    );
    const salesConnectionsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections?workspaceId=workspace-growth",
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
        workspaceId: "workspace-customer-success",
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
          workspaceId: "workspace-customer-success",
          reason: "Make reviewed support knowledge available to every workspace.",
          at: "2026-06-05T08:02:00.000Z",
        }),
      ]),
    });

    const salesAfterPromotionResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections?workspaceId=workspace-growth",
    );
    const grantsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/tool-grants?workspaceId=workspace-growth",
    );

    expect(salesAfterPromotionResponse.body.connections).toContainEqual(
      expect.objectContaining({ id: connectionId }),
    );
    expect(grantsResponse.body.grants).toEqual([]);

    await app.close();
  }, 15_000);

  it("rejects OAuth connect attempts from non-admin tenant actors", async () => {
    const app = await createTestingApp();

    const connectResponse = await withTestTenantAuth(
      request(app.getHttpServer()).post("/organizations/tenant-west-africa/integrations/zendesk/connect"),
      { role: "viewer", userId: "user-frontdesk-viewer" },
    )
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

  it("lets tenant admins grant integration tools to agents", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "hubspot", ["crm.objects.contacts.read"]);

    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        agentId: "agent-front-desk",
        toolId: "hubspot.contacts.lookup",
        integrationConnectionId: connection.id,
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);
    expect(grantResponse.body.grant).toMatchObject({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      agentId: "agent-front-desk",
      capability: "agent-tool",
      toolId: "hubspot.contacts.lookup",
      integrationConnectionId: connection.id,
      requiredScopes: ["crm.objects.contacts.read"],
      status: "active",
      approvalRequired: false,
      grantedBy: "user-ops-lead",
    });

    const grantsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/tool-grants?workspaceId=workspace-default",
    );

    expect(grantsResponse.status).toBe(200);
    expect(grantsResponse.body.grants).toHaveLength(1);
    expect(grantsResponse.body.grants[0]).toMatchObject({
      toolId: "hubspot.contacts.lookup",
      agentId: "agent-front-desk",
    });

    await app.close();
  }, 15_000);

  it("validates scoped tool grants against connection availability and provider scopes", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "google-workspace", ["calendar.freebusy"], {
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
    });

    const wrongWorkspaceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-growth",
        agentId: "agent-sales",
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
        workspaceId: "workspace-customer-success",
        agentId: "agent-support",
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
        workspaceId: "workspace-customer-success",
        agentId: "agent-support",
        toolId: "google.calendar.availability.read",
        integrationConnectionId: connection.id,
        risk: "low",
        approvalRequired: false,
      });

    expect(validGrantResponse.status).toBe(201);
    expect(validGrantResponse.body.grant).toMatchObject({
      capability: "agent-tool",
      requiredScopes: ["calendar.freebusy"],
      workspaceId: "workspace-customer-success",
      agentId: "agent-support",
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
        workspaceId: "workspace-default",
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
      workspaceId: "workspace-default",
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
      "/organizations/tenant-west-africa/integrations/webhook-tools?workspaceId=workspace-default",
    );

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.webhookTools).toHaveLength(1);
    expect(listResponse.body.webhookTools[0].request.authToken).toBeUndefined();
    expect(JSON.stringify(listResponse.body)).not.toContain("webhook-token-super-secret-1234");

    await app.close();
  }, 15_000);

  it("shows connector health and preserves audit history on reconnect", async () => {
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

    const reconnectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/hubspot/connect")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations/hubspot/callback",
        requestedScopes: ["crm.objects.contacts.read"],
        reconnectConnectionId: connectionId,
        now: "2026-05-17T09:03:00.000Z",
      });
    const reconnectState = new URL(
      reconnectResponse.body.connect.authorizationUrl,
    ).searchParams.get("state");

    const reconnectCallbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/hubspot/callback")
      .query({
        code: "hubspot-oauth-code-reconnected",
        state: reconnectState,
        now: "2026-05-17T09:04:00.000Z",
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
        status: "connected",
      }),
    );
    expect(JSON.stringify(connectionsResponse.body)).not.toContain("hubspot-access-token");

    await app.close();
  }, 15_000);

  it("uses delete as the only integration connection removal path and removes dependent grants", async () => {
    const app = await createTestingApp();
    const connection = await connectIntegration(app, "hubspot", ["crm.objects.contacts.read"]);

    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        agentId: "agent-support",
        toolId: "hubspot.contacts.lookup",
        integrationConnectionId: connection.id,
        risk: "low",
        approvalRequired: false,
      });
    const grantId = grantResponse.body.grant.id;

    const revokeResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/integrations/connections/${connection.id}/revoke`)
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        reason: "Legacy revoke should not be public.",
      });

    expect(revokeResponse.status).toBe(404);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/organizations/tenant-west-africa/integrations/connections/${connection.id}`)
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        reason: "Remove duplicate CRM connection.",
        now: "2026-06-05T11:00:00.000Z",
      });

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.deleted).toMatchObject({
      id: connection.id,
      deletedAt: "2026-06-05T11:00:00.000Z",
      deletedBy: "user-ops-lead",
    });

    const grantsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/tool-grants?workspaceId=workspace-default",
    );
    const connectionsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/integrations/connections",
    );

    expect(grantsResponse.body.grants).not.toContainEqual(expect.objectContaining({ id: grantId }));
    expect(connectionsResponse.body.connections).not.toContainEqual(expect.objectContaining({ id: connection.id }));

    await app.close();
  }, 15_000);
});
