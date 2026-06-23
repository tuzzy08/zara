# ISSUE-077: Production deployment plan

External: [GitHub #77](https://github.com/tuzzy08/zara/issues/77)

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
- Follow-up on 2026-06-23: hardened the Coolify API deployment after a deploy reached healthy Postgres, healthy MinIO, successful bucket init, and successful migrations, then failed while waiting for `api` health. The API image now pre-creates writable `/app/.zara` state for the unprivileged `node` user, Compose persists that path through the `api-state` volume, and the API healthcheck has a 60 second startup grace period.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/deployment-docs.test.ts` failed because `docs/Production-Deployment.md` did not exist.
- GREEN: `npm.cmd run test:run -- packages/core/src/deployment-docs.test.ts`
- RED follow-up: `npm run test:run -- apps/api/src/production-dockerfile.test.ts --pool=forks` failed because the Coolify API service had no healthcheck `start_period` and the API runtime image/Compose contract did not guarantee writable persistent `/app/.zara` state.
- RED follow-up: `npm run test:run -- packages/core/src/deployment-docs.test.ts --pool=forks` failed because `docs/Coolify-Deployment.md` did not document the API healthcheck grace period or `api-state` runtime state volume.
- GREEN follow-up: `npm run test:run -- apps/api/src/production-dockerfile.test.ts packages/core/src/deployment-docs.test.ts --pool=forks`
- Verification follow-up: `npm run lint`
- Verification follow-up: `npm run typecheck`
- Verification follow-up: `npm run test:run` passed with elevated local socket permissions: 117 files, 868 tests. The first sandboxed full-suite attempt failed with `listen EPERM` before elevation.

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Failed migration
- Rollback with active calls
- Coolify may warn when existing `postgres-data` or `minio-data` volumes were created under an older project name; that warning is separate from API health failure unless the API logs show stale data or schema symptoms.
- API container logs are still the source of truth when Compose reports `container api ... is unhealthy`; the high-level deploy log does not include the Nest bootstrap exception.

## Decisions

- Production runbook keeps API, tenant app, and platform-admin app as separate deployment units with separate origins.
- Rollback guidance preserves active calls and prefers forward fixes for database rollback unless a down migration is explicitly safe.
- Provider secrets live only in the deployment platform secret manager and production provider webhooks target the production API origin.
- Coolify keeps file-backed API runtime state on a named `api-state` volume mounted at `/app/.zara`; the image owns that directory as `node:node` before dropping privileges.
- The API healthcheck uses a startup grace period so Coolify does not fail the dependent web services while the production API finishes Nest/module startup on constrained hosts.

## Next Recommended Step

Proceed to observability dashboards in ISSUE-079.
