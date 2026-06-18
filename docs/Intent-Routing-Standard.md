# Intent Routing Standard

## Purpose

Intent routes classify the caller's latest need into one operator-configured route. They do not invent routes, execute tools, or speak to the caller. They write a structured intent result into the turn runtime packet, then the graph routes to the configured target.

This standard is implemented for live sandbox intent routes. The builder still stores compatibility `intent == "..."` expressions internally, but operators configure intent keys, descriptions, examples, confidence threshold, input-window options, and fallback targets instead of editing raw expressions.

## Product Rules

- Branches define what can be matched. The classifier can only choose a configured branch or fallback.
- The intent node owns classification. Users should not have to create or manage a separate classifier agent.
- Route-capable agents triage through configured branches; tenants do not need a separate classifier agent to make that decision.
- For the common route-after-agent path, agent-attached route policies are preferred over separate visible intent and handoff nodes.
- Agent-attached routing is agent-decided through an internal route tool/action, not a separate classifier turn.
- The latest caller turn is the strongest signal. Conversation summary is used only to resolve ambiguity.
- If no branch clearly matches, the intent route uses fallback.
- Intent routes write structured facts into the turn runtime packet. They do not directly choose arbitrary graph targets.

## Agent-Attached Route Policies

Agent-attached route policies let an active speaking agent keep the conversation until it decides the caller should be routed through one of the configured branches. Operators do not need to draw a separate intent node and handoff node for this common pattern.

The active agent owns the practical intent decision by choosing whether to call Zara's internal route tool/action. Zara injects only a compact route menu derived from the compiled manifest: branch IDs, branch labels, branch descriptions/examples, fallback posture, and safe target display names. The agent never receives graph target IDs, connector credentials, provider URLs, or arbitrary target-entry fields.

The runtime owns validation and execution. It accepts only configured branch IDs, ignores any model-supplied graph target, validates target existence, transfer loops, language support, and fallback posture, then emits the caller-facing route announcement before selecting the target agent. Agent-target routes create `AgentTransferContext` and may write an `IntentRouteResult`-compatible fact for observability, but no extra classifier model call is required for agent-attached routing.

The tenant builder keeps one Agent node runtime model. The builder presents Agent and Router Agent as distinct toolbox presets and inspector experiences, but Router Agent still creates a normal agent node with route policy enabled. Normal Agents do not expose a route/behavior conversion dropdown. Router Agents retain normal tools, knowledge, voice, language, runtime, and prompt configuration; routing is an additional capability, not a replacement for tool use. Route target options are derived from actual agent nodes in the current workflow, excluding the source agent; branch identity, labels, descriptions, and examples are derived from the target agent's configured role kind/profile for built-in roles and only fall back to the configured role name for custom roles. Fallback can clarify with the source agent or choose an existing configured target. The canvas may show compact badges such as Routes, but it must not add separate tenant-managed triage, handoff, or intent-route node types for this path.

Platform-admin runtime controls govern global defaults and review posture for this feature: route action/tool naming, announcement mode, fallback posture, and validation/audit posture. Staff can save these defaults through guarded platform-admin route-policy APIs with expected-version checks and audit reasons. Tenant-facing builder controls edit per-workflow branch copy and targets, while platform-admin remains the staff governance surface for default route-policy behavior.

## User Configuration

```ts
type IntentRouteNodeConfig = {
  classifier: {
    mode: "standard";
    modelAlias: "intent-classifier-fast";
    confidenceThreshold: number; // default 0.65
  };

  inputWindow: {
    latestCallerTurn: true;
    recentTranscriptTurns: number; // default 6
    includeConversationSummary: boolean; // default true
    includePreviousAgentContext: boolean; // default true
    includeRecentToolResults: boolean; // default false unless branches depend on tools
  };

  branches: Array<{
    id: string;
    label: string;
    intentKey: string;
    description: string;
    examples: string[];
    targetNodeId: string;
  }>;

  fallback: {
    label: string;
    targetNodeId: string;
  };
};
```

User-facing builder language should stay plain:

- "Route by caller intent after this agent."
- "Match callers to one of these branches."
- "Fallback is used when the caller's intent is unclear."

## Runtime Classifier Input

```ts
type IntentClassifierInput = {
  nodeId: string;
  sourceAgentId: string;
  sourceAgentName: string;
  sourceAgentInstructionsSummary?: string;

  latestCallerTurn: string;
  recentTranscript: Array<{
    speaker: "caller" | "agent" | "system";
    text: string;
  }>;

  conversationSummary?: string;
  recentToolResults?: Array<{
    toolName: string;
    status: "completed" | "failed" | "approval_required" | "skipped" | "partial";
    summary: string;
  }>;

  branches: Array<{
    id: string;
    label: string;
    intentKey: string;
    description: string;
    examples: string[];
  }>;

  fallback: {
    label: string;
  };
};
```

