import { afterEach, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { installTestTenantAuth, withTestTenantAuth } from "../testing/tenant-auth-request";
import {
  InMemoryMemoryStateRepository,
  MEMORY_STATE_REPOSITORY,
} from "./memory-state.repository";
import { MemoryModule } from "./memory.module";
import {
  INTEGRATION_STATE_REPOSITORY,
  type IntegrationStateRepository,
  type PersistedIntegrationStateRecord,
} from "../integrations/integrations-state.repository";

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
      workflowIds: ["workflow-support"],
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
        workflowId: "workflow-support",
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

function createProviderImportIntegrationRepository(input: {
  connectionId: string;
  granted: boolean;
}): IntegrationStateRepository {
  const state: PersistedIntegrationStateRecord = {
    schemaVersion: 1,
    organizationId: "tenant-west-africa",
    pendingConnects: [],
    credentials: [],
    connections: [
      {
        id: input.connectionId,
        organizationId: "tenant-west-africa",
        provider: "notion",
        status: "connected",
        connectedBy: "user-integrations-admin",
        scopes: ["search:read"],
        availability: {
          scope: "workspace",
          workspaceId: "workspace-customer-success",
        },
        credentialReference: {
          id: "credential_notion_support",
          provider: "notion",
          kind: "oauth-token",
          preview: "...notion",
        },
        accountLabel: "Support Notion",
        connectedAt: "2026-06-05T10:00:00.000Z",
        health: {
          status: "healthy",
          checkedAt: "2026-06-05T10:00:00.000Z",
        },
        auditEvents: [],
      },
    ],
    toolGrants: input.granted
      ? [
          {
            id: "tool_grant_notion_knowledge",
            organizationId: "tenant-west-africa",
            capability: "knowledge-source",
            workspaceId: "workspace-customer-success",
            workflowId: "workflow-support",
            toolId: "notion.knowledge.search",
            integrationConnectionId: input.connectionId,
            risk: "low",
            requiredScopes: ["search:read"],
            approvalRequired: false,
            status: "active",
            grantedBy: "user-integrations-admin",
            createdAt: "2026-06-05T10:05:00.000Z",
          },
        ]
      : [],
  };

  return {
    listOrganizationIds: () => [state.organizationId],
    load: (organizationId: string) => organizationId === state.organizationId ? state : null,
    save: (record: PersistedIntegrationStateRecord) => {
      Object.assign(state, record);
    },
  };
}

function createMutableIntegrationRepository(): IntegrationStateRepository {
  let state: PersistedIntegrationStateRecord | null = null;

  return {
    listOrganizationIds: () => (state === null ? [] : [state.organizationId]),
    load: (organizationId: string) =>
      state !== null && state.organizationId === organizationId ? state : null,
    save: (record: PersistedIntegrationStateRecord) => {
      state = {
        ...record,
        pendingConnects: [...record.pendingConnects],
        connections: record.connections.map((connection) => ({
          ...connection,
          scopes: [...connection.scopes],
          credentialReference: { ...connection.credentialReference },
          auditEvents: connection.auditEvents.map((event) => ({ ...event })),
        })),
        credentials: record.credentials.map((credential) => ({ ...credential })),
        toolGrants: record.toolGrants?.map((grant) => ({
          ...grant,
          requiredScopes: [...grant.requiredScopes],
        })),
        webhookTools: record.webhookTools?.map((tool) => ({ ...tool })),
        webhookToolSecrets: record.webhookToolSecrets?.map((secret) => ({ ...secret })),
      };
    },
  };
}

async function connectKnowledgeSourceProvider(
  app: INestApplication,
  input: {
    provider: "confluence" | "sharepoint" | "salesforce-knowledge";
    requestedScopes: string[];
    toolId: string;
  },
) {
  const connectResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/integrations/${input.provider}/connect`)
    .send({
      actorUserId: "user-integrations-admin",
      actorRole: "admin",
      redirectUri: `http://127.0.0.1:4173/integrations/${input.provider}/callback`,
      requestedScopes: input.requestedScopes,
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-08T07:55:00.000Z",
    });
  expect(connectResponse.status).toBe(201);

  const state = new URL(connectResponse.body.connect.authorizationUrl).searchParams.get("state");
  const callbackResponse = await request(app.getHttpServer())
    .get(`/integrations/oauth/${input.provider}/callback`)
    .query({
      code: `${input.provider}-oauth-code-knowledge`,
      state,
      now: "2026-06-08T07:56:00.000Z",
    });
  expect(callbackResponse.status).toBe(200);
  const connectionId = callbackResponse.body.connection.id as string;

  const grantResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/integrations/tool-grants")
    .send({
      actorUserId: "user-integrations-admin",
      actorRole: "admin",
      capability: "knowledge-source",
      workspaceId: "workspace-customer-success",
      workflowId: "workflow-support",
      toolId: input.toolId,
      integrationConnectionId: connectionId,
      risk: "low",
      approvalRequired: false,
      now: "2026-06-08T07:57:00.000Z",
    });
  expect(grantResponse.status).toBe(201);

  return connectionId;
}

async function configureFreshdeskKnowledgeSourceProvider(app: INestApplication) {
  const configureResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/integrations/freshdesk/configure")
    .send({
      actorUserId: "user-integrations-admin",
      actorRole: "admin",
      subdomain: "tuzzy-support",
      apiToken: "freshdesk-api-token-123456",
      connectionScope: "workspace",
      workspaceId: "workspace-customer-success",
      now: "2026-06-08T07:55:00.000Z",
    });
  expect(configureResponse.status).toBe(201);
  const connectionId = configureResponse.body.connection.id as string;

  const grantResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/integrations/tool-grants")
    .send({
      actorUserId: "user-integrations-admin",
      actorRole: "admin",
      capability: "knowledge-source",
      workspaceId: "workspace-customer-success",
      workflowId: "workflow-support",
      toolId: "freshdesk.solutions.import",
      integrationConnectionId: connectionId,
      risk: "low",
      approvalRequired: false,
      now: "2026-06-08T07:57:00.000Z",
    });
  expect(grantResponse.status).toBe(201);

  return connectionId;
}

function mockJsonResponse(status: number, body: unknown) {
  return {
    status,
    headers: new Headers({
      "content-type": "application/json",
    }),
    text: async () => JSON.stringify(body),
  };
}

function mockTextResponse(status: number, body: string, contentType = "text/plain") {
  return {
    status,
    headers: new Headers({
      "content-type": contentType,
    }),
    text: async () => body,
  };
}
