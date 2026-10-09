# ISSUE-249: Dokploy production migration

Status: Implemented
External: https://github.com/tuzzy08/zara/issues/124

## Scope and decisions

- The owner requested migration from Coolify to Dokploy and approved GitHub tracking on 2026-10-09 after Linear reached its issue limit.
- Source: `178.156.251.144`, SSH port `22`, user `root`.
- Destination: `148.113.252.188`, SSH port `5297`, user `ubuntu`, sudo Docker access verified.
- Use the existing local SSH key. No private key was created or copied. The owner added a restricted public-key entry tagged `zara-migration-20261008` to the source; remove that exact entry after migration.
- Keep the source deployment and data intact until restore verification and cutover are complete. Do not combine this migration with billing activation or paid testing.
- Preserve unrelated local changes. Last verified deployed release is `b0005176528d0be43812382dd87e1f857714da4c`; recheck the chosen immutable release before deployment.

## Completed work

### Final cutover, 2026-10-09

- Owner Cloudflare sign-in, maintenance approval, and DNS cutover approval were received. Production now runs on Dokploy `148.113.252.188` from exact release `b0005176528d0be43812382dd87e1f857714da4c`.
- Imported secrets into Dokploy's native Environment settings. A user-only temporary Windows directory was used for UI import and then removed; browser clipboard was cleared. No secret values were printed or committed. Native Deploy/Start now work with the saved environment; removed the custom build-only command and obsolete separate environment copies.
- Compared Docker's effective source and target configuration. Only three values differ: API charge delivery false, fresh worker ID `zara-dokploy-20261009-02`, and corrected worker release ID matching `b000517`. The source had a stale worker release ID. All other environment values and build arguments match.
- Worker had zero active/starting calls before source stop. All source Zara services stopped before backup. API did not exit on SIGTERM and required a forced stop after checking zero active database transactions. Its existing entry point lacks enabled Nest shutdown hooks; no code fix was included in this migration.
- Fresh source backup: `/data/coolify/backups/zara-dokploy-20261009-i7bDMO`. Destination backup: `/home/ubuntu/zara-migration-20261009` (mode 700).
- Logical `postgres.dump` is readable by `pg_restore --list`; SHA256 `5bb8658d4f273e5b07aeff0410e69315c25d5882ff8b872df7646574c36d2781`.
- Cold `volumes.tar.gz` covers all four volumes; SHA256 `86a6b0f26b90bb32ca96b4136e2a3e69b5560ad98ed18d7c46c9fc7dbfe959d6`. Source comparison, transfer checksum, path validation of 1,721 archive entries, and target comparison passed. Target volumes were empty before restore and use prefix `zara-zaraproduction-ev9ose_`.
- Exact source Postgres image `sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b` and Redis image `sha256:dfa18828cbc07b3ae6a95ec7343f6c214fdee2d836197b4be8e9904420762cd8` were pulled and tagged before restore. Retained MinIO is referenced by running containers.
- All seven target services are healthy. Migration and MinIO initializer exited 0. Database has 65 public tables; the cold file comparison, not this table count alone, establishes restore integrity.
- Dedicated Zara Docker network is attached to standalone Dokploy Traefik. HTTPS routes: apex/www to web:80, admin to platform-admin:80, api to api:4010, realtime to realtime-worker:4020.
- Root/wildcard A records now point to `148.113.252.188`, DNS-only with Auto TTL. www CNAME and all mail/TXT records are unchanged. Public resolver checks confirm the new address.
- Initial ACME requests reached the old IP before DNS changed. Restarting only Zara web after cutover triggered a successful certificate check. All five domains now pass normal TLS validation.
- Six public checks returned HTTP 200: apex, www, admin, API readiness, auth `/api/auth/ok`, and worker readiness. The public worker route accepted HTTP 101 with a synthetic path ID; no call-start message or provider session was sent. The idle test client timed out and closed. Unsigned Polar webhook returned HTTP 400; no financial event was submitted.
- Worker 01 was stopped before replacement with worker 02 to correct the inherited stale release setting. Worker 02 is healthy, registered, reports the correct release, has zero active/starting calls, and has 20 available slots. Polar is production; charge delivery is false.
- Source has no running Zara containers. Disabled and reloaded Coolify Auto Deploy to verify it is off. Removed only the exact temporary source SSH entry tagged `zara-migration-20261008`; other entries remain. Old volumes and both backup sets are retained.
- Native generated `.env` is mode 600 within root-only mode-700 resource directory. Native regeneration may use mode 644; the root-only parent still prevents other host users reading it.
- Local screenshot evidence: `.zara-data/migration-dns-complete.png`, `migration-dokploy-domains.png`, and `migration-source-stopped.png`.

