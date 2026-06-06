export type MemoryScope = "caller" | "account";
export type TenantKnowledgeKind =
  | "faq"
  | "policy"
  | "procedure"
  | "troubleshooting"
  | "pricing"
  | "escalation"
  | "legal_compliance"
  | "general_reference";
export type KnowledgeIngestionSourceType =
  | "document"
  | "website"
  | "pdf"
  | "notion"
  | "google_drive"
  | "crm_help_center";
export type KnowledgeSourceSnapshotType =
  | "manual_text"
  | "single_url"
  | "pdf"
  | "provider_import";
export type KnowledgeSourceSyncMode = "snapshot" | "recurring";
export type KnowledgeSourceSyncCadence = "manual" | "daily";
export type KnowledgeSourceSyncStatus = "synced" | "review_required" | "degraded" | "failed";
export type KnowledgeReviewDraftChangeType = "new" | "update" | "deletion";
export type KnowledgeSensitivityLabel =
  | "pii"
  | "credentials_secrets"
  | "payment"
  | "health"
  | "legal"
  | "internal_only";
export interface KnowledgeActivationBlocker {
  code: "credentials_or_secrets_detected";
  label: "credentials_secrets";
  message: string;
}

export interface CallerIdentity {
  kind: "phone" | "email" | "external_id";
  value: string;
}

export interface MemorySourceReference {
  kind: "call_summary" | "manual" | "integration";
  callSessionId?: string | undefined;
  transcriptId?: string | undefined;
  transcriptEventIds?: string[] | undefined;
  externalId?: string | undefined;
}

export interface TenantKnowledgeSourceReference {
  kind: "manual" | "document" | "integration";
  title: string;
  uri?: string | undefined;
  externalId?: string | undefined;
  sourceSnapshotId?: string | undefined;
}

export interface CreateMemoryRecordRequest {
  actorUserId: string;
  scope: MemoryScope;
  callerIdentity: CallerIdentity;
  accountId?: string | undefined;
  text: string;
  optIn: boolean;
  approvalRequired?: boolean | undefined;
  source: MemorySourceReference;
  confidence?: number | undefined;
  embedding?: number[] | undefined;
  now?: string | undefined;
}

export interface MemoryRecordAuditEntry {
  action: "memory_created" | "memory_edited" | "memory_disabled" | "memory_deleted";
  actorUserId: string;
  at: string;
}

export interface MemoryRecordResponse {
  id: string;
  organizationId: string;
  scope: MemoryScope;
  callerIdentity: CallerIdentity;
  accountId?: string | undefined;
  text: string;
  source: MemorySourceReference;
  confidence: number;
  approvalState: "approved" | "pending" | "rejected";
  status: "active" | "disabled" | "deleted";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  auditTrail: MemoryRecordAuditEntry[];
}

export interface UpdateMemoryRecordRequest {
  actorUserId: string;
  text?: string | undefined;
  confidence?: number | undefined;
  status?: "active" | "disabled" | undefined;
  now?: string | undefined;
}

export interface DeleteMemoryRecordRequest {
  actorUserId: string;
  now?: string | undefined;
}

export interface PurgeMemoryRetentionRequest {
  actorUserId: string;
  retainAfter: string;
  legalHold?: boolean | undefined;
  now?: string | undefined;
}

export interface MemoryRetentionPurgeResponse {
  organizationId: string;
  retainedAfter: string;
  purgedCounts: {
    memories: number;
    knowledge: number;
    embeddings: number;
    ingestionSources: number;
  };
  actorUserId: string;
  purgedAt: string;
}

export interface DeleteTenantMemoryDataRequest {
  actorUserId: string;
  legalHold?: boolean | undefined;
  now?: string | undefined;
}

export interface TenantMemoryDeletionResponse {
  organizationId: string;
  deletedCounts: {
    memories: number;
    knowledge: number;
    embeddings: number;
    drafts: number;
    ingestions: number;
  };
  actorUserId: string;
  deletedAt: string;
}

export interface MemoryApprovalAuditEntry {
  action: "draft_created" | "approved" | "rejected";
  actorUserId: string;
  at: string;
  reason?: string | undefined;
}

export interface MemoryApprovalDraftResponse {
  id: string;
  organizationId: string;
  scope: MemoryScope;
  callerIdentity: CallerIdentity;
  accountId?: string | undefined;
  text: string;
  source: MemorySourceReference;
  confidence: number;
  approvalState: "pending" | "approved" | "rejected";
  status: "draft" | "approved" | "rejected";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedMemoryId?: string | undefined;
  rejectionReason?: string | undefined;
  auditTrail: MemoryApprovalAuditEntry[];
}

