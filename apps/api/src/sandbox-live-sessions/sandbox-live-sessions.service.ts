import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  createCostOptimizedSandwichRuntimeAdapter,
  createAgentTurnContext,
  estimateRuntimeCost,
  parseAgentActionText,
  recordRuntimePacketWarning,
  type CompiledRuntimeManifest,
  type AgentAction,
  type ParsedAgentAction,
  type ModelRoutingContext,
  type RuntimePacketEvent,
  type RuntimeUntrustedContextItem,
  type RuntimeCallPhase,
  type RuntimeUsageMetrics,
  type SandwichTextModelProvider,
  type SandwichTtsProvider,
  type TextModelProviderId,
  type TranscriptTurn,
  type TurnRuntimePacket,
  type VoiceAgentRole,
} from "@zara/core";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { ToolPermissionGrantsService } from "../integrations/tool-permission-grants.service";
import {
  runtimeObservabilityRecorderToken,
  type RuntimeObservabilityRecorder,
  type RuntimeObservabilityRecorderResult,
} from "../runtime-observability/runtime-observability";
import { WorkspacesService } from "../workspaces/workspaces.service";
import {
  resolveLiveSandboxAgentRouteAction,
  resolveLiveSandboxTurnRoute,
  type LiveSandboxIntentClassifier,
  type LiveSandboxRouteEvent,
} from "./sandbox-live-session-router";
import {
  RuntimeAgentToolExecutorService,
  type RuntimeAgentToolSideEffectEvent,
} from "./runtime-agent-tool-executor.service";
import {
  liveSandboxIntentClassifierProviderToken,
  liveSandboxSttProviderToken,
  liveSandboxTextModelProviderToken,
  liveSandboxToolRegistryToken,
  liveSandboxTtsProviderToken,
  type LiveSandboxSttProvider,
  type LiveSandboxSttStreamingConfiguration,
  type LiveSandboxSttStreamingSession,
  type LiveSandboxProviderAvailability,
  type LiveSandboxToolRegistry,
} from "./sandbox-live-sessions.providers";
import type {
  CreateLiveSandboxSessionRequest,
  LiveSandboxAudioAppendMessage,
  LiveSandboxAudioCommitMessage,
  LiveSandboxClientMessage,
  LiveSandboxEscalationRecord,
  LiveSandboxPostCallCrmSyncStatusResponse,
  LiveSandboxPostCallCrmSyncTarget,
  LiveSandboxPostCallDisposition,
  LiveSandboxPostCallOutcome,
  LiveSandboxPostCallSummaryResponse,
  LiveSandboxProviderStack,
  LiveSandboxQualityFlag,
  LiveSandboxQualityReportResponse,
  LiveSandboxSessionSummary,
  LiveSandboxTelemetryAggregateResponse,
  LiveSandboxTelemetryCallSummary,
  LiveSandboxSessionMemoryResponse,
  LiveSandboxStreamEvent,
  LiveSandboxSessionRecord,
  LiveSandboxSessionResponse,
  LiveSandboxTextInputMessage,
} from "./sandbox-live-sessions.models";

const liveSandboxTtsProviderId = "cartesia-sonic-3" as const;

const defaultTtlMinutes = 10;
const defaultEscalationSlaSeconds = 120;
const defaultMaxAgentToolCallsPerTurn = 2;
const transportSigningSecret =
  process.env.SANDBOX_TRANSPORT_TOKEN_SECRET?.trim()
  || process.env.BETTER_AUTH_SECRET?.trim()
  || "zara-dev-sandbox-transport-secret";

interface LiveSandboxTransportAuditEntry {
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  source: string;
  reason:
    | "token_accepted"
    | "token_replay"
    | "token_expired"
    | "workspace_scope_mismatch"
    | "source_scope_mismatch"
    | "token_invalid";
  at: string;
}

@Injectable()
export class SandboxLiveSessionsService {
  private readonly logger = new Logger(SandboxLiveSessionsService.name);
  private readonly sessionsByOrganizationId = new Map<string, Map<string, LiveSandboxSessionRecord>>();
  private readonly manifestsBySessionKey = new Map<string, CompiledRuntimeManifest>();
  private readonly frontierBySessionKey = new Map<string, string[]>();
  private readonly bufferedAudioFramesBySessionKey = new Map<string, string[]>();
  private readonly streamingSttSessionsBySessionKey = new Map<string, LiveSandboxSttStreamingSession>();
  private readonly streamingSttStartedAtBySessionKey = new Map<string, number>();
  private readonly streamingSttFirstPartialAtBySessionKey = new Map<string, number>();
  private readonly streamingSttLastPartialAtBySessionKey = new Map<string, number>();
  private readonly streamingSttFrameCountBySessionKey = new Map<string, number>();
  private readonly streamingSttCallPhaseBySessionKey = new Map<string, RuntimeCallPhase>();
  private readonly streamingSttIntentBySessionKey = new Map<string, string>();
  private readonly streamingSttTurnInFlightBySessionKey = new Set<string>();
  private readonly listenersBySessionKey = new Map<string, Set<(event: LiveSandboxStreamEvent) => void>>();
  private readonly eventsBySessionKey = new Map<string, LiveSandboxStreamEvent[]>();
  private readonly sequenceBySessionKey = new Map<string, number>();
  private readonly escalationsByOrganizationId = new Map<string, Map<string, LiveSandboxEscalationRecord>>();
  private readonly postCallSummariesBySessionKey = new Map<string, LiveSandboxPostCallSummaryResponse>();
  private readonly transportSecurityAudits: LiveSandboxTransportAuditEntry[] = [];

  constructor(
    private readonly workspacesService: WorkspacesService,
    @Inject(liveSandboxTextModelProviderToken)
    private readonly textModelProvider: SandwichTextModelProvider,
    @Inject(liveSandboxSttProviderToken)
    private readonly sttProvider: LiveSandboxSttProvider,
    @Inject(liveSandboxTtsProviderToken)
    private readonly ttsProvider: SandwichTtsProvider,
    @Inject(liveSandboxIntentClassifierProviderToken)
    private readonly intentClassifier: LiveSandboxIntentClassifier,
    @Inject(liveSandboxToolRegistryToken)
    private readonly toolRegistry: LiveSandboxToolRegistry,
    @Inject(runtimeObservabilityRecorderToken)
    private readonly runtimeObservabilityRecorder: RuntimeObservabilityRecorder,
    private readonly toolPermissionGrantsService: ToolPermissionGrantsService,
    private readonly runtimeAgentToolExecutor: RuntimeAgentToolExecutorService,
  ) {}

  private getSttProviderId(): LiveSandboxProviderStack["stt"] {
    return this.sttProvider.providerId ?? "assemblyai-streaming";
  }

  private getProviderStack(): LiveSandboxProviderStack {
    return {
      stt: this.getSttProviderId(),
      tts: liveSandboxTtsProviderId,
    };
  }

