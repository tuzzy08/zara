# ISSUE-064: Audit logging

Issue link: https://github.com/tuzzy08/zara/issues/64

## Goal

Deliver Audit logging for the Security area in the Production milestone.

## Acceptance Criteria

- Security-sensitive actions create audit records
- Records include actor, tenant, target, and timestamp
- Audit logs are immutable enough for v1

## Work Completed

- Added the tenant compliance audit API:
  - `GET /organizations/:organizationId/compliance/audit-logs`
- Added append-only audit log storage with SHA-256 hash chaining (`previousHash` plus `hash`) for v1 immutability.
- Audit records now include tenant, actor, target, action, outcome, timestamp, metadata, and hash chain fields.
- Wired telephony credential rotation to emit `telephony.credentials_rotated` audit records.
- Failed compliance actions now emit failed audit records; legal-hold retention attempts emit `retention.deletion_blocked_legal_hold`.
- System actors are represented explicitly when no user actor is supplied.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/compliance/compliance.controller.test.ts` failed because `./compliance.module` did not exist.
- GREEN/REFACTOR:
  - `npm.cmd run test:run -- apps/api/src/compliance/compliance.controller.test.ts`
  - `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
  - `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
  - `npm.cmd run typecheck`
  - `npm.cmd run test:run -- --maxWorkers=1 --no-file-parallelism`
  - `npm.cmd run lint`

## Pending Work

- None for ISSUE-064.

## Risks And Edge Cases

- System actor
- Failed action logging

## Decisions

- Priority: P0
- Labels: security, compliance, tdd-required
- Handover docs are mandatory for every pass on this issue.
- V1 immutability is an append-only API surface plus per-tenant hash chaining. There are no update/delete audit endpoints.
- Audit storage uses the repository pattern so the compliance module can move from file-backed local state to Postgres without changing controllers.

## Next Recommended Step

ISSUE-064 is complete. Continue with downstream platform-admin audit surfaces when ISSUE-094 is picked up.
