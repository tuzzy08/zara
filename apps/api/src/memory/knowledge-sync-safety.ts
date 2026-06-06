import type {
  KnowledgeActivationBlocker,
  KnowledgeSensitivityLabel,
  TenantKnowledgeKind,
} from "./memory.models";

export interface KnowledgeTextClassification {
  labels: KnowledgeSensitivityLabel[];
  activationBlockers: KnowledgeActivationBlocker[];
}

export interface ClassifyKnowledgeTextInput {
  text: string;
}

export type KnowledgeApprovalRole = "owner" | "admin";
export type KnowledgeApprovalMetadataField =
  | "actorUserId"
  | "actorRole"
  | "workspaceId"
  | "reason"
  | "beforeState"
  | "afterState"
  | "timestamp";
export type KnowledgeApprovalReason = "high_risk_kind" | "sensitive_labels";

export interface EvaluateKnowledgeActivationApprovalInput {
  kind: TenantKnowledgeKind;
  sensitivityLabels: KnowledgeSensitivityLabel[];
}

export interface KnowledgeActivationApprovalDecision {
  requiresApproval: boolean;
  requiredApproverRoles: KnowledgeApprovalRole[];
  requiredMetadata: KnowledgeApprovalMetadataField[];
  reasons: KnowledgeApprovalReason[];
}

export type KnowledgeConflictStatus = "resolved" | "unresolved";

export interface KnowledgeConflictRecord {
  id: string;
  kind: TenantKnowledgeKind;
  title: string;
  text: string;
  sourcePriority: number;
  conflictStatus?: KnowledgeConflictStatus | undefined;
}

export interface EvaluateKnowledgeConflictsInput {
  records: KnowledgeConflictRecord[];
}

export interface KnowledgeConflictWarning {
  code: "same_kind_title_conflict";
  kind: TenantKnowledgeKind;
  title: string;
  recordIds: string[];
  sourcePriorities: number[];
  status: KnowledgeConflictStatus;
  blocksPublish: boolean;
}

export interface KnowledgeConflictPublishBlocker {
  code: "unresolved_high_risk_conflict";
  kind: TenantKnowledgeKind;
  title: string;
  recordIds: string[];
}

export interface KnowledgeConflictEvaluation {
  warnings: KnowledgeConflictWarning[];
  publishBlockers: KnowledgeConflictPublishBlocker[];
  canPublish: boolean;
}

const SENSITIVITY_LABELS: KnowledgeSensitivityLabel[] = [
  "pii",
  "credentials_secrets",
  "payment",
  "health",
  "legal",
  "internal_only",
];

const SENSITIVITY_PATTERNS: Record<KnowledgeSensitivityLabel, RegExp[]> = {
  pii: [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/,
    /\b\d{3}-\d{2}-\d{4}\b/,
  ],
  credentials_secrets: [
    /\b(?:password|passcode|api[_\s-]?key|secret|access[_\s-]?token|bearer[_\s-]?token)\b\s*[:=]/i,
    /\bsk-[a-z0-9_-]{12,}\b/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  ],
  payment: [
    /\b(?:card|credit card|debit card)\b/i,
    /\b(?:cvv|cvc)\b\s*[:=]?\s*\d{3,4}\b/i,
    /\b(?:\d[ -]*?){13,19}\b/,
  ],
  health: [
    /\b(?:patient|diagnosis|symptoms?|surgery|medical|medication|prescription|diabetes|hipaa)\b/i,
  ],
  legal: [
    /\b(?:legal|contract|arbitration|lawsuit|attorney|counsel|compliance|terms of service)\b/i,
  ],
  internal_only: [
    /\b(?:internal only|staff only|confidential|do not share|employee handbook|private playbook)\b/i,
  ],
};

const HIGH_RISK_KNOWLEDGE_KINDS = new Set<TenantKnowledgeKind>([
  "pricing",
  "escalation",
  "legal_compliance",
  "policy",
]);

