# ISSUE-140: Runtime eval regression gates and AI observability dashboards

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-73](https://linear.app/zara-voice/issue/ZAR-73/issue-140-runtime-eval-regression-gates-and-ai-observability)

## Work Completed

- Added staff-only `GET /platform-admin/runtime/ai-observability` for AI runtime health, LangSmith export health, eval regression status, protected change categories, deterministic and LLM-as-judge thresholds, emergency override policy, and redacted failing-run links.
- Added platform-admin runtime UI coverage for AI runtime health, runtime eval status, LangSmith export health, and the `npm run eval:runtime` command.
- Added a separate `Runtime eval gate` step to `.github/workflows/ci.yml`.
- Updated `docs/Observability-And-Evals-Standard.md`, `docs/Observability-Dashboards.md`, `docs/API.md`, `docs/Testing-Strategy.md`, `docs/Security-Compliance.md`, `docs/Platform-Admin.md`, staging/production deployment docs, `docs/Roadmap.md`, and `docs/Issue-Backlog.md`.

## Tests Run

- `npm.cmd exec -- vitest run apps/api/src/platform-admin/platform-admin.controller.test.ts apps/platform-admin/src/index.test.tsx packages/core/src/ci-quality-gates.test.ts packages/core/src/production-devops-docs.test.ts`
- `npm.cmd exec -- vitest run apps/api/src/sandbox-live-sessions/sandbox-live-env.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd exec -- vitest run apps/api/src/platform-admin/platform-admin.controller.test.ts apps/platform-admin/src/index.test.tsx apps/api/src/sandbox-live-sessions/sandbox-live-env.test.ts packages/core/src/ci-quality-gates.test.ts packages/core/src/production-devops-docs.test.ts`
- `npm.cmd run eval:runtime`
- `npm.cmd exec -- eslint .github/workflows/ci.yml apps/api/src/platform-admin/platform-admin.controller.ts apps/api/src/platform-admin/platform-admin.controller.test.ts apps/api/src/platform-admin/platform-admin.models.ts apps/api/src/platform-admin/platform-admin.service.ts apps/api/src/sandbox-live-sessions/sandbox-live-env.test.ts apps/platform-admin/src/index.test.tsx apps/platform-admin/src/index.tsx apps/platform-admin/src/styles.css packages/core/src/ci-quality-gates.test.ts packages/core/src/production-devops-docs.test.ts` (TypeScript clean; YAML/CSS ignored by repo config)
- `npm.cmd run test:run` was attempted and reached 66 passed files before failing on unrelated pre-existing dirty tenant-web heading expectations plus one full-suite websocket timing failure that passed in isolation with `npm.cmd exec -- vitest run apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "streams audio chunks"`.

## Pending Work

- None for ISSUE-140.

## Risks

- The current platform-admin observability data is seeded/contract-level until production metric storage is wired to the dashboard data source.
- LLM-as-judge thresholds can create release noise; the implemented standard keeps deterministic evals strict and uses manual review fallback for qualitative scores.
- LangSmith outage overrides must be rare and recorded with local deterministic eval evidence.

## Decisions

- Eval gates are separate release gates, not part of normal unit test execution.
- Deterministic scorecards require 100% pass for protected prompt, model, routing, tool, transfer, and policy changes.
- LLM-as-judge scorecards require 0.8 minimum score with manual review fallback.
- AI runtime observability and internal LangSmith/eval metadata are platform-admin-only surfaces.

## Next Recommended Step

- Close Linear ZAR-73 after full verification and commit.
