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

const internalRouteToolName = "zara_route_to_agent";

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
      const routeToolCall = adapter.parseServerMessage(input.rawProviderMessage).find(
        (event) => event.type === "tool_call" && event.name === internalRouteToolName,
      );
      if (routeToolCall?.type === "tool_call") {
        return Promise.resolve(this.handleProviderRouteToolCall({
          ...input,
          adapter,
          provider: "gemini-live",
          providerCallId: routeToolCall.providerCallId,
          routeArguments: routeToolCall.arguments,
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

    const routeToolCall = adapter.parseServerMessage(input.rawProviderMessage).find(
      (event) => event.type === "tool_call" && event.name === internalRouteToolName,
    );
    if (routeToolCall?.type === "tool_call") {
      return Promise.resolve(this.handleProviderRouteToolCall({
        ...input,
        adapter,
        provider: "openai-realtime",
        providerCallId: routeToolCall.providerCallId,
        routeArguments: parseProviderRouteArguments(routeToolCall.argumentsJson),
        routeAnnouncementAlreadySpoken: openAiRouteToolCallWasPrecededByAssistantMessage({
          rawProviderMessage: input.rawProviderMessage,
          providerCallId: routeToolCall.providerCallId,
        }),
      }));
    }

    return this.premiumRealtimeToolLoopService.processOpenAiProviderMessage({
      ...input,
      declarations: input.session.toolDeclarations,
      adapter,
    });
  }

  private handleProviderRouteToolCall(input: ProcessPremiumRealtimeProviderMessageRequest & {
    provider: PremiumRealtimeSession["runtime"];
    adapter: OpenAiRealtimeAdapter | GeminiLiveRealtimeAdapter;
    providerCallId: string;
    routeArguments: Record<string, unknown>;
    routeAnnouncementAlreadySpoken?: boolean | undefined;
  }): PremiumRealtimeProviderMessageResult {
    const manifest = withPremiumRealtimeRoleRoutePolicies(input.manifest);
    const routeResult = resolvePremiumRealtimeRouteToolCall({
      manifest,
      activeRoleId: input.activeRoleId,
      packet: input.packet,
      transcript: input.transcript,
      at: input.at,
      routeArguments: input.routeArguments,
    });
    const nextSession = {
      ...input.session,
      activeRoleId: routeResult.activeRoleId,
      toolDeclarations: buildPremiumRealtimeToolDeclarations({
        manifest,
        activeRoleId: routeResult.activeRoleId,
      }),
    };
    const providerMessages = buildProviderRouteToolMessages({
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

function resolvePremiumRealtimeRouteToolCall(input: {
  manifest: CompiledRuntimeManifest;
  activeRoleId: string;
  packet: TurnRuntimePacket;
  transcript: string;
  at: string;
  routeArguments: Record<string, unknown>;
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
        code: "route_tool.policy_missing",
        message: "The provider requested routing, but the active role has no route policy.",
        recoverable: true,
      },
    });

    return {
      activeRoleId: input.activeRoleId,
      packet,
      routeEvents: [],
      output: {
        status: "failed",
        summary: "No route policy is configured for the active agent.",
        activeRoleId: input.activeRoleId,
        error: {
          code: "route_tool.policy_missing",
          message: "No route policy is configured for the active agent.",
          recoverable: true,
        },
      },
    };
  }

  const branchId = typeof input.routeArguments["branchId"] === "string"
    ? input.routeArguments["branchId"]
    : "";
  const hasBranchId = branchId.length > 0;
  const reason = normalizeRouteToolText(input.routeArguments["reason"], "The active agent requested a route.");
  const callerNeedSummary = normalizeRouteToolText(input.routeArguments["callerNeedSummary"], input.transcript);
  const matchedBranch = routePolicy.branches.find((branch) => branch.id === branchId);
  const classifierOutput: IntentClassifierOutput = {
    matchedBranchId: hasBranchId ? branchId : null,
    intentKey: matchedBranch?.intentKey ?? null,
    confidence: hasBranchId ? 1 : 0,
    reason,
    usedFallback: !hasBranchId,
  };
  const sourceAgent = resolvePremiumRealtimeSourceAgent(input.manifest, input.activeRoleId, routePolicy.sourceAgentId);
  const resolution = resolveAgentRoutePolicyClassification({
    routePolicy,
    sourceAgent,
    targetAgents: resolvePremiumRealtimeRoutePolicyTargetAgents(input.manifest),
    transferId: resolvePremiumRealtimeRouteToolTransferId(input.packet, routePolicy, branchId),
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
        summary: "The requested route branch could not be activated.",
        branchId: branchId || null,
        activeRoleId: input.activeRoleId,
        error: {
          code: "route_tool.invalid_branch",
          message: "The requested route branch is not configured for the active agent.",
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
            targetRoleId: routedAgent.roleId,
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
    activeRoleId: routedAgent.roleId,
    packet,
    routeEvents,
    output: {
      status: "completed",
      summary: `Routing caller to ${routedAgent.agent.name}.`,
      branchId,
      activeRoleId: routedAgent.roleId,
      callerNeedSummary: resolution.transfer.callerNeedSummary,
      ...(resolution.announcementText !== undefined ? { announcementText: resolution.announcementText } : {}),
    },
  };
}

function buildProviderRouteToolMessages(input: {
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
        name: internalRouteToolName,
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
): RuntimeAgentRef {
  const sourceNode = manifest.graph?.nodes.find((node) => node.id === sourceNodeId);
  const sourceRoleId = sourceNode?.roleId ?? activeRoleId;
  return resolvePremiumRealtimeAgentRef(manifest, sourceRoleId, sourceNode?.label ?? sourceNodeId, "agent");
}

function resolvePremiumRealtimeRoutePolicyTargetAgents(
  manifest: CompiledRuntimeManifest,
): Array<RuntimeAgentRef & { routePolicyTargetId?: string | undefined }> {
  return (manifest.graph?.nodes ?? [])
    .filter((node) => node.kind === "agent")
    .map((node) => {
      const roleId = node.roleId ?? node.id;
      return {
        ...resolvePremiumRealtimeAgentRef(manifest, roleId, node.label, node.kind),
        routePolicyTargetId: node.id,
      };
    });
}

function resolvePremiumRealtimeRouteTargetAgent(
  manifest: CompiledRuntimeManifest,
  resolution: AgentRoutePolicyClassificationResolution,
):
  | {
      node: CompiledRuntimeManifest["graph"]["nodes"][number];
      roleId: string;
      agent: RuntimeAgentRef;
    }
  | undefined {
  const target = resolution.target;
  if (target.type !== "agent") {
    return undefined;
  }

  const node = manifest.graph?.nodes.find((candidate) =>
    candidate.id === target.agentId && candidate.kind === "agent",
  );
  if (node === undefined) {
    return undefined;
  }

  const roleId = node.roleId ?? node.id;
  return {
    node,
    roleId,
    agent: resolvePremiumRealtimeAgentRef(manifest, roleId, node.label, node.kind),
  };
}

function resolvePremiumRealtimeAgentRef(
  manifest: CompiledRuntimeManifest,
  roleId: string,
  fallbackName: string,
  fallbackKind: string,
): RuntimeAgentRef {
  const role = manifest.roles.find((candidate) => candidate.id === roleId);
  return {
    id: role?.id ?? roleId,
    name: role?.name ?? fallbackName,
    kind: role?.kind ?? fallbackKind,
  };
}

function resolvePremiumRealtimeRouteToolTransferId(
  packet: TurnRuntimePacket,
  routePolicy: NonNullable<ReturnType<typeof resolvePremiumRealtimeRoutePolicy>>,
  branchId: string,
) {
  const branch = routePolicy.branches.find((candidate) => candidate.id === branchId);
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
  const role = input.manifest.roles.find((candidate) => candidate.id === input.activeRoleId);
  const systemPrompt = role === undefined
    ? ""
    : buildPremiumRealtimeRolePrompt({
        manifest: input.manifest,
        role,
      });
  const adapter = new OpenAiRealtimeAdapter({
    model: input.session.model,
    systemPrompt,
    language: role?.languagePolicy.defaultLanguage,
    voice: resolveOpenAiRealtimeVoice(role),
    ...resolveOpenAiRealtimeSpeed(role),
    tools: input.session.toolDeclarations,
  });

  return [
    adapter.createSessionUpdateMessage(),
    adapter.createResponseCreateMessage({
      instructions: buildRouteContinuationResponseInstructions({
        activeRoleName: role?.name,
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
    "Use your role instructions and available tools. If you need an invoice, account, order, or ticket reference, ask for that next.",
  ].join(" ");
}

function resolveOpenAiRealtimeVoice(
  role: CompiledRuntimeManifest["roles"][number] | undefined,
): string {
  const realtimeVoiceConfig = role?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider === "openai-realtime") {
    return realtimeVoiceConfig.voice;
  }

  return "marin";
}

function resolveOpenAiRealtimeSpeed(
  role: CompiledRuntimeManifest["roles"][number] | undefined,
): { speed?: number } {
  const realtimeVoiceConfig = role?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider !== "openai-realtime" || realtimeVoiceConfig.speed === undefined) {
    return {};
  }

  return {
    speed: Math.min(1.5, Math.max(0.25, realtimeVoiceConfig.speed)),
  };
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

function openAiRouteToolCallWasPrecededByAssistantMessage(input: {
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
      && item.name === internalRouteToolName
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
