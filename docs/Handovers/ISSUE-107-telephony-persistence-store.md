# ISSUE-107: Telephony persistence store

Issue link: https://github.com/tuzzy08/zara/issues/107

## Goal

Deliver durable telephony state so connection, routing, webhook, dispatch, heartbeat, and execution-session control-plane data survive API restarts.

## Acceptance Criteria

- Telephony connections, imported numbers, saved routes, dispatch history, provider heartbeats, execution sessions, and webhook dedupe state survive API restarts
- Persisted telephony state remains tenant scoped and reload-safe
- The persistence layer tolerates first boot, missing state, and partial-write recovery paths without leaking raw secrets

## Work Completed

- Added ISSUE-107 to the local backlog, roadmap, and `docs/issues.json` so telephony hardening is explicit before more provider expansion work.
- Implemented a durable telephony snapshot repository that stores tenant telephony state outside process memory.
- Persisted connections, imported numbers, saved routes, dispatch history, webhook events, and webhook replay IDs.
- Added corrupt-snapshot quarantine and first-boot recovery behavior.
- Fixed webhook verification after restart by loading persisted tenant telephony state on demand instead of requiring pre-warmed in-memory state.
- Extended persisted state to include provider heartbeats and execution sessions.
- Added safe degraded recovery when persisted credential envelopes cannot be decrypted.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/telephony/telephony-env.test.ts`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build`

## Pending Work

- Normalize telephony persistence into the broader Postgres system of record instead of the current local durable snapshot adapter.
- Add migration tooling for existing encrypted snapshots if the repository backend changes.
- Add replay-retention and archival policies once event volumes outgrow the local snapshot profile.

## Risks And Edge Cases

- Missing telephony snapshot on first boot
- Duplicate webhook arrives after restart
- Persisted snapshot is truncated or corrupted
- Persisted envelope cannot be decrypted after key change
- Scheduled heartbeat writes race with a manual operator action

## Decisions

- Priority: P0
- Labels: backend, telephony, security, tdd-required
- This issue is the hardening gate before more telephony breadth.
- Used a local durable snapshot repository as the immediate hardening step so telephony survives restart without forcing the entire repo onto a live Postgres dependency during local development.
- Snapshot writes are done through a temporary file + rename pattern to reduce partial-write risk.
- Durable telephony state now preserves enough operator context to resume after restart instead of losing heartbeats and execution posture.

## Next Recommended Step

Move the durable telephony state into Postgres when the repo is ready for broader production persistence, but keep the current snapshot contract as the compatibility layer for local development.
