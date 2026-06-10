# ISSUE-079: Observability dashboards

External: [GitHub #79](https://github.com/tuzzy08/zara/issues/79)

Issue link: https://github.com/tuzzy08/zara/issues/79

## Goal

Deliver Observability dashboards for the DevOps area in the Production milestone.

## Acceptance Criteria

- Dashboards cover calls, latency, errors, cost, integrations, and telephony
- Alert thresholds are documented
- Trace IDs connect systems

## Work Completed

- Added `packages/core/src/production-devops-docs.test.ts` coverage for the observability runbook contract.
- Added `docs/Observability-Dashboards.md` with required dashboard coverage for calls, latency, errors, cost, integrations, and telephony.
- Documented alert thresholds, alert noise controls, dashboard filters, ownership, and cross-tenant exposure expectations.
- Documented `traceId` correlation rules across API ingress, live sandbox events, telephony webhooks, billing usage events, integration tools, and platform-admin audit records.
- Documented missing correlation ID handling so releases can synthesize a `traceId`, mark the event, and file follow-up work when smoke tests expose gaps.
- Updated production/staging deployment runbooks and roadmap references so dashboard readiness is part of release and promotion gates.
- Marked ISSUE-079 as implemented in `docs/Issue-Backlog.md`.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/production-devops-docs.test.ts` failed because `docs/Observability-Dashboards.md` did not exist.
- GREEN: `npm.cmd run test:run -- packages/core/src/production-devops-docs.test.ts` passed after adding the observability runbook and tightening required wording.
- Final verification for the full Production/DevOps slice is recorded in ISSUE-082 after the slice-level checks complete.

## Pending Work

- None for ISSUE-079 acceptance criteria.

## Risks And Edge Cases

- Alert noise is handled through grouping, suppression, staging downgrade rules, runbook links, and release-version context.
- Missing correlation ID is handled as an observability defect with server-side `traceId` synthesis, warning metadata, and release follow-up requirements.

## Decisions

- The operational dashboard contract is docs-as-code and enforced by `packages/core/src/production-devops-docs.test.ts`.
- `traceId` is the required correlation key for API, runtime, telephony, billing, integration, and platform-admin audit events.
- Cross-tenant dashboard exposure requires security signoff.

## Next Recommended Step

Use `docs/Observability-Dashboards.md` during staging validation, production smoke tests, and incident threshold tuning.
