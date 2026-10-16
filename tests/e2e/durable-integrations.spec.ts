import { expect, test } from "@playwright/test";
import { setTimeout } from "node:timers/promises";
import { database, literal, origin, peer, signup, startApi, stopApi } from "./control-plane-fixtures";

test.setTimeout(180_000);
test.afterAll(async () => { await setTimeout(11_000); });

test("integration secrets and deletion survive replicas, concurrent writes and restart", async ({ request, playwright }, testInfo) => {
  const owner = await signup(request, "integration-owner");
  const path = `/organizations/${owner.organizationId}/integrations`;
  const secret = "synthetic-zendesk-credential-834";
  const configure = (subdomain: string, headers = {}) => request.post(`${path}/zendesk/configure`, {
    headers, data: { subdomain, email: "agent@example.test", apiToken: secret },
  });
  const read = async (headers = {}) => {
    const response = await request.get(`${path}/connections`, { headers });
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain(secret);
    return (await response.json()).connections as Array<{ id: string; accountLabel: string }>;
  };
  const attacker = await playwright.request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    await read(peer);
    const created = await configure("durable-integration");
    expect(created.status(), await created.text()).toBe(201);
    const connection = (await created.json()).connection;
    expect((await read(peer)).map((item) => item.id)).toContain(connection.id);
    const stored = database(`SELECT state::text FROM integration_tenant_states WHERE organization_id = ${literal(owner.organizationId)}`);
    expect(stored).toContain(connection.id);
    expect(stored).toContain("aes-256-gcm");
    expect(stored).not.toContain(secret);
    const envelope = JSON.parse(stored).credentials[0].envelope;
    database(`UPDATE integration_tenant_states SET state = jsonb_set(state, '{credentials,0,envelope,keyVersion}', '999'), revision = revision + 1 WHERE organization_id = ${literal(owner.organizationId)}`);
    const unavailableKey = await request.post(`${path}/connections/${connection.id}/health-check`, { headers: peer, data: {} });
    expect(unavailableKey.status(), await unavailableKey.text()).toBe(201);
    expect((await unavailableKey.json()).connection.health.status).toBe("unhealthy");
    const preserved = JSON.parse(database(`SELECT state::text FROM integration_tenant_states WHERE organization_id = ${literal(owner.organizationId)}`));
    expect(preserved.credentials[0].envelope).toEqual({ ...envelope, keyVersion: 999 });
    database(`UPDATE integration_tenant_states SET state = jsonb_set(state, '{credentials,0,envelope,keyVersion}', ${literal(String(envelope.keyVersion))}::jsonb), revision = revision + 1 WHERE organization_id = ${literal(owner.organizationId)}`);

    await signup(attacker, "integration-other");
    for (const headers of [{}, peer]) {
      expect((await attacker.get(`${path}/connections`, { headers })).status()).toBe(403);
      expect((await attacker.delete(`${path}/connections/${connection.id}`, { headers })).status()).toBe(403);
    }
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => configure(`concurrent-${index}`, index % 2 ? peer : {})));
    for (const result of results) expect([201, 409], await result.text()).toContain(result.status());
    const acceptedIds = [connection.id];
    for (const result of results) {
      if (result.status() === 201) acceptedIds.push((await result.json()).connection.id);
    }
    for (const headers of [{}, peer]) expect((await read(headers)).map((item) => item.id).sort()).toEqual([...acceptedIds].sort());
    for (let index = 0; index < results.length; index++) {
      if (results[index].status() !== 409) continue;
      const retried = await configure(`concurrent-${index}`, peer);
      expect(retried.status(), await retried.text()).toBe(201);
      acceptedIds.push((await retried.json()).connection.id);
    }
    expect(acceptedIds).toHaveLength(7);
    const workspaceId = (await (await request.get("/api/auth/context")).json()).activeWorkspace.id;
    const grantData = { workspaceId, integrationConnectionId: connection.id, toolId: "zendesk.tickets.create", risk: "medium", approvalRequired: false };
    const grant = await request.post(`${path}/tool-grants`, { data: grantData });
    expect(grant.status(), await grant.text()).toBe(201);
    const webhook = await request.post(`${path}/webhook-tools`, { headers: peer, data: {
      workspaceId, toolName: "Durable notification", method: "POST", url: "https://hooks.example.test/notify",
      authToken: "synthetic-webhook-secret", timeoutMs: 1000, retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    } });
    expect(webhook.status(), await webhook.text()).toBe(201);
    const before = await read();
    await testInfo.attach("restart", { body: JSON.stringify(stopApi()), contentType: "application/json" });
    await startApi(request);
    expect(await read()).toEqual(before);
    const health = await request.post(`${path}/connections/${connection.id}/health-check`, { data: {} });
    expect(health.status(), await health.text()).toBe(201);
    expect((await health.json()).connection.health.status).toBe("healthy");
    const notificationData = {
      workspaceId, toolName: "Concurrent notification", method: "POST", url: "https://hooks.example.test/concurrent",
      timeoutMs: 1000, retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    };
    const [deleted, concurrentGrant, notification] = await Promise.all([
      request.delete(`${path}/connections/${connection.id}`, { data: {} }),
      request.post(`${path}/tool-grants`, { headers: peer, data: grantData }),
      request.post(`${path}/webhook-tools`, { headers: peer, data: notificationData }),
    ]);
    expect([200, 409], await deleted.text()).toContain(deleted.status());
    expect([201, 400, 409], await concurrentGrant.text()).toContain(concurrentGrant.status());
    expect([201, 409], await notification.text()).toContain(notification.status());
    if (deleted.status() === 409) expect((await request.delete(`${path}/connections/${connection.id}`, { data: {} })).status()).toBe(200);
    if (notification.status() === 409) expect((await request.post(`${path}/webhook-tools`, { data: notificationData })).status()).toBe(201);
    expect((await read(peer)).some((item) => item.id === connection.id)).toBe(false);
    const deletedState = JSON.parse(database(`SELECT state::text FROM integration_tenant_states WHERE organization_id = ${literal(owner.organizationId)}`));
    expect(deletedState.credentials.some((item: { connectionId: string }) => item.connectionId === connection.id)).toBe(false);
    expect(deletedState.toolGrants.some((item: { integrationConnectionId: string }) => item.integrationConnectionId === connection.id)).toBe(false);
    const tools = await request.get(`${path}/webhook-tools`);
    expect(await tools.text()).toContain("Durable notification");
    expect(await tools.text()).toContain("Concurrent notification");
    expect(await tools.text()).not.toContain("synthetic-webhook-secret");
    stopApi();
    await startApi(request);
    expect((await read()).some((item) => item.id === connection.id)).toBe(false);
    await testInfo.attach("accepted-concurrent-writes", { body: JSON.stringify({ acceptedCount: acceptedIds.length, conflicts: results.filter((result) => result.status() === 409).length }), contentType: "application/json" });
  } finally { await attacker.dispose(); }
});
