# ISSUE-126: Tenant JSON state adapter deepening

External: [Linear ZAR-135](https://linear.app/zara-voice/issue/ZAR-135/issue-126-tenant-json-state-adapter-deepening)

## Goal

Deepen tenant-scoped JSON file persistence so common path resolution, tenant listing, load, save, atomic replacement, and corrupt snapshot quarantine live behind one module while each feature repository keeps its domain-specific validation and public interface.

## Acceptance Criteria

- Tenant-scoped JSON file persistence uses a shared adapter for path resolution, list, load, save, atomic replacement, and corrupt snapshot quarantine.
- Billing, integrations, memory, and telephony state repositories preserve their public repository interfaces and domain-specific validation.
- Focused tests cover the shared adapter without booting feature services, and existing persistence tests remain green.

## Work Completed

- Created ISSUE-126 as the issue-specific handover for this architecture deepening pass.
- Updated the local backlog and roadmap to track the tenant JSON state adapter issue.
- Added focused coverage for the shared tenant JSON state adapter in `apps/api/src/persistence/tenant-json-state.repository.test.ts`.
- Added `apps/api/src/persistence/tenant-json-state.repository.ts` as the shared adapter for tenant-scoped JSON file persistence.
- Rewired billing, integrations, memory, and telephony file repositories to use the shared adapter while keeping each feature's repository interface and validator local.
- Preserved memory's persisted-state normalization for optional arrays.
- Preserved billing's encoded file names, trailing newline writes, and throw-on-corrupt behavior while adding compatibility normalization for optional event arrays.
- Preserved integrations, memory, and telephony corrupt snapshot quarantine behavior.
- Follow-up on 2026-06-04: hardened the integrations module wiring so a blank `ZARA_INTEGRATION_STATE_DIR` is treated as unset before the shared tenant JSON adapter is constructed.
- Documented the shared tenant JSON adapter in `docs/Architecture.md`, `docs/API.md`, and `docs/Testing-Strategy.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/persistence/tenant-json-state.repository.test.ts`
  - Failed as expected because `./tenant-json-state.repository` did not exist yet.
- GREEN: `npm.cmd run test:run -- apps/api/src/persistence/tenant-json-state.repository.test.ts`
  - Passed: 1 file, 2 tests.
- Persistence verification: `npm.cmd run test:run -- apps/api/src/persistence/tenant-json-state.repository.test.ts apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/memory/memory.persistence.test.ts apps/api/src/telephony/telephony.persistence.test.ts`
  - Passed: 4 files, 13 tests.
- Typecheck: `npm.cmd run typecheck --workspace @zara/api`
  - Passed.
- Targeted lint: `npx.cmd eslint apps/api/src/persistence/tenant-json-state.repository.ts apps/api/src/persistence/tenant-json-state.repository.test.ts apps/api/src/billing/billing-state.repository.ts apps/api/src/integrations/integrations-state.repository.ts apps/api/src/memory/memory-state.repository.ts apps/api/src/telephony/telephony-state.repository.ts`
  - Passed.
- Billing sanity check: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts`
  - Passed: 1 file, 7 tests.
- Docs follow-up: `git diff --check`
  - Passed with Git's existing Windows line-ending conversion warnings only.
- RED follow-up: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "blank" --pool=forks --maxWorkers=1 --reporter=dot`
  - Failed as expected with `mkdir ''` and HTTP 500 while saving Zendesk credentials.
- GREEN follow-up: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "blank" --pool=forks --maxWorkers=1 --reporter=dot`
  - Passed: 1 file, 1 test.
- Persistence regression follow-up: `npm.cmd exec -- vitest run apps/api/src/persistence/tenant-json-state.repository.test.ts apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/integrations/integrations.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
  - Passed: 3 files, 19 tests.
- Typecheck follow-up: `npm.cmd run typecheck --workspace @zara/api`
  - Passed.
- Targeted lint follow-up: `npx.cmd eslint apps/api/src/integrations/integrations.module.ts apps/api/src/integrations/integrations.controller.test.ts`
  - Passed.
- Docs follow-up: `git diff --check`
  - Passed with Git's existing Windows line-ending conversion warnings only.

Notes:
- An initial `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts` attempt hit the command timeout before surfacing an assertion result. The later longer run passed.

## Pending Work

- No required acceptance work remains for ISSUE-126.
- Future persistence passes can decide whether audit-log JSON storage should move to the same adapter; it has a different append/log shape, so it was intentionally left out of this issue.

## Risks And Edge Cases

- Missing tenant snapshots should return `null`.
- Invalid JSON or invalid tenant structure should be moved aside as a corrupt snapshot where the feature expects quarantine.
- Temporary files and quarantined snapshots should not be returned by tenant listing.
- Billing currently throws on corrupt JSON; preserve or explicitly document any behavior change.
- Feature modules that accept environment-provided state directories should treat blank values as unset before constructing file repositories.

## Decisions

- Keep feature-specific validators inside each feature repository so domain shape remains local.
- Put only generic tenant JSON file mechanics behind the shared module interface.
- Treat this as an architecture deepening pass; no service API behavior should change.
- Keep billing's corrupt JSON behavior as throw-and-surface instead of quarantine because that was its existing file repository contract.
- Keep blank environment fallback in module wiring instead of silently saving tenant snapshots into the process directory from the shared adapter.

## Next Recommended Step

Pick the next persistence seam only after identifying a behavior that can be covered with a focused failing test.
