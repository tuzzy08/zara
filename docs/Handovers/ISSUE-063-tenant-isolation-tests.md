# ISSUE-063: Tenant isolation tests

Issue link: https://github.com/tuzzy08/zara/issues/63

## Goal

Deliver Tenant isolation tests for the Security area in the Production milestone.

## Acceptance Criteria

- Automated tests prove tenant data isolation
- Cross-tenant access returns forbidden/not found
- Covers calls, memory, integrations, telephony

## Work Completed

- Added live call/session isolation coverage in `sandbox-live-sessions.controller.test.ts` for session records, events, quality reports, CRM sync status, CRM retry, and tenant-scoped session lists.
- Added memory isolation coverage in `memory.controller.test.ts` for approval draft IDs, knowledge ingestion IDs, retries, exports, and cross-tenant payload leakage.
- Added integrations isolation coverage in `integrations.controller.test.ts` for OAuth connection IDs, connector lists, webhook tools, and tool grants.
- Added telephony isolation coverage in `telephony.controller.test.ts` for connection IDs, number IDs, call-control event IDs, human fallback IDs, and tenant state lists.
- Updated `docs/Testing-Strategy.md` and `docs/Security-Compliance.md` with the tenant-isolation regression scope.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "does not expose live call"` passed.
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "cross-tenant memory"` passed.
- `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "does not expose integration"` passed.
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts -t "does not expose telephony"` passed.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/memory/memory.controller.test.ts apps/api/src/integrations/integrations.controller.test.ts apps/api/src/telephony/telephony.controller.test.ts` passed: 4 files, 37 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build --workspace @zara/api` passed.
- `npm.cmd run test:run` passed: 39 files, 182 tests.

## Pending Work

- None for ISSUE-063.

## Risks And Edge Cases

- ID guessing is now covered across the required domains with public controller tests.
- Admin role confusion is partially covered through tenant-scoped route boundaries; deeper authenticated RBAC guard tests should continue in the security/compliance slice.
- These tests use current module-level test apps rather than full Better Auth sessions, so they prove service/controller tenant scoping, not end-to-end session middleware.

## Decisions

- Priority: P0
- Labels: security, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Production code was not changed for this issue because the new isolation probes passed against the existing tenant-scoped services.
- Cross-tenant access should prefer not found or empty tenant-scoped collections instead of revealing whether another tenant owns a guessed ID.

## Next Recommended Step

Monitoring-and-escalation slice is complete through ISSUE-063. Next slice starts at ISSUE-064 audit logging.
