# ISSUE-134: Model-backed intent route classifier

Status: Pending
Date: 2026-05-26

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added the target intent standard in `docs/Intent-Routing-Standard.md`.
- Linked intent standardization from runtime, frontend, feature-flow, roadmap, and testing docs.

## Tests Run

- Not run. This pass created documentation and backlog records only.

## Pending Work

- Add failing classifier validation tests for malformed JSON, unknown branch IDs, low confidence, missing confidence, and fallback.
- Implement `intent-classifier-fast` provider alias and Gemini-backed classifier adapter.
- Update builder/runtime manifest config so intent routes carry branch descriptions, examples, fallback, threshold, and input-window settings.
- Write packet-backed intent route results and route only to saved branch/fallback targets.

## Risks

- Model IDs can change between Gemini releases; manifests should store a stable alias while runtime config owns provider IDs.
- Branch overlap can produce surprising routes unless descriptions and examples are clear.
- The current transcript substring inference must be replaced without regressing explicit sandbox intent controls.

## Decisions

- Branch configuration is the source of truth.
- The classifier cannot invent intents, branch IDs, or targets.
- Low confidence, invalid output, or empty caller turn uses fallback.

## Next Recommended Step

- Start from RED classifier-output validation and router tests before adding the Gemini classifier adapter.
