# ISSUE-239: Modularize oversized runtime and telephony suites

External: [Linear ZAR-243](https://linear.app/zara-voice/issue/ZAR-243/modularize-oversized-runtime-and-telephony-suites)

Status: Implemented

## Work completed

- Synchronized Linear ZAR-243 and the local issue to In Progress.
- Captured the oversized runtime/telephony baseline. The six primary clean targets contain 17,031 lines and 179 tests; the separately edited Twilio media-stream suite remains outside this pass's mechanical changes.
- Split endpoint-policy validation from the WebSocket provider transport suite into `premium-realtime-provider-endpoint.test.ts`, preserving all 22 provider-transport assertions.
- Split runtime service, runtime WebSocket, live-sandbox WebSocket, telephony controller, and premium PSTN execution coverage into capability-focused files with typed support modules.
- Preserved all 179 behavioral assertions across the six targets. The largest capability file is now 1,412 lines instead of 4,917; support modules contain fixtures rather than assertions.

## Tests run

- `npm.cmd exec vitest run apps/api/src/runtime-sessions/premium-realtime-provider-endpoint.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts -- --maxWorkers=1` — GREEN, 2 files and 22 tests passed.
- The first workspace-scoped invocation found no tests because it changed Vitest's root; a root-scoped rerun above is the canonical evidence.
- RED: the first service extraction failed 22 tests because `baseProviderMessageInput` was omitted from shared support; the first live-session extraction failed 36 because `routingRules` remained outside the support boundary.
- GREEN: service 27/27, runtime WebSocket 20/20, live-session WebSocket 36/36, telephony controller 24/24, and premium PSTN execution 50/50 passed in focused runs.
- REFACTOR verification: `npm.cmd run typecheck --workspace @zara/api`, `npm.cmd run build --workspace @zara/api`, the focused production ESM contract, and final `npm.cmd run test:api` passed.
- `npm.cmd run eval:runtime` — GREEN, 5/5.
- `npm.cmd run eval:pstn` — GREEN, 25/25.

## Pending work

- None for ISSUE-239.

## Risks

- The user-edited `twilio-media-streams.websocket.test.ts` was deliberately not rewritten; its protocol coverage remains in the API lane.

## Decisions

- Runtime and PSTN eval lanes remain separate and high-value coverage is not removed for count reduction.
- Test-support imports use explicit `.js` specifiers so support-only modules preserve the production ESM contract.

## Next recommended step

- Proceed to ISSUE-240 for the UI-smoke allowlist guardrail and complete-suite qualification.
