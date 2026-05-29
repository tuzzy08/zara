import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type {
  ApproveMemoryDraftRequest,
  CallerIdentity,
  ExtractedMemoryDraftResponse,
  ExtractMemoryDraftsRequest,
  CreateMemoryRecordRequest,
  CreateTenantKnowledgeRequest,
  DeleteMemoryRecordRequest,
  FilteredMemoryExtractionCandidateResponse,
  CreateKnowledgeIngestionRequest,
  KnowledgeIngestionFailureResponse,
  KnowledgeIngestionJobResponse,
  KnowledgeIngestionSourceInput,
  KnowledgeIngestionSourceStatusResponse,
  DeleteTenantMemoryDataRequest,
  MemoryApprovalDraftResponse,
  MemoryRecordResponse,
  MemoryScope,
  MemoryRetentionPurgeResponse,
  PurgeMemoryRetentionRequest,
  RejectMemoryDraftRequest,
  RetryKnowledgeIngestionRequest,
  RetrievedMemoryMatchResponse,
  RetrieveMemoryRequest,
  TenantKnowledgeRecordResponse,
  TenantMemoryDeletionResponse,
  TenantMemoryExportResponse,
  UpdateMemoryRecordRequest,
} from "./memory.models";
import {
  MEMORY_STATE_REPOSITORY,
  type MemoryStateRepository,
  type PersistedMemoryEmbeddingRecord,
  type PersistedMemoryStateRecord,
} from "./memory-state.repository";

@Injectable()
export class MemoryService {
  private readonly stateByOrganizationId = new Map<string, PersistedMemoryStateRecord>();

  constructor(
    @Inject(MEMORY_STATE_REPOSITORY)
    private readonly memoryStateRepository: MemoryStateRepository,
  ) {}

  async createMemory(
    organizationId: string,
    input: CreateMemoryRecordRequest,
  ): Promise<MemoryRecordResponse | MemoryApprovalDraftResponse> {
    if (!input.optIn) {
      throw new ForbiddenException("Durable caller/account memory requires explicit opt-in.");
    }

    const text = input.text.trim();
    if (text.length === 0) {
      throw new BadRequestException("Memory text is required.");
    }

    if (containsSensitiveMemoryContent(text)) {
      throw new BadRequestException("Sensitive memory classes cannot be stored.");
    }

    if (input.scope === "account" && normalizeOptionalId(input.accountId) === undefined) {
      throw new BadRequestException("Account memory requires an accountId.");
    }

    const now = input.now ?? new Date().toISOString();
    const callerIdentity = normalizeCallerIdentity(input.callerIdentity);
    const accountId = normalizeOptionalId(input.accountId);
    const confidence = clampConfidence(input.confidence);

    if (input.approvalRequired === true) {
      const draft: MemoryApprovalDraftResponse = {
        id: `memory_draft_${randomUUID()}`,
        organizationId,
        scope: input.scope,
        callerIdentity,
        ...(input.scope === "account" && accountId !== undefined ? { accountId } : {}),
        text,
        source: cloneMemorySource(input.source),
        confidence,
        approvalState: "pending",
        status: "draft",
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        auditTrail: [
          {
            action: "draft_created",
            actorUserId: input.actorUserId,
            at: now,
          },
        ],
      };
      const state = await this.getOrCreateState(organizationId);
      state.drafts = [draft, ...state.drafts];
      await this.persistState(state);

      return cloneDraft(draft);
    }

    const memory: MemoryRecordResponse = {
      id: `memory_${randomUUID()}`,
      organizationId,
      scope: input.scope,
      callerIdentity,
      ...(input.scope === "account" ? { accountId: accountId! } : {}),
      text,
      source: cloneMemorySource(input.source),
      confidence,
      approvalState: "approved",
      status: "active",
      createdBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
      auditTrail: [
        {
          action: "memory_created",
          actorUserId: input.actorUserId,
          at: now,
        },
      ],
    };

    const state = await this.getOrCreateState(organizationId);
    state.memories = [memory, ...state.memories];
    const embedding = normalizeEmbedding(input.embedding);
    if (embedding !== undefined) {
      state.embeddings = [
        {
          id: `embedding_${randomUUID()}`,
          organizationId,
          recordKind: "memory",
          recordId: memory.id,
          scope: memory.scope,
          embedding,
          confidence: memory.confidence,
          callerIdentity: { ...memory.callerIdentity },
          ...(memory.accountId !== undefined ? { accountId: memory.accountId } : {}),
          createdAt: now,
        },
        ...state.embeddings,
      ];
    }
    await this.persistState(state);

    return cloneMemory(memory);
  }

