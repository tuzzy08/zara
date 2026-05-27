export type TurnRuntimePacketSchemaVersion = "turn-runtime-packet.v1";

export type TurnRuntimePacketInputSource = "voice" | "typed" | "telephony";

export interface TranscriptTurn {
  speaker: "caller" | "agent" | "system";
  text: string;
  at?: string | undefined;
  agentId?: string | undefined;
}

export interface RuntimeAgentRef {
  id: string;
  name: string;
  kind: string;
}

export interface IntentRouteResult {
  nodeId: string;
  matchedBranchId: string | null;
  intentKey: string | null;
  label: string | null;
  confidence: number;
  reason: string;
  usedFallback: boolean;
  targetNodeId: string;
}

export interface AgentToolAssignment {
  id: string;
  toolId: string;
  label: string;
  description: string;
  whenToUse: string;
  inputSchema: Record<string, unknown>;
  requiredInputs: string[];
  risk: "low" | "medium" | "high";
  requiresHumanApproval: boolean;
  credentialRef?: string | undefined;
}

export interface ToolCallRequest {
  type: "call_tool";
  toolCallId: string;
  toolAssignmentId: string;
  arguments: Record<string, unknown>;
  reason: string;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolAssignmentId: string;
  toolId: string;
  toolName: string;
  status: "completed" | "failed" | "approval_required" | "skipped" | "partial";
  summary: string;
  output?: Record<string, unknown> | undefined;
  safeOutput?: Record<string, unknown> | undefined;
  durationMs: number;
  idempotencyKey: string;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  } | undefined;
}

export interface ToolCallRecord {
  request: ToolCallRequest;
  result?: ToolExecutionResult | undefined;
}

export interface AgentTransferContext {
  transferId: string;
  sourceAgent: RuntimeAgentRef;
  targetAgent: RuntimeAgentRef;
  reason: string;
  callerNeedSummary: string;
  matchedIntent?: {
    intentKey: string;
    label: string;
    confidence: number;
  } | undefined;
  recentToolResults: ToolExecutionResult[];
  instructionsToTarget?: string | undefined;
}

export type RuntimePacketEventType =
  | "node.visited"
  | "intent.classified"
  | "tool.requested"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.approval_required"
  | "transfer.created"
  | "agent.selected"
  | "runtime.warning";

export interface RuntimePacketEvent {
  type: RuntimePacketEventType;
  at: string;
  turnId: string;
  sequence: number;
  nodeId?: string | undefined;
  payload: Record<string, unknown>;
}

