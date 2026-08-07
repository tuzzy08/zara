import { afterEach, describe, expect, it, vi } from "vitest";import { Test } from "@nestjs/testing";import type { INestApplication } from "@nestjs/common";import request from "supertest";import { installTestTenantAuth } from "../testing/tenant-auth-request";import { InMemoryMemoryStateRepository, MEMORY_STATE_REPOSITORY } from "./memory-state.repository";import { MemoryModule } from "./memory.module";import { INTEGRATION_STATE_REPOSITORY } from "../integrations/integrations-state.repository";import { createMutableIntegrationRepository, connectKnowledgeSourceProvider, configureFreshdeskKnowledgeSourceProvider, mockJsonResponse, mockTextResponse } from "./memory.controller.test-support";

describe("MemoryController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("imports Intercom Articles through review-gated knowledge-source grants and daily refreshes", async () => {
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

    const connectResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/intercom/connect")
      .send({
        actorUserId: "user-integrations-admin",
        actorRole: "admin",
        redirectUri: "http://127.0.0.1:4173/integrations/intercom/callback",
        requestedScopes: ["read_articles"],
        connectionScope: "workspace",
        workspaceId: "workspace-customer-success",
        now: "2026-06-06T08:00:00.000Z",
      });
    const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");
    const callbackResponse = await request(app.getHttpServer())
      .get("/integrations/oauth/intercom/callback")
      .query({
        code: "intercom-oauth-code-articles",
        state,
        now: "2026-06-06T08:01:00.000Z",
      });
    const connectionId = callbackResponse.body.connection.id as string;

    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-integrations-admin",
        actorRole: "admin",
        capability: "knowledge-source",
        workspaceId: "workspace-customer-success",
        toolId: "intercom.articles.import",
        integrationConnectionId: connectionId,
        risk: "low",
        approvalRequired: false,
        now: "2026-06-06T08:02:00.000Z",
      });

    expect(grantResponse.status).toBe(201);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: "article-refunds",
          title: "Refund policy",
          body: "<p>Refund requests over 30 days route to retention.</p>",
          url: "https://app.intercom.com/a/articles/article-refunds",
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: "article-refunds",
          title: "Refund policy",
          body: "<p>Refund requests over 45 days require a manager review.</p>",
          url: "https://app.intercom.com/a/articles/article-refunds",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

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
        providerId: "intercom",
        integrationConnectionId: connectionId,
        externalId: "article-refunds",
        title: "Intercom refund policy",
        now: "2026-06-06T08:05:00.000Z",
      });

    expect(sourceResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.intercom.io/articles/article-refunds",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer intercom:access:intercom-oauth-code-articles",
          accept: "application/json",
          "Intercom-Version": "2.11",
        }),
      }),
    );
    expect(sourceResponse.body.source).toMatchObject({
      sourceType: "provider_import",
      providerId: "intercom",
      integrationConnectionId: connectionId,
      externalId: "article-refunds",
      status: "review_required",
      syncStatus: "review_required",
      textPreview: "Refund requests over 30 days route to retention.",
    });
    expect(sourceResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        sourceSnapshotId: sourceResponse.body.source.id,
        text: "Refund requests over 30 days route to retention.",
        status: "draft",
      }),
    ]);

    const approvalResponse = await request(app.getHttpServer())
      .post(
        `/organizations/tenant-west-africa/memory/knowledge/review-drafts/${sourceResponse.body.reviewDrafts[0].id}/approve`,
      )
      .send({
        approverUserId: "user-knowledge-admin",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved Intercom refund policy source.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-06T08:10:00.000Z",
      });
    expect(approvalResponse.status).toBe(201);

    const refreshResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/sources/${sourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "user-knowledge-admin",
        trigger: "daily",
        now: "2026-06-07T08:00:00.000Z",
      });

    expect(refreshResponse.status).toBe(201);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.intercom.io/articles/article-refunds",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer intercom:access:intercom-oauth-code-articles",
          accept: "application/json",
          "Intercom-Version": "2.11",
        }),
      }),
    );
    expect(refreshResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        changeType: "update",
        text: "Refund requests over 45 days require a manager review.",
        status: "draft",
      }),
    ]);
    expect(JSON.stringify(refreshResponse.body)).not.toContain("intercom-oauth-code-articles");

    await app.close();
  }, 15_000);

  it("imports Confluence and SharePoint knowledge sources as review-gated drafts without runtime activation", async () => {
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
      .mockResolvedValueOnce(mockTextResponse(200, "Procedure: confirm site contact before installation."));
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

    expect(confluenceSourceResponse.status).toBe(201);
    expect(confluenceSourceResponse.body.source).toMatchObject({
      sourceType: "provider_import",
      providerId: "confluence",
      integrationConnectionId: confluenceConnectionId,
      externalId: "page:page-refunds",
      status: "review_required",
      syncStatus: "review_required",
      extractedRecordCount: 1,
      textPreview: "Refunds over 45 days need manager approval.",
    });
    expect(confluenceSourceResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        sourceSnapshotId: confluenceSourceResponse.body.source.id,
        title: "Refund policy",
        text: "Refunds over 45 days need manager approval.",
        sourceUri: "https://confluence.atlassian.com/wiki/spaces/SUP/pages/page-refunds/Refund+policy",
        status: "draft",
      }),
    ]);

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

    expect(sharepointSourceResponse.status).toBe(201);
    expect(sharepointSourceResponse.body.source).toMatchObject({
      sourceType: "provider_import",
      providerId: "sharepoint",
      integrationConnectionId: sharepointConnectionId,
      externalId: "site:contoso-support:drive:documents:item:folder-support",
      status: "review_required",
      syncStatus: "review_required",
      extractedRecordCount: 1,
      textPreview: "Procedure: confirm site contact before installation.",
    });
    expect(sharepointSourceResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        sourceSnapshotId: sharepointSourceResponse.body.source.id,
        title: "Installation procedure.txt",
        text: "Procedure: confirm site contact before installation.",
        sourceUri: "https://contoso.sharepoint.com/sites/support/Shared%20Documents/Installation%20procedure.txt",
        status: "draft",
      }),
    ]);

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );
    expect(retrievedResponse.body.knowledge).toEqual([]);
    expect(JSON.stringify(confluenceSourceResponse.body)).not.toContain("confluence-oauth-code-knowledge");
    expect(JSON.stringify(sharepointSourceResponse.body)).not.toContain("sharepoint-oauth-code-knowledge");

    await app.close();
  }, 15_000);

  it("imports Freshdesk Solutions and Salesforce Knowledge sources as review-gated drafts without runtime activation", async () => {
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
          {
            id: 102,
            title: "Draft escalation",
            description_text: "Do not ingest drafts.",
            status: 1,
          },
        ]),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          records: [
            {
              Id: "ka0ReturnPolicy",
              KnowledgeArticleId: "kA0ReturnPolicy",
              Title: "Returns policy",
              Summary: "Return requests after 45 days require a manager review.",
              UrlName: "returns-policy",
              PublishStatus: "Online",
              IsLatestVersion: true,
            },
          ],
        }),
      );
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
        now: "2026-06-08T09:00:00.000Z",
      });

    expect(freshdeskSourceResponse.status).toBe(201);
    expect(freshdeskSourceResponse.body.source).toMatchObject({
      sourceType: "provider_import",
      providerId: "freshdesk",
      integrationConnectionId: freshdeskConnectionId,
      externalId: "folder:42",
      status: "review_required",
      syncStatus: "review_required",
      extractedRecordCount: 1,
      textPreview: "Refunds over 45 days need manager approval.",
    });
    expect(freshdeskSourceResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        sourceSnapshotId: freshdeskSourceResponse.body.source.id,
        title: "Refund policy",
        text: "Refunds over 45 days need manager approval.",
        sourceUri: "https://tuzzy-support.freshdesk.com/a/solutions/articles/101",
        status: "draft",
      }),
    ]);

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
        now: "2026-06-08T09:05:00.000Z",
      });

    expect(salesforceKnowledgeSourceResponse.status).toBe(201);
    expect(salesforceKnowledgeSourceResponse.body.source).toMatchObject({
      sourceType: "provider_import",
      providerId: "salesforce-knowledge",
      integrationConnectionId: salesforceKnowledgeConnectionId,
      externalId: "article:ka0ReturnPolicy",
      status: "review_required",
      syncStatus: "review_required",
      extractedRecordCount: 1,
      textPreview: "Return requests after 45 days require a manager review.",
    });
    expect(salesforceKnowledgeSourceResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        sourceSnapshotId: salesforceKnowledgeSourceResponse.body.source.id,
        title: "Returns policy",
        text: "Return requests after 45 days require a manager review.",
        sourceUri: "https://salesforce-knowledge.local-account.my.salesforce.com/lightning/r/Knowledge__kav/ka0ReturnPolicy/view",
        status: "draft",
      }),
    ]);

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );
    expect(retrievedResponse.body.knowledge).toEqual([]);
    expect(JSON.stringify(freshdeskSourceResponse.body)).not.toContain("freshdesk-api-token-123456");
    expect(JSON.stringify(salesforceKnowledgeSourceResponse.body)).not.toContain("salesforce-knowledge-oauth-code-knowledge");

    await app.close();
  }, 15_000);
});
