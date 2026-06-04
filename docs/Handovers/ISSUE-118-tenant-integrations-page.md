# ISSUE-118: Tenant integrations page

Issue link: https://github.com/tuzzy08/zara/issues/118

## Goal

Deliver a real tenant-facing integrations page for `/integrations` so the dashboard sidebar route no longer renders the dashboard placeholder.

## Acceptance Criteria

- `/integrations` renders a tenant-facing integrations page instead of the dashboard placeholder
- Tenant admins can view connector connection status, health, revocation state, and available tool grants
- Connect, reconnect, revoke, and retry affordances never expose raw OAuth tokens or provider secrets

## Work Completed

- RED: added tenant app route smoke coverage proving `/integrations` must render the integrations page, show connection health/grants, and avoid raw OAuth token text.
- GREEN: added `TenantIntegrationsScreen` and `tenantIntegrationsApi.ts`, then wired `/integrations` in `App.tsx`.
- Implemented connection list, health check, revoke, reconnect/connect handoff, connector tool catalog, webhook HTTP tools, and workspace tool-grant visibility.
- Follow-up on 2026-06-04: added a secure Zendesk credential form to the tenant integrations page. Tenant admins can configure subdomain, email, and API token, while API URL remains hidden and non-configurable.
- Follow-up on 2026-06-04: fixed the backend save path used by the Zendesk credential form when `ZARA_INTEGRATION_STATE_DIR` is present but blank; the API now falls back to the default `.zara/integrations` state directory.
- Follow-up on 2026-06-04: added accessible provider logo badges to integration connection and catalog rows for Zendesk, HubSpot, Google Workspace, Notion, and webhook tools without loading remote brand assets.
- Follow-up on 2026-06-04: aligned tenant operations route smoke tests with the current compact dashboard, memory, and billing page content so CI no longer asserts removed page headers or commented dashboard panels.
- Added UI styling shared by the tenant integrations, memory, and billing pages.
- Created an imagegen mockup for the tenant pages at `C:\Users\Lenovo\.codex\generated_images\019e4708-d206-7400-bf03-6bdafa252492\ig_0abcab3dfada4980016a103d50f0688191adbcb6bdb9c0607d.png`.
- Updated `docs/Frontend-Architecture.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md`.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- RED: `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=threads --maxWorkers=1 --reporter=dot -t "configure Zendesk credentials"` failed because no Zendesk credential fields existed.
- GREEN: `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=forks --maxWorkers=1 --reporter=dot -t "configure Zendesk credentials"`
- GREEN: `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=forks --maxWorkers=1 --reporter=dot -t "tenant integrations controls|configure Zendesk credentials"`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- RED: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "blank" --pool=forks --maxWorkers=1 --reporter=dot` failed with `mkdir ''` and HTTP 500 when saving Zendesk credentials.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "blank" --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/api/src/persistence/tenant-json-state.repository.test.ts apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/integrations/integrations.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- RED: `npm.cmd run test:run -- apps/web/src/integrationProviderBranding.test.ts apps/web/src/telephonyCallsPageModel.test.ts` failed before provider branding helpers existed.
- GREEN: `npm.cmd run test:run -- apps/web/src/integrationProviderBranding.test.ts apps/web/src/telephonyCallsPageModel.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders tenant integrations controls"`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/WorkflowBuilder.test.tsx --reporter=verbose`
- GREEN: `npm.cmd run test:run`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run eval:runtime`
- GREEN: `npm.cmd run eval:pstn`
- GREEN: `npm.cmd run db:check`

## Pending Work

- None.

## Risks And Edge Cases

- OAuth callback after refresh is handled as a backend connect/callback concern; the page can reload current connection state from Nest.
- Revoked connectors remain visible with audit-safe health posture, and reconnect starts a new backend OAuth handoff.
- Public UI uses masked credential previews and does not render access or refresh tokens.
- Zendesk API tokens are password inputs and are cleared after save; the public connection list shows only account label plus masked credential preview.
- Blank integration state directory environment values should not break the form save path; they fall back to the default server-owned state directory.
- Provider logo badges are local CSS/text badges, so there is no remote asset dependency or token-bearing image request from the tenant app.

## Decisions

- Priority: P1
- Labels: frontend, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The page is intentionally a dense operations surface, not a marketing-style integration gallery.
- Built-in connector setup forms collect provider-specific credential/profile fields only. Tenants should not configure API base URLs for Zara-owned connectors.
- Provider branding should improve scan speed while preserving masked credential posture and compact operations density.

## Next Recommended Step

Reuse the Zendesk credential pattern for future provider-profile connectors, driven by provider docs and connector-owned endpoint metadata.
