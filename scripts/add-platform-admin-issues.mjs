import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const issuesPath = join(root, "docs/issues.json");
const backlogPath = join(root, "docs/Issue-Backlog.md");

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function issueId(number) {
  return `ISSUE-${String(number).padStart(3, "0")}`;
}

function handoverPath(number, title) {
  return `docs/Handovers/${issueId(number)}-${slugify(title)}.md`;
}

const newIssues = [
  ["Frontend auth client setup", "Auth", "Foundation", "P0", ["auth", "frontend", "tdd-required"], ["Better Auth React client is configured for both Vite apps", "Login, logout, and session state work against the NestJS auth backend", "Route guards cover unauthenticated, tenant, and platform-admin users"], ["Trusted origin missing", "Session expires while app is open"]],
  ["Platform role and permission model", "Security", "Foundation", "P0", ["platform-admin", "auth", "security", "tdd-required"], ["Shared platform and tenant role types exist", "NestJS guards distinguish platform roles from tenant roles", "Tests prove tenant admins are not platform admins"], ["Role downgraded during session", "Conflicting tenant and platform roles"]],
  ["Platform admin app scaffold", "Platform Admin", "Foundation", "P0", ["platform-admin", "frontend", "tdd-required"], ["`apps/platform-admin` Vite React app is created", "It has independent routing, shell, build script, and env config", "It shares only approved packages with tenant app"], ["Wrong API origin", "Shared component imports tenant-only code"]],
  ["Platform admin auth client and access gate", "Platform Admin", "Foundation", "P0", ["platform-admin", "auth", "security", "tdd-required"], ["Platform admin app uses Better Auth React client", "Non-platform users are blocked from admin UI", "Server-side platform guard rejects unauthorized API calls"], ["Tenant admin tries admin app", "Platform role revoked mid-session"]],
  ["Platform admin dashboard shell", "Platform Admin", "MVP Builder", "P1", ["platform-admin", "frontend", "tdd-required"], ["Dashboard shows system health, tenants, calls, runtime status, spend, incidents, and abuse queues", "Navigation is independent from tenant app", "UI smoke test covers dashboard load"], ["Empty state", "Provider status unavailable"]],
  ["Platform organization management", "Platform Admin", "MVP Builder", "P1", ["platform-admin", "backend", "tdd-required"], ["Platform admins can view tenant status, plan, usage, telephony, integration state, and risk flags", "Tenant status changes are permissioned", "Status changes are audited"], ["Suspended tenant with active calls", "Readonly admin attempts mutation"]],
  ["Platform user and membership support tools", "Platform Admin", "MVP Builder", "P1", ["platform-admin", "auth", "tdd-required"], ["Platform admins can view users and memberships", "Support actions are permissioned and audited", "No raw secrets or credentials are exposed"], ["Deleted user", "Membership removed during support flow"]],
  ["Platform telephony operations dashboard", "Platform Admin", "Telephony MVP", "P1", ["platform-admin", "telephony", "tdd-required"], ["Platform admins can inspect platform-managed, BYO SIP, and BYO Twilio connections", "Health, route, and webhook failures are visible", "Raw provider credentials are never exposed"], ["Provider outage", "Tenant connection disabled mid-call"]],
  ["Platform integration operations dashboard", "Platform Admin", "Integrations", "P1", ["platform-admin", "integrations", "tdd-required"], ["Platform admins can inspect connector health, token status, sync failures, and revocation state", "Raw OAuth tokens are never exposed", "Retry/reconnect diagnostics are visible"], ["Token refresh failure", "Connector outage"]],
  ["Runtime provider health dashboard", "Platform Admin", "Monitoring", "P1", ["platform-admin", "runtime", "monitoring", "tdd-required"], ["Platform admins can see STT, TTS, model, realtime, telephony, and queue health by provider and region", "Health events include timestamps and severity", "Outage state is visible"], ["Partial regional outage", "Stale health signal"]],
  ["Platform usage and billing controls", "Platform Admin", "Production", "P1", ["platform-admin", "billing", "tdd-required"], ["Platform admins can inspect usage, budgets, overages, premium realtime usage, and plan limits across tenants", "Plan/budget changes are audited", "Readonly admins cannot mutate billing controls"], ["Budget reached mid-call", "Pricing table missing"]],
  ["Platform admin audit log", "Platform Admin", "Production", "P0", ["platform-admin", "security", "compliance", "tdd-required"], ["Every platform admin action records actor, target, tenant, action, timestamp, metadata, and impersonation state", "Audit log can be filtered by actor, tenant, and action", "Audit records are not editable by normal admins"], ["System actor", "Failed mutation still audited"]],
  ["Platform impersonation workflow", "Platform Admin", "Production", "P0", ["platform-admin", "security", "tdd-required"], ["Impersonation is time-boxed, permissioned, visibly marked, auditable, and revocable", "Destructive actions are blocked unless explicitly allowed", "Tenant and platform audit records link to the impersonation session"], ["Session expires during impersonation", "Role revoked while impersonating"]],
  ["Abuse and compliance review queue", "Platform Admin", "Production", "P1", ["platform-admin", "compliance", "security", "tdd-required"], ["Platform admins can review outbound abuse signals, DNC violations, consent issues, prompt-injection flags, and suspension recommendations", "Review decisions are audited", "Queue supports safe escalation and dismissal"], ["False positive", "Compromised tenant account"]],
  ["Platform admin deployment and domain config", "DevOps", "Production", "P1", ["platform-admin", "devops", "security", "tdd-required"], ["`apps/platform-admin` has separate deploy config and environment variables", "Trusted origins include local, staging, and production admin domains", "Security headers and CSP can differ from tenant app"], ["Wrong domain points to tenant app", "Missing staging origin"]],
  ["Shared frontend packages setup", "Frontend", "Foundation", "P1", ["frontend", "platform-admin", "tdd-required"], ["`packages/ui`, `packages/api-client`, and `packages/auth-client` are planned or scaffolded for shared frontend code", "Shared packages do not depend on tenant-only or admin-only app code", "Typecheck covers shared package boundaries"], ["Circular workspace dependency", "Admin-only component leaks into tenant app"]],
];

