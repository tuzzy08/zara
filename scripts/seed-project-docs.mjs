import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();

function write(path, content) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${content.trim()}\n`, "utf8");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const issues = [
  ["Project workspace setup", "Setup", "Foundation", "P0", ["setup", "tdd-required"], ["npm workspace installs cleanly", "TypeScript project references compile", "Repository has root scripts for typecheck and tests"], ["Windows PowerShell npm shim", "Empty repo with no prior commits"]],
  ["NestJS API scaffold", "Backend", "Foundation", "P0", ["backend", "tdd-required"], ["NestJS app boots in test mode", "Health endpoint is covered by a failing-first test", "Module layout is documented"], ["Config missing", "Port collision"]],
  ["Shared TypeScript core package", "Setup", "Foundation", "P0", ["setup", "backend", "tdd-required"], ["Core package exports public domain types", "No app imports private implementation paths", "Typecheck passes"], ["Breaking shared contracts", "Circular package imports"]],
  ["Postgres schema and migration setup", "Backend", "Foundation", "P0", ["backend", "testing", "tdd-required"], ["Migration tool is configured", "Initial schema covers tenant and audit foundations", "Migration checks run in CI"], ["Failed migration rollback", "Local database unavailable"]],
  ["Better Auth organization model", "Backend", "Foundation", "P0", ["backend", "security", "tdd-required"], ["Users can belong to organizations", "Roles gate organization resources", "Session tests cover tenant isolation"], ["User removed during session", "Invite accepted twice"]],
  ["CI pipeline with typecheck tests lint and migration checks", "DevOps", "Foundation", "P0", ["devops", "testing", "tdd-required"], ["CI runs typecheck, tests, lint, and migration checks", "CI blocks failed checks", "Status is documented"], ["Flaky dependency install", "Secrets unavailable in forked PR"]],
  ["Environment config and secrets strategy", "Security", "Foundation", "P0", ["security", "devops", "tdd-required"], ["Environment schema validates required values", "Secrets are never logged", "Local example env is documented"], ["Missing env at runtime", "Wrong environment selected"]],

  ["React dashboard shell", "Frontend", "MVP Builder", "P1", ["frontend", "tdd-required"], ["Authenticated shell renders tenant navigation", "Critical route smoke test exists", "UI tests stay minimal"], ["No tenant selected", "Small viewport navigation"]],
  ["React Flow visual builder", "Frontend", "MVP Builder", "P1", ["frontend", "tdd-required"], ["Users can add, move, connect, and delete nodes", "Graph state serializes deterministically", "Core graph operations are unit tested"], ["Disconnected nodes", "Malformed imported graph"]],
  ["Agent role nodes", "Frontend", "MVP Builder", "P1", ["frontend", "runtime", "tdd-required"], ["Role node captures instructions, language policy, and default model tier", "Missing required fields block publish", "Specialist roles are reusable"], ["Duplicate role names", "Unsupported language"]],
  ["Tool nodes", "Frontend", "MVP Builder", "P1", ["frontend", "integrations", "tdd-required"], ["Tool node binds to a permitted integration tool", "Risk and approval state are visible", "Missing credentials block publish"], ["Revoked integration", "High-risk tool without approval"]],
  ["Handoff nodes", "Runtime", "MVP Builder", "P1", ["runtime", "frontend", "tdd-required"], ["Handoff node targets a valid specialist", "Manifest distinguishes handoff from agent-as-tool", "Tests cover invalid targets"], ["Handoff loop", "Specialist disabled"]],
  ["Condition routing nodes", "Runtime", "MVP Builder", "P1", ["runtime", "frontend", "tdd-required"], ["Condition node validates expression shape", "Fallback branch is required", "Router tests cover branch selection"], ["No matching branch", "Ambiguous conditions"]],
  ["Human escalation nodes", "Runtime", "MVP Builder", "P1", ["runtime", "frontend", "tdd-required"], ["Escalation node binds to a queue", "Fallback callback behavior is configurable", "Manifest includes escalation policy"], ["Queue offline", "No available human"]],
  ["Workflow validation", "Backend", "MVP Builder", "P0", ["backend", "runtime", "tdd-required"], ["Validator catches missing entry, unreachable nodes, unsafe cycles, and missing tool auth", "Validation errors are actionable", "Contract tests cover invalid graphs"], ["Cycle with exit condition", "Deleted integration used by graph"]],
  ["Version publishing", "Backend", "MVP Builder", "P0", ["backend", "runtime", "tdd-required"], ["Published versions are immutable", "Calls pin to a published version", "Draft changes do not affect active calls"], ["Concurrent publishes", "Rollback to prior version"]],
  ["Runtime manifest preview", "Backend", "MVP Builder", "P1", ["backend", "runtime", "tdd-required"], ["Users can preview compiled manifest before publish", "Preview includes runtime, telephony, memory, tools, and budget", "Schema tests cover preview output"], ["Missing telephony route", "Budget over limit"]],

  ["Runtime manifest compiler", "Runtime", "Sandbox", "P0", ["runtime", "tdd-required"], ["Compiler converts published workflow to manifest", "Manifest is deterministic and versioned", "Invalid references fail fast"], ["Deleted tool", "Partial tenant config"]],
  ["Cost optimized sandwich runtime adapter", "Runtime", "Sandbox", "P0", ["runtime", "tdd-required"], ["Adapter streams STT to text model to TTS", "Call events capture each stage", "Provider failures degrade predictably"], ["STT timeout", "TTS first byte delay", "Model stream interruption"]],
  ["Balanced runtime profile", "Runtime", "Sandbox", "P1", ["runtime", "tdd-required"], ["Balanced profile uses stronger routing and TTS options", "Per-agent override is supported", "Cost estimate reflects profile"], ["Language fallback", "Provider quota exceeded"]],
  ["Premium OpenAI Realtime profile", "Runtime", "Sandbox", "P1", ["runtime", "tdd-required"], ["Premium profile is opt-in by policy", "Session creation is server-side", "Tool and handoff events are observed"], ["Realtime unavailable", "Budget disallows premium"]],
  ["Model routing policy engine", "Runtime", "Sandbox", "P0", ["runtime", "tdd-required"], ["Rules select tiers by intent, risk, confidence, language, and call phase", "Tests cover escalation and fallback", "Decision is logged"], ["Conflicting rules", "Low confidence high-risk call"]],
  ["Call event stream", "Runtime", "Sandbox", "P0", ["runtime", "testing", "tdd-required"], ["Events are ordered and idempotent", "Subscribers receive live updates", "Replay works for post-call analysis"], ["Reconnect", "Duplicate provider webhook"]],
  ["Runtime budget and cost estimation", "Billing", "Sandbox", "P1", ["billing", "runtime", "tdd-required"], ["Estimate includes telephony, STT, model, TTS, and storage", "Tenant budgets can block publish or call start", "Usage is attributed by tenant"], ["Long call", "Provider pricing missing"]],
  ["Sandbox call session", "Runtime", "Sandbox", "P0", ["runtime", "frontend", "good-first-slice", "tdd-required"], ["Browser sandbox starts a test call", "Simulated tools are available", "Transcript and metrics are recorded"], ["Mic permission denied", "Sandbox tool throws"]],

  ["Telephony connection model", "Telephony", "Telephony MVP", "P0", ["telephony", "tdd-required"], ["Model supports platform managed, BYO SIP, and BYO provider account", "Credentials are referenced, not exposed", "Tenant isolation is tested"], ["Provider deleted", "Connection disabled mid-call"]],
  ["Platform managed telephony connection", "Telephony", "Telephony MVP", "P1", ["telephony", "tdd-required"], ["Platform numbers can map to agent versions", "Inbound routing is validated", "Recording policy is enforced"], ["Number unassigned", "Provider outage"]],
  ["BYO SIP trunk connection", "Telephony", "Telephony MVP", "P1", ["telephony", "tdd-required"], ["Tenant can configure SIP trunk details", "Validation call checks route health", "Failure messages are actionable"], ["Bad credentials", "Codec mismatch", "NAT/firewall issue"]],
  ["BYO Twilio provider account connection", "Telephony", "Telephony MVP", "P1", ["telephony", "tdd-required"], ["Tenant can connect Twilio credentials", "Credentials are encrypted", "Account validation is covered"], ["Revoked token", "Subaccount permissions missing"]],
  ["Twilio number import and routing", "Telephony", "Telephony MVP", "P1", ["telephony", "tdd-required"], ["Numbers import from BYO Twilio", "Imported numbers map to published versions", "Webhook setup status is visible"], ["Duplicate number", "Number lacks voice capability"]],
  ["Telephony webhook handling", "Telephony", "Telephony MVP", "P0", ["telephony", "backend", "tdd-required"], ["Webhook signatures are verified", "Events are idempotent", "Unknown events are safely logged"], ["Replay attack", "Out-of-order events"]],
  ["Inbound call dispatch", "Telephony", "Telephony MVP", "P0", ["telephony", "runtime", "tdd-required"], ["Inbound call resolves tenant and published version", "Dispatch creates call session", "No route returns safe fallback"], ["Disabled tenant", "No active version"]],
  ["Outbound call dispatch", "Telephony", "Telephony MVP", "P1", ["telephony", "compliance", "tdd-required"], ["Outbound calls enforce consent, budget, and calling window", "Caller ID policy is applied", "Dispatch is auditable"], ["Do-not-call match", "Timezone blocked"]],
  ["Call recording policy", "Compliance", "Telephony MVP", "P1", ["compliance", "telephony", "tdd-required"], ["Recording consent policy is configurable", "Recording can be disabled by tenant/workflow", "Recording state is logged"], ["Two-party consent region", "Sensitive data capture"]],
  ["DTMF voicemail transfer and failover handling", "Telephony", "Telephony MVP", "P1", ["telephony", "edge-case", "tdd-required"], ["DTMF, voicemail, transfer, and failover are first-class events", "Fallback paths are configured", "Edge cases are covered by tests"], ["Voicemail detected late", "Transfer fails"]],
  ["Provider health checks and test calls", "Telephony", "Telephony MVP", "P1", ["telephony", "testing", "tdd-required"], ["Health checks run for each provider connection", "Test calls record diagnostics", "Failures block production routing when required"], ["Provider API down", "False positive health"]],

  ["OAuth connection framework", "Integrations", "Integrations", "P0", ["integrations", "security", "tdd-required"], ["Platform OAuth apps support connect and callback", "State parameter prevents CSRF", "Tenant-scoped connection is created"], ["Callback replay", "User lacks admin role"]],
  ["Encrypted credential storage", "Security", "Integrations", "P0", ["security", "integrations", "tdd-required"], ["Tokens and provider secrets are encrypted at rest", "Key version metadata is stored", "No raw secrets are returned from APIs"], ["Key rotation", "Decrypt failure"]],
  ["Zendesk connector", "Integrations", "Integrations", "P1", ["integrations", "tdd-required"], ["Connector can search/create/update tickets", "Tool schemas are typed", "Rate limits are handled"], ["Expired token", "Ticket field validation"]],
  ["HubSpot connector", "Integrations", "Integrations", "P1", ["integrations", "tdd-required"], ["Connector can look up contacts and write notes", "Pipeline updates are permissioned", "Tool errors are recoverable"], ["Duplicate contacts", "Missing scope"]],
  ["Google Workspace connector", "Integrations", "Integrations", "P1", ["integrations", "tdd-required"], ["Connector can read calendar availability and create events", "Scopes are minimal", "Timezone behavior is tested"], ["Calendar conflict", "Revoked consent"]],
  ["Notion connector", "Integrations", "Integrations", "P2", ["integrations", "tdd-required"], ["Connector can search knowledge and create pages/tasks", "Workspace selection is stored", "Permission failures are clear"], ["Page moved", "Shared workspace revoked"]],
  ["Webhook HTTP tool connector", "Integrations", "Integrations", "P1", ["integrations", "security", "tdd-required"], ["Tenant can define HTTP tool schema", "Secrets are injected securely", "Timeout and retry policy are enforced"], ["Slow endpoint", "Prompt injection in response"]],
  ["Connector health and revocation", "Integrations", "Integrations", "P1", ["integrations", "security", "tdd-required"], ["Connection health is visible", "Revoked connections disable tools", "Reconnect flow preserves audit history"], ["Partial outage", "Token refresh failure"]],
  ["Tool permission grants", "Integrations", "Integrations", "P0", ["integrations", "security", "tdd-required"], ["Tools require explicit grants by role/workflow", "High-risk tools can require approval", "Unauthorized calls are blocked"], ["Role removed", "Grant changed during call"]],

  ["Session memory", "Memory", "Monitoring", "P0", ["memory", "tdd-required"], ["Active call memory is available within the session", "Session memory is cleared or summarized after call", "Tests cover interruption and resume"], ["Long call context overflow", "Reconnect"]],
  ["Caller account memory", "Memory", "Monitoring", "P1", ["memory", "security", "tdd-required"], ["Durable caller/account memory is opt-in", "Memory is tenant scoped", "Retrieval respects caller identity"], ["Shared phone number", "Wrong account match"]],
  ["Tenant knowledge memory", "Memory", "Monitoring", "P1", ["memory", "integrations", "tdd-required"], ["Tenant knowledge can store policies and FAQs", "Sources are traceable", "Retrieval filters by published workflow"], ["Stale knowledge", "Conflicting sources"]],
  ["pgvector retrieval", "Memory", "Monitoring", "P1", ["memory", "backend", "tdd-required"], ["Embeddings are stored in Postgres pgvector", "Top-k retrieval has scope and confidence filters", "Index migration is documented"], ["No results", "Low-confidence match"]],
  ["Memory extraction after calls", "Memory", "Monitoring", "P1", ["memory", "tdd-required"], ["Post-call extractor drafts useful facts", "Sensitive facts are filtered", "Extraction source links to transcript"], ["False memory", "Sensitive data"]],
  ["Memory approval workflow", "Memory", "Monitoring", "P1", ["memory", "frontend", "tdd-required"], ["Tenant can require approval before durable memory write", "Approvers can accept, edit, reject", "Audit trail is kept"], ["Approver unavailable", "Duplicate suggestions"]],
  ["Memory edit delete UI API", "Memory", "Monitoring", "P1", ["memory", "frontend", "security", "tdd-required"], ["Users can view, edit, delete, and disable memory", "Deletion removes embeddings and facts", "Audit records the action"], ["Delete during active call", "Permission denied"]],
  ["Knowledge ingestion pipeline", "Memory", "Integrations", "P1", ["memory", "integrations", "tdd-required"], ["Pipeline ingests docs, websites, PDFs, Notion, Google Drive, and CRM help centers", "Ingestion status is visible", "Failures are retryable"], ["Large file", "Unsupported content type"]],
  ["Memory privacy and retention enforcement", "Compliance", "Monitoring", "P0", ["memory", "compliance", "security", "tdd-required"], ["Retention policies purge memory and sources", "Sensitive memory classes are blocked", "Tenant export/delete is supported"], ["Legal hold", "Partial purge failure"]],

  ["Live call monitor", "Frontend", "Monitoring", "P1", ["frontend", "runtime", "tdd-required"], ["Operators see active calls, agent role, runtime tier, and status", "Critical interactions are covered lightly", "Data comes from event stream"], ["Event stream disconnect", "Many active calls"]],
  ["Transcript and event timeline", "Monitoring", "Monitoring", "P1", ["runtime", "frontend", "tdd-required"], ["Timeline shows transcript, tools, handoffs, routing, and errors", "Events can be replayed after call", "Sensitive text is redacted"], ["Out-of-order events", "Redaction failure"]],
  ["Model tool cost telemetry", "Monitoring", "Monitoring", "P1", ["runtime", "billing", "tdd-required"], ["Telemetry captures model, tool, latency, and cost", "Metrics aggregate by tenant and call", "Tests cover missing usage data"], ["Provider usage delayed", "Clock skew"]],
  ["Escalation queue", "Monitoring", "Monitoring", "P1", ["runtime", "frontend", "tdd-required"], ["Escalations enter queue with reason and SLA", "Agents can accept or decline", "Fallback is triggered on timeout"], ["No humans online", "Duplicate escalation"]],
  ["Human takeover callback fallback", "Monitoring", "Monitoring", "P1", ["runtime", "telephony", "tdd-required"], ["Takeover or callback fallback follows provider capability", "Caller receives safe message", "Action is audited"], ["Transfer fails", "Callback number invalid"]],
  ["Post-call summary", "Runtime", "Monitoring", "P1", ["runtime", "integrations", "tdd-required"], ["Summary includes outcome, action items, and disposition", "Summary sync can target CRM", "Sensitive content is redacted"], ["Long transcript", "Summary hallucination"]],
  ["CRM sync status", "Integrations", "Monitoring", "P1", ["integrations", "monitoring", "tdd-required"], ["Post-call sync status is visible", "Retries are queued", "Failures include actionable diagnostics"], ["CRM outage", "Partial sync"]],
  ["Quality flags and improvement suggestions", "Runtime", "Monitoring", "P2", ["runtime", "testing", "tdd-required"], ["System flags dead ends, hallucinations, slow turns, and escalation misses", "Suggestions create draft changes only", "Human approval is required"], ["Bad suggestion", "Regression risk"]],

  ["Tenant isolation tests", "Security", "Production", "P0", ["security", "testing", "tdd-required"], ["Automated tests prove tenant data isolation", "Cross-tenant access returns forbidden/not found", "Covers calls, memory, integrations, telephony"], ["ID guessing", "Admin role confusion"]],
  ["Audit logging", "Security", "Production", "P0", ["security", "compliance", "tdd-required"], ["Security-sensitive actions create audit records", "Records include actor, tenant, target, and timestamp", "Audit logs are immutable enough for v1"], ["System actor", "Failed action logging"]],
  ["Call consent and recording notices", "Compliance", "Production", "P0", ["compliance", "telephony", "tdd-required"], ["Consent policy can be configured", "Notices play before recording where required", "Consent state is recorded"], ["Region unknown", "Caller opts out"]],
  ["Retention and deletion workflows", "Compliance", "Production", "P0", ["compliance", "security", "tdd-required"], ["Tenant retention policies apply to calls, transcripts, memory, and recordings", "Deletion jobs are auditable", "Failures retry"], ["Legal hold", "Object storage delete fails"]],
  ["Secrets encryption and key rotation metadata", "Security", "Production", "P0", ["security", "devops", "tdd-required"], ["Secret blobs include key version", "Rotation plan is documented", "Decrypt failures are safe"], ["Old key unavailable", "Partial rotation"]],
  ["Prompt injection defenses", "Security", "Production", "P1", ["security", "runtime", "tdd-required"], ["Tool outputs and knowledge are treated as untrusted", "System instructions are separated from retrieved content", "Tests cover malicious content"], ["CRM note injection", "Website ingestion attack"]],
  ["Outbound abuse rate limits", "Compliance", "Production", "P0", ["compliance", "telephony", "tdd-required"], ["Outbound calls enforce rate limits and consent", "Abuse signals can pause tenant", "Logs support review"], ["Burst campaign", "Compromised account"]],
  ["Do-not-call and timezone safe calling windows", "Compliance", "Production", "P0", ["compliance", "telephony", "tdd-required"], ["DNC list blocks outbound calls", "Timezone windows are enforced", "Overrides require audit"], ["Unknown timezone", "Emergency callback"]],
  ["Redaction pipeline", "Security", "Production", "P0", ["security", "compliance", "runtime", "tdd-required"], ["PII/sensitive data redaction runs before storage where configured", "Original access is restricted", "Tests cover transcripts and summaries"], ["False positive", "Streaming partial redaction"]],
  ["General SaaS compliance readiness", "Compliance", "Production", "P1", ["compliance", "security", "devops", "tdd-required"], ["Readiness checklist covers encryption, audit, retention, consent, and access control", "No HIPAA/PCI claims are made", "Known gaps are documented"], ["Enterprise asks for regulated data", "Data residency request"]],

  ["Usage metering", "Billing", "Production", "P0", ["billing", "tdd-required"], ["Usage events are recorded idempotently", "Usage aggregates by tenant and feature", "Tests cover duplicate events"], ["Delayed provider usage", "Clock skew"]],
  ["Telephony minute accounting", "Billing", "Production", "P1", ["billing", "telephony", "tdd-required"], ["Minutes are computed by provider connection and tenant", "Rounding policy is documented", "Failed calls are classified"], ["Transferred call", "Provider mismatch"]],
  ["Model STT TTS cost accounting", "Billing", "Production", "P1", ["billing", "runtime", "tdd-required"], ["Model/STT/TTS usage maps to runtime events", "Cost rates are versioned", "Unknown rates are flagged"], ["Provider pricing change", "Missing usage tokens"]],
  ["Plan limits and tenant budgets", "Billing", "Production", "P1", ["billing", "backend", "tdd-required"], ["Tenant budgets can cap calls and premium runtime use", "Over-budget behavior is configurable", "Admins see warnings"], ["Budget reached mid-call", "VIP override"]],
  ["Production deployment plan", "DevOps", "Production", "P0", ["devops", "security", "tdd-required"], ["Production environment, release process, secrets, migrations, and rollback are documented", "Deployment checklist exists", "Smoke tests are defined"], ["Failed migration", "Rollback with active calls"]],
  ["Staging deployment plan", "DevOps", "Production", "P0", ["devops", "testing", "tdd-required"], ["Staging mirrors production-critical services", "Seed data is safe", "Staging validation is documented"], ["Staging uses production secrets", "Drift from prod"]],
  ["Observability dashboards", "DevOps", "Production", "P1", ["devops", "monitoring", "tdd-required"], ["Dashboards cover calls, latency, errors, cost, integrations, and telephony", "Alert thresholds are documented", "Trace IDs connect systems"], ["Alert noise", "Missing correlation ID"]],
  ["Backup and disaster recovery", "DevOps", "Production", "P1", ["devops", "security", "tdd-required"], ["Backups cover DB and critical object storage", "Restore procedure is tested", "RPO/RTO targets are documented"], ["Partial restore", "Corrupt backup"]],
  ["Provider outage fallback", "Runtime", "Production", "P1", ["runtime", "telephony", "devops", "edge-case", "tdd-required"], ["Fallback routes exist for telephony/runtime providers", "Outage mode is visible", "Calls fail safely when no fallback exists"], ["Multiple providers down", "Stuck failover"]],
  ["Final production readiness checklist", "Docs", "Production", "P0", ["docs", "devops", "security"], ["Checklist covers tests, docs, security, compliance, billing, observability, and rollback", "Open risks are tracked", "Release gate is explicit"], ["Unchecked critical item", "Stale checklist"]],
];

function issueId(index) {
  return `ISSUE-${String(index + 1).padStart(3, "0")}`;
}

function handoverPath(index, title) {
  return `docs/Handovers/${issueId(index)}-${slugify(title)}.md`;
}

function issueMarkdown(issue, index) {
  const [title, area, milestone, priority, labels, acceptance, edges] = issue;
  const id = issueId(index);
  const path = handoverPath(index, title);
  return `### ${id}: ${title}

