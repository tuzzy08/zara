# ISSUE-229: Redis-backed PSTN call admission

- Status: Implemented
- External: [Linear ZAR-231](https://linear.app/zara-voice/issue/ZAR-231/pstn-capacity-812-enforce-redis-backed-call-admission-on-the-current)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Work Completed

- Confirmed the admission boundary is the signed inbound Twilio webhook after route resolution and before Connect Stream TwiML.
- Confirmed active media forwarding must not synchronously depend on Redis after admission.
- Selected atomic Redis-side reservation and CPS evaluation with bounded claim and active leases, duplicate-call idempotency, centralized terminal release, and low-cardinality telemetry.
- Added a production Redis 7 admission module with atomic global, provider, tenant, runtime, and worker concurrency checks plus global and provider-account token buckets.
- Added deterministic in-memory and real-Redis contract implementations covering duplicate webhook delivery, cross-process reserve/activate/release, destination-worker transfer, lease renewal, expiry, and fail-closed backend behavior.
- Reserved capacity before durable call setup and Twilio Connect Stream TwiML, then activated the lease when the authorized media stream started.
- Made reservation identity independent of worker identity so a webhook worker and media worker can safely share one call reservation across replicas.
- Added bounded Redis expiry for reservation hashes, concurrency sorted sets, and inactive CPS buckets.
- Preserved active media through its last Redis-confirmed lease deadline when Redis becomes unavailable, while failing new calls closed and surfacing backend readiness through `/health/ready`; media fails closed when fenced authority expires without renewal.
- Added provider-health input that respects the connection's `blockRoutingOnHealthFailure` policy and closes new-call admission without terminating active calls when that policy requires it.
- Added a platform-owned Twilio concurrent-call quota input through `PSTN_ADMISSION_TWILIO_QUOTA_MAX_CONCURRENT_CALLS`; admission clamps the configured provider limit to this allowance without inferring quota from balance, heartbeat, or unrelated provider signals.
- Released admission through the centralized durable lifecycle path for WebSocket, provider, policy, application-shutdown, phone-test expiry, and manual phone-test termination outcomes.
- Preserved duplicate-call ownership: a downstream setup failure releases only a reservation created by that webhook and never releases an existing active reservation.
- Preserved cross-replica ownership during shutdown: ingress and media coordinators clear only local renewal state and never release a lease that another replica may have activated.
- Prevented stale or invalid terminal observations from releasing a currently active admission; release now occurs only after durable terminal persistence or confirmed not-found terminal cleanup, and persistence failures keep admission active.
- Persisted sandwich application shutdown and premium admission-activation failure as terminal lifecycle outcomes before local WebSocket cleanup.
- Added one explicit telephony shutdown owner so active sandwich and premium calls finish terminal handling while Redis admission is available, pending releases drain next, and the Redis client is destroyed last.
- Bounded every configured concurrency limit to the Redis script's supported integer range; oversized production values now make readiness unavailable instead of admitting calls with an invalid script contract.
- Bounded lease, CPS rate, and CPS burst configuration to the Redis script contract; fractional or oversized production values now fail readiness instead of silently falling back.
- Removed the shared production worker identifier; each container now defaults to its own hostname.
- Added low-cardinality admission, lease, denial, and backend-health telemetry without caller content, audio, credentials, or unbounded reservation identifiers. Cross-replica activation and renewal recover the authorized provider, provider account, and runtime dimensions instead of reporting placeholder values.
- Preserved `not_owner` and `denied` as explicit lease telemetry outcomes instead of collapsing them to `unknown`.
- Bound admission recovery to the exact verified Twilio account SID carried by signed media authorization; the coordinator no longer reconstructs provider-account scope from a connection ID or placeholder fallback.
- Made premium startup and bridge shutdown await terminal handling while Redis remains available, and surfaced termination failures after socket cleanup.
- Stabilized the real-Redis recovery qualification with a realistic lease interval while retaining the production recovery-hold semantics.
- Corrected the PSTN runtime and telephony operations documentation to identify Redis admission as implemented, list the production admission controls and fail-closed posture, add ISSUE-229 to the implementation map, and state that retention removes only terminal call graphs older than the cutoff and never active calls.
- Replaced cached provider-health admission with a fresh tenant-scoped Postgres posture read immediately before Redis reservation. Missing or unreadable durable posture fails closed before reserve.
- Made health-check and provider-heartbeat identities collision-safe when multiple observations share the same timestamp.
- Kept admission active when terminal persistence fails, so capacity cannot be reused before the durable call reaches a terminal state.
- Prevented terminal Twilio webhook replays from consuming CPS or reserving admission again by consulting the durable call lifecycle before Redis; unreadable lifecycle state fails closed, while active duplicates continue to reuse the existing reservation.
- Failed-setup and concurrent webhook replays re-enter deterministic call setup, reuse the existing Redis reservation and CPS debit, and converge on the same durable Connect response and one-time stream token.
- Made malformed production lease renewal settings and unsafe TTL relationships fail readiness closed as `admission_config_invalid` without crashing Nest module construction; readiness preserves the specific unavailable configuration reason.
- Applied ownership-loss termination consistently to sandwich and premium media, including durable sandwich lifecycle failure before local cleanup.

## Tests Run

- RED:
  - `npm.cmd run test:run -- apps/api/src/telephony/pstn-admission-coordinator.test.ts apps/api/src/telephony/redis-pstn-call-admission.test.ts` failed 3 expected lease-recovery and cross-worker ownership cases before remediation.
  - `$env:ZARA_TEST_REDIS_URL='redis://127.0.0.1:6381'; npm.cmd run test:run -- apps/api/src/telephony/redis-pstn-call-admission.redis.test.ts` failed 2 expected real-Redis lease reconstruction/worker-transfer cases before remediation.
  - `npm.cmd run test:run -- apps/api/src/telephony/redis-pstn-call-admission.test.ts` then failed 3 expected distributed recovery-debt cases, proving a process-local guard could not close admission across replicas.
  - The real-Redis command above failed 1 expected two-client case before the distributed recovery-debt authority was added.
  - `npm.cmd run test:run -- apps/api/src/telephony/pstn-call-admission.test.ts apps/api/src/telephony/pstn-admission-coordinator.test.ts apps/api/src/telephony/in-memory-pstn-call-admission.test.ts apps/api/src/telephony/redis-pstn-call-admission.test.ts` failed 7 expected proactive-hold, worker-fencing, transfer, and test-double parity cases before remediation.
  - The real-Redis command above then failed 2 expected cases proving a peer could reserve between primary-lease expiry and owner reconstruction and that a former worker could renew after transfer.
  - `npm.cmd run test:run -- apps/api/src/telephony/in-memory-pstn-call-admission.test.ts` failed 4 expected cases before the in-memory adapter gained owner-fenced proactive recovery holds.
  - Redis unit and real-Redis tests each failed 1 final expected case before full activation without a prior claim or owner-matching recovery hold was rejected.
  - Focused service, coordinator, and configuration tests failed five new cases before remediation: duplicate setup released an existing reservation; stale terminal input released active admission; coordinator shutdown released cross-replica state; ingress shutdown released a media-activated lease; and a concurrency value above `1,000,000` passed readiness while violating the runtime admission validator.
  - Twilio WebSocket tests failed two new cases before remediation: sandwich shutdown cleared local attachments without a durable terminal transition, and premium admission activation failure closed the socket without recording its terminal lifecycle.
  - Configuration, quota, and telemetry tests failed six new cases before remediation: fractional CPS values were accepted, Twilio quota configuration and clamping were absent, cross-replica activation telemetry used unknown provider/runtime dimensions, and the bridge supplied no recovery metadata.
  - Service and checkpoint tests failed two new cases before remediation: a failed provider heartbeat denied routing despite a nonblocking connection policy, and two calls under one waiting session collapsed four call-owned checkpoints into two.
  - Real Redis coverage initially exposed three namespace-collision failures from overlong generated test prefixes; bounded prefixes restored dimension isolation without changing production keys.
  - The premium WebSocket shutdown regression failed because the bridge returned before premium termination, leaving lease release dependent on later shutdown-hook ordering.
- GREEN/REFACTOR admission unit and integration suite:
  - 18 files passed; 258 tests passed across lifecycle, persistence, admission, health, deployment, premium execution, controller, and Twilio WebSocket integration.
  - The full admission contract passed 95 tests across 10 files, including Redis/in-memory parity, worker-fenced renewal, destination-worker transfer, proactive recovery holds, shutdown ordering, and rejection of reservation-less reconstruction.
- Focused phone-test projection verification:
  - 2 files passed; 38 tests passed.
- Real Redis 7 qualification:
  - 1 file passed; 15 tests passed, including cross-client global, provider, tenant, runtime, and worker concurrency; provider-account CPS; proactive recovery holds that block before reconstruction; cross-worker ownership transfer and renewal fencing; release without a reservation hash; bounded owner-death expiry; rejection of reservation-less reconstruction; isolation; activation; release; and capacity reuse.
- Real PostgreSQL 16 with pgvector qualification:
  - 2 files passed; 20 tests passed for rolling migration compatibility, strict reverse-order rollback through `0011`, safe `0013` rollback, cross-replica abuse fencing, and concurrent incremental persistence.
- `npm.cmd run typecheck --workspace=@zara/api` passed.
- Focused ESLint across all changed API production and test files passed.
- `npm.cmd run db:migrate` applied the fresh migration chain through `0013`.
- `npm.cmd run db:generate` reported no schema changes.
- `git diff --check` passed.
- Final fencing consistency RED/GREEN: a sandwich ownership-loss event initially left media open; the focused premium/sandwich regression now closes both paths with `4409` and persists the terminal failure.
- Final integrated review-remediation qualification:
  - the 20-file changed surface passed 278 tests against real Redis 7 and PostgreSQL 16 with pgvector;
  - all 15 real-Redis admission tests passed together, including expired-active reconstruction without a second CPS debit;
  - API TypeScript, three focused ESLint batches, `git diff --check`, and Drizzle generation passed;
  - Drizzle reported no schema changes.
- Staged-review remediation qualification:
  - the complete 28-file telephony suite contributed 351 tests to a 31-file, 387-test qualification with real Redis 7 and PostgreSQL 16 enabled;
  - the combined incremental repository, inbound admission, and Twilio WebSocket suite passed 75 tests;
  - RED/GREEN coverage proves fresh cross-replica provider health, fail-closed missing or unreadable posture, collision-safe health identities, terminal-persistence release ordering, and shutdown-safe lease release;
  - API TypeScript, focused ESLint, and `git diff --check` passed.
- Final staged-review finding remediation:
  - 78 focused admission configuration, readiness, duplicate webhook, inbound, and WebSocket tests passed together;
  - duplicate terminal replay, failed-setup replay, lifecycle-read failure, active duplicate reuse, malformed lease timing, and bounded completed event history all have focused RED/GREEN coverage;
  - Redis release intent now remains locally owned after thrown or resolved backend failures, stops lease renewal, retries with bounded backoff, and receives an immediate final drain during graceful shutdown;
  - concurrent duplicate webhooks return the same Connect response and deterministic stream token while Redis reports one created and one existing reservation;
  - failed pre-setup attempts retain the bounded claim until its TTL, so replay reuses one reservation and CPS debit; ambiguous concurrent setup failures reconcile against the durable call before responding and cannot release another delivery's successful reservation;
  - shutdown ordering is explicit and failure-contained: one lifecycle drains bridge terminal handling, retries premium terminal persistence, drains coordinator releases, and destroys Redis in sequence without allowing an earlier failure to skip a later cleanup stage;
  - the full real-Redis and real-Postgres telephony suite contributed 351 tests to a 31-file, 387-test qualification; root TypeScript passed, Drizzle reported no schema drift, focused ESLint passed, and `git diff --check` passed;
  - the application-close RED regression proved an early bridge failure could skip premium retry and admission teardown; the final ordered lifecycle passed 69 focused tests, and the three real-store cases that timed out during an immediate redundant pressure run passed in isolation.

## Pending Work

- Run the exact migration and API CI jobs after integration.

## Risks

- Admission must fail new calls closed when Redis is unavailable. Existing media continues only through its last Redis-confirmed lease deadline and fails closed if fenced authority cannot be renewed before expiry.
- Claim expiry must reclaim abandoned webhooks without releasing active calls; active renewal must not run in the per-frame media path.
- Every active call maintains a bounded proactive Redis recovery hold. The hold remains nonblocking while the primary lease is valid, fails all replicas closed immediately when that lease expires, and clears on owner reconstruction, release, or bounded owner-death expiry.
- Duplicate Twilio webhook delivery must reuse one reservation and one CPS debit.
- Provider health and platform-owned Twilio quota posture can independently reduce or close new-call admission. Quota is explicit configuration and is never inferred from provider balance or heartbeat data.
- Redis scripts use stored key references within one namespaced hash tag and target the current single Redis 7 deployment. Redis Cluster topology would require a separate compatibility qualification.
- The provisional limit remains a guardrail, not certified production concurrency.
- Existing user-owned worktree changes are unrelated and remain unstaged.

## Decisions

- Redis is the distributed admission authority; in-process capacity telemetry remains observational.
- The provisional platform-owned concurrent-call limit remains 20 until qualification authorizes a different value.
- Stable denial reason codes are operator-facing; caller TwiML remains generic and safe.
- Redis scripts must be short, atomic, parameterized, and compatible with the deployment's Redis 7 service.
- Proactive recovery holds are Redis-owned, checked before concurrency and CPS consumption, refreshed only by the current worker owner, and never interrupt active media.
- Lease renewal is worker-fenced. A destination-worker transfer atomically moves ownership, and the former worker stops tracking after `not_owner` without releasing the destination's call.
- Explicit zero limits close admission; malformed production concurrency configuration makes readiness unavailable instead of silently restoring a default.
- The Twilio provider quota allowance defaults to 20 in the production deployment contract and may only tighten the configured provider concurrency limit.
- A validated Twilio stop event, not WebSocket close code `1000`, is the clean-completion authority.
- Retention is terminal-state gated: only terminal call graphs older than the configured cutoff may be removed, and active calls remain ineligible regardless of age.

## Next Recommended Step

Run hosted CI after integration, then continue the capacity program with claim-based realtime workers in ZAR-232.
