import { afterEach, describe, expect, it, vi } from "vitest";import { Test } from "@nestjs/testing";import type { INestApplication } from "@nestjs/common";import request from "supertest";import { installTestTenantAuth } from "../testing/tenant-auth-request";import { InMemoryMemoryStateRepository, MEMORY_STATE_REPOSITORY } from "./memory-state.repository";import { MemoryModule } from "./memory.module";
describe("MemoryController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enforces memory privacy retention export and tenant delete controls", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const sensitiveResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller card number is 4242 4242 4242 4242 and CVV is 123.",
        optIn: true,
        source: {
          kind: "manual",
        },
      });

    expect(sensitiveResponse.status).toBe(400);
    expect(sensitiveResponse.body.message).toContain("Sensitive memory");

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller prefers WhatsApp updates for delivery windows.",
        optIn: true,
        source: {
          kind: "manual",
          externalId: "fresh-memory",
        },
        embedding: [0, 1, 0],
        now: "2026-05-18T08:00:00.000Z",
      });

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Expired memory should be purged by retention.",
        optIn: true,
        source: {
          kind: "manual",
          externalId: "expired-memory",
        },
        embedding: [1, 0, 0],
        now: "2026-01-01T08:00:00.000Z",
      });

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/ingestions")
      .send({
        actorUserId: "user-knowledge-admin",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        sources: [
          {
            clientSourceId: "expired-source",
            type: "document",
            title: "Expired refund policy",
            text: "Expired policy should be purged with its ingestion source.",
          },
        ],
        now: "2026-01-01T08:00:00.000Z",
      });

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge")
      .send({
        actorUserId: "user-knowledge-admin",
        kind: "faq",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        title: "Fresh delivery FAQ",
        text: "Fresh delivery knowledge should remain after retention purge.",
        source: {
          kind: "manual",
          title: "Fresh support FAQ",
        },
        now: "2026-05-18T08:01:00.000Z",
      });

    await request(app.getHttpServer())
      .post("/organizations/tenant-east-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+254700111222",
        },
        text: "Other tenant memory must survive west tenant delete.",
        optIn: true,
        source: {
          kind: "manual",
        },
      });

    const purgeResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/retention/purge")
      .send({
        actorUserId: "user-compliance-admin",
        retainAfter: "2026-05-01T00:00:00.000Z",
        now: "2026-05-19T13:00:00.000Z",
      });

    expect(purgeResponse.status).toBe(200);
    expect(purgeResponse.body.retention).toMatchObject({
      organizationId: "tenant-west-africa",
      retainedAfter: "2026-05-01T00:00:00.000Z",
      purgedCounts: {
        memories: 1,
        knowledge: 1,
        embeddings: 1,
        ingestionSources: 1,
      },
    });

    const exportResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/export",
    );

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.export.memories.map((memory: { text: string }) => memory.text)).toEqual([
      "Caller prefers WhatsApp updates for delivery windows.",
    ]);
    expect(
      exportResponse.body.export.knowledge.map((knowledge: { title: string }) => knowledge.title),
    ).toEqual(["Fresh delivery FAQ"]);
    expect(exportResponse.body.export.embeddings).toHaveLength(1);
    expect(exportResponse.body.export.ingestions[0].sources).toEqual([]);

    const legalHoldResponse = await request(app.getHttpServer())
      .delete("/organizations/tenant-west-africa/memory/tenant-data")
      .send({
        actorUserId: "user-compliance-admin",
        legalHold: true,
      });

    expect(legalHoldResponse.status).toBe(409);
    expect(legalHoldResponse.body.message).toContain("legal hold");

    const deleteResponse = await request(app.getHttpServer())
      .delete("/organizations/tenant-west-africa/memory/tenant-data")
      .send({
        actorUserId: "user-compliance-admin",
        now: "2026-05-19T13:05:00.000Z",
      });

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.deletion).toMatchObject({
      organizationId: "tenant-west-africa",
      deletedCounts: {
        memories: 1,
        knowledge: 1,
        embeddings: 1,
        ingestions: 1,
      },
    });

    const emptyExportResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/export",
    );
    expect(emptyExportResponse.body.export.memories).toEqual([]);
    expect(emptyExportResponse.body.export.knowledge).toEqual([]);
    expect(emptyExportResponse.body.export.embeddings).toEqual([]);
    expect(emptyExportResponse.body.export.ingestions).toEqual([]);

    const otherTenantResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-east-africa/memory?callerKind=phone&callerValue=%2B254700111222",
    );
    expect(otherTenantResponse.body.memories).toHaveLength(1);

    await app.close();
  }, 15_000);
});
