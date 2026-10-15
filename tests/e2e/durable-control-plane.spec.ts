import { expect, test } from "@playwright/test";
import { setTimeout } from "node:timers/promises";
import { createAgentRoleNode, createWorkflowGraph } from "../../packages/core/src/index";
import { database, literal, origin, peer, probeShutdownPool, signup, startApi, stopApi } from "./control-plane-fixtures";

test.setTimeout(180_000);
test.afterAll(async () => { await setTimeout(11_000); });

test("workspace state and access survive replicas, concurrent writes and restart", async ({ request, playwright }, testInfo) => {
  const owner = await signup(request, "durable-owner");
  const otherRequest = await playwright.request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const other = await signup(otherRequest, "durable-other");
    const path = `/organizations/${owner.organizationId}/workspaces`;
    const responses = await Promise.all([
      request.post(path, { data: { name: "Durable Alpha" } }),
      request.post(path, { headers: peer, data: { name: "Durable Beta" } }),
    ]);
    for (const response of responses) expect(response.status()).toBe(201);
    const read = async (headers = {}) => (await request.get(`${path}/state`, { headers })).json();
    for (const headers of [{}, peer]) {
      expect((await read(headers)).workspaces.map((item: { name: string }) => item.name)).toEqual(expect.arrayContaining(["Durable Alpha", "Durable Beta"]));
    }
    const workspace = (await read()).workspaces.find((item: { name: string }) => item.name === "Durable Alpha");
    database(`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES ('e2e-durable-member', ${literal(other.userId)}, ${literal(owner.organizationId)}, 'admin', now());`);
    expect((await request.put(`${path}/${workspace.id}/memberships/${other.userId}`, { data: { role: "viewer" } })).status()).toBe(200);
    expect((await request.patch(`${path}/${workspace.id}`, { headers: peer, data: { action: "rename", nextName: "Durable Renamed" } })).status()).toBe(200);
    expect((await request.patch(`${path}/${workspace.id}`, { data: { action: "archive", activeSessionCount: 0 } })).status()).toBe(200);
    expect((await request.patch(`${path}/${workspace.id}`, { headers: peer, data: { action: "restore" } })).status()).toBe(200);
    const before = await read();
    for (const name of ["Durable Renamed", "Durable Beta"]) {
      const createdWorkspace = before.workspaces.find((item: { name: string }) => item.name === name);
      expect(before.auditEntries).toEqual(expect.arrayContaining([expect.objectContaining({ action: "workspace.accessed", actorUserId: owner.userId, workspaceId: createdWorkspace.id })]));
    }
    for (const action of ["workspace.renamed", "workspace.archived", "workspace.restored", "membership.granted"]) {
      expect(before.auditEntries).toEqual(expect.arrayContaining([expect.objectContaining({ action, actorUserId: owner.userId, workspaceId: workspace.id })]));
    }
    const stopped = stopApi();
    await testInfo.attach("workspace-restart", { body: JSON.stringify(stopped), contentType: "application/json" });
    await startApi(request);
    for (const headers of [{}, peer]) {
      const after = await read(headers);
      expect(after.workspaces).toEqual(before.workspaces);
      expect(after.memberships).toEqual(before.memberships);
      expect(after.auditEntries).toEqual(before.auditEntries);
    }
    expect((await request.put(`${path}/${workspace.id}/memberships/${other.userId}`, { data: { role: "owner" } })).status()).toBe(200);
    const demotions = await Promise.all([
      request.put(`${path}/${workspace.id}/memberships/${owner.userId}`, { data: { role: "viewer" } }),
      request.put(`${path}/${workspace.id}/memberships/${other.userId}`, { headers: peer, data: { role: "viewer" } }),
    ]);
    expect(demotions.map((response) => response.status()).sort()).toEqual([200, 409]);
    expect((await read(peer)).memberships.filter((item: { workspaceId: string; role: string }) => item.workspaceId === workspace.id && item.role === "owner")).toHaveLength(1);
    expect((await request.put(`${path}/${workspace.id}/memberships/${owner.userId}`, { data: { role: "owner" } })).status()).toBe(200);
    expect((await request.post(`${path}/${workspace.id}/memberships/${other.userId}/revoke`)).status()).toBe(200);
    const revoked = await read(peer);
    expect(revoked.memberships.some((item: { userId: string; workspaceId: string }) => item.userId === other.userId && item.workspaceId === workspace.id)).toBe(false);
    stopApi();
    await startApi(request);
    expect((await read()).memberships).toEqual(revoked.memberships);
    const ownerAuth = await (await request.get("/api/auth/context")).json();
    const defaultWorkspaceId = ownerAuth.activeWorkspace.id;
    expect((await request.put(`${path}/${defaultWorkspaceId}/memberships/${other.userId}`, { data: { role: "admin" } })).status()).toBe(200);
    expect((await otherRequest.post("/api/auth/organization/set-active", { headers: { origin }, data: { organizationId: owner.organizationId } })).status()).toBe(200);
    expect((await (await otherRequest.get("/api/auth/context")).json()).activeWorkspace.id).toBe(defaultWorkspaceId);
    expect((await request.post(`${path}/${defaultWorkspaceId}/memberships/${other.userId}/revoke`)).status()).toBe(200);
    stopApi();
    await startApi(request);
    for (const headers of [{}, peer]) {
      const contextResponse = await otherRequest.get("/api/auth/context", { headers });
      expect(contextResponse.status()).toBe(200);
      expect((await contextResponse.json()).activeWorkspace).toBeNull();
      expect((await read(headers)).memberships.some((item: { userId: string; workspaceId: string }) => item.userId === other.userId && item.workspaceId === defaultWorkspaceId)).toBe(false);
    }
    database(`DELETE FROM member WHERE id = 'e2e-durable-member';`);
    for (const headers of [{}, peer]) {
      expect((await otherRequest.get(`${path}/state`, { headers })).status()).toBe(403);
      expect((await otherRequest.patch(`${path}/${workspace.id}`, { headers, data: { action: "rename", nextName: "Stolen" } })).status()).toBe(403);
    }
  } finally { await otherRequest.dispose(); }
});

