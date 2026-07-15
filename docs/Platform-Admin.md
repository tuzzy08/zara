# Platform Admin

## Purpose

The platform admin app is an internal Zara staff tool. It is separate from the tenant app and may be hosted on a different domain such as `admin.zara.ai`.

## Roles

- `platform_owner`: full platform access, including admin role management and emergency controls.
- `platform_admin`: operational admin access, tenant management, and impersonation where allowed.
- `platform_support`: support-oriented read access plus limited safe actions.
- `platform_readonly`: read-only operational visibility.

Tenant roles such as owner or admin never grant platform-admin access. Staff authority is resolved server-side from signed-in Better Auth email addresses listed in `ZARA_PLATFORM_STAFF_ROLES` as `email=platform_role` entries. Non-production tests/local trusted-proxy flows may still provide `x-zara-platform-role`, but production staff access must not depend on tenant organization membership.

## Auth Posture

- `password` assurance can read staff surfaces allowed by the platform role while the admin session is active.
- `mfa` or `passkey` assurance is required for tenant status changes, billing controls, runtime prompt policy edits, premium realtime conversation policy edits, abuse/compliance decisions, support actions, and impersonation changes.
- Staff sessions expire after eight hours for platform-admin APIs.
- Mutating staff actions require a fresh 15-minute step-up window.
- `platform_readonly` never mutates, even with MFA/passkey.
- `platform_support` can read operational state and run support actions after MFA/passkey step-up, but cannot perform core admin mutations or impersonation.
- `platform_owner` and `platform_admin` can perform core mutations and impersonation only after MFA/passkey step-up.

## Capabilities

- Admin login and session gate are implemented in `apps/platform-admin` through the shared Better Auth client boundary and server-owned staff context.
- Platform dashboard is available at `/dashboard` and surfaces system health, tenants, calls, runtime status, spend, incidents, and abuse queues.
- Tenant and organization management is exposed through guarded NestJS platform-admin routes, including audited tenant status changes.
- User and membership support tools expose safe user/membership visibility plus permissioned audited support actions.
- Telephony operations cover platform-managed, BYO SIP, and BYO provider-account connections with health, route, webhook, and active-call posture.
- Integration operations expose connector health, token status, sync failure, revocation, and reconnect diagnostics without raw OAuth tokens.
- Specialist agent operations are exposed through `/agents`, where platform admins create platform-owned specialist classes/templates. These classes become the tenant-visible workflow-builder and reusable-agent class catalog; tenants select classes but do not create or edit platform templates.
- Runtime and provider health covers STT, TTS, model, realtime, telephony, and queue providers by region with timestamped severity and outage state.
- AI runtime observability covers intent fallback rate, handoff-tool acceptance/rejection, tool use/failure rate, transfer loop prevention, policy warnings, packet truncation, LangSmith export health, eval regression status, and the separate runtime eval gate for platform staff.
- Runtime prompt policy controls let platform admins edit global guardrails, platform-owned agent class prompt templates, and class-level text/realtime model defaults used by live sandbox text providers. The template catalog is open-ended and is seeded by `/agents` specialist-class creation rather than tenant hard-coded class lists.
- Premium realtime conversation policy controls let platform admins select the default premium provider, OpenAI and Gemini model defaults, and OpenAI PSTN turn policy. OpenAI defaults to `gpt-realtime-2.1` with low-eagerness semantic VAD for PSTN; Gemini activity handling remains provider-native. Saves use expected-version checks, a required audit reason, fixed server-owned media contracts, and redacted audit metadata.
- Runtime route policy controls let platform admins inspect, configure, and save agent-attached handoff defaults, including internal handoff-tool naming, source-announcement posture, fallback behavior, and validation/audit posture. Saves use guarded platform-admin APIs with expected-version checks, mutation posture, audit reason, durable route-policy persistence, and staff-only audit metadata that does not expose raw handoff-tool prompts, provider credentials, or tenant transcript data.
- Usage, billing, budgets, premium realtime usage, and plan limits are visible across tenants, and billing-control mutations are audited.
- System audit log can be filtered by actor, tenant, and action.
- Time-boxed impersonation sessions are permissioned, MFA/passkey step-up gated, visibly marked, revocable, and linked to both platform audit records and tenant compliance audit records.
- Abuse and compliance review queue covers outbound abuse signals, DNC violations, consent issues, prompt-injection flags, and escalation/dismissal decisions.
- Admin deployment config lives with `apps/platform-admin` and includes separate environment variables plus security headers for the admin origin.

## Impersonation

Impersonation is a high-risk support workflow. It must be restricted by platform role, time-boxed, visibly marked in the UI, revocable, and audited. Destructive actions during impersonation should be blocked unless explicitly allowed by policy.

## Security Rules

- No raw secrets or decrypted provider credentials in platform-admin UI.
- No tenant-facing exposure of internal LangSmith experiment links, local trace IDs, eval regression state, or redaction metadata.
- Prompt-policy audit metadata should not store full prompt text; store version, reason, guardrail count, changed role keys, and hash-style metadata instead.
- Route-policy audit metadata should not store raw handoff-tool prompts, unredacted transcripts, provider credentials, graph target IDs exposed by the model, or model-proposed targets; store version, reason, and changed keys only.
- Premium realtime conversation-policy audit metadata stores version, reason, and changed keys only; it does not store provider credentials, prompts, transcripts, or raw provider payloads.
- Every platform-admin mutation writes an audit log.
- Cross-tenant actions must name the target tenant explicitly.
- Platform admin access is enforced server-side by NestJS guards.
- Tenant organization roles, including tenant `admin`, are rejected by the platform-admin guard unless a valid platform role is present.
- Readonly platform roles cannot mutate tenant status, billing controls, support actions, impersonation sessions, or review decisions.
- Password-only staff sessions cannot mutate; the UI renders a step-up required state and the API returns forbidden for protected mutations.
- Expired staff sessions render a safe sign-in-again state and the API returns unauthorized before serving platform data.
