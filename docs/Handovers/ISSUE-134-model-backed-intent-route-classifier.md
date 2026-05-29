# ISSUE-134: Model-backed intent route classifier

Status: Implemented
Date: 2026-05-27
External: [Linear ZAR-67](https://linear.app/zara-voice/issue/ZAR-67/issue-134-model-backed-intent-route-classifier)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added the target intent standard in `docs/Intent-Routing-Standard.md`.
- Linked intent standardization from runtime, frontend, feature-flow, roadmap, and testing docs.
- Moved Linear `ZAR-67` and local `ISSUE-134` records to `In Progress` before implementation.
- Added `@zara/core` intent routing config/output types and policy validation for valid branch matches, fallback, malformed output, unknown branch IDs, missing confidence, low confidence, and intent-key mismatch.
- Preserved intent route classifier, input-window, branch intent keys, descriptions, and examples through workflow node creation, draft previews, and compiled runtime manifests.
- Updated the live sandbox router to call the `intent-classifier-fast` classifier when no explicit sandbox intent override is selected, write `IntentRouteResult` into the turn runtime packet, emit warning packet facts for fallback guards, and route only to configured branch/fallback targets.
- Added the Gemini intent classifier adapter with `INTENT_CLASSIFIER_MODEL_ID ?? gemini-3.1-flash-lite`, JSON-only output parsing, and target-free model inputs.
- Exposed builder controls for confidence threshold, recent transcript window, branch description, and examples while keeping raw expressions hidden.
- Updated runtime, frontend, API, testing, feature-flow, roadmap, and intent routing docs to reflect the implemented contract.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/intent-routing.test.ts`
- `npm.cmd run test:run -- packages/core/src/runtime.test.ts --testNamePattern "compiles a deterministic manifest"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-intent-classifier.provider.test.ts`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --testNamePattern "configures intent route branches" --pool=threads`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "executes live tool nodes"`
- `npm.cmd run typecheck`
- `git diff --check`

## Pending Work

- None for ISSUE-134.

## Risks

- Model IDs can change between Gemini releases; manifests should store a stable alias while runtime config owns provider IDs.
- Branch overlap can produce surprising routes unless descriptions and examples are clear.
- Explicit sandbox intent overrides remain for operator testing; production-like sandbox turns now exercise the classifier path.

## Decisions

- Branch configuration is the source of truth.
- The classifier cannot invent intents, branch IDs, or targets.
- Low confidence, invalid output, or empty caller turn uses fallback.

## Next Recommended Step

- Move to ISSUE-135 / ZAR-68 for discretionary agent toolbelts and structured tool results.