  async createSession(
    organizationId: string,
    input: CreateLiveSandboxSessionRequest,
  ): Promise<LiveSandboxSessionResponse> {
    this.assertUserCanAccessWorkspace({
      organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
    });
    this.assertManifestWorkspace(input.manifest, input.workspaceId);
    this.assertProviderStackReady(input);
    this.assertSelectedTextModelReady(input);
    this.assertSttProviderSupportsManifest(input.manifest);
    await this.assertPublishedToolGrants(organizationId, input);

    const createdAt = input.now ?? new Date().toISOString();
    const expiresAt = addMinutes(createdAt, input.ttlMinutes ?? defaultTtlMinutes);
    const sessionId = `sandbox-live-${randomUUID()}`;
    const transportToken = createSignedTransportToken({
      organizationId,
      workspaceId: input.workspaceId,
      sessionId,
      source: input.source,
      expiresAt,
    });
    const session: LiveSandboxSessionRecord = {
      sessionId,
      organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      source: input.source,
      inputMode: input.inputMode,
      entryRoleId: input.entryRoleId,
      manifestId: input.manifest.manifestId,
      publishedVersionId: input.manifest.publishedVersionId,
      runtimeProfile: input.manifest.runtimeProfile,
      transportUrl: buildTransportUrl(organizationId, sessionId),
      transportTokenHash: hashTransportToken(transportToken),
      providerStack: this.getProviderStack(),
      createdAt,
      expiresAt,
      status: "ready",
      memory: {
        status: "active",
        entries: [],
        updatedAt: createdAt,
      },
    };

    const organizationSessions = this.getOrCreateOrganizationSessions(organizationId);
    organizationSessions.set(sessionId, session);
    const sessionKey = getSessionKey(organizationId, sessionId);
    this.sequenceBySessionKey.set(sessionKey, 0);
    this.manifestsBySessionKey.set(sessionKey, cloneManifest(input.manifest));
    this.frontierBySessionKey.set(sessionKey, [input.manifest.entryNodeId]);
    this.bufferedAudioFramesBySessionKey.set(sessionKey, []);
    this.eventsBySessionKey.set(sessionKey, []);
    if (input.inputMode === "voice") {
      void Promise.resolve(this.ttsProvider.warm?.()).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Cartesia warmup failed.";
        this.logger.warn(`Live sandbox TTS warmup failed: ${message}`);
      });
    }

    return toSessionResponse(session, transportToken);
  }

  listSessions(input: {
    organizationId: string;
    workspaceId?: string | undefined;
    includeEnded: boolean;
  }): LiveSandboxSessionSummary[] {
    const organizationSessions = this.sessionsByOrganizationId.get(input.organizationId);

    if (organizationSessions === undefined) {
      return [];
    }

    return [...organizationSessions.values()]
      .map((session) => {
        this.expireIfNeeded(session);
        return session;
      })
      .filter((session) => input.workspaceId === undefined || session.workspaceId === input.workspaceId)
      .filter((session) => input.includeEnded || session.status === "active" || session.status === "ready")
      .map((session) => this.buildSessionSummary(session))
      .sort((left, right) => Date.parse(right.lastEventAt) - Date.parse(left.lastEventAt));
  }

  getSession(organizationId: string, sessionId: string): LiveSandboxSessionResponse {
    const session = this.requireSession(organizationId, sessionId);
    this.expireIfNeeded(session);
    return toSessionResponse(session);
  }

  getTelemetryAggregate(input: {
    organizationId: string;
    workspaceId?: string | undefined;
  }): LiveSandboxTelemetryAggregateResponse {
    const organizationSessions = this.sessionsByOrganizationId.get(input.organizationId);
    const sessions =
      organizationSessions === undefined
        ? []
        : [...organizationSessions.values()]
            .map((session) => {
              this.expireIfNeeded(session);
              return session;
            })
            .filter((session) => input.workspaceId === undefined || session.workspaceId === input.workspaceId);
    const calls = sessions
      .map((session) => this.buildTelemetryCallSummary(session))
      .sort((left, right) => Date.parse(right.lastEventAt) - Date.parse(left.lastEventAt));

    return {
      organizationId: input.organizationId,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      callCount: calls.length,
      totals: {
        costUsd: roundMetric(sumBy(calls, (call) => call.costUsd)),
        modelLatencyMs: sumBy(calls, (call) => call.modelLatencyMs),
        sttLatencyMs: sumBy(calls, (call) => call.sttLatencyMs),
        ttsLatencyMs: sumBy(calls, (call) => call.ttsLatencyMs),
        toolDurationMs: sumBy(calls, (call) => call.toolDurationMs),
        toolCount: sumBy(calls, (call) => call.toolCount),
        modelInputTokens: sumBy(calls, (call) => call.modelInputTokens),
        modelOutputTokens: sumBy(calls, (call) => call.modelOutputTokens),
        ttsCharacters: sumBy(calls, (call) => call.ttsCharacters),
        callMinutes: roundMetric(sumBy(calls, (call) => call.callMinutes)),
        sttMinutes: roundMetric(sumBy(calls, (call) => call.sttMinutes)),
        missingUsageEventCount: calls.filter((call) => call.missingUsageData).length,
      },
      calls,
    };
  }

  listEscalations(input: {
    organizationId: string;
    workspaceId?: string | undefined;
    now?: string | undefined;
  }): LiveSandboxEscalationRecord[] {
    this.applyEscalationTimeouts(input.organizationId, input.now ?? new Date().toISOString());
    const organizationEscalations = this.escalationsByOrganizationId.get(input.organizationId);

    if (organizationEscalations === undefined) {
      return [];
    }

    return [...organizationEscalations.values()]
      .filter((escalation) => input.workspaceId === undefined || escalation.workspaceId === input.workspaceId)
      .map(cloneEscalation)
      .sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt));
  }

  acceptEscalation(input: {
    organizationId: string;
    escalationId: string;
    actorUserId: string;
    now?: string | undefined;
  }): LiveSandboxEscalationRecord {
    const escalation = this.requireEscalation(input.organizationId, input.escalationId);
    this.assertEscalationPending(escalation);
    const resolvedAt = input.now ?? new Date().toISOString();

    escalation.status = "accepted";
    escalation.acceptedByUserId = input.actorUserId;
    escalation.resolvedAt = resolvedAt;
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: escalation.sessionId,
      type: "escalation.accepted",
      at: resolvedAt,
      payload: {
        escalationId: escalation.escalationId,
        nodeId: escalation.nodeId,
        queueId: escalation.queueId,
        acceptedByUserId: input.actorUserId,
      },
    });

    return cloneEscalation(escalation);
  }

  declineEscalation(input: {
    organizationId: string;
    escalationId: string;
    actorUserId: string;
    reason?: string | undefined;
    now?: string | undefined;
  }): LiveSandboxEscalationRecord {
    const escalation = this.requireEscalation(input.organizationId, input.escalationId);
    this.assertEscalationPending(escalation);
    const resolvedAt = input.now ?? new Date().toISOString();

    escalation.status = "declined";
    escalation.declinedByUserId = input.actorUserId;
    if (input.reason !== undefined && input.reason.trim().length > 0) {
      escalation.declineReason = input.reason.trim();
    }
    escalation.resolvedAt = resolvedAt;
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: escalation.sessionId,
      type: "escalation.declined",
      at: resolvedAt,
      payload: {
        escalationId: escalation.escalationId,
        nodeId: escalation.nodeId,
        queueId: escalation.queueId,
        declinedByUserId: input.actorUserId,
        ...(escalation.declineReason !== undefined ? { reason: escalation.declineReason } : {}),
      },
    });

    return cloneEscalation(escalation);
  }

  createPostCallSummary(input: {
    organizationId: string;
    sessionId: string;
    actorUserId: string;
    crmSyncTarget?: LiveSandboxPostCallCrmSyncTarget | undefined;
    now?: string | undefined;
  }): LiveSandboxPostCallSummaryResponse {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session);
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const events = this.eventsBySessionKey.get(sessionKey) ?? [];
    const createdAt = input.now ?? new Date().toISOString();
    const summaryId = `post-call-summary-${randomUUID()}`;
    const outcome = inferPostCallOutcome(events);
    const disposition = inferPostCallDisposition(events);
    const actionItems = buildPostCallActionItems(summaryId, events);
    const crmSync = input.crmSyncTarget === undefined
      ? {
          status: "skipped" as const,
          provider: "custom" as const,
          connectionId: "none",
          objectType: "none",
        }
      : {
          status: "queued" as const,
          ...input.crmSyncTarget,
          queuedAt: createdAt,
        };
    const summary: LiveSandboxPostCallSummaryResponse = {
      summaryId,
      organizationId: input.organizationId,
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      outcome,
      disposition,
      summaryText: buildPostCallSummaryText(events),
      actionItems,
      crmSync,
      createdByUserId: input.actorUserId,
      createdAt,
    };

    this.postCallSummariesBySessionKey.set(sessionKey, summary);
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "post_call.summary.created",
      at: createdAt,
      payload: {
        summaryId,
        outcome,
        disposition,
        crmSyncStatus: summary.crmSync.status,
        actionItemCount: actionItems.length,
      },
    });

    return clonePostCallSummary(summary);
  }

  getPostCallCrmSyncStatuses(input: {
    organizationId: string;
    sessionId: string;
  }): LiveSandboxPostCallCrmSyncStatusResponse[] {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session);
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const summary = this.postCallSummariesBySessionKey.get(sessionKey);

    if (summary === undefined) {
      return [];
    }

    const events = this.eventsBySessionKey.get(sessionKey) ?? [];
    return [buildPostCallCrmSyncStatus(summary, session, events)];
  }

  retryPostCallCrmSync(input: {
    organizationId: string;
    sessionId: string;
    summaryId: string;
    actorUserId: string;
    now?: string | undefined;
  }): LiveSandboxPostCallCrmSyncStatusResponse {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.assertUserCanAccessWorkspace({
      organizationId: input.organizationId,
      workspaceId: session.workspaceId,
      actorUserId: input.actorUserId,
    });
    this.expireIfNeeded(session, input.now);
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const summary = this.postCallSummariesBySessionKey.get(sessionKey);

    if (summary === undefined || summary.summaryId !== input.summaryId) {
      throw new NotFoundException(`Post-call summary '${input.summaryId}' was not found.`);
    }

    const events = this.eventsBySessionKey.get(sessionKey) ?? [];
    const currentStatus = buildPostCallCrmSyncStatus(summary, session, events);

    if (currentStatus.status === "skipped") {
      throw new ConflictException(`Post-call summary '${input.summaryId}' has no CRM sync target.`);
    }

    const blockingSideEffect = findBlockingCrmSyncSideEffect(summary, events);
    if (blockingSideEffect !== undefined) {
      throw new ConflictException(
        `Post-call CRM sync for summary '${input.summaryId}' needs manual review before retry because a matching provider write has an unknown or completed outcome.`,
      );
    }

    const retryQueuedAt = input.now ?? new Date().toISOString();
    const attemptCount = currentStatus.attemptCount + 1;
    const nextRetryAt = addMinutes(retryQueuedAt, 1);

    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "post_call.crm_sync.retry_queued",
      at: retryQueuedAt,
      payload: {
        summaryId: input.summaryId,
        provider: currentStatus.provider,
        connectionId: currentStatus.connectionId,
        objectType: currentStatus.objectType,
        ...(currentStatus.externalId !== undefined ? { externalId: currentStatus.externalId } : {}),
        attemptCount,
        nextRetryAt,
        requestedByUserId: input.actorUserId,
      },
    });

    return buildPostCallCrmSyncStatus(summary, session, this.eventsBySessionKey.get(sessionKey) ?? []);
  }

  getSessionQualityReport(input: {
    organizationId: string;
    sessionId: string;
  }): LiveSandboxQualityReportResponse {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session);
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const events = this.eventsBySessionKey.get(sessionKey) ?? [];
    const flags = buildQualityFlags(input.sessionId, events);

    return {
      organizationId: input.organizationId,
      workspaceId: session.workspaceId,
      sessionId: input.sessionId,
      flags,
      suggestions: flags.map((flag) => buildImprovementSuggestion(input.sessionId, flag)),
    };
  }

  getSessionEvents(input: {
    organizationId: string;
    sessionId: string;
    afterSequence?: number | undefined;
  }) {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session);
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const events = this.eventsBySessionKey.get(sessionKey) ?? [];

    return events
      .filter((event) => input.afterSequence === undefined || event.sequence > input.afterSequence)
      .map((event) => ({
        ...event,
        payload: clonePayload(event.payload),
      }));
  }

  getSessionMemory(input: {
    organizationId: string;
    sessionId: string;
  }): LiveSandboxSessionMemoryResponse {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session);

    return toSessionMemoryResponse(getOrCreateSessionMemory(session));
  }

  endSession(input: {
    organizationId: string;
    sessionId: string;
    actorUserId: string;
    now?: string | undefined;
  }): LiveSandboxSessionResponse {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.assertUserCanAccessWorkspace({
      organizationId: input.organizationId,
      workspaceId: session.workspaceId,
      actorUserId: input.actorUserId,
    });
    this.expireIfNeeded(session);

    session.status = "ended";
    session.endedAt = input.now ?? new Date().toISOString();
    session.transportTokenHash = "";
    session.transportTokenConsumedAt = input.now ?? new Date().toISOString();
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    summarizeAndClearSessionMemory(session, session.endedAt);
    this.listenersBySessionKey.delete(sessionKey);
    this.frontierBySessionKey.delete(sessionKey);
    this.bufferedAudioFramesBySessionKey.delete(sessionKey);
    this.closeStreamingSttSession(sessionKey, {
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      event: "termination",
      at: session.endedAt,
    });

    return toSessionResponse(session);
  }

  closeSessionAudioStream(input: {
    organizationId: string;
    sessionId: string;
  }) {
    this.closeStreamingSttSession(getSessionKey(input.organizationId, input.sessionId), {
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      event: "termination",
    });
  }

  issueReconnectToken(input: {
    organizationId: string;
    sessionId: string;
    actorUserId: string;
    now?: string | undefined;
  }) {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.assertUserCanAccessWorkspace({
      organizationId: input.organizationId,
      workspaceId: session.workspaceId,
      actorUserId: input.actorUserId,
    });
    this.expireIfNeeded(session, input.now);

    if (session.status === "ended" || session.status === "expired") {
      throw new ConflictException(`Live sandbox session '${input.sessionId}' is no longer resumable.`);
    }

    const transportToken = createSignedTransportToken({
      organizationId: input.organizationId,
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      source: session.source,
      expiresAt: session.expiresAt,
    });

    session.transportTokenHash = hashTransportToken(transportToken);
    session.transportTokenConsumedAt = undefined;

    return toSessionResponse(session, transportToken);
  }

  authorizeTransportConnection(input: {
    organizationId: string;
    sessionId: string;
    token: string;
    workspaceId?: string | undefined;
    source?: string | undefined;
    now?: string | undefined;
  }): boolean {
    const session = this.sessionsByOrganizationId.get(input.organizationId)?.get(input.sessionId);
    const auditedAt = input.now ?? new Date().toISOString();

    if (session === undefined) {
      return false;
    }

    this.expireIfNeeded(session, input.now);

    if (session.status !== "ready" && session.status !== "active") {
      this.recordTransportSecurityAudit({
        session,
        reason: session.status === "expired" ? "token_expired" : "token_replay",
        at: auditedAt,
      });
      return false;
    }

    if (session.transportTokenConsumedAt !== undefined) {
      this.recordTransportSecurityAudit({
        session,
        reason: "token_replay",
        at: auditedAt,
      });
      return false;
    }

    const decodedToken = decodeSignedTransportToken(input.token);

    if (decodedToken === null || hashTransportToken(input.token) !== session.transportTokenHash) {
      this.recordTransportSecurityAudit({
        session,
        reason: "token_invalid",
        at: auditedAt,
      });
      return false;
    }

    if (Date.parse(decodedToken.expiresAt) <= Date.parse(auditedAt)) {
      session.status = "expired";
      session.transportTokenHash = "";
      this.recordTransportSecurityAudit({
        session,
        reason: "token_expired",
        at: auditedAt,
      });
      return false;
    }

    if (
      decodedToken.organizationId !== session.organizationId
      || decodedToken.sessionId !== session.sessionId
      || decodedToken.workspaceId !== session.workspaceId
      || decodedToken.source !== session.source
      || decodedToken.expiresAt !== session.expiresAt
    ) {
      this.recordTransportSecurityAudit({
        session,
        reason: "token_invalid",
        at: auditedAt,
      });
      return false;
    }

    if (input.workspaceId !== undefined && input.workspaceId !== session.workspaceId) {
      this.recordTransportSecurityAudit({
        session,
        reason: "workspace_scope_mismatch",
        at: auditedAt,
      });
      return false;
    }

    if (input.source !== undefined && input.source !== session.source) {
      this.recordTransportSecurityAudit({
        session,
        reason: "source_scope_mismatch",
        at: auditedAt,
      });
      return false;
    }

    session.status = "active";
    session.transportTokenConsumedAt = auditedAt;
    this.recordTransportSecurityAudit({
      session,
      reason: "token_accepted",
      at: auditedAt,
    });
    return true;
  }

  getTransportSecurityAudits() {
    return this.transportSecurityAudits.map((entry) => ({ ...entry }));
  }

  subscribeToSession(
    input: {
      organizationId: string;
      sessionId: string;
    },
    listener: (event: LiveSandboxStreamEvent) => void,
  ) {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session);
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const listeners = this.listenersBySessionKey.get(sessionKey) ?? new Set<(event: LiveSandboxStreamEvent) => void>();
    listeners.add(listener);
    this.listenersBySessionKey.set(sessionKey, listeners);

    return () => {
      const currentListeners = this.listenersBySessionKey.get(sessionKey);

      if (currentListeners === undefined) {
        return;
      }

      currentListeners.delete(listener);

      if (currentListeners.size === 0) {
        this.listenersBySessionKey.delete(sessionKey);
      }
    };
  }

  publishSessionEvent(input: {
    organizationId: string;
    sessionId: string;
    type: string;
    payload: Record<string, unknown>;
    at?: string | undefined;
  }): LiveSandboxStreamEvent {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session);

    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const nextSequence = (this.sequenceBySessionKey.get(sessionKey) ?? 0) + 1;
    this.sequenceBySessionKey.set(sessionKey, nextSequence);

    const event: LiveSandboxStreamEvent = {
      sessionId: input.sessionId,
      sequence: nextSequence,
      type: input.type,
      at: input.at ?? new Date().toISOString(),
      payload: redactPayloadForStorage({
        payload: input.payload,
        redactSensitiveData: shouldRedactSessionPayload({
          sessionKey,
          manifestsBySessionKey: this.manifestsBySessionKey,
        }),
      }),
    };
    this.bumpSessionExpiryOnActivity(session, event.at);
    captureSessionMemoryFromEvent(session, event);
    this.captureEscalationFromEvent(session, event);
    const eventHistory = this.eventsBySessionKey.get(sessionKey) ?? [];
    eventHistory.push(event);
    this.eventsBySessionKey.set(sessionKey, eventHistory);

    const listeners = this.listenersBySessionKey.get(sessionKey);

    if (listeners !== undefined) {
      for (const listener of listeners) {
        listener(event);
      }
    }

    return event;
  }

  async handleClientTransportMessage(input: {
    organizationId: string;
    sessionId: string;
    message: LiveSandboxClientMessage;
    at?: string | undefined;
  }) {
    if (isTextInputMessage(input.message)) {
      const transcript = input.message.transcript.trim();

      if (transcript.length === 0) {
        return null;
      }

      return this.runTypedTurn({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        transcript,
        at: input.at,
        callPhase: normalizeCallPhase(input.message.callPhase),
        intent: normalizeSandboxIntent(input.message.intent),
      });
    }

    if (isAudioAppendMessage(input.message)) {
      const sessionKey = getSessionKey(input.organizationId, input.sessionId);
      const bufferedFrames = this.bufferedAudioFramesBySessionKey.get(sessionKey) ?? [];

      bufferedFrames.push(input.message.audioBase64);
      this.bufferedAudioFramesBySessionKey.set(sessionKey, bufferedFrames);
      const bufferedEvent = this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "input.audio.buffered",
        at: input.at,
        payload: {
          chunkCount: bufferedFrames.length,
        },
      });

      if (this.sttProvider.createStreamingSession !== undefined) {
        this.streamingSttCallPhaseBySessionKey.set(
          sessionKey,
          normalizeCallPhase(input.message.callPhase),
        );
        const intent = normalizeSandboxIntent(input.message.intent);
        if (intent !== undefined) {
          this.streamingSttIntentBySessionKey.set(sessionKey, intent);
        }
        const stream = this.getOrCreateStreamingSttSession({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          sampleRateHz:
            typeof input.message.sampleRateHz === "number" && input.message.sampleRateHz > 0
              ? input.message.sampleRateHz
              : 16_000,
          at: input.at,
        });
        const frameCount = (this.streamingSttFrameCountBySessionKey.get(sessionKey) ?? 0) + 1;
        this.streamingSttFrameCountBySessionKey.set(sessionKey, frameCount);
        if (frameCount === 1) {
          this.publishSessionEvent({
            organizationId: input.organizationId,
            sessionId: input.sessionId,
            type: "provider.telemetry",
            at: input.at,
            payload: {
              stage: "stt",
              provider: this.getSttProviderId(),
              event: "audio_first_frame",
              sampleRateHz:
                typeof input.message.sampleRateHz === "number" && input.message.sampleRateHz > 0
                  ? input.message.sampleRateHz
                  : 16_000,
            },
          });
        }
        stream.appendAudioFrame(input.message.audioBase64);
      }

      return bufferedEvent;
    }

    if (isAudioCommitMessage(input.message)) {
      const sessionKey = getSessionKey(input.organizationId, input.sessionId);
      const streamingSession = this.streamingSttSessionsBySessionKey.get(sessionKey);

      if (streamingSession !== undefined) {
        this.streamingSttCallPhaseBySessionKey.set(sessionKey, normalizeCallPhase(input.message.callPhase));
        const intent = normalizeSandboxIntent(input.message.intent);
        if (intent !== undefined) {
          this.streamingSttIntentBySessionKey.set(sessionKey, intent);
        }
        streamingSession.forceEndpoint();
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "provider.telemetry",
          at: input.at,
          payload: {
            stage: "stt",
            provider: this.getSttProviderId(),
            event: "forced_endpoint",
          },
        });
        return null;
      }

      return this.runVoiceTurn({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        at: input.at,
        callPhase: normalizeCallPhase(input.message.callPhase),
        intent: normalizeSandboxIntent(input.message.intent),
        sampleRateHz:
          typeof input.message.sampleRateHz === "number" && input.message.sampleRateHz > 0
            ? input.message.sampleRateHz
            : 16_000,
      });
    }

    return this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "client.message",
      at: input.at,
      payload: clonePayload(input.message as Record<string, unknown>),
    });
  }

  private requireSession(organizationId: string, sessionId: string): LiveSandboxSessionRecord {
    const session = this.sessionsByOrganizationId.get(organizationId)?.get(sessionId);

    if (session === undefined) {
      throw new NotFoundException(`Live sandbox session '${sessionId}' was not found.`);
    }

    return session;
  }

  private getOrCreateOrganizationSessions(organizationId: string) {
    const existing = this.sessionsByOrganizationId.get(organizationId);

    if (existing !== undefined) {
      return existing;
    }

    const next = new Map<string, LiveSandboxSessionRecord>();
    this.sessionsByOrganizationId.set(organizationId, next);
    return next;
  }

  private assertUserCanAccessWorkspace(input: {
    organizationId: string;
    workspaceId: string;
    actorUserId: string;
  }) {
    const state = this.workspacesService.getWorkspaceState(input.organizationId);
    const workspaceExists = state.workspaces.some((workspace) => workspace.id === input.workspaceId);

    if (!workspaceExists) {
      throw new NotFoundException(`Workspace '${input.workspaceId}' was not found.`);
    }

    const hasMembership = state.memberships.some(
      (membership) =>
        membership.workspaceId === input.workspaceId &&
        membership.tenantId === input.organizationId &&
        membership.userId === input.actorUserId,
    );

    if (!hasMembership) {
      throw new ForbiddenException(
        `User '${input.actorUserId}' does not have access to workspace '${input.workspaceId}'.`,
      );
    }
  }

  private assertManifestWorkspace(manifest: CompiledRuntimeManifest, workspaceId: string) {
    if (manifest.workspaceId !== undefined && manifest.workspaceId !== workspaceId) {
      throw new ConflictException(
        `Sandbox manifest workspace '${manifest.workspaceId}' does not match requested workspace '${workspaceId}'.`,
      );
    }
  }

  private assertProviderStackReady(input: CreateLiveSandboxSessionRequest) {
    if (input.inputMode !== "voice") {
      return;
    }

    const startupBlockingProviders =
      input.manifest.runtimeProfile === "premium-realtime"
        ? [this.textModelProvider]
        : [this.sttProvider, this.ttsProvider];
    const missingEnv = startupBlockingProviders.flatMap(getMissingProviderEnv);
    const uniqueMissingEnv = [...new Set(missingEnv)];

    if (uniqueMissingEnv.length > 0) {
      throw new ConflictException(
        `Live voice sandbox requires provider credentials before recording can start. Missing: ${uniqueMissingEnv.join(", ")}.`,
      );
    }
  }

  private assertSelectedTextModelReady(input: CreateLiveSandboxSessionRequest) {
    if (input.manifest.runtimeProfile === "premium-realtime") {
      return;
    }

    const activeRole =
      input.manifest.roles.find((role) => role.id === input.entryRoleId)
      ?? input.manifest.roles[0];
    const providerId = activeRole?.modelProvider ?? "openai";
    const availability = getTextModelProviderAvailability(this.textModelProvider, providerId);

    if (availability === undefined || availability.configured) {
      return;
    }

    throw new ConflictException(
      `${formatTextModelProviderName(providerId)} text model is not configured. Missing: ${availability.missingEnv.join(", ")}.`,
    );
  }

  private async assertPublishedToolGrants(
    organizationId: string,
    input: CreateLiveSandboxSessionRequest,
  ) {
    if (input.source !== "published") {
      return;
    }

    const validation = await this.toolPermissionGrantsService.validateToolGrantsForPublish({
      organizationId,
      workspaceId: input.workspaceId,
      manifest: input.manifest,
    });

    if (validation.ok) {
      return;
    }

    throw new BadRequestException({
      message: "Workflow cannot be published because integration tool permissions are incomplete.",
      errors: validation.errors,
    });
  }

  private expireIfNeeded(session: LiveSandboxSessionRecord, now = new Date().toISOString()) {
    if (
      session.status !== "ended" &&
      Date.parse(session.expiresAt) <= Date.parse(now)
    ) {
      session.status = "expired";
      session.transportTokenHash = "";
    }
  }

  private bumpSessionExpiryOnActivity(session: LiveSandboxSessionRecord, at: string) {
    if (session.status === "ended" || session.status === "expired") {
      return;
    }

    if (Date.parse(at) > Date.parse(session.expiresAt)) {
      session.expiresAt = addMinutes(at, defaultTtlMinutes);
    }
  }

  private async runTypedTurn(input: {
    organizationId: string;
    sessionId: string;
    transcript: string;
    callPhase: RuntimeCallPhase;
    intent?: string | undefined;
    source?: "typed" | "voice" | undefined;
    confidence?: number | undefined;
    language?: string | undefined;
    at?: string | undefined;
  }) {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session, input.at);

    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const manifest = this.manifestsBySessionKey.get(sessionKey);
    const frontier = this.frontierBySessionKey.get(sessionKey) ?? [manifest?.entryNodeId ?? ""];
    const priorEvents = this.eventsBySessionKey.get(sessionKey) ?? [];
    const turnStartedAt = input.at ?? new Date().toISOString();

    if (manifest === undefined) {
      throw new NotFoundException(`Live sandbox manifest for session '${input.sessionId}' was not found.`);
    }

    const routeResolution = await resolveLiveSandboxTurnRoute({
      manifest,
      frontier,
      transcript: input.transcript,
      ...(input.intent !== undefined ? { intent: input.intent } : {}),
      intentClassifier: this.intentClassifier,
      turn: {
        callSessionId: input.sessionId,
        turnId: createTurnId(input.sessionId, priorEvents),
        startedAt: turnStartedAt,
        source: input.source ?? "typed",
        ...(input.confidence !== undefined ? { sttConfidence: input.confidence } : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
        recentTranscript: buildRecentTranscriptFromEvents(priorEvents),
      },
    });
    let turnPacket = routeResolution.packet;

    routeResolution.preEvents.forEach((event) => {
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: event.type,
        at: turnStartedAt,
        payload: enrichRouteEventPayloadWithPacket(event, turnPacket),
      });
    });
    packetOnlyPublicEvents(turnPacket).forEach((event) => {
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: event.type,
        at: event.at,
        payload: event.payload,
      });
    });

    this.frontierBySessionKey.set(sessionKey, [...routeResolution.nextFrontier]);

    if (routeResolution.kind === "terminal") {
      const estimatedDurationMs = estimateTurnDurationMs({
        transcript: input.transcript,
        responseText: routeResolution.responseText,
      });
      const costDelta = estimateTurnCostDelta({
        manifest,
        callSessionId: input.sessionId,
        transcript: input.transcript,
        responseText: routeResolution.responseText,
        durationMs: estimatedDurationMs,
        modelTier: manifest.roles[0]?.defaultModelTier ?? "cheap",
      });

      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "turn.completed",
        at: turnStartedAt,
        payload: withPacketMetadata({
          transcript: input.transcript,
          responseText: routeResolution.responseText,
          terminalNodeId: routeResolution.nodeId,
        }, routeResolution.packet),
      });

      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "call.ended",
        at: turnStartedAt,
        payload: withPacketMetadata({
          disposition: "sandbox_terminal_path",
          nodeId: routeResolution.nodeId,
        }, routeResolution.packet),
      });
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "turn.cost.delta",
        at: turnStartedAt,
        payload: withPacketMetadata({
          currency: costDelta.currency,
          totalUsd: costDelta.totalUsd,
          components: costDelta.components,
          usage: costDelta.usage,
        }, routeResolution.packet),
      });
      await this.recordRuntimeObservability({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        manifest,
        packet: routeResolution.packet,
        at: turnStartedAt,
      });
      return routeResolution;
    }

    const activeRole =
      manifest.roles.find((role) => role.id === routeResolution.activeRoleId)
      ?? manifest.roles[0];

    if (activeRole === undefined) {
      throw new ConflictException(`Manifest '${manifest.manifestId}' has no runtime roles.`);
    }

    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        transcribe: async () => ({
          transcript: input.transcript,
          confidence: input.confidence ?? 1,
          language: input.language ?? activeRole.languagePolicy.defaultLanguage,
        }),
      },
      model: this.createAgentActionTextModelProvider({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        session,
        manifest,
        activeRoleId: routeResolution.activeRoleId,
        at: turnStartedAt,
        getPacket: () => turnPacket,
        setPacket: (packet) => {
          turnPacket = packet;
        },
      }),
      tts: this.ttsProvider,
      now: () => input.at ?? new Date().toISOString(),
      createEventId: (type, index) => `${input.sessionId}:${type}:${index + 1}`,
    });

    try {
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "turn.transcribed",
        at: turnStartedAt,
        payload: withPacketMetadata({
          transcript: input.transcript,
          source: input.source ?? "typed",
          language: input.language ?? activeRole.languagePolicy.defaultLanguage,
          confidence: input.confidence ?? 1,
          callPhase: input.callPhase,
          ...(input.intent !== undefined ? { intent: input.intent } : {}),
        }, turnPacket),
      });

      const runtimeStartedAt = Date.now();
      let publishedAudioChunkCount = 0;
      let publishedFirstAudioLatency = false;
      const untrustedContext = buildRuntimeUntrustedContext({
        session,
        events: this.eventsBySessionKey.get(sessionKey) ?? [],
      });
      const result = await runtime.runTurn({
        callSessionId: input.sessionId,
        manifest,
        activeRoleId: routeResolution.activeRoleId,
        audioFrames: [input.transcript],
        context: {
          callPhase: input.callPhase,
          language: input.language ?? activeRole.languagePolicy.defaultLanguage,
          ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
          ...routeResolution.context,
        } satisfies ModelRoutingContext,
        untrustedContext,
        onAudioChunk: (audioBase64, index, telemetry) => {
          if (!publishedFirstAudioLatency) {
            publishedFirstAudioLatency = true;
            this.publishSessionEvent({
              organizationId: input.organizationId,
              sessionId: input.sessionId,
              type: "turn.latency.measured",
              at: turnStartedAt,
              payload: withPacketMetadata({
                stage: "first_audio",
                totalLatencyMs: Math.max(0, Date.now() - runtimeStartedAt),
                ttsFirstByteLatencyMs: telemetry.firstByteLatencyMs,
              }, turnPacket),
            });
          }
          this.publishSessionEvent({
            organizationId: input.organizationId,
            sessionId: input.sessionId,
            type: "turn.audio.chunk",
            at: turnStartedAt,
            payload: withPacketMetadata({
              audioBase64,
              chunkIndex: index,
            }, turnPacket),
          });
          publishedAudioChunkCount = Math.max(publishedAudioChunkCount, index + 1);
        },
      });
      const runtimeLatencyMs = Math.max(0, Date.now() - runtimeStartedAt);
      const firstByteLatencyMs = extractFirstByteLatencyFromSandboxEvents(result.events);

      for (const event of result.events) {
        if (event.type === "turn.transcribed") {
          continue;
        }

        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: event.type,
          at: event.at,
          payload: withPacketMetadata(event.payload, turnPacket),
        });
      }

      result.audioChunks.slice(publishedAudioChunkCount).forEach((audioBase64, offset) => {
        const chunkIndex = publishedAudioChunkCount + offset;
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "turn.audio.chunk",
          at: turnStartedAt,
          payload: withPacketMetadata({
            audioBase64,
            chunkIndex,
          }, turnPacket),
        });
      });
      if (result.audioWordTimestamps !== undefined && result.audioWordTimestamps.length > 0) {
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "turn.audio.timestamps",
          at: turnStartedAt,
          payload: withPacketMetadata({
            wordTimestamps: result.audioWordTimestamps,
          }, turnPacket),
        });
      }

      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "provider.telemetry",
        at: turnStartedAt,
        payload: withPacketMetadata({
          stage: "model",
          provider: resolveRuntimeModelProviderName(activeRole),
          latencyMs: Math.max(0, runtimeLatencyMs - (firstByteLatencyMs ?? 0)),
          tier: result.routingDecision.tier,
          ...(result.degraded ? { degraded: true } : {}),
          ...(result.failureStage !== undefined ? { failureStage: result.failureStage } : {}),
        }, turnPacket),
      });
      if (firstByteLatencyMs !== undefined) {
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "provider.telemetry",
          at: turnStartedAt,
          payload: withPacketMetadata({
            stage: "tts",
            provider: liveSandboxTtsProviderId,
            latencyMs: firstByteLatencyMs,
          }, turnPacket),
        });
      }

      const estimatedDurationMs = Math.max(
        runtimeLatencyMs,
        estimateTurnDurationMs({
          transcript: result.transcript,
          responseText: result.responseText,
        }),
      );
      const costDelta = estimateTurnCostDelta({
        manifest,
        callSessionId: input.sessionId,
        transcript: result.transcript,
        responseText: result.responseText,
        durationMs: estimatedDurationMs,
        modelTier: result.routingDecision.tier,
        activeRoleId: routeResolution.activeRoleId,
      });
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "turn.cost.delta",
        at: turnStartedAt,
        payload: withPacketMetadata({
          currency: costDelta.currency,
          totalUsd: costDelta.totalUsd,
          components: costDelta.components,
          usage: costDelta.usage,
          modelTier: costDelta.modelTier,
        }, turnPacket),
      });
      await this.recordRuntimeObservability({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        manifest,
        packet: turnPacket,
        at: turnStartedAt,
        model: {
          provider: resolveRuntimeModelProviderName(activeRole),
          ...(activeRole.modelId !== undefined ? { modelId: activeRole.modelId } : {}),
          tier: result.routingDecision.tier,
          latencyMs: Math.max(0, runtimeLatencyMs - (firstByteLatencyMs ?? 0)),
        },
        tts: {
          provider: liveSandboxTtsProviderId,
          ...(firstByteLatencyMs !== undefined ? { latencyMs: firstByteLatencyMs } : {}),
        },
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live sandbox turn failed.";

      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "call.failed",
        at: turnStartedAt,
        payload: withPacketMetadata({
          stage: "runtime",
          code: "failed",
          message,
        }, turnPacket),
      });
      throw error;
    }
  }

  private async recordRuntimeObservability(input: {
    organizationId: string;
    sessionId: string;
    manifest: CompiledRuntimeManifest;
    packet: TurnRuntimePacket;
    at: string;
    model?: {
      provider: string;
      modelId?: string | undefined;
      tier?: string | undefined;
      latencyMs?: number | undefined;
    } | undefined;
    tts?: {
      provider: string;
      latencyMs?: number | undefined;
    } | undefined;
  }) {
    let result: RuntimeObservabilityRecorderResult;

    try {
      result = await this.runtimeObservabilityRecorder.recordTurn({
        traceId: buildRuntimeTraceId(input.sessionId, input.packet.ids.turnId),
        packet: input.packet,
        manifest: input.manifest,
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.tts !== undefined ? { tts: input.tts } : {}),
      });
    } catch (error) {
      const message = error instanceof Error && error.message.length > 0
        ? error.message
        : "Runtime observability export failed.";

      result = {
        exportedSpanCount: 0,
        langsmithExported: false,
        warnings: [
          {
            code: "runtime_observability.failed",
            message,
            recoverable: true,
          },
        ],
        metrics: {
          langsmithExportFailureCount: 0,
          spanExportFailureCount: 1,
          droppedSpanCount: 0,
        },
      };
    }

    result.warnings.forEach((warning) => {
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "runtime.warning",
        at: input.at,
        payload: withPacketMetadata({
          code: warning.code,
          message: warning.message,
          recoverable: warning.recoverable,
          source: "runtime_observability",
          traceId: buildRuntimeTraceId(input.sessionId, input.packet.ids.turnId),
        }, input.packet),
      });
    });

    if (!shouldPublishRuntimeObservabilityMetrics(result)) {
      return;
    }

    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "runtime.observability",
      at: input.at,
      payload: withPacketMetadata({
        traceId: buildRuntimeTraceId(input.sessionId, input.packet.ids.turnId),
        exportedSpanCount: result.exportedSpanCount,
        langsmithExported: result.langsmithExported,
        metrics: result.metrics,
      }, input.packet),
    });
  }

  private async runVoiceTurn(input: {
    organizationId: string;
    sessionId: string;
    callPhase: RuntimeCallPhase;
    intent?: string | undefined;
    sampleRateHz: number;
    at?: string | undefined;
  }) {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session, input.at);
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const audioFramesBase64 = [...(this.bufferedAudioFramesBySessionKey.get(sessionKey) ?? [])];

    this.bufferedAudioFramesBySessionKey.set(sessionKey, []);

    if (audioFramesBase64.length === 0) {
      return null;
    }

    const sttStartedAt = Date.now();
    let transcription: Awaited<ReturnType<LiveSandboxSttProvider["transcribeTurn"]>>;

    try {
      transcription = await this.sttProvider.transcribeTurn({
        audioFramesBase64,
        sampleRateHz: input.sampleRateHz,
        onPartial: (event) => {
          this.publishSessionEvent({
            organizationId: input.organizationId,
            sessionId: input.sessionId,
            type: "stt.partial",
            at: input.at,
            payload: {
              transcript: event.transcript,
              confidence: event.confidence,
              ...(event.language !== undefined ? { language: event.language } : {}),
            },
          });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live sandbox STT failed.";

      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "call.failed",
        at: input.at,
        payload: {
          stage: "stt",
          code: "failed",
          message,
        },
      });
      throw error;
    }
    const sttLatencyMs = Math.max(0, Date.now() - sttStartedAt);
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "provider.telemetry",
      at: input.at,
      payload: {
        stage: "stt",
        provider: this.getSttProviderId(),
        latencyMs: sttLatencyMs,
      },
    });

    return this.runTypedTurn({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      transcript: transcription.transcript,
      callPhase: input.callPhase,
      ...(input.intent !== undefined ? { intent: input.intent } : {}),
      source: "voice",
      confidence: transcription.confidence,
      language: transcription.language,
      at: input.at,
    });
  }

  private getOrCreateStreamingSttSession(input: {
    organizationId: string;
    sessionId: string;
    sampleRateHz: number;
    at?: string | undefined;
  }) {
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const existing = this.streamingSttSessionsBySessionKey.get(sessionKey);

    if (existing !== undefined) {
      return existing;
    }

    if (this.sttProvider.createStreamingSession === undefined) {
      throw new ConflictException("Live sandbox STT provider does not support streaming voice sessions.");
    }

    this.streamingSttStartedAtBySessionKey.set(sessionKey, Date.now());
    const manifest = this.manifestsBySessionKey.get(sessionKey);
    const stream = this.sttProvider.createStreamingSession({
      sampleRateHz: input.sampleRateHz,
      ...(manifest !== undefined ? { config: buildStreamingSttConfiguration(manifest) } : {}),
      onPartial: (event) => {
        const observedAt = Date.now();
        if (!this.streamingSttFirstPartialAtBySessionKey.has(sessionKey)) {
          this.streamingSttFirstPartialAtBySessionKey.set(sessionKey, observedAt);
        }
        this.streamingSttLastPartialAtBySessionKey.set(sessionKey, observedAt);
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "stt.partial",
          at: input.at,
          payload: {
            transcript: event.transcript,
            confidence: event.confidence,
            ...(event.language !== undefined ? { language: event.language } : {}),
          },
        });
      },
      onFinal: (event) => {
        void this.handleStreamingSttFinal({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          transcript: event.transcript,
          confidence: event.confidence,
          language: event.language ?? "en",
          at: input.at,
        });
      },
      onError: (error) => {
        this.handleStreamingSttError({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          error,
          at: input.at,
        });
      },
      onTelemetry: (event) => {
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "provider.telemetry",
          at: input.at,
          payload: {
            stage: "stt",
            provider: this.getSttProviderId(),
            event: event.event,
            ...(event.transcript !== undefined ? { transcript: event.transcript } : {}),
            ...(event.requestId !== undefined ? { requestId: event.requestId } : {}),
          },
        });
      },
    });

    this.streamingSttSessionsBySessionKey.set(sessionKey, stream);
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "provider.telemetry",
      at: input.at,
      payload: {
        stage: "stt",
        provider: this.getSttProviderId(),
        event: "session_opened",
        sampleRateHz: input.sampleRateHz,
      },
    });
    return stream;
  }

  private async handleStreamingSttFinal(input: {
    organizationId: string;
    sessionId: string;
    transcript: string;
    confidence: number;
    language: string;
    at?: string | undefined;
  }) {
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    if (this.streamingSttTurnInFlightBySessionKey.has(sessionKey)) {
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "provider.telemetry",
        at: input.at,
        payload: {
          stage: "stt",
          provider: this.getSttProviderId(),
          event: "final_ignored_in_flight",
          reason: "turn_in_flight",
        },
      });
      return;
    }

    const startedAt = this.streamingSttStartedAtBySessionKey.get(sessionKey) ?? Date.now();
    const finalizedAt = Date.now();
    const firstPartialAt = this.streamingSttFirstPartialAtBySessionKey.get(sessionKey);
    const lastPartialAt = this.streamingSttLastPartialAtBySessionKey.get(sessionKey);
    const callPhase = this.streamingSttCallPhaseBySessionKey.get(sessionKey) ?? "discovery";
    const intent = this.streamingSttIntentBySessionKey.get(sessionKey);

    this.streamingSttStartedAtBySessionKey.set(sessionKey, finalizedAt);
    this.streamingSttFirstPartialAtBySessionKey.delete(sessionKey);
    this.streamingSttLastPartialAtBySessionKey.delete(sessionKey);
    this.streamingSttFrameCountBySessionKey.set(sessionKey, 0);
    this.bufferedAudioFramesBySessionKey.set(sessionKey, []);
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "provider.telemetry",
      at: input.at,
      payload: {
        stage: "stt",
        provider: this.getSttProviderId(),
        latencyMs: Math.max(0, finalizedAt - startedAt),
        listeningMs: Math.max(0, finalizedAt - startedAt),
        speechMs: firstPartialAt === undefined ? Math.max(0, finalizedAt - startedAt) : Math.max(0, finalizedAt - firstPartialAt),
        endpointMs: lastPartialAt === undefined ? Math.max(0, finalizedAt - startedAt) : Math.max(0, finalizedAt - lastPartialAt),
        event: "final",
      },
    });

    this.streamingSttTurnInFlightBySessionKey.add(sessionKey);

    try {
      const result = await this.runTypedTurn({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        transcript: input.transcript.trim(),
        callPhase,
        ...(intent !== undefined ? { intent } : {}),
        source: "voice",
        confidence: input.confidence,
        language: input.language,
        at: input.at,
      });
      const responseText = readTurnResponseText(result);
      if (responseText !== undefined) {
        this.streamingSttSessionsBySessionKey.get(sessionKey)?.updateConfiguration({
          agentContext: responseText,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live sandbox turn failed.";
      this.logger.error(
        `Live sandbox voice turn failed: organization=${input.organizationId} session=${input.sessionId} message="${message}"`,
      );
      const hasRuntimeFailure = (this.eventsBySessionKey.get(sessionKey) ?? []).some((event) => {
        const payload = event.payload as { stage?: unknown; message?: unknown };
        return event.type === "call.failed" && payload.stage === "runtime" && payload.message === message;
      });

      if (!hasRuntimeFailure) {
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "call.failed",
          at: input.at,
          payload: {
            stage: "runtime",
            code: "failed",
            message,
          },
        });
      }
    } finally {
      this.streamingSttTurnInFlightBySessionKey.delete(sessionKey);
    }
  }

  private assertSttProviderSupportsManifest(manifest: CompiledRuntimeManifest) {
    if (this.getSttProviderId() !== "cartesia-ink-2") {
      return;
    }

    const unsupportedRole = manifest.roles.find((role) => {
      const languages = new Set([
        role.languagePolicy.defaultLanguage,
        ...role.languagePolicy.supportedLanguages,
      ]);

      return [...languages].some((language) => language !== "en");
    });

    if (unsupportedRole !== undefined) {
      throw new ConflictException(
        "Cartesia Ink 2 STT is English-only. Select AssemblyAI streaming STT or remove non-English role languages before starting this sandbox.",
      );
    }
  }

  private handleStreamingSttError(input: {
    organizationId: string;
    sessionId: string;
    error: Error;
    at?: string | undefined;
  }) {
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const diagnostic = readProviderFailureDiagnostic(input.error);
    const message = input.error.message.length > 0 ? input.error.message : "Live sandbox STT failed.";

    this.logger.error(
      `Live sandbox provider failure: organization=${input.organizationId} session=${input.sessionId} provider=${this.getSttProviderId()} message="${message}"`,
    );
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "provider.diagnostic",
      at: input.at,
      payload: {
        stage: "stt",
        provider: this.getSttProviderId(),
        severity: "error",
        message,
        ...(diagnostic.closeCode !== undefined ? { closeCode: diagnostic.closeCode } : {}),
        ...(diagnostic.closeReason !== undefined ? { closeReason: diagnostic.closeReason } : {}),
      },
    });
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "provider.telemetry",
      at: input.at,
      payload: {
        stage: "stt",
        provider: this.getSttProviderId(),
        event: "provider_close",
        ...(diagnostic.closeCode !== undefined ? { closeCode: diagnostic.closeCode } : {}),
      },
    });
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "call.failed",
      at: input.at,
      payload: {
        stage: "stt",
        provider: this.getSttProviderId(),
        code: "failed",
        message,
        ...(diagnostic.closeCode !== undefined ? { closeCode: diagnostic.closeCode } : {}),
      },
    });
    this.closeStreamingSttSession(sessionKey);
  }

  private closeStreamingSttSession(
    sessionKey: string,
    telemetry?: {
      organizationId: string;
      sessionId: string;
      event: "termination";
      at?: string | undefined;
    } | undefined,
  ) {
    const stream = this.streamingSttSessionsBySessionKey.get(sessionKey);

    if (stream !== undefined) {
      if (telemetry !== undefined) {
        this.publishSessionEvent({
          organizationId: telemetry.organizationId,
          sessionId: telemetry.sessionId,
          type: "provider.telemetry",
          at: telemetry.at,
          payload: {
            stage: "stt",
            provider: this.getSttProviderId(),
            event: telemetry.event,
          },
        });
      }
      stream.terminate();
    }

    this.streamingSttSessionsBySessionKey.delete(sessionKey);
    this.streamingSttStartedAtBySessionKey.delete(sessionKey);
    this.streamingSttFirstPartialAtBySessionKey.delete(sessionKey);
    this.streamingSttLastPartialAtBySessionKey.delete(sessionKey);
    this.streamingSttFrameCountBySessionKey.delete(sessionKey);
    this.streamingSttCallPhaseBySessionKey.delete(sessionKey);
    this.streamingSttIntentBySessionKey.delete(sessionKey);
    this.streamingSttTurnInFlightBySessionKey.delete(sessionKey);
  }

  private createAgentActionTextModelProvider(input: {
    organizationId: string;
    sessionId: string;
    session: LiveSandboxSessionRecord;
    manifest: CompiledRuntimeManifest;
    activeRoleId: string;
    at: string;
    getPacket: () => TurnRuntimePacket;
    setPacket: (packet: TurnRuntimePacket) => void;
  }): SandwichTextModelProvider {
    return {
      streamText: (modelInput) => this.streamAgentActionText({
        ...input,
        modelInput,
      }),
    };
  }

  private async *streamAgentActionText(input: {
    organizationId: string;
    sessionId: string;
    session: LiveSandboxSessionRecord;
    manifest: CompiledRuntimeManifest;
    activeRoleId: string;
    at: string;
    getPacket: () => TurnRuntimePacket;
    setPacket: (packet: TurnRuntimePacket) => void;
    modelInput: Parameters<SandwichTextModelProvider["streamText"]>[0];
  }): AsyncIterable<string> {
    let packet = input.getPacket();
    const hasAgentActions = packet.availableTools.length > 0 || packet.routeMenu !== undefined;

    if (!hasAgentActions) {
      yield* this.textModelProvider.streamText({
        ...input.modelInput,
        agentContext: createAgentTurnContext(packet),
        agentActionMode: false,
      });
      return;
    }

    let toolCallCount = 0;

    while (true) {
      const rawModelText = await collectText(this.textModelProvider.streamText({
        ...input.modelInput,
        agentContext: createAgentTurnContext(packet),
        agentActionMode: true,
      }));
      let action: ParsedAgentAction;

      try {
        action = packet.routeMenu !== undefined
          ? parseAgentActionText(rawModelText, { allowRouteAction: true })
          : parseAgentActionText(rawModelText);
      } catch (error) {
        const parseMessage = error instanceof Error ? error.message : "Agent action was invalid.";
        const fallbackResponse = resolveInvalidAgentActionFallback(input.modelInput.transcript, rawModelText);

        if (fallbackResponse !== undefined) {
          this.publishSessionEvent({
            organizationId: input.organizationId,
            sessionId: input.sessionId,
            type: "quality.flagged",
            at: input.at,
            payload: withPacketMetadata({
              stage: "model",
              code: "agent_action.invalid_json",
              recoverable: true,
              message: parseMessage,
            }, packet),
          });
          yield fallbackResponse;
          return;
        }

        if (looksLikeStructuredAgentCommand(rawModelText)) {
          const previousPacket = packet;
          packet = recordRuntimePacketWarning(packet, {
            at: input.at,
            nodeId: input.activeRoleId,
            warning: {
              code: "agent_action.invalid",
              message: "The agent returned an unsupported structured action, so runtime ignored it.",
              recoverable: true,
            },
          });
          input.setPacket(packet);
          this.publishNewPacketEvents({
            organizationId: input.organizationId,
            sessionId: input.sessionId,
            previousPacket,
            packet,
          });
          yield "I'm sorry, I had trouble responding just now. Could you try that again?";
          return;
        }

        const spokenFallback = rawModelText.trim();
        if (spokenFallback.length > 0) {
          yield spokenFallback;
          return;
        }

        yield "I'm sorry, I had trouble responding just now. Could you try that again?";
        return;
      }

      if (action.type === "respond") {
        yield action.responseText;
        return;
      }

      if (action.type === "route_to_agent") {
        const previousPacket = packet;
        const routeResolution = resolveLiveSandboxAgentRouteAction({
          manifest: input.manifest,
          activeRoleId: input.activeRoleId,
          action,
          packet,
          at: input.at,
        });
        packet = routeResolution.packet;
        input.setPacket(packet);
        this.frontierBySessionKey.set(
          getSessionKey(input.organizationId, input.sessionId),
          [...routeResolution.nextFrontier],
        );
        routeResolution.routeEvents.forEach((event) => {
          this.publishSessionEvent({
            organizationId: input.organizationId,
            sessionId: input.sessionId,
            type: event.type,
            at: input.at,
            payload: enrichRouteEventPayloadWithPacket(event, packet),
          });
        });
        this.publishNewPacketEvents({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          previousPacket,
          packet,
        });
        yield routeResolution.responseText;
        return;
      }

      if (toolCallCount >= defaultMaxAgentToolCallsPerTurn) {
        const previousPacket = packet;
        packet = recordRuntimePacketWarning(packet, {
          at: input.at,
          nodeId: input.activeRoleId,
          warning: {
            code: "tool_call_limit.exceeded",
            message: "The agent exceeded the per-turn tool call limit.",
            recoverable: true,
          },
        });
        input.setPacket(packet);
        this.publishNewPacketEvents({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          previousPacket,
          packet,
        });
        yield "I need one more detail before I can continue safely. What should I prioritize?";
        return;
      }

      const previousPacket = packet;
      packet = await this.executeAgentRequestedTool({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        session: input.session,
        manifest: input.manifest,
        activeRoleId: input.activeRoleId,
        transcript: input.modelInput.transcript,
        action,
        packet,
        at: input.at,
      });
      toolCallCount += 1;
      input.setPacket(packet);
      this.publishNewPacketEvents({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        previousPacket,
        packet,
      });
    }
  }

  private async executeAgentRequestedTool(input: {
    organizationId: string;
    sessionId: string;
    session: LiveSandboxSessionRecord;
    manifest: CompiledRuntimeManifest;
    activeRoleId: string;
    transcript: string;
    action: Extract<AgentAction, { type: "call_tool" }>;
    packet: TurnRuntimePacket;
    at: string;
  }): Promise<TurnRuntimePacket> {
    return this.runtimeAgentToolExecutor.executeAgentTool({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      workspaceId: input.session.workspaceId,
      actorUserId: input.session.actorUserId,
      manifest: input.manifest,
      activeRoleId: input.activeRoleId,
      transcript: input.transcript,
      action: input.action,
      packet: input.packet,
      at: input.at,
      publishSideEffect: (event) => this.recordIntegrationSideEffect(event),
    });
  }

  private recordIntegrationSideEffect(input: RuntimeAgentToolSideEffectEvent) {
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "integration.side_effect.recorded",
      at: input.at,
      payload: {
        status: input.status,
        retryPosture: input.retryPosture,
        provider: input.provider,
        connector: input.connector,
        toolId: input.toolId,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        toolAssignmentId: input.toolAssignmentId,
        idempotencyKey: input.idempotencyKey,
        ...(input.integrationConnectionId !== undefined
          ? { integrationConnectionId: input.integrationConnectionId }
          : {}),
        ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
      },
    });
  }

  private publishNewPacketEvents(input: {
    organizationId: string;
    sessionId: string;
    previousPacket: TurnRuntimePacket;
    packet: TurnRuntimePacket;
  }) {
    const previousSequence = input.previousPacket.timing.sequence;

    input.packet.diagnostics.events
      .filter((event) => event.sequence > previousSequence)
      .forEach((event) => {
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: event.type,
          at: event.at,
          payload: withPacketMetadata({
            ...event.payload,
            ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
          }, input.packet, event),
        });
      });
  }

  private recordTransportSecurityAudit(input: {
    session: LiveSandboxSessionRecord;
    reason: LiveSandboxTransportAuditEntry["reason"];
    at: string;
  }) {
    this.transportSecurityAudits.push({
      sessionId: input.session.sessionId,
      organizationId: input.session.organizationId,
      workspaceId: input.session.workspaceId,
      source: input.session.source,
      reason: input.reason,
      at: input.at,
    });
  }

  private buildSessionSummary(session: LiveSandboxSessionRecord): LiveSandboxSessionSummary {
    const sessionKey = getSessionKey(session.organizationId, session.sessionId);
    const manifest = this.manifestsBySessionKey.get(sessionKey);
    const events = this.eventsBySessionKey.get(sessionKey) ?? [];
    const entryRole = manifest?.roles.find((role) => role.id === session.entryRoleId);
    const latestHandoff = [...events]
      .reverse()
      .find((event) => event.type === "agent.handoff.completed");
    const latestRoutingEvent = [...events]
      .reverse()
      .find((event) => event.type === "routing.model_selected");
    const latestTranscriptEvent = [...events]
      .reverse()
      .find((event) => event.type === "turn.transcribed" || event.type === "turn.completed");

    return {
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      source: session.source,
      status: session.status,
      runtimeProfile: session.runtimeProfile,
      activeRoleName:
        readString(latestHandoff?.payload.targetRoleName)
        ?? entryRole?.name
        ?? session.entryRoleId,
      runtimeTier:
        readString(latestRoutingEvent?.payload.tier)
        ?? entryRole?.defaultModelTier
        ?? "cheap",
      eventCount: events.length,
      turnCount: events.filter((event) => event.type === "turn.completed").length,
      lastEventAt: events.at(-1)?.at ?? session.createdAt,
      ...(events.at(-1) !== undefined ? { lastEventType: events.at(-1)?.type } : {}),
      ...(latestTranscriptEvent !== undefined
        ? {
            lastTranscriptPreview:
              readString(latestTranscriptEvent.payload.transcript)
              ?? readString(latestTranscriptEvent.payload.responseText),
          }
        : {}),
    };
  }

  private buildTelemetryCallSummary(session: LiveSandboxSessionRecord): LiveSandboxTelemetryCallSummary {
    const sessionKey = getSessionKey(session.organizationId, session.sessionId);
    const events = this.eventsBySessionKey.get(sessionKey) ?? [];
    const latestRoutingEvent = [...events]
      .reverse()
      .find((event) => event.type === "routing.model_selected");
    const telemetryEvents = events.filter((event) => event.type === "provider.telemetry");
    const costEvents = events.filter((event) => event.type === "turn.cost.delta");
    const toolEvents = events.filter(
      (event) => event.type === "tool.completed" || event.type === "tool.failed",
    );
    const modelTier =
      readString(costEvents.at(-1)?.payload.modelTier)
      ?? readString(latestRoutingEvent?.payload.tier)
      ?? session.runtimeProfile;
    const usageTotals = costEvents.reduce(
      (totals, event) => {
        const usage = event.payload.usage;
        const hasUsage = usage !== null && typeof usage === "object";

        return {
          costUsd: totals.costUsd + (readNumber(event.payload.totalUsd) ?? 0),
          modelInputTokens:
            totals.modelInputTokens + (hasUsage ? readNumber((usage as Record<string, unknown>).modelInputTokens) ?? 0 : 0),
          modelOutputTokens:
            totals.modelOutputTokens + (hasUsage ? readNumber((usage as Record<string, unknown>).modelOutputTokens) ?? 0 : 0),
          ttsCharacters:
            totals.ttsCharacters + (hasUsage ? readNumber((usage as Record<string, unknown>).ttsCharacters) ?? 0 : 0),
          callMinutes:
            totals.callMinutes + (hasUsage ? readNumber((usage as Record<string, unknown>).callMinutes) ?? 0 : 0),
          sttMinutes:
            totals.sttMinutes + (hasUsage ? readNumber((usage as Record<string, unknown>).sttMinutes) ?? 0 : 0),
          missingUsageData: totals.missingUsageData || !hasUsage,
        };
      },
      {
        costUsd: 0,
        modelInputTokens: 0,
        modelOutputTokens: 0,
        ttsCharacters: 0,
        callMinutes: 0,
        sttMinutes: 0,
        missingUsageData: false,
      },
    );

    return {
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      status: session.status,
      runtimeProfile: session.runtimeProfile,
      runtimeTier: modelTier,
      eventCount: events.length,
      modelLatencyMs: sumProviderLatency(telemetryEvents, "model"),
      sttLatencyMs: sumProviderLatency(telemetryEvents, "stt"),
      ttsLatencyMs: sumProviderLatency(telemetryEvents, "tts"),
      toolDurationMs: sumBy(toolEvents, (event) => readNumber(event.payload.durationMs) ?? 0),
      toolCount: toolEvents.length,
      costUsd: roundMetric(usageTotals.costUsd),
      modelInputTokens: usageTotals.modelInputTokens,
      modelOutputTokens: usageTotals.modelOutputTokens,
      ttsCharacters: usageTotals.ttsCharacters,
      callMinutes: roundMetric(usageTotals.callMinutes),
      sttMinutes: roundMetric(usageTotals.sttMinutes),
      missingUsageData: usageTotals.missingUsageData,
      lastEventAt: events.at(-1)?.at ?? session.createdAt,
    };
  }

  private captureEscalationFromEvent(
    session: LiveSandboxSessionRecord,
    event: LiveSandboxStreamEvent,
  ) {
    if (event.type !== "escalation.requested") {
      return;
    }

    const nodeId = readString(event.payload.nodeId) ?? "human-escalation";
    const organizationEscalations = this.getOrCreateOrganizationEscalations(session.organizationId);
    const duplicate = [...organizationEscalations.values()].find(
      (escalation) =>
        escalation.sessionId === session.sessionId
        && escalation.nodeId === nodeId
        && escalation.status === "pending",
    );

    if (duplicate !== undefined) {
      return;
    }

    const slaSeconds = readNumber(event.payload.slaSeconds) ?? defaultEscalationSlaSeconds;
    const fallbackMode = readEscalationFallbackMode(event.payload.fallbackMode);
    const escalation: LiveSandboxEscalationRecord = {
      escalationId: `escalation-${randomUUID()}`,
      organizationId: session.organizationId,
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      nodeId,
      ...(readString(event.payload.queueId) !== undefined ? { queueId: readString(event.payload.queueId) } : {}),
      ...(readString(event.payload.queueName) !== undefined ? { queueName: readString(event.payload.queueName) } : {}),
      reason: readString(event.payload.reason) ?? "Human escalation requested.",
      requestedAt: event.at,
      slaDeadlineAt: addSeconds(event.at, Math.max(1, slaSeconds)),
      status: "pending",
      ...(fallbackMode !== undefined ? { fallbackMode } : {}),
      ...(readString(event.payload.fallbackMessage) !== undefined ? { fallbackMessage: readString(event.payload.fallbackMessage) } : {}),
    };

    organizationEscalations.set(escalation.escalationId, escalation);
  }

  private applyEscalationTimeouts(organizationId: string, now: string) {
    const organizationEscalations = this.escalationsByOrganizationId.get(organizationId);

    if (organizationEscalations === undefined) {
      return;
    }

    for (const escalation of organizationEscalations.values()) {
      if (escalation.status !== "pending" || Date.parse(escalation.slaDeadlineAt) > Date.parse(now)) {
        continue;
      }

      escalation.status = "fallback_triggered";
      escalation.fallbackTriggeredAt = now;
      escalation.resolvedAt = now;
      this.publishSessionEvent({
        organizationId,
        sessionId: escalation.sessionId,
        type: "escalation.failed",
        at: now,
        payload: {
          escalationId: escalation.escalationId,
          nodeId: escalation.nodeId,
          queueId: escalation.queueId,
          reason: "sla_timeout",
          fallbackMode: escalation.fallbackMode,
          fallbackMessage: escalation.fallbackMessage,
        },
      });
    }
  }

  private requireEscalation(organizationId: string, escalationId: string) {
    const escalation = this.escalationsByOrganizationId.get(organizationId)?.get(escalationId);

    if (escalation === undefined) {
      throw new NotFoundException(`Escalation '${escalationId}' was not found.`);
    }

    return escalation;
  }

  private assertEscalationPending(escalation: LiveSandboxEscalationRecord) {
    if (escalation.status !== "pending") {
      throw new ConflictException(`Escalation '${escalation.escalationId}' is already ${escalation.status}.`);
    }
  }

  private getOrCreateOrganizationEscalations(organizationId: string) {
    const existing = this.escalationsByOrganizationId.get(organizationId);

    if (existing !== undefined) {
      return existing;
    }

    const escalations = new Map<string, LiveSandboxEscalationRecord>();
    this.escalationsByOrganizationId.set(organizationId, escalations);
    return escalations;
  }
}

