# ISSUE-019: Cost optimized sandwich runtime adapter

Issue link: https://github.com/tuzzy08/zara/issues/19

## Goal

Deliver Cost optimized sandwich runtime adapter for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Adapter streams STT to text model to TTS
- Call events capture each stage
- Provider failures degrade predictably

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- STT timeout
- TTS first byte delay
- Model stream interruption

## Decisions

- Priority: P0
- Labels: runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
