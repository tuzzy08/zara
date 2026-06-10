import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { getIntegrationProviderCatalogEntry } from "@zara/core";

import {
  classifyKnowledgeText,
  evaluateKnowledgeConflicts,
  isHighRiskKnowledgeKind,
} from "./knowledge-sync-safety";
import type {
  ApproveMemoryDraftRequest,
  ApproveKnowledgeReviewDraftRequest,
  CallerIdentity,
  CreateKnowledgeSourceRequest,
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
  KnowledgeReviewDraftResponse,
  KnowledgeSensitivityLabel,
  KnowledgeSourceSnapshotResponse,
  KnowledgeSourceSyncCadence,
  KnowledgeSourceSyncMode,
  WebsiteCrawlPageSnapshot,
  DeleteTenantMemoryDataRequest,
  MemoryApprovalDraftResponse,
  MemoryRecordResponse,
  MemoryScope,
  MemoryRetentionPurgeResponse,
  PurgeMemoryRetentionRequest,
  RejectMemoryDraftRequest,
  RefreshKnowledgeSourceRequest,
  RetryKnowledgeIngestionRequest,
  RetrievedMemoryMatchResponse,
  RetrieveMemoryRequest,
  TenantKnowledgeKind,
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
import { IntegrationsService } from "../integrations/integrations.service";
import { ToolPermissionGrantsService } from "../integrations/tool-permission-grants.service";
import { ConnectorToolsService } from "../integrations/connector-tools.service";

@Injectable()
export class MemoryService {
  private readonly stateByOrganizationId = new Map<string, PersistedMemoryStateRecord>();

  constructor(
    @Inject(MEMORY_STATE_REPOSITORY)
    private readonly memoryStateRepository: MemoryStateRepository,
    @Optional()
    private readonly integrationsService?: IntegrationsService,
    @Optional()
    private readonly toolPermissionGrantsService?: ToolPermissionGrantsService,
    @Optional()
    private readonly connectorToolsService?: ConnectorToolsService,
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
      knowledgeSources: state.knowledgeSources.map(cloneKnowledgeSource),
      knowledgeReviewDrafts: state.knowledgeReviewDrafts.map(cloneKnowledgeReviewDraft),
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
    state.knowledgeSources = [];
    state.knowledgeReviewDrafts = [];
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
    const workspaceId = normalizeOptionalId(input.workspaceId);
    const workflowIds = normalizeOptionalIdList(input.workflowIds ?? []);

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
      ...(workspaceId !== undefined ? { workspaceId } : {}),
      ...(workflowIds.length > 0 ? { workflowIds } : {}),
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
        ...(normalizeOptionalId(input.source.sourceSnapshotId) !== undefined
          ? { sourceSnapshotId: normalizeOptionalId(input.source.sourceSnapshotId) }
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

  async createKnowledgeSource(
    organizationId: string,
    input: CreateKnowledgeSourceRequest,
  ): Promise<{
    source: KnowledgeSourceSnapshotResponse;
    knowledge: TenantKnowledgeRecordResponse[];
    reviewDrafts: KnowledgeReviewDraftResponse[];
  }> {
    const actorUserId = normalizeRequiredId(input.actorUserId, "Actor user ID");
    const title = normalizeRequiredId(input.title, "Knowledge source title");
    let text = input.text?.trim() ?? "";
    const workspaceId = normalizeRequiredId(input.workspaceId, "Workspace ID");
    const workflowIds = normalizeOptionalIdList(input.workflowIds ?? []);
    const publishedWorkflowVersionIds = normalizeOptionalIdList(
      input.publishedWorkflowVersionIds ?? [],
    );
    const syncMode = normalizeKnowledgeSourceSyncMode(input.syncMode);
    const syncCadence = normalizeKnowledgeSourceSyncCadence(input.syncCadence, syncMode);
    const now = input.now ?? new Date().toISOString();
    let uri = normalizeOptionalId(input.uri);
    let importedProviderRecords: ProviderKnowledgeImportRecord[] = [];

    if (input.sourceType === "manual_text" && text.length === 0) {
      throw new BadRequestException("Knowledge source text is required.");
    }

    validateKnowledgeSourceInput(input);
    await this.assertProviderKnowledgeImportAuthorized({
      organizationId,
      input,
      workspaceId,
      workflowIds,
    });
    if (input.sourceType === "provider_import" && text.length === 0) {
      const importedContent = await this.resolveProviderKnowledgeSourceContent(organizationId, {
        providerId: input.providerId,
        connectionId: input.integrationConnectionId,
        externalId: input.externalId,
      });
      text = importedContent.text;
      uri = uri ?? importedContent.uri;
      importedProviderRecords = importedContent.records;
    }
    const crawlResult =
      input.sourceType === "website_crawl"
        ? await crawlWebsiteKnowledgeSource({
            rootUrl: uri,
            crawlLimit: input.crawlLimit,
            excludePaths: input.excludePaths,
          })
        : undefined;
    const extractedPages = crawlResult?.pages.filter(isSuccessfulCrawledPage) ?? [];
    if (crawlResult !== undefined) {
      text = extractedPages
        .map((page) => `${page.title ?? page.url}\n${page.text}`)
        .join("\n\n")
        .trim();
    }

    const state = await this.getOrCreateState(organizationId);
    const source: KnowledgeSourceSnapshotResponse = {
      id: `knowledge_source_${randomUUID()}`,
      organizationId,
      sourceType: input.sourceType,
      syncMode,
      syncCadence,
      title,
      textPreview: buildTextPreview(text),
      contentHash: hashKnowledgeSourceText(text),
      workspaceId,
      workflowIds,
      publishedWorkflowVersionIds,
      ...(uri !== undefined ? { uri } : {}),
      ...(normalizeOptionalId(input.providerId) !== undefined
        ? { providerId: normalizeOptionalId(input.providerId) }
        : {}),
      ...(normalizeOptionalId(input.integrationConnectionId) !== undefined
        ? { integrationConnectionId: normalizeOptionalId(input.integrationConnectionId) }
        : {}),
      ...(normalizeOptionalId(input.externalId) !== undefined
        ? { externalId: normalizeOptionalId(input.externalId) }
        : {}),
      ...(normalizeOptionalId(input.contentType) !== undefined
        ? { contentType: normalizeOptionalId(input.contentType) }
        : {}),
      ...(crawlResult === undefined
        ? {}
        : {
            crawl: {
              rootUrl: crawlResult.rootUrl,
              crawlLimit: crawlResult.crawlLimit,
              excludePaths: [...crawlResult.excludePaths],
              pages: crawlResult.pages.map(cloneWebsiteCrawlPageSnapshot),
            },
          }),
      status: text.length === 0 ? "failed" : input.sourceType === "manual_text" ? "activated" : "review_required",
      syncStatus: text.length === 0 ? "failed" : input.sourceType === "manual_text" ? "synced" : "review_required",
      lastSyncedAt: now,
      ...(buildNextKnowledgeSyncAt(now, syncMode, syncCadence) === undefined
        ? {}
        : { nextSyncAt: buildNextKnowledgeSyncAt(now, syncMode, syncCadence) }),
      extractedRecordCount:
        crawlResult !== undefined
          ? extractedPages.length
          : importedProviderRecords.length > 0
            ? importedProviderRecords.length
            : text.length === 0
              ? 0
              : 1,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    };

    state.knowledgeSources = [source, ...state.knowledgeSources];

    if (text.length === 0) {
      await this.persistState(state);

      return {
        source: cloneKnowledgeSource(source),
        knowledge: [],
        reviewDrafts: [],
      };
    }

    if (input.sourceType === "manual_text") {
      const recordType = input.recordType;

      if (recordType === undefined) {
        throw new BadRequestException("Manual knowledge sources require a record type.");
      }

      const knowledge = createKnowledgeRecordFromSource({
        organizationId,
        actorUserId,
        source,
        title,
        text,
        kind: recordType,
        now,
      });
      state.knowledge = [knowledge, ...state.knowledge];
      await this.persistState(state);

      return {
        source: cloneKnowledgeSource(source),
        knowledge: [cloneKnowledge(knowledge)],
        reviewDrafts: [],
      };
    }

    const reviewDrafts =
      importedProviderRecords.length > 0
        ? importedProviderRecords.map((record) =>
            createKnowledgeReviewDraft({
              organizationId,
              actorUserId,
              source,
              changeType: "new",
              title: record.title,
              text: record.text,
              sourceUri: record.uri,
              workspaceId,
              workflowIds,
              publishedWorkflowVersionIds,
              now,
            }),
          )
        : crawlResult === undefined
        ? [
            createKnowledgeReviewDraft({
              organizationId,
              actorUserId,
              source,
              changeType: "new",
              title,
              text,
              workspaceId,
              workflowIds,
              publishedWorkflowVersionIds,
              now,
            }),
          ]
        : extractedPages.map((page) =>
            createKnowledgeReviewDraft({
              organizationId,
              actorUserId,
              source,
              changeType: "new",
              title: page.title ?? page.url,
              text: page.text,
              sourceUri: page.url,
              workspaceId,
              workflowIds,
              publishedWorkflowVersionIds,
              now,
            }),
          );

    state.knowledgeReviewDrafts = [...reviewDrafts, ...state.knowledgeReviewDrafts];
    await this.persistState(state);

    return {
      source: cloneKnowledgeSource(source),
      knowledge: [],
      reviewDrafts: reviewDrafts.map(cloneKnowledgeReviewDraft),
    };
  }

  async approveKnowledgeReviewDraft(
    organizationId: string,
    draftId: string,
    input: ApproveKnowledgeReviewDraftRequest,
  ): Promise<{ reviewDraft: KnowledgeReviewDraftResponse; knowledge: TenantKnowledgeRecordResponse }> {
    const approverUserId = normalizeRequiredId(input.approverUserId, "Approver user ID");
    const now = input.now ?? new Date().toISOString();
    const state = await this.getOrCreateState(organizationId);
    const draft = findKnowledgeReviewDraft(state, draftId);
    const source = state.knowledgeSources.find((candidate) => candidate.id === draft.sourceSnapshotId);

    if (source === undefined) {
      throw new BadRequestException("Knowledge source snapshot was not found.");
    }

    if (draft.status !== "draft") {
      throw new BadRequestException("Knowledge review draft is not pending review.");
    }

    const recordType = input.recordType ?? draft.suggestedKind;
    const requiresHighRiskConfirmation = isHighRiskKnowledgeKind(recordType);

    if ((draft.activationBlockers ?? []).length > 0) {
      throw new BadRequestException("Knowledge review draft contains credentials or secrets and cannot be activated.");
    }

    if (requiresHighRiskConfirmation && input.confirmHighRiskKind !== true) {
      throw new BadRequestException("High-risk knowledge record type must be explicitly confirmed.");
    }

    const approvalMetadata = requireKnowledgeApprovalAuthority(draft, input, recordType);

    const text = input.text?.trim() ?? draft.text;
    if (text.length === 0) {
      throw new BadRequestException("Knowledge review draft text is required.");
    }

    const beforeState = {
      status: draft.status,
      kindConfirmed: draft.kindConfirmed,
      approvedKnowledgeRecordId: draft.approvedKnowledgeRecordId,
    };
    const currentKnowledge =
      draft.currentKnowledgeRecordId === undefined
        ? undefined
        : state.knowledge.find((candidate) => candidate.id === draft.currentKnowledgeRecordId);
    let knowledge: TenantKnowledgeRecordResponse;

    if (draft.changeType === "deletion") {
      if (currentKnowledge === undefined || currentKnowledge.status !== "active") {
        throw new BadRequestException("Deletion review draft no longer has an active knowledge record.");
      }

      currentKnowledge.status = "stale";
      currentKnowledge.staleAt = now;
      currentKnowledge.updatedAt = now;
      knowledge = currentKnowledge;
    } else {
      knowledge = createKnowledgeRecordFromSource({
        organizationId,
        actorUserId: approverUserId,
        source,
        title: draft.title,
        text,
        kind: recordType,
        sourceUri: draft.sourceUri,
        sensitivityLabels: draft.sensitivityLabels ?? [],
        now,
      });
      state.knowledge = [knowledge, ...state.knowledge];

      if (draft.changeType === "update" && currentKnowledge?.status === "active") {
        currentKnowledge.status = "stale";
        currentKnowledge.staleAt = now;
        currentKnowledge.updatedAt = now;
      }
    }

    source.status = "activated";
    source.syncStatus = "synced";
    delete source.degradedReason;
    delete source.refreshPausedAt;
    draft.status = "approved";
    draft.kindConfirmed = requiresHighRiskConfirmation || input.recordType !== undefined;
    draft.approvedKnowledgeRecordId = knowledge.id;
    draft.updatedAt = now;
    draft.auditTrail = [
      ...draft.auditTrail,
      {
        action: "approved",
        actorUserId: approverUserId,
        at: now,
        ...(approvalMetadata === undefined
          ? {}
          : {
              actorRole: approvalMetadata.actorRole,
              workspaceId: approvalMetadata.workspaceId,
              reason: approvalMetadata.reason,
              beforeState,
              afterState: {
                status: draft.status,
                kindConfirmed: draft.kindConfirmed,
                approvedKnowledgeRecordId: draft.approvedKnowledgeRecordId,
              },
            }),
      },
    ];
    await this.persistState(state);

    return {
      reviewDraft: cloneKnowledgeReviewDraft(draft),
      knowledge: cloneKnowledge(knowledge),
    };
  }

  async refreshKnowledgeSource(
    organizationId: string,
    sourceId: string,
    input: RefreshKnowledgeSourceRequest,
  ): Promise<{
    source: KnowledgeSourceSnapshotResponse;
    knowledge: TenantKnowledgeRecordResponse[];
    reviewDrafts: KnowledgeReviewDraftResponse[];
  }> {
    const actorUserId = normalizeRequiredId(input.actorUserId, "Actor user ID");
    const normalizedSourceId = normalizeRequiredId(sourceId, "Knowledge source ID");
    const now = input.now ?? new Date().toISOString();
    const state = await this.getOrCreateState(organizationId);
    const source = state.knowledgeSources.find((candidate) => candidate.id === normalizedSourceId);

    if (source === undefined) {
      throw new NotFoundException("Knowledge source was not found.");
    }

    if (source.syncMode !== "recurring") {
      throw new BadRequestException("Only recurring knowledge sources can be refreshed.");
    }

    if (input.trigger === "daily" && source.syncCadence !== "daily") {
      throw new BadRequestException("Daily sync is not enabled for this knowledge source.");
    }

    if (input.providerFailure !== undefined) {
      if (source.sourceType !== "provider_import") {
        throw new BadRequestException("Provider sync failures can only be recorded for provider sources.");
      }

      source.syncStatus = "degraded";
      source.degradedReason = input.providerFailure;
      source.refreshPausedAt = now;
      source.lastSyncedAt = now;
      delete source.nextSyncAt;
      source.updatedAt = now;
      await this.persistState(state);

      return {
        source: cloneKnowledgeSource(source),
        knowledge: [],
        reviewDrafts: [],
      };
    }

    if (input.sourceDeleted === true) {
      if (input.deletionConfirmed !== true) {
        throw new BadRequestException("Source deletion must be confirmed before creating a deletion draft.");
      }

      const currentKnowledge = findLatestActiveKnowledgeForSource(state, source.id);
      if (currentKnowledge === undefined) {
        throw new BadRequestException("Deleted knowledge source has no active knowledge record to review.");
      }

      source.lastSyncedAt = now;
      source.nextSyncAt = buildNextKnowledgeSyncAt(now, source.syncMode, source.syncCadence);
      source.status = "review_required";
      source.syncStatus = "review_required";
      source.extractedRecordCount = 0;
      source.updatedAt = now;

      const draft: KnowledgeReviewDraftResponse = {
        id: `knowledge_review_draft_${randomUUID()}`,
        organizationId,
        sourceSnapshotId: source.id,
        changeType: "deletion",
        currentKnowledgeRecordId: currentKnowledge.id,
        ...(currentKnowledge.source.uri !== undefined ? { sourceUri: currentKnowledge.source.uri } : {}),
        title: source.title,
        text: currentKnowledge.text,
        suggestedKind: currentKnowledge.kind,
        kindConfirmed: false,
        requiresKindConfirmation: isHighRiskKnowledgeKind(currentKnowledge.kind),
        workspaceId: source.workspaceId,
        workflowIds: [...source.workflowIds],
        publishedWorkflowVersionIds: [...source.publishedWorkflowVersionIds],
        status: "draft",
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        auditTrail: [
          {
            action: "draft_created",
            actorUserId,
            at: now,
          },
        ],
      };

      state.knowledgeReviewDrafts = [draft, ...state.knowledgeReviewDrafts];
      await this.persistState(state);

      return {
        source: cloneKnowledgeSource(source),
        knowledge: [],
        reviewDrafts: [cloneKnowledgeReviewDraft(draft)],
      };
    }

    if (source.sourceType === "website_crawl") {
      const crawlResult = await crawlWebsiteKnowledgeSource({
        rootUrl: source.uri,
        crawlLimit: source.crawl?.crawlLimit,
        excludePaths: source.crawl?.excludePaths,
      });
      const extractedPages = crawlResult.pages.filter(isSuccessfulCrawledPage);
      const aggregateText = extractedPages
        .map((page) => `${page.title ?? page.url}\n${page.text}`)
        .join("\n\n")
        .trim();
      const contentHash = hashKnowledgeSourceText(aggregateText);
      const currentKnowledge = findActiveKnowledgeForSource(state, source.id);
      const currentKnowledgeByUri = new Map(
        currentKnowledge
          .filter((knowledge) => knowledge.source.uri !== undefined)
          .map((knowledge) => [knowledge.source.uri!, knowledge]),
      );
      const nextPageUrls = new Set(extractedPages.map((page) => page.url));
      const reviewDrafts: KnowledgeReviewDraftResponse[] = [];

      for (const page of extractedPages) {
        const existingKnowledge = currentKnowledgeByUri.get(page.url);
        if (existingKnowledge === undefined) {
          reviewDrafts.push(
            createKnowledgeReviewDraft({
              organizationId,
              actorUserId,
              source,
              changeType: "new",
              title: page.title ?? page.url,
              text: page.text,
              sourceUri: page.url,
              workspaceId: source.workspaceId,
              workflowIds: source.workflowIds,
              publishedWorkflowVersionIds: source.publishedWorkflowVersionIds,
              now,
            }),
          );
          continue;
        }

        if (hashKnowledgeSourceText(page.text) !== hashKnowledgeSourceText(existingKnowledge.text)) {
          reviewDrafts.push(
            createKnowledgeReviewDraft({
              organizationId,
              actorUserId,
              source,
              changeType: "update",
              currentKnowledgeRecordId: existingKnowledge.id,
              title: page.title ?? existingKnowledge.title,
              text: page.text,
              suggestedKind: existingKnowledge.kind,
              sourceUri: page.url,
              workspaceId: source.workspaceId,
              workflowIds: source.workflowIds,
              publishedWorkflowVersionIds: source.publishedWorkflowVersionIds,
              now,
            }),
          );
        }
      }

      for (const existingKnowledge of currentKnowledge) {
        const sourceUri = existingKnowledge.source.uri;
        if (sourceUri !== undefined && !nextPageUrls.has(sourceUri)) {
          reviewDrafts.push(
            createKnowledgeReviewDraft({
              organizationId,
              actorUserId,
              source,
              changeType: "deletion",
              currentKnowledgeRecordId: existingKnowledge.id,
              title: existingKnowledge.title,
              text: existingKnowledge.text,
              suggestedKind: existingKnowledge.kind,
              sourceUri,
              workspaceId: source.workspaceId,
              workflowIds: source.workflowIds,
              publishedWorkflowVersionIds: source.publishedWorkflowVersionIds,
              now,
            }),
          );
        }
      }

      source.textPreview = buildTextPreview(aggregateText);
      source.contentHash = contentHash;
      source.crawl = {
        rootUrl: crawlResult.rootUrl,
        crawlLimit: crawlResult.crawlLimit,
        excludePaths: [...crawlResult.excludePaths],
        pages: crawlResult.pages.map(cloneWebsiteCrawlPageSnapshot),
      };
      source.lastSyncedAt = now;
      source.nextSyncAt = buildNextKnowledgeSyncAt(now, source.syncMode, source.syncCadence);
      source.status = reviewDrafts.length === 0 ? source.status : "review_required";
      source.syncStatus = reviewDrafts.length === 0 ? "synced" : "review_required";
      source.extractedRecordCount = extractedPages.length;
      source.updatedAt = now;

      if (reviewDrafts.length > 0) {
        state.knowledgeReviewDrafts = [...reviewDrafts, ...state.knowledgeReviewDrafts];
      }
      await this.persistState(state);

      return {
        source: cloneKnowledgeSource(source),
        knowledge: [],
        reviewDrafts: reviewDrafts.map(cloneKnowledgeReviewDraft),
      };
    }

    let text = input.text?.trim() ?? "";
    let importedProviderRecords: ProviderKnowledgeImportRecord[] = [];
    let providerImportResolved = false;
    if (text.length === 0 && source.sourceType === "provider_import") {
      const importedContent = await this.resolveProviderKnowledgeSourceContentForRefresh({
        organizationId,
        source,
        now,
        state,
      });
      if (importedContent === undefined) {
        return {
          source: cloneKnowledgeSource(source),
          knowledge: [],
          reviewDrafts: [],
        };
      }
      text = importedContent.text;
      importedProviderRecords = importedContent.records;
      providerImportResolved = true;
    }

    const contentHash = hashKnowledgeSourceText(text);
    source.lastSyncedAt = now;
    source.nextSyncAt = buildNextKnowledgeSyncAt(now, source.syncMode, source.syncCadence);

    if (source.sourceType === "provider_import" && providerImportResolved) {
      const currentKnowledge = findActiveKnowledgeForSource(state, source.id);
      const currentKnowledgeByUri = new Map(
        currentKnowledge
          .filter((knowledge) => knowledge.source.uri !== undefined)
          .map((knowledge) => [knowledge.source.uri!, knowledge]),
      );
      const nextUris = new Set(importedProviderRecords.map((record) => record.uri).filter((value): value is string => value !== undefined));
      const reviewDrafts: KnowledgeReviewDraftResponse[] = [];

      for (const record of importedProviderRecords) {
        const existingKnowledge = record.uri === undefined ? undefined : currentKnowledgeByUri.get(record.uri);
        if (existingKnowledge === undefined) {
          reviewDrafts.push(
            createKnowledgeReviewDraft({
              organizationId,
              actorUserId,
              source,
              changeType: "new",
              title: record.title,
              text: record.text,
              sourceUri: record.uri,
              workspaceId: source.workspaceId,
              workflowIds: source.workflowIds,
              publishedWorkflowVersionIds: source.publishedWorkflowVersionIds,
              now,
            }),
          );
          continue;
        }

        if (hashKnowledgeSourceText(record.text) !== hashKnowledgeSourceText(existingKnowledge.text)) {
          reviewDrafts.push(
            createKnowledgeReviewDraft({
              organizationId,
              actorUserId,
              source,
              changeType: "update",
              currentKnowledgeRecordId: existingKnowledge.id,
              title: record.title,
              text: record.text,
              suggestedKind: existingKnowledge.kind,
              sourceUri: record.uri,
              workspaceId: source.workspaceId,
              workflowIds: source.workflowIds,
              publishedWorkflowVersionIds: source.publishedWorkflowVersionIds,
              now,
            }),
          );
        }
      }

      for (const existingKnowledge of currentKnowledge) {
        const sourceUri = existingKnowledge.source.uri;
        if (sourceUri !== undefined && !nextUris.has(sourceUri)) {
          reviewDrafts.push(
            createKnowledgeReviewDraft({
              organizationId,
              actorUserId,
              source,
              changeType: "deletion",
              currentKnowledgeRecordId: existingKnowledge.id,
              title: existingKnowledge.title,
              text: existingKnowledge.text,
              suggestedKind: existingKnowledge.kind,
              sourceUri,
              workspaceId: source.workspaceId,
              workflowIds: source.workflowIds,
              publishedWorkflowVersionIds: source.publishedWorkflowVersionIds,
              now,
            }),
          );
        }
      }

      source.textPreview = buildTextPreview(text);
      source.contentHash = contentHash;
      source.status = reviewDrafts.length === 0 ? source.status : "review_required";
      source.syncStatus = reviewDrafts.length === 0 ? "synced" : "review_required";
      source.extractedRecordCount = importedProviderRecords.length;
      source.updatedAt = now;

      if (reviewDrafts.length > 0) {
        state.knowledgeReviewDrafts = [...reviewDrafts, ...state.knowledgeReviewDrafts];
      }
      await this.persistState(state);

      return {
        source: cloneKnowledgeSource(source),
        knowledge: [],
        reviewDrafts: reviewDrafts.map(cloneKnowledgeReviewDraft),
      };
    }

    if (text.length === 0) {
      throw new BadRequestException("Knowledge source refresh text is required.");
    }

    if (contentHash === source.contentHash) {
      source.syncStatus = "synced";
      source.updatedAt = now;
      await this.persistState(state);

      return {
        source: cloneKnowledgeSource(source),
        knowledge: [],
        reviewDrafts: [],
      };
    }

    const currentKnowledge = findLatestActiveKnowledgeForSource(state, source.id);
    const suggestedKind = currentKnowledge?.kind ?? suggestKnowledgeKind(source.title, text);
    const classification = classifyKnowledgeText({ text });
    const draft: KnowledgeReviewDraftResponse = {
      id: `knowledge_review_draft_${randomUUID()}`,
      organizationId,
      sourceSnapshotId: source.id,
      changeType: "update",
      ...(currentKnowledge === undefined ? {} : { currentKnowledgeRecordId: currentKnowledge.id }),
      title: source.title,
      text,
      suggestedKind,
      sensitivityLabels: classification.labels,
      activationBlockers: classification.activationBlockers,
      kindConfirmed: false,
      requiresKindConfirmation: isHighRiskKnowledgeKind(suggestedKind),
      workspaceId: source.workspaceId,
      workflowIds: [...source.workflowIds],
      publishedWorkflowVersionIds: [...source.publishedWorkflowVersionIds],
      status: "draft",
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
      auditTrail: [
        {
          action: "draft_created",
          actorUserId,
          at: now,
        },
      ],
    };

    source.textPreview = buildTextPreview(text);
    source.contentHash = contentHash;
    source.status = "review_required";
    source.syncStatus = "review_required";
    source.extractedRecordCount = 1;
    source.updatedAt = now;
    state.knowledgeReviewDrafts = [draft, ...state.knowledgeReviewDrafts];
    await this.persistState(state);

    return {
      source: cloneKnowledgeSource(source),
      knowledge: [],
      reviewDrafts: [cloneKnowledgeReviewDraft(draft)],
    };
  }

  private async assertProviderKnowledgeImportAuthorized(input: {
    organizationId: string;
    input: CreateKnowledgeSourceRequest;
    workspaceId: string;
    workflowIds: string[];
  }) {
    if (input.input.sourceType !== "provider_import") {
      return;
    }

    if (this.integrationsService === undefined || this.toolPermissionGrantsService === undefined) {
      throw new BadRequestException("Provider knowledge imports require integration authorization.");
    }

    const providerId = normalizeRequiredId(input.input.providerId, "Knowledge source provider");
    const connectionId = normalizeRequiredId(input.input.integrationConnectionId, "Integration connection ID");
    const connections = await this.integrationsService.listConnections(input.organizationId, {
      workspaceId: input.workspaceId,
    });
    const connection = connections.find((candidate) => candidate.id === connectionId);

    if (connection === undefined) {
      throw new BadRequestException("Integration connection is not available to this workspace.");
    }

    if (connection.status === "revoked") {
      throw new BadRequestException("Integration connection has been revoked.");
    }

    if (connection.provider !== providerId) {
      throw new BadRequestException("Integration connection provider does not match the knowledge source provider.");
    }

    const grants = await this.toolPermissionGrantsService.listToolPermissionGrants({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
    });
    const matchingGrants = grants.filter(
      (grant) =>
        grant.status === "active"
        && grant.capability === "knowledge-source"
        && grant.integrationConnectionId === connectionId,
    );

    if (input.workflowIds.length === 0) {
      if (matchingGrants.length === 0) {
        throw new BadRequestException("Provider knowledge import requires an active knowledge-source grant.");
      }

      return;
    }

    const missingWorkflowIds = input.workflowIds.filter(
      (workflowId) => !matchingGrants.some((grant) => grant.workflowId === workflowId),
    );

    if (missingWorkflowIds.length > 0) {
      throw new BadRequestException(
        `Provider knowledge import requires an active knowledge-source grant for workflow: ${missingWorkflowIds.join(", ")}`,
      );
    }
  }

  private async resolveProviderKnowledgeSourceContent(
    organizationId: string,
    input: {
      providerId?: string | undefined;
      connectionId?: string | undefined;
      externalId?: string | undefined;
      allowEmpty?: boolean | undefined;
    },
  ) {
    const providerId = normalizeRequiredId(input.providerId, "Knowledge source provider");
    const connectionId = normalizeRequiredId(input.connectionId, "Integration connection ID");
    const externalId = normalizeRequiredId(input.externalId, "Provider source ID");

    if (this.connectorToolsService === undefined) {
      throw new BadRequestException("Provider knowledge imports require connector execution.");
    }

    const providerTool = getProviderKnowledgeImportTool(providerId);
    if (providerTool === undefined) {
      return {
        text: "",
        records: [],
      };
    }

    const result = await this.connectorToolsService.executeTool(
      organizationId,
      providerTool.provider,
      providerTool.toolId,
      {
        connectionId,
        input: providerTool.input(externalId),
      },
    );
    const records = readProviderKnowledgeImportRecords(result);

    if (records.length === 0 && input.allowEmpty !== true) {
      throw new BadRequestException("Provider knowledge source did not return usable article text.");
    }

    return {
      text: records.map((record) => record.text).join("\n\n").trim(),
      ...(records.length === 1 && records[0]?.uri !== undefined ? { uri: records[0].uri } : {}),
      records,
    };
  }

  private async resolveProviderKnowledgeSourceContentForRefresh(input: {
    organizationId: string;
    source: KnowledgeSourceSnapshotResponse;
    now: string;
    state: PersistedMemoryStateRecord;
  }) {
    try {
      return await this.resolveProviderKnowledgeSourceContent(input.organizationId, {
        providerId: input.source.providerId,
        connectionId: input.source.integrationConnectionId,
        externalId: input.source.externalId,
        allowEmpty: true,
      });
    } catch (error) {
      const providerFailure = classifyProviderKnowledgeRefreshFailure(error);
      if (providerFailure === undefined) {
        throw error;
      }

      input.source.syncStatus = "degraded";
      input.source.degradedReason = providerFailure;
      input.source.refreshPausedAt = input.now;
      input.source.lastSyncedAt = input.now;
      input.source.updatedAt = input.now;
      delete input.source.nextSyncAt;
      await this.persistState(input.state);

      return undefined;
    }
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
    workspaceId?: string | undefined;
    workflowId?: string | undefined;
    now?: string | undefined;
  }): Promise<TenantKnowledgeRecordResponse[]> {
    const publishedWorkflowVersionId = normalizeOptionalId(input.publishedWorkflowVersionId);
    const workspaceId = normalizeOptionalId(input.workspaceId);
    const workflowId = normalizeOptionalId(input.workflowId);
    const now = input.now ?? new Date().toISOString();

    if (publishedWorkflowVersionId === undefined && workspaceId === undefined) {
      return [];
    }

    const state = await this.getOrCreateState(input.organizationId);

    const activeKnowledge = state.knowledge
      .filter((knowledge) =>
        input.now === undefined
          ? knowledge.status === "active" && !isStaleAt(knowledge.staleAt, now)
          : isKnowledgeVisibleAt(knowledge, now),
      )
      .filter((knowledge) => knowledgeMatchesRuntimeKnowledgeScope(knowledge, {
        publishedWorkflowVersionId,
        workspaceId,
        workflowId,
      }));
    const conflictingKeys = findConflictingKnowledgeKeys(activeKnowledge);

    return activeKnowledge.map((knowledge) => ({
      ...cloneKnowledge(knowledge),
      conflictState: conflictingKeys.has(getKnowledgeConflictKey(knowledge))
        ? "conflicting"
        : "none",
    }));
  }

  async validateKnowledgeConflictsForPublish(input: {
    organizationId: string;
    workspaceId: string;
    workflowId: string;
    now?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const now = input.now ?? new Date().toISOString();
    const activeKnowledge = state.knowledge
      .filter((knowledge) => knowledge.status === "active")
      .filter((knowledge) => !isStaleAt(knowledge.staleAt, now))
      .filter((knowledge) =>
        knowledgeMatchesRuntimeKnowledgeScope(knowledge, {
          workspaceId: input.workspaceId,
          workflowId: input.workflowId,
        }),
      );

    return evaluateKnowledgeConflicts({
      records: activeKnowledge.map((knowledge) => ({
        id: knowledge.id,
        kind: knowledge.kind,
        title: knowledge.title,
        text: knowledge.text,
        sourcePriority: getKnowledgeSourcePriority(knowledge.source.kind),
        conflictStatus: "unresolved",
      })),
    });
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
        knowledgeSources: [],
        knowledgeReviewDrafts: [],
      };

    nextState.knowledge ??= [];
    nextState.knowledgeSources ??= [];
    nextState.knowledgeReviewDrafts ??= [];
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
      knowledgeSources: state.knowledgeSources.map(cloneKnowledgeSource),
      knowledgeReviewDrafts: state.knowledgeReviewDrafts.map(cloneKnowledgeReviewDraft),
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

interface ProviderKnowledgeImportRecord {
  title: string;
  text: string;
  uri?: string | undefined;
}

function getProviderKnowledgeImportTool(providerId: string) {
  switch (providerId) {
    case "intercom":
      return {
        provider: "intercom" as const,
        toolId: "intercom.articles.import",
        input: (externalId: string) => ({ articleId: externalId }),
      };
    case "confluence":
      return {
        provider: "confluence" as const,
        toolId: "confluence.pages.import",
        input: (externalId: string) => ({ selectionId: externalId }),
      };
    case "sharepoint":
      return {
        provider: "sharepoint" as const,
        toolId: "sharepoint.items.import",
        input: (externalId: string) => ({ selectionId: externalId }),
      };
    case "freshdesk":
      return {
        provider: "freshdesk" as const,
        toolId: "freshdesk.solutions.import",
        input: (externalId: string) => ({ selectionId: externalId }),
      };
    case "salesforce-knowledge":
      return {
        provider: "salesforce-knowledge" as const,
        toolId: "salesforce-knowledge.articles.import",
        input: (externalId: string) => ({ selectionId: externalId }),
      };
    default:
      return undefined;
  }
}

function classifyProviderKnowledgeRefreshFailure(error: unknown) {
  if (!(error instanceof HttpException)) {
    return undefined;
  }

  const status = error.getStatus();
  if (status === 401) {
    return "auth_revoked" as const;
  }

  if (status === 403) {
    return "permission_denied" as const;
  }

  return undefined;
}

function readProviderKnowledgeImportRecords(result: unknown): ProviderKnowledgeImportRecord[] {
  if (result === null || typeof result !== "object") {
    throw new BadRequestException("Provider knowledge source did not return article content.");
  }

  const rawArticles = Array.isArray((result as { articles?: unknown }).articles)
    ? (result as { articles: unknown[] }).articles
    : (result as { article?: unknown }).article === undefined
      ? []
      : [(result as { article?: unknown }).article];

  const records = rawArticles
    .filter((article): article is Record<string, unknown> => article !== null && typeof article === "object")
    .map(normalizeProviderKnowledgeImportRecord)
    .filter((article): article is ProviderKnowledgeImportRecord => article !== undefined);

  return records;
}

function normalizeProviderKnowledgeImportRecord(
  article: Record<string, unknown>,
): ProviderKnowledgeImportRecord | undefined {
  const text = article.text;
  const title = article.title;
  const uri = article.uri;
  const normalizedText = typeof text === "string" ? text.trim() : "";

  if (normalizedText.length === 0) {
    return undefined;
  }

  return {
    title: typeof title === "string" && title.trim().length > 0 ? title.trim() : "Imported provider knowledge",
    text: normalizedText,
    ...(typeof uri === "string" && uri.trim().length > 0 ? { uri: uri.trim() } : {}),
  };
}

function normalizeKnowledgeSourceSyncMode(value: KnowledgeSourceSyncMode | undefined) {
  return value ?? "snapshot";
}

function normalizeKnowledgeSourceSyncCadence(
  value: KnowledgeSourceSyncCadence | undefined,
  syncMode: KnowledgeSourceSyncMode,
) {
  const syncCadence = value ?? (syncMode === "recurring" ? "daily" : "manual");

  if (syncMode === "snapshot" && syncCadence === "daily") {
    throw new BadRequestException("Snapshot knowledge sources cannot use daily sync.");
  }

  return syncCadence;
}

function buildNextKnowledgeSyncAt(
  now: string,
  syncMode: KnowledgeSourceSyncMode | undefined,
  syncCadence: KnowledgeSourceSyncCadence | undefined,
) {
  if (syncMode !== "recurring" || syncCadence !== "daily") {
    return undefined;
  }

  const nowTime = Date.parse(now);
  if (!Number.isFinite(nowTime)) {
    return undefined;
  }

  return new Date(nowTime + 24 * 60 * 60 * 1_000).toISOString();
}

function normalizeOptionalIdList(values: string[]) {
  return [...new Set(values.map(normalizeOptionalId))]
    .filter((value): value is string => value !== undefined);
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

function findKnowledgeReviewDraft(state: PersistedMemoryStateRecord, draftId: string) {
  const normalizedDraftId = normalizeRequiredId(draftId, "Knowledge review draft ID");
  const draft = state.knowledgeReviewDrafts.find((candidate) => candidate.id === normalizedDraftId);

  if (draft === undefined) {
    throw new NotFoundException("Knowledge review draft was not found.");
  }

  return draft;
}

function findLatestActiveKnowledgeForSource(state: PersistedMemoryStateRecord, sourceSnapshotId: string) {
  return findActiveKnowledgeForSource(state, sourceSnapshotId)[0];
}

function findActiveKnowledgeForSource(state: PersistedMemoryStateRecord, sourceSnapshotId: string) {
  return state.knowledge.filter(
    (candidate) =>
      candidate.status === "active" && candidate.source.sourceSnapshotId === sourceSnapshotId,
  );
}

function requireKnowledgeApprovalAuthority(
  draft: KnowledgeReviewDraftResponse,
  input: ApproveKnowledgeReviewDraftRequest,
  recordType: TenantKnowledgeKind,
) {
  const requiresPrivilegedApproval =
    isHighRiskKnowledgeKind(recordType) ||
    (draft.sensitivityLabels ?? []).length > 0 ||
    draft.changeType === "deletion";

  if (!requiresPrivilegedApproval) {
    return undefined;
  }

  if (input.approverRole !== "owner" && input.approverRole !== "admin") {
    throw new ForbiddenException("High-risk knowledge approval requires an owner or admin role.");
  }

  const workspaceId = normalizeRequiredId(input.workspaceId, "Approval workspace ID");
  if (workspaceId !== draft.workspaceId) {
    throw new BadRequestException("Approval workspace must match the knowledge draft workspace.");
  }

  const reason = normalizeRequiredId(input.reason, "Approval reason");

  return {
    actorRole: input.approverRole,
    workspaceId,
    reason,
  };
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

function validateKnowledgeSourceInput(input: CreateKnowledgeSourceRequest) {
  switch (input.sourceType) {
    case "manual_text":
      if (input.recordType === undefined) {
        throw new BadRequestException("Manual knowledge sources require a record type.");
      }
      return;
    case "single_url":
      normalizeRequiredId(input.uri, "Knowledge source URL");
      return;
    case "pdf":
      if (normalizeOptionalId(input.contentType) !== undefined && input.contentType !== "application/pdf") {
        throw new BadRequestException("PDF knowledge sources must use application/pdf content.");
      }
      return;
    case "provider_import":
      {
        const providerId = normalizeRequiredId(input.providerId, "Knowledge source provider");
        const provider = getIntegrationProviderCatalogEntry(providerId);

        if (provider?.knowledgeSource.supported !== true) {
          throw new BadRequestException("Provider does not support knowledge source imports.");
        }
      }
      normalizeRequiredId(input.integrationConnectionId, "Integration connection ID");
      normalizeRequiredId(input.externalId, "Provider source ID");
      return;
    case "website_crawl":
      normalizeWebsiteRootUrl(input.uri);
      normalizeCrawlLimit(input.crawlLimit);
      normalizeExcludePaths(input.excludePaths);
      return;
  }
}

function isSuccessfulCrawledPage(
  page: WebsiteCrawlPageSnapshot & { text?: string | undefined },
): page is WebsiteCrawlPageSnapshot & { text: string } {
  return page.status === "succeeded" && page.text !== undefined && page.text.length > 0;
}

function createKnowledgeReviewDraft(input: {
  organizationId: string;
  actorUserId: string;
  source: KnowledgeSourceSnapshotResponse;
  changeType: KnowledgeReviewDraftResponse["changeType"];
  currentKnowledgeRecordId?: string | undefined;
  title: string;
  text: string;
  suggestedKind?: TenantKnowledgeKind | undefined;
  sourceUri?: string | undefined;
  workspaceId: string;
  workflowIds: string[];
  publishedWorkflowVersionIds: string[];
  now: string;
}): KnowledgeReviewDraftResponse {
  const suggestedKind = input.suggestedKind ?? suggestKnowledgeKind(input.title, input.text);
  const classification = classifyKnowledgeText({ text: input.text });

  return {
    id: `knowledge_review_draft_${randomUUID()}`,
    organizationId: input.organizationId,
    sourceSnapshotId: input.source.id,
    changeType: input.changeType,
    ...(input.currentKnowledgeRecordId === undefined
      ? {}
      : { currentKnowledgeRecordId: input.currentKnowledgeRecordId }),
    ...(input.sourceUri === undefined ? {} : { sourceUri: input.sourceUri }),
    title: input.title,
    text: input.text,
    suggestedKind,
    sensitivityLabels: classification.labels,
    activationBlockers: classification.activationBlockers,
    kindConfirmed: false,
    requiresKindConfirmation: isHighRiskKnowledgeKind(suggestedKind),
    workspaceId: input.workspaceId,
    workflowIds: [...input.workflowIds],
    publishedWorkflowVersionIds: [...input.publishedWorkflowVersionIds],
    status: "draft",
    createdBy: input.actorUserId,
    createdAt: input.now,
    updatedAt: input.now,
    auditTrail: [
      {
        action: "draft_created",
        actorUserId: input.actorUserId,
        at: input.now,
      },
    ],
  };
}

async function crawlWebsiteKnowledgeSource(input: {
  rootUrl: string | undefined;
  crawlLimit: number | undefined;
  excludePaths: string[] | undefined;
}): Promise<{
  rootUrl: string;
  crawlLimit: number;
  excludePaths: string[];
  pages: Array<WebsiteCrawlPageSnapshot & { text?: string | undefined }>;
}> {
  const rootUrl = normalizeWebsiteRootUrl(input.rootUrl);
  const root = new URL(rootUrl);
  const crawlLimit = normalizeCrawlLimit(input.crawlLimit);
  const excludePaths = normalizeExcludePaths(input.excludePaths);
  const robotsDisallowPaths = await fetchRobotsDisallowPaths(root);
  const pages: Array<WebsiteCrawlPageSnapshot & { text?: string | undefined }> = [];
  const queuedUrls: Array<{ url: string; discoveredFrom?: string | undefined }> = [{ url: rootUrl }];
  const queuedUrlSet = new Set([rootUrl]);
  const processedUrlSet = new Set<string>();
  const successfulHashes = new Set<string>();
  let succeededCount = 0;

  while (queuedUrls.length > 0) {
    const queued = queuedUrls.shift()!;
    const normalizedUrl = normalizeWebsiteUrl(queued.url, rootUrl);

    if (normalizedUrl === undefined || processedUrlSet.has(normalizedUrl)) {
      continue;
    }

    processedUrlSet.add(normalizedUrl);
    const url = new URL(normalizedUrl);
    const basePage = {
      url: normalizedUrl,
      ...(queued.discoveredFrom === undefined ? {} : { discoveredFrom: queued.discoveredFrom }),
    };
    const boundaryFailure = getWebsiteCrawlBoundaryFailure({
      url,
      root,
      excludePaths,
      robotsDisallowPaths,
    });

    if (boundaryFailure !== undefined) {
      pages.push({ ...basePage, status: "skipped", failureCode: boundaryFailure });
      continue;
    }

    if (succeededCount >= crawlLimit) {
      pages.push({ ...basePage, status: "skipped", failureCode: "crawl_limit_reached" });
      continue;
    }

    try {
      const response = await fetch(normalizedUrl);
      const finalUrl = normalizeWebsiteUrl(response.url || normalizedUrl, rootUrl) ?? normalizedUrl;
      const contentType = response.headers.get("content-type") ?? "";

      if (response.status === 401 || response.status === 403) {
        pages.push({ ...basePage, finalUrl, status: "failed", failureCode: "auth_required" });
        continue;
      }

      if (!contentType.toLowerCase().includes("text/html")) {
        pages.push({ ...basePage, finalUrl, status: "failed", failureCode: "binary_content" });
        continue;
      }

      const html = await response.text();
      if (html.length > 250_000) {
        pages.push({ ...basePage, finalUrl, status: "failed", failureCode: "large_page" });
        continue;
      }

      const canonicalUrl = normalizeWebsiteUrl(extractCanonicalUrl(html) ?? finalUrl, rootUrl) ?? finalUrl;
      const canonical = new URL(canonicalUrl);
      const canonicalFailure = getWebsiteCrawlBoundaryFailure({
        url: canonical,
        root,
        excludePaths,
        robotsDisallowPaths,
      });
      if (canonicalFailure !== undefined) {
        pages.push({ ...basePage, finalUrl: canonicalUrl, status: "skipped", failureCode: canonicalFailure });
        continue;
      }

      if (canonicalUrl !== normalizedUrl && processedUrlSet.has(canonicalUrl)) {
        pages.push({ ...basePage, finalUrl: canonicalUrl, status: "skipped", failureCode: "duplicate" });
        continue;
      }
      processedUrlSet.add(canonicalUrl);

      const title = extractHtmlTitle(html) ?? canonicalUrl;
      const bodyText = normalizeReadableHtmlText(html);
      if (bodyText.length === 0) {
        pages.push({ ...basePage, finalUrl: canonicalUrl, title, status: "failed", failureCode: "empty_page" });
        continue;
      }

      const text = `${title} ${bodyText}`.replace(/\s+/g, " ").trim();
      const contentHash = hashKnowledgeSourceText(text);
      if (successfulHashes.has(contentHash)) {
        pages.push({ ...basePage, finalUrl: canonicalUrl, title, status: "skipped", failureCode: "duplicate" });
        continue;
      }
      successfulHashes.add(contentHash);
      succeededCount += 1;
      pages.push({
        ...basePage,
        url: canonicalUrl,
        finalUrl: canonicalUrl,
        title,
        status: "succeeded",
        contentHash,
        textPreview: buildTextPreview(text),
        text,
      });

      for (const href of extractAnchorHrefs(html)) {
        const nextUrl = normalizeWebsiteUrl(href, canonicalUrl);
        if (nextUrl !== undefined && !queuedUrlSet.has(nextUrl) && !processedUrlSet.has(nextUrl)) {
          queuedUrlSet.add(nextUrl);
          queuedUrls.push({ url: nextUrl, discoveredFrom: canonicalUrl });
        }
      }
    } catch {
      pages.push({ ...basePage, status: "failed", failureCode: "fetch_failed" });
    }
  }

  return {
    rootUrl,
    crawlLimit,
    excludePaths,
    pages,
  };
}

async function fetchRobotsDisallowPaths(root: URL) {
  try {
    const robotsUrl = `${root.origin}/robots.txt`;
    const response = await fetch(robotsUrl);
    if (response.status >= 400) {
      return [];
    }

    return parseRobotsDisallowPaths(await response.text());
  } catch {
    return [];
  }
}

function parseRobotsDisallowPaths(text: string) {
  const disallowPaths: string[] = [];
  let appliesToAllAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]!.trim();
    if (line.length === 0) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (key === "user-agent") {
      appliesToAllAgents = value === "*";
    }
    if (key === "disallow" && appliesToAllAgents && value.length > 0) {
      disallowPaths.push(value.startsWith("/") ? value : `/${value}`);
    }
  }

  return disallowPaths;
}

function getWebsiteCrawlBoundaryFailure(input: {
  url: URL;
  root: URL;
  excludePaths: string[];
  robotsDisallowPaths: string[];
}): WebsiteCrawlPageSnapshot["failureCode"] | undefined {
  if (input.url.origin !== input.root.origin || !isPathInsideRoot(input.url.pathname, input.root.pathname)) {
    return "outside_allowed_root";
  }

  if (input.excludePaths.some((path) => isPathInsideRoot(input.url.pathname, path))) {
    return "excluded_path";
  }

  if (input.robotsDisallowPaths.some((path) => isPathInsideRoot(input.url.pathname, path))) {
    return "robots_disallowed";
  }

  return undefined;
}

function isPathInsideRoot(pathname: string, rootPathname: string) {
  const normalizedPathname = normalizeUrlPath(pathname);
  const normalizedRoot = normalizeUrlPath(rootPathname);

  return normalizedPathname === normalizedRoot || normalizedPathname.startsWith(`${normalizedRoot}/`);
}

function normalizeWebsiteRootUrl(value: string | undefined) {
  const rawValue = normalizeRequiredId(value, "Website crawl root URL");

  try {
    const url = new URL(rawValue);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }

    url.hash = "";
    url.search = "";
    return trimTrailingSlash(url.toString());
  } catch {
    throw new BadRequestException("Website crawl root URL must be a valid HTTP URL.");
  }
}

function normalizeWebsiteUrl(value: string, baseUrl: string) {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }

    url.hash = "";
    url.search = "";
    return trimTrailingSlash(url.toString());
  } catch {
    return undefined;
  }
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeCrawlLimit(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return 25;
  }

  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function normalizeExcludePaths(value: string[] | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((path) => path.trim()).filter((path) => path.length > 0))]
    .map((path) => path.startsWith("/") ? path : `/${path}`)
    .map(normalizeUrlPath);
}

