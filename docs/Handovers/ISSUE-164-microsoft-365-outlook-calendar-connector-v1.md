# ISSUE-164: Microsoft 365 Outlook Calendar connector v1

Status: Implemented
External: [Linear ZAR-118](https://linear.app/zara-voice/issue/ZAR-118/issue-164-microsoft-365-outlook-calendar-connector-v1)

## Goal

Add Microsoft 365 Outlook Calendar availability and event creation without broad Graph or mailbox access.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-158 and ISSUE-159.
- Moved Linear ZAR-118 and the local backlog entry to In Progress for the implementation pass.
- Confirmed v1 scope: Outlook Calendar availability reads and event creation only.
- Added public `@zara/core` catalog metadata for provider id `microsoft-365`, label `Microsoft 365`, productivity category, `microsoft-365` logo token, OAuth setup with no setup fields, calendar/agent-tool capabilities, and no knowledge-source support.
- Added the two v1 Outlook Calendar tools: `microsoft365.calendar.availability.read` with `Calendars.ReadBasic` and low risk, plus `microsoft365.calendar.events.create` with `Calendars.ReadWrite`, medium risk, and `post-call-sync` capability.
- Added frontend branding, workflow-builder tool grouping, Microsoft 365-only connection filtering, event-create approval defaults, and default OAuth requested scopes for the two v1 tools.
- Added regression assertions that Microsoft 365 v1 does not expose email send/read, mailbox search, Teams notification, broad Graph scopes, calendar update/delete tools, or frontend/server-only connector metadata.
- Added server-only provider metadata for Microsoft Graph under `provider-registry.service.ts`, including Graph base URL, OAuth bearer strategy, Microsoft 365 secret schema, and executor id.
- Added Microsoft 365 OAuth client wiring through the existing Zara-owned OAuth connect flow.
- Implemented `microsoft365.calendar.availability.read` against Microsoft Graph `POST /me/calendar/getSchedule` with explicit timezone payloads, normalized busy intervals, rate-limit mapping, tenant isolation, and secret redaction.
- Implemented `microsoft365.calendar.events.create` against Microsoft Graph `POST /me/calendars/{calendarId}/events` with explicit timezone payloads, optional attendee/body fields, Graph `transactionId` idempotency when a runtime idempotency key is available, rate-limit mapping, tenant isolation, insufficient-scope blocking before fetch, and secret redaction.
- Added grant/runtime safety coverage for low-risk availability reads, approval-required event creation, missing `Calendars.ReadWrite` reconnect prompts, and side-effect detection.
- Updated integration docs, roadmap slice summary, and backlog status.

## Tests Run

- RED: `npx.cmd vitest run packages/core/src/provider-registry.test.ts` failed as expected before implementation because `microsoft-365` was absent from provider ids/catalog and required scope lookups.
- RED: `npx.cmd vitest run apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` failed as expected before implementation because Microsoft 365 branding, tool grouping, connection filtering, and default scopes were absent.
- GREEN: `npx.cmd vitest run packages/core/src/provider-registry.test.ts` passed, 7 tests.
- GREEN: `npx.cmd vitest run apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` passed, 11 tests.
- GREEN: `npm.cmd run typecheck --workspace @zara/core` passed.
- GREEN: `npm.cmd run build --workspace @zara/core` passed.
- GREEN: `npm.cmd run typecheck --workspace @zara/web` passed after rerunning sequentially once `@zara/core` build had refreshed the shared type declarations. A parallel first attempt saw stale core declarations and failed on the missing `microsoft-365` type.
- RED: `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts packages/core/src/provider-registry.test.ts` failed as expected for missing Microsoft 365 connector execution and grant support. The same interrupted run also produced noisy Zendesk failures after the first contract test timed out; those did not reproduce after the GREEN implementation.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts packages/core/src/provider-registry.test.ts -t "Microsoft 365|side-effect ledger"` passed, 5 tests.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts packages/core/src/provider-registry.test.ts apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` passed, 49 tests.
- GREEN: `npm.cmd run typecheck:core` passed.
- GREEN: `npm.cmd run build --workspace @zara/core` passed.
- GREEN: `npm.cmd run typecheck --workspace @zara/api` passed after rerunning with a longer timeout; the first run hit the command timeout without emitting a TypeScript error.
- GREEN: `npm.cmd run typecheck --workspace @zara/web` passed.

## Pending Work

- None for ISSUE-164. Continue with ISSUE-165.

## Risks And Edge Cases

- Event creation is a write side effect and can duplicate.
- Calendar timezone handling can drift from tenant or caller timezone.
- Email/mailbox scopes must not leak into v1 setup.
- Microsoft Graph event creation uses `transactionId` when runtime idempotency is available; unknown post-send timeouts still rely on the existing side-effect unknown classification path.
- Frontend default scopes include `Calendars.ReadWrite` so event creation can work in v1; backend reconnect/publish/runtime validation enforces exact granted scopes before execution.

## Decisions

- Microsoft 365 v1 is Outlook Calendar only.
- Email send/read, mailbox search, Teams notification, and broad Graph scopes are out of v1.
- Provider id is `microsoft-365`; tenant-facing tool ids use the compact `microsoft365.calendar.*` prefix to avoid punctuation-heavy workflow tool ids while keeping the provider grouping label as Microsoft 365.
- Availability reads use Microsoft Graph `getSchedule`; event creation uses Microsoft Graph create-event endpoints.
- Availability reads use least-privilege `Calendars.ReadBasic`; event creation uses `Calendars.ReadWrite`. Mail, Teams, shared-calendar, and broad Graph scopes remain absent.
- Event creation uses Microsoft Graph `transactionId` as the provider idempotency hook when Zara has a runtime idempotency key.
- Event creation carries `post-call-sync` because the existing registry pattern safely marks additive write tools, such as Salesforce task/case/call-note creation and Slack call summaries, as post-call-sync capable. Availability read does not carry `post-call-sync`.
- Official tenant-safe docs references are Microsoft Graph getSchedule, create event, and permissions reference pages on `learn.microsoft.com`.

## Next Recommended Step

Start ISSUE-165 Intercom connector v1.
