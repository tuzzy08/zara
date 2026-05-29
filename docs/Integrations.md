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
- Google Workspace: calendar availability and event creation.
- Notion: knowledge search and task/page creation.
- Webhook/HTTP: tenant-defined tools with secure secrets.

## Knowledge Ingestion

The memory ingestion API accepts already-resolved content from documents, websites, PDFs, Notion, Google Drive, and CRM help centers. Connector fetchers should resolve provider credentials server-side, redact or filter content according to policy, and submit source text plus traceable URI or external IDs to the memory ingestion route. Ingestion status remains tenant-scoped and retryable failed sources can be resubmitted without duplicating successful sources.

## Runtime Use

Agents do not receive credentials. Runtime resolves tool grants, loads connector by integration connection ID, executes the tool, emits events, and redacts sensitive output before storage when policy requires it.

## OAuth Connector Tools

OAuth-backed connectors expose typed tool schemas and tenant-scoped execution routes for their first supported operations:

- Zendesk: `zendesk.tickets.search`, `zendesk.tickets.create`, and `zendesk.tickets.update`.
- HubSpot: `hubspot.contacts.lookup`, `hubspot.notes.create`, and `hubspot.pipeline.update`.
- Google Workspace: `google.calendar.availability.read` and `google.calendar.events.create`.
- Notion: `notion.knowledge.search`, `notion.pages.create`, and `notion.tasks.create`.

Connector execution requires a connected, non-revoked OAuth connection in the same tenant plus the tool's required scopes. Public responses return typed safe outputs and structured recoverable errors such as Zendesk rate limits or HubSpot duplicate contacts. OAuth access and refresh tokens stay encrypted in the integrations state store and are never returned by schema or execution APIs.

## Connector Health And Revocation

OAuth-backed connections expose health state, lifecycle status, and audit events in tenant-facing responses without returning raw credential material. Tenant admins can trigger health checks, revoke compromised or stale connections, and reconnect by starting OAuth with a `reconnectConnectionId`.

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