- Priority: ${priority}
- Area: ${area}
- Milestone: ${milestone}
- Labels: ${labels.join(", ")}
- Handover: [${path}](../${path})

Acceptance criteria:
${acceptance.map((item) => `- ${item}`).join("\n")}

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
${edges.map((item) => `- ${item}`).join("\n")}
`;
}

function handoverMarkdown(issue, index) {
  const [title, area, milestone, priority, labels, acceptance, edges] = issue;
  const id = issueId(index);
  return `# ${id}: ${title}

Issue link: https://github.com/tuzzy08/zara/issues/${index + 1}

## Goal

Deliver ${title} for the ${area} area in the ${milestone} milestone.

## Acceptance Criteria

${acceptance.map((item) => `- ${item}`).join("\n")}

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

${edges.map((item) => `- ${item}`).join("\n")}

## Decisions

- Priority: ${priority}
- Labels: ${labels.join(", ")}
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
`;
}

write("README.md", `# Zara

Zara is a vertical-agnostic voice agent automation platform for automated phone calls. Businesses and individuals can create specialized voice agents for customer support, receptionist workflows, billing, onboarding, scheduling, sales, and other repeatable phone workflows.

## Architecture Direction

- Main control plane: NestJS + Postgres.
- Platform auth: Better Auth + organization/RBAC model.
- Voice default: cost-first sandwich runtime, STT -> text model/router -> TTS.
- Premium runtime: OpenAI Realtime speech-to-speech for low-latency or high-value calls.
- Telephony: platform-managed telephony, BYO SIP trunks, and BYO provider accounts starting with Twilio.
- Integrations: platform-owned OAuth apps with encrypted tenant-scoped tokens.
- Memory: scoped opt-in session, caller/account, and tenant knowledge memory using Postgres + pgvector.
- Delivery: strict TDD for production code, RED/GREEN/REFACTOR.

