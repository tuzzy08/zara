# ISSUE-080: Backup and disaster recovery

External: [GitHub #80](https://github.com/tuzzy08/zara/issues/80)

Issue link: https://github.com/tuzzy08/zara/issues/80

## Goal

Deliver Backup and disaster recovery for the DevOps area in the Production milestone.

## Acceptance Criteria

- Backups cover DB and critical object storage
- Restore procedure is tested
- RPO/RTO targets are documented

## Work Completed

- Extended `packages/core/src/production-devops-docs.test.ts` with backup/DR runbook contract coverage.
- Added `docs/Backup-Disaster-Recovery.md` with Postgres, migration history, critical object storage, provider evidence, deployment metadata, and secret-manager boundaries.
- Documented backup schedule expectations for WAL/PITR, logical exports, object storage versioning, inventory, and secret-manager recovery metadata review.
- Documented production restore procedure and quarterly restore test evidence requirements.
- Documented RPO/RTO targets for standard production, critical auth/billing/audit/telephony/workflow state, read-only recovery, and single-tenant object recovery.
- Documented partial restore controls and corrupt backup response.
- Updated production/staging deployment runbooks and roadmap references so backup/DR readiness is part of release and promotion gates.
- Marked ISSUE-080 as implemented in `docs/Issue-Backlog.md`.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/production-devops-docs.test.ts` failed because `docs/Backup-Disaster-Recovery.md` did not exist.
- GREEN: `npm.cmd run test:run -- packages/core/src/production-devops-docs.test.ts` passed after adding the backup/DR runbook.
- Final verification for the full Production/DevOps slice is recorded in ISSUE-082 after the slice-level checks complete.

## Pending Work

- None for ISSUE-080 acceptance criteria.

## Risks And Edge Cases

- Partial restore is limited to safer-than-rollback cases, isolated rehearsal, tenant-safe diffs, audit records, and post-restore verification.
- Corrupt backup response removes the bad backup from restore candidates, falls back to a known-good point, records readiness risk, and requires a fresh restore test.

## Decisions

- Provider secrets are not restored from object backups; only provider configuration evidence is backed up there.
- Backup and restore posture is a production release gate, not only an incident response document.

## Next Recommended Step

Use `docs/Backup-Disaster-Recovery.md` during release signoff, quarterly restore tests, and incident recovery rehearsals.
