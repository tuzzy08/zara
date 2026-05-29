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

export interface KnowledgeRecord {
  id: string;
  kind: "policy" | "faq";
  title: string;
  text: string;
  status: "active" | "stale" | "disabled" | "deleted";
  conflictState: "none" | "conflicting";
  updatedAt: string;
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
