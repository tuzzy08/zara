# ISSUE-004: Postgres schema and migration setup

External: [GitHub #4](https://github.com/tuzzy08/zara/issues/4)

Issue link: https://github.com/tuzzy08/zara/issues/4

## Goal

Deliver Postgres schema and migration setup for the Backend area in the Foundation milestone.

## Acceptance Criteria

- Migration tool is configured
- Initial schema covers tenant and audit foundations
- Migration checks run in CI

## Status

- Status: done
- Completion: 100%

## Work Completed

- Added Drizzle Kit configuration for Postgres migrations in `drizzle.config.ts`.
- Added the initial tenant and audit schema in `apps/api/src/database/schema.ts`.
- Generated the initial SQL migration and Drizzle metadata under `apps/api/src/database/migrations/`.
- Added a dedicated GitHub Actions workflow at `.github/workflows/migration-check.yml` that runs the migration check on push and pull request.
- Added root `db:generate` and `db:check` scripts for local and CI verification.
- Added root `db:migrate` script for applying generated Drizzle migrations to the configured Postgres database.

## Completed This Pass

- Wrote the failing test first for schema shape, Drizzle config wiring, and CI migration checks.
- Installed the latest verified Drizzle toolchain versions used for this pass: `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, and `pg@8.20.0`.
- Cleaned up and ignored Drizzle-generated root config artifacts so repository diffs stay focused on the actual migration outputs.
- Added a failing-first root script contract for `db:migrate`, then wired it to `drizzle-kit migrate --config drizzle.config.ts` and documented the command in `README.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/database/schema.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/database/schema.test.ts`
- Verification: `npm.cmd run db:generate`
- Verification: `npm.cmd run db:check`
- Verification: `npm.cmd run test:run -- apps/api/src/database/schema.test.ts apps/api/src/app.module.test.ts packages/core/src/env.test.ts packages/core/src/index.test.ts`
- Verification: `npm.cmd run typecheck`
- RED: `npm.cmd run test:run -- packages/core/src/ci-quality-gates.test.ts`
- GREEN: `npm.cmd run test:run -- packages/core/src/ci-quality-gates.test.ts`
- Verification: `npm.cmd run test:run -- packages/core/src/ci-quality-gates.test.ts apps/api/src/database/schema.test.ts`
- Verification: `npm.cmd run db:migrate -- --help`

## Remaining Work

- None for issue completion. Auth tables, organization membership, and runtime-specific domain tables are tracked in later issues such as issue `#5`, issue `#18`, and issue `#66`.

## Risks And Edge Cases

- Failed migration rollback
- Local database unavailable

## Decisions

- Priority: P0
- Labels: backend, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Drizzle is the migration tool for the backend foundation because it fits the TypeScript-first architecture and keeps schema and migrations close together.
- The initial schema is intentionally narrow: `tenants` and `audit_logs` only, so Better Auth organization tables can land cleanly in issue `#5` without table ownership conflicts.
- Migration freshness is enforced in CI with `npm run db:check`, while the broader CI surface remains tracked in issue `#6`.
- Runtime migration application is exposed as `npm run db:migrate` and uses the same root Drizzle config as migration generation and checks.

## Next Recommended Step

Issue complete. Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and the next active handover before starting the next issue.
