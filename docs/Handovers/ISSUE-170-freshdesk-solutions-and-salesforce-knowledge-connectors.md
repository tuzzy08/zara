# ISSUE-170: Freshdesk Solutions and Salesforce Knowledge connectors

Status: Pending
External: [Linear ZAR-124](https://linear.app/zara-voice/issue/ZAR-124/issue-170-freshdesk-solutions-and-salesforce-knowledge-connectors)

## Goal

Add Freshdesk Solutions and Salesforce Knowledge as registry-backed CRM/help-center knowledge-source connectors.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-161 and ISSUE-162.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add Freshdesk and Salesforce Knowledge registry metadata and safe setup schemas.
- Implement article/category selection, snapshot import, daily sync, and review-gated extracted records.
- Add provider contract, pagination, deleted article, auth failure, and no-live-search tests.

## Risks And Edge Cases

- Salesforce operational CRM scopes may not imply Salesforce Knowledge access.
- Freshdesk article visibility can differ from public availability.
- CRM help-center ingestion must stay separate from operational ticket/case tools.

## Decisions

- These follow after registry stabilization and the first Salesforce connector slice.
- Runtime retrieval uses approved indexed records only.

## Next Recommended Step

Start with Freshdesk and Salesforce Knowledge mocked ingestion contract tests.

