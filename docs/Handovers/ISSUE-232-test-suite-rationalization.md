# ISSUE-232: Test suite rationalization and UI smoke-test boundary

External: [Linear ZAR-236](https://linear.app/zara-voice/issue/ZAR-236/spec-test-suite-rationalization-and-ui-smoke-test-boundary)

Status: Implemented

## Work completed

- Audited the tracked automated test suite and classified frontend DOM, frontend logic, API, integration, contract, runtime, telephony, security, eval, and configuration coverage.
- Recorded an audit baseline of approximately 151 test files, 1,153 tests, and 79,755 test lines, including approximately 234 frontend/admin tests and 149 DOM/component tests.
- Approved the target seams: public domain/runtime interfaces, real Nest module/controller boundaries, and thin application-shell smoke seams for the tenant and platform-admin apps.
- Published the implementation specification as Linear ZAR-236 with the `ready-for-agent` and `Improvement` labels.
- Completed ISSUE-233 through ISSUE-240, including layered commands, UI contraction, executable contracts, backend/runtime suite modularization, the DOM allowlist, and full qualification.
- Final inventory is 216 ordinary files, 1,367 static declarations, and 85,558 lines; UI smoke is 8 files and 23 tests.

## Tests run

- Attempted `npm.cmd run test:run -- --reporter=default`; the repository-wide run exceeded the bounded 59-second audit window and did not produce a complete result.
- No production or test behavior was changed during the audit/specification pass.
- Final qualification passed unit 300/300, UI smoke 23/23, the complete API and aggregate ordinary suites, runtime eval 5/5, PSTN eval 25/25, typecheck, production builds, and repository contracts.

## Pending work

- None.

## Risks

- Unrelated working-tree changes remain preserved and unstaged.

## Decisions

- Retain comprehensive domain, API, integration, contract, runtime, telephony, security, and tenant-isolation coverage.
- Retain frontend tests for client-owned logic, browser audio, transports, manifests, formatting, and state transitions.
- Target 15-25 DOM smoke tests and approximately 95-110 frontend/admin tests overall.
- Keep runtime and PSTN evals separate from ordinary deterministic test commands.
- Do not pursue a blanket presentation-code coverage percentage.

## Next recommended step

- Maintain the documented allowlist and layer-selection rules as the product evolves.
