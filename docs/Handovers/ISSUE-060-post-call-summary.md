# ISSUE-060: Post-call summary

External: [GitHub #60](https://github.com/tuzzy08/zara/issues/60)

Issue link: https://github.com/tuzzy08/zara/issues/60

## Goal

Deliver Post-call summary for the Runtime area in the Monitoring milestone.

## Acceptance Criteria

- Summary includes outcome, action items, and disposition
- Summary sync can target CRM
- Sensitive content is redacted

## Work Completed

- Added an integration-style controller test for `POST /organizations/:orgId/sandbox/live-sessions/:sessionId/summary` that drives a live sandbox event history through the public API and verifies the generated summary contract.
- Implemented post-call summary creation on live sandbox sessions with inferred outcome, disposition, open action items, optional CRM sync target queueing, and `post_call.summary.created` event emission.
- Added transcript/tool-output redaction for emails, payment-card-like numbers, phone numbers, secret references, and credential keywords before summary text is returned.
- Documented the summary route and response contract in `docs/API.md`, plus monitoring and CRM sync behavior in `docs/Feature-Flows.md` and `docs/Integrations.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "post-call summary"` failed with `404` before the route existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "post-call summary"` passed after implementation.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts` passed: 8 tests.
- `npm.cmd run test:run -- apps/api/src/app.module.test.ts` passed: 1 test.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build --workspace @zara/api` passed.
- `npm.cmd run test:run` passed: 39 test files, 176 tests.

## Pending Work

- None for ISSUE-060 implementation.
- Future CRM worker delivery remains out of scope for this issue; this slice queues and exposes the sync target contract only.

## Risks And Edge Cases

- Long transcripts are truncated before summary text is built so the response stays bounded; future persistence should keep the same limit or move truncation into a shared summarization boundary.
- Summary hallucination risk is reduced by deriving the current implementation from recorded event text and deterministic heuristics rather than an LLM, but richer summaries will need source-citation or grounding controls before model generation is introduced.
- CRM sync currently records queued intent only. A downstream connector worker must preserve the same redaction and credential-isolation guarantees when it performs the actual provider write.

## Decisions

- Priority: P1
- Labels: runtime, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Summary outcome is inferred from terminal/escalation events, while disposition and action items are inferred from redacted event text.
- CRM sync responses expose target metadata and queue status only; they do not expose OAuth tokens or provider secrets.

## Next Recommended Step

Move to ISSUE-061 CRM sync status.
