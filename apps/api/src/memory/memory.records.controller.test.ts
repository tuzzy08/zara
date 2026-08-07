import { afterEach, describe, expect, it, vi } from "vitest";import { Test } from "@nestjs/testing";import type { INestApplication } from "@nestjs/common";import request from "supertest";import { installTestTenantAuth } from "../testing/tenant-auth-request";import { InMemoryMemoryStateRepository, MEMORY_STATE_REPOSITORY } from "./memory-state.repository";import { MemoryModule } from "./memory.module";
describe("MemoryController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires tenant membership for tenant memory routes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller prefers WhatsApp follow-up after billing calls.",
        optIn: true,
        source: {
          kind: "call_summary",
          callSessionId: "call-001",
        },
      });

    expect(response.status).toBe(401);

    await app.close();
  }, 15_000);

  it("requires opt-in and retrieves caller/account memory only for the matching tenant and caller identity", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const rejectedResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller prefers WhatsApp follow-up after billing calls.",
        optIn: false,
        source: {
          kind: "call_summary",
          callSessionId: "call-001",
        },
      });

    expect(rejectedResponse.status).toBe(403);
    expect(rejectedResponse.body.message).toContain("opt-in");

    const callerMemoryResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller prefers WhatsApp follow-up after billing calls.",
        optIn: true,
        source: {
          kind: "call_summary",
          callSessionId: "call-001",
        },
        confidence: 0.82,
        now: "2026-05-17T12:00:00.000Z",
      });

    expect(callerMemoryResponse.status).toBe(201);
    expect(callerMemoryResponse.body.memory).toMatchObject({
      organizationId: "tenant-west-africa",
      scope: "caller",
      callerIdentity: {
        kind: "phone",
        value: "+2348011112222",
      },
      text: "Caller prefers WhatsApp follow-up after billing calls.",
      approvalState: "approved",
      status: "active",
    });

    const accountMemoryResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "account",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        accountId: "acct-lagos-77",
        text: "Account has an open invoice dispute for Lagos workspace renewals.",
        optIn: true,
        source: {
          kind: "call_summary",
          callSessionId: "call-001",
        },
        now: "2026-05-17T12:01:00.000Z",
      });

    expect(accountMemoryResponse.status).toBe(201);
    expect(accountMemoryResponse.body.memory).toMatchObject({
      organizationId: "tenant-west-africa",
      scope: "account",
      accountId: "acct-lagos-77",
      callerIdentity: {
        kind: "phone",
        value: "+2348011112222",
      },
    });

    await request(app.getHttpServer())
      .post("/organizations/tenant-east-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "East Africa tenant memory must not leak across tenants.",
        optIn: true,
        source: {
          kind: "call_summary",
          callSessionId: "call-002",
        },
      });

    const matchingResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory?callerKind=phone&callerValue=%2B2348011112222&accountId=acct-lagos-77",
    );

    expect(matchingResponse.status).toBe(200);
    expect(matchingResponse.body.memories).toHaveLength(2);
    expect(matchingResponse.body.memories.map((memory: { text: string }) => memory.text)).toEqual([
      "Account has an open invoice dispute for Lagos workspace renewals.",
      "Caller prefers WhatsApp follow-up after billing calls.",
    ]);

    const wrongCallerResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory?callerKind=phone&callerValue=%2B2348099990000&accountId=acct-lagos-77",
    );

    expect(wrongCallerResponse.status).toBe(200);
    expect(wrongCallerResponse.body.memories).toEqual([]);

    const otherTenantResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-east-africa/memory?callerKind=phone&callerValue=%2B2348011112222",
    );

    expect(otherTenantResponse.status).toBe(200);
    expect(otherTenantResponse.body.memories).toHaveLength(1);
    expect(otherTenantResponse.body.memories[0].organizationId).toBe("tenant-east-africa");

    await app.close();
  }, 15_000);

  it("requires approval before durable memory write and keeps approval audit history", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const draftResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-extractor",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller wants delivery updates by WhatsApp.",
        optIn: true,
        approvalRequired: true,
        source: {
          kind: "call_summary",
          callSessionId: "call-approval-001",
          transcriptId: "transcript-approval-001",
          transcriptEventIds: ["turn-001"],
        },
        confidence: 0.78,
        now: "2026-05-19T10:00:00.000Z",
      });

    expect(draftResponse.status).toBe(201);
    expect(draftResponse.body.draft).toMatchObject({
      organizationId: "tenant-west-africa",
      approvalState: "pending",
      status: "draft",
      text: "Caller wants delivery updates by WhatsApp.",
      createdBy: "user-ops-lead",
      auditTrail: [
        {
          action: "draft_created",
          actorUserId: "user-ops-lead",
          at: "2026-05-19T10:00:00.000Z",
        },
      ],
    });

    const beforeApprovalResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory?callerKind=phone&callerValue=%2B2348011112222",
    );
    expect(beforeApprovalResponse.body.memories).toEqual([]);

    const approveResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/memory/drafts/${draftResponse.body.draft.id}/approve`)
      .send({
        approverUserId: "user-memory-approver",
        text: "Caller prefers WhatsApp delivery updates.",
        now: "2026-05-19T10:03:00.000Z",
      });

    expect(approveResponse.status).toBe(201);
    expect(approveResponse.body.memory).toMatchObject({
      organizationId: "tenant-west-africa",
      approvalState: "approved",
      status: "active",
      text: "Caller prefers WhatsApp delivery updates.",
      source: {
        kind: "call_summary",
        callSessionId: "call-approval-001",
        transcriptId: "transcript-approval-001",
        transcriptEventIds: ["turn-001"],
      },
    });
    expect(approveResponse.body.draft).toMatchObject({
      approvalState: "approved",
      status: "approved",
      approvedMemoryId: approveResponse.body.memory.id,
      auditTrail: [
        {
          action: "draft_created",
          actorUserId: "user-ops-lead",
          at: "2026-05-19T10:00:00.000Z",
        },
        {
          action: "approved",
          actorUserId: "user-ops-lead",
          at: "2026-05-19T10:03:00.000Z",
        },
      ],
    });

    const afterApprovalResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory?callerKind=phone&callerValue=%2B2348011112222",
    );
    expect(afterApprovalResponse.body.memories.map((memory: { text: string }) => memory.text)).toEqual([
      "Caller prefers WhatsApp delivery updates.",
    ]);

    const rejectedDraftResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-extractor",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller might want email updates.",
        optIn: true,
        approvalRequired: true,
        source: {
          kind: "call_summary",
          callSessionId: "call-approval-002",
        },
        now: "2026-05-19T10:04:00.000Z",
      });

    const rejectResponse = await request(app.getHttpServer())
      .post(
        `/organizations/tenant-west-africa/memory/drafts/${rejectedDraftResponse.body.draft.id}/reject`,
      )
      .send({
        approverUserId: "user-memory-approver",
        reason: "Caller did not explicitly request this.",
        now: "2026-05-19T10:05:00.000Z",
      });

    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body.draft).toMatchObject({
      approvalState: "rejected",
      status: "rejected",
      rejectionReason: "Caller did not explicitly request this.",
      auditTrail: [
        expect.objectContaining({ action: "draft_created" }),
        {
          action: "rejected",
          actorUserId: "user-ops-lead",
          at: "2026-05-19T10:05:00.000Z",
        },
      ],
    });

    await app.close();
  }, 15_000);

  it("does not allow cross-tenant memory draft or ingestion ID access", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const draftResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-extractor",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller prefers WhatsApp delivery updates.",
        optIn: true,
        approvalRequired: true,
        source: {
          kind: "call_summary",
          callSessionId: "call-isolation-001",
        },
      });
    const draftId = String(draftResponse.body.draft.id);

    const ingestionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/ingestions")
      .send({
        actorUserId: "user-knowledge-admin",
        publishedWorkflowVersionIds: ["published-receptionist-v7"],
        sources: [
          {
            clientSourceId: "west-policy",
            type: "document",
            title: "West tenant policy",
            text: "West tenant knowledge must not leak.",
          },
        ],
      });
    const ingestionId = String(ingestionResponse.body.ingestion.id);

    const crossTenantApproveResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/memory/drafts/${draftId}/approve`)
      .send({
        approverUserId: "user-memory-approver",
      });
    const crossTenantRejectResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/memory/drafts/${draftId}/reject`)
      .send({
        approverUserId: "user-memory-approver",
      });
    const crossTenantIngestionResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-east-africa/memory/knowledge/ingestions/${ingestionId}`,
    );
    const crossTenantRetryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/memory/knowledge/ingestions/${ingestionId}/retry`)
      .send({
        actorUserId: "user-knowledge-admin",
      });
    const eastExportResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-east-africa/memory/export",
    );

    expect(crossTenantApproveResponse.status).toBe(400);
    expect(crossTenantRejectResponse.status).toBe(400);
    expect(crossTenantIngestionResponse.status).toBe(404);
    expect(crossTenantRetryResponse.status).toBe(404);
    expect(eastExportResponse.status).toBe(200);
    expect(eastExportResponse.body.export.drafts).toEqual([]);
    expect(eastExportResponse.body.export.ingestions).toEqual([]);
    expect(JSON.stringify(eastExportResponse.body)).not.toContain("West tenant");

    await app.close();
  }, 15_000);

  it("retrieves top-k embedded memories with scope and confidence filters", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const baseMemoryRequest = {
      actorUserId: "user-ops-lead",
      callerIdentity: {
        kind: "phone",
        value: "+2348011112222",
      },
      optIn: true,
      source: {
        kind: "manual",
        externalId: "retrieval-fixture",
      },
      now: "2026-05-19T08:00:00.000Z",
    };

    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        ...baseMemoryRequest,
        scope: "caller",
        text: "Caller wants urgent refund support for damaged deliveries.",
        confidence: 0.92,
        embedding: [1, 0, 0],
      });
    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        ...baseMemoryRequest,
        scope: "caller",
        text: "Caller prefers WhatsApp reminders about delivery windows.",
        confidence: 0.88,
        embedding: [0.7, 0.3, 0],
      });
    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        ...baseMemoryRequest,
        scope: "caller",
        text: "Low-confidence guess about damaged parcel refunds should be excluded.",
        confidence: 0.3,
        embedding: [1, 0, 0],
      });
    await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        ...baseMemoryRequest,
        scope: "account",
        accountId: "acct-lagos-77",
        text: "Account refund policy should not appear in caller-only retrieval.",
        confidence: 0.98,
        embedding: [1, 0, 0],
      });
    await request(app.getHttpServer())
      .post("/organizations/tenant-east-africa/memory")
      .send({
        ...baseMemoryRequest,
        scope: "caller",
        text: "Other tenant memory must not appear in retrieval.",
        confidence: 0.99,
        embedding: [1, 0, 0],
      });

    const retrievalResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/retrieve")
      .send({
        queryEmbedding: [1, 0, 0],
        topK: 2,
        scope: "caller",
        minConfidence: 0.8,
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
      });

    expect(retrievalResponse.status).toBe(200);
    expect(retrievalResponse.body.matches).toHaveLength(2);
    expect(
      retrievalResponse.body.matches.map((match: { memory: { text: string } }) => match.memory.text),
    ).toEqual([
      "Caller wants urgent refund support for damaged deliveries.",
      "Caller prefers WhatsApp reminders about delivery windows.",
    ]);
    expect(retrievalResponse.body.matches[0]).toMatchObject({
      scope: "caller",
      confidence: 0.92,
      similarityScore: 1,
    });
    expect(retrievalResponse.body.matches[0].embedding).toBeUndefined();

    await app.close();
  }, 15_000);

  it("lets tenant users edit, disable, and delete memory with audit history while removing deleted embeddings", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const createdResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory")
      .send({
        actorUserId: "user-ops-lead",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller prefers SMS delivery updates.",
        optIn: true,
        source: {
          kind: "manual",
          externalId: "operator-note-052",
        },
        confidence: 0.7,
        embedding: [1, 0, 0],
        now: "2026-05-19T11:00:00.000Z",
      });

    const memoryId = createdResponse.body.memory.id;

    const editResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/memory/${memoryId}`)
      .send({
        actorUserId: "user-memory-editor",
        text: "Caller prefers WhatsApp delivery updates after 6pm.",
        confidence: 0.91,
        now: "2026-05-19T11:03:00.000Z",
      });

    expect(editResponse.status).toBe(200);
    expect(editResponse.body.memory).toMatchObject({
      id: memoryId,
      organizationId: "tenant-west-africa",
      text: "Caller prefers WhatsApp delivery updates after 6pm.",
      confidence: 0.91,
      status: "active",
      updatedAt: "2026-05-19T11:03:00.000Z",
      auditTrail: [
        {
          action: "memory_created",
          actorUserId: "user-ops-lead",
          at: "2026-05-19T11:00:00.000Z",
        },
        {
          action: "memory_edited",
          actorUserId: "user-ops-lead",
          at: "2026-05-19T11:03:00.000Z",
        },
      ],
    });

    const disableResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-west-africa/memory/${memoryId}`)
      .send({
        actorUserId: "user-memory-editor",
        status: "disabled",
        now: "2026-05-19T11:04:00.000Z",
      });

    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body.memory).toMatchObject({
      id: memoryId,
      status: "disabled",
      auditTrail: [
        expect.objectContaining({ action: "memory_created" }),
        expect.objectContaining({ action: "memory_edited" }),
        {
          action: "memory_disabled",
          actorUserId: "user-ops-lead",
          at: "2026-05-19T11:04:00.000Z",
        },
      ],
    });

    const wrongTenantResponse = await request(app.getHttpServer())
      .patch(`/organizations/tenant-east-africa/memory/${memoryId}`)
      .send({
        actorUserId: "user-memory-editor",
        text: "Cross-tenant edits must not work.",
      });

    expect(wrongTenantResponse.status).toBe(404);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/organizations/tenant-west-africa/memory/${memoryId}`)
      .send({
        actorUserId: "user-memory-editor",
        now: "2026-05-19T11:05:00.000Z",
      });

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.memory).toMatchObject({
      id: memoryId,
      status: "deleted",
      auditTrail: [
        expect.objectContaining({ action: "memory_created" }),
        expect.objectContaining({ action: "memory_edited" }),
        expect.objectContaining({ action: "memory_disabled" }),
        {
          action: "memory_deleted",
          actorUserId: "user-ops-lead",
          at: "2026-05-19T11:05:00.000Z",
        },
      ],
    });

    const listedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory?callerKind=phone&callerValue=%2B2348011112222",
    );
    expect(listedResponse.body.memories).toEqual([]);

    const retrievalResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/retrieve")
      .send({
        queryEmbedding: [1, 0, 0],
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
      });

    expect(retrievalResponse.status).toBe(200);
    expect(retrievalResponse.body.matches).toEqual([]);

    await app.close();
  }, 15_000);

  it("drafts useful post-call memory facts with transcript links while filtering sensitive content", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const extractionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/extract")
      .send({
        actorUserId: "user-ops-lead",
        callSessionId: "call-session-050",
        transcriptId: "transcript-050",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        accountId: "acct-lagos-77",
        optIn: true,
        transcript: [
          {
            id: "turn-001",
            speaker: "caller",
            text: "Please remember I prefer WhatsApp updates for delivery windows.",
            at: "2026-05-19T09:00:00.000Z",
          },
          {
            id: "turn-002",
            speaker: "caller",
            text: "For the account, renewal is blocked by an invoice dispute.",
            at: "2026-05-19T09:00:08.000Z",
          },
          {
            id: "turn-003",
            speaker: "caller",
            text: "My card number is 4242 4242 4242 4242 and the password is island-123.",
            at: "2026-05-19T09:00:15.000Z",
          },
          {
            id: "turn-004",
            speaker: "agent",
            text: "You might prefer email updates instead.",
            at: "2026-05-19T09:00:20.000Z",
          },
        ],
        now: "2026-05-19T09:05:00.000Z",
      });

    expect(extractionResponse.status).toBe(201);
    expect(extractionResponse.body.drafts).toHaveLength(2);
    expect(extractionResponse.body.drafts).toEqual([
      expect.objectContaining({
        organizationId: "tenant-west-africa",
        scope: "account",
        accountId: "acct-lagos-77",
        text: "For the account, renewal is blocked by an invoice dispute.",
        approvalState: "pending",
        status: "draft",
        confidence: 0.74,
        source: {
          kind: "call_summary",
          callSessionId: "call-session-050",
          transcriptId: "transcript-050",
          transcriptEventIds: ["turn-002"],
        },
      }),
      expect.objectContaining({
        organizationId: "tenant-west-africa",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Please remember I prefer WhatsApp updates for delivery windows.",
        approvalState: "pending",
        status: "draft",
        confidence: 0.82,
        source: {
          kind: "call_summary",
          callSessionId: "call-session-050",
          transcriptId: "transcript-050",
          transcriptEventIds: ["turn-001"],
        },
      }),
    ]);
    expect(extractionResponse.body.filtered).toEqual([
      {
        transcriptEventId: "turn-003",
        reason: "sensitive_data",
      },
      {
        transcriptEventId: "turn-004",
        reason: "not_caller_asserted",
      },
    ]);

    const persistedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory?callerKind=phone&callerValue=%2B2348011112222&accountId=acct-lagos-77",
    );
    expect(persistedResponse.body.memories).toEqual([]);

    await app.close();
  }, 15_000);

  it("requires opt-in before drafting post-call memory", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const extractionResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/extract")
      .send({
        actorUserId: "user-ops-lead",
        callSessionId: "call-session-051",
        transcriptId: "transcript-051",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        optIn: false,
        transcript: [
          {
            id: "turn-001",
            speaker: "caller",
            text: "Please remember I prefer WhatsApp updates.",
          },
        ],
      });

    expect(extractionResponse.status).toBe(403);
    expect(extractionResponse.body.message).toContain("opt-in");

    await app.close();
  }, 15_000);
});
