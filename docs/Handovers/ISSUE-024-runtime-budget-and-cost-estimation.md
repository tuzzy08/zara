# ISSUE-024: Runtime budget and cost estimation

External: [GitHub #24](https://github.com/tuzzy08/zara/issues/24)

Issue link: https://github.com/tuzzy08/zara/issues/24

## Goal

Deliver Runtime budget and cost estimation for the Billing area in the Sandbox milestone.

## Acceptance Criteria

- Estimate includes telephony, STT, model, TTS, and storage
- Tenant budgets can block publish or call start
- Usage is attributed by tenant

## Work Completed

- Added runtime cost estimation in `packages/core/src/runtime.ts`.
- Added budget/cost coverage in `packages/core/src/sandbox.test.ts`.
- Estimates now attribute usage by tenant and include:
  - telephony
  - STT
  - model input tokens
  - model output tokens
  - TTS characters
  - storage
- Added budget evaluation for publish/call-start style gates.
- Browser sandbox now shows live estimated spend, budget remaining, and cost component rows after a turn.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/sandbox.test.ts`
- `npm.cmd run test:run -- packages/core/src/runtime.test.ts packages/core/src/sandbox.test.ts apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- --pool=threads`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/web`

## Pending Work

- Replace static pricing with tenant/provider pricing config once billing tables and provider catalog storage exist.
- Feed finalized usage events into the production billing meter when the billing milestone starts.

## Risks And Edge Cases

- Long call
- Provider pricing missing

## Decisions

- Priority: P1
- Labels: billing, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Missing pricing marks estimates incomplete and blocks runtime start when tenant budgets enforce `blockOnLimit`.
- Cost estimates intentionally use component rows rather than a single total so operators can see which provider class is driving spend.
- Browser sandbox estimates are live approximations; authoritative billing will come from persisted usage events later.
- Workflow builder draft and pre-route publish metadata now use an explicitly named temporary browser-sandbox budget policy instead of an unexplained inline `$1200` cap.

## Next Recommended Step

Use the componentized estimate contract when implementing billing usage metering and plan limits.
