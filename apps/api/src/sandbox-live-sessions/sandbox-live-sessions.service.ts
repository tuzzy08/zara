import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  createCostOptimizedSandwichRuntimeAdapter,
  estimateRuntimeCost,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type RuntimeCallPhase,
  type RuntimeUsageMetrics,
  type SandwichTextModelProvider,
  type SandwichTtsProvider,
  resolveConditionBranch,
  type WorkflowEdge,
} from "@zara/core";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { WorkspacesService } from "../workspaces/workspaces.service";
import {
  liveSandboxSttProviderToken,
  liveSandboxTextModelProviderToken,
  liveSandboxToolRegistryToken,
  liveSandboxTtsProviderToken,
  type LiveSandboxSttProvider,
  type LiveSandboxToolRegistry,
} from "./sandbox-live-sessions.providers";
import type {
  CreateLiveSandboxSessionRequest,
  LiveSandboxAudioAppendMessage,
  LiveSandboxAudioCommitMessage,
  LiveSandboxClientMessage,
  LiveSandboxProviderStack,
  LiveSandboxStreamEvent,
  LiveSandboxSessionRecord,
  LiveSandboxSessionResponse,
  LiveSandboxTextInputMessage,
} from "./sandbox-live-sessions.models";

const liveSandboxProviderStack: LiveSandboxProviderStack = {
  stt: "assemblyai-streaming",
  tts: "cartesia-sonic-3",
};

