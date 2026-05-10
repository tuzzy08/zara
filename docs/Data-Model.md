# Data Model

## Core Entities

- organizations
- users
- organization_memberships
- invitations
- audit_logs
- agents
- agent_roles
- workflow_drafts
- workflow_versions
- workflow_nodes
- workflow_edges
- runtime_manifests
- call_sessions
- call_events
- transcripts
- recordings
- telephony_connections
- phone_numbers
- integration_connections
- tool_definitions
- tool_grants
- memory_records
- knowledge_sources
- usage_events
- budgets

## Telephony

Telephony connections include ownership mode, provider, region, status, credential reference, inbound mapping, outbound caller ID policy, recording policy, failover settings, and health status.

## Integrations

Integration connections include provider, OAuth app ownership, scopes, encrypted credential reference, health, connected actor, tenant, and revocation state.

## Memory

Memory records include scope, subject reference, source call/transcript/tool, text/fact payload, embedding, confidence, approval state, retention state, and audit metadata.

## Invariants

- Every tenant-scoped row includes organization ID.
- Every call pins a workflow version and runtime manifest.
- Every secret is stored as an encrypted credential reference.
- Every durable memory record is visible and deletable through tenant policy.
- Every usage event is idempotent and attributable.
