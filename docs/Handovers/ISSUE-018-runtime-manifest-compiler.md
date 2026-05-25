# ISSUE-018: Runtime manifest compiler

Issue link: https://github.com/tuzzy08/zara/issues/18

## Goal

Deliver Runtime manifest compiler for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Compiler converts published workflow to manifest
- Manifest is deterministic and versioned
- Invalid references fail fast

## Work Completed

- Added shared runtime compiler implementation in `packages/core/src/runtime.ts`.
- Added `compileRuntimeManifest` coverage in `packages/core/src/runtime.test.ts`.
- Compiler now converts a published workflow version into a deterministic compiled runtime manifest with:
  - entry node and entry role resolution
  - stable manifest hashing
  - runtime tool bindings with full request metadata
  - handoff, condition, and exit route compilation
  - return route compilation for tool/intermediary-agent responses back to the invoking node
  - memory, budget, telemetry, and telephony runtime payloads
- Compiler now fails fast for missing published tool definitions and missing tenant integration bindings.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/runtime.test.ts`
- `npm.cmd run test:run -- --pool=threads`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- RED/GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "return edges"`
- Verification: `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts`
- Verification: `npm.cmd run typecheck`

## Pending Work

- Wire compiled manifests into the future NestJS runtime module and sandbox call session APIs.
- Extend compile-time checks for telephony connection ownership and queue registry validation once telephony work resumes.

## Risks And Edge Cases

- Deleted tool
- Partial tenant config

## Decisions

- Priority: P0
- Labels: runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Runtime manifests are compiled from immutable published versions, not live drafts.
- Manifest IDs are deterministic and derived from a stable hash of the published version plus tenant runtime config.
- Full tool request metadata is preserved in the compiled manifest even though the draft preview only exposes a summarized request posture.
- Return routes are compiled from `WorkflowEdge.kind = "return"` and included in the manifest definition hash.

## Next Recommended Step

Use this compiler in the next sandbox slice so live browser sessions pin to a compiled manifest instead of reading directly from the publish preview snapshot.
