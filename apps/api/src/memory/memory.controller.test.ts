import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

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
  it("requires opt-in and retrieves caller/account memory only for the matching tenant and caller identity", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
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
      createdBy: "user-extractor",
      auditTrail: [
        {
          action: "draft_created",
          actorUserId: "user-extractor",
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
          actorUserId: "user-extractor",
          at: "2026-05-19T10:00:00.000Z",
        },
        {
          action: "approved",
          actorUserId: "user-memory-approver",
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
          actorUserId: "user-memory-approver",
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
          actorUserId: "user-memory-editor",
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
          actorUserId: "user-memory-editor",
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
          actorUserId: "user-memory-editor",
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
    await app.init();

    const manualResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "manual_text",
        workspaceId: "workspace-support",
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
      workspaceId: "workspace-support",
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
        workspaceId: "workspace-support",
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
        workspaceId: "workspace-support",
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
      workspaceId: "workspace-support",
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
        workspaceId: "workspace-support",
        workflowIds: ["workflow-support"],
        status: "draft",
      }),
    ]);

    const draftId = String(urlResponse.body.reviewDrafts[0].id);
    const beforeApprovalResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-support&workflowId=workflow-support",
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
      workspaceId: "workspace-support",
      workflowIds: ["workflow-support"],
      source: expect.objectContaining({
        kind: "document",
        uri: "https://example.test/legal/cancellations",
        sourceSnapshotId: urlResponse.body.source.id,
      }),
    });

    const retrievedResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-support&workflowId=workflow-support",
    );

    expect(retrievedResponse.status).toBe(200);
    expect(
      retrievedResponse.body.knowledge.map((knowledge: { title: string }) => knowledge.title),
    ).toEqual(["Legal cancellation terms", "Returns procedure"]);

    const otherWorkspaceResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/memory/knowledge?publishedWorkflowVersionId=published-support-v2&workspaceId=workspace-sales&workflowId=workflow-support",
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

  it("review-gates PDF snapshots and rejects unsupported provider knowledge imports", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const pdfResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "pdf",
        workspaceId: "workspace-support",
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
        workspaceId: "workspace-support",
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
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/memory/knowledge/sources")
      .send({
        actorUserId: "user-knowledge-admin",
        sourceType: "single_url",
        workspaceId: "workspace-support",
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
      workspaceId: "workspace-support",
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

  it("ingests supported knowledge sources, exposes status, and retries failed sources", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MemoryModule],
    })
      .overrideProvider(MEMORY_STATE_REPOSITORY)
      .useValue(new InMemoryMemoryStateRepository())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
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
          workspaceId: "workspace-support",
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
            workspaceId: "workspace-support",
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
