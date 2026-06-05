# ISSUE-158: Capability grants and connection scope setup UX

Status: Pending
External: [Linear ZAR-112](https://linear.app/zara-voice/issue/ZAR-112/issue-158-capability-grants-and-connection-scope-setup-ux)

## Goal

Add scoped capability grants and simple organization/workspace connection setup UX for integrations.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-157.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add API and UI tests for organization-wide and workspace-owned connections.
- Add explicit grants for agent tools, knowledge-source ingestion, and post-call sync.
- Add setup presets, setup copy, promotion audit, insufficient-scope reconnect prompts, and revoke/delete dependency handling.

## Risks And Edge Cases

- Connection availability is not the same as permission to use a capability.
- Promotion from workspace to organization scope must not create automatic grants.
- Revoked connections should pause dependent sync/jobs without deleting historical state.

## Decisions

- Support both organization-wide and workspace-owned connections to reduce setup friction.
- Present grants as clear capability toggles and guided setup rather than raw permission records.

## Next Recommended Step

Start with failing grant validation tests across tenant, workspace, workflow, role, capability, and OAuth scopes.

