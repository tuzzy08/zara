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
- Added UI styling shared by the tenant integrations, memory, and billing pages.
- Created an imagegen mockup for the tenant pages at `C:\Users\Lenovo\.codex\generated_images\019e4708-d206-7400-bf03-6bdafa252492\ig_0abcab3dfada4980016a103d50f0688191adbcb6bdb9c0607d.png`.
- Updated `docs/Frontend-Architecture.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md`.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- `npm.cmd run typecheck`
- `npm.cmd run lint`

## Pending Work

- None.

## Risks And Edge Cases

- OAuth callback after refresh is handled as a backend connect/callback concern; the page can reload current connection state from Nest.
- Revoked connectors remain visible with audit-safe health posture, and reconnect starts a new backend OAuth handoff.
- Public UI uses masked credential previews and does not render access or refresh tokens.

## Decisions

- Priority: P1
- Labels: frontend, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The page is intentionally a dense operations surface, not a marketing-style integration gallery.

## Next Recommended Step

Issue complete. Reuse the same tenant page shell patterns for future connector-specific deep detail views.
