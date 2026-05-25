# ISSUE-077: Production deployment plan

Issue link: https://github.com/tuzzy08/zara/issues/77

## Goal

Deliver Production deployment plan for the DevOps area in the Production milestone.

## Acceptance Criteria

- Production environment, release process, secrets, migrations, and rollback are documented
- Deployment checklist exists
- Smoke tests are defined

## Work Completed

- RED: added `packages/core/src/deployment-docs.test.ts` proving production deployment documentation must exist and include production environment, release process, secrets, migrations, rollback, deployment checklist, smoke tests, failed migration handling, and active-call rollback handling.
- GREEN: created `docs/Production-Deployment.md`.
- Documented production origins, API/frontend deployment units, required production environment variables, release sequencing, secret rules, migration handling, rollback handling, deployment checklist, smoke tests, and release ownership.
- Marked ISSUE-077 implemented in `docs/Issue-Backlog.md` and updated roadmap sequencing.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/deployment-docs.test.ts` failed because `docs/Production-Deployment.md` did not exist.
- GREEN: `npm.cmd run test:run -- packages/core/src/deployment-docs.test.ts`

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Failed migration
- Rollback with active calls

## Decisions

- Production runbook keeps API, tenant app, and platform-admin app as separate deployment units with separate origins.
- Rollback guidance preserves active calls and prefers forward fixes for database rollback unless a down migration is explicitly safe.
- Provider secrets live only in the deployment platform secret manager and production provider webhooks target the production API origin.

## Next Recommended Step

Proceed to observability dashboards in ISSUE-079.
