# ISSUE-107: Telephony persistence store

Issue link: https://github.com/tuzzy08/zara/issues/107

## Goal

Deliver durable telephony state so connection, routing, webhook, and dispatch control-plane data survive API restarts.

## Acceptance Criteria

- Telephony connections, imported numbers, saved routes, dispatch history, and webhook dedupe state survive API restarts
- Persisted telephony state remains tenant scoped and reload-safe
- The persistence layer tolerates first boot, missing state, and partial-write recovery paths without leaking raw secrets

## Work Completed

- Added ISSUE-103 to the local backlog, roadmap, and `docs/issues.json` so telephony hardening is explicit before more provider expansion work.
- Implemented a durable telephony snapshot repository that stores tenant telephony state outside process memory.
- Persisted connections, imported numbers, saved routes, dispatch history, webhook events, and webhook replay IDs.
- Added corrupt-snapshot quarantine and first-boot recovery behavior.
- Fixed webhook verification after restart by loading persisted tenant telephony state on demand instead of requiring pre-warmed in-memory state.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build`

## Pending Work

- Normalize telephony persistence into the broader Postgres system of record instead of the current local durable snapshot adapter.
- Add migration tooling for existing encrypted snapshots if the repository backend changes.
- Add scheduled provider heartbeat persistence and more explicit replay retention policies.

## Risks And Edge Cases

- Missing telephony snapshot on first boot
- Duplicate webhook arrives after restart
- Persisted snapshot is truncated or corrupted

## Decisions

- Priority: P0
- Labels: backend, telephony, security, tdd-required
- This issue is the hardening gate before more telephony breadth.
- Used a local durable snapshot repository as the immediate hardening step so telephony survives restart without forcing the entire repo onto a live Postgres dependency during local development.
- Snapshot writes are done through a temporary file + rename pattern to reduce partial-write risk.

## Next Recommended Step

Proceed with platform-managed telephony, SIP, and outbound work now that telephony no longer depends on process-local state alone.