const REQUIRED_APPROVER_ROLES: KnowledgeApprovalRole[] = ["owner", "admin"];
const REQUIRED_APPROVAL_METADATA: KnowledgeApprovalMetadataField[] = [
  "actorUserId",
  "actorRole",
  "workspaceId",
  "reason",
  "beforeState",
  "afterState",
  "timestamp",
];

export function isHighRiskKnowledgeKind(kind: TenantKnowledgeKind): boolean {
  return HIGH_RISK_KNOWLEDGE_KINDS.has(kind);
}

export function classifyKnowledgeText(input: ClassifyKnowledgeTextInput): KnowledgeTextClassification {
  const labels = SENSITIVITY_LABELS.filter((label) =>
    SENSITIVITY_PATTERNS[label].some((pattern) => pattern.test(input.text)),
  );
  const activationBlockers = labels.includes("credentials_secrets")
    ? [
        {
          code: "credentials_or_secrets_detected",
          label: "credentials_secrets",
          message: "Obvious credentials, secrets, API keys, or passwords cannot become runtime knowledge.",
        } satisfies KnowledgeActivationBlocker,
      ]
    : [];

  return {
    labels,
    activationBlockers,
  };
}

export function evaluateKnowledgeActivationApproval(
  input: EvaluateKnowledgeActivationApprovalInput,
): KnowledgeActivationApprovalDecision {
  const reasons: KnowledgeApprovalReason[] = [];

  if (HIGH_RISK_KNOWLEDGE_KINDS.has(input.kind)) {
    reasons.push("high_risk_kind");
  }
  if (input.sensitivityLabels.length > 0) {
    reasons.push("sensitive_labels");
  }

  return {
    requiresApproval: reasons.length > 0,
    requiredApproverRoles: reasons.length > 0 ? [...REQUIRED_APPROVER_ROLES] : [],
    requiredMetadata: reasons.length > 0 ? [...REQUIRED_APPROVAL_METADATA] : [],
    reasons,
  };
}

export function evaluateKnowledgeConflicts(
  input: EvaluateKnowledgeConflictsInput,
): KnowledgeConflictEvaluation {
  const warnings: KnowledgeConflictWarning[] = [];
  const publishBlockers: KnowledgeConflictPublishBlocker[] = [];
  const groups = groupConflictRecords(input.records);

  for (const records of groups.values()) {
    const [firstRecord] = records;
    if (firstRecord === undefined || records.length < 2) {
      continue;
    }

    const normalizedTexts = new Set(records.map((record) => normalizeConflictText(record.text)));
    const sourcePriorities = [...new Set(records.map((record) => record.sourcePriority))].sort(
      (left, right) => left - right,
    );
    if (normalizedTexts.size <= 1 && sourcePriorities.length <= 1) {
      continue;
    }

    const recordIds = records.map((record) => record.id);
    const status: KnowledgeConflictStatus = records.every((record) => record.conflictStatus === "resolved")
      ? "resolved"
      : "unresolved";
    const blocksPublish = status === "unresolved" && isHighRiskKnowledgeKind(firstRecord.kind);

    warnings.push({
      code: "same_kind_title_conflict",
      kind: firstRecord.kind,
      title: firstRecord.title,
      recordIds,
      sourcePriorities,
      status,
      blocksPublish,
    });

    if (blocksPublish) {
      publishBlockers.push({
        code: "unresolved_high_risk_conflict",
        kind: firstRecord.kind,
        title: firstRecord.title,
        recordIds,
      });
    }
  }

  return {
    warnings,
    publishBlockers,
    canPublish: publishBlockers.length === 0,
  };
}

function groupConflictRecords(records: KnowledgeConflictRecord[]) {
  const groups = new Map<string, KnowledgeConflictRecord[]>();

  for (const record of records) {
    const key = `${record.kind}:${normalizeConflictText(record.title)}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, [record]);
    } else {
      existing.push(record);
    }
  }

  return groups;
}

function normalizeConflictText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
