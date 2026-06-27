import { afterEach, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

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
});

async function createTestingApp(options: { tenantAuth?: boolean | undefined } = {}) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "zara-agents-test-"));
  vi.stubEnv("ZARA_AGENTS_STATE_DIR", stateDirectory);

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
  };

  return app as INestApplication;
}
