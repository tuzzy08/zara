# ISSUE-230 Handover: Claim-based premium PSTN realtime workers

External: [Linear ZAR-232](https://linear.app/zara-voice/issue/ZAR-232/pstn-capacity-912-move-premium-pstn-execution-into-claim-based)

Status: Implemented

## Decisions

- The API remains the authenticated Twilio webhook, admission, and TwiML control plane.
- Premium Twilio media uses a separately deployable realtime-worker public WebSocket base URL. The API-hosted premium media path is removed rather than retained as a fallback.
- Worker ownership is established atomically before provider startup and is fenced by an ownership epoch carried through renewal and terminal release.
- The owning worker holds the Twilio and premium-provider sockets, runtime session, codec and bounded-buffer state, marks, interruption state, tool loop, handoffs, and finalization.
- Worker startup context comes from the durable call dispatch/execution rows and immutable published manifest, scoped by tenant, workspace, call, dispatch, version, and premium runtime.
- Duplicate media sockets and stale owners fail closed before creating a provider connection.
- Admission selects a healthy worker and returns its validated public media endpoint. The TwiML token is pinned to that worker identity, and a different worker rejects the socket before consuming the one-time token.
- Ownership renewal loss is a terminal event: the worker stops premium execution, persists the failure, closes the Twilio socket, and releases local state.
- Drain publication is awaited before a worker waits for active calls, and the worker reads shared API state through a read-only deployment mount.

## Work Completed

- Added a separately deployable `realtime-worker` Nest composition root that owns premium Twilio media and provider sessions without mounting API controllers.
- Added durable premium dispatch snapshots and immutable published-manifest loading so workers do not depend on API-process memory.
- Added atomic PostgreSQL dispatch ownership claims with monotonically increasing fencing epochs, fenced renewal and release, and duplicate-owner rejection before provider startup.
- Added worker-aware Redis admission activation, renewal, recovery, and terminal release with ownership-loss callbacks.
- Added worker registry heartbeats containing health, drain state, slots, active calls, resource posture, and a validated public media endpoint.
- Changed premium TwiML dispatch to select a healthy worker, pin the signed stream token to its identity, and use its advertised endpoint. Removed the API-hosted premium media URL fallback.
- Added wrong-worker, replay, duplicate-socket, initial-fence, renewal-loss, terminal-persistence, API-restart, and shutdown behavior.
- Bound worker-capacity reselection, reject selectors that return an already-excluded worker, and freeze the final admitted worker into the durable snapshot and signed TwiML target.
- Treat `media-connected` as compatible with an already persisted nonterminal provider/active lifecycle so an earlier Twilio `in-progress` callback cannot reject a valid media socket or move lifecycle state backward.
- Carry the signed worker release through the deterministic simulator's parsed TwiML and every normal, delayed-duplicate, and simultaneous-duplicate `start.customParameters` payload.
- Preserved OpenAI and Gemini premium greeting, provider-owned turn detection, barge-in, tools, handoffs, voice selection, caller context, codec conversion, bounded buffers, and observability inside the worker-owned execution path.
- Added deterministic simulator coverage for normal, interruption, handoff, failure, late duplicate, and simultaneous duplicate media paths.
- Added the worker Docker target, Coolify service, read-only shared-state mount, environment contract, endpoint-routing guidance, and failure runbook entries.
- Updated the canonical PSTN runtime and telephony operating contracts for the separate premium worker process and its required worker ID, release ID, and exact public endpoint.

## Tests Run

- API telephony, realtime-worker, schema, and production-Docker matrix: 457 passed, 36 skipped.
- Twilio media WebSocket, controller, and simulator affected matrix: 125 passed.
- PSTN protocol simulator suite: 71 passed.
- Real Redis admission suite: 15 passed in three consecutive full runs after review.
- Real PostgreSQL migration, ownership, concurrency, snapshot-integrity, and retention suite: 21 passed.
- API typecheck, build, and focused ESLint: passed.
- Simulator typecheck and build: passed.
- `npm run eval:pstn`: 25 passed.
- `npm run eval:runtime`: 5 passed.
- `npm run db:generate`: no schema drift.
- Realtime-worker Docker target build: passed.

## Pending Work

- Run the documented staging smoke against deployed API and per-worker public WebSocket endpoints before production promotion.
- Confirm the production ingress/load-balancer configuration preserves the selected worker identity instead of randomly redistributing premium media sockets.

## Risks

- Local and deterministic qualification does not prove that a production ingress routes each selected worker endpoint to the matching worker instance; that remains a deployment smoke gate.
- The supplied Coolify topology intentionally provisions one realtime worker. Horizontal scale requires deployment-unique IDs plus per-worker endpoints or worker-aware ingress; generic replica scaling behind random ingress is prohibited.
- The provisional platform concurrency limit remains a guardrail rather than a certified capacity number until the synthetic load program completes.

## Next Recommended Step

Deploy the API and realtime-worker services to staging with distinct worker endpoints, run the documented Twilio/OpenAI and Twilio/Gemini smoke scenarios, and verify wrong-worker routing fails closed without consuming the token.
