import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const owner = "tuzzy08";
const repo = "tuzzy08/zara";
const projectTitle = "Zara Voice Agent Platform";
const issues = JSON.parse(readFileSync("docs/issues.json", "utf8"));

function gh(args, options = {}) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function safeGh(args) {
  try {
    return gh(args);
  } catch {
    return "";
  }
}

function ensureLabel(name, color = "6E7781", description = "") {
  const created = safeGh([
    "label",
    "create",
    name,
    "--repo",
    repo,
    "--color",
    color,
    "--description",
    description || name,
  ]);
  if (!created) {
    safeGh([
      "label",
      "edit",
      name,
      "--repo",
      repo,
      "--color",
      color,
      "--description",
      description || name,
    ]);
  }
}

function ensureMilestone(title) {
  const existing = JSON.parse(gh(["api", `repos/${repo}/milestones`, "--paginate"]));
  if (existing.some((milestone) => milestone.title === title)) return;
  gh(["api", `repos/${repo}/milestones`, "-f", `title=${title}`]);
}

function ensureProject() {
  const projects = JSON.parse(gh(["project", "list", "--owner", owner, "--format", "json"])).projects;
  const existing = projects.find((project) => project.title === projectTitle);
  if (existing) return existing.number;

  const created = JSON.parse(
    gh(["project", "create", "--owner", owner, "--title", projectTitle, "--format", "json"])
  );
  const number = created.number;
  gh([
    "project",
    "edit",
    String(number),
    "--owner",
    owner,
    "--description",
    "Kanban delivery board for the Zara voice agent automation platform.",
    "--readme",
    "Strict TDD board for Zara. Work moves through Backlog, Ready, In Progress, Review, Staging, Done, and Blocked. Every issue must have a docs/Handovers handover file.",
  ]);
  return number;
}

function ensureProjectField(projectNumber, name, options) {
  const fields = JSON.parse(
    gh(["project", "field-list", String(projectNumber), "--owner", owner, "--format", "json"])
  ).fields;
  if (fields.some((field) => field.name === name)) return;
  gh([
    "project",
    "field-create",
    String(projectNumber),
    "--owner",
    owner,
    "--name",
    name,
    "--data-type",
    "SINGLE_SELECT",
    "--single-select-options",
    options.join(","),
  ]);
}

function issueBody(issue) {
  return `## ${issue.id}: ${issue.title}

Area: ${issue.area}
Priority: ${issue.priority}
Milestone: ${issue.milestone}
Handover: [${issue.handover}](https://github.com/${repo}/blob/dev/${issue.handover})

## Acceptance Criteria

${issue.acceptance.map((item) => `- [ ] ${item}`).join("\n")}

## TDD Notes

- [ ] Write the failing test first for each production behavior.
- [ ] Verify the RED failure is for the expected missing behavior.
- [ ] Implement the smallest GREEN change.
- [ ] REFACTOR only after tests are green.
- [ ] Update the handover with commands, results, decisions, and remaining risks.

## Edge Cases

${issue.edgeCases.map((item) => `- ${item}`).join("\n")}

## Required Context

- AGENTS.md
- docs/PRD.md
- docs/Architecture.md
- docs/Roadmap.md
- ${issue.handover}
`;
}

function ensureIssue(issue, existingTitles) {
  if (existingTitles.has(issue.title)) {
    console.log(`Issue exists: ${issue.title}`);
    return;
  }

  const bodyPath = join(tmpdir(), `${issue.id}-${Date.now()}.md`);
  writeFileSync(bodyPath, issueBody(issue), "utf8");
  try {
    const args = [
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      issue.title,
      "--body-file",
      bodyPath,
      "--label",
      issue.labels.join(","),
      "--milestone",
      issue.milestone,
      "--project",
      projectTitle,
    ];
    console.log(gh(args));
  } finally {
    unlinkSync(bodyPath);
  }
}

const labelSpecs = [
  ["setup", "0E8A16", "Project setup and workspace"],
  ["auth", "BFD4F2", "Authentication and authorization"],
  ["platform-admin", "5319E7", "Internal platform administration"],
  ["backend", "1D76DB", "Backend and API"],
  ["frontend", "5319E7", "Frontend and product UI"],
  ["runtime", "FBCA04", "Voice runtime and model orchestration"],
  ["telephony", "D93F0B", "Telephony providers and call routing"],
  ["integrations", "006B75", "Third-party integrations"],
  ["memory", "7057FF", "Agent memory and knowledge"],
  ["monitoring", "1B7F79", "Live monitoring and operational visibility"],
  ["security", "B60205", "Security-sensitive work"],
  ["testing", "C5DEF5", "Testing infrastructure"],
  ["devops", "0052CC", "Deployment and operations"],
  ["billing", "0B7285", "Billing and metering"],
  ["docs", "0075CA", "Documentation"],
  ["edge-case", "D4C5F9", "Edge cases and resilience"],
  ["tdd-required", "E99695", "Must follow RED/GREEN/REFACTOR"],
  ["compliance", "BFDADC", "Compliance and policy"],
  ["good-first-slice", "C2E0C6", "Good early vertical slice"],
];

for (const [name, color, description] of labelSpecs) {
  ensureLabel(name, color, description);
}

for (const milestone of [...new Set(issues.map((issue) => issue.milestone))]) {
  ensureMilestone(milestone);
}

const projectNumber = ensureProject();
ensureProjectField(projectNumber, "Workflow", [
  "Backlog",
  "Ready",
  "In Progress",
  "Review",
  "Staging",
  "Done",
  "Blocked",
]);
ensureProjectField(projectNumber, "Priority", ["P0", "P1", "P2", "P3"]);
ensureProjectField(projectNumber, "Area", [
  "Setup",
  "Backend",
  "Frontend",
  "Runtime",
  "Telephony",
  "Integrations",
  "Memory",
  "Security",
  "Testing",
  "DevOps",
  "Billing",
  "Docs",
]);
ensureProjectField(projectNumber, "Milestone", [
  "Foundation",
  "MVP Builder",
  "Sandbox",
  "Telephony MVP",
  "Integrations",
  "Monitoring",
  "Production",
]);

const existingIssues = JSON.parse(
  gh(["issue", "list", "--repo", repo, "--state", "all", "--limit", "500", "--json", "title"])
);
const existingTitles = new Set(existingIssues.map((issue) => issue.title));

for (const issue of issues) {
  ensureIssue(issue, existingTitles);
}

console.log(`GitHub delivery setup complete for ${repo}. Project #${projectNumber}.`);
