# ISSUE-234: Contract the tenant application shell suite

External: [Linear ZAR-238](https://linear.app/zara-voice/issue/ZAR-238/contract-the-tenant-application-shell-suite)

Status: Implemented

## Work completed

- Contracted `apps/web/src/app.test.tsx` from a 6,609-line, 73-test monolith to a 332-line, four-test application-shell smoke suite.
- Removed incidental landing copy, title, layout, card, styling-primitive, provider-state, persistence, API-payload, and private-request assertions.
- Removed the embedded API and live WebSocket reimplementation from the application-shell suite.
- Retained only signed-out authentication entry, protected-route authentication and sign-out, multi-organization selection, and tenant entry from server-owned auth context.
- Confirmed focused workflow builder, sandbox, telephony, agents, and live-session hook suites remain independently covered, while backend policy and isolation remain owned by API/integration tests.

## Tests run

- Pre-change focused execution could not start a Vitest worker within 60 seconds because of the monolithic suite.
- First contracted run provided the expected refactor feedback: two tests failed due a duplicate sign-in link query and missing `ResizeObserver`.
- Focused contracted suite passed: 1 file, 4 tests, 21.94 seconds.
- `npm.cmd run test:ui-smoke -- --reporter=default` passed: 9 files, 64 tests, 47.57 seconds.
- `npm.cmd run typecheck --workspace @zara/web` passed.
- Targeted ESLint passed with zero warnings.
- `npm.cmd run test:inventory` passed: UI smoke now contains 9 files, 66 statically declared tests, and 4,290 lines.

## Pending work

- None.

## Risks

- The remaining focused UI suites still contain presentation-heavy coverage; ISSUE-235 and ISSUE-236 own their contraction.
- Static declared-test counts are approximate; executed Vitest totals are the runtime authority.

## Decisions

- Retain only critical application-shell smoke flows and user-visible outcomes.
- Do not repair copy-only UI tests when marketing language changes; remove those assertions.
- Keep backend policy, persistence, provider state, authorization, and tenant isolation at backend or contract seams.

## Next recommended step

- Proceed to ISSUE-235 to contract workflow builder and sandbox UI coverage.
