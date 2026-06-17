# Runtime Orchestration Edge Cases And Policies

## Purpose

Intent routing, discretionary tool calls, and agent transfers must behave predictably under ambiguity, failure, interruption, and malicious input. This document lists required edge cases and the mitigation policy each implementation issue must cover.

## Intent Edge Cases

| Edge case | Mitigation |
| --- | --- |
| Multiple intents in one turn | Choose the highest-priority or most specific configured branch. If still ambiguous, fallback. |
| Ambiguous request | Fallback when confidence is below threshold. |
| Latest turn conflicts with history | Latest caller turn wins unless it is clearly a continuation. |
| Overlapping branches | Validate obvious overlap in builder where possible; classifier chooses the most specific branch. |
| No matching branch | Use fallback. Never invent a branch. |
| Invalid classifier output | Discard output and fallback. Emit warning. |
| Multilingual or code-switched caller | Pass language into classifier and keep branch descriptions language-neutral. |
| Caller asks to stop or speak to a human | Prefer a matching stop, exit, escalation, or human branch if configured. |

## Tool Edge Cases

| Edge case | Mitigation |
| --- | --- |
| Agent has no assigned tools | Expose an explicit empty toolbelt, disable action-mode tool instructions, and run a normal response turn with no tool events. |
| Tool needs missing input | Return `skipped` with missing-input error; agent asks for the missing slot. |
| Tool requires approval | Return `approval_required`; do not execute silently. |
| Timeout or rate limit | Return `failed` with `recoverable: true` and specific `tool_execution.timeout` or `tool_execution.rate_limited` error codes; agent offers a next step. |
| Partial success | Return `partial` through `tool.completed` with warnings and safe output; the same agent receives only the safe projection. |
| Duplicate execution | Use deterministic idempotency keys per call, turn, agent, and tool assignment. |
| Unsafe tool output | Treat as untrusted; redact, summarize, and size-limit before model use. |
| Tool loop | Enforce max tool calls per turn and emit recoverable warning. |
| Revoked credential mid-call | Return structured failure and route to safe response or escalation. |
| Side-effect tool called with low confidence | Require confirmation or approval based on risk policy. |

## Transfer Edge Cases

| Edge case | Mitigation |
| --- | --- |
| Target agent missing or disabled | Publish validation blocks it; runtime fallback handles defensively. |
| Transfer loop | Enforce transfer depth and visited-agent limits. Direct routes now stop on the current target when the next agent was already visited and emit `transfer_loop.detected`. |
| Target agent lacks context | Transfer context is required for every transfer. |
| Caller refuses transfer | Latest caller turn can cancel or override planned transfer. |
| Language mismatch | When caller language is known, direct transfers and handoff transfers stay with the source agent if the target does not support it, clear the frontier, and emit `transfer_language.unsupported`. |
| Conflicting instructions | Target-agent instructions and platform guardrails win. |
| Direct agent-to-agent route has no handoff reason | Runtime creates generic route context from source and target graph state. |
| Transfer target unavailable in live human queue | Use configured fallback mode and caller-safe explanation. |

## Runtime And Voice Edge Cases

| Edge case | Mitigation |
| --- | --- |
| Caller interrupts classifier or tool | Cancel non-side-effect work where possible; record side-effect completion state. |
| Out-of-order stream events | Attach `turnId`, `sequence`, and node ID to all packet events. |
| Context bloat | Bound transcript window, tool results, transfer history, and safe output bytes. |
| Published version changes mid-call | Active calls remain pinned to manifest ID and version. |
| STT confidence is low | Bias toward clarification or fallback for high-risk routing/tool decisions. |
| Provider unavailable | Use configured fallback provider or safe degradation path. |
| Premium OpenAI Realtime routeable turn needs a handoff without an extra classifier pass | Route-capable active agents keep provider auto-response enabled and receive the internal `zara_route_to_agent` provider tool. The model calls that tool only when enough caller context exists; Zara validates the configured branch, updates the provider session prompt/tools, emits the route announcement, and lets the routed agent continue. |
| Published/draft manifest carries route policy on the agent role but not in normalized `routePolicies` | Premium realtime normalizes role-attached route policies before building provider tool declarations, so route-capable agents still receive the internal route tool. |
| Premium OpenAI Realtime route announcement is not spoken after a route tool call | When route policy announcement text is configured, route tool handling sends the tool output and follows with a `response.create` instruction to speak that announcement before the target agent continues. |
| Premium OpenAI Realtime role switch tries to change voice mid-call | Initial session setup applies the selected OpenAI voice. Route-time session updates change prompt, language, and tools but do not resend voice/speed, avoiding provider rejection after audio has already been produced. |
| Runtime restart | Rebuild active frontier and compact packet facts from persisted event history. |

## Security And Tenant Isolation Policies

- Every packet boundary validates tenant ID, workspace ID, call session ID, and manifest ID.
- Tool credentials remain server-side and are resolved only during execution.
- Tool outputs, memory, knowledge, CRM data, and transcript snippets are untrusted model context.
- Redaction happens before persistence and before model projection where policy requires it.
- Prompt-injection instructions in untrusted content are never promoted into system or developer prompts.
- Classifier and agent model outputs are commands to validate, not commands to obey blindly.
- Runtime never accepts graph target IDs from model output.
- Unsupported structured agent actions are ignored, emitted as recoverable `agent_action.invalid` warnings, and replaced with caller-safe fallback speech.
- Human approval gates are explicit runtime states, not UI-only hints.

## Observability Policies

Every runtime decision should emit compact, replayable, redacted events:

- intent classification result and fallback status
- tool request, validation result, execution status, duration, and safe summary
- transfer source, target, reason, and matched intent
- active agent selected for the turn
- model provider/model selected for the turn
- warnings for fallback, malformed output, loop prevention, missing input, timeout, or approval gates

Events should include `turnId` and monotonic sequence so monitors can reconstruct the turn without racing provider callbacks.

## Test Expectations

Each implementation issue must add failing tests before production changes:

- Unit tests for packet reducers, classifier output validation, tool-call validation, transfer context creation, and policy guards.
- Runtime router tests for intent, tools, handoffs, fallback, loop limits, and stale frontier recovery.
- API/websocket contract tests for packet-backed events and redacted replay.
- Builder tests for user-facing configuration and publish validation.
- Security tests for tenant/workspace isolation and untrusted context handling.

## Implemented Baseline

ISSUE-137 centralizes the runtime policy baseline around the turn runtime packet. The current implementation covers invalid or empty intent-classifier output, ambiguity fallback, missing tool inputs, approval gates, timeout and rate-limit failures, partial tool success, explicit empty toolbelts, invalid model action commands, direct transfer loops, transfer language mismatch, interrupted model streams, context bloat compaction, untrusted prompt lanes, tenant-scoped replay, and redacted live-session events.

Future policy work can extend this baseline with caller-refusal transfer cancellation, configurable per-turn tool-call limits, runtime restart reconstruction, and provider outage fallback without changing the packet contract.
