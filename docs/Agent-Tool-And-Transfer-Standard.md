# Agent Tool And Transfer Standard

## Purpose

This document standardizes how agents use tools and how calls move between agents. It updates the mental model from mandatory graph traversal to agent-aware capabilities and structured transfers.

## Product Rules

- Agents speak to callers.
- Tools are capabilities available to an agent, not mandatory graph steps.
- An agent may have zero assigned tools; an empty toolbelt is explicit and valid.
- Agents decide whether to call zero, one, or multiple assigned tools during a turn.
- Route-capable agents may also choose an internal route action/tool when the caller's need matches a configured route branch.
- Zara validates, executes, redacts, and returns tool results to the same agent.
- Internal route tools are not integration connector tools and do not require agent-tool grants.
- Handoff and transfer paths create structured transfer context.
- A routed-to agent is always told why it received the caller.
- Tool output and transfer context are advisory input; platform policy and target-agent instructions still win.

## Agent Tool Assignments

Builder configuration should assign tools to an agent's toolbelt.

```ts
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
```

User-facing language:

- "Available to this agent"
- "Use when"
- "Requires"
- "Approval required"
- "Safe to run automatically"

The builder may still render tools near the agent visually, but compile-time semantics should treat them as assigned capabilities rather than automatic `agent -> tool -> agent` frontier steps.

## Agent Action Output

The runtime should ask the agent for a structured action before the final spoken reply when tools are available.

```ts
type AgentAction =
  | {
      type: "respond";
      responseText: string;
    }
  | {
      type: "call_tool";
      toolCallId: string;
      toolAssignmentId: string;
      arguments: Record<string, unknown>;
      reason: string;
    }
  | {
      type: "route_to_agent";
      branchId: string;
      reason: string;
      callerNeedSummary: string;
    };
```

The model must not invent `toolAssignmentId`. If required inputs are missing, the correct action is `respond` with a caller-facing clarification question.
The model must not route, hand off, or name graph targets through ordinary tool-call action JSON. Route-capable agents may request `route_to_agent` only with a configured `branchId` from the injected route menu. Unsupported structured actions are ignored by runtime, recorded as `agent_action.invalid`, and replaced with a caller-safe fallback.

## Internal Route Tool

When an agent has an attached route policy, runtime projects a compact route menu into the same agent turn context that carries normal assigned tools. For provider-native realtime sessions, the same route capability is declared as an internal provider-safe function/tool. The route menu contains configured branch IDs, labels, descriptions/examples, fallback posture, and safe target display names; it does not expose graph target IDs, connector metadata, credentials, provider URLs, or arbitrary target entry.

User-facing examples:

- "Route caller to Billing"
- "Route caller to Sales"
- "Ask a clarifying question if none of the branches clearly fit"

Internal action shape:

```ts
type InternalRouteAction = {
  type: "route_to_agent";
  branchId: string;
  reason: string;
  callerNeedSummary: string;
};
```

The active agent decides whether enough caller context exists by choosing to call or not call the route action. Greetings and unclear turns stay with the same agent naturally because no route action is requested.

Runtime guards:

- `branchId` must exist in the active agent's route policy.
- Model-supplied target node IDs, agent IDs, queue IDs, URLs, or credential references are ignored.
- Unknown branches produce a packet warning and keep the source agent active.
- Route-capable agents retain normal assigned tools; route actions and connector tools are validated through separate paths.
- Route actions must not be counted as integration tool grants or publish-blocking connector assignments.
- Runtime still checks target existence, transfer loops, known caller language support, fallback posture, announcement policy, and packet facts before switching agents.

## Tool Execution Result

```ts
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
```

The runtime stores full `output` only after policy checks. The model receives `summary` and optional `safeOutput`.

## Tool Runtime Flow

1. Router selects the active agent.
2. Runtime creates the agent projection with available tools.
3. Agent returns `respond` or `call_tool`.
4. Runtime validates the requested tool assignment and arguments.
5. Runtime checks tenant/workspace grants, credentials, risk, and approval posture.
6. Runtime executes the tool or returns a structured non-execution result.
7. Runtime appends the result to the turn packet.
8. The same agent receives the result and decides whether to respond, ask a follow-up, or call another allowed tool.
9. Runtime enforces per-turn tool-call limits and idempotency.

