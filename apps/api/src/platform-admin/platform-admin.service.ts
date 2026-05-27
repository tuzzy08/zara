import { Injectable, NotFoundException } from "@nestjs/common";
import type { PlatformRole } from "@zara/core";

import { AuditLogService } from "../compliance/audit-log.service";
import type { UpdateRuntimePromptPolicyInput } from "../runtime-prompt-policy/runtime-prompt-policy.models";
import { RuntimePromptPolicyService } from "../runtime-prompt-policy/runtime-prompt-policy.service";
import type {
  PlatformAbuseComplianceReview,
  PlatformAdminAuditEntry,
  PlatformAdminDashboard,
  PlatformBillingControls,
  PlatformImpersonationSession,
  PlatformIntegrationConnection,
  PlatformOrganizationStatus,
  PlatformOrganizationSummary,
  PlatformRuntimeProviderHealth,
  PlatformSupportAction,
  PlatformSupportUser,
  PlatformTelephonyConnection,
} from "./platform-admin.models";
import type { PlatformAdminRequestContext } from "./platform-admin.guard";

@Injectable()
export class PlatformAdminService {
  private readonly organizations = seedOrganizations();
  private readonly users = seedUsers();
  private readonly telephonyConnections = seedTelephonyConnections();
  private readonly integrationConnections = seedIntegrationConnections();
  private readonly runtimeProviders = seedRuntimeProviders();
  private readonly reviews = seedReviews();
  private readonly impersonationSessions: PlatformImpersonationSession[] = [];
  private readonly auditLogs: PlatformAdminAuditEntry[] = [];

  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly runtimePromptPolicyService: RuntimePromptPolicyService,
  ) {}

  getDashboard(): PlatformAdminDashboard {
    return {
      systemHealth: {
        status: "operational",
        activeIncidents: 0,
        traceCoveragePercent: 99,
      },
      tenants: {
        total: 3,
        active: 2,
        suspended: 1,
        flagged: 1,
      },
      calls: {
        active: 8,
        failedLastHour: 1,
        escalatedLastHour: 2,
      },
      runtime: {
        status: "healthy",
        sttProvider: "assemblyai-streaming",
        ttsProvider: "cartesia-sonic-3",
        modelProvider: "openai",
      },
      spend: {
        monthToDateUsd: 1842.55,
        premiumRealtimeUsd: 318.2,
        tenantsOverBudget: 1,
      },
      queues: {
        abuseReviewCount: 2,
        complianceReviewCount: 1,
        supportQueueCount: 3,
      },
    };
  }

  listOrganizations() {
    return clone(this.organizations);
  }

  getOrganization(organizationId: string) {
    return clone(this.findOrganization(organizationId));
  }

  updateOrganizationStatus(
    context: PlatformAdminRequestContext,
    organizationId: string,
    input: { status: PlatformOrganizationStatus; reason: string },
  ) {
    const organization = this.findOrganization(organizationId);

    organization.status = input.status;

    return {
      organization: clone(organization),
      audit: this.recordAudit(context, {
        tenantId: organization.id,
        targetType: "organization",
        targetId: organization.id,
        action: "platform.organization.status_updated",
        metadata: {
          status: input.status,
          reason: input.reason,
        },
      }),
    };
  }

  listUsers() {
    return clone(this.users);
  }

  createSupportAction(
    context: PlatformAdminRequestContext,
    targetUserId: string,
    input: { action: PlatformSupportAction["action"]; organizationId: string },
  ) {
    const targetUser = this.users.find((user) => user.id === targetUserId);

    if (targetUser === undefined) {
      throw new NotFoundException(`User '${targetUserId}' was not found.`);
    }

    this.findOrganization(input.organizationId);

    const action: PlatformSupportAction = {
      id: `support_action_${this.auditLogs.length + 1}`,
      targetUserId,
      organizationId: input.organizationId,
      action: input.action,
      status: "completed",
      performedAt: "2026-05-24T09:00:00.000Z",
    };

    return {
      action: clone(action),
      audit: this.recordAudit(context, {
        tenantId: input.organizationId,
        targetType: "user",
        targetId: targetUserId,
        action: `platform.user_support.${input.action}`,
        metadata: {
          supportActionId: action.id,
        },
      }),
    };
  }

  listTelephonyConnections() {
    return clone(this.telephonyConnections);
  }

  listIntegrationConnections() {
    return clone(this.integrationConnections);
  }

  listRuntimeProviders() {
    return clone(this.runtimeProviders);
  }

  async getRuntimePromptPolicy() {
    return this.runtimePromptPolicyService.getPromptPolicy();
  }

  async updateRuntimePromptPolicy(
    context: PlatformAdminRequestContext,
    input: UpdateRuntimePromptPolicyInput,
  ) {
    const result = await this.runtimePromptPolicyService.updatePromptPolicy({
      ...input,
      actorUserId: context.actorUserId,
      updatedAt: "2026-05-24T09:00:00.000Z",
    });

    return {
      promptPolicy: result.promptPolicy,
      audit: this.recordAudit(context, {
        targetType: "runtime_prompt_policy",
        targetId: "global",
        action: "platform.runtime_prompt_policy.updated",
        metadata: {
          reason: result.reason,
          version: result.promptPolicy.version,
          guardrailCount: result.guardrailCount,
          changedRoleKeys: result.changedRoleKeys.join(","),
        },
      }),
    };
  }

  updateBillingControls(
    context: PlatformAdminRequestContext,
    organizationId: string,
    input: Partial<PlatformBillingControls>,
  ) {
    const organization = this.findOrganization(organizationId);

    organization.billingControls = {
      ...organization.billingControls,
      ...input,
    };

    return {
      billingControls: clone(organization.billingControls),
      audit: this.recordAudit(context, {
        tenantId: organization.id,
        targetType: "billing_controls",
        targetId: organization.id,
        action: "platform.billing_controls.updated",
        metadata: {
          monthlyBudgetUsd: organization.billingControls.monthlyBudgetUsd,
          premiumRealtimeEnabled: organization.billingControls.premiumRealtimeEnabled,
        },
      }),
    };
  }

  async createImpersonationSession(
    context: PlatformAdminRequestContext,
    organizationId: string,
    input: {
      targetUserId: string;
      reason: string;
      destructiveActionsAllowed?: boolean | undefined;
      ttlMinutes?: number | undefined;
    },
  ) {
    this.findOrganization(organizationId);

    const startedAt = "2026-05-24T09:00:00.000Z";
    const ttlMinutes = Math.max(1, Math.min(input.ttlMinutes ?? 15, 30));
    const session: PlatformImpersonationSession = {
      id: `imp_${this.impersonationSessions.length + 1}`,
      organizationId,
      targetUserId: input.targetUserId,
      actorUserId: context.actorUserId,
      reason: input.reason,
      visibleBanner: true,
      destructiveActionsAllowed: input.destructiveActionsAllowed === true,
      status: "active",
      startedAt,
      expiresAt: new Date(Date.parse(startedAt) + ttlMinutes * 60_000).toISOString(),
    };

    this.impersonationSessions.push(session);
    const audit = this.recordAudit(context, {
      tenantId: organizationId,
      targetType: "impersonation_session",
      targetId: session.id,
      action: "platform.impersonation.started",
      metadata: {
        targetUserId: session.targetUserId,
        destructiveActionsAllowed: session.destructiveActionsAllowed,
      },
      impersonationSessionId: session.id,
    });
    const tenantAudit = await this.auditLogService.record({
      tenantId: organizationId,
      actorUserId: context.actorUserId,
      action: "platform.impersonation.started",
      target: {
        type: "impersonation_session",
        id: session.id,
      },
      outcome: "succeeded",
      metadata: {
        impersonationSessionId: session.id,
        platformAuditId: audit.id,
        destructiveActionsAllowed: session.destructiveActionsAllowed,
      },
      occurredAt: session.startedAt,
    });

    return {
      session: clone(session),
      audit,
      tenantAudit,
    };
  }

  async revokeImpersonationSession(context: PlatformAdminRequestContext, sessionId: string) {
    const session = this.impersonationSessions.find((candidate) => candidate.id === sessionId);

    if (session === undefined) {
      throw new NotFoundException(`Impersonation session '${sessionId}' was not found.`);
    }

    session.status = "revoked";
    session.revokedAt = "2026-05-24T09:10:00.000Z";

    const audit = this.recordAudit(context, {
      tenantId: session.organizationId,
      targetType: "impersonation_session",
      targetId: session.id,
      action: "platform.impersonation.revoked",
      metadata: {},
      impersonationSessionId: session.id,
    });
    const tenantAudit = await this.auditLogService.record({
      tenantId: session.organizationId,
      actorUserId: context.actorUserId,
      action: "platform.impersonation.revoked",
      target: {
        type: "impersonation_session",
        id: session.id,
      },
      outcome: "succeeded",
      metadata: {
        impersonationSessionId: session.id,
        platformAuditId: audit.id,
      },
      occurredAt: session.revokedAt,
    });

    return {
      session: clone(session),
      audit,
      tenantAudit,
    };
  }

  listReviews() {
    return clone(this.reviews);
  }

  decideReview(
    context: PlatformAdminRequestContext,
    reviewId: string,
    input: { decision: "dismissed" | "escalated"; note: string },
  ) {
    const review = this.reviews.find((candidate) => candidate.id === reviewId);

    if (review === undefined) {
      throw new NotFoundException(`Review '${reviewId}' was not found.`);
    }

    review.status = input.decision;
    review.decidedByUserId = context.actorUserId;
    review.decisionNote = input.note;

    return {
      review: clone(review),
      audit: this.recordAudit(context, {
        tenantId: review.organizationId,
        targetType: "abuse_compliance_review",
        targetId: review.id,
        action: "platform.abuse_review.decided",
        metadata: {
          decision: input.decision,
          note: input.note,
        },
      }),
    };
  }

  listAuditLogs(filters: {
    actorUserId?: string | undefined;
    tenantId?: string | undefined;
    action?: string | undefined;
  }) {
    return clone(this.auditLogs.filter((entry) => {
      if (filters.actorUserId !== undefined && entry.actorUserId !== filters.actorUserId) {
        return false;
      }

      if (filters.tenantId !== undefined && entry.tenantId !== filters.tenantId) {
        return false;
      }

      return !(filters.action !== undefined && entry.action !== filters.action);
    }));
  }

  private findOrganization(organizationId: string) {
    const organization = this.organizations.find((candidate) => candidate.id === organizationId);

    if (organization === undefined) {
      throw new NotFoundException(`Organization '${organizationId}' was not found.`);
    }

    return organization;
  }

  private recordAudit(
    context: PlatformAdminRequestContext,
    input: {
      tenantId?: string | undefined;
      targetType: string;
      targetId: string;
      action: string;
      metadata: Record<string, string | number | boolean>;
      impersonationSessionId?: string | undefined;
    },
  ) {
    const entry: PlatformAdminAuditEntry = {
      id: `platform_audit_${this.auditLogs.length + 1}`,
      actorUserId: context.actorUserId,
      actorRole: context.platformRole,
      tenantId: input.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      outcome: "succeeded",
      metadata: { ...input.metadata },
      impersonationSessionId: input.impersonationSessionId,
      occurredAt: "2026-05-24T09:00:00.000Z",
    };

    this.auditLogs.push(entry);

    return clone(entry);
  }
}