function publishRequest(workspaceId: string, expectedVersion: number, instructions: string) {
  return {
    workspaceId, expectedVersion, existingVersions: [], environment: "production",
    graph: createWorkflowGraph({
      id: "e2e-concurrent-workflow", name: "Concurrent publication",
      nodes: [
        { id: "entry", kind: "entry", label: "Inbound call", position: { x: 0, y: 80 }, config: {} },
        createAgentRoleNode({ id: "support", label: "Support", position: { x: 180, y: 80 }, role: {
          kind: "support", name: "Support", businessName: "E2E", instructions, defaultModelTier: "standard",
          languagePolicy: { defaultLanguage: "en", supportedLanguages: ["en"], allowMidCallSwitching: false },
        } }),
      ], edges: [{ id: "entry-support", sourceNodeId: "entry", targetNodeId: "support" }],
    }),
    runtime: "sandwich-pipeline", runtimeProfile: "cost-optimized", telephonyProvider: "browser-webrtc",
    memory: { mode: "scoped", retrievalScopes: ["session"], approvalRequired: true },
    budget: { monthlyCapUsd: 1200, currentSpendUsd: 0, projectedCostPerMinuteUsd: 0.25, blockOnLimit: true },
  };
}

test("concurrent publication rejects stale versions and preserves returned manifests", async ({ request, playwright }) => {
  const owner = await signup(request, "publish-owner");
  const workspaces = await (await request.get(`/organizations/${owner.organizationId}/workspaces/state`)).json();
  const workspaceId = workspaces.workspaces[0].id;
  const path = `/organizations/${owner.organizationId}/workflows/e2e-concurrent-workflow/publish`;
  const attacker = await playwright.request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    expect((await attacker.post(path, { data: publishRequest(workspaceId, 0, "Anonymous publication.") })).status()).toBe(401);
    const other = await signup(attacker, "publish-other");
    for (const headers of [{}, peer]) {
      expect((await attacker.post(path, { headers, data: publishRequest(workspaceId, 0, "Cross-tenant publication.") })).status()).toBe(403);
    }
    const otherState = await (await attacker.get(`/organizations/${other.organizationId}/workspaces/state`)).json();
    const otherPublication = await attacker.post(`/organizations/${other.organizationId}/workflows/e2e-concurrent-workflow/publish`, {
      headers: peer, data: publishRequest(otherState.workspaces[0].id, 0, "Answer only for the separate tenant."),
    });
    expect(otherPublication.status(), await otherPublication.text()).toBe(201);
    const otherResult = await otherPublication.json();
    expect(otherResult.publishedVersion.version).toBe(1);
    expect(JSON.parse(database(`SELECT manifest FROM published_workflow_manifests WHERE tenant_id = ${literal(other.organizationId)} AND workflow_id = 'e2e-concurrent-workflow';`))).toEqual(otherResult.manifest);
  } finally { await attacker.dispose(); }
  const responses = await Promise.all([
    request.post(path, { data: publishRequest(workspaceId, 0, "Answer the first support request.") }),
    request.post(path, { headers: peer, data: publishRequest(workspaceId, 0, "Answer the second support request.") }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
  const first = await responses.find((response) => response.status() === 201)!.json();
  expect(first.publishedVersion.version).toBe(1);
  const next = await request.post(path, { headers: peer, data: publishRequest(workspaceId, 1, "Answer the updated support request.") });
  expect(next.status(), await next.text()).toBe(201);
  const second = await next.json();
  expect(second.publishedVersion.version).toBe(2);
  expect(second.manifest.publishedVersionId).not.toBe(first.manifest.publishedVersionId);
  expect((await request.post(path, { data: publishRequest(workspaceId, 1, "Stale publication.") })).status()).toBe(409);
  stopApi();
  await startApi(request);
  const rows = JSON.parse(database(`SELECT coalesce(json_agg(manifest ORDER BY published_version_id), '[]') FROM published_workflow_manifests WHERE tenant_id = ${literal(owner.organizationId)} AND workflow_id = 'e2e-concurrent-workflow';`));
  expect(rows).toHaveLength(2);
  expect(rows).toEqual(expect.arrayContaining([first.manifest, second.manifest]));
});

test("API SIGTERM exits cleanly and the same session works after restart", async ({ request }, testInfo) => {
  const owner = await signup(request, "shutdown-owner");
  const stopped = stopApi();
  await testInfo.attach("sigterm-result", { body: JSON.stringify(stopped), contentType: "application/json" });
  try {
    expect.soft(stopped.exitCode).toBe(0);
    expect.soft(stopped.state).toBe("exited");
  } finally { await startApi(request); }
  const context = await (await request.get("/api/auth/context")).json();
  expect(context.activeOrganization.id).toBe(owner.organizationId);
});

test("renamed workspace names can be reused without changing durable identity", async ({ request }) => {
  const owner = await signup(request, "identity-owner");
  const path = `/organizations/${owner.organizationId}/workspaces`;
  const initial = await request.post(path, { data: { name: "Reusable Alpha" } });
  expect(initial.status()).toBe(201);
  const first = (await initial.json()).state.workspaces.find((item: { name: string }) => item.name === "Reusable Alpha");
  expect((await request.patch(`${path}/${first.id}`, { data: { action: "rename", nextName: "Reusable Beta" } })).status()).toBe(200);
  const repeated = await request.post(path, { headers: peer, data: { name: "Reusable Alpha" } });
  expect(repeated.status(), await repeated.text()).toBe(201);
  const second = (await repeated.json()).state.workspaces.find((item: { name: string }) => item.name === "Reusable Alpha");
  expect(second.id).not.toBe(first.id);
  stopApi();
  await startApi(request);
  for (const headers of [{}, peer]) {
    const state = await (await request.get(`${path}/state`, { headers })).json();
    expect(state.workspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, name: "Reusable Beta" }),
      expect.objectContaining({ id: second.id, name: "Reusable Alpha" }),
    ]));
    for (const workspaceId of [first.id, second.id]) {
      expect(state.memberships).toEqual(expect.arrayContaining([expect.objectContaining({ workspaceId, userId: owner.userId, role: "owner" })]));
    }
  }
});