  async approveMemoryDraft(
    organizationId: string,
    draftId: string,
    input: ApproveMemoryDraftRequest,
  ): Promise<{ draft: MemoryApprovalDraftResponse; memory: MemoryRecordResponse }> {
    const approverUserId = normalizeRequiredId(input.approverUserId, "Approver user ID");
    const now = input.now ?? new Date().toISOString();
    const state = await this.getOrCreateState(organizationId);
    const draft = getPendingDraft(state, draftId);
    const text = input.text === undefined ? draft.text : input.text.trim();

    if (text.length === 0) {
      throw new BadRequestException("Approved memory text is required.");
    }

    const memory: MemoryRecordResponse = {
      id: `memory_${randomUUID()}`,
      organizationId,
      scope: draft.scope,
      callerIdentity: { ...draft.callerIdentity },
      ...(draft.scope === "account" && draft.accountId !== undefined
        ? { accountId: draft.accountId }
        : {}),
      text,
      source: cloneMemorySource(draft.source),
      confidence: clampConfidence(input.confidence ?? draft.confidence),
      approvalState: "approved",
      status: "active",
      createdBy: approverUserId,
      createdAt: now,
      updatedAt: now,
      auditTrail: [
        {
          action: "memory_created",
          actorUserId: approverUserId,
          at: now,
        },
      ],
    };

    draft.approvalState = "approved";
    draft.status = "approved";
    draft.approvedMemoryId = memory.id;
    draft.updatedAt = now;
    draft.auditTrail = [
      ...draft.auditTrail,
      {
        action: "approved",
        actorUserId: approverUserId,
        at: now,
      },
    ];
    state.memories = [memory, ...state.memories];
    await this.persistState(state);

    return {
      draft: cloneDraft(draft),
      memory: cloneMemory(memory),
    };
  }

  async rejectMemoryDraft(
    organizationId: string,
    draftId: string,
    input: RejectMemoryDraftRequest,
  ): Promise<MemoryApprovalDraftResponse> {
    const approverUserId = normalizeRequiredId(input.approverUserId, "Approver user ID");
    const now = input.now ?? new Date().toISOString();
    const state = await this.getOrCreateState(organizationId);
    const draft = getPendingDraft(state, draftId);
    const rejectionReason = normalizeOptionalId(input.reason);

    draft.approvalState = "rejected";
    draft.status = "rejected";
    draft.updatedAt = now;
    if (rejectionReason !== undefined) {
      draft.rejectionReason = rejectionReason;
    }
    draft.auditTrail = [
      ...draft.auditTrail,
      {
        action: "rejected",
        actorUserId: approverUserId,
        at: now,
        ...(rejectionReason !== undefined ? { reason: rejectionReason } : {}),
      },
    ];
    await this.persistState(state);

    return cloneDraft(draft);
  }

  async updateMemory(
    organizationId: string,
    memoryId: string,
    input: UpdateMemoryRecordRequest,
  ): Promise<MemoryRecordResponse> {
    const actorUserId = normalizeRequiredId(input.actorUserId, "Actor user ID");
    const now = input.now ?? new Date().toISOString();
    const state = await this.getOrCreateState(organizationId);
    const memory = findMutableMemory(state, memoryId);
    const text = input.text === undefined ? undefined : input.text.trim();
    const nextStatus = input.status;

    if (text !== undefined && text.length === 0) {
      throw new BadRequestException("Memory text is required.");
    }

    if (text !== undefined) {
      memory.text = text;
    }

    if (input.confidence !== undefined) {
      memory.confidence = clampConfidence(input.confidence);
      state.embeddings = state.embeddings.map((embedding) =>
        embedding.recordKind === "memory" && embedding.recordId === memory.id
          ? { ...embedding, confidence: memory.confidence }
          : embedding,
      );
    }

    if (nextStatus !== undefined) {
      memory.status = nextStatus;
    }

    memory.updatedAt = now;
    memory.auditTrail = [
      ...(memory.auditTrail ?? []),
      {
        action: nextStatus === "disabled" ? "memory_disabled" : "memory_edited",
        actorUserId,
        at: now,
      },
    ];

    await this.persistState(state);

    return cloneMemory(memory);
  }

  async deleteMemory(
    organizationId: string,
    memoryId: string,
    input: DeleteMemoryRecordRequest,
  ): Promise<MemoryRecordResponse> {
    const actorUserId = normalizeRequiredId(input.actorUserId, "Actor user ID");
    const now = input.now ?? new Date().toISOString();
    const state = await this.getOrCreateState(organizationId);
    const memory = findMutableMemory(state, memoryId);

    memory.status = "deleted";
    memory.updatedAt = now;
    memory.auditTrail = [
      ...(memory.auditTrail ?? []),
      {
        action: "memory_deleted",
        actorUserId,
        at: now,
      },
    ];
    state.embeddings = state.embeddings.filter(
      (embedding) => !(embedding.recordKind === "memory" && embedding.recordId === memory.id),
    );
    await this.persistState(state);

    return cloneMemory(memory);
  }

