# Intent Routing Standard

## Purpose

Intent routes classify the caller's latest need into one operator-configured route. They do not invent routes, execute tools, or speak to the caller. They write a structured intent result into the turn runtime packet, then the graph routes to the configured target.

This is the target standard for the next runtime implementation pass. The current builder represents intent routes as condition nodes with `intent == "..."` expressions; this standard keeps the simple user model while making classification explicit, model-backed, and policy-guarded.

## Product Rules

- Branches define what can be matched. The classifier can only choose a configured branch or fallback.
- The intent node owns classification. Users should not have to create or manage a separate classifier agent.
- Any agent can be followed by an intent route. "Triage" is a behavior, not a required agent type.
- The latest caller turn is the strongest signal. Conversation summary is used only to resolve ambiguity.
- If no branch clearly matches, the intent route uses fallback.
- Intent routes write structured facts into the turn runtime packet. They do not directly choose arbitrary graph targets.

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

## Current Gap

The current live sandbox router can accept an explicit sandbox intent or infer intent from transcript text matching branch names. It does not yet call a classifier model, produce a validated `IntentRouteResult`, or pass a full turn packet projection to the next agent. ISSUE-134 tracks the implementation.
