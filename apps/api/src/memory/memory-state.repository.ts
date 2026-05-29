import type {
  CallerIdentity,
  KnowledgeIngestionJobResponse,
  MemoryApprovalDraftResponse,
  MemoryRecordResponse,
  MemoryScope,
  TenantKnowledgeRecordResponse,
} from "./memory.models";
import {
  createTenantJsonStateRepository,
  type TenantJsonStateRepository,
} from "../persistence/tenant-json-state.repository";

export interface PersistedMemoryEmbeddingRecord {
  id: string;
  organizationId: string;
  recordKind: "memory" | "tenant_knowledge";
  recordId: string;
  scope: MemoryScope | "tenant_knowledge";
  embedding: number[];
  confidence: number;
  callerIdentity?: CallerIdentity | undefined;
  accountId?: string | undefined;
  publishedWorkflowVersionIds?: string[] | undefined;
  createdAt: string;
}

export interface PersistedMemoryStateRecord {
  schemaVersion: 1;
  organizationId: string;
  memories: MemoryRecordResponse[];
  knowledge: TenantKnowledgeRecordResponse[];
  embeddings: PersistedMemoryEmbeddingRecord[];
  drafts: MemoryApprovalDraftResponse[];
  ingestions: KnowledgeIngestionJobResponse[];
}

export const MEMORY_STATE_REPOSITORY = Symbol("MEMORY_STATE_REPOSITORY");

export interface MemoryStateRepository {
  load(organizationId: string): PersistedMemoryStateRecord | null | Promise<PersistedMemoryStateRecord | null>;
  save(record: PersistedMemoryStateRecord): void | Promise<void>;
}

export class InMemoryMemoryStateRepository implements MemoryStateRepository {
  private readonly recordsByOrganizationId = new Map<string, PersistedMemoryStateRecord>();

  load(organizationId: string) {
    const record = this.recordsByOrganizationId.get(organizationId);

    return record === undefined ? null : cloneRecord(record);
  }

  save(record: PersistedMemoryStateRecord) {
    this.recordsByOrganizationId.set(record.organizationId, cloneRecord(record));
  }
}

export class FileMemoryStateRepository implements MemoryStateRepository {
  private readonly stateRepository: TenantJsonStateRepository<PersistedMemoryStateRecord>;

  constructor(directoryPath: string) {
    this.stateRepository = createTenantJsonStateRepository({
      directoryPath,
      validate: isPersistedMemoryStateRecord,
      normalize: normalizePersistedMemoryStateRecord,
    });
  }

  load(organizationId: string): PersistedMemoryStateRecord | null {
    return this.stateRepository.load(organizationId);
  }

  save(record: PersistedMemoryStateRecord) {
    this.stateRepository.save(record);
  }
}

function isPersistedMemoryStateRecord(
  value: unknown,
  organizationId: string,
): value is PersistedMemoryStateRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PersistedMemoryStateRecord>;

  return (
    candidate.schemaVersion === 1 &&
    candidate.organizationId === organizationId &&
    Array.isArray(candidate.memories) &&
    (candidate.knowledge === undefined || Array.isArray(candidate.knowledge)) &&
    (candidate.embeddings === undefined || Array.isArray(candidate.embeddings)) &&
    (candidate.drafts === undefined || Array.isArray(candidate.drafts)) &&
    (candidate.ingestions === undefined || Array.isArray(candidate.ingestions))
  );
}

function normalizePersistedMemoryStateRecord(record: PersistedMemoryStateRecord): PersistedMemoryStateRecord {
  return {
    schemaVersion: record.schemaVersion,
    organizationId: record.organizationId,
    memories: record.memories,
    knowledge: record.knowledge ?? [],
    embeddings: record.embeddings ?? [],
    drafts: record.drafts ?? [],
    ingestions: record.ingestions ?? [],
  };
}

function cloneRecord(record: PersistedMemoryStateRecord): PersistedMemoryStateRecord {
  return {
    schemaVersion: record.schemaVersion,
    organizationId: record.organizationId,
    memories: record.memories.map((memory) => ({
      ...memory,
      callerIdentity: { ...memory.callerIdentity },
      source: cloneMemorySource(memory.source),
      auditTrail: (memory.auditTrail ?? []).map((entry) => ({ ...entry })),
    })),
    knowledge: record.knowledge.map((knowledge) => ({
      ...knowledge,
      publishedWorkflowVersionIds: [...knowledge.publishedWorkflowVersionIds],
      source: { ...knowledge.source },
    })),
    embeddings: record.embeddings.map((embedding) => ({
      ...embedding,
      embedding: [...embedding.embedding],
      ...(embedding.callerIdentity === undefined
        ? {}
        : { callerIdentity: { ...embedding.callerIdentity } }),
      ...(embedding.publishedWorkflowVersionIds === undefined
        ? {}
        : { publishedWorkflowVersionIds: [...embedding.publishedWorkflowVersionIds] }),
    })),
    drafts: record.drafts.map((draft) => ({
      ...draft,
      callerIdentity: { ...draft.callerIdentity },
      source: cloneMemorySource(draft.source),
      auditTrail: draft.auditTrail.map((entry) => ({ ...entry })),
    })),
    ingestions: record.ingestions.map((ingestion) => ({
      ...ingestion,
      publishedWorkflowVersionIds: [...ingestion.publishedWorkflowVersionIds],
      sources: ingestion.sources.map((source) => ({
        ...source,
        ...(source.failure === undefined ? {} : { failure: { ...source.failure } }),
      })),
    })),
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
