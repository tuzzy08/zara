# AGENTS.md

This repository is a strict TDD project. Every agent must use these docs as operating context before doing work. The required implementation cycle is RED/GREEN/REFACTOR.

## Required Reading Before Each Pass

Read these before starting or resuming any issue:

- docs/PRD.md
- docs/Architecture.md
- docs/Frontend-Architecture.md
- docs/Roadmap.md
- docs/Issue-Backlog.md
- the active issue handover in docs/Handovers/

If the task touches runtime, telephony, integrations, memory, platform admin, security, API, or tests, also read the matching domain doc.
If the task touches any UI, read `DESIGN.md` first. `DESIGN.md` is the source of truth for UI work and should be updated as the product evolves.

## Handover Rule

Every issue must have exactly one issue-specific handover document:

- Path pattern: docs/Handovers/ISSUE-###-short-title.md
- Update the handover every time you work on that issue.
- Include work completed, tests run, pending work, risks, decisions, and next recommended step.
- Do not use a shared handover for multiple issues.

## Issue Status Rule

After every issue pass, keep issue status records in sync before ending the turn:

- Update the issue's `Status:` line in `docs/Issue-Backlog.md` to match the real state of the work.
- Keep the issue handover's completed work, tests run, pending work, risks, decisions, and next step consistent with that status.
- When a feature slice is completed, update the slice summary in `docs/Issue-Backlog.md` and the matching note in `docs/Roadmap.md`.
- Do not leave an issue marked `Pending` when its acceptance criteria are implemented, and do not mark an issue `Implemented` while required acceptance work remains.

## External Issue Reconciliation Rule

Do not create repo-local issues only. Every issue added to `docs/Issue-Backlog.md` must also have a matching external tracker issue, currently Linear unless the user explicitly chooses GitHub.

- Add an `External:` line with the Linear or GitHub issue link in `docs/Issue-Backlog.md`.
- Add the same external issue link to the issue-specific handover.
- Keep local status, handover status, and external tracker status synchronized whenever work starts, pauses, completes, or is blocked.
- If the external tracker is unavailable, do not add the local issue silently; tell the user what is blocked.

## TDD Rule

No production code without a failing test first. Follow RED/GREEN/REFACTOR for every production-code change.

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

## UI Quality Rule

Build UI that feels production-quality from the start.

- Do not ship scaffold language, placeholder marketing copy, or boilerplate filler in cards, panels, empty states, headers, or dashboards.
- Do not repeat hero-style cards across pages.
- Do not add unnecessary page headers or titles when the layout already communicates context.
- Use `DESIGN.md` as the reference point before writing or revising UI.

## Architecture Defaults

- NestJS control plane.
- Default to Nest scaffold generators for modules, controllers, services, and related shells instead of hand-writing those files when generators fit the job.
- Two Vite React apps: `apps/web` for tenants and `apps/platform-admin` for Zara staff.
- Tailwind CSS v4, shadcn/ui primitives, and Lucide icons are the default frontend stack. Customize them to match `DESIGN.md`; do not ship stock shadcn presentation.
- Postgres data store with pgvector for memory retrieval.
- Better Auth for user auth and organizations.
- Cost-optimized sandwich runtime by default.
- OpenAI Realtime only for premium/escalation runtime policies.
- Platform telephony, BYO SIP trunks, and BYO provider accounts starting with Twilio.
- Platform-owned OAuth apps for CRM/productivity integrations.
- Encrypted tenant-scoped secrets with envelope encryption.


## Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