function toSessionResponse(
  session: LiveSandboxSessionRecord,
  transportToken?: string,
): LiveSandboxSessionResponse {
  return {
    sessionId: session.sessionId,
    organizationId: session.organizationId,
    workspaceId: session.workspaceId,
    actorUserId: session.actorUserId,
    source: session.source,
    inputMode: session.inputMode,
    entryRoleId: session.entryRoleId,
    manifestId: session.manifestId,
    publishedVersionId: session.publishedVersionId,
    runtimeProfile: session.runtimeProfile,
    transportUrl: session.transportUrl,
    providerStack: {
      ...session.providerStack,
    },
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    status: session.status,
    ...(session.endedAt !== undefined ? { endedAt: session.endedAt } : {}),
    memory: toSessionMemoryResponse(getOrCreateSessionMemory(session)),
    ...(transportToken !== undefined ? { transportToken } : {}),
  };
}

function getOrCreateSessionMemory(session: LiveSandboxSessionRecord) {
  if (session.memory !== undefined) {
    return session.memory;
  }

  session.memory = {
    status: session.status === "ended" ? "cleared" : "active",
    entries: [],
    updatedAt: session.endedAt ?? session.createdAt,
  };

  return session.memory;
}

function toSessionMemoryResponse(
  memory: NonNullable<LiveSandboxSessionRecord["memory"]>,
): LiveSandboxSessionMemoryResponse {
  return {
    status: memory.status,
    entryCount: memory.entries.length,
    entries: memory.entries.map((entry) => ({ ...entry })),
    ...(memory.summary !== undefined ? { summary: memory.summary } : {}),
    updatedAt: memory.updatedAt,
  };
}