  async purgeRetention(
    organizationId: string,
    input: PurgeMemoryRetentionRequest,
  ): Promise<MemoryRetentionPurgeResponse> {
    const actorUserId = normalizeRequiredId(input.actorUserId, "Actor user ID");
    assertNoLegalHold(input.legalHold);
    const retainAfter = normalizeRequiredTimestamp(input.retainAfter, "Retention cutoff");
    const purgedAt = input.now ?? new Date().toISOString();
    const state = await this.getOrCreateState(organizationId);
    const purgedMemoryIds = new Set(
      state.memories
        .filter((memory) => isBeforeTimestamp(memory.createdAt, retainAfter))
        .map((memory) => memory.id),
    );
    const purgedKnowledgeIds = new Set(
      state.knowledge
        .filter((knowledge) => isBeforeTimestamp(knowledge.createdAt, retainAfter))
        .map((knowledge) => knowledge.id),
    );
    const memoryCount = purgedMemoryIds.size;
    const knowledgeCount = purgedKnowledgeIds.size;

    state.memories = state.memories.filter((memory) => !purgedMemoryIds.has(memory.id));
    state.knowledge = state.knowledge.filter((knowledge) => !purgedKnowledgeIds.has(knowledge.id));

    const embeddingsBefore = state.embeddings.length;
    state.embeddings = state.embeddings.filter(
      (embedding) =>
        !(embedding.recordKind === "memory" && purgedMemoryIds.has(embedding.recordId))
        && !(
          embedding.recordKind === "tenant_knowledge"
          && purgedKnowledgeIds.has(embedding.recordId)
        )
        && !isBeforeTimestamp(embedding.createdAt, retainAfter),
    );

    let ingestionSourceCount = 0;
    state.ingestions = state.ingestions.map((ingestion) => {
      const retainedSources = ingestion.sources.filter((source) => {
        const shouldPurge =
          isBeforeTimestamp(source.updatedAt, retainAfter)
          || (source.knowledgeRecordId !== undefined && purgedKnowledgeIds.has(source.knowledgeRecordId));
        if (shouldPurge) {
          ingestionSourceCount += 1;
        }

        return !shouldPurge;
      });

      return {
        ...ingestion,
        sources: retainedSources,
        sourceCount: retainedSources.length,
        succeededCount: retainedSources.filter((source) => source.status === "succeeded").length,
        failedCount: retainedSources.filter((source) => source.status === "failed").length,
        status: getIngestionStatus(retainedSources),
        updatedAt: purgedAt,
      };
    });
    await this.persistState(state);

    return {
      organizationId,
      retainedAfter: retainAfter,
      purgedCounts: {
        memories: memoryCount,
        knowledge: knowledgeCount,
        embeddings: embeddingsBefore - state.embeddings.length,
        ingestionSources: ingestionSourceCount,
      },
      actorUserId,
      purgedAt,
    };
  }

  async exportTenantMemory(
    organizationId: string,
    now = new Date().toISOString(),
  ): Promise<TenantMemoryExportResponse> {
    const state = await this.getOrCreateState(organizationId);

    return {
      organizationId,
      exportedAt: now,
      memories: state.memories.map(cloneMemory),
      knowledge: state.knowledge.map(cloneKnowledge),
      drafts: state.drafts.map(cloneDraft),
      ingestions: state.ingestions.map(cloneKnowledgeIngestion),
      embeddings: state.embeddings.map((embedding) => ({
        id: embedding.id,
        recordKind: embedding.recordKind,
        recordId: embedding.recordId,
        scope: embedding.scope,
        confidence: embedding.confidence,
        createdAt: embedding.createdAt,
      })),
    };
  }

  async deleteTenantMemoryData(
    organizationId: string,
    input: DeleteTenantMemoryDataRequest,
  ): Promise<TenantMemoryDeletionResponse> {
    const actorUserId = normalizeRequiredId(input.actorUserId, "Actor user ID");
    assertNoLegalHold(input.legalHold);
    const deletedAt = input.now ?? new Date().toISOString();
    const state = await this.getOrCreateState(organizationId);
    const deletedCounts = {
      memories: state.memories.length,
      knowledge: state.knowledge.length,
      embeddings: state.embeddings.length,
      drafts: state.drafts.length,
      ingestions: state.ingestions.length,
    };

    state.memories = [];
    state.knowledge = [];
    state.embeddings = [];
    state.drafts = [];
    state.ingestions = [];
    await this.persistState(state);

    return {
      organizationId,
      deletedCounts,
      actorUserId,
      deletedAt,
    };
  }

  async retrieveMemories(input: {
    organizationId: string;
    callerIdentity: CallerIdentity;
    accountId?: string | undefined;
  }): Promise<MemoryRecordResponse[]> {
    const callerIdentity = normalizeCallerIdentity(input.callerIdentity);
    const accountId = normalizeOptionalId(input.accountId);
    const state = await this.getOrCreateState(input.organizationId);

    return state.memories
      .filter((memory) => memory.status === "active")
      .filter((memory) => isSameCallerIdentity(memory.callerIdentity, callerIdentity))
      .filter(
        (memory) =>
          memory.scope === "caller"
          || (accountId !== undefined && memory.accountId === accountId),
      )
      .map(cloneMemory);
  }

  async retrieveByEmbedding(
    organizationId: string,
    input: RetrieveMemoryRequest,
  ): Promise<RetrievedMemoryMatchResponse[]> {
    const queryEmbedding = normalizeRequiredEmbedding(input.queryEmbedding, "Query embedding");
    const topK = normalizeTopK(input.topK);
    const minConfidence = clampConfidence(input.minConfidence);
    const callerIdentity =
      input.callerIdentity === undefined ? undefined : normalizeCallerIdentity(input.callerIdentity);
    const accountId = normalizeOptionalId(input.accountId);
    const publishedWorkflowVersionId = normalizeOptionalId(input.publishedWorkflowVersionId);
    const state = await this.getOrCreateState(organizationId);

    return state.embeddings
      .filter((embedding) => embedding.organizationId === organizationId)
      .filter((embedding) => input.scope === undefined || embedding.scope === input.scope)
      .filter((embedding) => embedding.confidence >= minConfidence)
      .filter((embedding) => matchesEmbeddingScope(embedding, {
        callerIdentity,
        accountId,
        publishedWorkflowVersionId,
      }))
      .map((embedding) => ({
        embedding,
        similarityScore: cosineSimilarity(queryEmbedding, embedding.embedding),
      }))
      .filter((match) => Number.isFinite(match.similarityScore))
      .sort((left, right) => right.similarityScore - left.similarityScore)
      .slice(0, topK)
      .map((match) => toRetrievedMemoryMatch(match.embedding, match.similarityScore, state))
      .filter((match): match is RetrievedMemoryMatchResponse => match !== undefined);
  }

