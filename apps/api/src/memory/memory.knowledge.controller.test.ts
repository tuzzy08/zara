import { afterEach, describe, expect, it, vi } from "vitest";import { Test } from "@nestjs/testing";import type { INestApplication } from "@nestjs/common";import request from "supertest";import { installTestTenantAuth } from "../testing/tenant-auth-request";import { InMemoryMemoryStateRepository, MEMORY_STATE_REPOSITORY } from "./memory-state.repository";import { MemoryModule } from "./memory.module";
describe("MemoryController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores tenant policies and FAQs with traceable sources filtered by published workflow", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const policyResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge")
      .send({
        actorUserId: "user-knowledge-admin",
        kind: "policy",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        title: "Refund routing policy",
        text: "Refund requests over 30 days must be routed to the retention specialist.",
        source: {
          kind: "manual",
          title: "Operations handbook",
          uri: "https://docs.example.test/ops/refunds",
        },
        now: "2026-05-18T08:00:00.000Z",
      });

    expect(policyResponse.status).toBe(201);
    expect(policyResponse.body.knowledge).toMatchObject({
      organizationId: "tenant-west-africa",
      kind: "policy",
      title: "Refund routing policy",
      text: "Refund requests over 30 days must be routed to the retention specialist.",
      publishedWorkflowVersionIds: ["published-receptionist-v7"],
      source: {
        kind: "manual",
        title: "Operations handbook",
        uri: "https://docs.example.test/ops/refunds",
      },
      status: "active",
    });

    const faqResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge")
      .send({
        actorUserId: "user-knowledge-admin",
        kind: "faq",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        title: "Delivery ETA answer",
        text: "Delivery updates are available after the courier scan completes.",
        source: {
          kind: "document",
          title: "Support FAQ",
          uri: "https://docs.example.test/support/faq",
          externalId: "faq-delivery-eta",
        },
        now: "2026-05-18T08:01:00.000Z",
      });

    expect(faqResponse.status).toBe(201);

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge")
      .send({
        actorUserId: "user-knowledge-admin",
        kind: "policy",
        publishedWorkflowVersionIds: ["published-billing-v3"],
        title: "Billing handoff policy",
        text: "Billing disputes route to the billing specialist.",
        source: {
          kind: "manual",
          title: "Billing handbook",
        },
      });

    await request(app.getHttpServer())
      .post("/organizations/tenant-east-africa/memory/knowledge")
      .send({
        actorUserId: "user-knowledge-admin",
        kind: "faq",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        title: "Tenant isolation FAQ",
        text: "This tenant's knowledge must not leak across organizations.",
        source: {
          kind: "manual",
          title: "East Africa FAQ",
        },
      });

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-receptionist-v7",
    );

    expect(retrievedResponse.status).toBe(200);
    expect(retrievedResponse.body.knowledge).toHaveLength(2);
    expect(
      retrievedResponse.body.knowledge.map((knowledge: { title: string }) => knowledge.title),
    ).toEqual(["Delivery ETA answer", "Refund routing policy"]);
    expect(retrievedResponse.body.knowledge[0].source).toMatchObject({
      kind: "document",
      title: "Support FAQ",
      uri: "https://docs.example.test/support/faq",
      externalId: "faq-delivery-eta",
    });

    await app.close();
  }, 15_000);

  it("excludes tenant knowledge after its stale timestamp for workflow retrieval", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge")
      .send({
        actorUserId: "user-knowledge-admin",
        kind: "policy",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        title: "Holiday hours policy",
        text: "Use the 2025 holiday hours until the 2026 schedule is approved.",
        source: {
          kind: "manual",
          title: "Seasonal operations memo",
        },
        staleAt: "2026-05-17T23:59:59.000Z",
        now: "2026-05-17T08:00:00.000Z",
      });

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge")
      .send({
        actorUserId: "user-knowledge-admin",
        kind: "faq",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        title: "Current delivery hours",
        text: "Delivery support is available from 8am to 8pm daily.",
        source: {
          kind: "manual",
          title: "Current support FAQ",
        },
        now: "2026-05-18T08:00:00.000Z",
      });

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-receptionist-v7&now=2026-05-18T08%3A00%3A00.000Z",
    );

    expect(retrievedResponse.status).toBe(200);
    expect(retrievedResponse.body.knowledge).toHaveLength(1);
    expect(retrievedResponse.body.knowledge[0]).toMatchObject({
      title: "Current delivery hours",
      status: "active",
    });

    await app.close();
  }, 15_000);

  it("surfaces conflicting tenant knowledge sources without overwriting either record", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge")
      .send({
        actorUserId: "user-knowledge-admin",
        kind: "faq",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        title: "Cancellation window",
        text: "Customers can cancel up to 24 hours before delivery.",
        source: {
          kind: "document",
          title: "Public FAQ",
          uri: "https://docs.example.test/public/cancellations",
        },
        now: "2026-05-18T08:00:00.000Z",
      });

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge")
      .send({
        actorUserId: "user-knowledge-admin",
        kind: "faq",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        title: "Cancellation window",
        text: "VIP customers can cancel up to 2 hours before delivery.",
        source: {
          kind: "integration",
          title: "CRM playbook",
          externalId: "playbook-vip-cancellations",
        },
        now: "2026-05-18T08:01:00.000Z",
      });

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-receptionist-v7",
    );

    expect(retrievedResponse.status).toBe(200);
    expect(retrievedResponse.body.knowledge).toHaveLength(2);
    expect(
      retrievedResponse.body.knowledge.map(
        (knowledge: { conflictState: string; title: string }) => ({
          title: knowledge.title,
          conflictState: knowledge.conflictState,
        }),
      ),
    ).toEqual([
      {
        title: "Cancellation window",
        conflictState: "conflicting",
      },
      {
        title: "Cancellation window",
        conflictState: "conflicting",
      },
    ]);
    expect(
      retrievedResponse.body.knowledge.map(
        (knowledge: { source: { title: string } }) => knowledge.source.title,
      ),
    ).toEqual(["CRM playbook", "Public FAQ"]);

    await app.close();
  }, 15_000);

  it("creates knowledge source snapshots and review drafts before scoped runtime retrieval", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const manualResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "manual_text",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        title: "Returns procedure",
        recordType: "procedure",
        text: "Agents must confirm the order number before starting a return.",
        now: "2026-06-06T08:00:00.000Z",
      });

    expect(manualResponse.status).toBe(201);
    expect(manualResponse.body.source).toMatchObject({
      organizationId: "tenant-west-africa",
      sourceType: "manual_text",
      title: "Returns procedure",
      workspaceId: "workspace-customer-success",
      workflowIds: ["workflow-support"],
      status: "activated",
      extractedRecordCount: 1,
    });
    expect(manualResponse.body.knowledge).toEqual([
      expect.objectContaining({
        organizationId: "tenant-west-africa",
        kind: "procedure",
        title: "Returns procedure",
        text: "Agents must confirm the order number before starting a return.",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        status: "active",
        source: expect.objectContaining({
          kind: "manual",
          title: "Returns procedure",
          sourceSnapshotId: manualResponse.body.source.id,
        }),
      }),
    ]);
    expect(manualResponse.body.reviewDrafts).toEqual([]);

    const urlResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "single_url",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        title: "Legal cancellation terms",
        uri: "https://example.test/legal/cancellations",
        text: "Legal compliance policy: callers can cancel up to 24 hours before delivery.",
        now: "2026-06-06T08:05:00.000Z",
      });

    expect(urlResponse.status).toBe(201);
    expect(urlResponse.body.source).toMatchObject({
      organizationId: "tenant-west-africa",
      sourceType: "single_url",
      title: "Legal cancellation terms",
      uri: "https://example.test/legal/cancellations",
      workspaceId: "workspace-customer-success",
      workflowIds: ["workflow-support"],
      status: "review_required",
      extractedRecordCount: 1,
    });
    expect(urlResponse.body.knowledge).toEqual([]);
    expect(urlResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        organizationId: "tenant-west-africa",
        sourceSnapshotId: urlResponse.body.source.id,
        title: "Legal cancellation terms",
        text: "Legal compliance policy: callers can cancel up to 24 hours before delivery.",
        suggestedKind: "legal_compliance",
        kindConfirmed: false,
        requiresKindConfirmation: true,
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        status: "draft",
      }),
    ]);

    const draftId = String(urlResponse.body.reviewDrafts[0].id);
    const beforeApprovalResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );

    expect(beforeApprovalResponse.status).toBe(200);
    expect(
      beforeApprovalResponse.body.knowledge.map((knowledge: { title: string }) => knowledge.title),
    ).toEqual(["Returns procedure"]);

    const blockedApprovalResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${draftId}/approve`)
      .send({
        approverUserId: "user-knowledge-admin",
        now: "2026-06-06T08:06:00.000Z",
      });

    expect(blockedApprovalResponse.status).toBe(400);
    expect(blockedApprovalResponse.body.message).toContain("confirm");

    const approvalResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${draftId}/approve`)
      .send({
        approverUserId: "user-knowledge-admin",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved legal cancellation source.",
        recordType: "legal_compliance",
        confirmHighRiskKind: true,
        now: "2026-06-06T08:07:00.000Z",
      });

    expect(approvalResponse.status).toBe(201);
    expect(approvalResponse.body.reviewDraft).toMatchObject({
      id: draftId,
      status: "approved",
      kindConfirmed: true,
      approvedKnowledgeRecordId: approvalResponse.body.knowledge.id,
    });
    expect(approvalResponse.body.knowledge).toMatchObject({
      kind: "legal_compliance",
      title: "Legal cancellation terms",
      workspaceId: "workspace-customer-success",
      workflowIds: ["workflow-support"],
      source: expect.objectContaining({
        kind: "document",
        uri: "https://example.test/legal/cancellations",
        sourceSnapshotId: urlResponse.body.source.id,
      }),
    });

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );

    expect(retrievedResponse.status).toBe(200);
    expect(
      retrievedResponse.body.knowledge.map((knowledge: { title: string }) => knowledge.title),
    ).toEqual(["Legal cancellation terms", "Returns procedure"]);

    const otherWorkspaceResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-growth&workflowId=workflow-support",
    );

    expect(otherWorkspaceResponse.status).toBe(200);
    expect(otherWorkspaceResponse.body.knowledge).toEqual([]);

    const exportResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/export",
    );

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.export.knowledgeSources).toHaveLength(2);
    expect(exportResponse.body.export.knowledgeReviewDrafts).toEqual([
      expect.objectContaining({
        id: draftId,
        status: "approved",
        sourceSnapshotId: urlResponse.body.source.id,
      }),
    ]);

    await app.close();
  }, 15_000);
});
