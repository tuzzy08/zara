import { afterEach, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

import type { IntegrationConnectionResponse, IntegrationProvider } from "../integrations/integrations.models";
import {
  FileIntegrationStateRepository,
  type PersistedIntegrationStateRecord,
} from "../integrations/integrations-state.repository";
import { installTestTenantAuth, withTestTenantAuth } from "../testing/tenant-auth-request";
import { AgentsModule } from "./agents.module";

describe("AgentsController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires tenant membership for reusable agent routes", async () => {
    const app = await createTestingApp({ tenantAuth: false });

    const response = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/agents?workspaceId=workspace-default",
    );

    expect(response.status).toBe(401);

    await app.close();
  }, 15_000);

  it("requires a workspace when listing reusable agents", async () => {
    const app = await createTestingApp();

    const response = await withTestTenantAuth(
      request(app.getHttpServer()).get("/organizations/tenant-west-africa/agents"),
    );

    expect(response.status).toBe(400);

    await app.close();
  }, 15_000);

  it("creates and lists reusable concrete agents scoped to the active workspace", async () => {
    const app = await createTestingApp();

    const createResponse = await withTestTenantAuth(
      request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/agents")
        .send({
          workspaceId: "workspace-default",
          name: "Support concierge",
          agentClass: "support-specialist",
          instructions: "Answer support calls and escalate billing risks.",
          defaultLanguage: "en",
          runtimeProfile: "premium-realtime",
        }),
    );

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.agent).toEqual(expect.objectContaining({
      id: "agent-support-concierge",
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      name: "Support concierge",
      agentClass: "support-specialist",
      runtimeProfile: "premium-realtime",
      toolbeltAssignments: [],
      createdBy: "user-ops-lead",
    }));

    const listResponse = await withTestTenantAuth(
      request(app.getHttpServer()).get(
        "/organizations/tenant-west-africa/agents?workspaceId=workspace-default",
      ),
    );

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.agents).toEqual([
      expect.objectContaining({
        id: "agent-support-concierge",
        name: "Support concierge",
      }),
    ]);

    await app.close();
  }, 15_000);

  it("does not leak reusable agents across workspaces or tenants", async () => {
    const app = await createTestingApp();

    await withTestTenantAuth(
      request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/agents")
        .send({
          workspaceId: "workspace-default",
          name: "Support concierge",
          agentClass: "support-specialist",
          instructions: "Answer support calls.",
          defaultLanguage: "en",
          runtimeProfile: "cost-optimized",
        }),
    );
    await withTestTenantAuth(
      request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/agents")
        .send({
          workspaceId: "workspace-enterprise",
          name: "Enterprise sales",
          agentClass: "sales-specialist",
          instructions: "Qualify enterprise callers.",
          defaultLanguage: "en",
          runtimeProfile: "premium-realtime",
        }),
    );
    await withTestTenantAuth(
      request(app.getHttpServer())
        .post("/organizations/tenant-east-africa/agents")
        .send({
          workspaceId: "workspace-default",
          name: "Other tenant support",
          agentClass: "support-specialist",
          instructions: "Handle another tenant.",
          defaultLanguage: "en",
          runtimeProfile: "cost-optimized",
        }),
      { organizationId: "tenant-east-africa" },
    );

    const defaultWorkspaceResponse = await withTestTenantAuth(
      request(app.getHttpServer()).get(
        "/organizations/tenant-west-africa/agents?workspaceId=workspace-default",
      ),
    );

    expect(defaultWorkspaceResponse.status).toBe(200);
    expect(defaultWorkspaceResponse.body.agents.map((agent: { name: string }) => agent.name)).toEqual([
      "Support concierge",
    ]);

    await app.close();
  }, 15_000);

  it("replaces a reusable agent toolbelt with validated connected provider tools", async () => {
    const app = await createTestingApp({
      integrationState: createIntegrationState({
        connections: [
          createIntegrationConnection({
            id: "connection-zendesk-support",
            provider: "zendesk",
            scopes: ["tickets:read"],
            availability: { scope: "workspace", workspaceId: "workspace-default" },
            accountLabel: "Zendesk support",
          }),
        ],
      }),
    });

    await createReusableAgent(app);

    const response = await withTestTenantAuth(
      request(app.getHttpServer())
        .put("/organizations/tenant-west-africa/agents/agent-support-concierge/toolbelt")
        .send({
          workspaceId: "workspace-default",
          assignments: [
            {
              id: "assignment-zendesk-search",
              toolId: "zendesk.tickets.search",
              label: "Search tickets",
              description: "Search recent Zendesk tickets.",
              whenToUse: "Use when the caller asks about an existing ticket.",
              connector: "zendesk",
              toolName: "Search tickets",
              integrationConnectionId: "connection-zendesk-support",
              risk: "low",
              requiresAuthorization: true,
              requiresHumanApproval: false,
            },
          ],
        }),
    );

    expect(response.status).toBe(200);
    expect(response.body.agent.toolbeltAssignments).toEqual([
      expect.objectContaining({
        id: "assignment-zendesk-search",
        toolId: "zendesk.tickets.search",
        connector: "zendesk",
        toolName: "Search tickets",
        integrationConnectionId: "connection-zendesk-support",
        integrationLabel: "Zendesk support",
        connectionStatus: "connected",
        risk: "low",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      }),
    ]);

    const listResponse = await withTestTenantAuth(
      request(app.getHttpServer()).get(
        "/organizations/tenant-west-africa/agents?workspaceId=workspace-default",
      ),
    );

    expect(listResponse.body.agents[0].toolbeltAssignments).toEqual(response.body.agent.toolbeltAssignments);

    await app.close();
  }, 15_000);

  it("rejects reusable agent toolbelts that use connections outside the agent workspace", async () => {
    const app = await createTestingApp({
      integrationState: createIntegrationState({
        connections: [
          createIntegrationConnection({
            id: "connection-zendesk-growth",
            provider: "zendesk",
            scopes: ["tickets:read"],
            availability: { scope: "workspace", workspaceId: "workspace-growth" },
          }),
        ],
      }),
    });

    await createReusableAgent(app);

    const response = await withTestTenantAuth(
      request(app.getHttpServer())
        .put("/organizations/tenant-west-africa/agents/agent-support-concierge/toolbelt")
        .send({
          workspaceId: "workspace-default",
          assignments: [
            {
              id: "assignment-zendesk-search",
              toolId: "zendesk.tickets.search",
              label: "Search tickets",
              description: "Search recent Zendesk tickets.",
              whenToUse: "Use when the caller asks about an existing ticket.",
              connector: "zendesk",
              toolName: "Search tickets",
              integrationConnectionId: "connection-zendesk-growth",
              risk: "low",
              requiresAuthorization: true,
              requiresHumanApproval: false,
            },
          ],
        }),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Integration connection is not available to this workspace.");

    await app.close();
  }, 15_000);
});

