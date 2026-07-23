# ISSUE-226: Incremental inbound webhook and call setup

- Status: In Progress
- External: [Linear ZAR-228](https://linear.app/zara-voice/issue/ZAR-228/pstn-capacity-512-migrate-inbound-webhook-dispatch-and-media-token)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Work Completed

- Made `TelephonyIncrementalRepository` a required Nest dependency and added a standalone idempotent blocked-dispatch insert.
- Migrated verified Twilio webhook events to row-owned idempotent persistence and retained the authoritative first-receipt timestamp for retries.
- Migrated routed inbound setup to one transaction covering dispatch, execution session, and hashed one-time media credential before Connect Stream TwiML can be returned.
- Preserved route resolution and non-live manual dispatch behavior while removing whole-tenant snapshot saves from the synchronous Twilio answer path.
- Added deterministic token regeneration for duplicate webhook delivery without storing or logging raw credentials. Expired, claimed, conflicting, and progressed-session retries return safe unavailable TwiML.
- Isolated webhook call preparation from shared cached state so failed or incomplete setup cannot leak into a concurrent snapshot save. Successful setup is projected into the current process only after durable writes complete.
- Locked owned connection and phone-number references during dispatch/setup transactions and added a real-Postgres deletion-race test.
- Persisted protected phone-test admission checkpoints before Connect and blocked Connect when checkpoint persistence fails.
- Added stable diagnostic reason codes for webhook, dispatch, setup, token-expiry, and phone-test checkpoint persistence failures.
- Required an explicit production stream-token secret through `ZARA_STREAM_TOKEN_SECRET` or `BETTER_AUTH_SECRET`; development and tests retain an ephemeral fallback.
- Added deterministic four-worker burst evidence and a 1,000 ms webhook p95 SLO to the PSTN load report.

## Tests Run

- RED: incremental inbound tests failed on snapshot writes, duplicate busy behavior, missing blocked dispatch persistence, and Connect returned after setup failure.
- RED: concurrent duplicate tests failed because retries produced different raw credentials.
- RED: expired/claimed retry, production secret, phone-test checkpoint, shared-state isolation, progressed-session retry, and concurrent-burst SLO tests failed before their production changes.
- `npm.cmd exec -- vitest run apps/api/src/security/one-time-stream-token.test.ts apps/api/src/telephony/telephony-inbound-incremental.test.ts apps/api/src/telephony/postgres-telephony-incremental.repository.test.ts apps/api/src/telephony/postgres-telephony-incremental.repository.postgres.test.ts apps/api/src/telephony/telephony.persistence.test.ts apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/twilio-media-streams.websocket.test.ts apps/pstn-protocol-simulator/src/load-runner.test.ts` -> 70 passed, 10 skipped.
- `npm.cmd exec -- vitest run apps/pstn-protocol-simulator/src` -> 66 passed.
- `npm.cmd run eval:pstn` -> 25 passed.
- `npm.cmd run typecheck --workspace @zara/api` -> passed.
- `npm.cmd run typecheck --workspace @zara/pstn-protocol-simulator` -> passed.
- Scoped ESLint across all changed API and simulator source/test files -> passed.
- `npm.cmd run db:check` -> passed with no migration drift.
- Real PostgreSQL tests were collected but skipped because `ZARA_TEST_POSTGRES_URL` is unavailable locally.

## Pending Work

- Run the real PostgreSQL suite in CI with `ZARA_TEST_POSTGRES_URL`, including same-key retries, concurrent claims, cross-tenant isolation, rollback, and number-deletion races.
- Complete ZAR-229 before release so every media WebSocket authorizes and claims the durable token on any replica.
- Complete ZAR-230 before release so no live-call writer can replace incrementally committed rows through whole-tenant snapshot persistence.
- Migrate unauthorized-caller and expired waiting-session phone-test projections in ZAR-229/ZAR-230; their blocked dispatch is durable here, but the legacy phone-number projection remains snapshot-owned.

## Risks

- ZAR-229 is a release blocker: media authorization still reads and claims through the cached snapshot authority, so a WebSocket landing on another replica can reject a valid incrementally created setup.
- ZAR-230 is a release blocker: remaining live-call snapshot writers can still replace row-owned records until removed.
- This commit must not deploy independently from ZAR-229 and ZAR-230.
- Non-live manual dispatch and telephony management must remain on their current behavior in this slice.

## Decisions

- Do not dual-write snapshot and incremental persistence on the live Twilio answer path.
- Do not store or log raw media tokens; only the fixed SHA-256 base64url hash is durable.
- Derive a stable signed token from the durable first-receipt timestamp and call identity so an exact unclaimed retry can reproduce the usable credential without retaining raw token material.
- Reject retries after token claim, expiry, or execution-session progression; only an unchanged initial setup may return the established Connect outcome.
- Use row locks for ownership validation so concurrent provider-number deletion resolves before setup insertion.
- A durable event conflict or call-setup failure returns caller-safe unavailable TwiML and a stable operator diagnostic reason code.

## Next Recommended Step

Run the real-Postgres CI gate, then implement ZAR-229's durable media authorization, token claim, lifecycle transitions, status callbacks, and negative phone-test outcomes before the coordinated release.
