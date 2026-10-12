# TDD

Zara is a strict RED/GREEN/REFACTOR project.

## Rule

No production code without a failing test first.

## Cycle

1. RED: use an existing behavior test, or add one only for a genuine coverage gap. Prefer a representative medium-to-hard E2E scenario for a complex feature.
2. Verify RED: run the test and confirm it fails for the expected reason.
3. GREEN: write the smallest production code that passes.
4. Verify GREEN: run the test and related suite.
5. REFACTOR: clean up while keeping tests green.

## Priority

Highly prefer E2E tests as the sole testing mechanism. Use real application boundaries and preserve evidence of failure, recovery, authority, and durable outcomes. Mocked component tests are not E2E tests.

Never write unit tests after production code. Before testing a system in isolation, list all identified failure modes and explain why E2E coverage is insufficient. Then write the failing behavior test first. Do not add tautological tests, implementation change detectors, or a new bug-fix regression test when existing behavior coverage already catches the bug.

Keep useful existing tests where E2E coverage does not catch the same failures. Test deletion requires a recorded reason and retained coverage evidence; test count is not a quality target.

## Handover Evidence

Every issue handover must record:

- existing failing behavior test, or the coverage gap and failing test added
- RED result
- GREEN result
- refactor verification
- commands run
- remaining risk

For E2E runs, also retain the exact revision, command, environment and fixture setup, assertions, results, and an inspectable trace or report. Use synthetic data and redact secrets. Another agent must be able to repeat the run; a screenshot alone is insufficient.
