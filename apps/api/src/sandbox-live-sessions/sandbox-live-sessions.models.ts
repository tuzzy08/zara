import type {
  CompiledRuntimeManifest,
  EscalationFallbackMode,
  RuntimeProfileId,
} from "@zara/core";

export type LiveSandboxManifestSource = "draft" | "published";
export type LiveSandboxInputMode = "voice" | "typed";
export type LiveSandboxSessionStatus = "ready" | "active" | "ended" | "expired";

export interface LiveSandboxProviderStack {
  stt: "assemblyai-streaming";
  tts: "cartesia-sonic-3";
}

export interface LiveSandboxSessionRecord {
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  source: LiveSandboxManifestSource;
  inputMode: LiveSandboxInputMode;
  entryRoleId: string;
  manifestId: string;
  publishedVersionId: string;
  runtimeProfile: RuntimeProfileId;
  transportUrl: string;
  transportTokenHash: string;
  transportTokenConsumedAt?: string | undefined;
  providerStack: LiveSandboxProviderStack;
  createdAt: string;
  expiresAt: string;
  status: LiveSandboxSessionStatus;
  endedAt?: string | undefined;
  memory?: LiveSandboxSessionMemoryState | undefined;
}

export interface LiveSandboxSessionResponse {
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  source: LiveSandboxManifestSource;
  inputMode: LiveSandboxInputMode;
  entryRoleId: string;
  manifestId: string;
  publishedVersionId: string;
  runtimeProfile: RuntimeProfileId;
  transportUrl: string;
  providerStack: LiveSandboxProviderStack;
  createdAt: string;
  expiresAt: string;
  status: LiveSandboxSessionStatus;
  endedAt?: string | undefined;
  memory?: LiveSandboxSessionMemoryResponse | undefined;
  transportToken?: string | undefined;
}

export interface LiveSandboxSessionMemoryEntry {
  id: string;
  sourceEventType: string;
  text: string;
  capturedAt: string;
}

export interface LiveSandboxSessionMemoryState {
  status: "active" | "summarized" | "cleared";
  entries: LiveSandboxSessionMemoryEntry[];
  summary?: string | undefined;
  updatedAt: string;
}

export interface LiveSandboxSessionMemoryResponse {
  status: LiveSandboxSessionMemoryState["status"];
  entryCount: number;
  entries: LiveSandboxSessionMemoryEntry[];
  summary?: string | undefined;
  updatedAt: string;
}

export interface LiveSandboxSessionSummary {
  sessionId: string;
  workspaceId: string;
  source: LiveSandboxManifestSource;
  status: LiveSandboxSessionStatus;
  runtimeProfile: RuntimeProfileId;
  activeRoleName: string;
  runtimeTier: string;
  eventCount: number;
  turnCount: number;
  lastEventAt: string;
  lastEventType?: string | undefined;
  lastTranscriptPreview?: string | undefined;
}

export interface LiveSandboxTelemetryCallSummary {
  sessionId: string;
  workspaceId: string;
  status: LiveSandboxSessionStatus;
  runtimeProfile: RuntimeProfileId;
  runtimeTier: string;
  eventCount: number;
  modelLatencyMs: number;
  sttLatencyMs: number;
  ttsLatencyMs: number;
  toolDurationMs: number;
  toolCount: number;
  costUsd: number;
  modelInputTokens: number;
  modelOutputTokens: number;
  ttsCharacters: number;
  callMinutes: number;
  sttMinutes: number;
  missingUsageData: boolean;
  lastEventAt: string;
}

export interface LiveSandboxTelemetryAggregateResponse {
  organizationId: string;
  workspaceId?: string | undefined;
  callCount: number;
  totals: {
    costUsd: number;
    modelLatencyMs: number;
    sttLatencyMs: number;
    ttsLatencyMs: number;
    toolDurationMs: number;
    toolCount: number;
    modelInputTokens: number;
    modelOutputTokens: number;
    ttsCharacters: number;
    callMinutes: number;
    sttMinutes: number;
    missingUsageEventCount: number;
  };
  calls: LiveSandboxTelemetryCallSummary[];
}

export type LiveSandboxPostCallOutcome =
  | "resolved"
  | "human_escalated"
  | "fallback_triggered"
  | "failed";

export type LiveSandboxPostCallDisposition =
  | "resolved"
  | "callback_requested"
  | "ticket_required"
  | "needs_review";

export interface LiveSandboxPostCallActionItem {
  id: string;
  label: string;
  status: "open" | "completed";
  source: "transcript" | "tool" | "escalation";
}

