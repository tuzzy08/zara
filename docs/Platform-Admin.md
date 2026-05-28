# Platform Admin

## Purpose

The platform admin app is an internal Zara staff tool. It is separate from the tenant app and may be hosted on a different domain such as `admin.zara.ai`.

## Roles

- `platform_owner`: full platform access, including admin role management and emergency controls.
- `platform_admin`: operational admin access, tenant management, and impersonation where allowed.
- `platform_support`: support-oriented read access plus limited safe actions.
- `platform_readonly`: read-only operational visibility.

Tenant roles such as owner or admin never grant platform-admin access.

## Capabilities

- Admin login and session gate are implemented in `apps/platform-admin` through the shared Better Auth client boundary.
- Platform dashboard is available at `/dashboard` and surfaces system health, tenants, calls, runtime status, spend, incidents, and abuse queues.
- Tenant and organization management is exposed through guarded NestJS platform-admin routes, including audited tenant status changes.
- User and membership support tools expose safe user/membership visibility plus permissioned audited support actions.
- Telephony operations cover platform-managed, BYO SIP, and BYO provider-account connections with health, route, webhook, and active-call posture.
- Integration operations expose connector health, token status, sync failure, revocation, and reconnect diagnostics without raw OAuth tokens.
- Runtime and provider health covers STT, TTS, model, realtime, telephony, and queue providers by region with timestamped severity and outage state.
- AI runtime observability covers intent fallback rate, classifier confidence, tool use/failure rate, transfer loop prevention, policy warnings, packet truncation, LangSmith export health, eval regression status, and the separate runtime eval gate for platform staff.
- Runtime prompt policy controls let platform admins edit global guardrails and role-specific prompt templates used by live sandbox text providers.
- Usage, billing, budgets, premium realtime usage, and plan limits are visible across tenants, and billing-control mutations are audited.
- System audit log can be filtered by actor, tenant, and action.
- Time-boxed impersonation sessions are permissioned, visibly marked, revocable, and linked to both platform audit records and tenant compliance audit records.
- Abuse and compliance review queue covers outbound abuse signals, DNC violations, consent issues, prompt-injection flags, and escalation/dismissal decisions.
- Admin deployment config lives with `apps/platform-admin` and includes separate environment variables plus security headers for the admin origin.

## Impersonation

Impersonation is a high-risk support workflow. It must be restricted by platform role, time-boxed, visibly marked in the UI, revocable, and audited. Destructive actions during impersonation should be blocked unless explicitly allowed by policy.

## Security Rules

- No raw secrets or decrypted provider credentials in platform-admin UI.
- No tenant-facing exposure of internal LangSmith experiment links, local trace IDs, eval regression state, or redaction metadata.
- Prompt-policy audit metadata should not store full prompt text; store version, reason, guardrail count, changed role keys, and hash-style metadata instead.
- Every platform-admin mutation writes an audit log.
- Cross-tenant actions must name the target tenant explicitly.
- Platform admin access is enforced server-side by NestJS guards.
- Tenant organization roles, including tenant `admin`, are rejected by the platform-admin guard unless a valid platform role is present.
- Readonly platform roles cannot mutate tenant status, billing controls, support actions, impersonation sessions, or review decisions.