function captureSessionMemoryFromEvent(
  session: LiveSandboxSessionRecord,
  event: LiveSandboxStreamEvent,
) {
  if (session.status === "ended" || session.status === "expired") {
    return;
  }

  const text = extractMemoryText(event);
  if (text === undefined) {
    return;
  }

  const memory = getOrCreateSessionMemory(session);
  if (memory.status !== "active") {
    return;
  }

  memory.entries = [
    ...memory.entries,
    {
      id: `${event.sessionId}:memory:${event.sequence}`,
      sourceEventType: event.type,
      text,
      capturedAt: event.at,
    },
  ].slice(-12);
  memory.updatedAt = event.at;
}

function extractMemoryText(event: LiveSandboxStreamEvent) {
  if (event.type === "turn.transcribed") {
    return normalizeMemoryText(readString(event.payload.transcript));
  }

  if (event.type === "turn.completed") {
    const transcript = normalizeMemoryText(readString(event.payload.transcript));
    const responseText = normalizeMemoryText(readString(event.payload.responseText));

    if (transcript !== undefined && responseText !== undefined) {
      return `${transcript} -> ${responseText}`;
    }

    return transcript ?? responseText;
  }

  return undefined;
}

function summarizeAndClearSessionMemory(session: LiveSandboxSessionRecord, at: string) {
  const memory = getOrCreateSessionMemory(session);
  const summary = summarizeMemoryEntries(memory.entries);

  memory.status = summary.length > 0 ? "summarized" : "cleared";
  memory.entries = [];
  if (summary.length > 0) {
    memory.summary = summary;
  }
  memory.updatedAt = at;
}