## Start Here

- [AGENTS.md](AGENTS.md)
- [PRD](docs/PRD.md)
- [Architecture](docs/Architecture.md)
- [Roadmap](docs/Roadmap.md)
- [Issue Backlog](docs/Issue-Backlog.md)
- [Handovers](docs/Handovers/README.md)

The original research notes are still in the repo root:

- [Cloudflare voice pipeline notes](cloudflare-voice-pipeline.md)
- [LangChain voice agent notes](langchain-voice-agent.md)
- [OpenAI voice pipeline notes](openAI-voice-pipeline.md)
`);

write("AGENTS.md", `# AGENTS.md

This repository is a strict TDD project. Every agent must use these docs as operating context before doing work.

## Required Reading Before Each Pass

Read these before starting or resuming any issue:

- docs/PRD.md
- docs/Architecture.md
- docs/Roadmap.md
- docs/Issue-Backlog.md
- the active issue handover in docs/Handovers/

If the task touches runtime, telephony, integrations, memory, security, API, or tests, also read the matching domain doc.

## Handover Rule

Every issue must have exactly one issue-specific handover document:

- Path pattern: docs/Handovers/ISSUE-###-short-title.md
- Update the handover every time you work on that issue.
- Include work completed, tests run, pending work, risks, decisions, and next recommended step.
- Do not use a shared handover for multiple issues.

