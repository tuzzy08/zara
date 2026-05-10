# Security And Compliance

## V1 Baseline

Zara targets general SaaS readiness: consent, audit logs, encryption, redaction, retention controls, tenant isolation, and abuse prevention. V1 does not claim HIPAA or PCI readiness.

## Required Controls

- Better Auth sessions and organization membership checks.
- Tenant-scoped data access.
- Encrypted secrets with key version metadata.
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