  async extractMemoryDrafts(
    organizationId: string,
    input: ExtractMemoryDraftsRequest,
  ): Promise<{
    drafts: ExtractedMemoryDraftResponse[];
    filtered: FilteredMemoryExtractionCandidateResponse[];
  }> {
    if (!input.optIn) {
      throw new ForbiddenException("Memory extraction requires explicit opt-in.");
    }

    const callSessionId = normalizeRequiredId(input.callSessionId, "Call session ID");
    const transcriptId = normalizeRequiredId(input.transcriptId, "Transcript ID");
    const callerIdentity = normalizeCallerIdentity(input.callerIdentity);
    const accountId = normalizeOptionalId(input.accountId);
    const now = input.now ?? new Date().toISOString();
    const drafts: ExtractedMemoryDraftResponse[] = [];
    const filtered: FilteredMemoryExtractionCandidateResponse[] = [];

    for (const turn of input.transcript) {
      const transcriptEventId = normalizeOptionalId(turn.id);
      const text = turn.text.trim();

      if (transcriptEventId === undefined || text.length === 0) {
        continue;
      }

      if (turn.speaker !== "caller") {
        filtered.push({
          transcriptEventId,
          reason: "not_caller_asserted",
        });
        continue;
      }

      if (containsSensitiveMemoryContent(text)) {
        filtered.push({
          transcriptEventId,
          reason: "sensitive_data",
        });
        continue;
      }

      const scope = classifyMemoryDraftScope(text, accountId);
      if (scope === undefined) {
        filtered.push({
          transcriptEventId,
          reason: "not_memory_worthy",
        });
        continue;
      }

      drafts.push({
        id: `memory_draft_${randomUUID()}`,
        organizationId,
        scope,
        callerIdentity,
        ...(scope === "account" && accountId !== undefined ? { accountId } : {}),
        text,
        source: {
          kind: "call_summary",
          callSessionId,
          transcriptId,
          transcriptEventIds: [transcriptEventId],
        },
        confidence: scope === "account" ? 0.74 : 0.82,
        approvalState: "pending",
        status: "draft",
        createdBy: input.actorUserId,
        createdAt: now,
      });
    }

    return {
      drafts: drafts.sort(compareMemoryDrafts),
      filtered,
    };
  }

  async createTenantKnowledge(
    organizationId: string,
    input: CreateTenantKnowledgeRequest,
  ): Promise<TenantKnowledgeRecordResponse> {
    const title = input.title.trim();
    const text = input.text.trim();
    const sourceTitle = input.source.title.trim();
    const staleAt = normalizeOptionalId(input.staleAt);
    const publishedWorkflowVersionIds = normalizeWorkflowVersionIds(
      input.publishedWorkflowVersionIds,
    );

    if (title.length === 0) {
      throw new BadRequestException("Knowledge title is required.");
    }

    if (text.length === 0) {
      throw new BadRequestException("Knowledge text is required.");
    }

    if (sourceTitle.length === 0) {
      throw new BadRequestException("Knowledge source title is required.");
    }

    const now = input.now ?? new Date().toISOString();
    const knowledge: TenantKnowledgeRecordResponse = {
      id: `knowledge_${randomUUID()}`,
      organizationId,
      kind: input.kind,
      publishedWorkflowVersionIds,
      title,
      text,
      source: {
        kind: input.source.kind,
        title: sourceTitle,
        ...(normalizeOptionalId(input.source.uri) !== undefined
          ? { uri: normalizeOptionalId(input.source.uri) }
          : {}),
        ...(normalizeOptionalId(input.source.externalId) !== undefined
          ? { externalId: normalizeOptionalId(input.source.externalId) }
          : {}),
      },
      ...(staleAt !== undefined ? { staleAt } : {}),
      conflictState: "none",
      status: "active",
      createdBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };

    const state = await this.getOrCreateState(organizationId);
    state.knowledge = [knowledge, ...state.knowledge];
    await this.persistState(state);

    return cloneKnowledge(knowledge);
  }