## TDD Rule

No production code without a failing test first.

Cycle:

1. RED: write the smallest failing test for one behavior.
2. GREEN: write the smallest production change that passes.
3. REFACTOR: clean up while the suite remains green.

If a test passes immediately, it did not prove the new behavior. Fix the test before writing code.

## UI Testing Guidance

Do not spend much time on UI tests. Use light smoke/critical-flow tests for UI. Prioritize:

- unit tests for domain logic
- integration tests for APIs, runtime, telephony, auth, and connectors
- contract tests for public interfaces
- security and tenant-isolation tests

## Architecture Defaults

- NestJS control plane.
- Postgres data store with pgvector for memory retrieval.
- Better Auth for user auth and organizations.
- Cost-optimized sandwich runtime by default.
- OpenAI Realtime only for premium/escalation runtime policies.
- Platform telephony, BYO SIP trunks, and BYO provider accounts starting with Twilio.
- Platform-owned OAuth apps for CRM/productivity integrations.
- Encrypted tenant-scoped secrets with envelope encryption.
`);

write("docs/PRD.md", `# Product Requirements Document

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
`);

write("docs/Architecture.md", `# Architecture

## System Shape

Zara has three major planes:

- Control plane: NestJS API, Postgres, Better Auth, workflow publishing, integrations, telephony config, memory, billing, and audit.
- Realtime plane: active call sessions, audio/runtime adapters, call event stream, live monitoring, and interruption handling.
- Workflow plane: durable retries, post-call summaries, CRM sync, memory extraction, improvement suggestions, and approval workflows.