export function canMutatePlatform(role: PlatformRole) {
  return role === "platform_owner" || role === "platform_admin";
}

export function canRunSupportAction(role: PlatformRole) {
  return canMutatePlatform(role) || role === "platform_support";
}

function seedOrganizations(): PlatformOrganizationSummary[] {
  return [
    {
      id: "tenant-west-africa",
      name: "Tuzzy Labs",
      status: "active",
      plan: "scale",
      usage: {
        monthToDateUsd: 1260.42,
        callMinutes: 8432,
        premiumRealtimeMinutes: 82,
        overBudget: false,
      },
      telephony: {
        connectionModes: ["platform_managed", "byo_sip_trunk", "byo_provider_account"],
        failingRoutes: 1,
        webhookFailures: 2,
      },
      integrations: {
        connectedProviders: ["hubspot", "zendesk", "google-workspace"],
        failingSyncs: 1,
        revokedConnections: 0,
      },
      riskFlags: ["prompt_injection_flag", "outbound_velocity_watch"],
      billingControls: {
        monthlyBudgetUsd: 1500,
        premiumRealtimeEnabled: true,
      },
    },
    {
      id: "tenant-healthdesk",
      name: "Healthdesk Reception",
      status: "trialing",
      plan: "starter",
      usage: {
        monthToDateUsd: 248.1,
        callMinutes: 982,
        premiumRealtimeMinutes: 12,
        overBudget: false,
      },
      telephony: {
        connectionModes: ["platform_managed"],
        failingRoutes: 0,
        webhookFailures: 0,
      },
      integrations: {
        connectedProviders: ["notion"],
        failingSyncs: 0,
        revokedConnections: 1,
      },
      riskFlags: ["data_residency_gap"],
      billingControls: {
        monthlyBudgetUsd: 500,
        premiumRealtimeEnabled: false,
      },
    },
  ];
}

