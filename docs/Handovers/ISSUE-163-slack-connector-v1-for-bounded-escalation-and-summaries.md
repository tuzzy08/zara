# ISSUE-163: Slack connector v1 for bounded escalation and summaries

Status: Implemented
External: [Linear ZAR-117](https://linear.app/zara-voice/issue/ZAR-117/issue-163-slack-connector-v1-for-bounded-escalation-and-summaries)

## Goal

Add Slack for bounded escalation, provider-health/failed-call alerts, and configurable post-call summaries.

## Work Completed

- Added tenant-safe Slack provider catalog metadata for `slack.escalations.post`, `slack.alerts.post`, and `slack.call_summaries.post` only; all use OAuth `chat:write`, expose docs references, and keep raw Slack endpoint/auth/executor metadata server-side.
- Added Slack server registry metadata, OAuth client ID mapping, frontend default scopes, provider logo branding, and workflow-builder grouping/connection filtering.
- Added tenant-admin Slack destination configuration through `POST /organizations/:orgId/integrations/slack/destinations`, with encrypted destination persistence and audit events.
- Implemented bounded Slack execution against `https://slack.com/api/chat.postMessage` with fixed escalation, alert, and call-summary templates, Slack metadata idempotency keys, secret redaction, rate-limit mapping, and health degradation on provider failures.
- Enforced destination purpose matching so escalation, alert, and post-call-summary tools can only post to destinations configured for that tool class.
- Added grant/scope coverage for Slack `chat:write`, approval posture, and reconnect prompts for missing scopes.
- Added side-effect detection coverage so Slack post tools participate in the live sandbox side-effect ledger.
- Kept arbitrary Slack messages, arbitrary DMs, channel-history reads, message updates, and deletes out of the catalog and workflow builder.

## Tests Run

- `npx.cmd vitest run packages/core/src/provider-registry.test.ts` RED failed for missing Slack, then GREEN passed 6 tests.
- `npx.cmd vitest run apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` RED failed for missing Slack branding/catalog mapping, then GREEN passed 8 tests.
- `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts packages/core/src/provider-registry.test.ts apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts apps/web/src/integrationSetupPresets.test.ts` passed 68 tests.
- `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts` passed 50 tests after the destination-purpose guard.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx` passed 55 tests.
- `npm.cmd run typecheck:core` passed.
- `npm.cmd run build --workspace @zara/core` passed.
- `npm.cmd run typecheck --workspace @zara/web` passed.
- `npm.cmd run typecheck --workspace @zara/api` passed.

## Pending Work

- None for ISSUE-163. Follow-up providers continue with ISSUE-164 and later issues.

## Risks And Edge Cases

- Slack connections without configured destinations fail safely before provider calls.
- Destination-purpose mismatch fails safely before provider calls.
- Slack rate limits return structured recoverable 429 responses with retry timing.
- Slack destination config is stored as encrypted JSON because the current secret vault preserves string values.

## Decisions

- Used the existing `productivity` category because `monitoring` is not an existing safe registry category.
- Did not add a new public `connection` capability; Slack uses OAuth setup metadata plus `agent-tool` and `post-call-sync` capabilities.
- Slack v1 tools accept destination/template inputs, not raw arbitrary message text.
- Slack destination purpose is enforced at execution time for escalation, alert, and post-call-summary tools.

## Next Recommended Step

Start ISSUE-164, Microsoft 365 Outlook Calendar connector v1, after ZAR-117 is closed in Linear and CI is green.
