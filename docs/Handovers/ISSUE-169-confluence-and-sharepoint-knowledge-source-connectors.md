# ISSUE-169: Confluence and SharePoint knowledge-source connectors

Status: Pending
External: [Linear ZAR-123](https://linear.app/zara-voice/issue/ZAR-123/issue-169-confluence-and-sharepoint-knowledge-source-connectors)

## Goal

Add Confluence and SharePoint as registry-backed knowledge-source connectors with review-gated snapshot/daily sync.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-161 and ISSUE-164.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add Confluence and SharePoint registry metadata, setup schemas, and scoped source selection.
- Implement snapshot and daily sync through the knowledge review pipeline.
- Add provider contract, pagination, permission, deletion, and no-live-search tests.

## Risks And Edge Cases

- Provider permissions vary by page, folder, site, or space.
- Deleted content should create review drafts rather than immediately deleting active records.
- SharePoint knowledge scopes must not be conflated with Outlook calendar v1 scopes.

## Decisions

- Confluence and SharePoint are knowledge-source connectors, not general live provider search during calls.

## Next Recommended Step

Start with mocked provider contract tests for one Confluence source and one SharePoint source.

