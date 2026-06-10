# ISSUE-120: Tenant billing page

External: [Linear ZAR-129](https://linear.app/zara-voice/issue/ZAR-129/issue-120-tenant-billing-page)

Issue link: https://github.com/tuzzy08/zara/issues/120

## Goal

Deliver a real tenant-facing billing page for `/billing` so tenant admins can inspect plan, usage, budgets, invoices or orders, and premium runtime billing state.

## Acceptance Criteria

- `/billing` renders a tenant-facing billing page instead of the dashboard placeholder
- Tenant admins can view plan status, usage totals, budget warnings, invoices or orders, and premium runtime usage
- Billing actions route through safe backend APIs or the payment customer portal instead of exposing payment-provider secrets

## Work Completed

- RED: added tenant app route smoke coverage proving `/billing` must render plan, usage, budget, invoice/order, premium runtime, and Polar portal controls.
- GREEN: added `TenantBillingScreen` and `tenantBillingApi.ts`, then wired `/billing` in `App.tsx`.
- Implemented plan summary, Polar customer state, entitlements, usage meters, budget warning, invoice/order list, checkout action, and customer portal action.
- Added backend billing state, checkout, portal, and usage APIs through ISSUE-121 so the page does not call Polar directly.
- Created an imagegen mockup for the tenant pages at `C:\Users\Lenovo\.codex\generated_images\019e4708-d206-7400-bf03-6bdafa252492\ig_0abcab3dfada4980016a103d50f0688191adbcb6bdb9c0607d.png`.
- Updated `docs/API.md`, `docs/Frontend-Architecture.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md`.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts --pool=forks`
- `npm.cmd run typecheck`
- `npm.cmd run lint`

## Pending Work

- None.

## Risks And Edge Cases

- Pricing table absence is handled by the backend billing state contract; the page renders current tenant plan state from Nest.
- Billing viewer/admin distinction is enforced by backend mutations; the current frontend smoke runs as tenant admin.
- Budget warning state is displayed from server state so active-call budget decisions remain backend-owned.

## Decisions

- Priority: P1
- Labels: frontend, billing, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The browser receives hosted Polar URLs only; payment-provider credentials stay server side.

## Next Recommended Step

Issue complete. Platform-admin billing controls can build on the same backend state without sharing tenant UI code.
