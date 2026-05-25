export interface ComplianceAuditActor {
  type: "system" | "user";
  id?: string | undefined;
}

export interface ComplianceAuditTarget {
  type: string;
  id: string;
}

export interface ComplianceAuditLogEntry {
  id: string;
  tenantId: string;
  actor: ComplianceAuditActor;
  action: string;
  target: ComplianceAuditTarget;
  outcome: "succeeded" | "failed";
  occurredAt: string;
  metadata: Record<string, string | number | boolean>;
  previousHash: string | null;
  hash: string;
}

export interface ComplianceReadinessChecklistItem {
  control: "encryption" | "audit" | "retention" | "consent" | "access_control";
  status: "ready" | "gap";
  summary: string;
}

export interface ComplianceReadinessGap {
  id: string;
  summary: string;
  enterpriseAction: string;
}

export interface ComplianceReadinessResponse {
  organizationId: string;
  posture: "general_saas";
  claims: {
    hipaa: false;
    pci: false;
  };
  checklist: ComplianceReadinessChecklistItem[];
  knownGaps: ComplianceReadinessGap[];
  updatedAt: string;
}

export interface RecordingObjectDeletionRequest {
  objectKey: string;
  failDelete?: boolean | undefined;
}

export interface CreateRetentionJobRequest {
  actorUserId?: string | undefined;
  retainAfter: string;
  legalHold?: boolean | undefined;
  retryOfJobId?: string | undefined;
  recordingObjects?: RecordingObjectDeletionRequest[] | undefined;
  now?: string | undefined;
}

export interface ComplianceRetentionJobFailure {
  target: string;
  reason: string;
  willRetry: boolean;
}

export interface ComplianceRetentionJobResponse {
  id: string;
  tenantId: string;
  status: "completed" | "retry_scheduled";
  retainAfter: string;
  actor: ComplianceAuditActor;
  retryOfJobId?: string | undefined;
  deletedCounts: {
    calls: number;
    transcripts: number;
    memory: number;
    recordings: number;
  };
  failures: ComplianceRetentionJobFailure[];
  nextRetryAt?: string | undefined;
  createdAt: string;
}
