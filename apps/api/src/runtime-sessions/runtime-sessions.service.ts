import {
  Inject,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  createPremiumRealtimeSession,
  type CompiledRuntimeManifest,
  type PremiumRealtimeSession,
  type TurnRuntimePacket,
} from "@zara/core";
import { GeminiLiveRealtimeAdapter } from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "../sandbox-live-sessions/openai-realtime.adapter";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";
import {
  PremiumRealtimeToolLoopService,
  type PremiumRealtimeToolLoopResult,
} from "./premium-realtime-tool-loop.service";

export interface CreateRealtimeSessionRequest {
  manifest: CompiledRuntimeManifest;
  activeRoleId: string;
  budgetAllowed: boolean;
  organizationId?: string | undefined;
  workspaceId?: string | undefined;
  actorUserId?: string | undefined;
  now?: string | undefined;
  ttlMinutes?: number | undefined;
  realtimeAvailable?: boolean | undefined;
}

export interface RegisteredPremiumRealtimeSession {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  session: PremiumRealtimeSession;
  manifest: CompiledRuntimeManifest;
  activeRoleId: string;
  transcript: string;
  packet: TurnRuntimePacket;
}

export interface ProcessPremiumRealtimeProviderMessageRequest {
  organizationId: string;
  sessionId: string;
  workspaceId: string;
  actorUserId: string;
  session: PremiumRealtimeSession;
  manifest: CompiledRuntimeManifest;
  activeRoleId: string;
  transcript: string;
  packet: TurnRuntimePacket;
  rawProviderMessage: string;
  at: string;
}

@Injectable()
export class RuntimeSessionsService {
  private readonly sessions = new Map<string, RegisteredPremiumRealtimeSession>();

  constructor(
    @Inject(PremiumRealtimeToolLoopService)
    private readonly premiumRealtimeToolLoopService: Pick<
      PremiumRealtimeToolLoopService,
      "processOpenAiProviderMessage" | "processGeminiProviderMessage"
    >,
  ) {}

  createRealtimeSession(input: CreateRealtimeSessionRequest): PremiumRealtimeSession {
    if (input.realtimeAvailable === false) {
      throw new ServiceUnavailableException("Premium realtime is unavailable right now.");
    }

    try {
      const baseSession = createPremiumRealtimeSession({
        manifest: input.manifest,
        activeRoleId: input.activeRoleId,
        budgetAllowed: input.budgetAllowed,
        defaultGeminiLiveModel: resolveLiveSandboxProviderConfig(process.env).geminiLiveModel,
        ...(input.now !== undefined ? { now: () => input.now! } : {}),
        ...(input.ttlMinutes !== undefined ? { ttlMinutes: input.ttlMinutes } : {}),
      });
      const session = {
        ...baseSession,
        transportUrl: `/runtime/realtime/sessions/${encodeURIComponent(baseSession.sessionId)}/stream`,
      };
      const workspaceId = input.workspaceId ?? input.manifest.workspaceId ?? "workspace-default";
      this.sessions.set(session.sessionId, {
        organizationId: input.organizationId ?? input.manifest.tenantId,
        workspaceId,
        actorUserId: input.actorUserId ?? "system",
        session,
        manifest: input.manifest,
        activeRoleId: input.activeRoleId,
        transcript: "",
        packet: createInitialPremiumRealtimePacket({
          session,
          manifest: input.manifest,
          workspaceId,
        }),
      });

      return session;
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message.startsWith("Premium realtime is not enabled") ||
          error.message === "Premium realtime is blocked by the current budget policy."
        )
      ) {
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }

  getRegisteredSession(sessionId: string): RegisteredPremiumRealtimeSession | null {
    const registered = this.sessions.get(sessionId);
    if (registered === undefined) {
      return null;
    }

    if (new Date(registered.session.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }

    return registered;
  }

  updateRegisteredSession(input: {
    sessionId: string;
    packet?: TurnRuntimePacket | undefined;
    transcript?: string | undefined;
  }) {
    const registered = this.sessions.get(input.sessionId);
    if (registered === undefined) {
      return;
    }

    this.sessions.set(input.sessionId, {
      ...registered,
      ...(input.packet !== undefined ? { packet: input.packet } : {}),
      ...(input.transcript !== undefined ? { transcript: input.transcript } : {}),
    });
  }

  processProviderMessage(
    input: ProcessPremiumRealtimeProviderMessageRequest,
  ): Promise<PremiumRealtimeToolLoopResult> {
    if (input.session.runtime === "gemini-live") {
      return this.premiumRealtimeToolLoopService.processGeminiProviderMessage({
        ...input,
        declarations: input.session.toolDeclarations,
        adapter: new GeminiLiveRealtimeAdapter({
          apiKey: "server-owned-provider-session",
          model: input.session.model,
          systemPrompt: "",
          tools: input.session.toolDeclarations,
        }),
      });
    }

    return this.premiumRealtimeToolLoopService.processOpenAiProviderMessage({
      ...input,
      declarations: input.session.toolDeclarations,
      adapter: new OpenAiRealtimeAdapter({
        model: input.session.model,
        systemPrompt: "",
        tools: input.session.toolDeclarations,
      }),
    });
  }
}

function createInitialPremiumRealtimePacket(input: {
  session: PremiumRealtimeSession;
  manifest: CompiledRuntimeManifest;
  workspaceId: string;
}): TurnRuntimePacket {
  return {
    schemaVersion: "turn-runtime-packet.v1",
    ids: {
      tenantId: input.manifest.tenantId,
      workspaceId: input.workspaceId,
      callSessionId: input.session.sessionId,
      turnId: `${input.session.sessionId}:turn:1`,
      manifestId: input.manifest.manifestId,
      manifestVersion: input.manifest.version,
    },
    timing: {
      startedAt: new Date().toISOString(),
      sequence: 1,
    },
    callerInput: {
      latestCallerTurn: "",
      source: "voice",
      recentTranscript: [],
    },
    graph: {
      entryNodeId: input.manifest.entryNodeId,
      currentNodeId: input.session.activeRoleId,
      visitedNodeIds: [],
      frontierNodeIds: [input.session.activeRoleId],
      activeAgent: {
        id: input.session.activeRoleId,
        name: input.manifest.roles.find((role) => role.id === input.session.activeRoleId)?.name ?? input.session.activeRoleId,
        kind: "agent",
      },
    },
    availableTools: input.manifest.agentToolAssignments.filter(
      (assignment) => assignment.roleId === input.session.activeRoleId,
    ),
    toolCalls: [],
    safety: {
      untrustedSources: ["caller_transcript", "tool_output"],
      redactionApplied: input.manifest.telemetry.redactSensitiveData,
      maxModelContextBytes: 24_000,
    },
    diagnostics: {
      warnings: [],
      events: [],
    },
  };
}