test("native organization membership replacement cannot restore revoked workspace access", async ({ request, playwright }) => {
  const owner = await signup(request, "replacement-owner");
  const adminRequest = await playwright.request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const admin = await signup(adminRequest, "replacement-admin");
    const path = `/organizations/${owner.organizationId}/workspaces`;
    const workspaceId = (await (await request.get("/api/auth/context")).json()).activeWorkspace.id;
    database(`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES ('e2e-before-replacement', ${literal(admin.userId)}, ${literal(owner.organizationId)}, 'admin', now());`);
    expect((await request.put(`${path}/${workspaceId}/memberships/${admin.userId}`, { data: { role: "admin" } })).status()).toBe(200);
    const selectOrganization = () => adminRequest.post("/api/auth/organization/set-active", { headers: { origin }, data: { organizationId: owner.organizationId } });
    expect((await selectOrganization()).status()).toBe(200);
    expect((await (await adminRequest.get("/api/auth/context")).json()).activeWorkspace.id).toBe(workspaceId);
    expect((await request.post(`${path}/${workspaceId}/memberships/${admin.userId}/revoke`)).status()).toBe(200);
    expect((await (await adminRequest.get("/api/auth/context")).json()).activeWorkspace).toBeNull();
    database(`DELETE FROM member WHERE id = 'e2e-before-replacement'; INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES ('e2e-after-replacement', ${literal(admin.userId)}, ${literal(owner.organizationId)}, 'admin', now());`);
    expect((await selectOrganization()).status()).toBe(200);
    for (const headers of [{}, peer]) {
      expect((await (await adminRequest.get("/api/auth/context", { headers })).json()).activeWorkspace).toBeNull();
      const state = await (await request.get(`${path}/state`, { headers })).json();
      expect(state.memberships.some((item: { userId: string; workspaceId: string }) => item.userId === admin.userId && item.workspaceId === workspaceId)).toBe(false);
    }
  } finally { await adminRequest.dispose(); }
});

