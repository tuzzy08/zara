# ISSUE-178: Platform-admin route policy controls and routing docs

Status: Implemented

External: [Linear ZAR-148](https://linear.app/zara-voice/issue/ZAR-148/issue-178-platform-admin-route-policy-controls-and-routing-docs)

## Work Completed

- Created Linear issue ZAR-148 and linked the local backlog entry.
- Added a platform-admin `/runtime` route policy controls panel for agent-attached route-by-intent behavior.
- Exposed configurable controls for confidence threshold, readiness mode, max clarification turns, announcement mode, fallback target, expected version, and audit reason.
- Added a runtime route policy repository/service/module with in-memory test storage and file-backed durable storage outside tests.
- Added guarded platform-admin `GET /platform-admin/runtime/route-policy` and `PATCH /platform-admin/runtime/route-policy` APIs.
- Route-policy saves require a mutating platform role, MFA/passkey mutation posture, `expectedVersion`, and non-empty `reason`.
- Route-policy saves persist defaults, reject stale versions, and write platform audit records with only version, reason, and changed-key metadata.
- The platform-admin route-policy form now builds the API payload from top-level controls and submits a credentialed `PATCH` request to the save API.
- Kept the UI platform-admin scoped; no tenant `apps/web` builder controls were added.
- Confirmed the tenant builder no longer exposes, renders, edits, repairs, or serializes legacy visible Handoff or Intent route nodes.
- Added docs to `docs/API.md`, `docs/Intent-Routing-Standard.md`, `docs/Platform-Admin.md`, and `docs/Frontend-Architecture.md`.

## Tests Run

- `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`
- `npm.cmd run test:run -- apps/api/src/runtime-route-policy/runtime-route-policy.repository.test.ts`
- `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts -t "runtime route policy"`
- `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx -t "save payload"`
- `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`
- `npm.cmd run test:run -- apps/api/src/runtime-route-policy/runtime-route-policy.repository.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts apps/platform-admin/src/index.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run test:run -- apps/web/src/workflowBuilderWorkbench.test.ts`
- Follow-up cleanup verification: `npm.cmd run test:run -- apps/web/src/workflowBuilderWorkbench.test.ts`
- Follow-up cleanup verification: `npm.cmd run typecheck`

## Pending Work

- None for the ISSUE-178 acceptance criteria.

## Risks

- Persisted route-policy defaults are global platform settings for now; tenant/per-workflow overrides remain out of scope.
- Tenant builder controls remain out of scope by request.
- Tenant builder Handoff/Intent route compatibility paths were removed as part of the follow-up node-surface cleanup; existing saved workflows using those node kinds should be recreated.

## Decisions

- Platform-admin owns global route-policy governance for now.
- The controls explicitly state that classification is runtime-owned and targets come only from configured branch/fallback policy.
- Agent-attached route policies remain the preferred common route-after-agent UX over separate visible intent and handoff nodes.
- Route-policy audit metadata stores version, reason, and changed keys only.

## Next Recommended Step

Keep tenant/per-workflow overrides out of this issue unless a future product slice explicitly introduces them.
