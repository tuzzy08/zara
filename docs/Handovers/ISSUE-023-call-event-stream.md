# ISSUE-023: Call event stream

Issue link: https://github.com/tuzzy08/zara/issues/23

## Goal

Deliver Call event stream for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Events are ordered and idempotent
- Subscribers receive live updates
- Replay works for post-call analysis

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Reconnect
- Duplicate provider webhook

## Decisions

- Priority: P0
- Labels: runtime, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