## Runtime Classifier Output

```ts
type IntentClassifierOutput = {
  matchedBranchId: string | null;
  intentKey: string | null;
  confidence: number;
  reason: string;
  usedFallback: boolean;
};
```

The runtime validates this output before routing. If validation fails, the runtime discards the output and uses fallback.

## Internal Classifier Model

The product target is Gemini Flash Lite class latency/cost for intent classification.

```ts
type IntentClassifierModelConfig = {
  provider: "google-gemini";
  modelAlias: "intent-classifier-fast";
  providerModelId: string;
  temperature: 0;
  maxOutputTokens: 256;
  responseFormat: "json";
};
```

`modelAlias` is stable in manifests and tests. `providerModelId` is runtime configuration, not workflow state. The default mapping should be:

```ts
intent-classifier-fast =
  env.INTENT_CLASSIFIER_MODEL_ID ??
  "gemini-3.1-flash-lite";
```

If the provider has not exposed that exact model ID in a deployment environment, operators can map the alias to the closest approved Gemini Flash Lite model without changing workflow manifests.

## Routing Prompt

```text
You are an intent router for a live voice workflow.

Choose exactly one configured branch only if the caller's latest need clearly matches it.
Do not invent intents, branch IDs, labels, tools, or targets.
Prefer the latest caller turn over older conversation context.
Use conversation summary only to resolve ambiguity.
If multiple branches fit, choose the most specific branch.
If confidence is below the threshold, use fallback.
If the caller is asking to stop, leave, cancel the call, or speak to a human and such a branch exists, choose that branch.
Return JSON only.

Configured branches:
{{branches_json}}

Fallback:
{{fallback_json}}

Context:
Source agent: {{source_agent_name}}
Latest caller turn: {{latest_caller_turn}}
Recent transcript: {{recent_transcript_json}}
Conversation summary: {{conversation_summary}}
Recent tool results: {{recent_tool_results_json}}

Return:
{
  "matchedBranchId": string | null,
  "intentKey": string | null,
  "confidence": number,
  "reason": string,
  "usedFallback": boolean
}
```

## Policy Guards

- `matchedBranchId` must be `null` or a configured branch ID.
- `intentKey` must be `null` or match the selected branch's `intentKey`.
- `confidence` must be a finite number between 0 and 1.
- `confidence < confidenceThreshold` means fallback.
- `usedFallback === true` means route to the configured fallback target.
- Unknown branch IDs, malformed JSON, missing confidence, or empty caller turn all route to fallback.
- Classifier output never supplies `targetNodeId`; the runtime resolves the target from saved branch config.
- Branch and fallback targets must pass the workflow relationship policy before publish and defensively at runtime.
- Builder target lists must be derived from the workflow graph/manifest, never hard-coded specialist labels.
- Caller transcript, tool results, memory, and knowledge remain untrusted input.
- Raw sensitive transcript is governed by the existing retention and redaction policy.

## Runtime Behavior

1. Build an `IntentClassifierInput` from the turn runtime packet.
2. Call `intent-classifier-fast`.
3. Validate output with policy guards.
4. Write `packet.intent`.
5. Append an `intent.classified` packet event.
6. Route to the selected branch target or fallback target.
7. Pass safe intent context into the next agent's model-facing projection.

## Packet Fact

```ts
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
```

## Observability

Intent route events should include:

- `turnId`
- `sequence`
- `nodeId`
- `matchedBranchId`
- `intentKey`
- `confidence`
- `usedFallback`
- `targetNodeId`
- `modelAlias`
- provider latency
- short reason summary

They should not include unredacted caller transcript by default.

## Implemented Behavior

The live sandbox router calls the `intent-classifier-fast` Gemini alias for normal intent-route turns, validates the structured JSON with the policy guards above, writes `IntentRouteResult` into the turn runtime packet, and routes only to configured branch or fallback targets. Explicit sandbox intent overrides remain available for operator testing.

The Gemini adapter maps `intent-classifier-fast` to `INTENT_CLASSIFIER_MODEL_ID` or `gemini-3.1-flash-lite`, uses temperature `0`, requests JSON output, and sends branch labels, intent keys, descriptions, and examples without exposing graph target IDs to the model.

Agent-attached route policies are preserved in draft and compiled manifests. The runtime projects them to the active route-capable agent as an internal route action/tool, validates any requested branch against saved policy, ignores any model-supplied target, and emits an `agent.route.announcement` pre-event when configured announcement text should be spoken before transfer. Standalone legacy intent routes remain classifier-backed until a future removal slice.
