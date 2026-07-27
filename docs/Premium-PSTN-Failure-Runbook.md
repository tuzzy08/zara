# Premium PSTN Failure Runbook

Use this runbook for `pstn-premium-realtime` calls on OpenAI Realtime or Gemini Live. Filter diagnostics by `releaseVersion`, `runtimeProvider`, `traceId`, and failure code. Never inspect or attach raw audio, provider payloads, credentials, or caller text.

## Immediate Response

1. Stop promotion when the affected `npm run eval:pstn` gate fails. Keep `cost-optimized`, `premium-openai`, and `premium-gemini` results separate.
2. Confirm whether failures are isolated to one provider, one release, or both premium providers. Do not silently move an active premium call to `pstn-sandwich`.
3. Preserve active calls when possible. For terminal premium failures, verify both call legs close and runtime ownership is released once.
4. Roll back the candidate or disable new premium routing for the affected provider according to the approved call-start fallback policy. Record any provider-outage override and release-owner signoff.

The API owns the Twilio webhook, immutable dispatch snapshot, worker-capacity check, and admission reservation. A `pstn-realtime-worker` owns the Twilio media socket and provider socket. The API must never consume a premium media token or answer premium media as an emergency fallback.

## Failure Classes

| Failure | Confirm | Operational response | Release decision |
| --- | --- | --- | --- |
| Worker registry unavailable | API setup failure code `premium_worker_unavailable`, Redis health, and absence of a selected worker | Restore Redis/registry reads. Keep premium answering fail-closed; do not bypass the registry or route media to the API. | Block premium traffic until registry reads and worker heartbeats recover. |
| No compatible ready worker | Worker `/health/ready`, heartbeat age, supported provider, available slots, release ID, and drain state | Start or recover a worker that advertises the requested provider. Confirm credentials and resource limits, then wait for a fresh heartbeat. | Block only the unavailable premium provider when other provider gates remain healthy. |
| Worker draining or overloaded | Readiness response, active/starting calls, CPU, memory, event-loop lag, file descriptors, open WebSockets, and available slots | Leave owned calls on the draining worker. Route new calls only after another compatible worker advertises capacity. Do not increase limits during an incident. | Block promotion when the new release cannot accept calls within declared limits. |
| Duplicate media owner | WebSocket close `4409`, immutable dispatch ID, worker ID, owner epoch, and exactly one provider connection | Preserve the current fenced owner. Investigate retries or proxy duplication without replaying the one-time token. | Block if two workers or two provider sockets execute the same call. |
| Wrong worker target | WebSocket close `4403` with `target_worker_mismatch`, signed worker ID, heartbeat endpoint, and ingress routing | Confirm Twilio reached the endpoint advertised by the selected worker. Repair per-worker DNS/ingress; do not consume or re-sign the token on another worker. | Block premium traffic while routing can deliver a selected call to a different worker. |
| Readiness timeout | `premium.readiness`, provider, readiness latency, and terminal `premium.cleanup` | Check provider status and setup acknowledgement (`session.updated` for OpenAI, `setupComplete` for Gemini). Verify startup media stayed within 5,250 ms and 256 KiB of serialized resident provider payload under the shared 32 MiB admission bound, then closed rather than flushing after timeout. | Block the affected premium provider gate. |
| Provider congestion | `premium.pressure`, provider WebSocket buffered bytes, and failure code | Check whether pressure approached the 256 KiB bound. Pause new premium routing to that provider; do not increase bounds during an incident. | Block the affected provider gate until pressure scenarios pass. |
| Message queue overflow | `premium.pressure`, pending message bytes/count, overflow flag, and cleanup | Confirm bounded provider or Twilio ingress was exceeded and both legs closed. Check for a release-specific processing slowdown before treating it as provider load. | Roll back when release-correlated; otherwise isolate the provider and require owner signoff. |
| Playback overflow | `premium.playback`, per-call and aggregate queued audio bytes/frame count, in-flight marks, and overflow code | Confirm the 30-second/240,000-byte per-call queue, shared 32 MiB playback admission, or 50-mark window was enforced. Check missing/late Twilio mark acknowledgements and abnormal provider output bursts. | Block promotion; do not change playback bounds ad hoc. Reproduce with the deterministic overflow gate and preserve aggregate admission. |
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

For worker-topology changes, also run the protocol simulator `duplicate-media` scenario. It must establish one owner before caller media, reject the duplicate socket with `4409`, open exactly one provider connection, and keep stream tokens, media, caller text, and provider close reasons out of reports.