function seedUsers(): PlatformSupportUser[] {
  return [
    {
      id: "user-ops-lead",
      name: "Ops Lead",
      email: "ops@example.com",
      status: "active",
      memberships: [
        {
          organizationId: "tenant-west-africa",
          organizationName: "Tuzzy Labs",
          role: "owner",
        },
      ],
    },
    {
      id: "user-finance",
      name: "Finance",
      email: "finance@example.com",
      status: "active",
      memberships: [
        {
          organizationId: "tenant-west-africa",
          organizationName: "Tuzzy Labs",
          role: "viewer",
        },
      ],
    },
  ];
}

function seedTelephonyConnections(): PlatformTelephonyConnection[] {
  return [
    {
      id: "tel-platform-1",
      organizationId: "tenant-west-africa",
      organizationName: "Tuzzy Labs",
      mode: "platform_managed",
      provider: "twilio",
      health: "healthy",
      routeFailures: 0,
      webhookFailures: 0,
      activeCalls: 3,
    },
    {
      id: "tel-sip-1",
      organizationId: "tenant-west-africa",
      organizationName: "Tuzzy Labs",
      mode: "byo_sip_trunk",
      provider: "custom-sip",
      health: "degraded",
      routeFailures: 1,
      webhookFailures: 0,
      activeCalls: 1,
    },
    {
      id: "tel-byo-1",
      organizationId: "tenant-west-africa",
      organizationName: "Tuzzy Labs",
      mode: "byo_provider_account",
      provider: "twilio",
      health: "degraded",
      routeFailures: 0,
      webhookFailures: 2,
      activeCalls: 4,
    },
  ];
}

