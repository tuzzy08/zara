# ISSUE-139: LangSmith Vitest runtime eval fixture harness

Status: Implemented
Date: 2026-05-27
External: [Linear ZAR-72](https://linear.app/zara-voice/issue/ZAR-72/issue-139-langsmith-vitest-runtime-eval-fixture-harness)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Documented the eval fixture, dataset, evaluator, and execution standards in `docs/Observability-And-Evals-Standard.md`.
- Linked eval expectations from `docs/Testing-Strategy.md` and `docs/Roadmap.md`.
- Added versioned packet and manifest projection fixtures for `zara.intent-routing.v1`, `zara.toolbelt.v1`, `zara.transfer.v1`, `zara.policy-guards.v1`, and `zara.end-to-end-call.v1`.
- Added deterministic scorecards for exact intent, route target, fallback behavior, assigned-tool-only behavior, missing-input behavior, transfer context, policy warnings, and redaction safety.
- Added openevals LLM-as-judge evaluator plans for transfer-context acknowledgement, safe tool-output summarization, missing-input questions, and role/policy adherence.
- Added `apps/api/src/runtime-evals/runtime.eval.ts`, `ls.vitest.config.ts`, and the `npm run eval:runtime` script so evals run separately from normal Vitest suites and dry-run without LangSmith credentials.
- Updated observability, security, testing, feature-flow, roadmap, and backlog docs to match the implemented eval baseline.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/runtime-evals/runtime-evals.test.ts`
- `npm.cmd run eval:runtime`
- `npm.cmd run test:run -- apps/api/src/runtime-observability/runtime-observability.test.ts apps/api/src/runtime-evals/runtime-evals.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-139.
- ISSUE-140 remains for CI thresholds, release gates, and dashboard surfacing.

## Risks

- LLM-as-judge evaluators are configured as wrappers but should only be enforced after ISSUE-140 defines thresholds and release-owner review.
- LangSmith uploads depend on environment credentials; local dry-run is the default and remains supported.

## Decisions

- Ordinary Vitest tests remain separate from LangSmith evals.
- Packet fixtures are the canonical eval input shape.
- LLM-as-judge evals are reserved for behavior that exact assertions cannot reliably score.
- Synthetic fixtures are the baseline; production traces must be redacted into the same projection shape before any future online eval sampling.

## Next Recommended Step

- Move to ISSUE-140 for eval regression gates and AI observability dashboards.