## Primary Stack

- TypeScript everywhere.
- NestJS for the SaaS backend.
- Postgres as system of record.
- pgvector for v1 memory retrieval.
- Better Auth for users, organizations, sessions, roles, and invitations.
- React + React Flow for the visual builder.
- Cloudflare Durable Objects may be used for live session state and WebSocket fanout.
- Temporal or a queue/workflow engine should be used for durable background work.

## Runtime Strategy

The default voice runtime is cost-optimized sandwich:

1. Stream caller audio to STT.
2. Route transcript through rules/model policy.
3. Use a cheap or standard text model where safe.
4. Stream text to TTS.
5. Emit structured call events at every stage.

OpenAI Realtime speech-to-speech is a premium profile for calls or nodes that need very low latency, natural turn-taking, or high-value treatment.

## Telephony Strategy

Telephony is a tenant connection, not a single platform assumption.

- platform_managed: Zara owns the provider account, numbers, and trunks.
- byo_sip_trunk: tenant provides SIP trunk credentials and routes.
- byo_provider_account: tenant connects provider account credentials, starting with Twilio.

All calls resolve a telephony connection, published workflow version, runtime profile, memory policy, integration permissions, and escalation policy before starting.

## Data Flow

1. Tenant builds a workflow graph.
2. Validator checks graph and required resources.
3. Tenant publishes immutable version.
4. Runtime manifest compiler creates a versioned manifest.
5. Sandbox or telephony event starts a call.
6. Runtime emits structured events.
7. Live monitor consumes event stream.
8. Post-call workflows summarize, sync integrations, extract memory drafts, meter usage, and create improvement suggestions.

