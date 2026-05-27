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
| Tool needs missing input | Return `skipped` with missing-input error; agent asks for the missing slot. |
| Tool requires approval | Return `approval_required`; do not execute silently. |
| Timeout or rate limit | Return `failed` with `recoverable: true`; agent offers a next step. |
| Partial success | Return `partial` with warnings and safe output. |
| Duplicate execution | Use deterministic idempotency keys per call, turn, agent, and tool assignment. |
| Unsafe tool output | Treat as untrusted; redact, summarize, and size-limit before model use. |
| Tool loop | Enforce max tool calls per turn and emit recoverable warning. |
| Revoked credential mid-call | Return structured failure and route to safe response or escalation. |
| Side-effect tool called with low confidence | Require confirmation or approval based on risk policy. |

## Transfer Edge Cases

| Edge case | Mitigation |
| --- | --- |
| Target agent missing or disabled | Publish validation blocks it; runtime fallback handles defensively. |
| Transfer loop | Enforce transfer depth and visited-agent limits. |
| Target agent lacks context | Transfer context is required for every transfer. |
| Caller refuses transfer | Latest caller turn can cancel or override planned transfer. |
| Language mismatch | Validate target language support or route to fallback/escalation. |
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
| Runtime restart | Rebuild active frontier and compact packet facts from persisted event history. |

## Security And Tenant Isolation Policies

- Every packet boundary validates tenant ID, workspace ID, call session ID, and manifest ID.
- Tool credentials remain server-side and are resolved only during execution.
- Tool outputs, memory, knowledge, CRM data, and transcript snippets are untrusted model context.
- Redaction happens before persistence and before model projection where policy requires it.
- Prompt-injection instructions in untrusted content are never promoted into system or developer prompts.
- Classifier and agent model outputs are commands to validate, not commands to obey blindly.
- Runtime never accepts graph target IDs from model output.
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

## Current Gap

The current runtime has pieces of these policies spread across graph validation, live-session routing, tool execution, prompt construction, redaction, and monitoring. The next implementation slice should centralize these policies around the turn runtime packet so behavior is consistent and testable.
