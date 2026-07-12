# Premium PSTN Failure Runbook

Use this runbook for `pstn-premium-realtime` calls on OpenAI Realtime or Gemini Live. Filter diagnostics by `releaseVersion`, `runtimeProvider`, `traceId`, and failure code. Never inspect or attach raw audio, provider payloads, credentials, or caller text.

## Immediate Response

1. Stop promotion when the affected `npm run eval:pstn` gate fails. Keep `cost-optimized`, `premium-openai`, and `premium-gemini` results separate.
2. Confirm whether failures are isolated to one provider, one release, or both premium providers. Do not silently move an active premium call to `pstn-sandwich`.
3. Preserve active calls when possible. For terminal premium failures, verify both call legs close and runtime ownership is released once.
4. Roll back the candidate or disable new premium routing for the affected provider according to the approved call-start fallback policy. Record any provider-outage override and release-owner signoff.

## Failure Classes

| Failure | Confirm | Operational response | Release decision |
| --- | --- | --- | --- |
| Readiness timeout | `premium.readiness`, provider, readiness latency, and terminal `premium.cleanup` | Check provider status and setup acknowledgement (`session.updated` for OpenAI, `setupComplete` for Gemini). Verify startup media stayed within 1,000 ms and 16 KiB, then closed rather than flushing after timeout. | Block the affected premium provider gate. |
| Provider congestion | `premium.pressure`, provider WebSocket buffered bytes, and failure code | Check whether pressure approached the 256 KiB bound. Pause new premium routing to that provider; do not increase bounds during an incident. | Block the affected provider gate until pressure scenarios pass. |
| Message queue overflow | `premium.pressure`, pending message bytes/count, overflow flag, and cleanup | Confirm bounded provider or Twilio ingress was exceeded and both legs closed. Check for a release-specific processing slowdown before treating it as provider load. | Roll back when release-correlated; otherwise isolate the provider and require owner signoff. |
| Playback overflow | `premium.playback`, queued audio bytes/frame count, in-flight marks, and overflow code | Confirm the 40,000-byte local queue or 50-mark window was enforced. Check missing/late Twilio mark acknowledgements and provider output bursts. | Block promotion; never raise playback bounds as an emergency workaround. |
| Stale generation | `premium.interruption`, generation, stale-generation discard count, and response ownership | Confirm late source callbacks or old response deltas were discarded after interruption or handoff. Correlate repeated discards with provider leg epoch and release version. | Block if stale media reached playback or the discard gate fails. |
| Playback clear | `premium.interruption`, playback-cleared flag/count, Twilio stream identity, and marks | Confirm one Twilio clear was sent for the generation and clear-returned marks did not release new playback ownership. | Block if clear is missing, duplicated, or applied to the wrong stream/generation. |
| Handoff replacement failure | `premium.handoff`, source/target providers, handoff duration, replacement readiness, and cleanup | Confirm the replacement failed or exceeded five seconds, buffered transition media remained bounded, and source/replacement/caller legs closed without sandwich fallback. | Block each provider gate involved in the handoff path. |
| Cleanup failure | `premium.cleanup`, cleanup count, terminal reason, actor ownership, and open provider/Twilio legs | Retry only idempotent control-plane cleanup. Drain or terminate leaked legs, then inspect shutdown, stop, and provider-close ordering. | Block promotion when ownership or either call leg remains live after terminal handling. |

## Gate Check

Run `npm run eval:pstn`. Require 100% for all three deterministic gates:

- `cost-optimized`: sandwich PSTN regressions
- `premium-openai`: OpenAI Realtime normal and failure scenarios
- `premium-gemini`: Gemini Live normal and failure scenarios

Runtime path, runtime provider, or gate identity drift is a gate failure even when checklist and signal assertions pass.