## Trust Boundaries

- Tenant data must be isolated at every API, query, memory, telephony, integration, and event boundary.
- Tool outputs and knowledge retrieval are untrusted content.
- Secrets are stored encrypted and only resolved inside connector/runtime execution.
- Published workflow versions are immutable; active calls do not change mid-call.
`);

write("docs/Feature-Flows.md", `# Feature Flows

## Builder

Tenant creates a draft workflow, adds role/tool/handoff/condition/escalation nodes, validates the graph, previews a runtime manifest, tests in sandbox, then publishes an immutable version.

## Sandbox

User starts a browser call, grants mic access, selects a published or draft-safe workflow, talks to the agent, observes transcript/events/cost, triggers simulated tools, and receives a post-call summary.

## Telephony

Tenant creates a telephony connection. For platform-managed, Zara maps platform numbers. For BYO SIP, tenant enters trunk settings and runs validation. For BYO Twilio, tenant connects credentials, imports numbers, maps numbers to versions, and verifies webhooks.

## Integrations

Tenant admin connects a provider through Zara-owned OAuth app. Zara stores encrypted tenant-scoped tokens. Workflow tools are granted access to specific integration connections. Runtime uses connector tools through scoped references.

## Memory

During a call, session memory captures short-term context. After the call, extractor drafts durable caller/account memories. Tenant policy decides whether memories auto-save or require approval. Users can view, edit, delete, disable, and audit memory.

## Monitoring And Escalation

Operators see live calls, current specialist, transcript, events, model tier, tool activity, latency, and cost. Escalation nodes or runtime signals add a call to a queue. If no human is available, the workflow offers callback, ticket creation, or safe voicemail capture.

## Billing

Usage events are emitted for telephony, STT, model, TTS, storage, integrations, and workflow jobs. Budgets and plan limits can block publish, call start, premium runtime, or outbound campaigns.
`);

write("docs/API.md", `# API Docs

## API Style

The control plane is a NestJS API. All tenant-scoped routes require authenticated organization membership. Public telephony webhooks require provider signature verification and idempotency keys.

## Modules

- Auth: Better Auth integration, sessions, invitations, roles.
- Organizations: tenants, memberships, permissions.
- Agents: roles, prompts, language policies, model defaults.
- Workflows: draft graphs, validation, publishing, manifest preview.
- Runtime: manifest compilation, sandbox start, runtime events.
- Telephony: connections, numbers, webhooks, dispatch, health checks.
- Integrations: OAuth connections, connector health, tool grants.
- Memory: records, retrieval, approval, retention, deletion.
- Calls: sessions, transcripts, recordings, summaries, dispositions.
- Monitoring: live event stream, escalation queue, quality flags.
- Billing: usage events, budgets, plan limits, cost estimates.
- Audit: immutable security and admin activity records.

## Representative Routes

