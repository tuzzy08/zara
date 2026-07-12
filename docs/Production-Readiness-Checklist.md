# Production Readiness Checklist

## Release Gate

The production release gate is explicit: any unchecked critical item blocks release. The release owner may not mark a release ready until every required checklist item is checked, every open risk has a risk owner, and any exception is approved by the accountable domain owner.

Release-blocking conditions:

- A required test command failed or was not run.
- A migration, backup, restore, rollback, observability, security, compliance, or billing gate is incomplete.
- A production secret, provider credential, OAuth token, Polar secret, or signing secret appears in logs or browser bundles.
- Staging validation did not run against the exact production candidate.
- Observability dashboards cannot show calls, latency, errors, cost, integrations, and telephony for the release.
- Rollback owner is missing.
- An open P0/P1 risk lacks a risk owner, mitigation, and explicit release decision.
- The checklist is stale compared with the release artifact, migration state, or docs.

## Checklist

tests:

- [ ] `npm ci` completed for the release artifact.
- [ ] `npm run lint` passed.
- [ ] `npm run typecheck` passed.
- [ ] `npm run test:run` passed.
- [ ] `npm run db:check` passed or migration drift is explicitly reviewed and resolved.
- [ ] Focused tests for touched auth, runtime, telephony, integrations, memory, billing, compliance, platform-admin, or frontend surfaces passed.
- [ ] Staging smoke tests passed against staging domains.
- [ ] Production smoke tests are prepared with owner and expected evidence.

docs:

- [ ] `docs/Production-Deployment.md` matches the release process.
- [ ] `docs/Staging-Deployment.md` matches staging validation.
- [ ] `docs/Observability-Dashboards.md` includes current dashboard and alert expectations.
- [ ] `docs/Backup-Disaster-Recovery.md` includes current restore targets and recovery objectives.
- [ ] Domain docs touched by the release were updated.
- [ ] Issue handovers for completed issues include work completed, tests run, pending work, risks, decisions, and next step.

security:

- [ ] Better Auth trusted origins match tenant and platform-admin origins.
- [ ] Platform-admin routes require platform roles and reject tenant-only roles.
- [ ] `ZARA_PLATFORM_STAFF_ROLES` includes only approved active staff accounts.
- [ ] Platform-admin protected mutations require MFA/passkey assurance and reject password-only staff sessions.
- [ ] Browser bundles contain only public `VITE_` values.
- [ ] Provider secrets stay server side.
- [ ] Webhook signature verification is active for production providers.
- [ ] Tenant isolation tests are green for touched modules.
- [ ] Sandbox transport tokens are short-lived and scoped.
- [ ] Redaction and prompt-injection controls are active where the release touches runtime, tools, memory, or integrations.

compliance:

- [ ] Tenant audit logs are append-only and hash-chained for sensitive actions.
- [ ] Platform-admin mutations write platform audit records.
- [ ] Impersonation sessions are time-boxed, visible, revocable, and linked to tenant/platform audit records.
- [ ] Consent and recording notice behavior is verified for telephony changes.
- [ ] Retention/deletion jobs are paused or reviewed before destructive migrations or restores.
- [ ] No HIPAA or PCI claims are introduced without enterprise review.

billing:

- [ ] Polar environment is correct for staging or production.
- [ ] Checkout and customer portal URLs are hosted provider URLs only.
- [ ] Usage-event idempotency is preserved.
- [ ] Runtime cost rates are known or missing-rate alerts are documented.
- [ ] Telephony minute accounting is preserved across rollout and rollback.
- [ ] Tenant budget warning/block behavior is verified for billing changes.

observability:

- [ ] Calls dashboard shows active, failed, completed, escalated, and fallback-triggered calls.
- [ ] latency dashboard shows STT, model, TTS first-byte, websocket, and turn p95/p99 latency.
- [ ] errors dashboard shows API, provider, webhook, queue, validation, and background job failures.
- [ ] cost dashboard shows usage events, telephony minutes, runtime cost, Polar forwarding, and tenant budgets.
- [ ] integrations dashboard shows OAuth health, refresh failures, revocations, tool failures, and CRM sync status.
- [ ] telephony dashboard shows provider heartbeats, route failures, webhook posture, DNC/timezone blocks, and fallback activity.
- [ ] Platform-admin PSTN call quality shows first-response/readiness latency, premium ingress/provider/output pressure, playback lag and completion ownership, overflow/stale/interruption/handoff/cleanup facts, no-frame timeout count, STT reconnects, TTS first-byte timeouts, model timeouts, bridge errors, barge-ins, premium provider failures, blocked fallbacks, Twilio stop reasons, successful Phone test rate, and separate latest `cost-optimized`, `premium-openai`, and `premium-gemini` `npm run eval:pstn` results.
- [ ] Premium PSTN promotion follows `docs/Premium-PSTN-Failure-Runbook.md`; all three non-empty PSTN gates pass and provider/runtime identity drift blocks only the affected gate.
- [ ] Alert thresholds are loaded and alert noise suppression is enabled.
- [ ] `traceId` is present across API, runtime, telephony, billing, integration, and platform-admin audit events.

rollback:

- [ ] Rollback owner is named.
- [ ] Last known-good API, tenant app, and platform-admin artifacts are identified.
- [ ] Active-call drain or provider fallback decision is recorded.
- [ ] Migration rollback or forward-fix plan is reviewed.
- [ ] Provider webhook rollback posture is documented.
- [ ] Backup restore point and object storage recovery plan are known.
- [ ] Post-rollback smoke tests are ready.

## Open Risks

Every risk must have a risk owner, severity, mitigation, and release decision.

Risk record format:

- Risk ID:
- Severity:
- Area:
- Description:
- risk owner:
- Mitigation:
- Release decision: `block`, `accept`, or `defer`
- Follow-up issue:
- Review date:

Open P0/P1 risks default to `block` unless the release owner, security owner, and affected domain owner explicitly approve `accept` or `defer`.

stale checklist response:

1. Stop release signoff.
2. Reconcile this checklist with the release artifact, migration directory, staging validation result, deployment runbook, and issue handovers.
3. Update the checklist before continuing.
4. Re-run affected verification if any item changed from checked to unchecked.

unchecked critical item response:

1. Treat the release as not ready.
2. Assign a risk owner and domain owner.
3. Complete the missing verification or document the explicit exception.
4. Re-run the release gate from the beginning if the unchecked item affects tests, migrations, security, billing, observability, backup/DR, or rollback.

## Signoff

Required signoffs:

- Release owner
- Security owner
- Billing owner when usage, Polar, budgets, plans, or cost accounting changed
- Telephony owner when calls, providers, webhooks, numbers, recording, DNC, or fallback changed
- Runtime owner when STT, TTS, model routing, live sandbox, tools, or provider fallback changed
- Platform-admin owner when staff operations, impersonation, or cross-tenant dashboards changed

The release owner stores the signed checklist with the release notes and links it from the production deployment record.
