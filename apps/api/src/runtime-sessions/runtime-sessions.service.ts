import {
  Inject,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  buildRealtimeProviderToolDeclarations,
  createPremiumRealtimeSession,
  recordRuntimePacketAgentSelected,
  recordRuntimePacketIntent,
  recordRuntimePacketNodeVisit,
  recordRuntimePacketTransfer,
  recordRuntimePacketWarning,
  resolveAgentRoutePolicyClassification,
  resolveRuntimeAgent,
  resolveRuntimeAgents,
  runtimeAgentToVoiceAgentRole,
  type Agent,
  type AgentRoutePolicyClassificationResolution,
  type AgentTransferContext,
  type CompiledRuntimeManifest,
  type IntentClassifierOutput,
  type PremiumRealtimeSession,
  type RealtimeProviderToolDeclaration,
  type RuntimeAgentRef,
  type ToolExecutionResult,
  type TurnRuntimePacket,
  type VoiceAgentRole,
} from "@zara/core";
import { GeminiLiveRealtimeAdapter } from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "../sandbox-live-sessions/openai-realtime.adapter";
import type { LiveSandboxRouteEvent } from "../sandbox-live-sessions/sandbox-live-session-router";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";
import {
  PremiumRealtimeToolLoopService,
  type PremiumRealtimeToolLoopResult,
} from "./premium-realtime-tool-loop.service";
import { buildPremiumRealtimeRolePrompt } from "./premium-realtime-role-prompt";
import {
  resolvePremiumRealtimeRoutePolicySourceNodeId,
  withPremiumRealtimeRoleRoutePolicies,
} from "./premium-realtime-route-policies";

const internalHandoffToolName = "zara_handoff_to_agent";

export interface PremiumRealtimeProviderMessageResult extends PremiumRealtimeToolLoopResult {
  session?: PremiumRealtimeSession | undefined;
  activeRoleId?: string | undefined;
  routeEvents?: LiveSandboxRouteEvent[] | undefined;
  transcript?: string | undefined;
}

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

interface PendingOpenAiRouteContinuation {
  manifest: CompiledRuntimeManifest;
  session: PremiumRealtimeSession;
  activeRoleId: string;
  packet: TurnRuntimePacket;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
}

@Injectable()
export class RuntimeSessionsService {
  private readonly sessions = new Map<string, RegisteredPremiumRealtimeSession>();
  private readonly pendingOpenAiRouteContinuations = new Map<string, PendingOpenAiRouteContinuation>();

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
        toolDeclarations: buildPremiumRealtimeToolDeclarations({
          manifest: input.manifest,
          activeRoleId: input.activeRoleId,
        }),
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
    session?: PremiumRealtimeSession | undefined;
    activeRoleId?: string | undefined;
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
      ...(input.activeRoleId !== undefined ? { activeRoleId: input.activeRoleId } : {}),
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
    const pendingOpenAiRouteContinuation = this.pendingOpenAiRouteContinuations.get(input.sessionId);
    const responseDoneStatus = parseOpenAiResponseDoneStatus(input.rawProviderMessage);
    if (pendingOpenAiRouteContinuation !== undefined && responseDoneStatus !== undefined) {
      this.pendingOpenAiRouteContinuations.delete(input.sessionId);
      if (responseDoneStatus === "completed") {
        return Promise.resolve(completePendingOpenAiRouteContinuation(pendingOpenAiRouteContinuation));
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
        handoffArguments: parseProviderRouteArguments(handoffToolCall.argumentsJson),
        routeAnnouncementAlreadySpoken: openAiHandoffToolCallWasPrecededByAssistantMessage({
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
    routeAnnouncementAlreadySpoken?: boolean | undefined;
  }): PremiumRealtimeProviderMessageResult {
    const manifest = withPremiumRealtimeRoleRoutePolicies(input.manifest);
    const routeResult = resolvePremiumRealtimeHandoffToolCall({
      manifest,
      activeRoleId: input.activeRoleId,
      packet: input.packet,
      transcript: input.transcript,
      at: input.at,
      handoffArguments: input.handoffArguments,
    });
    const nextSession = {
      ...input.session,
      activeRoleId: routeResult.activeRoleId,
      toolDeclarations: buildPremiumRealtimeToolDeclarations({
        manifest,
        activeRoleId: routeResult.activeRoleId,
      }),
    };
    const providerMessages = buildProviderHandoffToolMessages({
      provider: input.provider,
      adapter: input.adapter,
      manifest,
      session: nextSession,
      activeRoleId: routeResult.activeRoleId,
      providerCallId: input.providerCallId,
      routeEvents: routeResult.routeEvents,
      output: routeResult.output,
      routeAnnouncementAlreadySpoken: input.routeAnnouncementAlreadySpoken === true,
    });
    const routeAnnouncementText = resolveRouteContinuationAnnouncementText({
      routeEvents: routeResult.routeEvents,
      output: routeResult.output,
    });

    if (
      input.provider === "openai-realtime"
      && routeResult.routeEvents.length > 0
      && input.routeAnnouncementAlreadySpoken !== true
      && routeAnnouncementText !== undefined
    ) {
      this.pendingOpenAiRouteContinuations.set(input.sessionId, {
        manifest,
        session: nextSession,
        activeRoleId: routeResult.activeRoleId,
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
            instructions: buildSourceRouteAnnouncementResponseInstructions(routeAnnouncementText),
          }),
        ],
      };
    }

    return {
      session: nextSession,
      activeRoleId: routeResult.activeRoleId,
      packet: routeResult.packet,
      routeEvents: routeResult.routeEvents,
      providerMessages,
    };
  }

}