- POST /organizations/:orgId/workflows/:workflowId/validate
- POST /organizations/:orgId/workflows/:workflowId/publish
- GET /organizations/:orgId/workflows/:workflowId/manifest-preview
- POST /organizations/:orgId/sandbox/calls
- POST /organizations/:orgId/telephony/connections
- POST /organizations/:orgId/telephony/connections/:id/validate
- POST /organizations/:orgId/integrations/:provider/connect
- GET /integrations/oauth/:provider/callback
- GET /organizations/:orgId/memory
- PATCH /organizations/:orgId/memory/:memoryId
- DELETE /organizations/:orgId/memory/:memoryId
- GET /organizations/:orgId/calls/:callId/events
- POST /telephony/webhooks/:provider

## Contract Rules

- APIs never return raw secrets.
- Tenant ID is always derived from authenticated membership or verified telephony route, not trusted from arbitrary payloads.
- Mutations write audit logs.
- Runtime event writes are idempotent.
- Published versions are immutable.
`);

write("docs/Data-Model.md", `# Data Model

## Core Entities

- organizations
- users
- organization_memberships
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

## Telephony

Telephony connections include ownership mode, provider, region, status, credential reference, inbound mapping, outbound caller ID policy, recording policy, failover settings, and health status.

## Integrations

Integration connections include provider, OAuth app ownership, scopes, encrypted credential reference, health, connected actor, tenant, and revocation state.

## Memory

Memory records include scope, subject reference, source call/transcript/tool, text/fact payload, embedding, confidence, approval state, retention state, and audit metadata.

## Invariants

- Every tenant-scoped row includes organization ID.
- Every call pins a workflow version and runtime manifest.
- Every secret is stored as an encrypted credential reference.
- Every durable memory record is visible and deletable through tenant policy.
- Every usage event is idempotent and attributable.
`);

write("docs/Runtime-Manifests.md", `# Runtime Manifests

Runtime manifests are compiled from published workflow versions and tenant configuration. They are immutable for a call.

## Manifest Contents

- organization ID and environment
- published workflow version
- entry role
- role instructions and handoff descriptions
- runtime profile: cost_optimized, balanced, premium_realtime
- model routing policy
- telephony connection ID and ownership mode
- tool definitions and integration connection IDs
- memory policy and retrieval scopes
- escalation policy
- telemetry and retention policy
- budget limits

## Runtime Profiles

- cost_optimized: default sandwich runtime using STT, text model/router, and TTS.
- balanced: sandwich runtime with stronger model/TTS defaults.
- premium_realtime: OpenAI Realtime speech-to-speech, selected only by explicit policy.

## Compile-Time Validation

- Entry node exists.
- All referenced roles, tools, telephony connections, and integrations exist.
- Memory scopes are allowed by tenant policy.
- Escalation fallback exists.
- Budget policy allows selected runtime.
- No unsafe cycles or unreachable required nodes.
`);

write("docs/Telephony.md", `# Telephony

## Ownership Modes

- platform_managed: Zara controls provider account, numbers, and trunks.
- byo_sip_trunk: tenant configures SIP trunk credentials and routing.
- byo_provider_account: tenant connects provider credentials, starting with Twilio.

## BYO Twilio V1

- Store encrypted credential reference.
- Validate account access.
- Import voice-capable numbers.
- Configure or verify webhooks.
- Map imported numbers to published workflow versions.
- Show health and last validation result.

## BYO SIP V1

- Store encrypted SIP credentials and trunk metadata.
- Validate SIP route with test call or provider diagnostic.
- Capture codec, region, failover, and caller ID policy.
- Block production routing if required health checks fail.

## Required Events

- call.started
- call.ended
- call.failed
- telephony.webhook.received
- telephony.route.resolved
- telephony.health.failed
- telephony.transfer.requested
- telephony.voicemail.detected
- telephony.dtmf.received

## Edge Cases

DTMF menus, voicemail detection, transfers, duplicate webhooks, carrier retries, disabled numbers, provider outage, bad credentials, codec mismatch, and calling-window enforcement must be covered.
`);

write("docs/Integrations.md", `# Integrations

## Auth Model

V1 uses Zara-owned OAuth apps. Tenant admins connect accounts through provider consent screens. Tokens are encrypted and stored as tenant-scoped credential references.

## Connector Requirements

- Minimal scopes.
- Token refresh.
- Reconnect and revoke.
- Health check.
- Rate-limit handling.
- Tool schemas.
- Per-role and per-workflow grants.
- No raw token exposure to agents or clients.

## Initial Connectors

- Zendesk: ticket search/create/update.
- HubSpot: contact lookup, notes, pipeline updates.
- Google Workspace: calendar availability and event creation.
- Notion: knowledge search and task/page creation.
- Webhook/HTTP: tenant-defined tools with secure secrets.

## Runtime Use

Agents do not receive credentials. Runtime resolves tool grants, loads connector by integration connection ID, executes the tool, emits events, and redacts sensitive output before storage when policy requires it.
`);

write("docs/Memory.md", `# Memory

## Memory Scopes

- session: active-call context.
- caller: facts tied to a caller identity.
- account: facts tied to a CRM/customer account.
- tenant_knowledge: business policies, FAQs, documents, and knowledge sources.

## Defaults

Durable memory is scoped and opt-in. Session memory is allowed for active calls. Caller/account memory should be drafted after calls and saved according to tenant policy.

## Storage

Use Postgres as source of truth and pgvector for semantic retrieval. Store source references, confidence, approval state, retention state, and audit metadata.

## Controls

Tenant users can view, edit, delete, disable, approve, reject, and audit memory. Retention policies must purge memory and embeddings.

## Safety

