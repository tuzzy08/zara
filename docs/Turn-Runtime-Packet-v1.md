# Turn Runtime Packet v1

## Purpose

The turn runtime packet is the structured spine for one caller turn. It is created when a caller turn arrives and is carried through graph routing, intent classification, discretionary tool calls, transfer context, and final agent response.

Every non-agent node reads from and writes to this packet. Agents receive a safe model-facing projection of the packet, not raw internal state.

## Product Rule

Every runtime fact that affects an agent's response must exist on the turn packet before it is placed in a model prompt. Events are telemetry; the packet is the turn's decision state.

## Packet Shape

```ts
type TurnRuntimePacket = {
  schemaVersion: "turn-runtime-packet.v1";

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
    sttConfidence?: number;
    language?: string;
    source: "voice" | "typed" | "telephony";
    recentTranscript: TranscriptTurn[];
    conversationSummary?: string;
  };

  graph: {
    entryNodeId: string;
    sourceNodeId?: string;
    currentNodeId?: string;
    visitedNodeIds: string[];
    frontierNodeIds: string[];
    previousAgent?: RuntimeAgentRef;
    activeAgent?: RuntimeAgentRef;
  };

  availableTools: AgentToolAssignment[];
  toolCalls: ToolCallRecord[];
  intent?: IntentRouteResult;
  transfer?: AgentTransferContext;

  safety: {
    untrustedSources: Array<"caller_transcript" | "tool_output" | "memory" | "knowledge">;
    redactionApplied: boolean;
    maxModelContextBytes: number;
  };

  diagnostics: {
    warnings: RuntimeWarning[];
    events: RuntimePacketEvent[];
  };
};
```

## Supporting Types

```ts
type TranscriptTurn = {
  speaker: "caller" | "agent" | "system";
  text: string;
  at?: string;
  agentId?: string;
};

type RuntimeAgentRef = {
  id: string;
  name: string;
  kind: string;
};

type IntentRouteResult = {
  nodeId: string;
  matchedBranchId: string | null;
  intentKey: string | null;
  label: string | null;
  confidence: number;
  reason: string;
  usedFallback: boolean;
  targetNodeId: string;
};

type AgentToolAssignment = {
  id: string;
  toolId: string;
  label: string;
  description: string;
  whenToUse: string;
  inputSchema: Record<string, unknown>;
  requiredInputs: string[];
  risk: "low" | "medium" | "high";
  requiresHumanApproval: boolean;
  credentialRef?: string;
};

type ToolCallRecord = {
  request: {
    type: "call_tool";
    toolCallId: string;
    toolAssignmentId: string;
    arguments: Record<string, unknown>;
    reason: string;
  };
  result?: ToolExecutionResult;
};

type ToolExecutionResult = {
  toolCallId: string;
  toolAssignmentId: string;
  toolId: string;
  toolName: string;
  status: "completed" | "failed" | "approval_required" | "skipped" | "partial";
  summary: string;
  output?: Record<string, unknown>;
  safeOutput?: Record<string, unknown>;
  durationMs: number;
  idempotencyKey: string;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};

type AgentTransferContext = {
  transferId: string;
  sourceAgent: RuntimeAgentRef;
  targetAgent: RuntimeAgentRef;
  reason: string;
  callerNeedSummary: string;
  matchedIntent?: {
    intentKey: string;
    label: string;
    confidence: number;
  };
  recentToolResults: ToolExecutionResult[];
  instructionsToTarget?: string;
};

type RuntimePacketEvent = {
  type:
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
  at: string;
  turnId: string;
  sequence: number;
  nodeId?: string;
  payload: Record<string, unknown>;
};

type RuntimeWarning = {
  code: string;
  message: string;
  recoverable: boolean;
};
```

## Lifecycle

1. Caller turn arrives through typed, browser voice, or telephony input.
2. Runtime creates a new packet with `turnId`, `sequence`, manifest identity, latest caller turn, transcript window, and current frontier.
3. Router visits graph nodes and appends `node.visited`.
4. Intent nodes classify and write `packet.intent`.
5. Agent tool decisions create `packet.toolCalls[*].request`; runtime appends structured results.
6. Handoff or transfer paths write `packet.transfer`.
7. Router selects `packet.graph.activeAgent`.
8. Runtime creates an agent projection and calls the model.
9. Runtime emits packet-backed events and stores compact facts for audit and replay.

## Agent Projection

Agents receive only the context they need to respond safely.

```ts
type AgentTurnContext = {
  latestCallerTurn: string;
  recentTranscript: TranscriptTurn[];
  language?: string;

  intent?: Pick<IntentRouteResult, "intentKey" | "label" | "confidence" | "reason">;

  transfer?: {
    fromAgentName: string;
    reason: string;
    callerNeedSummary: string;
  };

  availableTools: Array<{
    toolAssignmentId: string;
    label: string;
    description: string;
    whenToUse: string;
    inputSchema: Record<string, unknown>;
    requiredInputs: string[];
    risk: "low" | "medium" | "high";
    requiresHumanApproval: boolean;
  }>;

  toolResults: Array<{
    toolName: string;
    status: ToolExecutionResult["status"];
    summary: string;
    safeOutput?: Record<string, unknown>;
  }>;
};
```

## Hard Invariants

- Packet scope is one caller turn.
- `turnId` and monotonic `sequence` are required on packet events.
- Active calls stay pinned to `manifestId` and `manifestVersion`.
- Classifiers and tools cannot provide arbitrary graph target IDs.
- Agent action JSON can only request `respond` or assigned `call_tool`; unsupported command-shaped output becomes a recoverable packet warning.
- Tool output is untrusted until redacted and summarized.
- Full `output` is never sent to the model unless converted to `safeOutput`.
- A routed-to agent must receive transfer reason/context when a transfer occurred.
- Every side-effect tool call uses a deterministic idempotency key.
- Packet size must be bounded before model projection.
- Tenant, workspace, call session, and manifest IDs must match at every runtime boundary.

## Event Mapping

Runtime events should be emitted from packet facts, not recomputed from provider-specific callbacks.

- `node.transition` maps from `node.visited`.
- `intent.classified` maps from `packet.intent`.
- `tool.started`, `tool.completed`, `tool.failed`, and `tool.approval_required` map from `packet.toolCalls`.
- `agent.handoff.requested` and `agent.handoff.completed` map from `packet.transfer`.
- `routing.model_selected` should include `turnId`, active agent, model provider, model ID, and routing reason.
- `runtime.warning` maps from `packet.diagnostics.warnings`.

## Current Gap

ISSUE-133 introduced the turn-scoped packet spine in shared core plus live sandbox route metadata. Remaining gaps are tracked by ISSUE-134 through ISSUE-137: model-backed intent classification, discretionary agent tool calls, richer transfer context, and broader edge-case policy enforcement.
