# TDD

Zara is a strict RED/GREEN/REFACTOR project.

## Rule

No production code without a failing test first.

## Cycle

1. RED: write one minimal failing test for the desired behavior.
2. Verify RED: run the test and confirm it fails for the expected reason.
3. GREEN: write the smallest production code that passes.
4. Verify GREEN: run the test and related suite.
5. REFACTOR: clean up while keeping tests green.

## Priority

Prioritize unit, integration, contract, runtime, telephony, security, and tenant-isolation tests. UI tests should be light and focused on critical flows.

## Handover Evidence

Every issue handover must record:

- failing test written
- RED result
- GREEN result
- refactor verification
- commands run
- remaining risk