test("Nest shutdown keeps Postgres available until database drain completes", async ({ request }, testInfo) => {
  expect((await request.get("/health")).status()).toBe(200);
  try {
    const result = probeShutdownPool();
    await testInfo.attach("shutdown-pool-result", { body: result, contentType: "application/json" });
    expect(JSON.parse(result)).toEqual({ databaseDrainCompleted: true, poolClosed: true });
  } catch (error) {
    await testInfo.attach("shutdown-pool-failure", { body: String(error), contentType: "text/plain" });
    throw error;
  }
});

test("stale publication cannot grant tool access", async ({ request }) => {
  const owner = await signup(request, "stale-grant-owner");
  const workspaceId = (await (await request.get("/api/auth/context")).json()).activeWorkspace.id;
  const path = `/organizations/${owner.organizationId}`;
  const initial = await request.post(`${path}/workflows/e2e-concurrent-workflow/publish`, {
    data: publishRequest(workspaceId, 0, "Handle support requests without tools."),
  });
  expect(initial.status(), await initial.text()).toBe(201);
  const configured = await request.post(`${path}/integrations/zendesk/configure`, {
    data: { subdomain: "stage1-fixture", email: "fixture@example.test", apiToken: "synthetic-not-a-real-token", connectionScope: "workspace", workspaceId },
  });
  expect(configured.status(), await configured.text()).toBe(201);
  const connection = (await configured.json()).connection;
  const grantsPath = `${path}/integrations/tool-grants?workspaceId=${encodeURIComponent(workspaceId)}`;
  const before = await (await request.get(grantsPath)).json();
  expect(before.grants).toEqual([]);
  const stale = publishRequest(workspaceId, 0, "Search support tickets when requested.");
  const agent = stale.graph.nodes.find((node) => node.kind === "agent")!;
  Object.assign(agent.config.role, { toolbeltAssignments: [{
    id: "zendesk-search", toolId: "zendesk.tickets.search", label: "Search tickets", description: "Search tickets", whenToUse: "Search support tickets.",
    connector: "zendesk", toolName: "Search tickets", integrationConnectionId: connection.id, connectionStatus: "connected", risk: "low", requiresAuthorization: true, requiresHumanApproval: false,
  }] });
  const rejected = await request.post(`${path}/workflows/e2e-concurrent-workflow/publish`, { data: stale });
  expect(rejected.status(), await rejected.text()).toBe(409);
  expect(await (await request.get(grantsPath)).json()).toEqual(before);
});
