# AGENTS.md

This repository is a strict TDD project. Every agent must use these docs as operating context before doing work. The required implementation cycle is RED/GREEN/REFACTOR.

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

## Architecture Defaults

- NestJS control plane.
- Postgres data store with pgvector for memory retrieval.
- Better Auth for user auth and organizations.
- Cost-optimized sandwich runtime by default.
- OpenAI Realtime only for premium/escalation runtime policies.
- Platform telephony, BYO SIP trunks, and BYO provider accounts starting with Twilio.
- Platform-owned OAuth apps for CRM/productivity integrations.
- Encrypted tenant-scoped secrets with envelope encryption.
