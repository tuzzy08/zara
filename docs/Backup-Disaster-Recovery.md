# Backup And Disaster Recovery

## Backup Coverage

Production backups must cover every system required to restore tenant service without losing security or audit context.

Required backup targets:

- Postgres primary database, including Better Auth tables, organizations, workspaces, workflow drafts, published versions, telephony state, live-session event history, integrations, memory, billing, compliance audit logs, and platform-admin audit records.
- Postgres migration history from `apps/api/src/database/migrations` so restored databases can be checked against the release artifact.
- critical object storage buckets or prefixes for recordings, transcript exports, memory exports, tenant data exports, support attachments, and generated compliance evidence.
- Provider configuration evidence: webhook endpoint inventory, provider account IDs, Polar product/price IDs, and OAuth app IDs. Provider secrets themselves stay in the secret manager and are restored through secret-manager recovery, not object backups.
- Deployment metadata: release version, image/build artifact IDs, migration version, environment variable version, and rollback owner.

Backups must not contain decrypted provider credentials. Encrypted envelopes may be present only as part of the database backup, and key material must remain in the deployment secret manager.

## Backup Schedule

- Postgres continuous WAL/PITR is enabled with at least 7 days retention.
- Daily logical Postgres export is retained for 30 days.
- Weekly logical Postgres export is retained for 90 days.
- critical object storage versioning is enabled for recordings, exports, and compliance evidence.
- Object storage inventory is captured daily so missing objects can be detected during restore test validation.
- Secret-manager recovery metadata is reviewed during every credential rotation and before production releases that touch auth, telephony, integrations, billing, or runtime providers.

## Restore Procedure

Restore procedure for a production incident:

1. Declare incident severity, release owner, restore owner, and tenant impact.
2. Freeze destructive background jobs, retention jobs, billing usage forwarding retries, and provider webhook endpoint changes.
3. Select the restore point by `traceId`, incident time, release version, and migration version.
4. Restore Postgres into an isolated recovery database.
5. Verify migration history against the release artifact with `npm run db:check` or the equivalent release CI migration check.
6. Restore critical object storage into an isolated recovery bucket or prefix.
7. Run object inventory validation for recordings, exports, and compliance evidence referenced by the restored database.
8. Run a restore test against the isolated environment: API health, auth session read, tenant workspace read, billing state read, compliance audit read, memory export read, telephony state read, and a voice sandbox session.
9. Compare restored counts for tenants, workspaces, published versions, telephony routes, billing usage events, audit logs, and object references.
10. Promote the restored database and object storage target only after the restore owner and security owner sign off.
11. Run production smoke tests and observability dashboard checks after traffic is restored.

Quarterly restore test:

- Restore the latest production backup into a non-production recovery environment.
- Run the restore test checklist above.
- Record duration, failures, object gaps, migration drift, and corrective actions.
- Treat failed restore test evidence as a release-blocking production readiness risk until resolved.

## RPO/RTO Targets

Targets:

- Standard production RPO: 15 minutes for Postgres and 24 hours for object storage inventory.
- Critical auth, billing, audit, telephony route, and published workflow RPO: 15 minutes through Postgres PITR.
- Standard production RTO: 4 hours for full tenant service restore.
- Critical read-only RTO: 1 hour for auth, tenant state, audit, billing state, and platform-admin visibility.
- Single-tenant object restore RTO: 8 hours when object storage remains healthy but an object prefix needs recovery.

If RPO or RTO cannot be met during an incident, the restore owner must record the gap in the production readiness checklist and the incident review.

## Partial Restore

partial restore is allowed only when it is safer than a full environment rollback.

Allowed partial restore cases:

- Restore a deleted recording/export object from object storage version history.
- Restore tenant memory or knowledge data for one tenant from an isolated database export.
- Restore provider webhook configuration evidence without changing secrets.
- Restore a wrongly archived workspace or published workflow record after confirming no newer tenant action depends on the deletion.

Partial restore controls:

- Never overwrite another tenant's rows or objects.
- Always restore into an isolated environment first.
- Diff restored rows and object references before applying production changes.
- Write tenant compliance audit and platform-admin audit records for the restore action.
- Verify affected dashboards, billing state, and retention posture after the restore.

## Corrupt Backup

corrupt backup response:

1. Mark the backup set as unusable and remove it from automated restore candidates.
2. Attempt restore from the previous known-good backup or PITR point.
3. Compare object storage inventory and database reference counts to identify the corruption boundary.
4. Page the restore owner if the corruption threatens the RPO target.
5. Open a production readiness risk with the affected backup timestamp, tenant scope, and replacement backup plan.
6. Run a fresh backup and restore test before closing the risk.

## Ownership

The restore owner runs the recovery procedure. Security owns secret-manager recovery and audit integrity. Billing owns Polar and usage-event reconciliation. Telephony owns provider route validation and webhook replay posture. The release owner decides whether to rollback the application artifact or restore data forward.