export interface LiveSandboxPostCallCrmSyncTarget {
  provider: "hubspot" | "zendesk" | "salesforce" | "custom";
  connectionId: string;
  objectType: string;
  externalId?: string | undefined;
}

export interface LiveSandboxPostCallCrmSyncResponse extends LiveSandboxPostCallCrmSyncTarget {
  status: "queued" | "skipped";
  queuedAt?: string | undefined;
}

export type LiveSandboxPostCallCrmSyncStatus =
  | "queued"
  | "skipped"
  | "failed"
  | "retry_queued"
  | "synced";

export interface LiveSandboxPostCallCrmSyncDiagnostic {
  code: string;
  message: string;
  retryable: boolean;
  nextStep: string;
}

export interface LiveSandboxPostCallCrmSyncStatusResponse extends LiveSandboxPostCallCrmSyncTarget {
  summaryId: string;
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  status: LiveSandboxPostCallCrmSyncStatus;
  attemptCount: number;
  queuedAt?: string | undefined;
  lastAttemptAt?: string | undefined;
  retryQueuedAt?: string | undefined;
  nextRetryAt?: string | undefined;
  syncedAt?: string | undefined;
  diagnostic?: LiveSandboxPostCallCrmSyncDiagnostic | undefined;
}

export interface LiveSandboxPostCallSummaryResponse {
  summaryId: string;
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  outcome: LiveSandboxPostCallOutcome;
  disposition: LiveSandboxPostCallDisposition;
  summaryText: string;
  actionItems: LiveSandboxPostCallActionItem[];
  crmSync: LiveSandboxPostCallCrmSyncResponse;
  createdByUserId: string;
  createdAt: string;
}

export type LiveSandboxQualityFlagKind =
  | "dead_end"
  | "hallucination_risk"
  | "slow_turn"
  | "escalation_miss";

export interface LiveSandboxQualityFlag {
  flagId: string;
  kind: LiveSandboxQualityFlagKind;
  severity: "low" | "medium" | "high";
  eventSequence: number;
  observedAt: string;
  message: string;
}

export interface LiveSandboxImprovementSuggestion {
  suggestionId: string;
  flagId: string;
  title: string;
  rationale: string;
  status: "pending_approval";
  approvalRequired: true;
  draftChange: {
    target: "workflow_draft";
    operation: string;
    description: string;
    appliesToPublishedVersion: false;
  };
}

export interface LiveSandboxQualityReportResponse {
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  flags: LiveSandboxQualityFlag[];
  suggestions: LiveSandboxImprovementSuggestion[];
}

export type LiveSandboxEscalationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "fallback_triggered";

export interface LiveSandboxEscalationRecord {
  escalationId: string;
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  nodeId: string;
  queueId?: string | undefined;
  queueName?: string | undefined;
  reason: string;
  requestedAt: string;
  slaDeadlineAt: string;
  status: LiveSandboxEscalationStatus;
  fallbackMode?: EscalationFallbackMode | undefined;
  fallbackMessage?: string | undefined;
  acceptedByUserId?: string | undefined;
  declinedByUserId?: string | undefined;
  declineReason?: string | undefined;
  resolvedAt?: string | undefined;
  fallbackTriggeredAt?: string | undefined;
}

export interface LiveSandboxStreamEvent {
  sessionId: string;
  sequence: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface LiveSandboxTextInputMessage {
  type: "input.text";
  transcript: string;
  callPhase?: string | undefined;
  intent?: string | undefined;
}

export interface LiveSandboxAudioAppendMessage {
  type: "input.audio.append";
  audioBase64: string;
  sampleRateHz?: number | undefined;
  callPhase?: string | undefined;
  intent?: string | undefined;
}

export interface LiveSandboxAudioCommitMessage {
  type: "input.audio.commit";
  sampleRateHz?: number | undefined;
  callPhase?: string | undefined;
  intent?: string | undefined;
}

export interface UnknownLiveSandboxClientMessage {
  type: string;
  [key: string]: unknown;
}

export type LiveSandboxClientMessage =
  | LiveSandboxTextInputMessage
  | LiveSandboxAudioAppendMessage
  | LiveSandboxAudioCommitMessage
  | UnknownLiveSandboxClientMessage;

export interface CreateLiveSandboxSessionRequest {
  actorUserId: string;
  workspaceId: string;
  source: LiveSandboxManifestSource;
  inputMode: LiveSandboxInputMode;
  entryRoleId: string;
  manifest: CompiledRuntimeManifest;
  ttlMinutes?: number | undefined;
  now?: string | undefined;
}
