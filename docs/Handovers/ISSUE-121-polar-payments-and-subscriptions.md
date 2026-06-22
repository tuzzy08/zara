# ISSUE-121: Polar payments and subscriptions

External: [Linear ZAR-130](https://linear.app/zara-voice/issue/ZAR-130/issue-121-polar-payments-and-subscriptions)

Issue link: https://github.com/tuzzy08/zara/issues/121

## Goal

Integrate Polar payments with Better Auth so tenant organizations can subscribe, manage customer portal access, receive webhook-driven entitlement updates, and report usage for billing.

## Acceptance Criteria

- Better Auth is integrated with Polar for organization-linked checkout, subscriptions, customer portal, and customer state
- Polar webhooks update tenant plan, subscription, entitlement, invoice/order, and cancellation state idempotently
- Usage-based billing events from Zara usage meters can be sent to Polar without leaking tenant secrets or duplicating usage

## Work Completed

- RED: added backend billing controller coverage for organization-linked checkout, customer portal sessions, idempotent Polar webhooks, subscription/customer-state updates, entitlement sync, order/invoice sync, and usage-event dedupe.
- GREEN: added `BillingModule`, `BillingController`, `BillingService`, `billing.models.ts`, `billing-state.repository.ts`, `polar-billing.client.ts`, and `better-auth-polar.ts`.
- Installed `@polar-sh/better-auth` and `@polar-sh/sdk` in `@zara/api`.
- Implemented `GET /organizations/:orgId/billing/state`, `POST /organizations/:orgId/billing/checkout`, `POST /organizations/:orgId/billing/customer-portal`, `POST /organizations/:orgId/billing/usage-events`, and `POST /billing/polar/webhooks`.
- Implemented file-backed billing state plus in-memory test repository.
- Implemented Polar checkout with Zara organization ID as `externalCustomerId`, customer portal session creation, customer state webhook handling, order paid handling, optional `POLAR_WEBHOOK_SECRET` signature verification, processed webhook replay suppression, and usage-event idempotency.
- Added Better Auth Polar plugin composition for checkout, portal, usage, and webhook callbacks in `better-auth-polar.ts`.
- Updated `docs/API.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md`.
- Follow-up on 2026-06-22: changed Polar webhook verification to fail closed outside test/local mode when `POLAR_WEBHOOK_SECRET` is unset, and made the Coolify production API config require the secret.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- RED security follow-up: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts -t "webhook secret is unset" --pool=forks`
  - Failed as expected with HTTP 201 because production accepted a webhook without `POLAR_WEBHOOK_SECRET`.
- RED config follow-up: `npm.cmd run test:run -- packages/core/src/env.test.ts -t "Polar webhook secret" --pool=forks`
  - Failed as expected because production env validation did not require `POLAR_WEBHOOK_SECRET`.
- RED deploy follow-up: `npm.cmd run test:run -- packages/core/src/deployment-docs.test.ts -t "Coolify compose" --pool=forks`
  - Failed as expected because `compose.coolify.yml` defaulted `POLAR_WEBHOOK_SECRET` to empty.
- GREEN security follow-up: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts --pool=forks`
  - Passed: 1 file, 9 tests.
- GREEN config/deploy follow-up: `npm.cmd run test:run -- packages/core/src/env.test.ts packages/core/src/deployment-docs.test.ts --pool=forks`
  - Passed: 2 files, 10 tests.

## Pending Work

- None.

## Risks And Edge Cases

- Checkout completion after organization context changes is handled by Polar metadata and `externalCustomerId` pointing to the tenant organization ID.
- Webhook replay is suppressed by stored `polar-webhook-id` values.
- Usage events require an idempotency key and are not forwarded to Polar more than once.
- Provider secrets are read only by the backend Polar client and are not included in public responses.
- Missing webhook secret outside test/local mode now rejects Polar webhooks before payload processing.

## Decisions

- Priority: P0
- Labels: billing, auth, backend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Zara billing APIs own the public contract; `@polar-sh/better-auth` defines the Better Auth plugin wiring boundary, and `@polar-sh/sdk` performs checkout, portal, and event ingestion.
- Organization/tenant reference IDs are the cross-system join key for customer state, checkout, webhooks, and usage.
- Test/local mode may omit `POLAR_WEBHOOK_SECRET` for deterministic fixtures; production must set it through validated env and Coolify configuration.

## Next Recommended Step

Issue complete. When production credentials are added, set `POLAR_ACCESS_TOKEN`, `POLAR_SERVER`, and `POLAR_WEBHOOK_SECRET`, then register the `/billing/polar/webhooks` URL with Polar.
