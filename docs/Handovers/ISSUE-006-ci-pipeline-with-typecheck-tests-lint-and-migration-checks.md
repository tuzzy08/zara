# ISSUE-006: CI pipeline with typecheck tests lint and migration checks

External: [GitHub #6](https://github.com/tuzzy08/zara/issues/6)

Issue link: https://github.com/tuzzy08/zara/issues/6

## Goal

Deliver CI pipeline with typecheck tests lint and migration checks for the DevOps area in the Foundation milestone.

## Acceptance Criteria

- CI runs typecheck, tests, lint, and migration checks
- CI blocks failed checks
- Status is documented

## Status

- Status: done
- Completion: 100%

## Work Completed

- Added a repo-wide `lint` script and flat ESLint configuration in `eslint.config.mjs`.
- Added a main GitHub Actions workflow at `.github/workflows/ci.yml` that runs lint, typecheck, tests, and migration checks on pushes and pull requests.
- Added a focused contract test in `packages/core/src/ci-quality-gates.test.ts` that verifies the root scripts, CI workflow commands, and contributor-facing documentation.
- Documented the enforced quality gates in `README.md`.

## Completed This Pass

- Wrote the failing test first for the four required quality gates and the main CI workflow contract.
- Installed a compatible lint toolchain using `eslint@9.39.1`, `@eslint/js@9.39.1`, and `typescript-eslint@8.59.2`.
- Narrowed lint coverage to authored source and config files so generated build output and generated migration artifacts do not create noisy CI failures.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/ci-quality-gates.test.ts`
- GREEN: `npm.cmd run test:run -- packages/core/src/ci-quality-gates.test.ts`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run test:run -- packages/core/src/ci-quality-gates.test.ts packages/core/src/index.test.ts packages/core/src/env.test.ts apps/api/src/database/schema.test.ts apps/api/src/auth/organization-access/organization-access.service.test.ts apps/api/src/app.module.test.ts`
- Verification: `npm.cmd run db:check`

## Remaining Work

- None for issue completion. Additional deploy-time checks, preview environments, and production rollout gates are tracked in later issues such as issue `#74`, issue `#75`, and issue `#82`.

## Risks And Edge Cases

- Flaky dependency install
- Secrets unavailable in forked PR

## Decisions

- Priority: P0
- Labels: devops, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The main CI contract lives in `.github/workflows/ci.yml`, while the existing migration-specific workflow can continue to provide a narrower signal for schema freshness.
- Lint is intentionally scoped to authored source and config files; generated output and generated migration artifacts are excluded from the enforced quality gate.
- README now documents the exact commands contributors must keep green locally before pushing.

## Next Recommended Step

Issue complete. Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and the next active handover before starting the next issue.