function normalizeUrlPath(value: string) {
  const trimmed = value.trim();
  const withoutTrailingSlash = trimmed.length > 1 && trimmed.endsWith("/")
    ? trimmed.slice(0, -1)
    : trimmed;

  return withoutTrailingSlash.length === 0 ? "/" : withoutTrailingSlash;
}

function extractCanonicalUrl(html: string) {
  return html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i)?.[1];
}

function extractHtmlTitle(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  return title === undefined ? undefined : decodeHtmlEntities(stripHtmlTags(title)).trim();
}

function normalizeReadableHtmlText(html: string) {
  const body = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    ?? html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    ?? html;

  return decodeHtmlEntities(
    stripHtmlTags(
      body
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " "),
    ),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlTags(value: string) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function extractAnchorHrefs(html: string) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]!);
}

function buildTextPreview(text: string) {
  const compactText = text.replace(/\s+/g, " ").trim();

  return compactText.length <= 160 ? compactText : `${compactText.slice(0, 157)}...`;
}

function hashKnowledgeSourceText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function suggestKnowledgeKind(title: string, text: string): TenantKnowledgeKind {
  const haystack = `${title} ${text}`.toLowerCase();

  if (/\b(legal|compliance|contract|terms|privacy|policy law)\b/.test(haystack)) {
    return "legal_compliance";
  }

  if (/\b(price|pricing|rate|fee|discount|refund)\b/.test(haystack)) {
    return "pricing";
  }

  if (/\b(escalat|handoff|supervisor|manager)\b/.test(haystack)) {
    return "escalation";
  }

  if (/\b(troubleshoot|error|issue|fix|diagnos)\b/.test(haystack)) {
    return "troubleshooting";
  }

  if (/\b(step|procedure|sop|process)\b/.test(haystack)) {
    return "procedure";
  }

  if (/\b(question|answer|faq)\b/.test(haystack)) {
    return "faq";
  }

  if (/\b(policy|rule|must|required)\b/.test(haystack)) {
    return "policy";
  }

  return "general_reference";
}