function summarizeMemoryEntries(entries: NonNullable<LiveSandboxSessionRecord["memory"]>["entries"]) {
  const joined = entries.map((entry) => entry.text).join(" ");

  if (joined.length <= 280) {
    return joined;
  }

  return `${joined.slice(0, 277).trimEnd()}...`;
}

function createTurnId(sessionId: string, events: LiveSandboxStreamEvent[]) {
  const completedTurnCount = events.filter((event) => event.type === "turn.completed").length;
  return `${sessionId}:turn:${completedTurnCount + 1}`;
}

function buildRecentTranscriptFromEvents(events: LiveSandboxStreamEvent[]): TranscriptTurn[] {
  const transcript: TranscriptTurn[] = [];

  for (const event of events) {
    if (event.type === "turn.transcribed") {
      const callerText = readString(event.payload.transcript);
      if (callerText !== undefined) {
        transcript.push({
          speaker: "caller",
          text: callerText,
          at: event.at,
        });
      }
    }

    if (event.type === "turn.completed") {
      const agentText = readString(event.payload.responseText);
      if (agentText !== undefined) {
        transcript.push({
          speaker: "agent",
          text: agentText,
          at: event.at,
        });
      }
    }
  }

  return transcript.slice(-6);
}

async function collectText(chunks: AsyncIterable<string>) {
  let text = "";

  for await (const chunk of chunks) {
    text += chunk;
  }

  return text.trim();
}

