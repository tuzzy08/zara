# Integrations

## Auth Model

V1 uses Zara-owned OAuth apps. Tenant admins connect accounts through provider consent screens. Tokens are encrypted and stored as tenant-scoped credential references.

## Connector Requirements

- Minimal scopes.
- Token refresh.
- Reconnect and revoke.
- Health check.
- Rate-limit handling.
- Tool schemas.
- Per-role and per-workflow grants.
- No raw token exposure to agents or clients.

## Initial Connectors

- Zendesk: ticket search/create/update.
- HubSpot: contact lookup, notes, pipeline updates.
- Salesforce: account/contact/case lookup, create task, create case, and add call note.
- Slack: bounded escalation posts, failed-call/provider-health alerts, and post-call summaries to configured destinations.
- Microsoft 365: Outlook Calendar availability and event creation.
- Shopify: read-only customer, order, fulfillment, and shipping-status lookup.
- Google Workspace: calendar availability and event creation.
- Notion: knowledge search and task/page creation.
- Webhook/HTTP: tenant-defined tools with secure secrets.

## Knowledge Ingestion

The memory ingestion API accepts already-resolved content from documents, websites, PDFs, Notion, Google Drive, and CRM help centers. Connector fetchers should resolve provider credentials server-side, redact or filter content according to policy, and submit source text plus traceable URI or external IDs to the memory ingestion route. Ingestion status remains tenant-scoped and retryable failed sources can be resubmitted without duplicating successful sources.

## Runtime Use

Agents do not receive credentials. Runtime resolves tool grants, loads connector by integration connection ID, executes the tool, emits events, and redacts sensitive output before storage when policy requires it.

## Connector Tools And Provider Profiles

Connector-backed tools expose typed schemas and tenant-scoped execution routes for their first supported operations:

- Zendesk: `zendesk.tickets.search`, `zendesk.tickets.create`, and `zendesk.tickets.update`.
- HubSpot: `hubspot.contacts.lookup`, `hubspot.notes.create`, and `hubspot.pipeline.update`.
- Salesforce: `salesforce.accounts.lookup`, `salesforce.contacts.lookup`, `salesforce.cases.lookup`, `salesforce.tasks.create`, `salesforce.cases.create`, and `salesforce.call_notes.create`.
- Slack: `slack.escalations.post`, `slack.alerts.post`, and `slack.call_summaries.post`.
- Microsoft 365: `microsoft365.calendar.availability.read` and `microsoft365.calendar.events.create`.
- Shopify: `shopify.customers.lookup`, `shopify.orders.lookup`, `shopify.fulfillments.lookup`, and `shopify.shipping_status.lookup`.
- Google Workspace: `google.calendar.availability.read` and `google.calendar.events.create`.
- Notion: `notion.knowledge.search`, `notion.pages.create`, and `notion.tasks.create`.

Connector execution requires a connected, non-revoked connection in the same tenant plus the tool's required scopes. Provider API base URLs, paths, and documented payload shapes are owned by Zara connector metadata and implementation; tenants must not configure arbitrary provider API URLs for built-in connectors. Public responses return typed safe outputs and structured recoverable errors such as Zendesk rate limits or HubSpot duplicate contacts. OAuth access tokens, refresh tokens, API tokens, and provider secrets stay encrypted in the integrations state store and are never returned by schema or execution APIs.

## Provider Registry And Catalog

The ISSUE-156 registry foundation uses a hybrid contract. Safe shared metadata lives in `@zara/core` and includes provider IDs, labels, categories, capabilities, setup fields, logo tokens, tool IDs/names, risk posture, knowledge-source flags, provider documentation references, and docs-verified dates. API-owned registry metadata keeps provider base URLs, auth header construction, secret schema IDs, and executor IDs server-side.

Tenant clients read the catalog through `GET /organizations/:orgId/integrations/catalog` or a single supported provider through `GET /organizations/:orgId/integrations/catalog/:provider`. Unsupported provider IDs return `404`. Catalog responses are tenant-safe and do not expose base URLs, endpoint paths, auth headers, secret schemas, executor details, OAuth tokens, API tokens, or decrypted credentials.

Zendesk supports a tenant-configured API-token profile through `POST /organizations/:orgId/integrations/zendesk/configure`. Tenant admins provide only the Zendesk subdomain, integration email, and API token. Zara derives `https://{subdomain}.zendesk.com` and executes `zendesk.tickets.create` against the Tickets API `POST /api/v2/tickets` endpoint with Zendesk's documented top-level `ticket` payload. Zara uses the Tickets API for agent/admin-side workflow tools because those tools execute with tenant-owned agent or admin credentials and may set ticket attributes. If Zara later adds customer self-service or anonymous submission flows, those should be modeled as separate Request tools using Zendesk's Requests API rather than overloading the ticket tool.

