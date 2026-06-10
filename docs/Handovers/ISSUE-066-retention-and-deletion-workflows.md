# ISSUE-066: Retention and deletion workflows

External: [GitHub #66](https://github.com/tuzzy08/zara/issues/66)

Issue link: https://github.com/tuzzy08/zara/issues/66

## Goal

Deliver Retention and deletion workflows for the Compliance area in the Production milestone.

## Acceptance Criteria

- Tenant retention policies apply to calls, transcripts, memory, and recordings
- Deletion jobs are auditable
- Failures retry

## Work Completed

- Added the tenant retention job API:
  - `POST /organizations/:organizationId/compliance/retention-jobs`
- Retention jobs purge telephony calls and transcript-like call-control events through telephony state.
- Retention jobs invoke memory retention purge so memory, knowledge, embeddings, and ingestion sources are covered.
- Retention jobs process recording object deletions and schedule retries when object deletion fails.
- Legal hold blocks retention deletion and records a failed audit event.
- Completed and retry-scheduled deletion jobs emit auditable compliance records.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/compliance/compliance.controller.test.ts` failed before the compliance module existed.
- GREEN/REFACTOR:
  - `npm.cmd run test:run -- apps/api/src/compliance/compliance.controller.test.ts`
  - `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
  - `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
  - `npm.cmd run typecheck`
  - `npm.cmd run test:run -- --maxWorkers=1 --no-file-parallelism`
  - `npm.cmd run lint`

## Pending Work

- None for ISSUE-066.

## Risks And Edge Cases

- Legal hold
- Object storage delete fails

## Decisions

- Priority: P0
- Labels: compliance, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Retention uses a tenant-scoped compliance job as the orchestration boundary.
- Object storage failures return `retry_scheduled` with `nextRetryAt` and failed targets so an external scheduler can retry the same job.
- Legal hold is enforced before destructive retention work begins.

## Next Recommended Step

ISSUE-066 is complete. Future production object-store adapters can replace the current repository-facing deletion simulation behind the same job contract.
