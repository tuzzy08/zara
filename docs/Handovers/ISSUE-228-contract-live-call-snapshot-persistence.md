# ISSUE-228: Contract live-call snapshot persistence

- Status: Implemented
- External: [Linear ZAR-230](https://linear.app/zara-voice/issue/ZAR-230/pstn-capacity-712-contract-whole-tenant-persistence-out-of-the-live)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Work Completed

- Contracted inbound and outbound dispatch, Twilio webhook replay, call setup, media authorization, phone-test projection/checkpoints, call controls, lifecycle and policy transitions, status callbacks, handoff, fallback, and termination onto tenant-and-call scoped incremental repository methods.
- Removed runtime-row replacement from the Postgres snapshot repository. The remaining queue and method are explicitly configuration-only.
- Added atomic connection, imported-number, and retention deletion operations with tenant isolation and dependent-row handling.
- Added tenant-composite identities for execution commands and call-control events, plus migration `0011_telephony_tenant_composite_identities.sql` and its guarded rollback.
- Removed the obsolete processed-webhook fallback table through migration `0012_superb_stellaris.sql` and added an executable rollback.
- Added pool acquisition, transaction duration, row-lock wait, deadlock, and accepted-retry observability without making exporter failure fatal.
- Fixed isolated inbound projection commit so unauthorized or expired phone-test attempts that fall back to a live route return the durable phone-test result rather than stale state.
- Added dependency guards preventing live-call entry points from invoking snapshot persistence or restoring legacy token/webhook fallback state.
- Qualified 50 concurrent calls for one tenant plus 10 concurrent calls for another tenant against real Postgres, including identity isolation, monotonic terminal lifecycle, idempotent replay, and number/checkpoint cascade.

## Tests Run

- Real Postgres incremental repository: 13 passed, including 50 same-tenant plus 10 cross-tenant calls.
- Real migration application: migrations `0011` and `0012` applied successfully.
- Real rollback application: rollback scripts for `0012` then `0011` applied successfully with `ON_ERROR_STOP=1`.
- Focused persistence and schema suite: 77 passed.
- Incremental repository, inbound, and persistence regression suite after final review: 49 passed.
- Telephony suite: 175 passed and 13 real-Postgres tests skipped in the non-DB run; one auth test exceeded the machine-constrained default five-second timeout and passed alone with a 30-second ceiling.
- Telephony controller suite: 22 passed.
- API TypeScript check: passed with `tsc -p apps/api/tsconfig.json`.
- Focused ESLint pass: passed after removing unused helper bindings.
- Drizzle generation: no unexplained schema drift after migration generation.

## Pending Work

- None for ZAR-230.

## Risks

- The worktree contains unrelated user-owned frontend, design, audit, and generated changes; this issue must not modify or commit them.
- The legacy snapshot repository still serves configuration workflows and cannot be removed wholesale.
- The full serial telephony run is sensitive to local machine pressure; its only timeout passed on an isolated rerun and did not expose a behavioral failure.
- This qualification proves persistence correctness at the tested concurrency. It does not certify end-to-end media capacity, CPU headroom, provider quotas, or a production admission limit.

## Decisions

- No dual-write or snapshot fallback is allowed on a migrated live-call path.
- Database rows, uniqueness constraints, transactions, and compare-and-swap transitions are the concurrency authority.
- In-memory state may remain a read projection for the current process but is not durable authority for active-call mutations.
- `telephony_webhook_events` is the single durable webhook deduplication authority.
- Retry counters attach to the accepted transaction so compare-and-swap rollback attempts do not inflate the metric.

## Next Recommended Step

Deploy migrations `0011` and `0012` in order, monitor the new database contention metrics, and retain both rollback scripts with the release artifact.
