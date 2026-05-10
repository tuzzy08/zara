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

## Runtime Use

Agents do not receive credentials. Runtime resolves tool grants, loads connector by integration connection ID, executes the tool, emits events, and redacts sensitive output before storage when policy requires it.
