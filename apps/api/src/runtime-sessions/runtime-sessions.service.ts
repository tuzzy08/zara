import {
  Inject,
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  buildRealtimeProviderToolDeclarations,
  createAgentToolAvailableAction,
  createInternalHandoffAvailableAction,
  createPremiumRealtimeSession,
  recordRuntimePacketAgentSelected,
  recordRuntimePacketIntent,
  recordRuntimePacketNodeVisit,
  recordRuntimePacketTransfer,
  recordRuntimePacketWarning,
  resolveAgentRoutePolicyClassification,
  resolveRuntimeAgent,
  resolveRuntimeAgents,
  type Agent,
  type AgentToolAssignment,
  type AgentRoutePolicyClassificationResolution,
  type AgentTransferContext,
  type CompiledRuntimeManifest,
  type IntentClassifierOutput,
  type PremiumRealtimeSession,
  type RealtimeProviderToolDeclaration,
  type RuntimeAgentRef,
  type ToolExecutionResult,
  type TurnRuntimePacket,
} from "@zara/core";
import { getConnectorToolSchemaById } from "../integrations/connector-tools.service";
import { GeminiLiveRealtimeAdapter } from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "../sandbox-live-sessions/openai-realtime.adapter";
import type { LiveSandboxRouteEvent } from "../sandbox-live-sessions/sandbox-live-session-router";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";
import { applyRuntimePromptPolicyModelDefaultsToManifest } from "../runtime-prompt-policy/runtime-prompt-policy.model-defaults";
import { RuntimePromptPolicyService } from "../runtime-prompt-policy/runtime-prompt-policy.service";
import {
  createOneTimeStreamToken,
  hashOneTimeStreamToken,
  resolveOneTimeStreamTokenSecret,
  verifyOneTimeStreamToken,
} from "../security/one-time-stream-token";
import {
  PremiumRealtimeToolLoopService,
  type PremiumRealtimeToolLoopResult,
} from "./premium-realtime-tool-loop.service";
import { buildPremiumRealtimeAgentPrompt } from "./premium-realtime-agent-prompt";
import { resolvePremiumRealtimeRoutePolicySourceNodeId } from "./premium-realtime-route-policies";

const internalHandoffToolName = "zara_handoff_to_agent";

export interface PremiumRealtimeProviderMessageResult extends PremiumRealtimeToolLoopResult {
  session?: PremiumRealtimeSession | undefined;
  activeAgentId?: string | undefined;
  routeEvents?: LiveSandboxRouteEvent[] | undefined;
  transcript?: string | undefined;
}

export interface CreateRealtimeSessionRequest {
  manifest: CompiledRuntimeManifest;
  activeAgentId: string;
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
  activeAgentId: string;
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
  activeAgentId: string;
  transcript: string;
  packet: TurnRuntimePacket;
  rawProviderMessage: string;
  at: string;
}

interface PendingOpenAiHandoffContinuation {
  manifest: CompiledRuntimeManifest;
  session: PremiumRealtimeSession;
  activeAgentId: string;
  packet: TurnRuntimePacket;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
}

interface PremiumRealtimeTransportTokenRecord {
  tokenHash: string;
  expiresAt: string;
  consumedAt?: string | undefined;
}

@Injectable()
export class RuntimeSessionsService {
  private readonly sessions = new Map<string, RegisteredPremiumRealtimeSession>();
  private readonly transportTokensBySessionId = new Map<string, PremiumRealtimeTransportTokenRecord>();
  private readonly streamTokenSecret = resolveOneTimeStreamTokenSecret();
  private readonly pendingOpenAiHandoffContinuations = new Map<string, PendingOpenAiHandoffContinuation>();

  constructor(
    @Inject(PremiumRealtimeToolLoopService)
    private readonly premiumRealtimeToolLoopService: Pick<
      PremiumRealtimeToolLoopService,
      "processOpenAiProviderMessage" | "processGeminiProviderMessage"
    >,
    @Optional()
    private readonly runtimePromptPolicyService?: Pick<RuntimePromptPolicyService, "getPromptPolicy">,
  ) {}