async function createTestingApp(options: {
  tenantAuth?: boolean | undefined;
  integrationState?: PersistedIntegrationStateRecord | undefined;
} = {}) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "zara-agents-test-"));
  const integrationStateDirectory = mkdtempSync(join(tmpdir(), "zara-agents-integrations-test-"));
  vi.stubEnv("ZARA_AGENTS_STATE_DIR", stateDirectory);
  vi.stubEnv("ZARA_INTEGRATION_STATE_DIR", integrationStateDirectory);

  if (options.integrationState !== undefined) {
    new FileIntegrationStateRepository(integrationStateDirectory).save(options.integrationState);
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AgentsModule],
  }).compile();
  const app = moduleRef.createNestApplication();

  if (options.tenantAuth !== false) {
    installTestTenantAuth(app);
  }

  await app.init();
  const close = app.close.bind(app);
  app.close = async () => {
    await close();
    rmSync(stateDirectory, { recursive: true, force: true });
    rmSync(integrationStateDirectory, { recursive: true, force: true });
  };

  return app as INestApplication;
}

async function createReusableAgent(app: INestApplication) {
  return withTestTenantAuth(
    request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/agents")
      .send({
        workspaceId: "workspace-default",
        name: "Support concierge",
        agentClass: "support-specialist",
        instructions: "Answer support calls.",
        defaultLanguage: "en",
        runtimeProfile: "cost-optimized",
      }),
  );
}

function createIntegrationState(input: {
  connections: IntegrationConnectionResponse[];
}): PersistedIntegrationStateRecord {
  return {
    schemaVersion: 1,
    organizationId: "tenant-west-africa",
    pendingConnects: [],
    connections: input.connections,
    credentials: [],
    toolGrants: [],
  };
}

function createIntegrationConnection(input: {
  id: string;
  provider: IntegrationProvider;
  scopes: string[];
  availability: IntegrationConnectionResponse["availability"];
  accountLabel?: string | undefined;
  status?: IntegrationConnectionResponse["status"] | undefined;
}): IntegrationConnectionResponse {
  const status = input.status ?? "connected";

  return {
    id: input.id,
    organizationId: "tenant-west-africa",
    provider: input.provider,
    status,
    connectedBy: "user-ops-lead",
    scopes: input.scopes,
    availability: input.availability,
    credentialReference: {
      id: `${input.id}-credential`,
      provider: input.provider,
      kind: input.provider === "zendesk" ? "api-token" : "oauth-token",
      preview: "...1234",
    },
    ...(input.accountLabel !== undefined ? { accountLabel: input.accountLabel } : {}),
    connectedAt: "2026-06-05T09:00:00.000Z",
    health: {
      status: status === "revoked" ? "revoked" : "unknown",
    },
    auditEvents: [
      {
        id: `${input.id}-connected`,
        action: "connected",
        actorUserId: "user-ops-lead",
        at: "2026-06-05T09:00:00.000Z",
      },
    ],
  };
}
