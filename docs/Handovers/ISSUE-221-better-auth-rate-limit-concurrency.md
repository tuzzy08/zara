# ISSUE-221: Better Auth rate-limit concurrency

Status: Implemented
Date: 2026-07-17
External: [Linear ZAR-221](https://linear.app/zara-voice/issue/ZAR-221/issue-221-make-better-auth-database-rate-limiting-concurrency-safe)

## Work Completed

- Diagnosed Better Auth 1.6.10 database rate limiting as a read-then-create/update sequence that can emit swallowed Postgres `23505` errors and lose concurrent increments.
- Kept the existing unique key and schema intact; no migration or reduced uniqueness was required.
- Added production-only Postgres custom rate-limit storage while leaving Better Auth's test/development memory-storage policy unchanged.
- Replaced non-atomic writes with one `INSERT ... ON CONFLICT DO UPDATE` operation.
- Used the existing row `id` as a window-generation token so exactly one stale writer resets an expired bucket while concurrent stale writers increment the new generation.
- Kept `lastRequest` monotonic so an older delayed write cannot move the active window backward.

## Tests Run

- RED reproduced concurrent duplicate first writes, stale active-window increments, repeated expired-window resets, and backward timestamp movement.
- GREEN Postgres storage tests passed: 4 tests covering concurrent first insert, active increment, expired generation reset, and monotonic timestamps.
- Better Auth database selection and runtime-security tests passed: 6 tests.
- Combined premium runtime/auth regression passed: 6 files and 76 tests.
- `npm.cmd run typecheck --workspace @zara/api` passed.
- Focused ESLint passed for the changed auth and runtime files.
- `npm.cmd run db:check` passed with no schema changes or migration drift.
- `npm.cmd run eval:pstn` passed all 25 deterministic PSTN scenarios.

## Pending Work

- No repository acceptance work remains. Deploy and confirm concurrent `/get-session` traffic no longer logs `auth_rate_limit_key_unique_idx` violations.

## Risks

- Better Auth performs admission before response-time counting, so a perfectly simultaneous burst can pass admission before all counters are committed. This change fixes durable accounting and database races; strict linearizable admission would require a request-time limiter outside the current storage callback contract.
- The custom storage relies on Better Auth preserving extra database fields from `get()` when it spreads the value into `set()`. That behavior is verified against the installed 1.6.10 implementation and must be rechecked during Better Auth upgrades.
- Existing unrelated working-tree changes must not be staged, reverted, or folded into this issue.

## Decisions

- Preserve the unique `key` index; duplicate rows would weaken rate-limit enforcement.
- Use the existing row ID as the bucket generation instead of adding schema or duplicating provider-specific rate-limit windows in Zara.
- Install custom storage only when production policy selects database rate limiting; memory-backed tests and local development behavior remain unchanged.

## Next Recommended Step

Deploy the completed slice, generate concurrent authenticated session reads, and confirm one row advances without `23505` errors, lost increments, repeated resets, or backward `lastRequest` movement.