function buildPremiumRealtimeToolDeclarations(input: {
  manifest: CompiledRuntimeManifest;
  activeRoleId: string;
}): RealtimeProviderToolDeclaration[] {
  return buildRealtimeProviderToolDeclarations({
    manifest: withPremiumRealtimeRoleRoutePolicies(input.manifest),
    activeRoleId: input.activeRoleId,
  });
}

function resolvePremiumRealtimeRoutePolicy(
  manifest: CompiledRuntimeManifest,
  activeRoleId: string,
) {
  const normalizedManifest = withPremiumRealtimeRoleRoutePolicies(manifest);
  const sourceNodeId = resolvePremiumRealtimeRoutePolicySourceNodeId(normalizedManifest, activeRoleId);
  if (sourceNodeId === undefined) {
    return undefined;
  }

  return (normalizedManifest.routePolicies ?? []).find((policy) => policy.sourceAgentId === sourceNodeId);
}

function parseProviderRouteArguments(argumentsJson?: string): Record<string, unknown> {
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
  activeRoleId: string;
  packet: TurnRuntimePacket;
  transcript: string;
  at: string;
  handoffArguments: Record<string, unknown>;
}): {
  activeRoleId: string;
  packet: TurnRuntimePacket;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
} {
  const routePolicy = resolvePremiumRealtimeRoutePolicy(input.manifest, input.activeRoleId);
  if (routePolicy === undefined) {
    const packet = recordRuntimePacketWarning(input.packet, {
      at: input.at,
      nodeId: input.activeRoleId,
      warning: {
        code: "handoff_tool.policy_missing",
        message: "The provider requested handoff, but the active agent has no handoff policy.",
        recoverable: true,
      },
    });

    return {
      activeRoleId: input.activeRoleId,
      packet,
      routeEvents: [],
      output: {
        status: "failed",
        summary: "No handoff policy is configured for the active agent.",
        activeRoleId: input.activeRoleId,
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
  const reason = normalizeRouteToolText(input.handoffArguments["reason"], "The active agent requested a handoff.");
  const callerNeedSummary = normalizeRouteToolText(input.handoffArguments["callerNeedSummary"], input.transcript);
  const matchedBranch = routePolicy.branches.find(
    (branch) => branch.target.type === "agent" && branch.target.agentId === targetAgentId,
  );
  const classifierOutput: IntentClassifierOutput = {
    matchedBranchId: matchedBranch?.id ?? (hasTargetAgentId ? targetAgentId : null),
    intentKey: matchedBranch?.intentKey ?? null,
    confidence: hasTargetAgentId ? 1 : 0,
    reason,
    usedFallback: !hasTargetAgentId,
  };
  const sourceAgent = resolvePremiumRealtimeSourceAgent(input.manifest, input.activeRoleId, routePolicy.sourceAgentId);
  if (sourceAgent === undefined) {
    return {
      activeRoleId: input.activeRoleId,
      packet: input.packet,
      routeEvents: [],
      output: {
        status: "failed",
        summary: "The active handoff source could not be activated.",
        activeRoleId: input.activeRoleId,
        error: {
          code: "handoff_tool.source_unavailable",
          message: "The active handoff source is not configured for the current session.",
          recoverable: true,
        },
      },
    };
  }
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
      activeRoleId: input.activeRoleId,
      packet,
      routeEvents: [],
      output: {
        status: "failed",
        summary: "The requested handoff target could not be activated.",
        targetAgentId: targetAgentId || null,
        activeRoleId: input.activeRoleId,
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
            targetRoleId: routedAgent.agent.id,
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
  packet = recordRuntimePacketAgentSelected(packet, {
    at: input.at,
    nodeId: routedAgent.node.id,
    agent: routedAgent.agent,
    nextFrontierNodeIds: [routedAgent.node.id],
  });

  return {
    activeRoleId: routedAgent.agent.id,
    packet,
    routeEvents,
    output: {
      status: "completed",
      summary: `Handing caller off to ${routedAgent.agent.name}.`,
      targetAgentId,
      activeRoleId: routedAgent.agent.id,
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
  activeRoleId: string;
  providerCallId: string;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
  routeAnnouncementAlreadySpoken: boolean;
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
          activeRoleId: input.activeRoleId,
          routeEvents: input.routeEvents,
          output: input.output,
          routeAnnouncementAlreadySpoken: input.routeAnnouncementAlreadySpoken,
        })
      : [(input.adapter as OpenAiRealtimeAdapter).createResponseCreateMessage()]),
  ];
}

function completePendingOpenAiRouteContinuation(
  pending: PendingOpenAiRouteContinuation,
): PremiumRealtimeProviderMessageResult {
  return {
    session: pending.session,
    activeRoleId: pending.activeRoleId,
    packet: pending.packet,
    routeEvents: pending.routeEvents,
    providerMessages: buildOpenAiPreResponseMessages({
      manifest: pending.manifest,
      session: pending.session,
      activeRoleId: pending.activeRoleId,
      routeEvents: pending.routeEvents,
      output: pending.output,
      routeAnnouncementAlreadySpoken: true,
    }),
  };
}

function resolvePremiumRealtimeSourceAgent(
  manifest: CompiledRuntimeManifest,
  activeRoleId: string,
  sourceNodeId: string,
): RuntimeAgentRef | undefined {
  const sourceAgent = resolveRuntimeAgent(manifest, sourceNodeId)
    ?? resolveRuntimeAgent(manifest, activeRoleId);

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
        sourceRoleId: transfer.sourceAgent.id,
        sourceRoleName: transfer.sourceAgent.name,
        targetRoleId: transfer.targetAgent.id,
        targetRoleName: transfer.targetAgent.name,
        reason: transfer.reason,
      },
    },
    {
      type: "agent.handoff.completed",
      payload: {
        nodeId,
        transferId: transfer.transferId,
        sourceRoleId: transfer.sourceAgent.id,
        sourceRoleName: transfer.sourceAgent.name,
        targetRoleId: transfer.targetAgent.id,
        targetRoleName: transfer.targetAgent.name,
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

function normalizeRouteToolText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function buildOpenAiPreResponseMessages(input: {
  manifest: CompiledRuntimeManifest;
  session: PremiumRealtimeSession;
  activeRoleId: string;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
  routeAnnouncementAlreadySpoken: boolean;
}) {
  const activeAgentRole = resolvePremiumRealtimeActiveAgentRole(input.manifest, input.activeRoleId);
  const systemPrompt = activeAgentRole === undefined
    ? ""
    : buildPremiumRealtimeRolePrompt({
        manifest: input.manifest,
        role: activeAgentRole.role,
        ...(activeAgentRole.agent !== undefined ? { agent: activeAgentRole.agent } : {}),
      });
  const adapter = new OpenAiRealtimeAdapter({
    model: input.session.model,
    systemPrompt,
    language: activeAgentRole?.role.languagePolicy.defaultLanguage,
    voice: resolveOpenAiRealtimeVoice(activeAgentRole?.role),
    ...resolveOpenAiRealtimeSpeed(activeAgentRole?.role),
    tools: input.session.toolDeclarations,
  });

  return [
    adapter.createSessionUpdateMessage(),
    adapter.createResponseCreateMessage({
      instructions: buildRouteContinuationResponseInstructions({
        activeRoleName: activeAgentRole?.role.name,
        routeEvents: input.routeEvents,
        output: input.output,
        routeAnnouncementAlreadySpoken: input.routeAnnouncementAlreadySpoken,
      }),
    }),
  ];
}

function buildRouteContinuationResponseInstructions(input: {
  activeRoleName?: string | undefined;
  routeEvents: LiveSandboxRouteEvent[];
  output: Record<string, unknown>;
  routeAnnouncementAlreadySpoken: boolean;
}) {
  const activeRoleName = input.activeRoleName?.trim() || "the routed specialist";
  const callerNeedSummary = typeof input.output.callerNeedSummary === "string"
    && input.output.callerNeedSummary.trim().length > 0
    ? input.output.callerNeedSummary.trim()
    : undefined;
  const announcementText = resolveRouteContinuationAnnouncementText(input);

  return [
    `You are now ${activeRoleName}.`,
    ...(announcementText === undefined
      ? []
      : input.routeAnnouncementAlreadySpoken
        ? [
            "The handoff acknowledgement was already spoken by the source agent. Do not repeat it.",
          ]
        : [
            `Begin your response with this exact handoff sentence: ${JSON.stringify(announcementText)}.`,
          ]),
    announcementText !== undefined && !input.routeAnnouncementAlreadySpoken
      ? "Immediately after that sentence, continue helping the caller as the active specialist in this same response."
      : "Continue helping the caller as the active specialist in this same response.",
    ...(callerNeedSummary === undefined ? [] : [`Caller need: ${trimTerminalPunctuation(callerNeedSummary)}.`]),
    "Use your agent instructions and available tools. If you need an invoice, account, order, or ticket reference, ask for that next.",
  ].join(" ");
}

function resolveOpenAiRealtimeVoice(
  role: VoiceAgentRole | undefined,
): string {
  const realtimeVoiceConfig = role?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider === "openai-realtime") {
    return realtimeVoiceConfig.voice;
  }

  return "marin";
}

function resolveOpenAiRealtimeSpeed(
  role: VoiceAgentRole | undefined,
): { speed?: number } {
  const realtimeVoiceConfig = role?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider !== "openai-realtime" || realtimeVoiceConfig.speed === undefined) {
    return {};
  }

  return {
    speed: Math.min(1.5, Math.max(0.25, realtimeVoiceConfig.speed)),
  };
}

function resolvePremiumRealtimeActiveAgentRole(
  manifest: CompiledRuntimeManifest,
  activeRoleId: string,
): { role: VoiceAgentRole; agent?: Agent | undefined } | undefined {
  const runtimeAgent = resolveRuntimeAgent(manifest, activeRoleId);

  if (runtimeAgent !== undefined) {
    return {
      role: runtimeAgentToVoiceAgentRole(runtimeAgent),
      agent: runtimeAgent,
    };
  }

  const role = manifest.roles.find((candidate) => candidate.id === activeRoleId);
  return role === undefined ? undefined : { role };
}

function trimTerminalPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/u, "");
}

function buildSourceRouteAnnouncementResponseInstructions(announcementText: string) {
  return `Say exactly this handoff message to the caller, then stop: ${JSON.stringify(announcementText)}`;
}

function resolveRouteContinuationAnnouncementText(input: {
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
  const activeAgent = resolveRuntimeAgent(input.manifest, input.session.activeRoleId);
  const activeAgentId = activeAgent?.agentId ?? input.session.activeRoleId;

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
        name: activeAgent?.name ?? input.session.activeRoleId,
        kind: activeAgent?.kind ?? "agent",
      },
    },
    availableTools: activeAgent?.toolAssignments
      ?? input.manifest.agentToolAssignments.filter(
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