export interface ApproveMemoryDraftRequest {
  approverUserId: string;
  text?: string | undefined;
  confidence?: number | undefined;
  now?: string | undefined;
}

export interface RejectMemoryDraftRequest {
  approverUserId: string;
  reason?: string | undefined;
  now?: string | undefined;
}

export interface ExtractMemoryTranscriptEntry {
  id: string;
  speaker: "caller" | "agent" | "system";
  text: string;
  at?: string | undefined;
}

export interface ExtractMemoryDraftsRequest {
  actorUserId: string;
  callSessionId: string;
  transcriptId: string;
  callerIdentity: CallerIdentity;
  accountId?: string | undefined;
  optIn: boolean;
  transcript: ExtractMemoryTranscriptEntry[];
  now?: string | undefined;
}

export interface ExtractedMemoryDraftResponse {
  id: string;
  organizationId: string;
  scope: MemoryScope;
  callerIdentity: CallerIdentity;
  accountId?: string | undefined;
  text: string;
  source: MemorySourceReference;
  confidence: number;
  approvalState: "pending";
  status: "draft";
  createdBy: string;
  createdAt: string;
}

export interface FilteredMemoryExtractionCandidateResponse {
  transcriptEventId: string;
  reason: "sensitive_data" | "not_caller_asserted" | "not_memory_worthy";
}

export interface RetrieveMemoryRequest {
  queryEmbedding: number[];
  topK?: number | undefined;
  scope?: MemoryScope | "tenant_knowledge" | undefined;
  minConfidence?: number | undefined;
  callerIdentity?: CallerIdentity | undefined;
  accountId?: string | undefined;
  publishedWorkflowVersionId?: string | undefined;
  workspaceId?: string | undefined;
  workflowId?: string | undefined;
}

export interface RetrievedMemoryMatchResponse {
  id: string;
  organizationId: string;
  scope: MemoryScope | "tenant_knowledge";
  confidence: number;
  similarityScore: number;
  memory?: MemoryRecordResponse | undefined;
  knowledge?: TenantKnowledgeRecordResponse | undefined;
}

export interface CreateTenantKnowledgeRequest {
  actorUserId: string;
  kind: TenantKnowledgeKind;
  publishedWorkflowVersionIds: string[];
  workspaceId?: string | undefined;
  workflowIds?: string[] | undefined;
  title: string;
  text: string;
  source: TenantKnowledgeSourceReference;
  staleAt?: string | undefined;
  now?: string | undefined;
}

export interface CreateKnowledgeSourceRequest {
  actorUserId: string;
  sourceType: KnowledgeSourceSnapshotType;
  syncMode?: KnowledgeSourceSyncMode | undefined;
  syncCadence?: KnowledgeSourceSyncCadence | undefined;
  workspaceId: string;
  workflowIds?: string[] | undefined;
  publishedWorkflowVersionIds?: string[] | undefined;
  title: string;
  text?: string | undefined;
  recordType?: TenantKnowledgeKind | undefined;
  uri?: string | undefined;
  providerId?: string | undefined;
  integrationConnectionId?: string | undefined;
  externalId?: string | undefined;
  contentType?: string | undefined;
  now?: string | undefined;
}

export interface RefreshKnowledgeSourceRequest {
  actorUserId: string;
  trigger: "manual" | "daily";
  providerFailure?: "auth_revoked" | "permission_denied" | undefined;
  sourceDeleted?: boolean | undefined;
  deletionConfirmed?: boolean | undefined;
  text?: string | undefined;
  now?: string | undefined;
}

export interface ApproveKnowledgeReviewDraftRequest {
  approverUserId: string;
  approverRole?: "owner" | "admin" | "builder" | "operator" | "viewer" | undefined;
  workspaceId?: string | undefined;
  reason?: string | undefined;
  recordType?: TenantKnowledgeKind | undefined;
  confirmHighRiskKind?: boolean | undefined;
  text?: string | undefined;
  now?: string | undefined;
}

export interface KnowledgeIngestionSourceInput {
  clientSourceId: string;
  type: KnowledgeIngestionSourceType;
  title: string;
  text?: string | undefined;
  uri?: string | undefined;
  externalId?: string | undefined;
  contentType?: string | undefined;
}

export interface CreateKnowledgeIngestionRequest {
  actorUserId: string;
  publishedWorkflowVersionIds: string[];
  sources: KnowledgeIngestionSourceInput[];
  now?: string | undefined;
}

