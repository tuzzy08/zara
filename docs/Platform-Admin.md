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

- Admin login and session gate.
- Platform dashboard.
- Tenant and organization management.
- User and membership support tools.
- Telephony operations across platform-managed, BYO SIP, and BYO Twilio connections.
- Integration operations and connector health.
- Runtime and provider health.
- Usage, billing, budgets, and premium realtime controls.
- System audit log.
- Time-boxed impersonation workflow.
- Abuse and compliance review queue.

## Impersonation

Impersonation is a high-risk support workflow. It must be restricted by platform role, time-boxed, visibly marked in the UI, revocable, and audited. Destructive actions during impersonation should be blocked unless explicitly allowed by policy.

## Security Rules

- No raw secrets or decrypted provider credentials in platform-admin UI.
- Every platform-admin mutation writes an audit log.
- Cross-tenant actions must name the target tenant explicitly.
- Platform admin access is enforced server-side by NestJS guards.
