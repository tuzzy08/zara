# ADR-003: Confluence And SharePoint Knowledge Source Selection

Status: Accepted

Date: 2026-06-08

## Context

ISSUE-169 adds Confluence and SharePoint as knowledge-source connectors after the provider registry stabilized. Tenant users need a simple setup surface, but built-in provider API URLs, endpoint paths, auth headers, and payload shapes must remain Zara-owned connector metadata. SharePoint knowledge ingestion also must not reuse or broaden Microsoft 365 Outlook Calendar v1 scopes.

## Decision

Confluence and SharePoint are exposed as knowledge-source connectors only. Tenant setup collects stable provider-resource selections:

- Confluence: `page:<pageId>` or `space:<spaceId>`.
- SharePoint: `site:<siteId>:page:<pageId>` or `site:<siteId>:drive:<driveId>:item:<itemId>`.

Zara resolves these selections server side against documented provider APIs, creates review-gated record drafts, and stores source URIs for provenance. Provider API bases, endpoint paths, auth headers, tokens, and arbitrary provider search remain hidden from tenant users and runtime calls.

SharePoint uses knowledge-source scopes `Files.Read` and `Sites.Read.All` in this v1 connector. Microsoft 365 Outlook Calendar remains a separate provider surface with calendar-only scopes.

## Consequences

- The tenant UI stays compact and safer because users select provider resources instead of configuring URLs.
- Runtime retrieval can continue using only approved Zara knowledge records.
- Provider import tests can assert documented request paths without exposing those paths through the catalog API.
- Future richer pickers may replace manual stable IDs, but they must keep the same server-owned connector boundary.
