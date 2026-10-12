# Test signal audit — 2026-10-12

Issue: [ZAR-236](https://linear.app/zara-voice/issue/ZAR-236/spec-test-suite-rationalization-and-ui-smoke-test-boundary). Handover: [ISSUE-232](../Handovers/ISSUE-232-test-suite-rationalization.md).

## Scope and decisions

Three parallel agents inspected packages, API/simulator, and frontend tests. No production code changed. Test removal used evidence, not a target count. Removed checks only repeated source/configuration text, decorative constants, fixture values, or an identical existing test. Genuine behavior, security, financial, recovery, and protocol tests remain where no equivalent E2E coverage was established.

The repository has no checked-in full browser E2E runner. Mocked React tests are not browser-to-API E2E tests. This audit does not claim otherwise or claim that every retained assertion is optimal. It does not add a new E2E framework.

## Inventory

Baseline: working tree at `72fc1902cd41c1976d7df1a814360dbf02ba74c1`, with unrelated user edits preserved. Test files were clean before this pass. Counts use `scripts/test-suite-inventory.mjs`: static declarations, not expanded parameterized cases.

| Measure | Before | After | Removed |
| --- | ---: | ---: | ---: |
| Ordinary test files | 327 | 304 | 23 |
| Declared test cases | 2,042 | 1,983 | 59 |
| Test lines (inventory counting convention) | 109,091 | 107,414 | 1,677 |

- [Packages](packages.md): five cases removed; 21 files retained.
- [Frontend](frontend.md): two cases removed; 32 files retained.
- [API and simulator](api.md): 52 cases removed; 251 files retained.
- CI no longer names eight deleted source-only migration suites. Migration execution, rollback execution, and retained PostgreSQL tests remain unchanged.
- The independent package reviewer checked API deletions. A second reviewer checked the requested policy rules and found three conflicting unit-first bullets; those bullets were corrected.

Deleted tests are recoverable from Git. No production account, server setting, provider resource, or database was changed by this cleanup.

## Verification

Environment: local Windows, Node `v24.13.1`, repository lockfile dependencies. Tests use existing synthetic fixtures. No production credentials are needed or supplied. Dedicated PostgreSQL/Redis test services were not configured for this pass; skipped service tests must not be described as passing.

- Packages: 208 passed. Machine-readable results: `artifacts/testing-audit/packages-vitest.json`. Command and per-file evidence are in the package report.
- Frontend: 136 tests across 32 files passed across focused runs. Three worker-start timeouts passed on a serial retry; see the frontend report for exact commands.
- `node scripts/validate-test-suite-boundaries.mjs`: passed, nine DOM files and 25 declarations.
- `node scripts/test-suite-inventory.mjs`: passed, no unclassified or duplicate files.
- ESLint on modified retained test files: passed at both initial and final checks.
- `git diff --check`: passed, with existing line-ending warnings.
- Full bounded API run: 1,836 passed, 69 skipped; 234 files passed, 17 skipped. Exit 0 in 1,237.83 seconds. PostgreSQL/Redis-only cases were not enabled locally. The final changed-file recheck passed 15 tests and skipped two PostgreSQL cases.
- `npm run typecheck`: passed. Final modified-test ESLint: passed.

This is repeatable test-cleanup evidence, not an E2E artifact or release approval. No commit, push, CI run, or deployment is claimed.
