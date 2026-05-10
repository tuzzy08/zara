# Product Requirements Document

## Product

Zara is a voice agent automation platform where tenants create, test, publish, monitor, and improve voice agents for automated phone calls.

## Goals

- Let non-technical operators build phone agents with a visual workflow builder.
- Support vertical deployment across real estate, ecommerce, SaaS, local services, healthcare-adjacent reception, education, and agencies.
- Reduce call handling cost without forcing every tenant onto expensive realtime speech-to-speech models.
- Support multi-agent specialization: receptionist, onboarding, billing, support, sales, scheduler, and custom roles.
- Support platform telephony and bring-your-own telephony.
- Provide safe integrations with CRMs and productivity tools.
- Provide scoped, tenant-controlled memory and knowledge.

## Personas

- Business owner: wants a phone agent that handles common calls and escalates important ones.
- Operations manager: manages workflows, phone numbers, humans, integrations, and analytics.
- Developer/agency: builds templates, custom tools, webhooks, and vertical-specific flows.
- Human agent/supervisor: monitors live calls and takes over when needed.
- Compliance/security owner: controls retention, consent, audit logs, and access.

## MVP Success Criteria

- A tenant can create and publish a receptionist workflow.
- A browser sandbox call can exercise the published workflow.
- The default runtime is cost-optimized and records stage-level events.
- Telephony connections can represent platform-managed, BYO SIP, and BYO Twilio.
- Zendesk/HubSpot/Google/Notion connector architecture is ready for OAuth-backed tools.
- Agent memory is opt-in, scoped, auditable, editable, and deletable.
- Human escalation and post-call summary flows are represented in the product model.
- Every production feature is test-first.

## Non-Goals For V1

- HIPAA or PCI certification claims.
- Fully custom carrier-grade SIP infrastructure as the default.
- Always-on automatic memory without tenant visibility.
- Complex visual UI test suites.
- Marketplace of third-party apps.

## Metrics

- Call containment rate.
- Successful human escalation rate.
- First-audio latency and total turn latency.
- Cost per resolved call.
- Tool success/failure rate.
- Integration sync success rate.
- Memory approval/rejection rate.
- Workflow publish failure reasons.
- Tenant activation: first published agent, first sandbox call, first production call.
