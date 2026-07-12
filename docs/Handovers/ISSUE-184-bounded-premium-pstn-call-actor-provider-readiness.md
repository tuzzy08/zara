# ISSUE-184: Bounded premium PSTN call actor and provider readiness

Status: In Progress
Date: 2026-07-12
External: [Linear ZAR-214](https://linear.app/zara-voice/issue/ZAR-214/issue-184-bounded-premium-pstn-call-actor-and-provider-readiness)

## Work Completed

- Audited current Twilio/provider ordering and identified unbounded Promise chains, missing readiness gating, and absent provider-send backpressure.
- Approved one per-call actor with explicit lifecycle and bounded startup/steady-state media pressure.

## Tests Run

- None yet; implementation must begin with failing readiness, overflow, congestion, shutdown, and idempotency tests.

## Pending Work

- Implement and verify every acceptance criterion in ZAR-214.

## Risks

- Refactoring the active OpenAI path must not change cost-optimized PSTN or provider-native tool behavior.

## Decisions

- Buffer limits are duration/byte based and overflow fails explicitly; no unbounded queue or silent audio discard.

## Next Recommended Step

- Write the provider-readiness and early-media RED tests, then introduce the smallest call-actor contract that makes them pass.