Salesforce v1 uses Zara-owned OAuth setup with Salesforce's documented `api` and `refresh_token` scopes in tenant-facing reconnect/publish validation. Runtime executes server-owned REST API contracts under `services/data/v60.0` for safe account/contact/case lookups and additive task/case/call-note writes. Pipeline stage mutation, owner changes, destructive updates, deletes, and broad object mutation are intentionally absent from the catalog and connector schemas. Object-level permission denials are mapped as provider permission failures at execution time.

Slack v1 uses Zara-owned OAuth setup with Slack's `chat:write` scope. Tenant admins configure allowed Slack destinations through `POST /organizations/:orgId/integrations/slack/destinations`; Zara stores the destination IDs, channel IDs, display names, and purpose classifications in encrypted tenant credential state. Runtime executes `chat.postMessage` only through bounded escalation, alert, and call-summary templates, and each tool is restricted to a destination with the matching configured purpose. Arbitrary agent-generated Slack messages, arbitrary DMs, channel-history reads, message updates, and deletes are intentionally absent from the catalog and connector schemas.

Microsoft 365 v1 uses Zara-owned OAuth setup with Microsoft Graph `Calendars.ReadBasic` for Outlook availability reads and `Calendars.ReadWrite` for event creation. Runtime executes Graph `getSchedule` through `POST /me/calendar/getSchedule` and event creation through `POST /me/calendars/{calendarId}/events` with Zara-owned payloads, timezone fields, bearer auth, and Graph `transactionId` idempotency when a runtime idempotency key is available. Email send/read, mailbox search, Teams notification, calendar update/delete tools, `Calendars.ReadWrite.Shared`, and broad Graph scopes are intentionally absent from the catalog and connector schemas.

Shopify v1 uses Zara-owned OAuth setup with a required tenant-provided Shopify store domain such as `acme-store.myshopify.com`. Zara derives the Admin GraphQL endpoint under `/admin/api/2026-04/graphql.json` server-side and stores the shop domain with the encrypted credential metadata. Runtime executes only read-only Admin GraphQL lookups for customers, orders, fulfillments, and shipping status with `read_customers`, `read_orders`, and `read_fulfillments` scopes. Refunds, cancellations, address edits, draft orders, discounts, inventory changes, generic mutations, raw Admin API URLs, auth headers, and GraphQL payloads are intentionally absent from tenant-facing catalogs and setup forms.

## Connector Health And Revocation

OAuth-backed and API-token-backed connections expose health state, lifecycle status, and audit events in tenant-facing responses without returning raw credential material. Tenant admins can trigger health checks, revoke compromised or stale connections, and reconnect by starting OAuth with a `reconnectConnectionId` or by saving a fresh provider profile for credential-based connectors.

The tenant integrations page shows accessible local provider logo badges for connection and catalog rows so operators can scan Zendesk, HubSpot, Google Workspace, Microsoft 365, Notion, Slack, Salesforce, Shopify, and webhook tools without remote image requests or credential-bearing asset loads.

Revocation behavior:

- Revoked connections remain visible with audit history instead of being deleted.
- Runtime tool grants tied to revoked connections are denied with `integration_connection_revoked`.
- Reconnect creates a fresh connected credential reference while preserving prior audit events and linking the new connection to the revoked predecessor.
- Health checks record timestamped audit events and mark revoked connections as revoked rather than trying to use missing credentials.

## Webhook HTTP Tools

Tenant admins can define webhook HTTP tools with a method, HTTPS URL, headers, optional body template, timeout, retry policy, and optional bearer token. Public tool schemas expose only a `secret://webhook-http-tools/:toolId/auth-token` reference; the raw token is encrypted in the integration state store and resolved only during runtime execution.

Runtime webhook execution:

- Interpolates tenant, workspace, call, actor, and turn transcript templates server side.
- Injects the resolved bearer token only when the tool did not provide an explicit authorization header.
- Retries transient 5xx or network failures according to the stored `maxAttempts` and `backoffMs`.
- Aborts slow endpoints according to the stored `timeoutMs` and reports a structured timeout error to the live sandbox tool flow.

## Post-Call CRM Sync

Post-call summaries can include a CRM sync target for supported providers such as HubSpot. The live-session summary route records only the intended provider, integration connection ID, object type, and optional external object ID, queues the sync state for downstream processing, and redacts transcript/tool content before the summary response is returned or summary metadata is emitted.

Operators can read post-call CRM sync state from the live-session monitoring API. Failed sync events expose only safe diagnostics: code, message, retryability, and next step. Retry requests append metadata-only `post_call.crm_sync.retry_queued` events with attempt counts and retry timing; provider credentials and OAuth tokens remain isolated to downstream connector workers.

## Tool Grants

Workflow tools require explicit tenant-admin grants before runtime execution.

- Grants are scoped to tenant, workspace, published workflow version, tool ID, integration connection ID, and optionally role ID.
- Un-granted integration tools emit `tool.failed` with `tool_permission_denied` and do not execute connector handlers.
- Grants can require human approval for high-risk tools. In that case runtime emits `tool.approval_required` and does not execute the tool until a later approval workflow is implemented.
- Public grant responses never include OAuth tokens or decrypted credential material.
