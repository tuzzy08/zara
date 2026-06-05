# ISSUE-160: Knowledge base add/import snapshot workflow

Status: Pending
External: [Linear ZAR-114](https://linear.app/zara-voice/issue/ZAR-114/issue-160-knowledge-base-addimport-snapshot-workflow)

## Goal

Make knowledge-base creation a first-class tenant flow with snapshot imports, extracted record review, and scoped activation.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-158.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add failing memory API tests for knowledge sources, snapshots, extracted records, and review states.
- Add Add source UI for manual text, single URL, PDF, and supported one-time provider imports.
- Expand knowledge taxonomy and manifest-scoped retrieval.

## Risks And Edge Cases

- Imported sources can produce no usable records.
- High-risk type suggestions need explicit operator confirmation.
- Runtime retrieval must exclude unapproved drafts.

## Decisions

- Review happens at extracted-record level, not embedding chunk level.
- Default scope is active workspace with optional workflow selection.
- Published manifests freeze allowed knowledge scope, while new approved records inside scope can serve new calls.

## Next Recommended Step

Start with failing source snapshot and extracted-record review API tests.

