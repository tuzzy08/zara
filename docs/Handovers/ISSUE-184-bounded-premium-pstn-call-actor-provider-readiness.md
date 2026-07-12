# ISSUE-184: Bounded premium PSTN call actor and provider readiness

Status: Implemented
Date: 2026-07-12
External: [Linear ZAR-214](https://linear.app/zara-voice/issue/ZAR-214/issue-184-bounded-premium-pstn-call-actor-and-provider-readiness)

## Work Completed

- Audited current Twilio/provider ordering and identified unbounded Promise chains, missing readiness gating, and absent provider-send backpressure.
- Added one per-call actor with explicit `initializing`, `ready`, `active`, `draining`, reserved `handing_off`, `stopped`, and `failed` lifecycle states.
- Added provider acknowledgement contracts: OpenAI waits for `session.updated`; Gemini waits for `setupComplete`; readiness error/close and late terminal registration are deterministic.
- Bounded early caller media to 1,000 ms and 16 KiB, preserved order through reentrant startup flushes, and fail-closed on overflow.
- Added provider WebSocket backpressure through `bufferedAmount` with a 256 KiB ceiling and explicit congestion failure.
- Made Twilio stop, provider failure, readiness timeout, startup cancellation, application shutdown, and repeated terminal signals idempotent across caller, provider, runtime-session, and execution-map ownership.
- Bounded pending Twilio WebSocket ingress to 64 KiB and retained bridge event history to 256 events.
- Preserved the existing provider message processing path so premium tools/handoffs remain attached; cost-optimized PSTN was not changed.

## Tests Run

- `npx vitest run apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/telephony/pstn-premium-call-actor.test.ts apps/api/src/telephony/pstn-premium-call-execution.test.ts --pool=forks --maxWorkers=1 --testTimeout=30000` - 32 passed.
- `npx vitest run apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts --pool=forks --maxWorkers=1 --testTimeout=30000` - 20 passed.
- `npx vitest run apps/api/src/telephony/twilio-media-streams.websocket.test.ts --pool=forks --maxWorkers=1 --testTimeout=30000` - 5 passed.
- `npx tsc -p apps/api/tsconfig.json --noEmit --pretty false` - passed.
- Changed-file ESLint - passed.
- `npm run eval:pstn` - 6 passed.

## Pending Work

- None for ISSUE-184. Deterministic playback framing and interruption generations continue in ISSUE-185.

## Risks

- The actor is process-local; durable call recovery after a process crash remains governed by the existing safe-close/rehydration policy.
- Provider output framing and stale post-interruption audio rejection are intentionally deferred to ISSUE-185.

## Decisions

- Buffer limits are duration/byte based and overflow fails explicitly; no unbounded queue or silent audio discard.
- Provider readiness is an acknowledged protocol state, not WebSocket-open state.
- Provider errors become one terminal close event even when the socket subsequently emits `close`.
- Terminal ownership cleanup does not wait for a provider close callback.

## Next Recommended Step

- Begin ISSUE-185 with RED tests for ordered 20 ms PCMU output, playback acknowledgement marks, interruption generations, and stale-audio rejection.
