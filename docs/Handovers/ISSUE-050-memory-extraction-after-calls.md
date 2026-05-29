# ISSUE-050: Memory extraction after calls

Issue link: https://github.com/tuzzy08/zara/issues/50

## Goal

Deliver Memory extraction after calls for the Memory area in the Monitoring milestone.

## Acceptance Criteria

- Post-call extractor drafts useful facts
- Sensitive facts are filtered
- Extraction source links to transcript

## Work Completed

- Added `POST /organizations/:orgId/memory/extract`.
- Added extraction request/response models for transcript-backed memory drafts.
- Drafted caller/account memory from caller transcript assertions.
- Linked draft sources to call session ID, transcript ID, and transcript event IDs.
- Filtered sensitive transcript candidates including card numbers, passwords, tokens, and SSNs.
- Ignored non-caller assertions to reduce false memory from agent/system suggestions.
- Kept extraction draft-only; it does not persist approved memory records.
- Updated `docs/API.md` and `docs/Memory.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` failed with 404 for missing `POST /memory/extract`.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` passed after adding extraction models, route, and service logic.
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` for opt-in extraction coverage.
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts`
- `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/api`

## Pending Work

- ISSUE-051 should persist/approve/reject drafts through the memory approval workflow.

## Risks And Edge Cases

- False memory is reduced by only extracting caller assertions and filtering agent/system turns.
- Sensitive data is filtered using deterministic keyword and digit-pattern checks for this slice.
- Extraction is heuristic and conservative; richer model-assisted extraction should keep the same opt-in, source-link, and sensitive-filter constraints.

## Decisions

- Priority: P1
- Labels: memory, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Extraction returns pending drafts and does not create approved memory records.
- Account drafts require an account ID plus account/billing/renewal-style language.
- Caller drafts currently focus on explicit preference/need/follow-up/remembrance statements.

## Next Recommended Step

Run final verification. If green, move to ISSUE-051: Memory approval workflow.