  async createRealtimeSession(input: CreateRealtimeSessionRequest): Promise<PremiumRealtimeSession> {
    if (input.realtimeAvailable === false) {
      throw new ServiceUnavailableException("Premium realtime is unavailable right now.");
    }

    try {
      const manifest = this.runtimePromptPolicyService === undefined
        ? input.manifest
        : applyRuntimePromptPolicyModelDefaultsToManifest(
            input.manifest,
            await this.runtimePromptPolicyService.getPromptPolicy(),
          );
      const baseSession = createPremiumRealtimeSession({
        manifest,
        activeAgentId: input.activeAgentId,
        budgetAllowed: input.budgetAllowed,
        defaultGeminiLiveModel: resolveLiveSandboxProviderConfig(process.env).geminiLiveModel,
        ...(input.now !== undefined ? { now: () => input.now! } : {}),
        ...(input.ttlMinutes !== undefined ? { ttlMinutes: input.ttlMinutes } : {}),
      });
      const workspaceId = input.workspaceId ?? manifest.workspaceId ?? "workspace-default";
      const organizationId = input.organizationId ?? manifest.tenantId;
      const transportToken = createOneTimeStreamToken({
        secret: this.streamTokenSecret,
        subject: baseSession.sessionId,
        scope: {
          organizationId,
          workspaceId,
          manifestId: manifest.manifestId,
        },
        expiresAt: baseSession.expiresAt,
      });
      const session = {
        ...baseSession,
        transportUrl: `/runtime/realtime/sessions/${encodeURIComponent(baseSession.sessionId)}/stream?token=${encodeURIComponent(transportToken.token)}`,
        transportToken: transportToken.token,
        toolDeclarations: buildPremiumRealtimeToolDeclarations({
          manifest: input.manifest,
          activeAgentId: input.activeAgentId,
        }),
      };
      this.transportTokensBySessionId.set(session.sessionId, {
        tokenHash: transportToken.tokenHash,
        expiresAt: transportToken.expiresAt,
      });
      this.sessions.set(session.sessionId, {
        organizationId,
        workspaceId,
        actorUserId: input.actorUserId ?? "system",
        session: omitPremiumRealtimeTransportToken(session),
        manifest,
        activeAgentId: input.activeAgentId,
        transcript: "",
        packet: createInitialPremiumRealtimePacket({
          session,
          manifest,
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

  terminateRealtimeSession(sessionId: string) {
    this.sessions.delete(sessionId);
    this.transportTokensBySessionId.delete(sessionId);
    this.pendingOpenAiHandoffContinuations.delete(sessionId);
  }

  consumeRealtimeSessionTransportToken(input: {
    sessionId: string;
    token: string;
    now?: string | undefined;
  }): RegisteredPremiumRealtimeSession | null {
    const registered = this.getRegisteredSession(input.sessionId);
    if (registered === null) {
      return null;
    }

    const tokenRecord = this.transportTokensBySessionId.get(input.sessionId);
    if (tokenRecord === undefined || tokenRecord.consumedAt !== undefined) {
      return null;
    }

    const now = input.now ?? new Date().toISOString();
    if (
      tokenRecord.tokenHash !== hashOneTimeStreamToken(input.token) ||
      Date.parse(tokenRecord.expiresAt) <= Date.parse(now) ||
      !verifyOneTimeStreamToken({
        secret: this.streamTokenSecret,
        token: input.token,
        expectedSubject: input.sessionId,
        expectedScope: {
          organizationId: registered.organizationId,
          workspaceId: registered.workspaceId,
          manifestId: registered.manifest.manifestId,
        },
        now,
      })
    ) {
      return null;
    }

    this.transportTokensBySessionId.set(input.sessionId, {
      ...tokenRecord,
      consumedAt: now,
    });
    return registered;
  }

  updateRegisteredSession(input: {
    sessionId: string;
    session?: PremiumRealtimeSession | undefined;
    activeAgentId?: string | undefined;
    packet?: TurnRuntimePacket | undefined;
    transcript?: string | undefined;
  }) {
    const registered = this.sessions.get(input.sessionId);
    if (registered === undefined) {
      return;
    }

    this.sessions.set(input.sessionId, {
      ...registered,
      ...(input.session !== undefined ? { session: input.session } : {}),
      ...(input.activeAgentId !== undefined ? { activeAgentId: input.activeAgentId } : {}),
      ...(input.packet !== undefined ? { packet: input.packet } : {}),
      ...(input.transcript !== undefined ? { transcript: input.transcript } : {}),
    });
  }

  processProviderMessage(
    input: ProcessPremiumRealtimeProviderMessageRequest,
  ): Promise<PremiumRealtimeProviderMessageResult> {
    if (input.session.runtime === "gemini-live") {
      const adapter = new GeminiLiveRealtimeAdapter({
        apiKey: "server-owned-provider-session",
        model: input.session.model,
        systemPrompt: "",
        tools: input.session.toolDeclarations,
      });
      const handoffToolCall = adapter.parseServerMessage(input.rawProviderMessage).find(
        (event) => event.type === "tool_call" && event.name === internalHandoffToolName,
      );
      if (handoffToolCall?.type === "tool_call") {
        return Promise.resolve(this.handleProviderHandoffToolCall({
          ...input,
          adapter,
          provider: "gemini-live",
          providerCallId: handoffToolCall.providerCallId,
          handoffArguments: handoffToolCall.arguments,
        }));
      }

      return this.premiumRealtimeToolLoopService.processGeminiProviderMessage({
        ...input,
        declarations: input.session.toolDeclarations,
        adapter,
      });
    }

    const adapter = new OpenAiRealtimeAdapter({
      model: input.session.model,
      systemPrompt: "",
      tools: input.session.toolDeclarations,
    });
    const pendingOpenAiHandoffContinuation = this.pendingOpenAiHandoffContinuations.get(input.sessionId);
    const responseDoneStatus = parseOpenAiResponseDoneStatus(input.rawProviderMessage);
    if (pendingOpenAiHandoffContinuation !== undefined && responseDoneStatus !== undefined) {
      this.pendingOpenAiHandoffContinuations.delete(input.sessionId);
      if (responseDoneStatus === "completed") {
        return Promise.resolve(completePendingOpenAiHandoffContinuation(pendingOpenAiHandoffContinuation));
      }

      return Promise.resolve({
        packet: input.packet,
        providerMessages: [],
      });
    }

    const handoffToolCall = adapter.parseServerMessage(input.rawProviderMessage).find(
      (event) => event.type === "tool_call" && event.name === internalHandoffToolName,
    );
    if (handoffToolCall?.type === "tool_call") {
      return Promise.resolve(this.handleProviderHandoffToolCall({
        ...input,
        adapter,
        provider: "openai-realtime",
        providerCallId: handoffToolCall.providerCallId,
        handoffArguments: parseProviderHandoffArguments(handoffToolCall.argumentsJson),
        handoffAnnouncementAlreadySpoken: openAiHandoffToolCallWasPrecededByAssistantMessage({
          rawProviderMessage: input.rawProviderMessage,
          providerCallId: handoffToolCall.providerCallId,
        }),
      }));
    }

    return this.premiumRealtimeToolLoopService.processOpenAiProviderMessage({
      ...input,
      declarations: input.session.toolDeclarations,
      adapter,
    });
  }

  private handleProviderHandoffToolCall(input: ProcessPremiumRealtimeProviderMessageRequest & {
    provider: PremiumRealtimeSession["runtime"];
    adapter: OpenAiRealtimeAdapter | GeminiLiveRealtimeAdapter;
    providerCallId: string;
    handoffArguments: Record<string, unknown>;
    handoffAnnouncementAlreadySpoken?: boolean | undefined;
  }): PremiumRealtimeProviderMessageResult {
    const manifest = input.manifest;
    const routeResult = resolvePremiumRealtimeHandoffToolCall({
      manifest,
      activeAgentId: input.activeAgentId,
      packet: input.packet,
      transcript: input.transcript,
      at: input.at,
      handoffArguments: input.handoffArguments,
    });
    const nextSession = {
      ...input.session,
      activeAgentId: routeResult.activeAgentId,
      toolDeclarations: buildPremiumRealtimeToolDeclarations({
        manifest,
        activeAgentId: routeResult.activeAgentId,
      }),
    };
    const providerMessages = buildProviderHandoffToolMessages({
      provider: input.provider,
      adapter: input.adapter,
      manifest,
      session: nextSession,
      activeAgentId: routeResult.activeAgentId,
      providerCallId: input.providerCallId,
      routeEvents: routeResult.routeEvents,
      output: routeResult.output,
      handoffAnnouncementAlreadySpoken: input.handoffAnnouncementAlreadySpoken === true,
    });
    const handoffAnnouncementText = resolveHandoffContinuationAnnouncementText({
      routeEvents: routeResult.routeEvents,
      output: routeResult.output,
    });

    if (
      input.provider === "openai-realtime"
      && routeResult.routeEvents.length > 0
      && input.handoffAnnouncementAlreadySpoken !== true
      && handoffAnnouncementText !== undefined
    ) {
      this.pendingOpenAiHandoffContinuations.set(input.sessionId, {
        manifest,
        session: nextSession,
        activeAgentId: routeResult.activeAgentId,
        packet: routeResult.packet,
        routeEvents: routeResult.routeEvents,
        output: routeResult.output,
      });
      return {
        packet: input.packet,
        routeEvents: [],
        providerMessages: [
          (input.adapter as OpenAiRealtimeAdapter).createFunctionCallOutputMessage({
            providerCallId: input.providerCallId,
            output: routeResult.output,
          }),
          (input.adapter as OpenAiRealtimeAdapter).createResponseCreateMessage({
            instructions: buildSourceHandoffAnnouncementResponseInstructions(handoffAnnouncementText),
          }),
        ],
      };
    }

    return {
      session: nextSession,
      activeAgentId: routeResult.activeAgentId,
      packet: routeResult.packet,
      routeEvents: routeResult.routeEvents,
      providerMessages,
    };
  }

}

function buildPremiumRealtimeToolDeclarations(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: string;
}): RealtimeProviderToolDeclaration[] {
  return buildRealtimeProviderToolDeclarations({
    manifest: withPremiumRealtimeConnectorToolSchemas(input.manifest),
    activeAgentId: input.activeAgentId,
  });
}

function withPremiumRealtimeConnectorToolSchemas(
  manifest: CompiledRuntimeManifest,
): CompiledRuntimeManifest {
  return {
    ...manifest,
    agentToolAssignments: manifest.agentToolAssignments.map(
      hydratePremiumRealtimeAgentToolAssignment,
    ),
  };
}

function hydratePremiumRealtimeAgentToolAssignment<T extends AgentToolAssignment>(
  assignment: T,
): T {
  const connectorSchema = getConnectorToolSchemaById(assignment.toolId);
  const connectorInputSchema = connectorSchema?.inputSchema;
  const requiredAlternatives = resolvePremiumRealtimeRequiredAlternatives(
    assignment,
    connectorSchema?.requiredAlternatives,
  );

  return {
    ...assignment,
    inputSchema: resolvePremiumRealtimeToolInputSchema(assignment, connectorInputSchema),
    requiredInputs: resolvePremiumRealtimeRequiredInputs(assignment, connectorInputSchema?.required),
    ...(requiredAlternatives !== undefined ? { requiredAlternatives } : {}),
  };
}

function resolvePremiumRealtimeToolInputSchema(
  assignment: Pick<AgentToolAssignment, "inputSchema">,
  connectorInputSchema: { required?: string[] } & Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (connectorInputSchema === undefined) {
    return structuredClone(assignment.inputSchema) as Record<string, unknown>;
  }

  return structuredClone(connectorInputSchema) as Record<string, unknown>;
}

function resolvePremiumRealtimeRequiredInputs(
  assignment: Pick<AgentToolAssignment, "requiredInputs">,
  connectorRequiredInputs: string[] | undefined,
): string[] {
  return Array.from(new Set([...assignment.requiredInputs, ...(connectorRequiredInputs ?? [])]));
}

function resolvePremiumRealtimeRequiredAlternatives(
  assignment: Pick<AgentToolAssignment, "requiredAlternatives">,
  connectorRequiredAlternatives: string[][] | undefined,
): string[][] | undefined {
  const requiredAlternatives = [
    ...(assignment.requiredAlternatives ?? []),
    ...(connectorRequiredAlternatives ?? []),
  ];

  return requiredAlternatives.length > 0
    ? requiredAlternatives.map((alternative) => [...alternative])
    : undefined;
}

function omitPremiumRealtimeTransportToken(session: PremiumRealtimeSession): PremiumRealtimeSession {
  const safeSession = { ...(session as unknown as Record<string, unknown>) };
  delete safeSession["transportToken"];
  return safeSession as unknown as PremiumRealtimeSession;
}

function resolvePremiumRealtimeRoutePolicy(
  manifest: CompiledRuntimeManifest,
  activeAgentId: string,
) {
  const sourceNodeId = resolvePremiumRealtimeRoutePolicySourceNodeId(manifest, activeAgentId);
  if (sourceNodeId === undefined) {
    return undefined;
  }

  return (manifest.routePolicies ?? []).find((policy) => policy.sourceAgentId === sourceNodeId);
}

function parseProviderHandoffArguments(argumentsJson?: string): Record<string, unknown> {
  if (argumentsJson === undefined || argumentsJson.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function resolvePremiumRealtimeHandoffToolCall(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: string;
  packet: TurnRuntimePacket;
  transcript: string;
  at: string;
  handoffArguments: Record<string, unknown>;
}): {
  activeAgentId: string;
  packet: TurnRuntimePacket;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
} {
  const routePolicy = resolvePremiumRealtimeRoutePolicy(input.manifest, input.activeAgentId);
  const currentAgentId = resolvePremiumRealtimeActiveAgentId(input.manifest, input.activeAgentId);
  if (routePolicy === undefined) {
    const packet = recordRuntimePacketWarning(input.packet, {
      at: input.at,
      nodeId: currentAgentId,
      warning: {
        code: "handoff_tool.policy_missing",
        message: "The provider requested handoff, but the active agent has no handoff policy.",
        recoverable: true,
      },
    });

    return {
      activeAgentId: currentAgentId,
      packet,
      routeEvents: [],
      output: {
        status: "failed",
        summary: "No handoff policy is configured for the active agent.",
        activeAgentId: currentAgentId,
        error: {
          code: "handoff_tool.policy_missing",
          message: "No handoff policy is configured for the active agent.",
          recoverable: true,
        },
      },
    };
  }

  const targetAgentId = typeof input.handoffArguments["targetAgentId"] === "string"
    ? input.handoffArguments["targetAgentId"].trim()
    : "";
  const hasTargetAgentId = targetAgentId.length > 0;
  const reason = normalizeHandoffToolText(input.handoffArguments["reason"], "The active agent requested a handoff.");
  const callerNeedSummary = normalizeHandoffToolText(input.handoffArguments["callerNeedSummary"], input.transcript);
  const matchedBranch = routePolicy.branches.find(
    (branch) => branch.target.type === "agent" && branch.target.agentId === targetAgentId,
  );
  const sourceAgent = resolvePremiumRealtimeSourceAgent(input.manifest, input.activeAgentId, routePolicy.sourceAgentId);
  if (sourceAgent === undefined) {
    return {
      activeAgentId: currentAgentId,
      packet: input.packet,
      routeEvents: [],
      output: {
        status: "failed",
        summary: "The active handoff source could not be activated.",
        activeAgentId: currentAgentId,
        error: {
          code: "handoff_tool.source_unavailable",
          message: "The active handoff source is not configured for the current session.",
          recoverable: true,
        },
      },
    };
  }
  if (!hasTargetAgentId || matchedBranch === undefined) {
    return {
      activeAgentId: sourceAgent.id,
      packet: input.packet,
      routeEvents: [],
      output: {
        status: "failed",
        summary: "The requested handoff target could not be activated.",
        targetAgentId: targetAgentId || null,
        activeAgentId: sourceAgent.id,
        error: {
          code: "handoff_tool.invalid_target",
          message: "The requested handoff target is not configured for the active agent.",
          recoverable: true,
        },
      },
    };
  }
  const classifierOutput: IntentClassifierOutput = {
    matchedBranchId: matchedBranch.id,
    intentKey: matchedBranch.intentKey,
    confidence: 1,
    reason,
    usedFallback: false,
  };
  const resolution = resolveAgentRoutePolicyClassification({
    routePolicy,
    sourceAgent,
    targetAgents: resolvePremiumRealtimeRoutePolicyTargetAgents(input.manifest),
    transferId: resolvePremiumRealtimeHandoffToolTransferId(input.packet, routePolicy, targetAgentId),
    callerNeedSummary,
    recentToolResults: collectRecentSafeToolResults(input.packet),
    output: classifierOutput,
  });
  let packet = recordRuntimePacketIntent(input.packet, {
    at: input.at,
    ...resolution.intent,
  });
  if (resolution.warning !== undefined) {
    packet = recordRuntimePacketWarning(packet, {
      at: input.at,
      nodeId: routePolicy.sourceAgentId,
      warning: resolution.warning,
    });
  }

  const routedAgent = resolvePremiumRealtimeRouteTargetAgent(input.manifest, resolution);
  if (routedAgent === undefined || resolution.transfer === undefined) {
    return {
      activeAgentId: sourceAgent.id,
      packet,
      routeEvents: [],
      output: {
        status: "failed",
        summary: "The requested handoff target could not be activated.",
        targetAgentId: targetAgentId || null,
        activeAgentId: sourceAgent.id,
        error: {
          code: "handoff_tool.invalid_target",
          message: "The requested handoff target is not configured for the active agent.",
          recoverable: true,
        },
      },
    };
  }

  const routeEvents = [
    ...(resolution.announcementText !== undefined
      ? [{
          type: "agent.route.announcement",
          payload: {
            nodeId: routePolicy.sourceAgentId,
            targetAgentId: routedAgent.agent.id,
            text: resolution.announcementText,
          },
        } satisfies LiveSandboxRouteEvent]
      : []),
    ...buildTransferRouteEvents(routePolicy.sourceAgentId, resolution.transfer),
  ];
  packet = recordRuntimePacketTransfer(packet, {
    at: input.at,
    nodeId: routePolicy.sourceAgentId,
    transfer: resolution.transfer,
  });
  packet = recordRuntimePacketNodeVisit(packet, {
    at: input.at,
    nodeId: routedAgent.node.id,
    nodeKind: routedAgent.node.kind,
    label: routedAgent.node.label,
  });
  packet = withPremiumRealtimeAgentCapabilities(packet, {
    manifest: input.manifest,
    activeAgentId: routedAgent.agent.id,
    toolDeclarations: buildPremiumRealtimeToolDeclarations({
      manifest: input.manifest,
      activeAgentId: routedAgent.agent.id,
    }),
  });
  packet = recordRuntimePacketAgentSelected(packet, {
    at: input.at,
    nodeId: routedAgent.node.id,
    agent: routedAgent.agent,
    nextFrontierNodeIds: [routedAgent.node.id],
  });

  return {
    activeAgentId: routedAgent.agent.id,
    packet,
    routeEvents,
    output: {
      status: "completed",
      summary: `Handing caller off to ${routedAgent.agent.name}.`,
      targetAgentId,
      activeAgentId: routedAgent.agent.id,
      callerNeedSummary: resolution.transfer.callerNeedSummary,
      ...(resolution.announcementText !== undefined ? { announcementText: resolution.announcementText } : {}),
    },
  };
}

function buildProviderHandoffToolMessages(input: {
  provider: PremiumRealtimeSession["runtime"];
  adapter: OpenAiRealtimeAdapter | GeminiLiveRealtimeAdapter;
  manifest: CompiledRuntimeManifest;
  session: PremiumRealtimeSession;
  activeAgentId: string;
  providerCallId: string;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
  handoffAnnouncementAlreadySpoken: boolean;
}): Array<Record<string, unknown>> {
  if (input.provider === "gemini-live") {
    return [
      (input.adapter as GeminiLiveRealtimeAdapter).createToolResponseMessage({
        providerCallId: input.providerCallId,
        name: internalHandoffToolName,
        response: input.output,
      }),
    ];
  }

  return [
    (input.adapter as OpenAiRealtimeAdapter).createFunctionCallOutputMessage({
      providerCallId: input.providerCallId,
      output: input.output,
    }),
    ...(input.routeEvents.length > 0
      ? buildOpenAiPreResponseMessages({
          manifest: input.manifest,
          session: input.session,
          activeAgentId: input.activeAgentId,
          routeEvents: input.routeEvents,
          output: input.output,
          handoffAnnouncementAlreadySpoken: input.handoffAnnouncementAlreadySpoken,
        })
      : [(input.adapter as OpenAiRealtimeAdapter).createResponseCreateMessage()]),
  ];
}

function completePendingOpenAiHandoffContinuation(
  pending: PendingOpenAiHandoffContinuation,
): PremiumRealtimeProviderMessageResult {
  return {
    session: pending.session,
    activeAgentId: pending.activeAgentId,
    packet: pending.packet,
    routeEvents: pending.routeEvents,
    providerMessages: buildOpenAiPreResponseMessages({
      manifest: pending.manifest,
      session: pending.session,
      activeAgentId: pending.activeAgentId,
      routeEvents: pending.routeEvents,
      output: pending.output,
      handoffAnnouncementAlreadySpoken: true,
    }),
  };
}

function resolvePremiumRealtimeActiveAgentId(
  manifest: CompiledRuntimeManifest,
  activeAgentId: string,
): string {
  return resolveRuntimeAgent(manifest, activeAgentId)?.agentId ?? activeAgentId;
}

function resolvePremiumRealtimeSourceAgent(
  manifest: CompiledRuntimeManifest,
  activeAgentId: string,
  sourceNodeId: string,
): RuntimeAgentRef | undefined {
  const sourceAgent = resolveRuntimeAgent(manifest, sourceNodeId)
    ?? resolveRuntimeAgent(manifest, activeAgentId);

  return sourceAgent === undefined ? undefined : agentToPremiumRealtimeAgentRef(sourceAgent);
}

function resolvePremiumRealtimeRoutePolicyTargetAgents(
  manifest: CompiledRuntimeManifest,
): Array<RuntimeAgentRef & { routePolicyTargetId?: string | undefined }> {
  return resolveRuntimeAgents(manifest).map((agent) => ({
    ...agentToPremiumRealtimeAgentRef(agent),
    routePolicyTargetId: agent.agentId,
  }));
}

function resolvePremiumRealtimeRouteTargetAgent(
  manifest: CompiledRuntimeManifest,
  resolution: AgentRoutePolicyClassificationResolution,
):
  | {
      node: CompiledRuntimeManifest["graph"]["nodes"][number];
      agent: RuntimeAgentRef;
    }
  | undefined {
  const target = resolution.target;
  if (target.type !== "agent") {
    return undefined;
  }

  const runtimeAgent = resolveRuntimeAgent(manifest, target.agentId);
  if (runtimeAgent === undefined) {
    return undefined;
  }

  const node = manifest.graph?.nodes.find((candidate) =>
    candidate.id === runtimeAgent.agentId && candidate.kind === "agent",
  );
  if (node === undefined) {
    return undefined;
  }

  return {
    node,
    agent: agentToPremiumRealtimeAgentRef(runtimeAgent),
  };
}

function agentToPremiumRealtimeAgentRef(agent: Agent): RuntimeAgentRef {
  return {
    id: agent.agentId,
    name: agent.name,
    kind: agent.kind,
  };
}

function resolvePremiumRealtimeHandoffToolTransferId(
  packet: TurnRuntimePacket,
  routePolicy: NonNullable<ReturnType<typeof resolvePremiumRealtimeRoutePolicy>>,
  targetAgentId: string,
) {
  const branch = routePolicy.branches.find(
    (candidate) => candidate.target.type === "agent" && candidate.target.agentId === targetAgentId,
  );
  if (branch?.target.type !== "agent") {
    return undefined;
  }

  return `${packet.ids.turnId}:${routePolicy.sourceAgentId}:${branch.target.agentId}`;
}

function buildTransferRouteEvents(
  nodeId: string,
  transfer: AgentTransferContext,
): LiveSandboxRouteEvent[] {
  return [
    {
      type: "agent.handoff.requested",
      payload: {
        nodeId,
        transferId: transfer.transferId,
        sourceAgentId: transfer.sourceAgent.id,
        sourceAgentName: transfer.sourceAgent.name,
        targetAgentId: transfer.targetAgent.id,
        targetAgentName: transfer.targetAgent.name,
        reason: transfer.reason,
      },
    },
    {
      type: "agent.handoff.completed",
      payload: {
        nodeId,
        transferId: transfer.transferId,
        sourceAgentId: transfer.sourceAgent.id,
        sourceAgentName: transfer.sourceAgent.name,
        targetAgentId: transfer.targetAgent.id,
        targetAgentName: transfer.targetAgent.name,
      },
    },
  ];
}

function collectRecentSafeToolResults(packet: TurnRuntimePacket): ToolExecutionResult[] {
  return packet.toolCalls
    .flatMap((toolCall) => toolCall.result === undefined
      ? []
      : [{
          toolCallId: toolCall.result.toolCallId,
          toolAssignmentId: toolCall.result.toolAssignmentId,
          toolId: toolCall.result.toolId,
          toolName: toolCall.result.toolName,
          status: toolCall.result.status,
          summary: toolCall.result.summary,
          ...(toolCall.result.safeOutput !== undefined ? { safeOutput: { ...toolCall.result.safeOutput } } : {}),
          durationMs: toolCall.result.durationMs,
          idempotencyKey: toolCall.result.idempotencyKey,
          ...(toolCall.result.error !== undefined ? { error: { ...toolCall.result.error } } : {}),
        }])
    .slice(-4);
}

function normalizeHandoffToolText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function buildOpenAiPreResponseMessages(input: {
  manifest: CompiledRuntimeManifest;
  session: PremiumRealtimeSession;
  activeAgentId: string;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
  handoffAnnouncementAlreadySpoken: boolean;
}) {
  const activeAgentConfig = resolvePremiumRealtimeActiveAgentConfig(input.manifest, input.activeAgentId);
  const systemPrompt = activeAgentConfig === undefined
    ? ""
    : buildPremiumRealtimeAgentPrompt({
        manifest: input.manifest,
        agent: activeAgentConfig,
      });
  const adapter = new OpenAiRealtimeAdapter({
    model: input.session.model,
    systemPrompt,
    language: activeAgentConfig?.languagePolicy.defaultLanguage,
    voice: resolveOpenAiRealtimeVoice(activeAgentConfig),
    ...resolveOpenAiRealtimeSpeed(activeAgentConfig),
    tools: input.session.toolDeclarations,
  });

  return [
    adapter.createSessionUpdateMessage(),
    adapter.createResponseCreateMessage({
      instructions: buildHandoffContinuationResponseInstructions({
        activeAgentName: activeAgentConfig?.name,
        routeEvents: input.routeEvents,
        output: input.output,
        handoffAnnouncementAlreadySpoken: input.handoffAnnouncementAlreadySpoken,
      }),
    }),
  ];
}

function buildHandoffContinuationResponseInstructions(input: {
  activeAgentName?: string | undefined;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
  handoffAnnouncementAlreadySpoken: boolean;
}) {
  const activeAgentName = input.activeAgentName?.trim() || "the active agent";
  const callerNeedSummary = typeof input.output.callerNeedSummary === "string"
    && input.output.callerNeedSummary.trim().length > 0
    ? input.output.callerNeedSummary.trim()
    : undefined;
  const announcementText = resolveHandoffContinuationAnnouncementText(input);

  return [
    `You are now ${activeAgentName}.`,
    ...(announcementText === undefined
      ? []
      : input.handoffAnnouncementAlreadySpoken
        ? [
            "The handoff acknowledgement was already spoken by the source agent. Do not repeat it.",
          ]
        : [
            `Begin your response with this exact handoff sentence: ${JSON.stringify(announcementText)}.`,
          ]),
    announcementText !== undefined && !input.handoffAnnouncementAlreadySpoken
      ? "Immediately after that sentence, continue helping the caller as the active agent in this same response."
      : "Continue helping the caller as the active agent in this same response.",
    ...(callerNeedSummary === undefined ? [] : [`Caller need: ${trimTerminalPunctuation(callerNeedSummary)}.`]),
    "Use your agent instructions and available tools. If you need an invoice, account, order, or ticket reference, ask for that next.",
  ].join(" ");
}

function resolveOpenAiRealtimeVoice(
  agent: Agent | undefined,
): string {
  const realtimeVoiceConfig = agent?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider === "openai-realtime") {
    return realtimeVoiceConfig.voice;
  }

  return "marin";
}

function resolveOpenAiRealtimeSpeed(
  agent: Agent | undefined,
): { speed?: number } {
  const realtimeVoiceConfig = agent?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider !== "openai-realtime" || realtimeVoiceConfig.speed === undefined) {
    return {};
  }

  return {
    speed: Math.min(1.5, Math.max(0.25, realtimeVoiceConfig.speed)),
  };
}

function resolvePremiumRealtimeActiveAgentConfig(
  manifest: CompiledRuntimeManifest,
  activeAgentId: string,
): Agent | undefined {
  return Array.isArray(manifest.graph?.nodes)
    ? resolveRuntimeAgent(manifest, activeAgentId)
    : undefined;
}

function trimTerminalPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/u, "");
}

function buildSourceHandoffAnnouncementResponseInstructions(announcementText: string) {
  return `Say exactly this handoff message to the caller, then stop: ${JSON.stringify(announcementText)}`;
}

function resolveHandoffContinuationAnnouncementText(input: {
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
}) {
  if (typeof input.output.announcementText === "string" && input.output.announcementText.trim().length > 0) {
    return input.output.announcementText.trim();
  }

  for (const event of input.routeEvents) {
    if (
      event.type === "agent.route.announcement"
      && typeof event.payload.text === "string"
      && event.payload.text.trim().length > 0
    ) {
      return event.payload.text.trim();
    }
  }

  return undefined;
}

function parseOpenAiResponseDoneStatus(rawProviderMessage: string): string | undefined {
  const payload = parseJsonRecord(rawProviderMessage);
  const status = payload?.type === "response.done"
    ? parseRecordValue(payload.response)?.status
    : undefined;
  return typeof status === "string" ? status : undefined;
}

function openAiHandoffToolCallWasPrecededByAssistantMessage(input: {
  rawProviderMessage: string;
  providerCallId: string;
}) {
  const payload = parseJsonRecord(input.rawProviderMessage);
  const response = parseRecordValue(payload?.response);
  const output = Array.isArray(response?.output) ? response.output : [];

  for (const itemValue of output) {
    const item = parseRecordValue(itemValue);
    if (item === undefined) {
      continue;
    }

    if (
      item.type === "function_call"
      && item.name === internalHandoffToolName
      && item.call_id === input.providerCallId
    ) {
      return false;
    }

    if (item.type === "message" && openAiOutputItemHasText(item)) {
      return true;
    }
  }

  return false;
}

function openAiOutputItemHasText(item: Record<string, unknown>) {
  const content = Array.isArray(item.content) ? item.content : [];
  return content.some((partValue) => {
    const part = parseRecordValue(partValue);
    if (part === undefined) {
      return false;
    }

    return (
      typeof part.text === "string" && part.text.trim().length > 0
    ) || (
      typeof part.transcript === "string" && part.transcript.trim().length > 0
    );
  });
}

function parseJsonRecord(value: string) {
  try {
    return parseRecordValue(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function parseRecordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function createInitialPremiumRealtimePacket(input: {
  session: PremiumRealtimeSession;
  manifest: CompiledRuntimeManifest;
  workspaceId: string;
}): TurnRuntimePacket {
  const activeAgent = resolveRuntimeAgent(input.manifest, input.session.activeAgentId);
  const activeAgentId = activeAgent?.agentId ?? input.session.activeAgentId;
  const capabilities = resolvePremiumRealtimeAgentCapabilities({
    manifest: input.manifest,
    activeAgentId,
    toolDeclarations: input.session.toolDeclarations,
  });

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
      currentNodeId: activeAgentId,
      visitedNodeIds: [],
      frontierNodeIds: [activeAgentId],
      activeAgent: {
        id: activeAgentId,
        name: activeAgent?.name ?? input.session.activeAgentId,
        kind: activeAgent?.kind ?? "agent",
      },
    },
    availableTools: capabilities.availableTools,
    availableActions: capabilities.availableActions,
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

function withPremiumRealtimeAgentCapabilities(
  packet: TurnRuntimePacket,
  input: {
    manifest: CompiledRuntimeManifest;
    activeAgentId: string;
    toolDeclarations: RealtimeProviderToolDeclaration[];
  },
): TurnRuntimePacket {
  const capabilities = resolvePremiumRealtimeAgentCapabilities(input);

  return {
    ...packet,
    availableTools: capabilities.availableTools,
    availableActions: capabilities.availableActions,
  };
}

function resolvePremiumRealtimeAgentCapabilities(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: string;
  toolDeclarations: RealtimeProviderToolDeclaration[];
}) {
  const activeAgent = resolveRuntimeAgent(input.manifest, input.activeAgentId);
  const availableTools = (activeAgent?.toolAssignments ?? []).map(
    hydratePremiumRealtimeAgentToolAssignment,
  );
  const handoffDeclaration = input.toolDeclarations.find(
    (declaration) => declaration.kind === "internal_handoff",
  );
  const internalHandoffAction = handoffDeclaration === undefined
    ? undefined
    : createInternalHandoffAvailableAction(
        handoffDeclaration.handoffTargetAgentIds.flatMap((targetAgentId) => {
          const targetAgent = resolveRuntimeAgent(input.manifest, targetAgentId);

          return targetAgent === undefined
            ? []
            : [{
                targetAgentId: targetAgent.agentId,
                targetAgentName: targetAgent.name,
                targetAgentKind: targetAgent.kind,
              }];
        }),
      );

  return {
    availableTools,
    availableActions: [
      ...availableTools.map(createAgentToolAvailableAction),
      ...(internalHandoffAction !== undefined ? [internalHandoffAction] : []),
    ],
  };
}