function seedIntegrationConnections(): PlatformIntegrationConnection[] {
  return [
    {
      id: "int-hubspot-1",
      organizationId: "tenant-west-africa",
      organizationName: "Tuzzy Labs",
      provider: "hubspot",
      tokenStatus: "healthy",
      revocationState: "active",
      syncFailures: 0,
      reconnectDiagnostic: "No reconnect required.",
    },
    {
      id: "int-zendesk-1",
      organizationId: "tenant-west-africa",
      organizationName: "Tuzzy Labs",
      provider: "zendesk",
      tokenStatus: "refresh_failed",
      revocationState: "active",
      syncFailures: 2,
      reconnectDiagnostic: "Refresh failed; tenant admin should reconnect the provider.",
    },
  ];
}

function seedRuntimeProviders(): PlatformRuntimeProviderHealth[] {
  return [
    providerHealth("stt-assemblyai-us", "stt", "assemblyai-streaming", "us-east", "healthy", "info"),
    providerHealth("tts-cartesia-us", "tts", "cartesia-sonic-3", "us-east", "healthy", "info"),
    providerHealth("model-openai-us", "model", "openai", "us-east", "healthy", "info"),
    providerHealth("realtime-openai-us", "realtime", "openai-realtime", "us-east", "degraded", "warning"),
    providerHealth("telephony-twilio-us", "telephony", "twilio", "us-east", "healthy", "info"),
    providerHealth("queue-background-us", "queue", "zara-background", "us-east", "healthy", "info"),
  ];
}

function providerHealth(
  id: string,
  kind: PlatformRuntimeProviderHealth["kind"],
  provider: string,
  region: string,
  outageState: PlatformRuntimeProviderHealth["outageState"],
  severity: PlatformRuntimeProviderHealth["severity"],
): PlatformRuntimeProviderHealth {
  return {
    id,
    kind,
    provider,
    region,
    severity,
    outageState,
    lastEventAt: "2026-05-24T09:00:00.000Z",
  };
}

function seedReviews(): PlatformAbuseComplianceReview[] {
  return [
    review("review-abuse", "outbound_abuse", "high", "Outbound velocity exceeded tenant policy."),
    review("review-dnc", "dnc_violation", "high", "Outbound attempt matched tenant do-not-call list."),
    review("review-consent", "consent_issue", "medium", "Recording consent notice was not confirmed."),
    review("review-prompt", "prompt_injection", "medium", "Tool output attempted to override system policy."),
    review("review-suspend", "suspension_recommendation", "high", "Tenant should be reviewed for temporary suspension."),
  ];
}

function review(
  id: string,
  signalKind: PlatformAbuseComplianceReview["signalKind"],
  severity: PlatformAbuseComplianceReview["severity"],
  summary: string,
): PlatformAbuseComplianceReview {
  return {
    id,
    organizationId: "tenant-west-africa",
    signalKind,
    severity,
    status: "open",
    summary,
    safeNextActions: ["Review evidence", "Escalate to policy owner", "Dismiss with reason"],
    lastSignalAt: "2026-05-24T08:55:00.000Z",
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