function looksLikeStructuredAgentCommand(text: string) {
  const trimmed = text.trim();

  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function resolveInvalidAgentActionFallback(transcript: string, rawModelText: string) {
  if (!looksLikeStructuredAgentCommand(rawModelText) || !isClosingCallerTurn(transcript)) {
    return undefined;
  }

  return "You're welcome. Have a great day.";
}

function isClosingCallerTurn(transcript: string) {
  const normalized = transcript.trim().toLowerCase();

  return normalized === "thank you"
    || normalized === "thanks"
    || normalized.includes("that will be all")
    || normalized.includes("that's all")
    || normalized.includes("that is all")
    || normalized.includes("no, that's all")
    || normalized.includes("no that is all");
}

function enrichRouteEventPayloadWithPacket(
  event: LiveSandboxRouteEvent,
  packet: TurnRuntimePacket,
): Record<string, unknown> {
  return withPacketMetadata(
    event.payload,
    packet,
    findRoutePacketEvent(packet, event),
  );
}

function packetOnlyPublicEvents(packet: TurnRuntimePacket): Array<{
  type: string;
  at: string;
  payload: Record<string, unknown>;
}> {
  return packet.diagnostics.events
    .filter((event) => event.type !== "node.visited")
    .map((event) => ({
      type: event.type,
      at: event.at,
      payload: withPacketMetadata({
        ...event.payload,
        ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
      }, packet, event),
    }));
}

function withPacketMetadata(
  payload: Record<string, unknown>,
  packet: TurnRuntimePacket,
  packetEvent?: RuntimePacketEvent | undefined,
): Record<string, unknown> {
  return {
    ...payload,
    turnId: packet.ids.turnId,
    packetSequence: packetEvent?.sequence ?? packet.timing.sequence,
  };
}

function findRoutePacketEvent(
  packet: TurnRuntimePacket,
  event: LiveSandboxRouteEvent,
): RuntimePacketEvent | undefined {
  const nodeId = readString(event.payload.nodeId);

  if (event.type === "node.transition") {
    if (event.payload.branchId !== undefined) {
      return findPacketEvent(packet, "intent.classified", nodeId);
    }

    return findPacketEvent(packet, "node.visited", nodeId);
  }

  if (event.type === "agent.handoff.requested" || event.type === "agent.handoff.completed") {
    return findPacketEvent(packet, "transfer.created", nodeId);
  }

  return undefined;
}

function findPacketEvent(
  packet: TurnRuntimePacket,
  type: RuntimePacketEvent["type"],
  nodeId?: string | undefined,
): RuntimePacketEvent | undefined {
  for (let index = packet.diagnostics.events.length - 1; index >= 0; index -= 1) {
    const event = packet.diagnostics.events[index];

    if (event?.type === type && (nodeId === undefined || event.nodeId === nodeId)) {
      return event;
    }
  }

  return undefined;
}

function buildRuntimeTraceId(sessionId: string, turnId: string) {
  return `${sessionId}:${turnId}:trace`;
}

function resolveRuntimeModelProviderName(activeRole: VoiceAgentRole) {
  return activeRole.modelProvider === "google-gemini" ? "google-gemini" : "openai-chat";
}

function shouldPublishRuntimeObservabilityMetrics(result: RuntimeObservabilityRecorderResult) {
  return (
    result.exportedSpanCount > 0
    || result.langsmithExported
    || result.warnings.length > 0
    || result.metrics.langsmithExportFailureCount > 0
    || result.metrics.spanExportFailureCount > 0
    || result.metrics.droppedSpanCount > 0
  );
}

function buildRuntimeUntrustedContext(input: {
  session: LiveSandboxSessionRecord;
  events: LiveSandboxStreamEvent[];
}): RuntimeUntrustedContextItem[] {
  const memory = getOrCreateSessionMemory(input.session);
  const memoryItems = memory.entries.slice(-4).map((entry): RuntimeUntrustedContextItem => ({
    source: "memory",
    label: entry.sourceEventType,
    content: entry.text,
  }));
  const toolItems = input.events
    .filter((event) => event.type === "tool.completed")
    .slice(-4)
    .map((event): RuntimeUntrustedContextItem => ({
      source: "tool_output",
      label:
        readString(event.payload.toolName)
        ?? readString(event.payload.toolId)
        ?? "Tool output",
      content:
        readString(event.payload.summary)
        ?? "Tool completed without a textual summary.",
    }));

  return [...memoryItems, ...toolItems]
    .filter((item) => item.content.trim().length > 0)
    .slice(-8);
}

function normalizeMemoryText(value: string | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function hashTransportToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function addMinutes(at: string, minutes: number) {
  return new Date(Date.parse(at) + minutes * 60_000).toISOString();
}

function addSeconds(at: string, seconds: number) {
  return new Date(Date.parse(at) + seconds * 1_000).toISOString();
}

function buildTransportUrl(organizationId: string, sessionId: string) {
  const apiUrl = new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4010");
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  apiUrl.pathname = `/organizations/${organizationId}/sandbox/live-sessions/${sessionId}/stream`;
  apiUrl.search = "";
  apiUrl.hash = "";
  return apiUrl.toString();
}

function getSessionKey(organizationId: string, sessionId: string) {
  return `${organizationId}:${sessionId}`;
}

function createSignedTransportToken(input: {
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  source: string;
  expiresAt: string;
}) {
  const payload = Buffer.from(
    JSON.stringify({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      source: input.source,
      expiresAt: input.expiresAt,
      nonce: randomBytes(12).toString("base64url"),
    }),
    "utf8",
  ).toString("base64url");
  const signature = signTransportTokenPayload(payload);
  return `${payload}.${signature}`;
}

function decodeSignedTransportToken(token: string) {
  const [payloadSegment, signatureSegment] = token.split(".");

  if (payloadSegment === undefined || signatureSegment === undefined) {
    return null;
  }

  const expectedSignature = signTransportTokenPayload(payloadSegment);

  if (!timingSafeEqualSafe(signatureSegment, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as Record<string, unknown>;

    if (
      typeof parsed.organizationId !== "string"
      || typeof parsed.workspaceId !== "string"
      || typeof parsed.sessionId !== "string"
      || typeof parsed.source !== "string"
      || typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }

    return {
      organizationId: parsed.organizationId,
      workspaceId: parsed.workspaceId,
      sessionId: parsed.sessionId,
      source: parsed.source,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function signTransportTokenPayload(payloadSegment: string) {
  return createHmac("sha256", transportSigningSecret)
    .update(payloadSegment)
    .digest("base64url");
}

function timingSafeEqualSafe(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function estimateTurnCostDelta(input: {
  manifest: CompiledRuntimeManifest;
  callSessionId: string;
  transcript: string;
  responseText: string;
  durationMs: number;
  modelTier: "rules" | "cheap" | "standard" | "sota";
  activeRoleId?: string | undefined;
}) {
  const usage = deriveRuntimeUsageMetrics({
    transcript: input.transcript,
    responseText: input.responseText,
    durationMs: input.durationMs,
  });

  return estimateRuntimeCost({
    manifest: input.manifest,
    pricing: {
      telephonyPerMinuteUsd: {
        "browser-webrtc": 0,
      },
      sttPerMinuteUsd: 0.007,
      modelPer1kInputTokensUsd: {
        cheap: 0.0004,
        standard: 0.003,
        sota: 0.012,
        rules: 0,
      },
      modelPer1kOutputTokensUsd: {
        cheap: 0.0008,
        standard: 0.006,
        sota: 0.024,
        rules: 0,
      },
      ttsPer1kCharactersUsd: 0.015,
      storagePerMbUsd: 0.00005,
    },
    usage,
    modelTier: input.modelTier,
    ...(input.activeRoleId !== undefined ? { activeRoleId: input.activeRoleId } : {}),
    callSessionId: input.callSessionId,
  });
}

function deriveRuntimeUsageMetrics(input: {
  transcript: string;
  responseText: string;
  durationMs: number;
}): RuntimeUsageMetrics {
  const callMinutes = roundUsage(input.durationMs / 60000);

  return {
    callMinutes,
    sttMinutes: callMinutes,
    modelInputTokens: Math.max(1, Math.ceil(input.transcript.length / 4)),
    modelOutputTokens: Math.max(1, Math.ceil(input.responseText.length / 4)),
    ttsCharacters: input.responseText.length,
    storageMb: roundUsage(callMinutes * 0.4),
  };
}

function estimateTurnDurationMs(input: {
  transcript: string;
  responseText: string;
}) {
  const transcriptWords = input.transcript.trim().split(/\s+/).filter((word) => word.length > 0).length;
  const responseWords = input.responseText.trim().split(/\s+/).filter((word) => word.length > 0).length;

  return Math.max(3_000, transcriptWords * 480 + responseWords * 360);
}

function roundUsage(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function extractFirstByteLatencyFromSandboxEvents(
  events: Array<{ type: string; payload: Record<string, unknown> }>,
) {
  const firstByteEvent = events.find((event) => event.type === "turn.audio.first_byte");
  const latency = firstByteEvent?.payload.latencyMs;
  return typeof latency === "number" ? latency : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function sumProviderLatency(events: LiveSandboxStreamEvent[], stage: string) {
  return sumBy(
    events.filter((event) => event.payload.stage === stage),
    (event) => readNumber(event.payload.latencyMs) ?? 0,
  );
}

function sumBy<T>(values: T[], readValue: (value: T) => number) {
  return values.reduce((total, value) => total + readValue(value), 0);
}

function roundMetric(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function inferPostCallOutcome(events: LiveSandboxStreamEvent[]): LiveSandboxPostCallOutcome {
  if (events.some((event) => event.type === "call.failed")) {
    return "failed";
  }

  if (events.some((event) => event.type === "escalation.accepted")) {
    return "human_escalated";
  }

  if (events.some((event) => event.type === "escalation.failed")) {
    return "fallback_triggered";
  }

  return "resolved";
}

function inferPostCallDisposition(events: LiveSandboxStreamEvent[]): LiveSandboxPostCallDisposition {
  const text = collectPostCallText(events).join(" ").toLowerCase();

  if (text.includes("callback") || text.includes("call back")) {
    return "callback_requested";
  }

  if (text.includes("ticket")) {
    return "ticket_required";
  }

  if (inferPostCallOutcome(events) === "resolved") {
    return "resolved";
  }

  return "needs_review";
}

function buildPostCallActionItems(
  summaryId: string,
  events: LiveSandboxStreamEvent[],
) {
  const text = collectPostCallText(events).join(" ").toLowerCase();
  const actionItems: LiveSandboxPostCallSummaryResponse["actionItems"] = [];

  if (text.includes("callback") || text.includes("call back")) {
    actionItems.push({
      id: `${summaryId}:action:callback`,
      label: "Schedule callback",
      status: "open",
      source: "transcript",
    });
  }

  if (text.includes("billing") || text.includes("invoice")) {
    actionItems.push({
      id: `${summaryId}:action:billing`,
      label: "Review billing issue",
      status: "open",
      source: "transcript",
    });
  }

  if (actionItems.length === 0) {
    actionItems.push({
      id: `${summaryId}:action:review`,
      label: "Review call outcome",
      status: "open",
      source: "transcript",
    });
  }

  return actionItems;
}

function buildPostCallSummaryText(events: LiveSandboxStreamEvent[]) {
  const transcriptText = collectPostCallText(events)
    .map(redactPostCallText)
    .filter((value) => value.length > 0)
    .join(" ");
  const toolSummaries = events
    .filter((event) =>
      event.type === "tool.completed"
      || event.type === "tool.failed"
      || event.type === "tool.approval_required")
    .map((event) => redactPostCallText(readString(event.payload.summary) ?? readString(event.payload.toolName) ?? "Tool completed."))
    .join(" ");
  const baseSummary = [transcriptText, toolSummaries]
    .filter((value) => value.length > 0)
    .join(" ");

  if (baseSummary.length === 0) {
    return "No caller transcript was captured before the call ended.";
  }

  return truncatePostCallText(baseSummary, 900);
}

function buildPostCallCrmSyncStatus(
  summary: LiveSandboxPostCallSummaryResponse,
  session: LiveSandboxSessionRecord,
  events: LiveSandboxStreamEvent[],
): LiveSandboxPostCallCrmSyncStatusResponse {
  let status: LiveSandboxPostCallCrmSyncStatusResponse["status"] = summary.crmSync.status;
  let attemptCount = summary.crmSync.status === "queued" ? 1 : 0;
  let lastAttemptAt = summary.crmSync.queuedAt;
  let retryQueuedAt: string | undefined;
  let nextRetryAt: string | undefined;
  let syncedAt: string | undefined;
  let diagnostic: LiveSandboxPostCallCrmSyncStatusResponse["diagnostic"];

  for (const event of events) {
    if (event.payload.summaryId !== summary.summaryId) {
      continue;
    }

    if (event.type === "post_call.crm_sync.failed") {
      status = "failed";
      attemptCount = readNumber(event.payload.attemptCount) ?? Math.max(attemptCount, 1);
      lastAttemptAt = event.at;
      retryQueuedAt = undefined;
      nextRetryAt = readString(event.payload.nextRetryAt);
      syncedAt = undefined;
      diagnostic = readCrmSyncDiagnostic(event.payload);
      continue;
    }

    if (event.type === "post_call.crm_sync.retry_queued") {
      status = "retry_queued";
      attemptCount = readNumber(event.payload.attemptCount) ?? attemptCount + 1;
      retryQueuedAt = event.at;
      nextRetryAt = readString(event.payload.nextRetryAt);
      lastAttemptAt = event.at;
      syncedAt = undefined;
      continue;
    }

    if (event.type === "post_call.crm_sync.synced") {
      status = "synced";
      attemptCount = readNumber(event.payload.attemptCount) ?? Math.max(attemptCount, 1);
      lastAttemptAt = event.at;
      retryQueuedAt = undefined;
      nextRetryAt = undefined;
      syncedAt = event.at;
      diagnostic = undefined;
    }
  }

  return {
    summaryId: summary.summaryId,
    organizationId: summary.organizationId,
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    status,
    provider: summary.crmSync.provider,
    connectionId: summary.crmSync.connectionId,
    objectType: summary.crmSync.objectType,
    ...(summary.crmSync.externalId !== undefined ? { externalId: summary.crmSync.externalId } : {}),
    attemptCount,
    ...(summary.crmSync.queuedAt !== undefined ? { queuedAt: summary.crmSync.queuedAt } : {}),
    ...(lastAttemptAt !== undefined ? { lastAttemptAt } : {}),
    ...(retryQueuedAt !== undefined ? { retryQueuedAt } : {}),
    ...(nextRetryAt !== undefined ? { nextRetryAt } : {}),
    ...(syncedAt !== undefined ? { syncedAt } : {}),
    ...(diagnostic !== undefined ? { diagnostic } : {}),
  };
}

function findBlockingCrmSyncSideEffect(
  summary: LiveSandboxPostCallSummaryResponse,
  events: LiveSandboxStreamEvent[],
): LiveSandboxStreamEvent | undefined {
  if (summary.crmSync.status === "skipped") {
    return undefined;
  }

  return [...events]
    .reverse()
    .find((event) => {
      if (event.type !== "integration.side_effect.recorded") {
        return false;
      }

      const status = readString(event.payload.status);
      if (status !== "unknown" && status !== "succeeded") {
        return false;
      }

      const provider = readString(event.payload.provider) ?? readString(event.payload.connector);
      const connectionId =
        readString(event.payload.connectionId)
        ?? readString(event.payload.integrationConnectionId);
      const objectType = readString(event.payload.objectType);
      const externalId = readString(event.payload.externalId);

      return provider === summary.crmSync.provider
        && connectionId === summary.crmSync.connectionId
        && (objectType === undefined || objectType === summary.crmSync.objectType)
        && (summary.crmSync.externalId === undefined || externalId === summary.crmSync.externalId);
    });
}

function buildQualityFlags(
  sessionId: string,
  events: LiveSandboxStreamEvent[],
): LiveSandboxQualityFlag[] {
  const flags: LiveSandboxQualityFlag[] = [];

  for (const event of events) {
    if (event.type === "routing.dead_end") {
      flags.push({
        flagId: qualityFlagId(sessionId, event, "dead_end"),
        kind: "dead_end",
        severity: "high",
        eventSequence: event.sequence,
        observedAt: event.at,
        message: readString(event.payload.reason) ?? "Workflow routing reached a dead end.",
      });
      continue;
    }

    if (event.type === "turn.completed") {
      const groundingConfidence = readNumber(event.payload.groundingConfidence);
      if (groundingConfidence !== undefined && groundingConfidence < 0.4) {
        flags.push({
          flagId: qualityFlagId(sessionId, event, "hallucination_risk"),
          kind: "hallucination_risk",
          severity: "high",
          eventSequence: event.sequence,
          observedAt: event.at,
          message: `Agent response had low grounding confidence (${groundingConfidence}).`,
        });
      }
      continue;
    }

    if (event.type === "provider.telemetry") {
      const latencyMs = readNumber(event.payload.latencyMs);
      if (latencyMs !== undefined && latencyMs >= 5_000) {
        flags.push({
          flagId: qualityFlagId(sessionId, event, "slow_turn"),
          kind: "slow_turn",
          severity: "medium",
          eventSequence: event.sequence,
          observedAt: event.at,
          message: `${readString(event.payload.stage) ?? "Runtime"} latency reached ${latencyMs}ms.`,
        });
      }
      continue;
    }

    if (event.type === "escalation.failed") {
      flags.push({
        flagId: qualityFlagId(sessionId, event, "escalation_miss"),
        kind: "escalation_miss",
        severity: "high",
        eventSequence: event.sequence,
        observedAt: event.at,
        message: readString(event.payload.reason) === "sla_timeout"
          ? "Escalation missed its SLA before a human accepted."
          : "Escalation failed before human takeover.",
      });
    }
  }

  return flags.map((flag) => ({
    ...flag,
    message: redactPostCallText(flag.message),
  }));
}

function qualityFlagId(
  sessionId: string,
  event: LiveSandboxStreamEvent,
  kind: LiveSandboxQualityFlag["kind"],
) {
  return `${sessionId}:quality:${event.sequence}:${kind}`;
}

function buildImprovementSuggestion(sessionId: string, flag: LiveSandboxQualityFlag) {
  const suggestionBase = {
    suggestionId: `${sessionId}:suggestion:${flag.eventSequence}:${flag.kind}`,
    flagId: flag.flagId,
    status: "pending_approval" as const,
    approvalRequired: true as const,
  };

  switch (flag.kind) {
    case "dead_end":
      return {
        ...suggestionBase,
        title: "Add a fallback route for unmatched caller intent",
        rationale: flag.message,
        draftChange: {
          target: "workflow_draft" as const,
          operation: "add_condition_fallback",
          description: "Create a draft fallback branch that routes unresolved intent to review or escalation.",
          appliesToPublishedVersion: false as const,
        },
      };
    case "hallucination_risk":
      return {
        ...suggestionBase,
        title: "Require grounded answers for uncertain claims",
        rationale: flag.message,
        draftChange: {
          target: "workflow_draft" as const,
          operation: "tighten_grounding_instructions",
          description: "Add draft instructions requiring source-backed answers or safe uncertainty language.",
          appliesToPublishedVersion: false as const,
        },
      };
    case "slow_turn":
      return {
        ...suggestionBase,
        title: "Review slow runtime turn",
        rationale: flag.message,
        draftChange: {
          target: "workflow_draft" as const,
          operation: "review_runtime_profile",
          description: "Create a draft review item for model/tool latency and consider a routing or provider change.",
          appliesToPublishedVersion: false as const,
        },
      };
    case "escalation_miss":
      return {
        ...suggestionBase,
        title: "Tighten escalation fallback handling",
        rationale: flag.message,
        draftChange: {
          target: "workflow_draft" as const,
          operation: "adjust_escalation_policy",
          description: "Create a draft escalation policy change with clearer SLA fallback handling.",
          appliesToPublishedVersion: false as const,
        },
      };
  }
}

function readCrmSyncDiagnostic(payload: Record<string, unknown>) {
  const code = readString(payload.code) ?? "crm_sync_failed";
  const message = readString(payload.message) ?? "CRM sync failed.";
  const retryable = readBoolean(payload.retryable) ?? false;
  const nextStep = readString(payload.nextStep)
    ?? (retryable
      ? "Retry the CRM sync after the provider recovers."
      : "Review the CRM connection and summary target before retrying.");

  return {
    code,
    message: redactPostCallText(message),
    retryable,
    nextStep: redactPostCallText(nextStep),
  };
}

function collectPostCallText(events: LiveSandboxStreamEvent[]) {
  const values: string[] = [];

  for (const event of events) {
    if (event.type === "turn.transcribed") {
      const transcript = readString(event.payload.transcript);
      if (transcript !== undefined) {
        values.push(transcript);
      }
      continue;
    }

    if (event.type === "turn.completed") {
      const transcript = readString(event.payload.transcript);
      const responseText = readString(event.payload.responseText);
      if (transcript !== undefined) {
        values.push(transcript);
      }
      if (responseText !== undefined) {
        values.push(responseText);
      }
    }
  }

  return values;
}

function redactPostCallText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-payment-card]")
    .replace(/\+[1-9]\d{7,14}\b/g, "[redacted-phone]")
    .replace(/secret:\/\/[^\s)]+/gi, "[redacted-secret]")
    .replace(/\b(password|token|api key)\s*[:=]\s*[^\s]+/gi, "$1=[redacted-secret]");
}

function redactPayloadForStorage(input: {
  payload: Record<string, unknown>;
  redactSensitiveData: boolean;
}): Record<string, unknown> {
  const clonedPayload = clonePayload(input.payload);

  if (!input.redactSensitiveData) {
    return clonedPayload;
  }

  return redactUnknownValue(clonedPayload) as Record<string, unknown>;
}

function redactUnknownValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactPostCallText(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactUnknownValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, redactUnknownValue(nestedValue)]),
    );
  }

  return value;
}

function shouldRedactSessionPayload(input: {
  sessionKey: string;
  manifestsBySessionKey: Map<string, CompiledRuntimeManifest>;
}) {
  return input.manifestsBySessionKey.get(input.sessionKey)?.telemetry.redactSensitiveData === true;
}

function truncatePostCallText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function readEscalationFallbackMode(value: unknown) {
  return value === "callback" || value === "voicemail" || value === "ticket" ? value : undefined;
}

function getMissingProviderEnv(provider: unknown) {
  const availability = (provider as { availability?: LiveSandboxProviderAvailability | undefined }).availability;

  if (availability === undefined || availability.configured) {
    return [];
  }

  return availability.missingEnv;
}

function getTextModelProviderAvailability(
  provider: SandwichTextModelProvider,
  providerId: TextModelProviderId,
) {
  const availabilityProbe = provider as {
    getProviderAvailability?: (providerId: TextModelProviderId) => LiveSandboxProviderAvailability;
  };

  if (availabilityProbe.getProviderAvailability !== undefined) {
    return availabilityProbe.getProviderAvailability(providerId);
  }

  return (provider as { availability?: LiveSandboxProviderAvailability | undefined }).availability;
}

function formatTextModelProviderName(providerId: TextModelProviderId) {
  switch (providerId) {
    case "google-gemini":
      return "Gemini";
    case "openai":
      return "OpenAI";
  }
}

function buildStreamingSttConfiguration(manifest: CompiledRuntimeManifest): LiveSandboxSttStreamingConfiguration {
  const activeRole =
    manifest.roles.find((role) => role.id === manifest.entryRoleId)
    ?? manifest.roles[0];

  return {
    languageCode: activeRole?.languagePolicy.defaultLanguage ?? "en",
    keytermsPrompt: buildStreamingSttKeyterms(manifest),
    minTurnSilenceMs: 700,
    maxTurnSilenceMs: 2600,
    continuousPartials: true,
  };
}

function buildStreamingSttKeyterms(manifest: CompiledRuntimeManifest) {
  const terms = [
    manifest.graph.name,
    manifest.workflowId,
    ...manifest.roles.flatMap((role) => [
      role.name,
      role.businessName,
      role.kind,
    ]),
    ...manifest.toolBindings.flatMap((binding) => [
      binding.label,
      binding.toolName,
      binding.integrationLabel,
      binding.connector,
    ]),
    ...manifest.agentToolAssignments.flatMap((assignment) => [
      assignment.label,
      assignment.toolId,
    ]),
  ];

  return [...new Set(
    terms
      .map((term) => sanitizeStreamingSttTerm(term))
      .filter((term): term is string => term !== undefined)
      .slice(0, 50),
  )];
}

function sanitizeStreamingSttTerm(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/secret:\/\/[^\s)]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length < 2 || normalized.length > 80) {
    return undefined;
  }

  return normalized;
}

function readTurnResponseText(result: unknown) {
  if (result === null || typeof result !== "object") {
    return undefined;
  }

  return readString((result as { responseText?: unknown }).responseText);
}

function readProviderFailureDiagnostic(error: Error) {
  const diagnostic = error as {
    closeCode?: unknown;
    closeReason?: unknown;
  };

  return {
    ...(typeof diagnostic.closeCode === "number" ? { closeCode: diagnostic.closeCode } : {}),
    ...(typeof diagnostic.closeReason === "string" && diagnostic.closeReason.length > 0
      ? { closeReason: diagnostic.closeReason }
      : {}),
  };
}

function cloneEscalation(escalation: LiveSandboxEscalationRecord): LiveSandboxEscalationRecord {
  return { ...escalation };
}

function clonePostCallSummary(
  summary: LiveSandboxPostCallSummaryResponse,
): LiveSandboxPostCallSummaryResponse {
  return JSON.parse(JSON.stringify(summary)) as LiveSandboxPostCallSummaryResponse;
}

function clonePayload(payload: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function cloneManifest(manifest: CompiledRuntimeManifest): CompiledRuntimeManifest {
  return JSON.parse(JSON.stringify(manifest)) as CompiledRuntimeManifest;
}

function normalizeCallPhase(callPhase: string | undefined): RuntimeCallPhase {
  switch (callPhase) {
    case "greeting":
    case "discovery":
    case "tool-use":
    case "resolution":
    case "escalation":
      return callPhase;
    default:
      return "discovery";
  }
}

function normalizeSandboxIntent(intent: string | undefined) {
  const normalized = intent?.trim().toLowerCase();
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined;
}

function isTextInputMessage(message: LiveSandboxClientMessage): message is LiveSandboxTextInputMessage {
  return message.type === "input.text" && typeof message.transcript === "string";
}

function isAudioAppendMessage(message: LiveSandboxClientMessage): message is LiveSandboxAudioAppendMessage {
  return message.type === "input.audio.append" && typeof message.audioBase64 === "string";
}

function isAudioCommitMessage(message: LiveSandboxClientMessage): message is LiveSandboxAudioCommitMessage {
  return message.type === "input.audio.commit";
}
