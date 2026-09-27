import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { BillingDeliveryControlRepository, BillingDeliveryControlService } from "../billing/billing-delivery-control";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminService } from "./platform-admin.service";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PostgresTenantStatusRepository } from "../persistence/tenant-status.repository";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("billing delivery owner API", () => {
  it("saves an owner decision, retries it without moving the cutoff, and stops despite invalid configuration", async () => {
    const schema = `delivery_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    await admin.query(`create schema ${schema}`);
    const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL, options: `-c search_path=${schema}` });
    let configurationValid = true;
    try {
      await pool.query("create table billing_outbox (id text primary key)");
      await pool.query(`create table audit_logs (
        id text primary key, tenant_id text, actor_type text, actor_id text, action text,
        target_type text, target_id text, metadata jsonb, occurred_at timestamptz
      )`);
      await pool.query(readFileSync("apps/api/src/database/migrations/0041_billing_delivery_decisions.sql", "utf8").replaceAll('"public".', `"${schema}".`));
      const service = new BillingDeliveryControlService(new BillingDeliveryControlRepository(pool), async () => {
        if (!configurationValid) throw new Error("Invalid configuration");
        return { catalogId: "catalog-live", releaseId: "release-live" };
      });
      const module = await Test.createTestingModule({ controllers: [PlatformAdminController], providers: [
        PlatformAdminGuard, { provide: PlatformAdminService, useValue: {} },
        { provide: BillingDeliveryControlService, useValue: service },
      ] }).compile();
      const app = module.createNestApplication();
      await app.init();
      try {
        const patch = (body: unknown, role = "platform_owner", assurance = "mfa", age = "20") => request(app.getHttpServer())
          .patch("/platform-admin/billing/delivery").set("x-zara-test-platform-role", role)
          .set("x-zara-test-actor-user-id", "owner-1").set("x-zara-test-auth-assurance", assurance)
          .set("x-zara-test-session-age-seconds", age).send(body as object);
        const body = { requestId: "enable-1", expectedDecisionId: null, enabled: true, reason: "Enable new usage" };
        expect((await patch(body, "platform_admin")).status).toBe(403);
        expect((await patch(body, "platform_owner", "password")).status).toBe(403);
        expect((await patch(body, "platform_owner", "mfa", "901")).status).toBe(403);
        expect((await request(app.getHttpServer()).patch("/platform-admin/billing/delivery").send(body)).status).toBe(403);
        for (const invalid of [null, { ...body, enabled: "true" }, { ...body, reason: " " },
          { ...body, actorUserId: "forged" }, { ...body, effectiveAt: "2020-01-01" },
          { ...body, catalogId: "forged" }, { ...body, releaseId: "forged" }]) {
          expect((await patch(invalid)).status).toBe(400);
        }
        const enabled = await patch(body);
        expect(enabled.status).toBe(200);
        expect(enabled.body).toMatchObject({ id: "enable-1", enabled: true, actorUserId: "owner-1", catalogId: "catalog-live", releaseId: "release-live" });
        expect(Number.isFinite(Date.parse(enabled.body.effectiveAt))).toBe(true);
        expect((await patch(body)).body).toEqual(enabled.body);
        expect((await patch({ ...body, reason: "changed" })).status).toBe(409);
        expect((await patch({ ...body, requestId: "stale" })).status).toBe(409);
        configurationValid = false;
        const stopped = await patch({ requestId: "stop-1", expectedDecisionId: "enable-1", enabled: false, reason: "Stop delivery" });
        expect(stopped.status).toBe(200);
        expect(stopped.body).toMatchObject({ id: "stop-1", enabled: false });
        const audit = new PostgresTenantStatusRepository(pool);
        expect(await audit.listAuditLogs({ actorUserId: "owner-1" })).toEqual([
          expect.objectContaining({ action: "billing.delivery.stopped", actorId: "owner-1",
            targetType: "billing_delivery", targetId: "stop-1", metadata: expect.objectContaining({ actorRole: "platform_owner", outcome: "succeeded" }) }),
          expect.objectContaining({ action: "billing.delivery.enabled", actorId: "owner-1",
            targetType: "billing_delivery", targetId: "enable-1", metadata: expect.objectContaining({ actorRole: "platform_owner", outcome: "succeeded" }) }),
        ]);
        expect(await audit.listAuditLogs({ tenantId: "unrelated-tenant" })).toEqual([]);
        const state = await request(app.getHttpServer()).get("/platform-admin/billing/delivery")
          .set("x-zara-test-platform-role", "platform_owner").set("x-zara-test-session-age-seconds", "20");
        expect(state.body).toEqual(stopped.body);
        configurationValid = true;
        await pool.query("alter table audit_logs add constraint reject_test_audit check (target_id <> 'audit-failure')");
        expect((await patch({ ...body, requestId: "audit-failure", expectedDecisionId: "stop-1" })).status).toBe(500);
        expect(await service.getState()).toEqual(stopped.body);
        const raced = await Promise.all(["enable-2", "enable-3"].map(requestId => patch({
          ...body, requestId, expectedDecisionId: "stop-1",
        })));
        expect(raced.map(result => result.status).sort()).toEqual([200, 409]);
        const winner = raced.find(result => result.status === 200)!;
        expect(Date.parse(winner.body.effectiveAt)).toBeGreaterThanOrEqual(Date.parse(stopped.body.effectiveAt));
        const replay = await patch(body);
        expect(replay.body).toEqual(enabled.body);
        const latest = await request(app.getHttpServer()).get("/platform-admin/billing/delivery")
          .set("x-zara-test-platform-role", "platform_owner").set("x-zara-test-session-age-seconds", "20");
        expect(latest.body).toEqual(winner.body);
      } finally { await app.close(); }
    } finally {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  }, 30_000);
});
