# ISSUE-227: Incremental active-call lifecycle and checkpoints

- Status: Implemented
- External: [Linear ZAR-229](https://linear.app/zara-voice/issue/ZAR-229/pstn-capacity-612-migrate-active-call-lifecycle-and-checkpoint)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Work Completed

- Moved media authorization to an atomic durable token claim that survives process restart and rejects expired, reused, mismatched, cross-tenant, and terminal-session claims.
- Added versioned row-owned call lifecycle persistence with a constrained transition graph, terminal-state protection, duplicate/reordered event handling, and bounded compare-and-swap contention retries.
- Migrated Twilio media, status callbacks, premium provider readiness, handoff, shutdown, and failure paths to the durable lifecycle contract.
- Made premium execution restart-safe by loading its dispatch, workflow, runtime, and workspace context from the incremental repository.
- Removed competing premium terminal writers: Twilio stop owns clean completion, while abnormal socket closure and application shutdown fail the call exactly once.
- Persisted phone-test checkpoints independently and idempotently per call, with nonblocking bounded retry from premium provider events.
- Protected incrementally managed calls, lifecycle versions, media tokens, checkpoints, numbers, dispatches, and parent connections from stale whole-tenant snapshot replacement.
- Added migration 0010 for lifecycle backfill and per-call checkpoint uniqueness; legacy `terminated` and `blocked` sessions backfill as failed.
- Corrected the real-PostgreSQL token-rotation fixture so concurrent retries reuse the exact durable setup and vary only token fields.
- Remediated the post-implementation review findings without changing the public Twilio contract:
  - a WebSocket close code of `1000` is classified as failed unless a validated Twilio `stop` event was received;
  - premium startup cancellation now preserves its requested completed/failed outcome, persists the terminal lifecycle before returning, and records the same capacity outcome;
  - provider cleanup cannot prevent that terminal write if a provider close adapter throws;
  - application shutdown awaits both sandwich lifecycle persistence and premium runtime termination before the Redis admission backend is destroyed;
  - rollback `0010` restores waiting-session checkpoint uniqueness and removes `lifecycle_state` before rollback `0009`;
  - migration CI now verifies a legacy execution-session insert after both rollbacks.
- Closed the final lifecycle review gaps:
  - a durable call setup that later fails checkpoint or projection persistence is terminalized as failed instead of remaining `ringing`;
  - premium startup cancellation waits for startup completion before shutdown returns;
  - bridge shutdown surfaces runtime termination failures after closing both sockets instead of silently discarding them;
  - signed media authorization carries the exact verified Twilio account SID, and stream startup rejects a mismatched provider account.
- Closed the staged-review lifecycle findings:
  - terminal persistence failure no longer releases admission before the durable terminal transition succeeds;
  - application shutdown waits for queued media authorization before classifying and persisting the terminal outcome;
  - ordinary WebSocket close terminalization is tracked, logged safely, and surfaced during shutdown instead of becoming an unhandled or discarded promise;
  - a missing Twilio start `AccountSid` now fails closed just like a mismatched account;
  - shutdown-owned terminalization is idempotent with the subsequent socket-close callback.
- Closed the final staged-review lifecycle findings:
  - premium terminal lifecycle persistence now remains owned and retryable through `stop()` and application shutdown, including failures before provider execution installation;
  - premium capacity and admission are released exactly once and only after the terminal lifecycle is durable;
  - completed Twilio event histories are globally bounded while active-call histories remain available;
  - failed sandwich terminal persistence remains bounded and owned, retries automatically with capped backoff during normal operation, retries immediately during shutdown, and ends capacity exactly once after durable success.
  - one telephony shutdown lifecycle now drains media, retries premium terminal durability, drains admission releases, and tears down Redis in order; an earlier stage failure is recorded without preventing later cleanup.

## Tests Run

- RED:
  - `npm.cmd exec -- vitest run apps/api/src/telephony/twilio-media-streams.websocket.test.ts apps/api/src/telephony/pstn-premium-call-execution.test.ts apps/api/src/database/schema.test.ts`
    - Failed because startup cancellation persisted no terminal lifecycle and rollback `0010` did not exist.
    - The WebSocket suite was initially blocked by the isolated worktree dependency layout.
  - `npm.cmd exec -- vitest run apps/api/src/telephony/twilio-media-streams.websocket.test.ts -t "code 1000 arrives without a validated Twilio stop"`
    - Failed as expected: received `completed` / `twilio_media_socket_closed_clean` instead of `failed` / `twilio_media_socket_closed_without_stop`.
  - `npm.cmd exec -- vitest run apps/api/src/telephony/pstn-premium-call-execution.test.ts -t "Twilio closes during provider startup"`
    - Failed as expected when provider close threw before lifecycle persistence.
  - `npm.cmd exec -- vitest run apps/api/src/telephony/twilio-media-streams.websocket.test.ts -t "durably terminates an active premium call before application shutdown clears it"`
    - Failed as expected because the shutdown hook closed the WebSocket without awaiting premium termination.
- GREEN/REFACTOR:
  - `npm.cmd exec -- vitest run apps/api/src/telephony/twilio-media-streams.websocket.test.ts apps/api/src/telephony/pstn-premium-call-execution.test.ts apps/api/src/database/schema.test.ts`
    - 3 files passed; 57 tests passed.
  - `npm.cmd run typecheck --workspace=@zara/api`
    - Passed.
  - `npm.cmd exec -- eslint apps/api/src/telephony/twilio-media-streams.websocket-bridge.ts apps/api/src/telephony/twilio-media-streams.websocket.test.ts apps/api/src/telephony/pstn-premium-call-execution.ts apps/api/src/telephony/pstn-premium-call-execution.test.ts apps/api/src/database/schema.test.ts`
    - Passed.
  - `npm.cmd run db:check`
    - Passed; generated schema remained unchanged.
  - Applied migrations to disposable `pgvector/pgvector:pg16`, executed rollback `0010` before rollback `0009`, and performed the legacy execution-session insert.
    - `lifecycle_state=false`, `version=false`, `legacy_insert_count=1`.
  - Scoped `git diff --check` passed.
- Final shutdown remediation:
  - The focused premium shutdown regression passed after the bridge began awaiting `PstnPremiumCallExecution.stop`.
  - The six-file lifecycle, persistence, observability, and WebSocket regression suite passed 90 tests.
- Code review:
  - Standards axis: no remaining findings after consolidating duplicate WebSocket close-test setup.
  - Specification axis: no remaining findings after proving provider-close failure cannot prevent startup-cancellation lifecycle persistence.
- Integrated remediation qualification:
  - 18 changed-surface files passed; 258 tests passed, including lifecycle, phone-test projection, admission release, controller, premium execution, and Twilio WebSocket paths.
  - Two calls sharing one waiting session retain four distinct call-owned checkpoints.
  - Real PostgreSQL qualification passed 20 migration and concurrent repository cases.
- Original implementation evidence:
- `npm.cmd exec -- vitest run apps/api/src/telephony packages/core/src/telephony.test.ts apps/api/src/database/schema.test.ts apps/api/src/security/one-time-stream-token.test.ts`
  - 21 files passed against migrated PostgreSQL 16 with pgvector.
  - 206 tests passed with no skips.
- `npm.cmd exec -- vitest run apps/api/src/telephony/postgres-telephony-incremental.repository.postgres.test.ts`
  - 10 real-PostgreSQL integration tests passed.
- `npm.cmd run typecheck:core`
- `npm.cmd run typecheck --workspace=@zara/api`
- Focused ESLint across all changed Core, API schema, security, repository, service, premium execution, and WebSocket files.
- `npm.cmd run db:generate` reported no schema changes.
- Scoped `git diff --check` passed.
- Final integrated review-remediation qualification:
  - the 20-file changed surface passed 278 tests against real Redis 7 and PostgreSQL 16 with pgvector;
  - the focused file-backed persistence suite passed 9 tests after its incremental-repository fixture was aligned with production ownership;
  - API TypeScript, three focused ESLint batches, `git diff --check`, and Drizzle generation passed;
  - Drizzle reported no schema changes.
- Staged-review remediation qualification:
  - the complete 28-file telephony suite contributed 351 tests to a 31-file, 387-test qualification with real Redis 7 and PostgreSQL 16 enabled;
  - the combined incremental repository, inbound lifecycle, and Twilio WebSocket suite passed 75 tests;
  - focused WebSocket RED/GREEN coverage proves queued-authorization shutdown ordering, required Twilio account identity, tracked ordinary-close terminalization failure, and single-report shutdown failure semantics;
  - API TypeScript, focused ESLint, and `git diff --check` passed.
- Final staged-review finding remediation:
  - premium execution and Twilio WebSocket suites passed together after terminal persistence became retryable and completed event history became bounded;
  - RED/GREEN coverage proves failed terminal persistence does not release capacity, pre-install failures retry through the production stop/shutdown path, and unknown call IDs remain strict errors;
  - bridge RED/GREEN coverage proves failed sandwich terminal persistence retries during normal operation and shutdown without duplicate capacity completion;
  - shutdown now includes terminal persistence failures first observed while active sandwich attachments are draining, retries them explicitly, and reports only failures that remain unresolved after that retry;
  - root TypeScript, focused ESLint, Drizzle schema verification, and `git diff --check` passed.
- Final shutdown-owner remediation:
  - the application-close RED regression failed because a remembered premium terminal-write error aborted Nest before the premium retry and admission cleanup;
  - the ordered shutdown lifecycle, premium, bridge, and admission suites passed 69 tests after one lifecycle became the failure-containing shutdown owner;
  - the 31-file qualification passed all 387 tests; two PostgreSQL timeout cases and one Redis command timeout from an immediate redundant pressure run passed when rerun in isolation.

## Pending Work

- Run the exact migration-check GitHub Actions job after integration.

## Risks

- The legacy snapshot repository remains for non-migrated telephony management paths, but it can no longer overwrite rows owned by this incremental lifecycle.
- Rollback `0010` intentionally fails its duplicate preflight if current per-call checkpoints cannot satisfy the older waiting-session uniqueness contract.
- The exact GitHub Actions job was not run locally; its migration, rollback, and legacy-insert SQL was exercised against disposable PostgreSQL 16.

## Decisions

- Do not retain snapshot fallbacks for migrated live-call paths.
- Keep raw media credentials, caller content, and audio out of persistence and diagnostics.
- Enforce tenant and call ownership in the repository operation that performs each mutation.
- Treat lifecycle state as the durable execution authority; business status remains a separate projection.
- Use provider-owned stop/close signals as classified terminal inputs and never infer successful completion from application shutdown or abnormal socket closure.
- Treat WebSocket close code `1000` as transport metadata only; validated Twilio `stop` is the sole clean-completion signal.
- Preserve the terminal outcome and reason while premium provider startup is pending instead of inferring completion after connection.
- Persist startup cancellation before provider cleanup and contain provider-close failures.
- Scope checkpoint idempotency to a call, not to a reusable waiting session.

## Next Recommended Step

Run migration-check CI after integration, then continue the capacity program with post-migration load qualification.
