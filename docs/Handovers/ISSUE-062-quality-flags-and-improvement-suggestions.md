# ISSUE-062: Quality flags and improvement suggestions

Issue link: https://github.com/tuzzy08/zara/issues/62

## Goal

Deliver Quality flags and improvement suggestions for the Runtime area in the Monitoring milestone.

## Acceptance Criteria

- System flags dead ends, hallucinations, slow turns, and escalation misses
- Suggestions create draft changes only
- Human approval is required

## Work Completed

- Added an integration-style controller test for live-session quality reports that covers dead ends, hallucination risk, slow turns, escalation misses, and approval-gated draft suggestions.
- Added `GET /organizations/:orgId/sandbox/live-sessions/:sessionId/quality`.
- Implemented deterministic quality flags from session events:
  - `routing.dead_end` creates `dead_end`.
  - low `groundingConfidence` on `turn.completed` creates `hallucination_risk`.
  - provider latency at or above 5000ms creates `slow_turn`.
  - `escalation.failed` creates `escalation_miss`.
- Improvement suggestions are returned as `pending_approval`, `approvalRequired: true`, and `draftChange.target: workflow_draft` with `appliesToPublishedVersion: false`.
- Updated API and feature-flow docs with the quality report contract.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "quality risks"` failed with `404` before the quality route existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "quality risks"` passed after implementation.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts` passed: 11 tests.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/memory/memory.controller.test.ts apps/api/src/integrations/integrations.controller.test.ts apps/api/src/telephony/telephony.controller.test.ts` passed: 4 files, 37 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build --workspace @zara/api` passed.
- `npm.cmd run test:run` passed: 39 files, 182 tests.

## Pending Work

- None for ISSUE-062 implementation.

## Risks And Edge Cases

- Bad suggestion risk is limited by returning draft-only pending suggestions that require human approval; no published workflow is mutated.
- Regression risk remains around future model-generated suggestions. Keep suggestions deterministic or require source grounding plus approval before introducing LLM-authored draft changes.

## Decisions

- Priority: P2
- Labels: runtime, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Quality flags are event-derived and deterministic for this slice.
- Suggestions are not auto-applied and cannot target published workflow versions.

## Next Recommended Step

Proceed to ISSUE-063 tenant isolation tests.