export interface RetryKnowledgeIngestionRequest {
  actorUserId: string;
  sources?: KnowledgeIngestionSourceInput[] | undefined;
  now?: string | undefined;
}

export interface KnowledgeIngestionFailureResponse {
  code: "missing_content" | "unsupported_content_type" | "large_file";
  retryable: boolean;
  message: string;
}

export interface KnowledgeIngestionSourceStatusResponse {
  clientSourceId: string;
  type: KnowledgeIngestionSourceType;
  title: string;
  status: "succeeded" | "failed";
  knowledgeRecordId?: string | undefined;
  failure?: KnowledgeIngestionFailureResponse | undefined;
  updatedAt: string;
}

export interface KnowledgeIngestionJobResponse {
  id: string;
  organizationId: string;
  status: "completed" | "partial_failure" | "failed";
  sourceCount: number;
  succeededCount: number;
  failedCount: number;
  publishedWorkflowVersionIds: string[];
  sources: KnowledgeIngestionSourceStatusResponse[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantMemoryExportEmbeddingResponse {
  id: string;
  recordKind: "memory" | "tenant_knowledge";
  recordId: string;
  scope: MemoryScope | "tenant_knowledge";
  confidence: number;
  createdAt: string;
}

export interface TenantMemoryExportResponse {
  organizationId: string;
  exportedAt: string;
  memories: MemoryRecordResponse[];
  knowledge: TenantKnowledgeRecordResponse[];
  drafts: MemoryApprovalDraftResponse[];
  ingestions: KnowledgeIngestionJobResponse[];
  knowledgeSources: KnowledgeSourceSnapshotResponse[];
  knowledgeReviewDrafts: KnowledgeReviewDraftResponse[];
  embeddings: TenantMemoryExportEmbeddingResponse[];
}

export interface TenantKnowledgeRecordResponse {
  id: string;
  organizationId: string;
  kind: TenantKnowledgeKind;
  publishedWorkflowVersionIds: string[];
  workspaceId?: string | undefined;
  workflowIds?: string[] | undefined;
  title: string;
  text: string;
  source: TenantKnowledgeSourceReference;
  sensitivityLabels?: KnowledgeSensitivityLabel[] | undefined;
  staleAt?: string | undefined;
  conflictState: "none" | "conflicting";
  status: "active" | "stale" | "disabled" | "deleted";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSourceSnapshotResponse {
  id: string;
  organizationId: string;
  sourceType: KnowledgeSourceSnapshotType;
  syncMode?: KnowledgeSourceSyncMode | undefined;
  syncCadence?: KnowledgeSourceSyncCadence | undefined;
  title: string;
  textPreview: string;
  contentHash: string;
  workspaceId: string;
  workflowIds: string[];
  publishedWorkflowVersionIds: string[];
  uri?: string | undefined;
  providerId?: string | undefined;
  integrationConnectionId?: string | undefined;
  externalId?: string | undefined;
  contentType?: string | undefined;
  status: "activated" | "review_required" | "failed";
  syncStatus?: KnowledgeSourceSyncStatus | undefined;
  degradedReason?: "auth_revoked" | "permission_denied" | undefined;
  refreshPausedAt?: string | undefined;
  lastSyncedAt?: string | undefined;
  nextSyncAt?: string | undefined;
  extractedRecordCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeReviewDraftAuditEntry {
  action: "draft_created" | "approved" | "rejected";
  actorUserId: string;
  actorRole?: "owner" | "admin" | "builder" | "operator" | "viewer" | undefined;
  workspaceId?: string | undefined;
  at: string;
  reason?: string | undefined;
  beforeState?: Record<string, unknown> | undefined;
  afterState?: Record<string, unknown> | undefined;
}

export interface KnowledgeReviewDraftResponse {
  id: string;
  organizationId: string;
  sourceSnapshotId: string;
  changeType?: KnowledgeReviewDraftChangeType | undefined;
  currentKnowledgeRecordId?: string | undefined;
  title: string;
  text: string;
  suggestedKind: TenantKnowledgeKind;
  sensitivityLabels?: KnowledgeSensitivityLabel[] | undefined;
  activationBlockers?: KnowledgeActivationBlocker[] | undefined;
  kindConfirmed: boolean;
  requiresKindConfirmation: boolean;
  workspaceId: string;
  workflowIds: string[];
  publishedWorkflowVersionIds: string[];
  status: "draft" | "approved" | "rejected";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedKnowledgeRecordId?: string | undefined;
  auditTrail: KnowledgeReviewDraftAuditEntry[];
}
