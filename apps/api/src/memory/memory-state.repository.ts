import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  CallerIdentity,
  KnowledgeIngestionJobResponse,
  MemoryApprovalDraftResponse,
  MemoryRecordResponse,
  MemoryScope,
  TenantKnowledgeRecordResponse,
} from "./memory.models";

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
  constructor(private readonly directoryPath: string) {}

  load(organizationId: string): PersistedMemoryStateRecord | null {
    const filePath = resolveStateFilePath(this.directoryPath, organizationId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));

      if (!isPersistedMemoryStateRecord(parsed, organizationId)) {
        throw new Error("Memory snapshot structure is invalid.");
      }

      return {
        schemaVersion: parsed.schemaVersion,
        organizationId: parsed.organizationId,
        memories: parsed.memories,
        knowledge: parsed.knowledge ?? [],
        embeddings: parsed.embeddings ?? [],
        drafts: parsed.drafts ?? [],
        ingestions: parsed.ingestions ?? [],
      };
    } catch {
      const corruptFilePath = join(
        this.directoryPath,
        `${organizationId}.corrupt-${Date.now()}.json`,
      );
      mkdirSync(this.directoryPath, { recursive: true });
      renameSync(filePath, corruptFilePath);

      return null;
    }
  }

  save(record: PersistedMemoryStateRecord) {
    mkdirSync(this.directoryPath, { recursive: true });

    const nextFilePath = resolveStateFilePath(this.directoryPath, record.organizationId);
    const temporaryFilePath = `${nextFilePath}.tmp`;

    writeFileSync(temporaryFilePath, JSON.stringify(record, null, 2), "utf8");
    rmSync(nextFilePath, { force: true });
    renameSync(temporaryFilePath, nextFilePath);
  }
}

function resolveStateFilePath(directoryPath: string, organizationId: string) {
  return join(directoryPath, `${organizationId}.json`);
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
