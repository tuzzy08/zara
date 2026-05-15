# ISSUE-027: Platform managed telephony connection

Issue link: https://github.com/tuzzy08/zara/issues/27

## Goal

Deliver Platform managed telephony connection for the Telephony area in the Telephony MVP milestone.

## Acceptance Criteria

- Platform numbers can map to agent versions
- Inbound routing is validated
- Recording policy is enforced

## Work Completed

- Added RED tests in `packages/core/src/telephony.test.ts` and `apps/api/src/telephony/telephony.controller.test.ts` for platform-managed connections, direct number provisioning, routing, and inbound validation.
- Implemented platform-managed telephony connection support in `apps/api/src/telephony/telephony.service.ts` and `packages/core/src/telephony.ts`.
- Added `POST /organizations/:orgId/telephony/connections/:connectionId/register-number` so Zara-managed numbers can be provisioned directly without a provider import step.
- Updated the tenant `/calls` screen to create a platform edge connection, provision a number, save workflow routing, and run inbound validation from the same surface.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/telephony.persistence.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- Wire platform-managed telephony into a live media bridge instead of the current control-plane simulation.
- Move telephony persistence from the local snapshot adapter into the broader Postgres system of record.

## Risks And Edge Cases

- Provisioned platform numbers can still be unrouted if an operator skips workflow binding.
- Platform-managed routing is validated at the control-plane level today, not against a live provider edge.

## Decisions

- Priority: P1
- Labels: telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Platform-managed numbers use the same routing inventory model as imported Twilio numbers and SIP DIDs.
- Platform numbers are provisioned from the tenant UI and inherit connection-level recording posture until a number route overrides it.

## Next Recommended Step

Use the same number inventory contract when platform-managed outbound caller ID execution is wired into live media.