const defaultTtlMinutes = 10;
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
  private readonly sessionsByOrganizationId = new Map<string, Map<string, LiveSandboxSessionRecord>>();
  private readonly manifestsBySessionKey = new Map<string, CompiledRuntimeManifest>();
  private readonly frontierBySessionKey = new Map<string, string[]>();
  private readonly bufferedAudioFramesBySessionKey = new Map<string, string[]>();
  private readonly listenersBySessionKey = new Map<string, Set<(event: LiveSandboxStreamEvent) => void>>();
  private readonly sequenceBySessionKey = new Map<string, number>();
  private readonly transportSecurityAudits: LiveSandboxTransportAuditEntry[] = [];

  constructor(
    private readonly workspacesService: WorkspacesService,
    @Inject(liveSandboxTextModelProviderToken)
    private readonly textModelProvider: SandwichTextModelProvider,
    @Inject(liveSandboxSttProviderToken)
    private readonly sttProvider: LiveSandboxSttProvider,
    @Inject(liveSandboxTtsProviderToken)
    private readonly ttsProvider: SandwichTtsProvider,
    @Inject(liveSandboxToolRegistryToken)
    private readonly toolRegistry: LiveSandboxToolRegistry,
  ) {}

  createSession(
    organizationId: string,
    input: CreateLiveSandboxSessionRequest,
  ): LiveSandboxSessionResponse {
    this.assertUserCanAccessWorkspace({
      organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
    });
    this.assertManifestWorkspace(input.manifest, input.workspaceId);

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
      providerStack: liveSandboxProviderStack,
      createdAt,
      expiresAt,
      status: "ready",
    };

    const organizationSessions = this.getOrCreateOrganizationSessions(organizationId);
    organizationSessions.set(sessionId, session);
    const sessionKey = getSessionKey(organizationId, sessionId);
    this.sequenceBySessionKey.set(sessionKey, 0);
    this.manifestsBySessionKey.set(sessionKey, cloneManifest(input.manifest));
    this.frontierBySessionKey.set(sessionKey, [input.manifest.entryNodeId]);
    this.bufferedAudioFramesBySessionKey.set(sessionKey, []);

    return toSessionResponse(session, transportToken);
  }

  getSession(organizationId: string, sessionId: string): LiveSandboxSessionResponse {
    const session = this.requireSession(organizationId, sessionId);
    this.expireIfNeeded(session);
    return toSessionResponse(session);
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
    this.listenersBySessionKey.delete(sessionKey);
    this.manifestsBySessionKey.delete(sessionKey);
    this.frontierBySessionKey.delete(sessionKey);
    this.bufferedAudioFramesBySessionKey.delete(sessionKey);

    return toSessionResponse(session);
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

    if (session.status !== "ready") {
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
    this.expireIfNeeded(session, input.at);

    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const nextSequence = (this.sequenceBySessionKey.get(sessionKey) ?? 0) + 1;
    this.sequenceBySessionKey.set(sessionKey, nextSequence);

    const event: LiveSandboxStreamEvent = {
      sessionId: input.sessionId,
      sequence: nextSequence,
      type: input.type,
      at: input.at ?? new Date().toISOString(),
      payload: clonePayload(input.payload),
    };

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
      });
    }

    if (isAudioAppendMessage(input.message)) {
      const sessionKey = getSessionKey(input.organizationId, input.sessionId);
      const bufferedFrames = this.bufferedAudioFramesBySessionKey.get(sessionKey) ?? [];

      bufferedFrames.push(input.message.audioBase64);
      this.bufferedAudioFramesBySessionKey.set(sessionKey, bufferedFrames);
      return this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "input.audio.buffered",
        at: input.at,
        payload: {
          chunkCount: bufferedFrames.length,
        },
      });
    }

    if (isAudioCommitMessage(input.message)) {
      return this.runVoiceTurn({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        at: input.at,
        callPhase: normalizeCallPhase(input.message.callPhase),
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

  private expireIfNeeded(session: LiveSandboxSessionRecord, now = new Date().toISOString()) {
    if (
      session.status !== "ended" &&
      Date.parse(session.expiresAt) <= Date.parse(now)
    ) {
      session.status = "expired";
      session.transportTokenHash = "";
    }
  }

  private async runTypedTurn(input: {
    organizationId: string;
    sessionId: string;
    transcript: string;
    callPhase: RuntimeCallPhase;
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

    if (manifest === undefined) {
      throw new NotFoundException(`Live sandbox manifest for session '${input.sessionId}' was not found.`);
    }

    const routeResolution = resolveSessionTurnRoute({
      manifest,
      frontier,
      transcript: input.transcript,
    });

    routeResolution.preEvents.forEach((event) => {
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: event.type,
        at: input.at,
        payload: event.payload,
      });
    });

    await this.executeToolInvocations({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      session,
      manifest,
      transcript: input.transcript,
      toolInvocations: routeResolution.toolInvocations,
      at: input.at,
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
        at: input.at,
        payload: {
          transcript: input.transcript,
          responseText: routeResolution.responseText,
          terminalNodeId: routeResolution.nodeId,
        },
      });

      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "call.ended",
        at: input.at,
        payload: {
          disposition: "sandbox_terminal_path",
          nodeId: routeResolution.nodeId,
        },
      });
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "turn.cost.delta",
        at: input.at,
        payload: {
          currency: costDelta.currency,
          totalUsd: costDelta.totalUsd,
          components: costDelta.components,
          usage: costDelta.usage,
        },
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
      model: this.textModelProvider,
      tts: this.ttsProvider,
      now: () => input.at ?? new Date().toISOString(),
      createEventId: (type, index) => `${input.sessionId}:${type}:${index + 1}`,
    });

    try {
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "turn.transcribed",
        at: input.at,
        payload: {
          transcript: input.transcript,
          source: input.source ?? "typed",
          language: input.language ?? activeRole.languagePolicy.defaultLanguage,
          confidence: input.confidence ?? 1,
          callPhase: input.callPhase,
        },
      });

      const runtimeStartedAt = Date.now();
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
      });
      const runtimeLatencyMs = Math.max(0, Date.now() - runtimeStartedAt);

      for (const event of result.events) {
        if (event.type === "turn.transcribed") {
          continue;
        }

        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: event.type,
          at: event.at,
          payload: event.payload,
        });
      }

      result.audioChunks.forEach((audioBase64, index) => {
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "turn.audio.chunk",
          at: input.at,
          payload: {
            audioBase64,
            chunkIndex: index,
          },
        });
      });

      const firstByteLatencyMs = extractFirstByteLatencyFromSandboxEvents(result.events);
      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "provider.telemetry",
        at: input.at,
        payload: {
          stage: "model",
          provider: "openai-chat",
          latencyMs: Math.max(0, runtimeLatencyMs - (firstByteLatencyMs ?? 0)),
          tier: result.routingDecision.tier,
        },
      });
      if (firstByteLatencyMs !== undefined) {
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "provider.telemetry",
          at: input.at,
          payload: {
            stage: "tts",
            provider: liveSandboxProviderStack.tts,
            latencyMs: firstByteLatencyMs,
          },
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
        at: input.at,
        payload: {
          currency: costDelta.currency,
          totalUsd: costDelta.totalUsd,
          components: costDelta.components,
          usage: costDelta.usage,
          modelTier: costDelta.modelTier,
        },
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live sandbox turn failed.";

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
      throw error;
    }
  }

  private async runVoiceTurn(input: {
    organizationId: string;
    sessionId: string;
    callPhase: RuntimeCallPhase;
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
    const transcription = await this.sttProvider.transcribeTurn({
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
    const sttLatencyMs = Math.max(0, Date.now() - sttStartedAt);
    this.publishSessionEvent({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      type: "provider.telemetry",
      at: input.at,
      payload: {
        stage: "stt",
        provider: liveSandboxProviderStack.stt,
        latencyMs: sttLatencyMs,
      },
    });

    return this.runTypedTurn({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      transcript: transcription.transcript,
      callPhase: input.callPhase,
      source: "voice",
      confidence: transcription.confidence,
      language: transcription.language,
      at: input.at,
    });
  }

  private async executeToolInvocations(input: {
    organizationId: string;
    sessionId: string;
    session: LiveSandboxSessionRecord;
    manifest: CompiledRuntimeManifest;
    transcript: string;
    toolInvocations: ResolvedToolInvocation[];
    at?: string | undefined;
  }) {
    for (const toolInvocation of input.toolInvocations) {
      const binding = input.manifest.toolBindings.find((candidate) => candidate.nodeId === toolInvocation.nodeId);

      if (binding === undefined) {
        continue;
      }

      this.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "tool.started",
        at: input.at,
        payload: {
          nodeId: binding.nodeId,
          toolId: binding.toolId,
          toolName: binding.toolName,
        },
      });

      if (binding.requiresHumanApproval) {
        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "tool.approval_required",
          at: input.at,
          payload: {
            nodeId: binding.nodeId,
            toolId: binding.toolId,
          },
        });
      }

      const startedAt = Date.now();

      try {
        const result = await this.toolRegistry.execute({
          callSessionId: input.sessionId,
          manifest: input.manifest,
          binding,
          transcript: input.transcript,
          actorUserId: input.session.actorUserId,
          workspaceId: input.session.workspaceId,
        });
        const durationMs = result.durationMs ?? Math.max(0, Date.now() - startedAt);

        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "tool.completed",
          at: input.at,
          payload: {
            nodeId: binding.nodeId,
            toolId: binding.toolId,
            toolName: binding.toolName,
            summary: result.summary,
            durationMs,
          },
        });
      } catch (error) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const message = error instanceof Error ? error.message : "Live sandbox tool execution failed.";

        this.publishSessionEvent({
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          type: "tool.failed",
          at: input.at,
          payload: {
            nodeId: binding.nodeId,
            toolId: binding.toolId,
            toolName: binding.toolName,
            durationMs,
            reason: message,
          },
        });
      }
    }
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
    ...(transportToken !== undefined ? { transportToken } : {}),
  };
}

function hashTransportToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function addMinutes(at: string, minutes: number) {
  return new Date(Date.parse(at) + minutes * 60_000).toISOString();
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

interface RouteEvent {
  type: string;
  payload: Record<string, unknown>;
}

interface ResolvedToolInvocation {
  nodeId: string;
}

type TurnRouteResolution =
  | {
      kind: "agent";
      activeRoleId: string;
      nextFrontier: string[];
      preEvents: RouteEvent[];
      toolInvocations: ResolvedToolInvocation[];
      context: Omit<ModelRoutingContext, "callPhase">;
    }
  | {
      kind: "terminal";
      nodeId: string;
      responseText: string;
      nextFrontier: string[];
      preEvents: RouteEvent[];
      toolInvocations: ResolvedToolInvocation[];
    };

function resolveSessionTurnRoute(input: {
  manifest: CompiledRuntimeManifest;
  frontier: string[];
  transcript: string;
}): TurnRouteResolution {
  const nodeById = new Map(input.manifest.graph.nodes.map((node) => [node.id, node]));
  const edgesBySource = groupEdgesBySource(input.manifest.graph.edges);
  const visited = new Set<string>();
  const queue = [...input.frontier.filter((nodeId) => nodeId.length > 0)];
  const preEvents: RouteEvent[] = [];
  const toolInvocations: ResolvedToolInvocation[] = [];
  const inferredIntent = inferTranscriptIntent(input.manifest, input.transcript);

  if (queue.length === 0) {
    queue.push(input.manifest.entryNodeId);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift();

    if (nodeId === undefined || visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    const node = nodeById.get(nodeId);

    if (node === undefined) {
      continue;
    }

    const outgoingTargets = getOutgoingTargets(node.id, edgesBySource);

    preEvents.push({
      type: "node.transition",
      payload: {
        nodeId: node.id,
        nodeKind: node.kind,
        label: node.label,
      },
    });

    switch (node.kind) {
      case "entry":
        queue.unshift(...outgoingTargets);
        break;
      case "agent": {
        const shouldContinuePastAgent = outgoingTargets.some((targetNodeId) => {
          const targetNode = nodeById.get(targetNodeId);
          return (
            targetNode?.kind === "condition"
            || targetNode?.kind === "handoff"
            || targetNode?.kind === "tool"
          );
        });

        if (shouldContinuePastAgent) {
          queue.unshift(...outgoingTargets);
          break;
        }

        return {
          kind: "agent",
          activeRoleId: node.roleId ?? node.id,
          nextFrontier: [...outgoingTargets],
          preEvents,
          toolInvocations,
          context: {
            ...(inferredIntent !== undefined ? { intent: inferredIntent } : {}),
          },
        };
      }
      case "condition": {
        const selection = resolveConditionBranch(node, {
          ...(inferredIntent !== undefined ? { intent: inferredIntent } : {}),
        });

        preEvents.push({
          type: "node.transition",
          payload: {
            nodeId: node.id,
            branchId: selection.branchId,
            branchLabel: selection.label,
            targetNodeId: selection.targetNodeId,
            isFallback: selection.isFallback,
          },
        });
        queue.unshift(selection.targetNodeId);
        break;
      }
      case "handoff": {
        const handoff = node.config["handoff"] as {
          targetRoleId: string;
          targetRoleName: string;
          handoffReason: string;
        };

        preEvents.push({
          type: "agent.handoff.requested",
          payload: {
            nodeId: node.id,
            targetRoleId: handoff.targetRoleId,
            reason: handoff.handoffReason,
          },
        });
        preEvents.push({
          type: "agent.handoff.completed",
          payload: {
            nodeId: node.id,
            targetRoleId: handoff.targetRoleId,
            targetRoleName: handoff.targetRoleName,
          },
        });
        queue.unshift(...outgoingTargets);
        break;
      }
      case "tool":
        toolInvocations.push({
          nodeId: node.id,
        });
        queue.unshift(...outgoingTargets);
        break;
      case "human-escalation": {
        const escalation = node.config["escalation"] as { fallbackMessage: string };
        return {
          kind: "terminal",
          nodeId: node.id,
          responseText: escalation.fallbackMessage,
          nextFrontier: [],
          preEvents,
          toolInvocations,
        };
      }
      case "end": {
        const end = node.config["end"] as { closingMessage: string };
        return {
          kind: "terminal",
          nodeId: node.id,
          responseText: end.closingMessage,
          nextFrontier: [],
          preEvents,
          toolInvocations,
        };
      }
    }
  }

  return {
    kind: "agent",
    activeRoleId: input.manifest.entryRoleId,
    nextFrontier: [],
    preEvents,
    toolInvocations,
    context: {
      ...(inferredIntent !== undefined ? { intent: inferredIntent } : {}),
    },
  };
}

function groupEdgesBySource(edges: WorkflowEdge[]) {
  const grouped = new Map<string, WorkflowEdge[]>();

  for (const edge of edges) {
    const current = grouped.get(edge.sourceNodeId) ?? [];
    current.push(edge);
    grouped.set(edge.sourceNodeId, current);
  }

  return grouped;
}

function getOutgoingTargets(nodeId: string, edgesBySource: Map<string, WorkflowEdge[]>) {
  return (edgesBySource.get(nodeId) ?? []).map((edge) => edge.targetNodeId);
}

function inferTranscriptIntent(manifest: CompiledRuntimeManifest, transcript: string) {
  const normalizedTranscript = transcript.toLowerCase();
  const candidates = new Set<string>();

  manifest.conditions.forEach((condition) => {
    condition.branches.forEach((branch) => {
      const match = branch.expression.match(/intent\s*==\s*"([^"]+)"/i);

      if (match?.[1] !== undefined) {
        candidates.add(match[1].toLowerCase());
      }
    });
  });

  for (const candidate of candidates) {
    if (normalizedTranscript.includes(candidate)) {
      return candidate;
    }
  }

  return undefined;
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
