# ISSUE-068: Prompt injection defenses

Issue link: https://github.com/tuzzy08/zara/issues/68

## Goal

Deliver Prompt injection defenses for the Security area in the Production milestone.

## Acceptance Criteria

- Tool outputs and knowledge are treated as untrusted
- System instructions are separated from retrieved content
- Tests cover malicious content

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- CRM note injection
- Website ingestion attack

## Decisions

- Priority: P1
- Labels: security, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
