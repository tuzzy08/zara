# ADR-001: Stripe Read-Only OAuth Scope Handling

Status: Accepted
Date: 2026-06-07

## Context

ISSUE-167 adds Stripe v1 read-only billing lookup tools. Zara needs an internal capability/scope marker that lets grants, reconnect prompts, publish validation, and runtime checks prove the connected Stripe account is read-only for v1 tool use.

Stripe's OAuth documentation identifies `read_only` as the read-only posture, but current provider behavior can default Standard account OAuth to read-only and does not require Zara to expose raw Stripe API details or write scopes in tenant setup.

## Decision

Zara will use `read_only` as the internal required scope for all Stripe v1 connector tools and grant validation. When building the Stripe OAuth authorization URL, Zara omits `read_only` from the outbound `scope` query parameter if it is the only requested scope, preserving the provider's read-only default behavior while keeping Zara's internal grant model explicit.

Stripe API base URLs, auth headers, request paths, request payloads, and secret schema details remain server-owned connector metadata and are not configurable by tenants.

## Consequences

- Tenant-facing reconnect prompts and publish validation can still reason over `read_only`.
- The external OAuth URL avoids brittle provider-specific scope parameters for the read-only-only v1 setup.
- Future Stripe write tools, if ever approved, must add a new ADR and separate scopes/approval posture rather than expanding this v1 read-only decision silently.
