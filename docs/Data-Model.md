# Data Model

## Billing Delivery Decisions

Migration `0041_billing_delivery_decisions.sql` adds the append-only owner decision table. Each row stores its request ID, ordered sequence, enabled state, server time, actor, reason, prior decision ID, and the catalog/release for an enable. The database rejects updates and deletes. `billing_outbox.delivery_decision_id` links eligible new charge events to their decision. Existing rows retain null links and are not automatically delivered.

## Auth MFA Proof

Auth migration `0042_auth_mfa_assurance.sql` adds the native `twoFactor` table, `user.twoFactorEnabled`, `session.mfaVerifiedAt`, and `session.mfaFactorId`. The factor has a monotonic `lastVerifiedStep` so two API instances cannot grant proof from the same code step. The plugin encrypts factor secrets. New sessions clear proof; caller input cannot set the proof or consumed step. Session reads reject proof from a removed or replaced factor, including a late write from an earlier verification. Preserve these additive fields on application rollback.

## Runtime Prompt Policy Revisions

Migration `0040_runtime_prompt_policy_revisions.sql` adds three tables:

- `runtime_prompt_policy_revisions`: immutable policy JSON, revision number, content hash, and creation time.
- `runtime_prompt_policy_current`: one pointer to the current revision. A database function checks the expected version and writes the next revision atomically.
- `runtime_prompt_policy_session_pins`: one saved revision and hash for each session key. Session keys include the runtime path and organization scope. Reopening the same session selects the saved revision.

On first startup, the Postgres repository imports the current legacy file policy if one exists. Otherwise, it stores the built-in default as the initial revision. Later starts retain the stored policy. Policy reads verify the content hash. Premium PSTN dispatch snapshots also carry the selected revision and hash inside their checksum. A worker must load that exact revision before it starts the provider session.

Rollback promotes an older policy as a new revision. It does not modify history or change active session selections. Apply migration 0040 before starting the updated API.

Drain calls created by the previous release before replacing their workers. Older premium dispatch snapshots do not contain a prompt revision and hash. The updated worker rejects such snapshots; it must not substitute the latest policy for an unknown call-start policy.

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

Telephony connections include ownership mode, provider, region, status, credential reference, inbound mapping, outbound caller ID policy, recording policy, failover settings, and health status. Call lifecycle state keeps the first trusted provider connection time through terminal persistence so billing can calculate connected seconds without a client-supplied duration.

## Integrations

Integration connections include provider, OAuth app ownership, scopes, encrypted credential reference, health, connected actor, tenant, and revocation state.

## Memory

Memory records include scope, subject reference, source call/transcript/tool, text/fact payload, embedding, confidence, approval state, retention state, and audit metadata.

## Billing

AssemblyAI sandbox usage uses the same connection and request tables. A request is linked to a pre-socket connection attempt. Its result retains the provider session ID and native integer `audioDurationSeconds` and `sessionDurationSeconds`, not conversation content. The tenant and sandbox session come from the server. The shared scope and PSTN call ID remain null; no exclusive account or phone-call identity is inferred. Missing termination data leaves the request unresolved. These rows alone cannot qualify release evidence.

`provider_usage_requests` contains server-owned supplier request records, separate from the customer ledger. Each row has tenant, optional session/project identity, provider/model, request time, and an optional final native usage result. Request fields are immutable. A result can be written once; final records cannot be updated or deleted. Missing results remain unresolved. Platform-only shared-scope reads do not assign shared usage to a tenant.

An observed event that already contains final usage inserts its request and result together. Existing unresolved rows use the guarded final-result write. Concurrent exact replay retains one result; conflicting facts are rejected. Stored unresolved request identities also feed the private operator review report. Unknown quantities remain null. No new table or recovery API is introduced.

Realtime response rows use a deterministic ID from provider, project, and response identity. Cross-tenant or changed session/model replay is rejected. Their time is the first Zara receipt time, retained across retries, not an invented provider timestamp. The final JSON result can also contain response status and native token details. The stored session is the premium runtime session ID, not an inferred PSTN call ID. Audio, transcript, and separate input-transcription usage are not stored in this result.

Separate Realtime transcription rows retain the same OpenAI project and server tenant/session identity, but use the configured transcription model. Their source key includes provider session ID, item ID, and content index. Completed results use `sourceKind: realtime_transcription`, one `transcriptionRequestCount`, and a selected native `transcription.usage` token or duration object. Duration remains in seconds, including its fractional part. Missing or failed usage has no final result. Tenant readback includes provider and model. The completion comparison excludes these separate transcription results; this exclusion does not establish complete coverage. A separate platform-only transcription reader returns the immutable row ID, tenant, project, model, receipt time, and native usage. It counts unresolved OpenAI requests without guessing their endpoint and keeps `complete: false`. The independent transcription report remains a private operator artifact, not a customer ledger fact or database release approval.

`provider_usage_connections` stores server-owned connection attempts separately from native usage. It keeps tenant, premium session, provider, model, shared project, and start time. Its optional final result contains only end time, `closed` or `failed` outcome, and provider session ID. Starts cannot change, and a final result is written once. Exact replay is allowed; a changed result or cross-tenant final write is rejected. Shared reads include period-overlapping connections and older unresolved starts. These records are not customer quantities and do not prove complete usage capture.

Migration 0039 adds nullable `provider_usage_requests.connection_id` and `provider_usage_connections.call_session_id`. The call ID comes from the verified PSTN dispatch or the active call during an agent transfer. It is not derived from `actorUserId`. Both response and transcription rows link to their own connection. A database insert guard requires matching tenant, premium session, provider, and project. The model need not match because transcription has its own model. Existing immutability guards also protect the new columns. Replay cannot replace a link or add one to a historical unlinked row. Tenant reads and platform reports return the stored premium session, connection, and call links. Null means unknown or not applicable; it is not reconstructed. Rollback retains the columns if any link exists.

The approved price catalog is global, versioned, and immutable. Tenant-owned billing customers, subscriptions, cycles, budget policies, entitlements, invoices, ledger entries, adjustments, PAYG orders, PAYG credit entries, reservation accounts, charge reservations, webhook receipts, and outbox records use Postgres.

Money uses integer USD minor units. Ledger entries keep customer charges and supplier costs in separate fields. Trusted runtime facts keep raw seconds. Platform-managed carrier facts keep route-rounded minutes. Non-billable and incomplete facts remain explicit. Tenant-qualified idempotency keys prevent duplicate usage charges and duplicate PAYG credit changes. PAYG debit entries store the related `session_id`, and their outbox events use the credits-only `payg_charge_minor` meter. A tenant reservation-account row serializes concurrent reservation, finalization, and release updates. Charge reservations use tenant-qualified keys and cannot increase the active reserved amount above current paid PAYG credit. A finalized reservation stores its actual amount, session ID, and finalization time. Its actual amount cannot exceed its reserved amount. A failed-start release stores its release time, returns its full claim, and creates no debit. `billing_tenant_states` is a non-authoritative public read-model cache; it is not financial history.

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
- Every durable billing fact is tenant-owned, except the global approved catalog and provider mapping configuration.
- Published catalog, ledger, adjustment, and PAYG credit rows are append-only.
