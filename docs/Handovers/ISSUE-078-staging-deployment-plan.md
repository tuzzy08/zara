# ISSUE-078: Staging deployment plan

External: [GitHub #78](https://github.com/tuzzy08/zara/issues/78)

Issue link: https://github.com/tuzzy08/zara/issues/78

## Goal

Deliver Staging deployment plan for the DevOps area in the Production milestone.

## Acceptance Criteria

- Staging mirrors production-critical services
- Seed data is safe
- Staging validation is documented

## Work Completed

- RED: added `packages/core/src/deployment-docs.test.ts` proving staging deployment documentation must exist and cover production-critical parity, safe seed data, staging validation, drift controls, no production secrets, and production-critical services.
- GREEN: created `docs/Staging-Deployment.md`.
- Documented staging deployment units, production-critical service parity, safe synthetic seed data, disallowed production data/secrets, staging validation gates, drift controls, promotion criteria, and staging smoke tests.
- Marked ISSUE-078 implemented in `docs/Issue-Backlog.md` and updated roadmap sequencing.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/deployment-docs.test.ts` failed because `docs/Staging-Deployment.md` did not exist.
- GREEN: `npm.cmd run test:run -- packages/core/src/deployment-docs.test.ts`

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Staging uses production secrets
- Drift from prod

## Decisions

- Staging must mirror production topology and migration path while using lower capacity where reasonable.
- Staging must never use production secrets or production customer data.
- Promotion is blocked until the exact production candidate passes staging validation.

## Next Recommended Step

Proceed to observability dashboards in ISSUE-079.
