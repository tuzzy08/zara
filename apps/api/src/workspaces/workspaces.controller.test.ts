import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "@zara/core";
import request from "supertest";

import { configureCors } from "../config/cors";
import { WorkspacesModule } from "./workspaces.module";

describe("WorkspacesController", () => {
  it("returns seeded workspace state and applies create plus member mutations through the API", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkspacesModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    configureCors(app);
    await app.init();

    const initialStateResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/workspaces/state",
    );

    expect(initialStateResponse.status).toBe(200);
    expect(initialStateResponse.body.directoryUsers.length).toBeGreaterThan(0);
    expect(initialStateResponse.body.workspaces).toEqual([
      expect.objectContaining({
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
      }),
    ]);

    const createWorkspaceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/workspaces")
      .send({
        name: "Retention Desk",
        actorUserId: "user-ops-lead",
      });

    expect(createWorkspaceResponse.status).toBe(201);
    expect(
      createWorkspaceResponse.body.state.workspaces.map((workspace: { name: string }) => workspace.name),
    ).toContain("Retention Desk");

    const grantMembershipResponse = await request(app.getHttpServer())
      .put(`/organizations/tenant-west-africa/workspaces/${DEFAULT_WORKSPACE_ID}/memberships/user-finance`)
      .send({
        role: "viewer",
        actorUserId: "user-ops-lead",
      });

    expect(grantMembershipResponse.status).toBe(200);
    expect(
      grantMembershipResponse.body.state.memberships.some(
        (membership: { workspaceId: string; userId: string; role: string }) =>
          membership.workspaceId === DEFAULT_WORKSPACE_ID &&
          membership.userId === "user-finance" &&
          membership.role === "viewer",
      ),
    ).toBe(true);

    const renameWorkspaceResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/workspaces/${DEFAULT_WORKSPACE_ID}`)
      .send({
        action: "rename",
        nextName: "Default workspace command",
        actorUserId: "user-ops-lead",
      });

    expect(renameWorkspaceResponse.status).toBe(200);
    expect(
      renameWorkspaceResponse.body.state.workspaces.find(
        (workspace: { id: string; name: string }) => workspace.id === DEFAULT_WORKSPACE_ID,
      )?.name,
    ).toBe("Default workspace command");

    const accessWorkspaceResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/workspaces/${DEFAULT_WORKSPACE_ID}/accessed`)
      .send({
        actorUserId: "user-ops-lead",
      });

    expect(accessWorkspaceResponse.status).toBe(200);
    expect(accessWorkspaceResponse.body.state.auditEntries[0]?.summary).toContain("Switched active workspace");

    await app.close();
  }, 15_000);

  it("allows tenant web origins to call workspace routes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkspacesModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    configureCors(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .options("/organizations/tenant-west-africa/workspaces/state")
      .set("Origin", "http://127.0.0.1:4173")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4173");

    await app.close();
  }, 15_000);

  it("allows localhost tenant web origins to call workspace routes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkspacesModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    configureCors(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .options("/organizations/tenant-west-africa/workspaces/state")
      .set("Origin", "http://localhost:4173")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:4173");

    await app.close();
  }, 15_000);

  it("rejects archive and membership changes when shared workspace safeguards fail", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkspacesModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    configureCors(app);
    await app.init();

    const archiveResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/workspaces/${DEFAULT_WORKSPACE_ID}`)
      .send({
        action: "archive",
        actorUserId: "user-support-manager",
        activeSessionCount: 2,
      });

    expect(archiveResponse.status).toBe(409);
    expect(archiveResponse.body.message).toContain("cannot be archived while 2 active calls or sandbox sessions exist");

    const revokeOwnerResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/workspaces/${DEFAULT_WORKSPACE_ID}/memberships/user-ops-lead/revoke`)
      .send({
        actorUserId: "user-ops-lead",
      });

    expect(revokeOwnerResponse.status).toBe(409);
    expect(revokeOwnerResponse.body.message).toContain("must keep at least one owner");

    await app.close();
  }, 15_000);
});