function issueMarkdown(issue) {
  return `### ${issue.id}: ${issue.title}

- Priority: ${issue.priority}
- Area: ${issue.area}
- Milestone: ${issue.milestone}
- Labels: ${issue.labels.join(", ")}
- Handover: [${issue.handover}](../${issue.handover})

Acceptance criteria:
${issue.acceptance.map((item) => `- ${item}`).join("\n")}

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
${issue.edgeCases.map((item) => `- ${item}`).join("\n")}
`;
}

function handoverMarkdown(issue) {
  return `# ${issue.id}: ${issue.title}

Issue link: https://github.com/tuzzy08/zara/issues/${issue.number}

## Goal

Deliver ${issue.title} for the ${issue.area} area in the ${issue.milestone} milestone.

## Acceptance Criteria

${issue.acceptance.map((item) => `- ${item}`).join("\n")}

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

${issue.edgeCases.map((item) => `- ${item}`).join("\n")}

## Decisions

- Priority: ${issue.priority}
- Labels: ${issue.labels.join(", ")}
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
`;
}

const existingIssues = JSON.parse(readFileSync(issuesPath, "utf8"));
const byTitle = new Map(existingIssues.map((issue) => [issue.title, issue]));
let nextNumber = Math.max(...existingIssues.map((issue) => issue.number)) + 1;

for (const [title, area, milestone, priority, labels, acceptance, edgeCases] of newIssues) {
  if (byTitle.has(title)) continue;
  const number = nextNumber++;
  const issue = {
    id: issueId(number),
    number,
    title,
    area,
    milestone,
    priority,
    labels,
    handover: handoverPath(number, title),
    acceptance,
    edgeCases,
  };
  existingIssues.push(issue);
  const handoverFullPath = join(root, issue.handover);
  mkdirSync(dirname(handoverFullPath), { recursive: true });
  writeFileSync(handoverFullPath, `${handoverMarkdown(issue).trim()}\n`, "utf8");
}

writeFileSync(issuesPath, `${JSON.stringify(existingIssues, null, 2)}\n`, "utf8");
writeFileSync(
  backlogPath,
  `# Issue Backlog

This is the canonical local backlog. GitHub issues should mirror these items. Every item has a matching handover document in docs/Handovers.

${existingIssues.map(issueMarkdown).join("\n")}
`,
  "utf8"
);

console.log(`Issue backlog now contains ${existingIssues.length} issues.`);
