# ISSUE-071: Redaction pipeline

Issue link: https://github.com/tuzzy08/zara/issues/71

## Goal

Deliver Redaction pipeline for the Security area in the Production milestone.

## Acceptance Criteria

- PII/sensitive data redaction runs before storage where configured
- Original access is restricted
- Tests cover transcripts and summaries

## Work Completed

- Added pre-storage live-session payload redaction when the runtime manifest has `telemetry.redactSensitiveData = true`.
- Redaction now runs before live-session event history and session memory capture.
- Transcript, response, tool, CRM diagnostic, and nested payload strings are redacted recursively before storage.
- Post-call summaries continue to use the same redaction rules, and now summarize already-redacted transcript storage.
- Tests cover transcript events, session memory, and post-call summaries to ensure raw email, payment card, and phone values are not returned while non-sensitive invoice IDs survive.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts` failed because raw transcript PII was stored in events and session memory.
- GREEN/REFACTOR:
  - `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
  - `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-071.

## Risks And Edge Cases

- False positive
- Streaming partial redaction

## Decisions

- Priority: P0
- Labels: security, compliance, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Redaction is tied to manifest telemetry policy, so tenants/workflows that disable redaction can still preserve raw internal test events if explicitly configured.
- Original sensitive values are not retained in live-session event or memory storage for redacted sessions.
- Redaction is recursive across payload strings so streaming partials and nested provider diagnostics use the same pipeline.

## Next Recommended Step

ISSUE-071 is complete. Future restricted-original access would need a separate encrypted evidence store and explicit permission model.
