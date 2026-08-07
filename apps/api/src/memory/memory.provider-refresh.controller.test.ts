import { afterEach, describe, expect, it, vi } from "vitest";import { Test } from "@nestjs/testing";import type { INestApplication } from "@nestjs/common";import request from "supertest";import { installTestTenantAuth } from "../testing/tenant-auth-request";import { InMemoryMemoryStateRepository, MEMORY_STATE_REPOSITORY } from "./memory-state.repository";import { MemoryModule } from "./memory.module";import { INTEGRATION_STATE_REPOSITORY } from "../integrations/integrations-state.repository";import { createMutableIntegrationRepository, connectKnowledgeSourceProvider, configureFreshdeskKnowledgeSourceProvider, mockJsonResponse, mockTextResponse } from "./memory.controller.test-support";

describe("MemoryController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("degrades Salesforce Knowledge refresh failures and review-gates Freshdesk source deletions", async () => {
    const integrationRepository = createMutableIntegrationRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .overrideProvider(INTEGRATION_STATE_REPOSITORY)
      .useValue(integrationRepository)
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const freshdeskConnectionId = await configureFreshdeskKnowledgeSourceProvider(app);
    const salesforceKnowledgeConnectionId = await connectKnowledgeSourceProvider(app, {
      provider: "salesforce-knowledge",
      requestedScopes: ["api", "refresh_token"],
      toolId: "salesforce-knowledge.articles.import",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, [
          {
            id: 101,
            title: "Refund policy",
            description_text: "Refunds over 45 days need manager approval.",
            status: 2,
          },
        ]),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          records: [
            {
              Id: "ka0ReturnPolicy",
              Title: "Returns policy",
              Summary: "Return requests after 45 days require a manager review.",
              PublishStatus: "Online",
              IsLatestVersion: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse(200, []))
      .mockResolvedValueOnce(mockJsonResponse(401, [{ errorCode: "INVALID_SESSION_ID" }]));
    vi.stubGlobal("fetch", fetchMock);

    const freshdeskSourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "provider_import",
        syncMode: "recurring",
        syncCadence: "daily",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        providerId: "freshdesk",
        integrationConnectionId: freshdeskConnectionId,
        externalId: "folder:42",
        title: "Freshdesk refund policy",
        now: "2026-06-08T10:00:00.000Z",
      });
    const freshdeskDraftId = String(freshdeskSourceResponse.body.reviewDrafts[0].id);
    const freshdeskApprovalResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${freshdeskDraftId}/approve`)
      .send({
        approverUserId: "user-owner",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved Freshdesk policy.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-08T10:01:00.000Z",
      });
    const freshdeskKnowledgeId = String(freshdeskApprovalResponse.body.knowledge.id);

    const salesforceKnowledgeSourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "provider_import",
        syncMode: "recurring",
        syncCadence: "daily",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        providerId: "salesforce-knowledge",
        integrationConnectionId: salesforceKnowledgeConnectionId,
        externalId: "article:ka0ReturnPolicy",
        title: "Salesforce returns knowledge",
        now: "2026-06-08T10:05:00.000Z",
      });
    const salesforceKnowledgeDraftId = String(salesforceKnowledgeSourceResponse.body.reviewDrafts[0].id);
    const salesforceKnowledgeApprovalResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${salesforceKnowledgeDraftId}/approve`)
      .send({
        approverUserId: "user-owner",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved Salesforce Knowledge article.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-08T10:06:00.000Z",
      });
    const salesforceKnowledgeId = String(salesforceKnowledgeApprovalResponse.body.knowledge.id);

    const deletionResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/sources/${freshdeskSourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "user-knowledge-admin",
        trigger: "daily",
        now: "2026-06-09T10:00:00.000Z",
      });

    expect(deletionResponse.status).toBe(201);
    expect(deletionResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        changeType: "deletion",
        currentKnowledgeRecordId: freshdeskKnowledgeId,
        title: "Refund policy",
        text: "Refunds over 45 days need manager approval.",
        sourceUri: "https://tuzzy-support.freshdesk.com/a/solutions/articles/101",
        status: "draft",
      }),
    ]);

    const degradedResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/sources/${salesforceKnowledgeSourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "user-knowledge-admin",
        trigger: "daily",
        now: "2026-06-09T10:05:00.000Z",
      });

    expect(degradedResponse.status).toBe(201);
    expect(degradedResponse.body).toMatchObject({
      source: {
        id: salesforceKnowledgeSourceResponse.body.source.id,
        status: "activated",
        syncStatus: "degraded",
        degradedReason: "auth_revoked",
        refreshPausedAt: "2026-06-09T10:05:00.000Z",
      },
      knowledge: [],
      reviewDrafts: [],
    });

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );
    expect(retrievedResponse.body.knowledge).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: freshdeskKnowledgeId, status: "active" }),
        expect.objectContaining({ id: salesforceKnowledgeId, status: "active" }),
      ]),
    );

    await app.close();
  }, 15_000);

  it("degrades provider refresh failures and review-gates SharePoint source deletions", async () => {
    const integrationRepository = createMutableIntegrationRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .overrideProvider(INTEGRATION_STATE_REPOSITORY)
      .useValue(integrationRepository)
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const confluenceConnectionId = await connectKnowledgeSourceProvider(app, {
      provider: "confluence",
      requestedScopes: ["read:page:confluence", "read:space:confluence"],
      toolId: "confluence.pages.import",
    });
    const sharepointConnectionId = await connectKnowledgeSourceProvider(app, {
      provider: "sharepoint",
      requestedScopes: ["Files.Read", "Sites.Read.All"],
      toolId: "sharepoint.items.import",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: "page-refunds",
          title: "Refund policy",
          body: {
            storage: {
              value: "<p>Refunds over 45 days need manager approval.</p>",
            },
          },
          _links: {
            webui: "/wiki/spaces/SUP/pages/page-refunds/Refund+policy",
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          value: [
            {
              id: "file-installation",
              name: "Installation procedure.txt",
              webUrl: "https://contoso.sharepoint.com/sites/support/Shared%20Documents/Installation%20procedure.txt",
              file: {
                mimeType: "text/plain",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(mockTextResponse(200, "Procedure: confirm site contact before installation."))
      .mockResolvedValueOnce(mockJsonResponse(403, { error: { code: "accessDenied" } }))
      .mockResolvedValueOnce(mockJsonResponse(200, { value: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const confluenceSourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "provider_import",
        syncMode: "recurring",
        syncCadence: "daily",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        providerId: "confluence",
        integrationConnectionId: confluenceConnectionId,
        externalId: "page:page-refunds",
        title: "Confluence refund policy",
        now: "2026-06-08T08:00:00.000Z",
      });
    const confluenceDraftId = String(confluenceSourceResponse.body.reviewDrafts[0].id);
    const confluenceApprovalResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${confluenceDraftId}/approve`)
      .send({
        approverUserId: "user-owner",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved Confluence policy.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-08T08:01:00.000Z",
      });
    const confluenceKnowledgeId = String(confluenceApprovalResponse.body.knowledge.id);

    const sharepointSourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "provider_import",
        syncMode: "recurring",
        syncCadence: "daily",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        providerId: "sharepoint",
        integrationConnectionId: sharepointConnectionId,
        externalId: "site:contoso-support:drive:documents:item:folder-support",
        title: "SharePoint installation procedures",
        now: "2026-06-08T08:05:00.000Z",
      });
    const sharepointDraftId = String(sharepointSourceResponse.body.reviewDrafts[0].id);
    const sharepointApprovalResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${sharepointDraftId}/approve`)
      .send({
        approverUserId: "user-owner",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved SharePoint procedure.",
        recordType: "procedure",
        now: "2026-06-08T08:06:00.000Z",
      });
    const sharepointKnowledgeId = String(sharepointApprovalResponse.body.knowledge.id);

    const degradedResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/sources/${confluenceSourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "user-knowledge-admin",
        trigger: "daily",
        now: "2026-06-09T08:00:00.000Z",
      });

    expect(degradedResponse.status).toBe(201);
    expect(degradedResponse.body).toMatchObject({
      source: {
        id: confluenceSourceResponse.body.source.id,
        status: "activated",
        syncStatus: "degraded",
        degradedReason: "permission_denied",
        refreshPausedAt: "2026-06-09T08:00:00.000Z",
      },
      knowledge: [],
      reviewDrafts: [],
    });

    const deletionResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/sources/${sharepointSourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "user-knowledge-admin",
        trigger: "daily",
        now: "2026-06-09T08:05:00.000Z",
      });

    expect(deletionResponse.status).toBe(201);
    expect(deletionResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        changeType: "deletion",
        currentKnowledgeRecordId: sharepointKnowledgeId,
        title: "Installation procedure.txt",
        text: "Procedure: confirm site contact before installation.",
        sourceUri: "https://contoso.sharepoint.com/sites/support/Shared%20Documents/Installation%20procedure.txt",
        status: "draft",
      }),
    ]);

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );
    expect(retrievedResponse.body.knowledge).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: confluenceKnowledgeId, status: "active" }),
        expect.objectContaining({ id: sharepointKnowledgeId, status: "active" }),
      ]),
    );

    await app.close();
  }, 15_000);

  it("ingests supported knowledge sources, exposes status, and retries failed sources", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const ingestionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/ingestions")
      .send({
        actorUserId: "user-knowledge-admin",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        sources: [
          {
            clientSourceId: "docs-refunds",
            type: "document",
            title: "Refund SOP",
            text: "Refund requests over 30 days route to the retention specialist.",
          },
          {
            clientSourceId: "website-hours",
            type: "website",
            title: "Support hours page",
            uri: "https://example.test/support-hours",
            text: "Delivery support is available from 8am to 8pm daily.",
          },
          {
            clientSourceId: "pdf-returns",
            type: "pdf",
            title: "Returns PDF",
            uri: "https://example.test/returns.pdf",
            contentType: "application/pdf",
            text: "Returns require an order number and delivery confirmation.",
          },
          {
            clientSourceId: "notion-vip",
            type: "notion",
            title: "VIP Notion playbook",
            externalId: "notion-page-vip",
            text: "VIP callers can be offered a same-day callback.",
          },
          {
            clientSourceId: "gdrive-installation",
            type: "google_drive",
            title: "Installation guide",
            externalId: "gdrive-file-installation",
            text: "Installation appointments require a site contact and access code.",
          },
          {
            clientSourceId: "crm-help-center",
            type: "crm_help_center",
            title: "CRM cancellation article",
            externalId: "zendesk-article-cancel",
            text: "Customers can cancel up to 24 hours before delivery.",
          },
          {
            clientSourceId: "bad-archive",
            type: "pdf",
            title: "Archive upload",
            contentType: "application/zip",
            text: "This ZIP should not be ingested as a PDF.",
          },
        ],
        now: "2026-05-19T12:00:00.000Z",
      });

    expect(ingestionResponse.status).toBe(201);
    expect(ingestionResponse.body.ingestion).toMatchObject({
      organizationId: "tenant-west-africa",
      status: "partial_failure",
      sourceCount: 7,
      succeededCount: 6,
      failedCount: 1,
    });
    expect(
      ingestionResponse.body.ingestion.sources.map(
        (source: { clientSourceId: string; status: string; failure?: { code: string; retryable: boolean } }) => ({
          clientSourceId: source.clientSourceId,
          status: source.status,
          failure: source.failure,
        }),
      ),
    ).toEqual([
      { clientSourceId: "docs-refunds", status: "succeeded", failure: undefined },
      { clientSourceId: "website-hours", status: "succeeded", failure: undefined },
      { clientSourceId: "pdf-returns", status: "succeeded", failure: undefined },
      { clientSourceId: "notion-vip", status: "succeeded", failure: undefined },
      { clientSourceId: "gdrive-installation", status: "succeeded", failure: undefined },
      { clientSourceId: "crm-help-center", status: "succeeded", failure: undefined },
      {
        clientSourceId: "bad-archive",
        status: "failed",
        failure: {
          code: "unsupported_content_type",
          message: "PDF knowledge sources must use application/pdf content.",
          retryable: true,
        },
      },
    ]);

    const statusResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/memory/knowledge/ingestions/${ingestionResponse.body.ingestion.id}`,
    );
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.ingestion.status).toBe("partial_failure");

    const retryResponse = await request(app.getHttpServer())
      .post(
        `/organizations/tenant-west-africa/memory/knowledge/ingestions/${ingestionResponse.body.ingestion.id}/retry`,
      )
      .send({
        actorUserId: "user-knowledge-admin",
        sources: [
          {
            clientSourceId: "bad-archive",
            type: "document",
            title: "Archive upload",
            text: "Escalate archive uploads to the operations team.",
          },
        ],
        now: "2026-05-19T12:05:00.000Z",
      });

    expect(retryResponse.status).toBe(201);
    expect(retryResponse.body.ingestion).toMatchObject({
      id: ingestionResponse.body.ingestion.id,
      status: "completed",
      sourceCount: 7,
      succeededCount: 7,
      failedCount: 0,
    });

    const knowledgeResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-receptionist-v7",
    );
    expect(knowledgeResponse.status).toBe(200);
    expect(
      knowledgeResponse.body.knowledge.map((knowledge: { title: string }) => knowledge.title),
    ).toEqual([
      "Archive upload",
      "CRM cancellation article",
      "Installation guide",
      "VIP Notion playbook",
      "Returns PDF",
      "Support hours page",
      "Refund SOP",
    ]);

    await app.close();
  }, 15_000);
});
