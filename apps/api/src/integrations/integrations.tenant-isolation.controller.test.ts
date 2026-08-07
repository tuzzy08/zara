import { afterEach, describe, expect, it, vi } from "vitest";import request from "supertest";import { createTestingApp } from "./integrations.controller.test-support";

describe("IntegrationsController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
        workspaceId: "workspace-default",
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
        workspaceId: "workspace-default",
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
      "/organizations/tenant-east-africa/integrations/webhook-tools?workspaceId=workspace-default",
    );
    const eastToolGrantsResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-east-africa/integrations/tool-grants?workspaceId=workspace-default",
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