  async createKnowledgeIngestion(
    organizationId: string,
    input: CreateKnowledgeIngestionRequest,
  ): Promise<KnowledgeIngestionJobResponse> {
    const actorUserId = normalizeRequiredId(input.actorUserId, "Actor user ID");
    const publishedWorkflowVersionIds = normalizeWorkflowVersionIds(
      input.publishedWorkflowVersionIds,
    );
    const now = input.now ?? new Date().toISOString();
    const sources = normalizeIngestionSources(input.sources);
    const state = await this.getOrCreateState(organizationId);
    const sourceStatuses = sources.map((source) =>
      ingestKnowledgeSource({
        organizationId,
        actorUserId,
        source,
        publishedWorkflowVersionIds,
        now,
        state,
      }),
    );
    const ingestion = buildKnowledgeIngestionJob({
      id: `knowledge_ingestion_${randomUUID()}`,
      organizationId,
      actorUserId,
      publishedWorkflowVersionIds,
      sourceStatuses,
      createdAt: now,
      updatedAt: now,
    });

    state.ingestions = [ingestion, ...state.ingestions];
    await this.persistState(state);

    return cloneKnowledgeIngestion(ingestion);
  }

  async getKnowledgeIngestion(
    organizationId: string,
    ingestionId: string,
  ): Promise<KnowledgeIngestionJobResponse> {
    const state = await this.getOrCreateState(organizationId);

    return cloneKnowledgeIngestion(findKnowledgeIngestion(state, ingestionId));
  }

  async retryKnowledgeIngestion(
    organizationId: string,
    ingestionId: string,
    input: RetryKnowledgeIngestionRequest,
  ): Promise<KnowledgeIngestionJobResponse> {
    const actorUserId = normalizeRequiredId(input.actorUserId, "Actor user ID");
    const now = input.now ?? new Date().toISOString();
    const state = await this.getOrCreateState(organizationId);
    const ingestion = findKnowledgeIngestion(state, ingestionId);
    const sourceOverrides = new Map(
      normalizeIngestionSources(input.sources ?? []).map((source) => [source.clientSourceId, source]),
    );

    ingestion.sources = ingestion.sources.map((sourceStatus) => {
      if (sourceStatus.status !== "failed" || sourceStatus.failure?.retryable !== true) {
        return sourceStatus;
      }

      const source = sourceOverrides.get(sourceStatus.clientSourceId);
      if (source === undefined) {
        return {
          ...sourceStatus,
          updatedAt: now,
        };
      }

      return ingestKnowledgeSource({
        organizationId,
        actorUserId,
        source,
        publishedWorkflowVersionIds: ingestion.publishedWorkflowVersionIds,
        now,
        state,
      });
    });
    const nextIngestion = buildKnowledgeIngestionJob({
      id: ingestion.id,
      organizationId: ingestion.organizationId,
      actorUserId: ingestion.createdBy,
      publishedWorkflowVersionIds: ingestion.publishedWorkflowVersionIds,
      sourceStatuses: ingestion.sources,
      createdAt: ingestion.createdAt,
      updatedAt: now,
    });
    Object.assign(ingestion, nextIngestion);
    await this.persistState(state);

    return cloneKnowledgeIngestion(ingestion);
  }

  async retrieveTenantKnowledge(input: {
    organizationId: string;
    publishedWorkflowVersionId?: string | undefined;
    now?: string | undefined;
  }): Promise<TenantKnowledgeRecordResponse[]> {
    const publishedWorkflowVersionId = normalizeOptionalId(input.publishedWorkflowVersionId);
    const now = input.now ?? new Date().toISOString();

    if (publishedWorkflowVersionId === undefined) {
      return [];
    }

    const state = await this.getOrCreateState(input.organizationId);

    const activeKnowledge = state.knowledge
      .filter((knowledge) => knowledge.status === "active")
      .filter((knowledge) => !isStaleAt(knowledge.staleAt, now))
      .filter((knowledge) =>
        knowledge.publishedWorkflowVersionIds.includes(publishedWorkflowVersionId),
      );
    const conflictingKeys = findConflictingKnowledgeKeys(activeKnowledge);

    return activeKnowledge.map((knowledge) => ({
      ...cloneKnowledge(knowledge),
      conflictState: conflictingKeys.has(getKnowledgeConflictKey(knowledge))
        ? "conflicting"
        : "none",
    }));
  }

  private async getOrCreateState(organizationId: string) {
    const existing = this.stateByOrganizationId.get(organizationId);
    if (existing !== undefined) {
      return existing;
    }

    const persistedState = await this.memoryStateRepository.load(organizationId);
    const nextState =
      persistedState ?? {
        schemaVersion: 1 as const,
        organizationId,
        memories: [],
        knowledge: [],
        embeddings: [],
        drafts: [],
        ingestions: [],
      };

    nextState.knowledge ??= [];
    nextState.embeddings ??= [];
    nextState.drafts ??= [];
    nextState.ingestions ??= [];
    this.stateByOrganizationId.set(organizationId, nextState);
    return nextState;
  }

  private async persistState(state: PersistedMemoryStateRecord) {
    await this.memoryStateRepository.save({
      schemaVersion: 1,
      organizationId: state.organizationId,
      memories: state.memories.map(cloneMemory),
      knowledge: state.knowledge.map(cloneKnowledge),
      embeddings: state.embeddings.map(cloneEmbeddingRecord),
      drafts: state.drafts.map(cloneDraft),
      ingestions: state.ingestions.map(cloneKnowledgeIngestion),
    });
  }
}

