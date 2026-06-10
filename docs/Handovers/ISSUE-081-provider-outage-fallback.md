# ISSUE-081: Provider outage fallback

External: [GitHub #81](https://github.com/tuzzy08/zara/issues/81)

Issue link: https://github.com/tuzzy08/zara/issues/81

## Goal

Deliver Provider outage fallback for the Runtime area in the Production milestone.

## Acceptance Criteria

- Fallback routes exist for telephony/runtime providers
- Outage mode is visible
- Calls fail safely when no fallback exists

## Work Completed

- Added provider outage fallback in the shared telephony resolver so inbound calls can reroute to another healthy routed number on the same published workflow.
- Added telephony execution-session state that records failover posture and fallback targets after transfer or provider failure.
- Surfaced provider fallback posture in the tenant `/calls` experience.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- Verification: `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build`

## Pending Work

- None for issue completion.

## Risks And Edge Cases

- Multiple providers down
- Stuck failover
- No healthy alternate number on the same workflow
- Fallback route exists but carries a different recording policy or consent posture

## Decisions

- Priority: P1
- Labels: runtime, telephony, devops, edge-case, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Current fallback policy prefers a healthy alternate number already routed to the same published workflow and workspace.
- If no healthy alternate exists, Zara blocks safely instead of silently drifting to an unrelated route.

## Next Recommended Step

Issue complete. Carry the same fallback audit trail into monitoring dashboards and future routing preference tools.
