# Security And Compliance

## V1 Baseline

Zara targets general SaaS readiness: consent, audit logs, encryption, redaction, retention controls, tenant isolation, and abuse prevention. V1 does not claim HIPAA or PCI readiness.

`GET /organizations/:orgId/compliance/readiness` exposes this posture to tenant/admin surfaces as a general SaaS checklist. It returns explicit `hipaa: false` and `pci: false` claims, lists ready controls for encryption, audit, retention, consent, and access control, and documents known gaps for regulated-data onboarding and tenant-configurable data residency.

## Required Controls

- Better Auth sessions and organization membership checks.
- Tenant invitations must be created, revoked, and accepted through Zara-owned API routes that enforce Better Auth organization invitation permissions, invited-email matching, invitation status, expiry, and active workspace intent before granting workspace access.
- Separate tenant app and platform-admin app origins.
- Platform roles separate from tenant roles.
- Tenant-scoped data access.
- Encrypted secrets with key version metadata.
- Short-lived browser sandbox session tokens; no long-lived STT, TTS, or telephony provider credentials in the client.
- Audit logs for sensitive actions.
- Tenant compliance audit logs are append-only through the API and hash-chained for v1 tamper evidence.
- Provider webhook signature verification.
- Twilio media WebSocket attachment must resolve to a server-created, signature-verified execution session before any media is accepted. Twilio custom parameters are metadata only and never tenant/session authority.
- PSTN phone tests must use protected `testRoute` waiting sessions with at least one allowed caller number, future expiry, and tenant-scoped number ownership. Expired and unauthorized caller attempts must store sanitized operator-readable results without raw media or provider payloads.
- Retention and deletion workflows.
- Retention jobs apply tenant cutoffs to telephony calls, call-control transcript events, memory/knowledge/embedding data, ingestion sources, and recording object deletions.
- Call consent and recording notices.
- Two-party recording policy queues a caller-facing recording notice before provider bridge/origination commands, and dispatch/session state records the consent posture.
- Outbound abuse limits and do-not-call support.
- Outbound dispatch can enforce tenant rate windows, block burst campaigns, pause tenant telephony, and write review audit records.
- Outbound dispatch can block tenant DNC destinations and unknown destination timezones, while audited emergency overrides can bypass safe calling windows.
- Prompt injection defenses for tools and knowledge.
- Runtime model prompts keep system instructions separate from untrusted tool output, session memory, retrieved knowledge, CRM notes, and website content.
- Runtime validates structured agent action output and ignores unsupported graph commands from the model instead of speaking or obeying them.
- Runtime validates tool requests, approval gates, timeout/rate-limit failures, partial tool output, and transfer language compatibility as packet-backed policy states before model projection.
- Redaction runs before live-session event and memory storage when the manifest enables transcript redaction.
- LangSmith and OpenTelemetry exports receive only redacted AI trace projections. Raw credentials, raw tool output, unredacted transcript, payment data, and audio payloads must never be exported to third-party observability systems.
- Invitation lifecycle events must be audit-visible. Invitation create, accept, revoke, and workspace-access grant outcomes must carry actor IDs and tenant/workspace scope; cross-tenant revoke/accept attempts must fail with product-safe errors.

## Known Compliance Gaps

- Regulated-data programs that require HIPAA, PCI, or a signed BAA need a separate enterprise review before onboarding.
- Tenant-configurable data residency, region pinning, and residency attestations are not available in the v1 control plane.

## Threats

- Cross-tenant data access.
- Credential leakage.
- Prompt injection through CRM notes, websites, or tool output.
- Outbound spam and account compromise.
- Recording without consent.
- Stale or false memory.
- Provider webhook replay.
- Browser sandbox token replay or cross-workspace session reuse.
- PSTN media stream session guessing, malformed media payloads, forged provider custom parameters, or unauthorized callers attempting to enter protected phone-test routes.

## Platform Admin Controls

Platform admin access is for Zara staff only. It must be protected by platform roles, stricter operational logging, and server-side guards. Impersonation is time-boxed, visible, revocable, and audited. Platform admins must not see raw secrets, raw OAuth tokens, or decrypted provider credentials.

AI runtime observability is also a staff-only platform-admin surface. The platform-admin API may expose redacted LangSmith experiment links, local trace IDs, eval regression status, redaction state, and release-owner metadata to Zara staff, but tenant-facing dashboards must not expose those internal links or cross-tenant trace metadata. Failing eval references must remain redacted and must never include raw caller text, raw tool output, provider payloads, credentials, or audio.

## Live Sandbox Controls

- Browser sandbox sessions must be scoped to tenant, workspace, manifest source, and runtime profile.
- NestJS should mint short-lived sandbox transport tokens and reject replayed, expired, or cross-workspace reuse.
- Sandbox transport tokens are HMAC-signed, hashed before persistence, and consumed on first successful websocket bootstrap.
- Browser reconnect must request a fresh one-time transport token instead of reusing the original websocket URL.
- Websocket bootstrap includes source and workspace scope so mismatched tabs or copied URLs are rejected before any provider stream starts.
- Transport security audits record accepted, replayed, expired, invalid, and cross-scope connection attempts for later monitoring surfaces.
- Replay and monitor views must redact sensitive transcript content such as email addresses, phone numbers, and secret references before rendering operator-facing timeline UI.
- AI observability exports must use the same redaction posture as replay and monitor views, and redaction failures must drop the export instead of leaking sensitive content.
- Runtime eval fixtures must use synthetic, redacted packet and manifest projections only. They must not include production transcript, raw tool output, credentials, provider payloads, or audio.
- AssemblyAI, Cartesia, OpenAI, and Google Gemini credentials remain server side and are resolved only inside the live sandbox transport session or server-owned runtime provider router.
- Draft manifests used by `/workflows` sandbox runs must be validated before session start and frozen for the lifetime of the sandbox call.

## Tenant Isolation Tests

The API regression suite includes cross-tenant ID-guessing coverage for live call sessions, memory records and drafts, knowledge ingestion jobs, integration connections, webhook tools, tool grants, telephony connections, phone numbers, and call-control records. Cross-tenant access must return not found or an empty tenant-scoped collection, never another tenant's payload.
