import type { INestApplication } from "@nestjs/common";import request from "supertest";import { expect } from "vitest";import { type IntegrationStateRepository, type PersistedIntegrationStateRecord } from "../integrations/integrations-state.repository";

export function createProviderImportIntegrationRepository(input: {
  connectionId: string;
  granted: boolean;
}): IntegrationStateRepository {
  const state: PersistedIntegrationStateRecord = {
    schemaVersion: 1,
    organizationId: "tenant-west-africa",
    pendingConnects: [],
    credentials: [],
    connections: [
      {
        id: input.connectionId,
        organizationId: "tenant-west-africa",
        provider: "notion",
        status: "connected",
        connectedBy: "user-integrations-admin",
        scopes: ["search:read"],
        availability: {
          scope: "workspace",
          workspaceId: "workspace-customer-success",
        },
        credentialReference: {
          id: "credential_notion_support",
          provider: "notion",
          kind: "oauth-token",
          preview: "...notion",
        },
        accountLabel: "Support Notion",
        connectedAt: "2026-06-05T10:00:00.000Z",
        health: {
          status: "healthy",
          checkedAt: "2026-06-05T10:00:00.000Z",
        },
        auditEvents: [],
      },
    ],
    toolGrants: input.granted
      ? [
          {
            id: "tool_grant_notion_knowledge",
            organizationId: "tenant-west-africa",
            capability: "knowledge-source",
            workspaceId: "workspace-customer-success",
            toolId: "notion.knowledge.search",
            integrationConnectionId: input.connectionId,
            risk: "low",
            requiredScopes: ["search:read"],
            approvalRequired: false,
            status: "active",
            grantedBy: "user-integrations-admin",
            createdAt: "2026-06-05T10:05:00.000Z",
          },
        ]
      : [],
  };

  return {
    listOrganizationIds: () => [state.organizationId],
    load: (organizationId: string) => organizationId === state.organizationId ? state : null,
    save: (record: PersistedIntegrationStateRecord) => {
      Object.assign(state, record);
    },
  };
}

export function createMutableIntegrationRepository(): IntegrationStateRepository {
  let state: PersistedIntegrationStateRecord | null = null;

  return {
    listOrganizationIds: () => (state === null ? [] : [state.organizationId]),
    load: (organizationId: string) =>
      state !== null && state.organizationId === organizationId ? state : null,
    save: (record: PersistedIntegrationStateRecord) => {
      state = {
        ...record,
        pendingConnects: [...record.pendingConnects],
        connections: record.connections.map((connection) => ({
          ...connection,
          scopes: [...connection.scopes],
          credentialReference: { ...connection.credentialReference },
          auditEvents: connection.auditEvents.map((event) => ({ ...event })),
        })),
        credentials: record.credentials.map((credential) => ({ ...credential })),
        toolGrants: record.toolGrants?.map((grant) => ({
          ...grant,
          requiredScopes: [...grant.requiredScopes],
        })),
        webhookTools: record.webhookTools?.map((tool) => ({ ...tool })),
        webhookToolSecrets: record.webhookToolSecrets?.map((secret) => ({ ...secret })),
      };
    },
  };
}

export async function connectKnowledgeSourceProvider(
  app: INestApplication,
  input: {
    provider: "confluence" | "sharepoint" | "salesforce-knowledge";
    requestedScopes: string[];
    toolId: string;
  },
) {
  const connectResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/integrations/${input.provider}/connect`)
    .send({
      actorUserId: "user-integrations-admin",
      actorRole: "admin",
      redirectUri: `http://127.0.0.1:4173/integrations/${input.provider}/callback`,
      requestedScopes: input.requestedScopes,
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-08T07:55:00.000Z",
    });
  expect(connectResponse.status).toBe(201);

  const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");
  const callbackResponse = await request(app.getHttpServer())
    .get(`/integrations/oauth/${input.provider}/callback`)
    .query({
      code: `${input.provider}-oauth-code-knowledge`,
      state,
      now: "2026-06-08T07:56:00.000Z",
    });
  expect(callbackResponse.status).toBe(200);
  const connectionId = callbackResponse.body.connection.id as string;

  const grantResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/integrations/tool-grants")
    .send({
      actorUserId: "user-integrations-admin",
      actorRole: "admin",
      capability: "knowledge-source",
      workspaceId: "workspace-customer-success",
      toolId: input.toolId,
      integrationConnectionId: connectionId,
      risk: "low",
      approvalRequired: false,
      now: "2026-06-08T07:57:00.000Z",
    });
  expect(grantResponse.status).toBe(201);

  return connectionId;
}

export async function configureFreshdeskKnowledgeSourceProvider(app: INestApplication) {
  const configureResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/integrations/freshdesk/configure")
    .send({
      actorUserId: "user-integrations-admin",
      actorRole: "admin",
      subdomain: "tuzzy-support",
      apiToken: "freshdesk-api-token-123456",
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-08T07:55:00.000Z",
    });
  expect(configureResponse.status).toBe(201);
  const connectionId = configureResponse.body.connection.id as string;

  const grantResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/integrations/tool-grants")
    .send({
      actorUserId: "user-integrations-admin",
      actorRole: "admin",
      capability: "knowledge-source",
      workspaceId: "workspace-customer-success",
      toolId: "freshdesk.solutions.import",
      integrationConnectionId: connectionId,
      risk: "low",
      approvalRequired: false,
      now: "2026-06-08T07:57:00.000Z",
    });
  expect(grantResponse.status).toBe(201);

  return connectionId;
}

export function mockJsonResponse(status: number, body: unknown) {
  return {
    status,
    headers: new Headers({
      "content-type": "application/json",
    }),
    text: async () => JSON.stringify(body),
  };
}

export function mockTextResponse(status: number, body: string, contentType = "text/plain") {
  return {
    status,
    headers: new Headers({
      "content-type": contentType,
    }),
    text: async () => body,
  };
}
