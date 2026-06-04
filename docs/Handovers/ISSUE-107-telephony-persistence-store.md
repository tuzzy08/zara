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
- Added normalized telephony persistence tables to the shared Postgres schema for connections, numbers, health checks, provider heartbeats, dispatches, execution sessions, execution commands, webhook events, webhook replay IDs, call-control events, and encrypted credential envelopes.
- Implemented a Postgres telephony state repository that persists and hydrates tenant-scoped telephony state outside process memory.
- Persisted connections, imported numbers, saved routes, dispatch history, provider heartbeats, webhook events, webhook replay IDs, execution sessions, and execution commands in the Postgres-backed system of record.
- Fixed webhook verification after restart by loading persisted tenant telephony state on demand instead of requiring pre-warmed in-memory state.
- Extended persisted state to include provider heartbeats, execution sessions, and provider-native execution command history.
- Added safe degraded recovery when persisted credential envelopes cannot be decrypted.
- Added schema and repository coverage for the Postgres-backed telephony state round trip.
- Follow-up on 2026-06-04: added a Coolify one-shot `migrate` service that runs `npm run db:migrate` before the API starts, preventing deployed schema drift such as missing `telephony_phone_numbers.live_route` during Twilio number import.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/telephony/telephony-env.test.ts`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build`
- RED: `npm.cmd run test:run -- apps/api/src/production-dockerfile.test.ts -t "runs database migrations"` failed before `compose.coolify.yml` included the migration service.
- GREEN: `npm.cmd run test:run -- apps/api/src/production-dockerfile.test.ts -t "runs database migrations"`
- GREEN: `npm.cmd run test:run -- apps/api/src/production-dockerfile.test.ts apps/web/src/telephonyCallsPageModel.test.ts apps/web/src/integrationProviderBranding.test.ts`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`

## Pending Work

- None for issue completion.

## Risks And Edge Cases

- Missing tenant telephony rows on first boot
- Duplicate webhook arrives after restart
- Persisted credential envelope cannot be decrypted after key change
- Scheduled heartbeat writes race with a manual operator action
- Transactional save is interrupted and retries must preserve tenant isolation
- Existing Coolify deployments that predate the migration service need a redeploy or one-time `npm run db:migrate` from the API image before importing phone numbers.

## Decisions

- Priority: P0
- Labels: backend, telephony, security, tdd-required
- This issue is the hardening gate before more telephony breadth.
- Used normalized Postgres telephony tables as the durable system of record so telephony survives restart with transaction-safe writes.
- The repository ensures a tenant shell exists before writing child rows so first boot and replay paths stay deterministic.
- Durable telephony state now preserves enough operator context to resume after restart instead of losing heartbeats, routing, or execution posture.
- The file-backed repository remains available for isolated tests, while production wiring resolves through the Postgres repository token.
- Production Compose must treat schema migrations as an API startup prerequisite rather than a purely manual operator step.

## Next Recommended Step

Issue complete. Continue with the next product slice from the roadmap using the Postgres-backed telephony contract as the baseline.
