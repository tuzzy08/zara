# ISSUE-107: Telephony persistence store

External: [GitHub #107](https://github.com/tuzzy08/zara/issues/107)

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
- Follow-up on 2026-07-14: added the missing executable `policy_state` forward migration for `telephony_execution_sessions`; the column had previously existed only in the TypeScript schema and Drizzle snapshot.
- Made inbound dispatch IDs derive from Twilio's unique `CallSid` for every route outcome, preventing repeated blocked or unavailable calls to the same number from colliding on `telephony_dispatches_pkey`.
- Fixed connection deletion to remove connection-owned execution sessions, execution commands, webhook events, and media-stream tokens before persisting the remaining tenant state, matching the Postgres cascade ownership model.

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
- RED: `npx.cmd vitest run --maxWorkers=1 apps/api/src/database/schema.test.ts apps/api/src/telephony/telephony.controller.test.ts` failed because the executable `policy_state` migration was absent and blocked inbound dispatch IDs reused the phone-number ID.
- GREEN: `npx.cmd vitest run --maxWorkers=1 apps/api/src/database/schema.test.ts apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/postgres-telephony-state.repository.test.ts apps/api/src/production-dockerfile.test.ts` (42 tests).
- Verification: `npm.cmd run db:generate` reported no schema changes after the forward migration was added.
- Verification: `npm.cmd run lint`.
- Verification: `npm.cmd run typecheck`.
- RED: `npx.cmd vitest run --maxWorkers=1 apps/api/src/telephony/telephony.persistence.test.ts -t "removes connection-owned execution and webhook state"` failed because deleted connections retained execution-session children.
- GREEN: `npx.cmd vitest run --maxWorkers=1 apps/api/src/telephony/telephony.persistence.test.ts apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/postgres-telephony-state.repository.test.ts` (33 tests).

## Pending Work

- Redeploy the Coolify Compose application so the one-shot `migrate` service applies `0008_telephony_execution_policy_state.sql` before the API restarts.
- Repeat one Phone test call and confirm the webhook reaches TwiML/media execution without `policy_state` or dispatch primary-key errors.
- Delete and reconnect the existing Twilio integration once after redeploy to confirm no connection-child foreign-key error remains.

## Risks And Edge Cases

- Missing tenant telephony rows on first boot
- Duplicate webhook arrives after restart
- Persisted credential envelope cannot be decrypted after key change
- Scheduled heartbeat writes race with a manual operator action
- Transactional save is interrupted and retries must preserve tenant isolation
- Existing Coolify deployments that predate the migration service need a redeploy or one-time `npm run db:migrate` from the API image before importing phone numbers.
- A running API process that accumulated failed in-memory dispatches must restart after migration; the normal Coolify redeploy provides that reset while preserving committed Postgres state.

## Decisions

- Priority: P0
- Labels: backend, telephony, security, tdd-required
- This issue is the hardening gate before more telephony breadth.
- Used normalized Postgres telephony tables as the durable system of record so telephony survives restart with transaction-safe writes.
- The repository ensures a tenant shell exists before writing child rows so first boot and replay paths stay deterministic.
- Durable telephony state now preserves enough operator context to resume after restart instead of losing heartbeats, routing, or execution posture.
- The file-backed repository remains available for isolated tests, while production wiring resolves through the Postgres repository token.
- Production Compose must treat schema migrations as an API startup prerequisite rather than a purely manual operator step.
- Inbound dispatch identity is call-scoped from the provider `CallSid`, including blocked outcomes that do not create an execution session.
- Connection deletion retains non-FK dispatch and call-control audit history while removing all records whose lifecycle is owned by the deleted provider connection.

## Next Recommended Step

Redeploy through `compose.coolify.yml`, verify the migration service succeeds, then repeat the Phone test and inspect the Twilio webhook/media logs.