function normalizeCallerIdentity(input: CallerIdentity): CallerIdentity {
  const value = input.value.trim();

  if (value.length === 0) {
    throw new BadRequestException("Caller identity value is required.");
  }

  return {
    kind: input.kind,
    value: input.kind === "email" ? value.toLowerCase() : value,
  };
}

function normalizeOptionalId(value: string | undefined) {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function normalizeRequiredId(value: string | undefined, label: string) {
  const normalized = normalizeOptionalId(value);

  if (normalized === undefined) {
    throw new BadRequestException(`${label} is required.`);
  }

  return normalized;
}

function normalizeRequiredTimestamp(value: string | undefined, label: string) {
  const normalized = normalizeRequiredId(value, label);

  if (!Number.isFinite(Date.parse(normalized))) {
    throw new BadRequestException(`${label} must be a valid ISO timestamp.`);
  }

  return normalized;
}

function assertNoLegalHold(legalHold: boolean | undefined) {
  if (legalHold === true) {
    throw new ConflictException("Memory retention action is blocked by legal hold.");
  }
}

function getPendingDraft(state: PersistedMemoryStateRecord, draftId: string) {
  const normalizedDraftId = normalizeRequiredId(draftId, "Draft ID");
  const draft = state.drafts.find((candidate) => candidate.id === normalizedDraftId);

  if (draft === undefined) {
    throw new BadRequestException("Memory draft was not found.");
  }

  if (draft.status !== "draft" || draft.approvalState !== "pending") {
    throw new BadRequestException("Memory draft is not pending approval.");
  }

  return draft;
}

function findKnowledgeIngestion(state: PersistedMemoryStateRecord, ingestionId: string) {
  const normalizedIngestionId = normalizeRequiredId(ingestionId, "Knowledge ingestion ID");
  const ingestion = state.ingestions.find((candidate) => candidate.id === normalizedIngestionId);

  if (ingestion === undefined) {
    throw new NotFoundException("Knowledge ingestion was not found.");
  }

  return ingestion;
}

function findMutableMemory(state: PersistedMemoryStateRecord, memoryId: string) {
  const normalizedMemoryId = normalizeRequiredId(memoryId, "Memory ID");
  const memory = state.memories.find(
    (candidate) => candidate.id === normalizedMemoryId && candidate.status !== "deleted",
  );

  if (memory === undefined) {
    throw new NotFoundException("Memory record was not found.");
  }

  return memory;
}

function isSameCallerIdentity(left: CallerIdentity, right: CallerIdentity) {
  return left.kind === right.kind && left.value === right.value;
}

function isBeforeTimestamp(value: string, cutoff: string) {
  const valueTime = Date.parse(value);
  const cutoffTime = Date.parse(cutoff);

  return Number.isFinite(valueTime) && Number.isFinite(cutoffTime) && valueTime < cutoffTime;
}

function clampConfidence(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0, value));
}

function normalizeEmbedding(value: number[] | undefined) {
  return value === undefined ? undefined : normalizeRequiredEmbedding(value, "Embedding");
}

function normalizeRequiredEmbedding(value: number[] | undefined, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException(`${label} is required.`);
  }

  const embedding = value.map((component) => Number(component));

  if (embedding.some((component) => !Number.isFinite(component))) {
    throw new BadRequestException(`${label} must contain only finite numbers.`);
  }

  if (vectorMagnitude(embedding) === 0) {
    throw new BadRequestException(`${label} cannot be a zero vector.`);
  }

  return embedding;
}

function normalizeTopK(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return 5;
  }

  return Math.max(1, Math.min(20, Math.trunc(value)));
}

function containsSensitiveMemoryContent(text: string) {
  const normalized = text.toLowerCase();
  const digitRuns = text.replace(/\D/g, "");

  return (
    /\b(password|passcode|secret|api key|token|cvv|cvc|ssn|social security)\b/i.test(text)
    || digitRuns.length >= 13
    || /\b\d{3}-\d{2}-\d{4}\b/.test(text)
    || normalized.includes("credit card")
    || normalized.includes("card number")
  );
}

function classifyMemoryDraftScope(text: string, accountId: string | undefined) {
  const normalized = text.toLowerCase();

  if (
    accountId !== undefined
    && /\b(account|invoice|renewal|contract|subscription|billing)\b/.test(normalized)
  ) {
    return "account" as const;
  }

  if (/\b(prefer|prefers|wants|needs|remember|likes|dislikes|follow[- ]?up)\b/.test(normalized)) {
    return "caller" as const;
  }

  return undefined;
}

function compareMemoryDrafts(
  left: ExtractedMemoryDraftResponse,
  right: ExtractedMemoryDraftResponse,
) {
  const scopeOrder = { account: 0, caller: 1 } satisfies Record<MemoryScope, number>;

  return scopeOrder[left.scope] - scopeOrder[right.scope];
}

