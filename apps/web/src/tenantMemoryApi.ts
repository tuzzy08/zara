import { requestJson } from "./apiClient";

export interface MemoryRecord {
  id: string;
  scope: "caller" | "account";
  callerIdentity: {
    kind: "phone" | "email" | "external_id";
    value: string;
  };
  accountId?: string;
  text: string;
  confidence: number;
  approvalState: "approved" | "pending" | "rejected";
  status: "active" | "disabled" | "deleted";
  updatedAt: string;
  auditTrail: Array<{
    action: string;
    actorUserId: string;
    at: string;
  }>;
}

export interface MemoryDraft {
  id: string;
  scope: "caller" | "account";
  text: string;
  confidence: number;
  status: "draft" | "approved" | "rejected";
  updatedAt: string;
}

export type KnowledgeRecordType =
  | "faq"
  | "policy"
  | "procedure"
  | "troubleshooting"
  | "pricing"
  | "escalation"
  | "legal_compliance"
  | "general_reference";

export type KnowledgeSourceType = "manual_text" | "single_url" | "pdf" | "provider_import";

export interface KnowledgeRecord {
  id: string;
  kind: KnowledgeRecordType;
  workspaceId?: string;
  workflowIds?: string[];
  publishedWorkflowVersionIds?: string[];
  title: string;
  text: string;
  status: "active" | "stale" | "disabled" | "deleted";
  conflictState: "none" | "conflicting";
  updatedAt: string;
}

export interface KnowledgeSourceSnapshot {
  id: string;
  organizationId: string;
  sourceType: KnowledgeSourceType;
  workspaceId: string;
  workflowIds: string[];
  publishedWorkflowVersionIds: string[];
  title: string;
  textPreview: string;
  contentHash: string;
  uri?: string;
  providerId?: string;
  integrationConnectionId?: string;
  externalId?: string;
  contentType?: string;
  status: "activated" | "review_required" | "failed";
  extractedRecordCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeReviewDraft {
  id: string;
  organizationId: string;
  sourceSnapshotId: string;
  title: string;
  text: string;
  status: "draft" | "approved" | "rejected";
  suggestedKind: KnowledgeRecordType;
  kindConfirmed: boolean;
  requiresKindConfirmation: boolean;
  workspaceId: string;
  workflowIds: string[];
  publishedWorkflowVersionIds: string[];
  approvedKnowledgeRecordId?: string;
  updatedAt: string;
  createdAt: string;
  auditTrail: Array<{
    action: "draft_created" | "approved" | "rejected";
    actorUserId: string;
    at: string;
    reason?: string;
  }>;
}

export interface KnowledgeIngestion {
  id: string;
  status: "completed" | "partial_failure" | "failed";
  sourceCount: number;
  succeededCount: number;
  failedCount: number;
  updatedAt: string;
}

export interface TenantMemoryExport {
  organizationId: string;
  exportedAt: string;
  memories: MemoryRecord[];
  knowledge: KnowledgeRecord[];
  drafts: MemoryDraft[];
  ingestions: KnowledgeIngestion[];
  knowledgeSources?: KnowledgeSourceSnapshot[];
  knowledgeReviewDrafts?: KnowledgeReviewDraft[];
  embeddings: Array<{
    id: string;
    recordKind: "memory" | "tenant_knowledge";
    recordId: string;
  }>;
}

export async function fetchTenantMemoryExport(organizationId: string) {
  const response = await requestJson<{ export: TenantMemoryExport }>(
    `/organizations/${organizationId}/memory/export`,
  );

  return response.export;
}

export interface CreateKnowledgeSourceRequest {
  actorUserId: string;
  sourceType: KnowledgeSourceType;
  workspaceId: string;
  workflowIds?: string[];
  publishedWorkflowVersionIds?: string[];
  title: string;
  text: string;
  uri?: string;
  recordType?: KnowledgeRecordType;
  providerId?: string;
  integrationConnectionId?: string;
  externalId?: string;
  contentType?: string;
}

export async function createKnowledgeSource(organizationId: string, input: CreateKnowledgeSourceRequest) {
  return await requestJson<{
    source: KnowledgeSourceSnapshot;
    knowledge: KnowledgeRecord[];
    reviewDrafts: KnowledgeReviewDraft[];
  }>(
    `/organizations/${organizationId}/memory/knowledge/sources`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export interface ApproveKnowledgeReviewDraftRequest {
  approverUserId: string;
  recordType?: KnowledgeRecordType;
  confirmHighRiskKind?: boolean;
}

export async function approveKnowledgeReviewDraft(
  organizationId: string,
  draftId: string,
  input: ApproveKnowledgeReviewDraftRequest,
) {
  return await requestJson<{
    reviewDraft: KnowledgeReviewDraft;
    knowledge: KnowledgeRecord;
  }>(
    `/organizations/${organizationId}/memory/knowledge/review-drafts/${draftId}/approve`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function approveMemoryDraft(organizationId: string, draftId: string) {
  const response = await requestJson<{ draft?: MemoryDraft; memory?: MemoryRecord }>(
    `/organizations/${organizationId}/memory/drafts/${draftId}/approve`,
    {
      method: "POST",
      body: JSON.stringify({
        approverUserId: "user-ops-lead",
      }),
    },
  );

  return response;
}

export async function rejectMemoryDraft(organizationId: string, draftId: string) {
  const response = await requestJson<{ draft: MemoryDraft }>(
    `/organizations/${organizationId}/memory/drafts/${draftId}/reject`,
    {
      method: "POST",
      body: JSON.stringify({
        approverUserId: "user-ops-lead",
        reason: "Rejected from tenant memory page.",
      }),
    },
  );

  return response.draft;
}

export async function disableMemoryRecord(organizationId: string, memoryId: string) {
  const response = await requestJson<{ memory: MemoryRecord }>(
    `/organizations/${organizationId}/memory/${memoryId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        status: "disabled",
      }),
    },
  );

  return response.memory;
}

export async function deleteMemoryRecord(organizationId: string, memoryId: string) {
  const response = await requestJson<{ memory: MemoryRecord }>(
    `/organizations/${organizationId}/memory/${memoryId}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
      }),
    },
  );

  return response.memory;
}

export async function purgeMemoryRetention(organizationId: string) {
  const response = await requestJson<{ retention: { purgedCounts: Record<string, number> } }>(
    `/organizations/${organizationId}/memory/retention/purge`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        retainAfter: "2026-01-01T00:00:00.000Z",
        legalHold: false,
      }),
    },
  );

  return response.retention;
}
