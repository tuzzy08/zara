import { randomUUID } from "node:crypto";import { tmpdir } from "node:os";import { join } from "node:path";import type { INestApplication } from "@nestjs/common";import { Test } from "@nestjs/testing";import request from "supertest";import { configureCors } from "../config/cors";import { installTestTenantAuth } from "../testing/tenant-auth-request";import { IntegrationSecretVault } from "./integrations-secret-vault";import { FileIntegrationStateRepository, INTEGRATION_STATE_REPOSITORY } from "./integrations-state.repository";import { IntegrationsModule } from "./integrations.module";

export async function connectIntegration(
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

export async function createTestingApp(options: { tenantAuth?: boolean | undefined } = {}) {
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
  if (options.tenantAuth !== false) {
    installTestTenantAuth(app);
  }
  await app.init();

  return app;
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
