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

## Tests Run

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

## Pending Work

- None for ISSUE-227.

## Risks

- The legacy snapshot repository remains for non-migrated telephony management paths, but it can no longer overwrite rows owned by this incremental lifecycle.

## Decisions

- Do not retain snapshot fallbacks for migrated live-call paths.
- Keep raw media credentials, caller content, and audio out of persistence and diagnostics.
- Enforce tenant and call ownership in the repository operation that performs each mutation.
- Treat lifecycle state as the durable execution authority; business status remains a separate projection.
- Use provider-owned stop/close signals as classified terminal inputs and never infer successful completion from application shutdown or abnormal socket closure.
- Scope checkpoint idempotency to a call, not to a reusable waiting session.

## Next Recommended Step

Keep the real-PostgreSQL gate enabled in CI, then continue the capacity program with post-migration load qualification.
