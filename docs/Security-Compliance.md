# Security And Compliance

## V1 Baseline

Zara targets general SaaS readiness: consent, audit logs, encryption, redaction, retention controls, tenant isolation, and abuse prevention. V1 does not claim HIPAA or PCI readiness.

## Required Controls

- Better Auth sessions and organization membership checks.
- Separate tenant app and platform-admin app origins.
- Platform roles separate from tenant roles.
- Tenant-scoped data access.
- Encrypted secrets with key version metadata.
- Short-lived browser sandbox session tokens; no long-lived STT, TTS, or telephony provider credentials in the client.
- Audit logs for sensitive actions.
- Provider webhook signature verification.
- Retention and deletion workflows.
- Call consent and recording notices.
- Outbound abuse limits and do-not-call support.
- Prompt injection defenses for tools and knowledge.

## Threats

- Cross-tenant data access.
- Credential leakage.
- Prompt injection through CRM notes, websites, or tool output.
- Outbound spam and account compromise.
- Recording without consent.
- Stale or false memory.
- Provider webhook replay.
- Browser sandbox token replay or cross-workspace session reuse.

## Platform Admin Controls

Platform admin access is for Zara staff only. It must be protected by platform roles, stricter operational logging, and server-side guards. Impersonation is time-boxed, visible, revocable, and audited. Platform admins must not see raw secrets, raw OAuth tokens, or decrypted provider credentials.

## Live Sandbox Controls

- Browser sandbox sessions must be scoped to tenant, workspace, manifest source, and runtime profile.
- NestJS should mint short-lived sandbox transport tokens and reject replayed, expired, or cross-workspace reuse.
- Sandbox transport tokens are HMAC-signed, hashed before persistence, and consumed on first successful websocket bootstrap.
- Websocket bootstrap includes source and workspace scope so mismatched tabs or copied URLs are rejected before any provider stream starts.
- Transport security audits record accepted, replayed, expired, invalid, and cross-scope connection attempts for later monitoring surfaces.
- AssemblyAI and Cartesia credentials remain server side and are resolved only inside the live sandbox transport session.
- Draft manifests used by `/workflows` sandbox runs must be validated before session start and frozen for the lifetime of the sandbox call.
