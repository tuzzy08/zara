import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
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

    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        workflowId: "workflow-live-sandbox-tool-execution-v1",
        roleId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);
    expect(grantResponse.body.grant).toMatchObject({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-operations",
      workflowId: "workflow-live-sandbox-tool-execution-v1",
      roleId: "agent-front-desk",
      toolId: "hubspot.profile.lookup",
      integrationConnectionId: "hubspot-prod",
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
      toolId: "hubspot.profile.lookup",
      roleId: "agent-front-desk",
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
        id: expect.stringMatching(/^gcal-event-/),
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
        id: expect.stringMatching(/^notion-page-/),
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
) {
  const connectResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/integrations/${provider}/connect`)
    .send({
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: `http://127.0.0.1:4173/integrations/${provider}/callback`,
      requestedScopes,
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
