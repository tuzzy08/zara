# ISSUE-007: Environment config and secrets strategy

Issue link: https://github.com/tuzzy08/zara/issues/7

## Goal

Deliver Environment config and secrets strategy for the Security area in the Foundation milestone.

## Acceptance Criteria

- Environment schema validates required values
- Secrets are never logged
- Local example env is documented

## Status

- Status: done
- Completion: 100%

## Work Completed

- Added a shared environment loader in `packages/core/src/env.ts` that validates required values for `NODE_ENV`, `ZARA_ENV`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `LOG_LEVEL`, and `PORT`.
- Added a redaction helper that strips secret values from any environment details surfaced for logs or debugging.
- Wired the API bootstrap to consume the shared runtime environment config instead of reading `process.env.PORT` ad hoc.
- Added a root `.env.example` with the local development keys required for the current platform baseline.

## Completed This Pass

- Wrote the failing test first for environment validation, safe error reporting, and log redaction.
- Implemented the smallest shared config surface needed by both the backend and future frontend/auth work.
- Normalized the local `@zara/core` dependency in `apps/api` to a `file:` reference after npm rejected the `workspace:*` protocol in this environment.
- Updated `.env.example` to match the current local API default on port `4010` and the corresponding Better Auth base URL.
- Added optional telephony hardening env knobs to `.env.example` for credential key version, legacy-key recovery, heartbeat scheduling, and override master secret.
- Wired the API startup scripts to load `.env.example` first and then override with root `.env` values when a local override file exists.
- Updated the API local-start path so `start:api` runs the compiled Nest output through `tsx dist-js/main.js` instead of `tsx src/main.ts`, which was dropping the decorator metadata path Nest DI needs at runtime.
- Updated `apps/api` dev mode to rebuild with `tsc --watch` and run the compiled output instead of hot-running the raw source path.
- Expanded Nest CORS local-origin coverage so both `localhost` and `127.0.0.1` work for the current tenant and platform-admin Vite ports without proxy hacks.
- Hardened API entrypoint detection so Windows runtime entry checks stay correct even when drive-letter casing differs between `import.meta.url` and `process.argv[1]`.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/env.test.ts`
- GREEN: `npm.cmd run test:run -- packages/core/src/env.test.ts`
- Verification: `npm.cmd run test:run -- packages/core/src/env.test.ts apps/api/src/app.module.test.ts packages/core/src/index.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/entrypoint.test.ts apps/api/src/workspaces/workspaces.controller.test.ts`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd install --package-lock-only`
- Verification: `npm.cmd run start:api` and confirmed `GET http://127.0.0.1:4010/health`

## Remaining Work

- None for issue completion. Provider-specific secrets, key rotation metadata, and encrypted secret storage are tracked in later issues such as issue `#67`, issue `#70`, and issue `#77`.

## Risks And Edge Cases

- Missing env at runtime
- Wrong environment selected

## Decisions

- Priority: P0
- Labels: security, devops, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Secret-bearing values are redacted by policy instead of relying on callers to remember not to log them.
- The shared environment loader lives in `@zara/core` so backend and future auth/client packages can consume one contract.
- `apps/api` references `@zara/core` via `file:../../packages/core` because the current npm runtime does not accept the `workspace:*` protocol.

## Next Recommended Step

Issue complete. Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and the next active handover before starting the next issue.
