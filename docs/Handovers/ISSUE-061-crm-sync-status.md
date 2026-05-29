# ISSUE-061: CRM sync status

Issue link: https://github.com/tuzzy08/zara/issues/61

## Goal

Deliver CRM sync status for the Integrations area in the Monitoring milestone.

## Acceptance Criteria

- Post-call sync status is visible
- Retries are queued
- Failures include actionable diagnostics

## Work Completed

- Added an integration-style controller test for post-call CRM sync visibility, safe failure diagnostics, and retry queueing through live-session APIs.
- Added `GET /organizations/:orgId/sandbox/live-sessions/:sessionId/crm-sync` to expose per-summary CRM sync state.
- Added `POST /organizations/:orgId/sandbox/live-sessions/:sessionId/crm-sync/:summaryId/retry` to queue retry attempts with deterministic retry timing and attempt counts.
- CRM sync diagnostics are derived from event metadata and expose only safe fields: code, message, retryable, and next step.
- Updated API, integrations, and feature-flow docs with the status/retry contract.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "CRM sync status"` failed with `404` before the status route existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "CRM sync status"` passed after implementation.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts` passed: 11 tests.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/memory/memory.controller.test.ts apps/api/src/integrations/integrations.controller.test.ts apps/api/src/telephony/telephony.controller.test.ts` passed: 4 files, 37 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build --workspace @zara/api` passed.
- `npm.cmd run test:run` passed: 39 files, 182 tests.

## Pending Work

- None for ISSUE-061 implementation.

## Risks And Edge Cases

- CRM outage is represented as a failed sync event with retryable diagnostics and a queued retry API. The actual downstream worker remains out of scope for this slice.
- Partial sync can be represented by provider-specific failure codes and next-step diagnostics; richer per-field sync detail should be added when the CRM worker exists.
- Retry requests are metadata-only and do not resolve credentials in the monitoring API.

## Decisions

- Priority: P1
- Labels: integrations, monitoring, tdd-required
- Handover docs are mandatory for every pass on this issue.
- CRM sync status is event-sourced from the post-call summary plus `post_call.crm_sync.*` events so monitor views and retry actions share the same session spine.
- Failure diagnostics are intentionally whitelisted to avoid leaking provider tokens or raw connector payloads.

## Next Recommended Step

Proceed to ISSUE-062 quality flags and improvement suggestions.
