# ISSUE-232: Test suite rationalization and UI smoke-test boundary

External: [Linear ZAR-236](https://linear.app/zara-voice/issue/ZAR-236/spec-test-suite-rationalization-and-ui-smoke-test-boundary)

Status: Pending

## Work completed

- Audited the tracked automated test suite and classified frontend DOM, frontend logic, API, integration, contract, runtime, telephony, security, eval, and configuration coverage.
- Recorded an audit baseline of approximately 151 test files, 1,153 tests, and 79,755 test lines, including approximately 234 frontend/admin tests and 149 DOM/component tests.
- Approved the target seams: public domain/runtime interfaces, real Nest module/controller boundaries, and thin application-shell smoke seams for the tenant and platform-admin apps.
- Published the implementation specification as Linear ZAR-236 with the `ready-for-agent` and `Improvement` labels.

## Tests run

- Attempted `npm.cmd run test:run -- --reporter=default`; the repository-wide run exceeded the bounded 59-second audit window and did not produce a complete result.
- No production or test behavior was changed during the audit/specification pass.

## Pending work

- Capture a reliable per-layer timing and pass/fail baseline.
- Implement the approved slices using preservation-first test migration.
- Complete aggregate ordinary-suite and applicable eval qualification.

## Risks

- Existing working-tree changes include UI tests and product documentation; implementation must avoid overwriting unrelated edits.
- Removing DOM tests before confirming authoritative lower-seam coverage could create gaps in auth, tenant context, workflow publishing, telephony, integrations, or runtime behavior.
- Mechanical test-count reduction can hide quality loss unless before-and-after behavior and layer coverage are recorded.

## Decisions

- Retain comprehensive domain, API, integration, contract, runtime, telephony, security, and tenant-isolation coverage.
- Retain frontend tests for client-owned logic, browser audio, transports, manifests, formatting, and state transitions.
- Target 15-25 DOM smoke tests and approximately 95-110 frontend/admin tests overall.
- Keep runtime and PSTN evals separate from ordinary deterministic test commands.
- Do not pursue a blanket presentation-code coverage percentage.

## Next recommended step

- Start ISSUE-233 / Linear ZAR-237, then work the six unblocked migration slices before final qualification in ISSUE-240 / Linear ZAR-244.
