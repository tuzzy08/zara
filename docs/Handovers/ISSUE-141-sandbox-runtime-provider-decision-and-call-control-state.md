# ISSUE-141: Sandbox runtime provider decision and call control state

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-87](https://linear.app/zara-voice/issue/ZAR-87/issue-141-sandbox-runtime-provider-decision-and-call-control-state)

## Work Completed

- Added failing-first workflow-builder coverage for the reported Gemini Live runtime decision card and live call-control state.
- Updated the workflow sandbox drawer to resolve premium realtime display from the compiled draft manifest's effective entry role realtime provider/model.
- Suppressed stale sandwich-routing copy for premium realtime draft runs, while preserving model-routing decisions for cost-optimized and balanced sandwich runs.
- Updated Start/End button state so connecting, active, voice capture, and agent playback count as an in-progress call.
- Updated `docs/Issue-Backlog.md`, `docs/Roadmap.md`, and `docs/Frontend-Architecture.md`.

## Tests Run

- `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/WorkflowBuilder.test.tsx --pool=threads` (RED: new Gemini Live/runtime card and End Call state tests failed before implementation)
- `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/WorkflowBuilder.test.tsx --pool=threads`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-141.

## Risks

- The drawer currently displays the effective entry role's premium realtime provider before a call begins. If future UX lets operators start the sandbox from a non-entry selected agent, the display should follow that selected start role.
- Published routed-number sandbox display still prioritizes telephony route resolution, not draft provider preview, which matches the current route-verification UX.

## Decisions

- Premium realtime provider display is derived from role-level `realtimeProvider` / `realtimeModelId`, with OpenAI Realtime as the provider default only when no provider is selected.
- Stale `routing.model_selected` text is hidden only for premium realtime runs because text-routing decisions remain useful for sandwich runtime runs.
- End Call availability is based on observable live activity, not only the hook's `active` status.

## Next Recommended Step

- None. Linear ZAR-87 is closed as Done.