Do not automatically persist sensitive data. Memory extraction must filter secrets, regulated data, payment data, and irrelevant personal details. Retrieved memory must be clearly separated from system instructions.
`);

write("docs/Security-Compliance.md", `# Security And Compliance

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
`);

write("docs/TDD.md", `# TDD

Zara is a strict RED/GREEN/REFACTOR project.

## Rule

No production code without a failing test first.

## Cycle

1. RED: write one minimal failing test for the desired behavior.
2. Verify RED: run the test and confirm it fails for the expected reason.
3. GREEN: write the smallest production code that passes.
4. Verify GREEN: run the test and related suite.
5. REFACTOR: clean up while keeping tests green.

## Priority

Prioritize unit, integration, contract, runtime, telephony, security, and tenant-isolation tests. UI tests should be light and focused on critical flows.

## Handover Evidence

Every issue handover must record:

- failing test written
- RED result
- GREEN result
- refactor verification
- commands run
- remaining risk
`);

write("docs/Testing-Strategy.md", `# Testing Strategy

## Test Layers

- Unit: domain policies, validators, manifest compiler, routing, memory filters, cost estimation.
- Integration: NestJS modules, database, auth, connectors, telephony webhooks, queues.
- Contract: public API routes, runtime event schemas, connector tool schemas.
- Security: tenant isolation, RBAC, secrets, webhook signatures, prompt injection.
- Runtime: STT/model/TTS adapter contracts, event ordering, idempotency, fallback.
- Telephony: BYO Twilio, BYO SIP, platform routing, DTMF, voicemail, failover.
- UI: light smoke tests for builder, sandbox, monitor, memory management.

## Required For Completion

Each issue must include tests appropriate to its layer. If tests are deferred, the handover must explain why and record the risk.
`);

write("docs/Roadmap.md", `# Roadmap

## Foundation

Workspace, NestJS API, shared types, Postgres migrations, Better Auth organizations, CI, environment config, and secrets strategy.

## MVP Builder

Dashboard shell, React Flow builder, role/tool/handoff/condition/escalation nodes, validation, publishing, and manifest preview.

## Sandbox

Runtime manifest compiler, cost-optimized sandwich adapter, runtime profiles, model router, event stream, cost estimation, and browser sandbox call.

## Telephony MVP

Telephony connection model, platform-managed connection, BYO SIP, BYO Twilio, number import, webhooks, inbound/outbound dispatch, recording policy, DTMF/voicemail/transfer/failover, health checks.

## Integrations

OAuth framework, encrypted credential storage, Zendesk, HubSpot, Google Workspace, Notion, webhook tools, health/revocation, and permission grants.

## Monitoring

Session/caller/account/tenant memory, pgvector retrieval, extraction, approval, live monitor, event timeline, telemetry, escalation queue, human fallback, summaries, CRM sync, and improvement suggestions.

## Production

Tenant isolation, audit, consent, retention, secrets rotation, prompt injection defenses, outbound compliance, redaction, usage metering, budgets, deployments, observability, backup/DR, provider fallback, and production readiness.
`);

write("docs/01-document-comparison.md", `# Document Comparison And Stack Decision

The original Cloudflare, LangChain, and OpenAI notes support a hybrid design.

## Current Decision

- Default runtime: cost-optimized STT -> text model/router -> TTS.
- Premium runtime: OpenAI Realtime speech-to-speech.
- Edge/session fabric: Cloudflare Durable Objects where useful for live state and fanout.
- Orchestration and evaluation: workflow engine plus LangSmith-style tracing where useful.
- Control plane: NestJS, not Hono, because the platform is a modular SaaS backend.

See [Architecture](Architecture.md), [Runtime Manifests](Runtime-Manifests.md), and [Telephony](Telephony.md).
`);

write("docs/02-system-architecture.md", `# System Architecture

This document has been superseded by [Architecture](Architecture.md). Keep this file as a compatibility pointer for older references.

Key updates:

- NestJS control plane.
- Cost-first sandwich runtime default.
- OpenAI Realtime premium/escalation runtime.
- Platform telephony, BYO SIP, and BYO provider account support.
- Platform OAuth integrations.
- Scoped opt-in memory with Postgres + pgvector.
`);

write("docs/03-implementation-roadmap.md", `# Implementation Roadmap

This document has been superseded by [Roadmap](Roadmap.md) and [Issue Backlog](Issue-Backlog.md).
`);

write("docs/Issue-Backlog.md", `# Issue Backlog

This is the canonical local backlog. GitHub issues should mirror these items. Every item has a matching handover document in docs/Handovers.

${issues.map(issueMarkdown).join("\n")}
`);

write("docs/issues.json", JSON.stringify(issues.map((issue, index) => {
  const [title, area, milestone, priority, labels, acceptance, edges] = issue;
  return {
    id: issueId(index),
    number: index + 1,
    title,
    area,
    milestone,
    priority,
    labels,
    handover: handoverPath(index, title),
    acceptance,
    edgeCases: edges,
  };
}), null, 2));

write("docs/Handovers/README.md", `# Handovers

This folder holds one handover document per issue.

Rules:

- Create or update the issue-specific handover every time work is done.
- Do not combine multiple issues into one handover.
- Keep the issue link, goal, work completed, tests run, pending work, risks, decisions, and next recommended step current.
- Record RED/GREEN/REFACTOR evidence for production-code issues.
`);

issues.forEach((issue, index) => {
  write(handoverPath(index, issue[0]), handoverMarkdown(issue, index));
});

console.log(`Seeded ${issues.length} issues and handovers.`);
