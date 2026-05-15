import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  createCostOptimizedSandwichRuntimeAdapter,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type RuntimeCallPhase,
  type SandwichTextModelProvider,
  type SandwichTtsProvider,
  resolveConditionBranch,
  type WorkflowEdge,
} from "@zara/core";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { WorkspacesService } from "../workspaces/workspaces.service";
import {
  liveSandboxSttProviderToken,
  liveSandboxTextModelProviderToken,
  liveSandboxTtsProviderToken,
  type LiveSandboxSttProvider,
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

@Injectable()
export class SandboxLiveSessionsService {
  private readonly sessionsByOrganizationId = new Map<string, Map<string, LiveSandboxSessionRecord>>();
  private readonly manifestsBySessionKey = new Map<string, CompiledRuntimeManifest>();
  private readonly frontierBySessionKey = new Map<string, string[]>();
  private readonly bufferedAudioFramesBySessionKey = new Map<string, string[]>();
  private readonly listenersBySessionKey = new Map<string, Set<(event: LiveSandboxStreamEvent) => void>>();
  private readonly sequenceBySessionKey = new Map<string, number>();

  constructor(
    private readonly workspacesService: WorkspacesService,
    @Inject(liveSandboxTextModelProviderToken)
    private readonly textModelProvider: SandwichTextModelProvider,
    @Inject(liveSandboxSttProviderToken)
    private readonly sttProvider: LiveSandboxSttProvider,
    @Inject(liveSandboxTtsProviderToken)
    private readonly ttsProvider: SandwichTtsProvider,
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
    const transportToken = randomBytes(24).toString("base64url");
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
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    this.listenersBySessionKey.delete(sessionKey);
    this.manifestsBySessionKey.delete(sessionKey);
    this.frontierBySessionKey.delete(sessionKey);
    this.bufferedAudioFramesBySessionKey.delete(sessionKey);

    return toSessionResponse(session);
  }

  markSessionActive(input: {
    organizationId: string;
    sessionId: string;
  }) {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.expireIfNeeded(session);

    if (session.status === "ready") {
      session.status = "active";
    }
  }

  validateTransportToken(input: {
    organizationId: string;
    sessionId: string;
    token: string;
    now?: string | undefined;
  }): boolean {
    const session = this.sessionsByOrganizationId.get(input.organizationId)?.get(input.sessionId);

    if (session === undefined) {
      return false;
    }

    this.expireIfNeeded(session, input.now);

    if (session.status !== "ready" && session.status !== "active") {
      return false;
    }

    return hashTransportToken(input.token) === session.transportTokenHash;
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

    this.frontierBySessionKey.set(sessionKey, [...routeResolution.nextFrontier]);

    if (routeResolution.kind === "terminal") {
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
          confidence: 1,
          language: activeRole.languagePolicy.defaultLanguage,
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
          source: "typed",
          language: activeRole.languagePolicy.defaultLanguage,
          confidence: 1,
          callPhase: input.callPhase,
        },
      });

      const result = await runtime.runTurn({
        callSessionId: input.sessionId,
        manifest,
        activeRoleId: routeResolution.activeRoleId,
        audioFrames: [input.transcript],
        context: {
          callPhase: input.callPhase,
          language: activeRole.languagePolicy.defaultLanguage,
          ...routeResolution.context,
        } satisfies ModelRoutingContext,
      });

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
    const sessionKey = getSessionKey(input.organizationId, input.sessionId);
    const audioFramesBase64 = [...(this.bufferedAudioFramesBySessionKey.get(sessionKey) ?? [])];

    this.bufferedAudioFramesBySessionKey.set(sessionKey, []);

    if (audioFramesBase64.length === 0) {
      return null;
    }

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

    return this.runTypedTurn({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      transcript: transcription.transcript,
      callPhase: input.callPhase,
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

type TurnRouteResolution =
  | {
      kind: "agent";
      activeRoleId: string;
      nextFrontier: string[];
      preEvents: RouteEvent[];
      context: Omit<ModelRoutingContext, "callPhase">;
    }
  | {
      kind: "terminal";
      nodeId: string;
      responseText: string;
      nextFrontier: string[];
      preEvents: RouteEvent[];
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
        };
      }
    }
  }

  return {
    kind: "agent",
    activeRoleId: input.manifest.entryRoleId,
    nextFrontier: [],
    preEvents,
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
