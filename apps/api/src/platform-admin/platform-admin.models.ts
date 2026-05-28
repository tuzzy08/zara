import type { PlatformRole } from "@zara/core";

export interface PlatformAdminDashboard {
  systemHealth: {
    status: "operational" | "degraded" | "outage";
    activeIncidents: number;
    traceCoveragePercent: number;
  };
  tenants: {
    total: number;
    active: number;
    suspended: number;
    flagged: number;
  };
  calls: {
    active: number;
    failedLastHour: number;
    escalatedLastHour: number;
  };
  runtime: {
    status: "healthy" | "degraded" | "outage";
    sttProvider: string;
    ttsProvider: string;
    modelProvider: string;
  };
  spend: {
    monthToDateUsd: number;
    premiumRealtimeUsd: number;
    tenantsOverBudget: number;
  };
  queues: {
    abuseReviewCount: number;
    complianceReviewCount: number;
    supportQueueCount: number;
  };
}

export interface PlatformAdminAuditEntry {
  id: string;
  actorUserId: string;
  actorRole: PlatformRole;
  targetType: string;
  targetId: string;
  tenantId?: string | undefined;
  action: string;
  outcome: "succeeded" | "failed";
  metadata: Record<string, string | number | boolean>;
  impersonationSessionId?: string | undefined;
  occurredAt: string;
}

export type PlatformOrganizationStatus = "active" | "suspended" | "trialing";

export interface PlatformOrganizationSummary {
  id: string;
  name: string;
  status: PlatformOrganizationStatus;
  plan: "starter" | "scale" | "enterprise";
  usage: {
    monthToDateUsd: number;
    callMinutes: number;
    premiumRealtimeMinutes: number;
    overBudget: boolean;
  };
  telephony: {
    connectionModes: string[];
    failingRoutes: number;
    webhookFailures: number;
  };
  integrations: {
    connectedProviders: string[];
    failingSyncs: number;
    revokedConnections: number;
  };
  riskFlags: string[];
  billingControls: PlatformBillingControls;
}

export interface PlatformBillingControls {
  monthlyBudgetUsd: number;
  premiumRealtimeEnabled: boolean;
  planLimitOverride?: string | undefined;
}

export interface PlatformSupportUser {
  id: string;
  name: string;
  email: string;
  status: "active" | "deleted";
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    role: string;
  }>;
}

export interface PlatformSupportAction {
  id: string;
  targetUserId: string;
  organizationId: string;
  action: "mark_membership_reviewed";
  status: "completed";
  performedAt: string;
}

export interface PlatformTelephonyConnection {
  id: string;
  organizationId: string;
  organizationName: string;
  mode: "platform_managed" | "byo_sip_trunk" | "byo_provider_account";
  provider: string;
  health: "healthy" | "degraded" | "disabled";
  routeFailures: number;
  webhookFailures: number;
  activeCalls: number;
}

export interface PlatformIntegrationConnection {
  id: string;
  organizationId: string;
  organizationName: string;
  provider: string;
  tokenStatus: "healthy" | "refresh_failed" | "expired";
  revocationState: "active" | "revoked";
  syncFailures: number;
  reconnectDiagnostic: string;
}

export interface PlatformRuntimeProviderHealth {
  id: string;
  kind: "stt" | "tts" | "model" | "realtime" | "telephony" | "queue";
  provider: string;
  region: string;
  severity: "info" | "warning" | "critical";
  outageState: "healthy" | "degraded" | "outage";
  lastEventAt: string;
}

export interface PlatformAiRuntimeObservability {
  summary: {
    intentFallbackRate: number;
    averageClassifierConfidence: number;
    toolUseRate: number;
    toolFailureRate: number;
    transferLoopPreventionCount: number;
    policyWarningCount: number;
    packetTruncationCount: number;
    langSmithExportSuccessRate: number;
    langSmithExportFailureCount: number;
    evalRegressionStatus: "passing" | "attention_required" | "blocked";
  };
  pstnCallQuality: {
    firstResponseLatencyP95Ms: number;
    noFrameTimeoutCount: number;
    sttReconnectCount: number;
    ttsFirstByteTimeoutCount: number;
    modelTimeoutCount: number;
    bridgeErrorCount: number;
    bargeInCount: number;
    successfulPhoneTestRate: number;
    twilioStopReasons: Record<"caller_hangup" | "completed" | "provider_error", number>;
    releaseGate: {
      command: "npm run eval:pstn";
      status: "passing" | "attention_required" | "blocked";
    };
  };
  evalGate: {
    command: "npm run eval:runtime";
    failClosedForProtectedChanges: boolean;
    protectedChangeCategories: Array<"prompt" | "model" | "routing" | "tool" | "transfer" | "policy">;
    deterministicThreshold: {
      requiredPassRate: 1;
      suiteIds: string[];
    };
    llmJudgeThreshold: {
      minimumScore: number;
      manualReviewFallback: boolean;
    };
    emergencyOverride: {
      allowedWhenLangSmithUnavailable: boolean;
      requiresLocalDeterministicPass: boolean;
      requiresOwnerSignoff: boolean;
      requiresExceptionRecord: boolean;
    };
    failingRuns: Array<{
      id: string;
      suite: string;
      langSmithExperimentUrl: string;
      localTraceIds: string[];
      redactionState: "redacted";
      owner: string;
    }>;
  };
}

export interface PlatformImpersonationSession {
  id: string;
  organizationId: string;
  targetUserId: string;
  actorUserId: string;
  reason: string;
  visibleBanner: true;
  destructiveActionsAllowed: boolean;
  status: "active" | "revoked" | "expired";
  startedAt: string;
  expiresAt: string;
  revokedAt?: string | undefined;
}

export type PlatformReviewSignalKind =
  | "outbound_abuse"
  | "dnc_violation"
  | "consent_issue"
  | "prompt_injection"
  | "suspension_recommendation";

export interface PlatformAbuseComplianceReview {
  id: string;
  organizationId: string;
  signalKind: PlatformReviewSignalKind;
  severity: "low" | "medium" | "high";
  status: "open" | "dismissed" | "escalated";
  summary: string;
  safeNextActions: string[];
  lastSignalAt: string;
  decidedByUserId?: string | undefined;
  decisionNote?: string | undefined;
}
