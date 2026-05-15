# ISSUE-025: Sandbox call session

Issue link: https://github.com/tuzzy08/zara/issues/25

## Goal

Deliver Sandbox call session for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Browser sandbox starts a test call
- Simulated tools are available
- Transcript and metrics are recorded

## Work Completed

- Added shared sandbox call session orchestration in `packages/core/src/runtime.ts`.
- Added sandbox session coverage in `packages/core/src/sandbox.test.ts`.
- Added the tenant-facing `/sandbox` screen in `apps/web/src/SandboxScreen.tsx`.
- Wired `/sandbox` in `apps/web/src/App.tsx`.
- Added a light UI smoke test in `apps/web/src/app.test.tsx`.
- Sandbox now supports:
  - loading published workflow versions into the sandbox route
  - running the latest builder-published workflow directly in sandbox
  - browser microphone start attempt with typed fallback
  - typed sandbox call start
  - caller turn execution through the sandwich runtime adapter
  - transcript recording
  - live event replay
  - simulated tool execution
  - session metrics and estimated cost display
- Generated an imagegen mockup first and implemented the page direction from it.
- Added a browser-local published workflow registry as a temporary app-layer stand-in for the future workflow version API.
- Replaced the direct version-number publish action with a publish dialog that captures workflow title and a temporary workspace selection.
- Wired published premium sandbox starts to request a realtime session contract from Nest before proceeding.
- Added inline premium session status, expiry, transport URL, and failure copy to the sandbox surface.
- Extended the workflow-page sandbox drawer so published workflows can switch from draft graph mode into routed-number mode when the same workflow already has a live telephony number assigned in the active workspace.
- Wired routed-number sandbox starts to load telephony state from Nest, select the published live number, and replay caller turns through that exact phone path inside the builder drawer.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.controller.test.ts`
- `npm.cmd run test:run -- apps/api/src/workspaces/workspaces.controller.test.ts`
- `npm.cmd run test:run -- packages/core/src/sandbox.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- `npm.cmd run test:run -- packages/core/src/runtime.test.ts packages/core/src/sandbox.test.ts apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- --pool=threads`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/web`
- Browser verification at `http://127.0.0.1:4174/sandbox`: start typed sandbox, send caller turn, trigger simulated tool, inspect transcript/events/cost updates.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run lint`

## Pending Work

- Replace in-browser mock session construction with live NestJS sandbox transport and real provider-backed runtime execution through ISSUE-109 through ISSUE-115.
- Replace browser-local published workflow registry with API-backed published workflow version loading.
- Replace temporary publish-dialog workspace selection with real persisted workspace IDs once workflow APIs own publish metadata end to end.
- Replace local simulated STT/TTS adapters with AssemblyAI streaming STT and Cartesia Sonic 3 streaming TTS.

## Risks And Edge Cases

- Mic permission denied
- Sandbox tool throws

## Decisions

- Priority: P0
- Labels: runtime, frontend, good-first-slice, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Sandbox V1 runs locally in the tenant app using shared `@zara/core` contracts so the product flow can be exercised before backend transport exists.
- Builder-to-sandbox handoff uses a published workflow version id in the route plus a browser-local selected-version pointer. This keeps the UX explicit and deep-linkable until backend storage owns selection.
- Publish action copy stays stable as `Publish`; version numbers appear as status after publishing rather than in the primary action.
- Typed sandbox mode is always available, because microphone permissions are browser/environment dependent.
- Simulated tools are explicit handlers keyed by runtime tool ID, and missing handlers fail loudly.
- Premium published sandbox runs should fail visibly when control-plane session bootstrap is rejected instead of silently degrading to a cheaper profile.
- Routed-number sandbox mode reuses the telephony dispatch API instead of duplicating route resolution inside the builder.
- The local simulation slice is now treated as an intermediate milestone. Live browser-audio sandbox execution continues in ISSUE-109 through ISSUE-115.

## Next Recommended Step

Continue with ISSUE-109 live sandbox session transport, then ISSUE-110 and ISSUE-111 for provider-backed browser audio execution.
