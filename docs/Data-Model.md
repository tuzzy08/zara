# Data Model

## Core Entities

- organizations
- users
- organization_memberships
- workspaces
- workspace_memberships
- platform_roles
- platform_admin_audit_logs
- platform_impersonation_sessions
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

## Frontend Apps

- `apps/web` consumes tenant-scoped organization, workflow, runtime, memory, integration, telephony, monitoring, and billing models.
- `apps/platform-admin` consumes platform-scoped summaries and operational models. It must never receive raw tenant secrets or raw OAuth/telephony credentials.

## Roles

- Tenant roles: owner, admin, builder, operator, viewer.
- Workspace roles reuse the same role shape for workspace-local access: owner, admin, builder, operator, viewer.
- Platform roles: platform_owner, platform_admin, platform_support, platform_readonly.
- Tenant admin rights do not imply platform admin rights.
- Platform admin rights do not silently bypass tenant isolation; cross-tenant actions are explicit and audited.

## Workspaces

Workspaces belong to one tenant organization and scope product work without replacing Better Auth organizations. Workspace rows include tenant ID, name, URL-safe slug, status, created actor, and timestamps. Workspace membership rows include tenant ID, workspace ID, user ID, role, and status.

Workflow drafts, workflow versions, runtime manifests, sandbox sessions, monitoring views, and future workspace settings must carry workspace ID. The first implemented slice stores workspace IDs on published workflow versions, draft manifest previews, compiled runtime manifests, and browser-local sandbox workflow selection.

## Telephony

Telephony connections include ownership mode, provider, region, status, credential reference, inbound mapping, outbound caller ID policy, recording policy, failover settings, and health status.

## Integrations

Integration connections include provider, OAuth app ownership, scopes, encrypted credential reference, health, connected actor, tenant, and revocation state.

## Memory

Memory records include scope, subject reference, source call/transcript/tool, text/fact payload, embedding, confidence, approval state, retention state, and audit metadata.

## Invariants

- Every tenant-scoped row includes organization ID.
- Workspace-scoped rows include both organization ID and workspace ID.
- Workspace slugs are unique inside one tenant organization and may repeat across tenants.
- Every platform-admin action includes actor ID, role, action, target, and timestamp.
- Every workflow version is an immutable snapshot of a validated draft graph and manifest preview.
- Every call pins a workflow version and runtime manifest.
- Every secret is stored as an encrypted credential reference.
- Every durable memory record is visible and deletable through tenant policy.
- Every usage event is idempotent and attributable.
