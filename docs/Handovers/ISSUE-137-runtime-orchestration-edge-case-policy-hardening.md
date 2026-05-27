# ISSUE-137: Runtime orchestration edge-case policy hardening

Status: In Progress
Date: 2026-05-27
External: [Linear ZAR-71](https://linear.app/zara-voice/issue/ZAR-71/issue-137-runtime-orchestration-edge-case-policy-hardening)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added edge-case and mitigation policy standards in `docs/Runtime-Orchestration-Edge-Cases-And-Policies.md`.
- Linked policy testing expectations from roadmap, architecture, manifest, feature-flow, and testing docs.
- Moved Linear `ZAR-71` and local `ISSUE-137` records to `In Progress` before implementation.
- Added direct transfer loop prevention: if the next direct agent target was already visited, routing stops on the current target agent, clears the frontier, and emits a recoverable `transfer_loop.detected` packet warning.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --testNamePattern "transfer loops"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- Continue adding failing policy tests for each remaining documented intent, tool, transfer, runtime, and security edge case.
- Enforce packet-backed warnings, replayable ordered events, redaction, and tenant/workspace packet isolation.
- Update `docs/Security-Compliance.md`, runtime docs, and monitoring docs with implemented behavior.

## Risks

- This issue depends on the packet, intent, toolbelt, and transfer context slices.
- Some policies may require small schema or event-version changes to avoid breaking existing monitors.
- Edge-case coverage can sprawl; keep tests tied to the documented policy table.
- ZAR-71 is intentionally open after the transfer-loop slice; remaining policies still need implementation.

## Decisions

- Policy guards should validate model outputs rather than trusting them.
- Runtime never accepts graph target IDs from model output.
- Human approval gates are runtime states, not UI-only hints.
- Direct transfer loops stop on the current target agent instead of falling back to the entry role.

## Next Recommended Step

- Continue with the next documented policy guard, preferably invalid agent model-command targets or language mismatch for transfers.
