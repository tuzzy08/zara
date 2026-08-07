import { afterEach, describe, expect, it, vi } from "vitest";import { Test } from "@nestjs/testing";import type { INestApplication } from "@nestjs/common";import request from "supertest";import { installTestTenantAuth, withTestTenantAuth } from "../testing/tenant-auth-request";import { InMemoryMemoryStateRepository, MEMORY_STATE_REPOSITORY } from "./memory-state.repository";import { MemoryModule } from "./memory.module";import { INTEGRATION_STATE_REPOSITORY } from "../integrations/integrations-state.repository";import { createProviderImportIntegrationRepository } from "./memory.controller.test-support";

describe("MemoryController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("degrades provider recurring sync on auth failure without deleting active knowledge", async () => {
    const connectionId = "integration_connection_notion_support";
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .overrideProvider(INTEGRATION_STATE_REPOSITORY)
      .useValue(createProviderImportIntegrationRepository({ connectionId, granted: true }))
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const sourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "provider_import",
        syncMode: "recurring",
        syncCadence: "daily",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        providerId: "notion",
        integrationConnectionId: connectionId,
        externalId: "notion-page-refunds",
        title: "Notion refunds article",
        text: "Policy: refund requests over 30 days route to retention.",
        now: "2026-06-06T08:00:00.000Z",
      });
    const approvalResponse = await request(app.getHttpServer())
      .post(
        `/organizations/tenant-west-africa/memory/knowledge/review-drafts/${sourceResponse.body.reviewDrafts[0].id}/approve`,
      )
      .send({
        approverUserId: "user-knowledge-admin",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved Notion refund policy source.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-06T08:05:00.000Z",
      });
    const approvedKnowledgeId = String(approvalResponse.body.knowledge.id);

    const degradedResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/sources/${sourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "user-knowledge-admin",
        trigger: "daily",
        providerFailure: "auth_revoked",
        now: "2026-06-07T08:00:00.000Z",
      });

    expect(degradedResponse.status).toBe(201);
    expect(degradedResponse.body).toMatchObject({
      source: {
        id: sourceResponse.body.source.id,
        status: "activated",
        syncStatus: "degraded",
        degradedReason: "auth_revoked",
        refreshPausedAt: "2026-06-07T08:00:00.000Z",
      },
      knowledge: [],
      reviewDrafts: [],
    });
    expect(degradedResponse.body.source.nextSyncAt).toBeUndefined();

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );

    expect(retrievedResponse.body.knowledge).toEqual([
      expect.objectContaining({
        id: approvedKnowledgeId,
        text: "Policy: refund requests over 30 days route to retention.",
        status: "active",
      }),
    ]);

    await app.close();
  }, 15_000);

  it("labels sensitive synced knowledge and blocks credentials from runtime activation", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const sourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "single_url",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        title: "Private support runbook",
        uri: "https://example.test/internal/runbook",
        text: "Internal only runbook. Password: hunter2. API key sk-test-1234567890abcdef.",
        now: "2026-06-06T08:00:00.000Z",
      });

    expect(sourceResponse.status).toBe(201);
    expect(sourceResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        sensitivityLabels: ["credentials_secrets", "internal_only"],
        activationBlockers: [
          expect.objectContaining({
            code: "credentials_or_secrets_detected",
            label: "credentials_secrets",
          }),
        ],
      }),
    ]);

    const approvalResponse = await request(app.getHttpServer())
      .post(
        `/organizations/tenant-west-africa/memory/knowledge/review-drafts/${sourceResponse.body.reviewDrafts[0].id}/approve`,
      )
      .send({
        approverUserId: "user-knowledge-admin",
        recordType: "general_reference",
        now: "2026-06-06T08:05:00.000Z",
      });

    expect(approvalResponse.status).toBe(400);
    expect(approvalResponse.body.message).toContain("credentials");

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );
    expect(retrievedResponse.body.knowledge).toEqual([]);

    await app.close();
  }, 15_000);

  it("requires owner or admin approval metadata for high-risk knowledge activation", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const sourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-builder",
        sourceType: "single_url",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        title: "Pricing policy",
        uri: "https://example.test/pricing",
        text: "Pricing policy: premium support costs 99 dollars per month.",
        now: "2026-06-06T08:00:00.000Z",
      });
    const draftId = String(sourceResponse.body.reviewDrafts[0].id);

    const builderApprovalResponse = await withTestTenantAuth(
      request(app.getHttpServer()).post(
        `/organizations/tenant-west-africa/memory/knowledge/review-drafts/${draftId}/approve`,
      ),
      { role: "builder", userId: "user-builder" },
    )
      .send({
        approverUserId: "user-builder",
        approverRole: "builder",
        workspaceId: "workspace-customer-success",
        reason: "Builder attempted to approve pricing.",
        recordType: "pricing",
        confirmHighRiskKind: true,
        now: "2026-06-06T08:05:00.000Z",
      });

    expect(builderApprovalResponse.status).toBe(403);
    expect(builderApprovalResponse.body.message).toContain("owner or admin");

    const ownerApprovalResponse = await withTestTenantAuth(
      request(app.getHttpServer()).post(
        `/organizations/tenant-west-africa/memory/knowledge/review-drafts/${draftId}/approve`,
      ),
      { role: "owner", userId: "user-owner" },
    )
      .send({
        approverUserId: "user-owner",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved public pricing source.",
        recordType: "pricing",
        confirmHighRiskKind: true,
        now: "2026-06-06T08:10:00.000Z",
      });

    expect(ownerApprovalResponse.status).toBe(201);
    expect(ownerApprovalResponse.body.reviewDraft.auditTrail).toContainEqual(
      expect.objectContaining({
        action: "approved",
        actorUserId: "user-owner",
        actorRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved public pricing source.",
        beforeState: expect.objectContaining({ status: "draft" }),
        afterState: expect.objectContaining({
          status: "approved",
          approvedKnowledgeRecordId: ownerApprovalResponse.body.knowledge.id,
        }),
        at: "2026-06-06T08:10:00.000Z",
      }),
    );

    await app.close();
  }, 15_000);

  it("requires high-risk confirmation and owner or admin approval when the reviewer changes the record type", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const sourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-builder",
        sourceType: "single_url",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        title: "Office hours article",
        uri: "https://example.test/support-hours",
        text: "The office opens at 9am and closes at 5pm.",
        now: "2026-06-06T08:00:00.000Z",
      });

    expect(sourceResponse.status).toBe(201);
    expect(sourceResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        suggestedKind: "general_reference",
        requiresKindConfirmation: false,
      }),
    ]);
    const draftId = String(sourceResponse.body.reviewDrafts[0].id);

    const missingConfirmationResponse = await withTestTenantAuth(
      request(app.getHttpServer()).post(
        `/organizations/tenant-west-africa/memory/knowledge/review-drafts/${draftId}/approve`,
      ),
      { role: "owner", userId: "user-owner" },
    )
      .send({
        approverUserId: "user-owner",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approving as policy without explicit confirmation.",
        recordType: "policy",
        now: "2026-06-06T08:05:00.000Z",
      });

    expect(missingConfirmationResponse.status).toBe(400);
    expect(missingConfirmationResponse.body.message).toContain("High-risk");

    const builderApprovalResponse = await withTestTenantAuth(
      request(app.getHttpServer()).post(
        `/organizations/tenant-west-africa/memory/knowledge/review-drafts/${draftId}/approve`,
      ),
      { role: "builder", userId: "user-builder" },
    )
      .send({
        approverUserId: "user-builder",
        approverRole: "builder",
        workspaceId: "workspace-customer-success",
        reason: "Builder attempted to approve policy record type.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-06T08:06:00.000Z",
      });

    expect(builderApprovalResponse.status).toBe(403);
    expect(builderApprovalResponse.body.message).toContain("owner or admin");

    const ownerApprovalResponse = await withTestTenantAuth(
      request(app.getHttpServer()).post(
        `/organizations/tenant-west-africa/memory/knowledge/review-drafts/${draftId}/approve`,
      ),
      { role: "owner", userId: "user-owner" },
    )
      .send({
        approverUserId: "user-owner",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved support hours as policy.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-06T08:10:00.000Z",
      });

    expect(ownerApprovalResponse.status).toBe(201);
    expect(ownerApprovalResponse.body.knowledge).toMatchObject({
      kind: "policy",
      status: "active",
    });

    await app.close();
  }, 15_000);

  it("review-gates PDF snapshots and rejects unsupported provider knowledge imports", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const pdfResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "pdf",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        title: "Troubleshooting PDF",
        uri: "https://example.test/troubleshooting.pdf",
        contentType: "application/pdf",
        text: "Troubleshooting steps: restart the terminal, check the router, then escalate if the issue remains.",
        now: "2026-06-06T09:00:00.000Z",
      });

    expect(pdfResponse.status).toBe(201);
    expect(pdfResponse.body.source).toMatchObject({
      sourceType: "pdf",
      status: "review_required",
      contentType: "application/pdf",
      extractedRecordCount: 1,
    });
    expect(pdfResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        suggestedKind: "troubleshooting",
        requiresKindConfirmation: false,
        status: "draft",
      }),
    ]);

    const unsupportedProviderResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "provider_import",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        providerId: "hubspot",
        integrationConnectionId: "integration_connection_hubspot",
        externalId: "hubspot-article-1",
        title: "HubSpot sales note",
        text: "HubSpot is not a supported knowledge source in this slice.",
        now: "2026-06-06T09:05:00.000Z",
      });

    expect(unsupportedProviderResponse.status).toBe(400);
    expect(unsupportedProviderResponse.body.message).toContain("knowledge source");

    await app.close();
  }, 15_000);

  it("keeps imported sources with no usable extracted records visible as failed snapshots", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "single_url",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        title: "Empty support article",
        uri: "https://example.test/support/empty",
        text: "   ",
        now: "2026-06-06T09:10:00.000Z",
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      source: {
        organizationId: "tenant-west-africa",
        sourceType: "single_url",
        title: "Empty support article",
        status: "failed",
        extractedRecordCount: 0,
      },
      knowledge: [],
      reviewDrafts: [],
    });

    const exportResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/export",
    );

    expect(exportResponse.body.export.knowledgeSources).toEqual([
      expect.objectContaining({
        id: response.body.source.id,
        status: "failed",
        extractedRecordCount: 0,
      }),
    ]);

    await app.close();
  }, 15_000);

  it("requires connected provider imports to have an active knowledge-source grant", async () => {
    const connectionId = "integration_connection_notion_support";
    const sourceRequest = {
      actorUserId: "user-knowledge-admin",
      sourceType: "provider_import",
      workspaceId: "workspace-customer-success",
      workflowIds: ["workflow-support", "workflow-billing"],
      providerId: "notion",
      integrationConnectionId: connectionId,
      externalId: "notion-page-refunds",
      title: "Notion refunds article",
      text: "Policy: refund requests over 30 days route to retention.",
      now: "2026-06-06T09:20:00.000Z",
    };

    const ungrantedModuleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .overrideProvider(INTEGRATION_STATE_REPOSITORY)
      .useValue(createProviderImportIntegrationRepository({ connectionId, granted: false }))
      .compile();
    const ungrantedApp: INestApplication = ungrantedModuleRef.createNestApplication();
    installTestTenantAuth(ungrantedApp);
    await ungrantedApp.init();

    const ungrantedResponse = await request(ungrantedApp.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send(sourceRequest);

    expect(ungrantedResponse.status).toBe(400);
    expect(ungrantedResponse.body.message).toContain("knowledge-source grant");
    await ungrantedApp.close();

    const grantedModuleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .overrideProvider(INTEGRATION_STATE_REPOSITORY)
      .useValue(createProviderImportIntegrationRepository({ connectionId, granted: true }))
      .compile();
    const grantedApp: INestApplication = grantedModuleRef.createNestApplication();
    installTestTenantAuth(grantedApp);
    await grantedApp.init();

    const grantedResponse = await request(grantedApp.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send(sourceRequest);

    expect(grantedResponse.status).toBe(201);
    expect(grantedResponse.body.source).toMatchObject({
      sourceType: "provider_import",
      providerId: "notion",
      integrationConnectionId: connectionId,
      externalId: "notion-page-refunds",
      status: "review_required",
    });
    expect(grantedResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        sourceSnapshotId: grantedResponse.body.source.id,
        suggestedKind: "pricing",
        status: "draft",
      }),
    ]);
    await grantedApp.close();
  }, 15_000);
});