## Tool Policy Guards

- Agents can only call tools assigned to them in the manifest.
- Runtime validates arguments against the tool input schema.
- Missing required inputs produce `status: "skipped"` with a recoverable missing-input error.
- Approval-required tools produce `status: "approval_required"` unless approval is already recorded.
- Failed tools produce structured failure context; timeout and rate-limit failures use `tool_execution.timeout` and `tool_execution.rate_limited`.
- Partial tool success produces `status: "partial"` on `tool.completed` with safe output and warnings for the same agent.
- Side-effect tools require idempotency keys.
- Tool output is untrusted, redacted, size-limited, and summarized before model use.
- Maximum tool calls per turn should default to 2 and be runtime-configurable.
- Tool loops terminate with a recoverable warning and a caller-safe response.
- Empty toolbelts disable agent action mode and run as ordinary response turns with no tool events.
- Unsupported structured agent commands are never spoken to the caller and never mutate graph routing.

## Transfer Context

Transfers include explicit context for the receiving agent.

```ts
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
```

## Transfer Runtime Flow

For `agent -> intent -> handoff -> agent`:

1. Intent node writes a validated `IntentRouteResult`.
2. Handoff node resolves the target agent.
3. Runtime creates `AgentTransferContext`.
4. Runtime emits transfer events from the packet.
5. Target agent receives the transfer context in its model-facing projection.
6. Target agent responds naturally with awareness of caller need and prior work.

For direct `agent -> agent`:

1. Runtime creates a transfer context with a generic route reason if no handoff node exists.
2. Source and target agent refs are still recorded.
3. Target agent still receives model-facing transfer context.

For agent-decided route tools:

1. Runtime projects the active agent's route menu and normal assigned tools.
2. The active agent either responds, calls a normal assigned tool, or requests `route_to_agent` with a configured branch ID.
3. Runtime validates the branch and route guards, resolves the target from the saved manifest, and ignores model-supplied targets.
4. Runtime emits the configured caller-facing route announcement and transfer events.
5. Target agent receives `AgentTransferContext` with the route reason and caller need summary, then continues naturally.

## Target Agent Prompt Context

```text
Transfer context:
You are receiving this caller from {{source_agent_name}}.
Reason: {{reason}}.
Caller need summary: {{caller_need_summary}}.
Matched intent: {{intent_label}}, confidence {{confidence}}.
Recent tool results:
{{tool_result_summaries}}

Continue naturally. Do not announce internal routing mechanics unless useful to the caller.
```

## Transfer Policy Guards

- Target agent must exist in the pinned manifest.
- Transfer depth and visited-agent limits prevent loops.
- The latest caller refusal can cancel a planned transfer.
- Language support is checked before direct and handoff transfers when language is known; unsupported targets emit `transfer_language.unsupported` and the source agent stays active.
- Target-agent instructions and platform guardrails override transfer context.
- Missing transfer context falls back to a safe clarification or escalation path.
- Transfer events include source and target IDs for audit.

## Implemented Baseline

Compiled manifests expose explicit agent tool assignments, including valid empty assignment lists for agents with no tools. Live sandbox routing no longer executes tool nodes as mandatory graph steps, agent model output can choose `respond` or assigned `call_tool` when a toolbelt exists, and structured tool results are written back to the turn packet with safe output projected to the same agent.

Handoff and direct agent-to-agent routes write `AgentTransferContext`, emit packet-backed transfer events with source and target IDs, and project transfer reason plus caller summary to the routed-to agent. Direct transfer loops emit `transfer_loop.detected`; unsupported transfer languages emit `transfer_language.unsupported` and keep the source agent active. Unsupported structured agent commands are ignored, warned, and replaced with caller-safe fallback speech.

ISSUE-179 updates the target architecture for agent-attached route policies: route-capable agents keep normal tools and additionally receive an internal route action/tool. The active model decides when to request a configured branch, while runtime remains authoritative for branch validation, target resolution, announcements, transfer context, loop/language guards, and audit facts. Standalone legacy intent routes remain classifier-backed until removed by a future slice.
