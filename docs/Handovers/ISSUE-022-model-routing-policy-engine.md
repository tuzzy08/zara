# ISSUE-022: Model routing policy engine

Issue link: https://github.com/tuzzy08/zara/issues/22

## Goal

Deliver Model routing policy engine for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Rules select tiers by intent, risk, confidence, language, and call phase
- Tests cover escalation and fallback
- Decision is logged

## Work Completed

- Added the shared routing engine in `packages/core/src/runtime.ts`.
- Extended routing rules to support:
  - explicit priority
  - minimum and maximum confidence
  - minimum and maximum risk thresholds
  - call phase matching
- Added routing coverage in `packages/core/src/runtime.test.ts`.
- Routing decisions now emit a structured decision log with selected tier, source, matched rule, and reasoning.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/runtime.test.ts`
- `npm.cmd run test:run -- --pool=threads`
- `npm.cmd run typecheck`
- `npm.cmd run lint`

## Pending Work

- Surface routing decision logs in the sandbox UI and monitoring views.
- Add tenant-configurable rule editing once the runtime policy management UI is scheduled.

## Risks And Edge Cases

- Conflicting rules
- Low confidence high-risk call

## Decisions

- Priority: P0
- Labels: runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Conflicting rules resolve deterministically by explicit priority, then rule specificity, then lexical rule ID.
- If no rule matches, the runtime falls back to the active role default tier.
- Low-confidence, high-risk turns still have a safety override path to SOTA even when no explicit rule matches.

## Next Recommended Step

Use the routing decision log as the backbone for ISSUE-023 event streaming and ISSUE-024 cost estimation so operators can see why the runtime chose a given tier.