function createKnowledgeRecordFromSource(input: {
  organizationId: string;
  actorUserId: string;
  source: KnowledgeSourceSnapshotResponse;
  title: string;
  text: string;
  kind: TenantKnowledgeKind;
  sourceUri?: string | undefined;
  sensitivityLabels?: KnowledgeSensitivityLabel[] | undefined;
  now: string;
}): TenantKnowledgeRecordResponse {
  return {
    id: `knowledge_${randomUUID()}`,
    organizationId: input.organizationId,
    kind: input.kind,
    publishedWorkflowVersionIds: [...input.source.publishedWorkflowVersionIds],
    workspaceId: input.source.workspaceId,
    workflowIds: [...input.source.workflowIds],
    title: input.title,
    text: input.text,
    source: {
      kind: getKnowledgeSourceReferenceKind(input.source.sourceType),
      title: input.source.title,
      sourceSnapshotId: input.source.id,
      ...(input.sourceUri !== undefined || input.source.uri !== undefined
        ? { uri: input.sourceUri ?? input.source.uri }
        : {}),
      ...(input.source.externalId !== undefined ? { externalId: input.source.externalId } : {}),
    },
    ...((input.sensitivityLabels ?? []).length > 0
      ? { sensitivityLabels: [...input.sensitivityLabels!] }
      : {}),
    conflictState: "none",
    status: "active",
    createdBy: input.actorUserId,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function getKnowledgeSourcePriority(kind: TenantKnowledgeRecordResponse["source"]["kind"]) {
  switch (kind) {
    case "manual":
      return 100;
    case "integration":
      return 70;
    case "document":
      return 50;
  }
}

function getKnowledgeSourceReferenceKind(
  sourceType: KnowledgeSourceSnapshotResponse["sourceType"],
): TenantKnowledgeRecordResponse["source"]["kind"] {
  return sourceType === "manual_text"
    ? "manual"
    : sourceType === "provider_import"
      ? "integration"
      : "document";
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

function knowledgeMatchesRuntimeKnowledgeScope(
  knowledge: TenantKnowledgeRecordResponse,
  filters: {
    publishedWorkflowVersionId?: string | undefined;
    workspaceId?: string | undefined;
    workflowId?: string | undefined;
  },
) {
  if (
    filters.publishedWorkflowVersionId !== undefined
    && knowledge.publishedWorkflowVersionIds.includes(filters.publishedWorkflowVersionId)
  ) {
    return true;
  }

  if (filters.workspaceId === undefined || knowledge.workspaceId !== filters.workspaceId) {
    return false;
  }

  const workflowIds = knowledge.workflowIds ?? [];

  return workflowIds.length === 0
    || (filters.workflowId !== undefined && workflowIds.includes(filters.workflowId));
}

function isStaleAt(staleAt: string | undefined, now: string) {
  if (staleAt === undefined) {
    return false;
  }

  const staleAtTime = Date.parse(staleAt);
  const nowTime = Date.parse(now);

  return Number.isFinite(staleAtTime) && Number.isFinite(nowTime) && staleAtTime <= nowTime;
}

function isKnowledgeVisibleAt(knowledge: TenantKnowledgeRecordResponse, now: string) {
  if (isBeforeTimestamp(now, knowledge.createdAt)) {
    return false;
  }

  if (knowledge.status === "active") {
    return !isStaleAt(knowledge.staleAt, now);
  }

  return knowledge.status === "stale"
    && knowledge.staleAt !== undefined
    && !isStaleAt(knowledge.staleAt, now);
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
    ...(knowledge.workflowIds === undefined ? {} : { workflowIds: [...knowledge.workflowIds] }),
    ...(knowledge.sensitivityLabels === undefined
      ? {}
      : { sensitivityLabels: [...knowledge.sensitivityLabels] }),
    source: { ...knowledge.source },
  };
}

function cloneKnowledgeSource(
  source: KnowledgeSourceSnapshotResponse,
): KnowledgeSourceSnapshotResponse {
  return {
    ...source,
    workflowIds: [...source.workflowIds],
    publishedWorkflowVersionIds: [...source.publishedWorkflowVersionIds],
    ...(source.crawl === undefined
      ? {}
      : {
          crawl: {
            rootUrl: source.crawl.rootUrl,
            crawlLimit: source.crawl.crawlLimit,
            excludePaths: [...source.crawl.excludePaths],
            pages: source.crawl.pages.map(cloneWebsiteCrawlPageSnapshot),
          },
        }),
  };
}

function cloneKnowledgeReviewDraft(
  draft: KnowledgeReviewDraftResponse,
): KnowledgeReviewDraftResponse {
  return {
    ...draft,
    workflowIds: [...draft.workflowIds],
    publishedWorkflowVersionIds: [...draft.publishedWorkflowVersionIds],
    ...(draft.sensitivityLabels === undefined
      ? {}
      : { sensitivityLabels: [...draft.sensitivityLabels] }),
    ...(draft.activationBlockers === undefined
      ? {}
      : { activationBlockers: draft.activationBlockers.map((blocker) => ({ ...blocker })) }),
    auditTrail: draft.auditTrail.map((entry) => ({ ...entry })),
  };
}

function cloneWebsiteCrawlPageSnapshot(page: WebsiteCrawlPageSnapshot): WebsiteCrawlPageSnapshot {
  return { ...page };
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
