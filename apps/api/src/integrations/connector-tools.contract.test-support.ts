import { randomUUID } from "node:crypto";import { tmpdir } from "node:os";import { join } from "node:path";import type { INestApplication } from "@nestjs/common";import { Test } from "@nestjs/testing";import request from "supertest";import { expect } from "vitest";import { configureCors } from "../config/cors";import { installTestTenantAuth } from "../testing/tenant-auth-request";import { IntegrationSecretVault } from "./integrations-secret-vault";import { FileIntegrationStateRepository, INTEGRATION_STATE_REPOSITORY } from "./integrations-state.repository";import { IntegrationsModule } from "./integrations.module";

export async function configureZendeskApiTokenConnection(
  app: INestApplication,
  extraBody: Record<string, unknown> = {},
) {
  const configureResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/integrations/zendesk/configure")
    .send({
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      subdomain: "tuzzy-support",
      email: "support@example.com",
      apiToken: "zendesk-api-token-123456",
      ...extraBody,
    });

  expect(configureResponse.status).toBe(201);
  expect(JSON.stringify(configureResponse.body)).not.toContain("zendesk-api-token-123456");
  expect(JSON.stringify(configureResponse.body)).not.toContain("tenant-controlled.example.test");

  return configureResponse.body.connection.id as string;
}

export async function configureFreshdeskApiTokenConnection(
  app: INestApplication,
  extraBody: Record<string, unknown> = {},
) {
  const configureResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/integrations/freshdesk/configure")
    .send({
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      subdomain: "tuzzy-support",
      apiToken: "freshdesk-api-token-123456",
      ...extraBody,
    });

  expect(configureResponse.status).toBe(201);
  expect(JSON.stringify(configureResponse.body)).not.toContain("freshdesk-api-token-123456");
  expect(JSON.stringify(configureResponse.body)).not.toContain("tenant-controlled.example.test");

  return configureResponse.body.connection.id as string;
}

export async function connectIntegration(
  app: INestApplication,
  provider:
    | "zendesk"
    | "hubspot"
    | "google-workspace"
    | "notion"
    | "salesforce"
    | "slack"
    | "microsoft-365"
    | "intercom"
    | "shopify"
    | "stripe"
    | "confluence"
    | "sharepoint"
    | "salesforce-knowledge",
  requestedScopes: string[],
  extraBody: Record<string, unknown> = {},
) {
  const connectResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/integrations/${provider}/connect`)
    .send({
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      redirectUri: `http://127.0.0.1:4173/integrations/${provider}/callback`,
      requestedScopes,
      ...extraBody,
    });

  expect(connectResponse.status).toBe(201);
  const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");
  const callbackResponse = await request(app.getHttpServer())
    .get(`/integrations/oauth/${provider}/callback`)
    .query({
      code: `${provider}-oauth-code-contract`,
      state,
    });

  expect(callbackResponse.status).toBe(200);
  expect(JSON.stringify(callbackResponse.body)).not.toContain(`${provider}:access:`);

  return callbackResponse.body.connection.id as string;
}

export async function createTestingApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [IntegrationsModule],
  })
    .overrideProvider(INTEGRATION_STATE_REPOSITORY)
    .useValue(
      new FileIntegrationStateRepository(
        join(tmpdir(), "zara-connector-contract-tests", randomUUID()),
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
  installTestTenantAuth(app);
  await app.init();

  return app;
}

export function findToolSchema(body: unknown, toolId: string) {
  const tools = body !== null && typeof body === "object"
    ? (body as { tools?: unknown }).tools
    : undefined;
  expect(Array.isArray(tools)).toBe(true);
  const schema = (tools as Array<{ toolId?: string }>).find((tool) => tool.toolId === toolId);
  expect(schema).toBeDefined();

  return schema as {
    description: string;
    requiredAlternatives?: string[][] | undefined;
    inputSchema: Record<string, unknown>;
  };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    status,
    headers: new Headers({
      "content-type": "application/json",
      ...headers,
    }),
    text: async () => JSON.stringify(body),
  };
}

export function textResponse(status: number, body: string, contentType = "text/plain") {
  return {
    status,
    headers: new Headers({
      "content-type": contentType,
    }),
    text: async () => body,
  };
}
