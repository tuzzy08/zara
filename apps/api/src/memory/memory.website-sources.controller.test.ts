import { afterEach, describe, expect, it, vi } from "vitest";import { Test } from "@nestjs/testing";import type { INestApplication } from "@nestjs/common";import request from "supertest";import { installTestTenantAuth } from "../testing/tenant-auth-request";import { InMemoryMemoryStateRepository, MEMORY_STATE_REPOSITORY } from "./memory-state.repository";import { MemoryModule } from "./memory.module";import { mockTextResponse } from "./memory.controller.test-support";

describe("MemoryController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("crawls website sources inside the allowed root while surfacing skipped and failed page statuses", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string) => {
        if (url === "https://docs.example.test/robots.txt") {
          return mockTextResponse(200, "User-agent: *\nDisallow: /help/blocked");
        }

        if (url === "https://docs.example.test/help") {
          return mockTextResponse(
            200,
            `
              <html>
                <head>
                  <title>Help center</title>
                  <link rel="canonical" href="https://docs.example.test/help" />
                </head>
                <body>
                  <main>
                    <h1>Help center</h1>
                    <p>Support answers are available every day.</p>
                    <a href="/help/pricing">Pricing</a>
                    <a href="/help/private">Private</a>
                    <a href="/help/blocked">Blocked</a>
                    <a href="/help/manual.pdf">Manual PDF</a>
                    <a href="https://external.example.test/help">External</a>
                    <a href="/help/login">Login</a>
                    <a href="/help/large">Large</a>
                    <a href="/help/alias">Alias</a>
                  </main>
                </body>
              </html>
            `,
            "text/html",
          );
        }

        if (url === "https://docs.example.test/help/pricing") {
          return mockTextResponse(
            200,
            `
              <html>
                <head><title>Pricing policy</title></head>
                <body><main>Pricing refunds over 30 days require manager approval.</main></body>
              </html>
            `,
            "text/html",
          );
        }

        if (url === "https://docs.example.test/help/manual.pdf") {
          return mockTextResponse(200, "%PDF-1.7", "application/pdf");
        }

        if (url === "https://docs.example.test/help/login") {
          return mockTextResponse(401, "<html><body>Sign in required</body></html>", "text/html");
        }

        if (url === "https://docs.example.test/help/large") {
          return mockTextResponse(200, `<html><body>${"x".repeat(250_001)}</body></html>`, "text/html");
        }

        if (url === "https://docs.example.test/help/alias") {
          return mockTextResponse(
            200,
            `
              <html>
                <head>
                  <title>Duplicate pricing alias</title>
                  <link rel="canonical" href="https://docs.example.test/help/pricing" />
                </head>
                <body><main>This duplicate page should not create another record.</main></body>
              </html>
            `,
            "text/html",
          );
        }

        throw new Error(`Unexpected fetch ${url}`);
      });
    vi.stubGlobal("fetch", fetchMock);

    const sourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "website_crawl",
        syncMode: "recurring",
        syncCadence: "daily",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        title: "Support website",
        uri: "https://docs.example.test/help",
        crawlLimit: 3,
        excludePaths: ["/help/private"],
        now: "2026-06-08T08:00:00.000Z",
      });

    expect(sourceResponse.status).toBe(201);
    expect(sourceResponse.body.source).toMatchObject({
      sourceType: "website_crawl",
      uri: "https://docs.example.test/help",
      status: "review_required",
      syncStatus: "review_required",
      extractedRecordCount: 2,
      crawl: {
        rootUrl: "https://docs.example.test/help",
        crawlLimit: 3,
        excludePaths: ["/help/private"],
      },
    });
    expect(
      sourceResponse.body.source.crawl.pages.map((page: { url: string; status: string; failureCode?: string }) => ({
        url: page.url,
        status: page.status,
        failureCode: page.failureCode,
      })),
    ).toEqual([
      { url: "https://docs.example.test/help", status: "succeeded", failureCode: undefined },
      { url: "https://docs.example.test/help/pricing", status: "succeeded", failureCode: undefined },
      { url: "https://docs.example.test/help/private", status: "skipped", failureCode: "excluded_path" },
      { url: "https://docs.example.test/help/blocked", status: "skipped", failureCode: "robots_disallowed" },
      { url: "https://docs.example.test/help/manual.pdf", status: "failed", failureCode: "binary_content" },
      { url: "https://external.example.test/help", status: "skipped", failureCode: "outside_allowed_root" },
      { url: "https://docs.example.test/help/login", status: "failed", failureCode: "auth_required" },
      { url: "https://docs.example.test/help/large", status: "failed", failureCode: "large_page" },
      { url: "https://docs.example.test/help/alias", status: "skipped", failureCode: "duplicate" },
    ]);
    expect(sourceResponse.body.reviewDrafts).toEqual([
      expect.objectContaining({
        title: "Help center",
        sourceUri: "https://docs.example.test/help",
        text: expect.stringContaining("Support answers are available every day."),
        status: "draft",
      }),
      expect.objectContaining({
        title: "Pricing policy",
        sourceUri: "https://docs.example.test/help/pricing",
        text: expect.stringContaining("Pricing refunds over 30 days"),
        suggestedKind: "pricing",
        status: "draft",
      }),
    ]);

    const runtimeKnowledgeResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?workspaceId=workspace-customer-success&workflowId=workflow-support",
    );
    expect(runtimeKnowledgeResponse.status).toBe(200);
    expect(runtimeKnowledgeResponse.body.knowledge).toEqual([]);
    fetchMock.mockClear();

    const secondRuntimeKnowledgeResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?workspaceId=workspace-customer-success&workflowId=workflow-support",
    );
    expect(secondRuntimeKnowledgeResponse.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();

    const crossTenantRefreshResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/memory/knowledge/sources/${sourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "east-user",
        trigger: "daily",
      });
    expect(crossTenantRefreshResponse.status).toBe(404);

    expect(JSON.stringify(sourceResponse.body)).not.toContain("%PDF-1.7");

    await app.close();
  }, 15_000);

  it("blocks website crawl roots on internal network destinations before fetch", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const fetchMock = vi.fn(async () => mockTextResponse(
      200,
      "<html><body><main>Internal content must not be fetched.</main></body></html>",
      "text/html",
    ));
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "website_crawl",
        syncMode: "snapshot",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        title: "Internal service",
        uri: "http://127.0.0.1/admin",
        now: "2026-06-08T08:30:00.000Z",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Outbound HTTP destination is not allowed.");
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  }, 15_000);

  it("blocks crawler drafts that contain credentials before runtime activation", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(mockTextResponse(404, ""))
        .mockResolvedValueOnce(
          mockTextResponse(
            200,
            "<html><head><title>Internal setup</title></head><body><main>Use api key: sk-live-secret-token to call setup.</main></body></html>",
            "text/html",
          ),
        ),
    );

    const sourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "website_crawl",
        syncMode: "recurring",
        syncCadence: "manual",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        title: "Internal setup website",
        uri: "https://docs.example.test/internal",
        now: "2026-06-08T09:00:00.000Z",
      });

    expect(sourceResponse.status).toBe(201);
    expect(sourceResponse.body.reviewDrafts[0]).toMatchObject({
      sourceUri: "https://docs.example.test/internal",
      sensitivityLabels: ["credentials_secrets"],
      activationBlockers: [
        {
          code: "credentials_or_secrets_detected",
          label: "credentials_secrets",
        },
      ],
    });

    const approvalResponse = await request(app.getHttpServer())
      .post(
        `/organizations/tenant-west-africa/memory/knowledge/review-drafts/${sourceResponse.body.reviewDrafts[0].id}/approve`,
      )
      .send({
        approverUserId: "user-knowledge-admin",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Attempt to approve internal setup crawl.",
        recordType: "general_reference",
      });
    expect(approvalResponse.status).toBe(400);
    expect(approvalResponse.body.message).toContain("credentials or secrets");

    const runtimeKnowledgeResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?workspaceId=workspace-customer-success&workflowId=workflow-support",
    );
    expect(runtimeKnowledgeResponse.body.knowledge).toEqual([]);

    await app.close();
  }, 15_000);

  it("manual refresh of a recurring source creates an update draft without changing active runtime knowledge", async () => {
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
        syncMode: "recurring",
        syncCadence: "daily",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        title: "Return window policy",
        uri: "https://example.test/policies/returns",
        text: "Policy: callers can return unopened items within 30 days.",
        now: "2026-06-06T08:00:00.000Z",
      });

    expect(sourceResponse.status).toBe(201);
    expect(sourceResponse.body.source).toMatchObject({
      syncMode: "recurring",
      syncCadence: "daily",
      syncStatus: "review_required",
      lastSyncedAt: "2026-06-06T08:00:00.000Z",
      nextSyncAt: "2026-06-07T08:00:00.000Z",
    });

    const initialDraftId = String(sourceResponse.body.reviewDrafts[0].id);
    const approvalResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${initialDraftId}/approve`)
      .send({
        approverUserId: "user-knowledge-admin",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved return-window policy source.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-06T08:05:00.000Z",
      });

    expect(approvalResponse.status).toBe(201);
    const approvedKnowledgeId = String(approvalResponse.body.knowledge.id);

    const refreshResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/sources/${sourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "user-knowledge-admin",
        trigger: "manual",
        text: "Policy: callers can return unopened items within 45 days.",
        now: "2026-06-07T08:00:00.000Z",
      });

    expect(refreshResponse.status).toBe(201);
    expect(refreshResponse.body).toMatchObject({
      source: {
        id: sourceResponse.body.source.id,
        status: "review_required",
        syncMode: "recurring",
        syncCadence: "daily",
        syncStatus: "review_required",
        lastSyncedAt: "2026-06-07T08:00:00.000Z",
        nextSyncAt: "2026-06-08T08:00:00.000Z",
      },
      knowledge: [],
      reviewDrafts: [
        {
          sourceSnapshotId: sourceResponse.body.source.id,
          changeType: "update",
          currentKnowledgeRecordId: approvedKnowledgeId,
          text: "Policy: callers can return unopened items within 45 days.",
          status: "draft",
        },
      ],
    });

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );

    expect(retrievedResponse.status).toBe(200);
    expect(retrievedResponse.body.knowledge).toEqual([
      expect.objectContaining({
        id: approvedKnowledgeId,
        text: "Policy: callers can return unopened items within 30 days.",
        status: "active",
      }),
    ]);

    const updateDraftId = String(refreshResponse.body.reviewDrafts[0].id);
    const updateApprovalResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${updateDraftId}/approve`)
      .send({
        approverUserId: "user-owner",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approved updated return window.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-07T08:05:00.000Z",
      });

    expect(updateApprovalResponse.status).toBe(201);
    expect(updateApprovalResponse.body.knowledge).toMatchObject({
      text: "Policy: callers can return unopened items within 45 days.",
      status: "active",
    });

    const activeCallSnapshotResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support&now=2026-06-06T08:10:00.000Z",
    );

    expect(activeCallSnapshotResponse.body.knowledge).toEqual([
      expect.objectContaining({
        id: approvedKnowledgeId,
        text: "Policy: callers can return unopened items within 30 days.",
        status: "stale",
      }),
    ]);

    const afterApprovalResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support&now=2026-06-07T08:06:00.000Z",
    );

    expect(afterApprovalResponse.body.knowledge).toEqual([
      expect.objectContaining({
        id: updateApprovalResponse.body.knowledge.id,
        text: "Policy: callers can return unopened items within 45 days.",
        status: "active",
      }),
    ]);

    await app.close();
  }, 15_000);

  it("refreshes recurring website crawls as review-gated added changed and removed page drafts", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTextResponse(404, ""))
      .mockResolvedValueOnce(
        mockTextResponse(
          200,
          `
            <html>
              <head><title>Docs home</title></head>
              <body>
                <main>Original support policy. <a href="/kb/pricing">Pricing</a></main>
              </body>
            </html>
          `,
          "text/html",
        ),
      )
      .mockResolvedValueOnce(
        mockTextResponse(
          200,
          "<html><head><title>Pricing</title></head><body><main>Original pricing policy.</main></body></html>",
          "text/html",
        ),
      )
      .mockResolvedValueOnce(mockTextResponse(404, ""))
      .mockResolvedValueOnce(
        mockTextResponse(
          200,
          `
            <html>
              <head><title>Docs home</title></head>
              <body>
                <main>Updated support policy. <a href="/kb/shipping">Shipping</a></main>
              </body>
            </html>
          `,
          "text/html",
        ),
      )
      .mockResolvedValueOnce(
        mockTextResponse(
          200,
          "<html><head><title>Shipping</title></head><body><main>New shipping procedure.</main></body></html>",
          "text/html",
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sourceResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "website_crawl",
        syncMode: "recurring",
        syncCadence: "daily",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        title: "Docs website",
        uri: "https://docs.example.test/kb",
        crawlLimit: 5,
        now: "2026-06-08T08:00:00.000Z",
      });

    expect(sourceResponse.status).toBe(201);
    const homeDraft = sourceResponse.body.reviewDrafts.find(
      (draft: { sourceUri?: string }) => draft.sourceUri === "https://docs.example.test/kb",
    );
    const pricingDraft = sourceResponse.body.reviewDrafts.find(
      (draft: { sourceUri?: string }) => draft.sourceUri === "https://docs.example.test/kb/pricing",
    );
    expect(homeDraft).toBeDefined();
    expect(pricingDraft).toBeDefined();

    await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${homeDraft.id}/approve`)
      .send({
        approverUserId: "user-knowledge-admin",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approve original homepage crawl.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-08T08:05:00.000Z",
      });
    await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${pricingDraft.id}/approve`)
      .send({
        approverUserId: "user-knowledge-admin",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Approve original pricing crawl.",
        recordType: "pricing",
        confirmHighRiskKind: true,
        now: "2026-06-08T08:06:00.000Z",
      });

    const refreshResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/sources/${sourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "user-knowledge-admin",
        trigger: "daily",
        now: "2026-06-09T08:00:00.000Z",
      });

    expect(refreshResponse.status).toBe(201);
    expect(
      refreshResponse.body.reviewDrafts.map(
        (draft: { changeType: string; sourceUri?: string; text: string }) => ({
          changeType: draft.changeType,
          sourceUri: draft.sourceUri,
          text: draft.text,
        }),
      ),
    ).toEqual([
      {
        changeType: "update",
        sourceUri: "https://docs.example.test/kb",
        text: "Docs home Updated support policy. Shipping",
      },
      {
        changeType: "new",
        sourceUri: "https://docs.example.test/kb/shipping",
        text: "Shipping New shipping procedure.",
      },
      {
        changeType: "deletion",
        sourceUri: "https://docs.example.test/kb/pricing",
        text: "Pricing Original pricing policy.",
      },
    ]);

    const runtimeKnowledgeResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?workspaceId=workspace-customer-success&workflowId=workflow-support",
    );
    expect(
      runtimeKnowledgeResponse.body.knowledge.map((record: { text: string }) => record.text),
    ).toEqual(["Pricing Original pricing policy.", "Docs home Original support policy. Pricing"]);

    await app.close();
  }, 15_000);

  it("confirmed recurring source deletions create deletion drafts while approved knowledge remains active", async () => {
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
        syncMode: "recurring",
        syncCadence: "daily",
        workspaceId: "workspace-customer-success",
        workflowIds: ["workflow-support"],
        publishedWorkflowVersionIds: ["published-support-v2"],
        title: "Holiday hours",
        uri: "https://example.test/policies/holiday-hours",
        text: "Policy: holiday support closes at 2pm local time.",
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
        reason: "Approved holiday-hours policy source.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-06T08:05:00.000Z",
      });
    const approvedKnowledgeId = String(approvalResponse.body.knowledge.id);

    const deletionResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/sources/${sourceResponse.body.source.id}/refresh`)
      .send({
        actorUserId: "user-knowledge-admin",
        trigger: "daily",
        sourceDeleted: true,
        deletionConfirmed: true,
        now: "2026-06-07T08:00:00.000Z",
      });

    expect(deletionResponse.status).toBe(201);
    expect(deletionResponse.body).toMatchObject({
      source: {
        id: sourceResponse.body.source.id,
        status: "review_required",
        syncStatus: "review_required",
        extractedRecordCount: 0,
        lastSyncedAt: "2026-06-07T08:00:00.000Z",
        nextSyncAt: "2026-06-08T08:00:00.000Z",
      },
      knowledge: [],
      reviewDrafts: [
        {
          sourceSnapshotId: sourceResponse.body.source.id,
          changeType: "deletion",
          currentKnowledgeRecordId: approvedKnowledgeId,
          text: "Policy: holiday support closes at 2pm local time.",
          status: "draft",
        },
      ],
    });

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );

    expect(retrievedResponse.body.knowledge).toEqual([
      expect.objectContaining({
        id: approvedKnowledgeId,
        text: "Policy: holiday support closes at 2pm local time.",
        status: "active",
      }),
    ]);

    const deletionDraftId = String(deletionResponse.body.reviewDrafts[0].id);
    const deletionApprovalResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/knowledge/review-drafts/${deletionDraftId}/approve`)
      .send({
        approverUserId: "user-owner",
        approverRole: "owner",
        workspaceId: "workspace-customer-success",
        reason: "Confirmed source article was removed.",
        recordType: "policy",
        confirmHighRiskKind: true,
        now: "2026-06-07T08:05:00.000Z",
      });

    expect(deletionApprovalResponse.status).toBe(201);
    expect(deletionApprovalResponse.body.knowledge).toMatchObject({
      id: approvedKnowledgeId,
      status: "stale",
      staleAt: "2026-06-07T08:05:00.000Z",
    });

    const afterDeletionApprovalResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-customer-success&workflowId=workflow-support",
    );

    expect(afterDeletionApprovalResponse.body.knowledge).toEqual([]);

    await app.close();
  }, 15_000);
});