export interface RuntimeWarning {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface TurnRuntimePacket {
  schemaVersion: TurnRuntimePacketSchemaVersion;
  ids: {
    tenantId: string;
    workspaceId: string;
    callSessionId: string;
    turnId: string;
    manifestId: string;
    manifestVersion: number;
  };
  timing: {
    startedAt: string;
    sequence: number;
  };
  callerInput: {
    latestCallerTurn: string;
    sttConfidence?: number | undefined;
    language?: string | undefined;
    source: TurnRuntimePacketInputSource;
    recentTranscript: TranscriptTurn[];
    conversationSummary?: string | undefined;
  };
  graph: {
    entryNodeId: string;
    sourceNodeId?: string | undefined;
    currentNodeId?: string | undefined;
    visitedNodeIds: string[];
    frontierNodeIds: string[];
    previousAgent?: RuntimeAgentRef | undefined;
    activeAgent?: RuntimeAgentRef | undefined;
  };
  availableTools: AgentToolAssignment[];
  toolCalls: ToolCallRecord[];
  intent?: IntentRouteResult | undefined;
  transfer?: AgentTransferContext | undefined;
  safety: {
    untrustedSources: Array<"caller_transcript" | "tool_output" | "memory" | "knowledge">;
    redactionApplied: boolean;
    maxModelContextBytes: number;
  };
  diagnostics: {
    warnings: RuntimeWarning[];
    events: RuntimePacketEvent[];
  };
}

export interface AgentTurnContext {
  latestCallerTurn: string;
  recentTranscript: TranscriptTurn[];
  language?: string | undefined;
  intent?: Pick<IntentRouteResult, "intentKey" | "label" | "confidence" | "reason"> | undefined;
  transfer?: {
    fromAgentName: string;
    reason: string;
    callerNeedSummary: string;
  } | undefined;
  availableTools: Array<{
    toolAssignmentId: string;
    label: string;
    description: string;
    whenToUse: string;
    inputSchema: Record<string, unknown>;
    requiredInputs: string[];
    risk: AgentToolAssignment["risk"];
    requiresHumanApproval: boolean;
  }>;
  toolResults: Array<{
    toolName: string;
    status: ToolExecutionResult["status"];
    summary: string;
    safeOutput?: Record<string, unknown> | undefined;
  }>;
}

export interface CreateAgentTurnContextOptions {
  maxBytes?: number | undefined;
}

export interface CreateTurnRuntimePacketInput {
  ids: TurnRuntimePacket["ids"];
  timing: {
    startedAt: string;
    sequence?: number | undefined;
  };
  callerInput: Omit<TurnRuntimePacket["callerInput"], "recentTranscript"> & {
    recentTranscript?: TranscriptTurn[] | undefined;
  };
  graph: Pick<TurnRuntimePacket["graph"], "entryNodeId"> &
    Partial<Omit<TurnRuntimePacket["graph"], "entryNodeId" | "visitedNodeIds" | "frontierNodeIds">> & {
      visitedNodeIds?: string[] | undefined;
      frontierNodeIds?: string[] | undefined;
    };
  availableTools?: AgentToolAssignment[] | undefined;
  toolCalls?: ToolCallRecord[] | undefined;
  safety?: Partial<TurnRuntimePacket["safety"]> | undefined;
  diagnostics?: Partial<TurnRuntimePacket["diagnostics"]> | undefined;
}

export interface RecordRuntimePacketNodeVisitInput {
  at: string;
  nodeId: string;
  nodeKind: string;
  label: string;
  payload?: Record<string, unknown> | undefined;
}

export interface AppendRuntimePacketEventInput {
  type: RuntimePacketEventType;
  at: string;
  nodeId?: string | undefined;
  payload: Record<string, unknown>;
}

export interface RecordRuntimePacketIntentInput extends IntentRouteResult {
  at: string;
}

export interface RecordRuntimePacketToolRequestInput {
  at: string;
  nodeId: string;
  request: ToolCallRequest;
}

export interface RecordRuntimePacketToolStartedInput {
  at: string;
  nodeId: string;
  toolCallId: string;
  toolAssignmentId: string;
  toolId: string;
  toolName: string;
}

export interface RecordRuntimePacketToolResultInput {
  at: string;
  nodeId: string;
  result: ToolExecutionResult;
}

export interface RecordRuntimePacketTransferInput {
  at: string;
  nodeId: string;
  transfer: AgentTransferContext;
}

export interface RecordRuntimePacketAgentSelectedInput {
  at: string;
  nodeId?: string | undefined;
  agent: RuntimeAgentRef;
  nextFrontierNodeIds?: string[] | undefined;
}

export interface RecordRuntimePacketWarningInput {
  at: string;
  nodeId?: string | undefined;
  warning: RuntimeWarning;
}

export function createTurnRuntimePacket(input: CreateTurnRuntimePacketInput): TurnRuntimePacket {
  return {
    schemaVersion: "turn-runtime-packet.v1",
    ids: { ...input.ids },
    timing: {
      startedAt: input.timing.startedAt,
      sequence: input.timing.sequence ?? 0,
    },
    callerInput: {
      latestCallerTurn: input.callerInput.latestCallerTurn,
      source: input.callerInput.source,
      recentTranscript: [...(input.callerInput.recentTranscript ?? [])],
      ...(input.callerInput.sttConfidence !== undefined ? { sttConfidence: input.callerInput.sttConfidence } : {}),
      ...(input.callerInput.language !== undefined ? { language: input.callerInput.language } : {}),
      ...(input.callerInput.conversationSummary !== undefined
        ? { conversationSummary: input.callerInput.conversationSummary }
        : {}),
    },
    graph: {
      entryNodeId: input.graph.entryNodeId,
      visitedNodeIds: [...(input.graph.visitedNodeIds ?? [])],
      frontierNodeIds: [...(input.graph.frontierNodeIds ?? [])],
      ...(input.graph.sourceNodeId !== undefined ? { sourceNodeId: input.graph.sourceNodeId } : {}),
      ...(input.graph.currentNodeId !== undefined ? { currentNodeId: input.graph.currentNodeId } : {}),
      ...(input.graph.previousAgent !== undefined ? { previousAgent: { ...input.graph.previousAgent } } : {}),
      ...(input.graph.activeAgent !== undefined ? { activeAgent: { ...input.graph.activeAgent } } : {}),
    },
    availableTools: [...(input.availableTools ?? [])].map(cloneAgentToolAssignment),
    toolCalls: [...(input.toolCalls ?? [])].map(cloneToolCallRecord),
    safety: {
      untrustedSources: [...(input.safety?.untrustedSources ?? ["caller_transcript"])],
      redactionApplied: input.safety?.redactionApplied ?? true,
      maxModelContextBytes: input.safety?.maxModelContextBytes ?? 12_000,
    },
    diagnostics: {
      warnings: [...(input.diagnostics?.warnings ?? [])].map((warning) => ({ ...warning })),
      events: [...(input.diagnostics?.events ?? [])].map(cloneRuntimePacketEvent),
    },
  };
}

export function recordRuntimePacketNodeVisit(
  packet: TurnRuntimePacket,
  input: RecordRuntimePacketNodeVisitInput,
): TurnRuntimePacket {
  const nextPacket = appendRuntimePacketEvent(packet, {
    type: "node.visited",
    at: input.at,
    nodeId: input.nodeId,
    payload: {
      nodeKind: input.nodeKind,
      label: input.label,
      ...(input.payload ?? {}),
    },
  });

  nextPacket.graph.currentNodeId = input.nodeId;
  if (!nextPacket.graph.visitedNodeIds.includes(input.nodeId)) {
    nextPacket.graph.visitedNodeIds.push(input.nodeId);
  }

  return nextPacket;
}

export function recordRuntimePacketIntent(
  packet: TurnRuntimePacket,
  input: RecordRuntimePacketIntentInput,
): TurnRuntimePacket {
  const intent: IntentRouteResult = {
    nodeId: input.nodeId,
    matchedBranchId: input.matchedBranchId,
    intentKey: input.intentKey,
    label: input.label,
    confidence: input.confidence,
    reason: input.reason,
    usedFallback: input.usedFallback,
    targetNodeId: input.targetNodeId,
  };
  const nextPacket = appendRuntimePacketEvent(packet, {
    type: "intent.classified",
    at: input.at,
    nodeId: input.nodeId,
    payload: { ...intent },
  });

  nextPacket.intent = intent;
  return nextPacket;
}

export function recordRuntimePacketToolRequest(
  packet: TurnRuntimePacket,
  input: RecordRuntimePacketToolRequestInput,
): TurnRuntimePacket {
  const nextPacket = appendRuntimePacketEvent(packet, {
    type: "tool.requested",
    at: input.at,
    nodeId: input.nodeId,
    payload: {
      toolCallId: input.request.toolCallId,
      toolAssignmentId: input.request.toolAssignmentId,
      reason: input.request.reason,
    },
  });

  nextPacket.toolCalls.push({
    request: {
      ...input.request,
      arguments: cloneRecord(input.request.arguments),
    },
  });
  return nextPacket;
}

export function recordRuntimePacketToolStarted(
  packet: TurnRuntimePacket,
  input: RecordRuntimePacketToolStartedInput,
): TurnRuntimePacket {
  return appendRuntimePacketEvent(packet, {
    type: "tool.started",
    at: input.at,
    nodeId: input.nodeId,
    payload: {
      toolCallId: input.toolCallId,
      toolAssignmentId: input.toolAssignmentId,
      toolId: input.toolId,
      toolName: input.toolName,
    },
  });
}

export function recordRuntimePacketToolResult(
  packet: TurnRuntimePacket,
  input: RecordRuntimePacketToolResultInput,
): TurnRuntimePacket {
  const nextPacket = appendRuntimePacketEvent(packet, {
    type: resolveToolResultEventType(input.result.status),
    at: input.at,
    nodeId: input.nodeId,
    payload: {
      toolCallId: input.result.toolCallId,
      toolAssignmentId: input.result.toolAssignmentId,
      toolId: input.result.toolId,
      toolName: input.result.toolName,
      status: input.result.status,
      summary: input.result.summary,
      durationMs: input.result.durationMs,
      idempotencyKey: input.result.idempotencyKey,
      ...(input.result.safeOutput !== undefined ? { safeOutput: cloneRecord(input.result.safeOutput) } : {}),
      ...(input.result.error !== undefined ? { error: { ...input.result.error } } : {}),
    },
  });
  const toolCallIndex = nextPacket.toolCalls.findIndex(
    (toolCall) =>
      toolCall.request.toolCallId === input.result.toolCallId
      && toolCall.request.toolAssignmentId === input.result.toolAssignmentId,
  );

  if (toolCallIndex >= 0) {
    const existingToolCall = nextPacket.toolCalls[toolCallIndex];

    if (existingToolCall === undefined) {
      return nextPacket;
    }

    nextPacket.toolCalls[toolCallIndex] = {
      ...existingToolCall,
      result: cloneToolExecutionResult(input.result),
    };
  }

  return nextPacket;
}

export function recordRuntimePacketTransfer(
  packet: TurnRuntimePacket,
  input: RecordRuntimePacketTransferInput,
): TurnRuntimePacket {
  const nextPacket = appendRuntimePacketEvent(packet, {
    type: "transfer.created",
    at: input.at,
    nodeId: input.nodeId,
    payload: {
      transferId: input.transfer.transferId,
      sourceAgentId: input.transfer.sourceAgent.id,
      targetAgentId: input.transfer.targetAgent.id,
      reason: input.transfer.reason,
      ...(input.transfer.matchedIntent !== undefined ? { matchedIntent: { ...input.transfer.matchedIntent } } : {}),
    },
  });

  nextPacket.transfer = cloneAgentTransferContext(input.transfer);
  return nextPacket;
}

export function recordRuntimePacketAgentSelected(
  packet: TurnRuntimePacket,
  input: RecordRuntimePacketAgentSelectedInput,
): TurnRuntimePacket {
  const nextPacket = appendRuntimePacketEvent(packet, {
    type: "agent.selected",
    at: input.at,
    nodeId: input.nodeId,
    payload: {
      activeAgentId: input.agent.id,
      activeAgentName: input.agent.name,
      activeAgentKind: input.agent.kind,
    },
  });

  nextPacket.graph.previousAgent = nextPacket.graph.activeAgent;
  nextPacket.graph.activeAgent = { ...input.agent };
  if (input.nextFrontierNodeIds !== undefined) {
    nextPacket.graph.frontierNodeIds = [...input.nextFrontierNodeIds];
  }
  return nextPacket;
}

export function recordRuntimePacketWarning(
  packet: TurnRuntimePacket,
  input: RecordRuntimePacketWarningInput,
): TurnRuntimePacket {
  const nextPacket = appendRuntimePacketEvent(packet, {
    type: "runtime.warning",
    at: input.at,
    nodeId: input.nodeId,
    payload: { ...input.warning },
  });

  nextPacket.diagnostics.warnings.push({ ...input.warning });
  return nextPacket;
}

export function appendRuntimePacketEvent(
  packet: TurnRuntimePacket,
  input: AppendRuntimePacketEventInput,
): TurnRuntimePacket {
  const nextPacket = cloneTurnRuntimePacket(packet);
  const nextSequence = nextPacket.timing.sequence + 1;
  const event: RuntimePacketEvent = {
    type: input.type,
    at: input.at,
    turnId: nextPacket.ids.turnId,
    sequence: nextSequence,
    payload: cloneRecord(input.payload),
    ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
  };

  nextPacket.timing.sequence = nextSequence;
  nextPacket.diagnostics.events.push(event);
  return nextPacket;
}

export function createAgentTurnContext(
  packet: TurnRuntimePacket,
  options?: CreateAgentTurnContextOptions,
): AgentTurnContext {
  const context: AgentTurnContext = {
    latestCallerTurn: packet.callerInput.latestCallerTurn,
    recentTranscript: packet.callerInput.recentTranscript.map((turn) => ({ ...turn })),
    ...(packet.callerInput.language !== undefined ? { language: packet.callerInput.language } : {}),
    ...(packet.intent !== undefined
      ? {
          intent: {
            intentKey: packet.intent.intentKey,
            label: packet.intent.label,
            confidence: packet.intent.confidence,
            reason: packet.intent.reason,
          },
        }
      : {}),
    ...(packet.transfer !== undefined
      ? {
          transfer: {
            fromAgentName: packet.transfer.sourceAgent.name,
            reason: packet.transfer.reason,
            callerNeedSummary: packet.transfer.callerNeedSummary,
          },
        }
      : {}),
    availableTools: packet.availableTools.map((tool) => ({
      toolAssignmentId: tool.id,
      label: tool.label,
      description: tool.description,
      whenToUse: tool.whenToUse,
      inputSchema: cloneRecord(tool.inputSchema),
      requiredInputs: [...tool.requiredInputs],
      risk: tool.risk,
      requiresHumanApproval: tool.requiresHumanApproval,
    })),
    toolResults: packet.toolCalls.flatMap((toolCall) => {
      if (toolCall.result === undefined) {
        return [];
      }

      return [
        {
          toolName: toolCall.result.toolName,
          status: toolCall.result.status,
          summary: toolCall.result.summary,
          ...(toolCall.result.safeOutput !== undefined
            ? { safeOutput: cloneRecord(toolCall.result.safeOutput) }
            : {}),
        },
      ];
    }),
  };

  return compactAgentTurnContext(context, options?.maxBytes ?? packet.safety.maxModelContextBytes);
}

export function cloneTurnRuntimePacket(packet: TurnRuntimePacket): TurnRuntimePacket {
  return structuredClone(packet) as TurnRuntimePacket;
}

function cloneAgentToolAssignment(tool: AgentToolAssignment): AgentToolAssignment {
  return {
    ...tool,
    inputSchema: cloneRecord(tool.inputSchema),
    requiredInputs: [...tool.requiredInputs],
  };
}

function cloneToolCallRecord(record: ToolCallRecord): ToolCallRecord {
  return {
    request: {
      ...record.request,
      arguments: cloneRecord(record.request.arguments),
    },
    ...(record.result !== undefined ? { result: cloneToolExecutionResult(record.result) } : {}),
  };
}

function cloneToolExecutionResult(result: ToolExecutionResult): ToolExecutionResult {
  return {
    ...result,
    ...(result.output !== undefined ? { output: cloneRecord(result.output) } : {}),
    ...(result.safeOutput !== undefined ? { safeOutput: cloneRecord(result.safeOutput) } : {}),
    ...(result.error !== undefined ? { error: { ...result.error } } : {}),
  };
}

function cloneAgentTransferContext(transfer: AgentTransferContext): AgentTransferContext {
  return {
    transferId: transfer.transferId,
    sourceAgent: { ...transfer.sourceAgent },
    targetAgent: { ...transfer.targetAgent },
    reason: transfer.reason,
    callerNeedSummary: transfer.callerNeedSummary,
    recentToolResults: transfer.recentToolResults.map(cloneToolExecutionResult),
    ...(transfer.matchedIntent !== undefined ? { matchedIntent: { ...transfer.matchedIntent } } : {}),
    ...(transfer.instructionsToTarget !== undefined ? { instructionsToTarget: transfer.instructionsToTarget } : {}),
  };
}

function cloneRuntimePacketEvent(event: RuntimePacketEvent): RuntimePacketEvent {
  return {
    ...event,
    payload: cloneRecord(event.payload),
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(record) as Record<string, unknown>;
}

function resolveToolResultEventType(status: ToolExecutionResult["status"]): RuntimePacketEventType {
  switch (status) {
    case "completed":
    case "partial":
      return "tool.completed";
    case "approval_required":
      return "tool.approval_required";
    case "failed":
    case "skipped":
      return "tool.failed";
  }
}

function compactAgentTurnContext(context: AgentTurnContext, maxBytes: number): AgentTurnContext {
  const nextContext = structuredClone(context) as AgentTurnContext;
  const safeMaxBytes = Math.max(128, maxBytes);

  while (byteLength(JSON.stringify(nextContext)) > safeMaxBytes) {
    if (nextContext.recentTranscript.length > 0) {
      nextContext.recentTranscript.shift();
      continue;
    }

    const toolResultWithSafeOutput = nextContext.toolResults.find((result) => result.safeOutput !== undefined);
    if (toolResultWithSafeOutput !== undefined) {
      delete toolResultWithSafeOutput.safeOutput;
      continue;
    }

    if (nextContext.toolResults.length > 0) {
      nextContext.toolResults.pop();
      continue;
    }

    if (nextContext.availableTools.length > 0) {
      nextContext.availableTools.pop();
      continue;
    }

    if (nextContext.transfer !== undefined) {
      delete nextContext.transfer;
      continue;
    }

    if (nextContext.intent !== undefined) {
      delete nextContext.intent;
      continue;
    }

    if (nextContext.latestCallerTurn.length > 120) {
      nextContext.latestCallerTurn = `${nextContext.latestCallerTurn.slice(0, 117)}...`;
      continue;
    }

    break;
  }

  return nextContext;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