function matchesEmbeddingScope(
  embedding: PersistedMemoryEmbeddingRecord,
  filters: {
    callerIdentity?: CallerIdentity | undefined;
    accountId?: string | undefined;
    publishedWorkflowVersionId?: string | undefined;
  },
) {
  if (
    embedding.scope === "caller"
    && filters.callerIdentity !== undefined
    && (embedding.callerIdentity === undefined
      || !isSameCallerIdentity(embedding.callerIdentity, filters.callerIdentity))
  ) {
    return false;
  }

  if (
    embedding.scope === "account"
    && (filters.callerIdentity !== undefined || filters.accountId !== undefined)
  ) {
    return (
      filters.accountId !== undefined
      && embedding.accountId === filters.accountId
      && (filters.callerIdentity === undefined
        || (embedding.callerIdentity !== undefined
          && isSameCallerIdentity(embedding.callerIdentity, filters.callerIdentity)))
    );
  }

  if (
    embedding.scope === "tenant_knowledge"
    && filters.publishedWorkflowVersionId !== undefined
  ) {
    return embedding.publishedWorkflowVersionIds?.includes(filters.publishedWorkflowVersionId) ?? false;
  }

  return true;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length) {
    return Number.NaN;
  }

  const dotProduct = left.reduce((sum, component, index) => sum + component * right[index]!, 0);
  const magnitude = vectorMagnitude(left) * vectorMagnitude(right);

  return magnitude === 0 ? Number.NaN : roundSimilarity(dotProduct / magnitude);
}

function vectorMagnitude(vector: number[]) {
  return Math.sqrt(vector.reduce((sum, component) => sum + component * component, 0));
}

function roundSimilarity(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toRetrievedMemoryMatch(
  embedding: PersistedMemoryEmbeddingRecord,
  similarityScore: number,
  state: PersistedMemoryStateRecord,
): RetrievedMemoryMatchResponse | undefined {
  if (embedding.recordKind === "memory") {
    const memory = state.memories.find(
      (candidate) => candidate.id === embedding.recordId && candidate.status === "active",
    );

    return memory === undefined
      ? undefined
      : {
          id: embedding.id,
          organizationId: embedding.organizationId,
          scope: embedding.scope,
          confidence: embedding.confidence,
          similarityScore,
          memory: cloneMemory(memory),
        };
  }

  const knowledge = state.knowledge.find((candidate) => candidate.id === embedding.recordId);

  return knowledge === undefined
    ? undefined
    : {
        id: embedding.id,
        organizationId: embedding.organizationId,
        scope: embedding.scope,
        confidence: embedding.confidence,
        similarityScore,
        knowledge: cloneKnowledge(knowledge),
      };
}

function normalizeWorkflowVersionIds(values: string[]) {
  const normalizedValues = [...new Set(values.map(normalizeOptionalId))]
    .filter((value): value is string => value !== undefined);

  if (normalizedValues.length === 0) {
    throw new BadRequestException("Knowledge requires at least one published workflow version.");
  }

  return normalizedValues;
}

function normalizeIngestionSources(values: KnowledgeIngestionSourceInput[]) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new BadRequestException("Knowledge ingestion requires at least one source.");
  }

  return values.map((value) => ({
    ...value,
    clientSourceId: normalizeRequiredId(value.clientSourceId, "Source ID"),
    title: normalizeRequiredId(value.title, "Source title"),
    text: value.text?.trim(),
    uri: normalizeOptionalId(value.uri),
    externalId: normalizeOptionalId(value.externalId),
    contentType: normalizeOptionalId(value.contentType),
  }));
}

function ingestKnowledgeSource(input: {
  organizationId: string;
  actorUserId: string;
  source: KnowledgeIngestionSourceInput;
  publishedWorkflowVersionIds: string[];
  now: string;
  state: PersistedMemoryStateRecord;
}): KnowledgeIngestionSourceStatusResponse {
  const failure = validateKnowledgeIngestionSource(input.source);

  if (failure !== undefined) {
    return {
      clientSourceId: input.source.clientSourceId,
      type: input.source.type,
      title: input.source.title,
      status: "failed",
      failure,
      updatedAt: input.now,
    };
  }

  const knowledge: TenantKnowledgeRecordResponse = {
    id: `knowledge_${randomUUID()}`,
    organizationId: input.organizationId,
    kind: "policy",
    publishedWorkflowVersionIds: [...input.publishedWorkflowVersionIds],
    title: input.source.title,
    text: input.source.text!.trim(),
    source: {
      kind: isIntegrationIngestionSource(input.source.type) ? "integration" : "document",
      title: input.source.title,
      ...(input.source.uri !== undefined ? { uri: input.source.uri } : {}),
      ...(input.source.externalId !== undefined ? { externalId: input.source.externalId } : {}),
    },
    conflictState: "none",
    status: "active",
    createdBy: input.actorUserId,
    createdAt: input.now,
    updatedAt: input.now,
  };
  input.state.knowledge = [knowledge, ...input.state.knowledge];

  return {
    clientSourceId: input.source.clientSourceId,
    type: input.source.type,
    title: input.source.title,
    status: "succeeded",
    knowledgeRecordId: knowledge.id,
    updatedAt: input.now,
  };
}

function validateKnowledgeIngestionSource(
  source: KnowledgeIngestionSourceInput,
): KnowledgeIngestionFailureResponse | undefined {
  if (source.text === undefined || source.text.trim().length === 0) {
    return {
      code: "missing_content",
      retryable: true,
      message: "Knowledge source content is required.",
    };
  }

  if (source.text.length > 100_000) {
    return {
      code: "large_file",
      retryable: true,
      message: "Knowledge source content is too large for this ingestion slice.",
    };
  }

  if (source.type === "pdf" && source.contentType !== undefined && source.contentType !== "application/pdf") {
    return {
      code: "unsupported_content_type",
      retryable: true,
      message: "PDF knowledge sources must use application/pdf content.",
    };
  }

  return undefined;
}