### Earlier preparation (superseded where noted above)

- Verified source SSH host identity against the fingerprint read through the authenticated Coolify terminal before accepting it locally.
- Verified direct SSH access to both servers with strict host-key checking.
- Verified source's seven long-running Zara services are healthy.
- Identified four source volumes with prefix `tkldmjzigjt3zqm4ib6i36p8_`: `postgres-data`, `redis-data`, `minio-data`, and `api-state`.
- Verified retained MinIO image `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` and its existing archive `/data/coolify/backups/zara-release-20260929-QE1to7/minio-image.tar` are present.
- Created the external migration issue during preflight, before stopping the source or changing DNS.
- Created Dokploy project `Zara`, production environment, and Compose resource `zara-production` (app name `zara-zaraproduction-ev9ose`, Compose ID `aj30j6WN_sLGw3uXBerUg`). Existing Hello World was left unchanged.
- Created immutable remote tag `zara-dokploy-20261009-b000517` for the deployed release. CI and Migration Check passed for this SHA. Dokploy cloned that exact SHA and completed its build-only deployment successfully in 2m 26s. No target app services were started.
- Copied the retained MinIO archive through SSH and loaded it on the destination. Both archive SHA256 values match: `ff5c117e1c9bb62adb75c040abdcaa7501f0810c3ec4f18098501ba669516ace`. Loaded image matches the pinned image above.
- Copied source environment through direct SSH relay, without printing values. Target uses root-only `/etc/dokploy/compose/zara-zaraproduction-ev9ose/migration.env` (mode 600, parent 700). Intermediate copy is `/home/ubuntu/zara-migration-20261009/source.env` (mode 600, parent 700). Target charge delivery is false and worker ID is `zara-dokploy-20261009-01`; other secret values must remain unchanged.
- Owner approved the maintenance window and DNS cutover on 2026-10-09; Cloudflare sign-in was subsequently completed.
- Recreated the local-only Dokploy SSH tunnel at `127.0.0.1:13000` to destination port 3000 (hidden SSH process 53004).

## Checks

- 2026-10-08 source inventory: Postgres volume about 70 MB, Redis 3.6 MB, MinIO 304 KB, API state 32 KB. These are filesystem sizes, not restore validation.
- 2026-10-09 source worker readiness: ready, registered, Postgres/Redis ready, zero active calls, zero starting calls, 20 available slots. Recheck before any stop.
- 2026-10-09 destination: Dokploy healthy; existing Hello World service remains running; root disk has 83 GB available. Earlier memory check showed about 11 GiB total.
- No production code or tests changed. Final backup restore and public smoke evidence is recorded above.

## Pending work

The infrastructure migration is complete. Owner sign-in and existing-workspace acceptance were not performed. Genuine paid calls and billing enable remain owner actions under ISSUE-248, not tests run during migration. No recurring backup schedule, PITR, HA qualification, or API shutdown-hook fix was added.

## Risks and rollback

- Concurrent source and target processing can duplicate external actions or diverge data. Do not run both application stacks against copied live state.
- The retained MinIO image uses `pull_policy: never`; it must be loaded and verified on the destination before use. Dokploy daily image cleanup is enabled; inspect its effect on retained images before relying on them.
- Historical backups are not a current migration restore point. Create and verify a fresh consistent backup.
- Preserve encryption keys, auth signing secrets, billing ledger/catalogue/mappings, and file-backed integration state together.
- DNS rollback alone is unsafe after new writes reach the target. Stop target writers and reconcile new data before returning authority to the source.
- Billing's last verified state has zero owner enable decisions. Do not enable charge delivery as part of migration.
- Do not deploy/start old Coolify Zara after target writes. Its Auto Deploy is off. Direct source SSH now requires renewed owner authorization; owner Coolify access remains.
- Dokploy uses its deprecated isolated-deployment option with standalone Traefik. Do not assume the same network behavior after changing proxy topology.

## Next step

Owner signs in to the migrated app and confirms an existing workspace. Keep the old server and backups until the owner approves removal. Treat billing activation and paid testing as separate work.
