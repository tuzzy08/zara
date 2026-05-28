# ISSUE-142: Provider-neutral live call session core

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-88](https://linear.app/zara-voice/issue/ZAR-88/issue-142-provider-neutral-live-call-session-core)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Captured the governing PSTN standard in `docs/PSTN-Live-Call-Runtime-Standard.md`.
- Recorded this as the first implementation slice for the PSTN live call runtime project.
- Moved Linear ZAR-88 and local backlog state to In Progress for implementation.
- Added `packages/core/src/live-call-session.ts` and exported it from `@zara/core`.
- Added provider-neutral browser/PSTN source metadata, live lifecycle statuses, ordered lifecycle events, and manifest-pinned snapshots.
- Added Turn Runtime Packet creation from the compiled manifest's tenant/workspace/version IDs, active role, telemetry redaction posture, assigned agent toolbelt, optional transfer context, and policy warnings.
- Added `LiveCallSessionCoordinator`, an in-memory v1 coordinator, and rehydrate helper.
- Added tenant, workspace, phone number, published version, and runtime profile scope validation for creation and rehydrate.
- Added lifecycle transition guards so terminal sessions cannot reopen.
- Added regression coverage proving assigned tools enter the packet as optional capabilities without creating tool calls.
- Refreshed the stale signed-out landing smoke assertions to match the active mockup landing so the full repository suite can verify cleanly; no production UI behavior changed.
- Updated `docs/Issue-Backlog.md`, `docs/Roadmap.md`, `docs/PSTN-Live-Call-Runtime-Standard.md`, `docs/Architecture.md`, `docs/Runtime-Manifests.md`, `docs/Telephony.md`, and `docs/Testing-Strategy.md`.

## Tests Run

- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/live-call-session.test.ts --pool=threads` (RED: missing `createLiveCallSession`)
- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/live-call-session.test.ts --pool=threads` (RED: missing lifecycle `transition`)
- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/live-call-session.test.ts --pool=threads` (RED: missing `createTurnPacket`)
- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/live-call-session.test.ts --pool=threads` (RED: missing coordinator/rehydrate)
- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/live-call-session.test.ts --pool=threads` (RED: missing scope validation)
- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/live-call-session.test.ts --pool=threads` (RED: missing terminal transition guard)
- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/live-call-session.test.ts --pool=threads`
- `npm.cmd run typecheck --workspace @zara/core`
- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/live-call-session.test.ts packages/core/src/runtime.test.ts packages/core/src/turn-runtime-packet.test.ts packages/core/src/telephony.test.ts --pool=threads`
- `npm.cmd run typecheck`
- `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/app.test.tsx --pool=forks`
- `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/WorkflowBuilder.test.tsx apps/web/src/useLiveSandboxSession.test.tsx apps/web/src/app.test.tsx --pool=forks`
- `npm.cmd run test:run -- --pool=forks`
- `npm.cmd run typecheck`
- `git diff --check`
- `rg -n 'Twilio|twilio|sandbox-live|LiveSandbox|createSandboxCallSession|workspaceId \\?\\? ""' .\\packages\\core\\src\\live-call-session.ts` (no matches)

## Pending Work

- None for ISSUE-142.

## Risks

- Later ISSUE-143/ISSUE-144 work still needs to connect media adapters and provider bridges to this core without bypassing the lifecycle and scope guards.
- The v1 coordinator is in-memory as planned; production can replace it behind the `LiveCallSessionCoordinator` interface.

## Decisions

- Twilio and future telephony providers must sit behind provider-neutral bridge interfaces.
- The core owns call lifecycle, packet integration, workflow routing, tools, transfers, and policy execution.
- Browser and PSTN session sources share the same session core; PSTN source metadata is number/connection/route-mode only, not Twilio-specific.
- Workspace scope is required for live call sessions; silent empty workspace IDs are rejected.

## Next Recommended Step

- Move to ISSUE-143 / ZAR-89: PSTN sandwich audio pipeline and synthetic media harness.