function isIntegrationIngestionSource(sourceType: KnowledgeIngestionSourceInput["type"]) {
  return sourceType === "notion" || sourceType === "google_drive" || sourceType === "crm_help_center";
}

function buildKnowledgeIngestionJob(input: {
  id: string;
  organizationId: string;
  actorUserId: string;
  publishedWorkflowVersionIds: string[];
  sourceStatuses: KnowledgeIngestionSourceStatusResponse[];
  createdAt: string;
  updatedAt: string;
}): KnowledgeIngestionJobResponse {
  const succeededCount = input.sourceStatuses.filter((source) => source.status === "succeeded").length;
  const failedCount = input.sourceStatuses.length - succeededCount;

  return {
    id: input.id,
    organizationId: input.organizationId,
    status: getIngestionStatus(input.sourceStatuses),
    sourceCount: input.sourceStatuses.length,
    succeededCount,
    failedCount,
    publishedWorkflowVersionIds: [...input.publishedWorkflowVersionIds],
    sources: input.sourceStatuses.map(cloneKnowledgeIngestionSource),
    createdBy: input.actorUserId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function getIngestionStatus(sourceStatuses: KnowledgeIngestionSourceStatusResponse[]) {
  const succeededCount = sourceStatuses.filter((source) => source.status === "succeeded").length;
  const failedCount = sourceStatuses.length - succeededCount;

  return failedCount === 0 ? "completed" : succeededCount === 0 ? "failed" : "partial_failure";
}

function isStaleAt(staleAt: string | undefined, now: string) {
  if (staleAt === undefined) {
    return false;
  }

  const staleAtTime = Date.parse(staleAt);
  const nowTime = Date.parse(now);

  return Number.isFinite(staleAtTime) && Number.isFinite(nowTime) && staleAtTime <= nowTime;
}

function findConflictingKnowledgeKeys(knowledgeRecords: TenantKnowledgeRecordResponse[]) {
  const recordsByKey = new Map<string, Set<string>>();

  for (const knowledge of knowledgeRecords) {
    const key = getKnowledgeConflictKey(knowledge);
    const signatures = recordsByKey.get(key) ?? new Set<string>();
    signatures.add(`${knowledge.text}\n${JSON.stringify(knowledge.source)}`);
    recordsByKey.set(key, signatures);
  }

  return new Set(
    [...recordsByKey.entries()]
      .filter(([, signatures]) => signatures.size > 1)
      .map(([key]) => key),
  );
}

function getKnowledgeConflictKey(knowledge: TenantKnowledgeRecordResponse) {
  return `${knowledge.kind}:${knowledge.title.trim().toLowerCase()}`;
}

function cloneMemory(memory: MemoryRecordResponse): MemoryRecordResponse {
  return {
    ...memory,
    callerIdentity: { ...memory.callerIdentity },
    source: cloneMemorySource(memory.source),
    auditTrail: (memory.auditTrail ?? []).map((entry) => ({ ...entry })),
  };
}

function cloneKnowledge(
  knowledge: TenantKnowledgeRecordResponse,
): TenantKnowledgeRecordResponse {
  return {
    ...knowledge,
    publishedWorkflowVersionIds: [...knowledge.publishedWorkflowVersionIds],
    source: { ...knowledge.source },
  };
}

function cloneEmbeddingRecord(
  embedding: PersistedMemoryEmbeddingRecord,
): PersistedMemoryEmbeddingRecord {
  return {
    ...embedding,
    embedding: [...embedding.embedding],
    ...(embedding.callerIdentity === undefined
      ? {}
      : { callerIdentity: { ...embedding.callerIdentity } }),
    ...(embedding.publishedWorkflowVersionIds === undefined
      ? {}
      : { publishedWorkflowVersionIds: [...embedding.publishedWorkflowVersionIds] }),
  };
}

function cloneDraft(draft: MemoryApprovalDraftResponse): MemoryApprovalDraftResponse {
  return {
    ...draft,
    callerIdentity: { ...draft.callerIdentity },
    source: cloneMemorySource(draft.source),
    auditTrail: draft.auditTrail.map((entry) => ({ ...entry })),
  };
}

function cloneKnowledgeIngestion(
  ingestion: KnowledgeIngestionJobResponse,
): KnowledgeIngestionJobResponse {
  return {
    ...ingestion,
    publishedWorkflowVersionIds: [...ingestion.publishedWorkflowVersionIds],
    sources: ingestion.sources.map(cloneKnowledgeIngestionSource),
  };
}

function cloneKnowledgeIngestionSource(
  source: KnowledgeIngestionSourceStatusResponse,
): KnowledgeIngestionSourceStatusResponse {
  return {
    ...source,
    ...(source.failure === undefined ? {} : { failure: { ...source.failure } }),
  };
}

function cloneMemorySource(source: MemoryRecordResponse["source"]) {
  return {
    ...source,
    ...(source.transcriptEventIds === undefined
      ? {}
      : { transcriptEventIds: [...source.transcriptEventIds] }),
  };
}
