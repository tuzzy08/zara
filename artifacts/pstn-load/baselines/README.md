# PSTN single-instance baselines

This directory retains approved `zara.pstn-load-report.v1` stepped reports captured against the pre-persistence single-instance deployment.

Do not add local workstation, synthetic-only, failed, or redaction-invalid reports. Each retained baseline must identify the deployed commit and be accompanied in release records by the exact API/realtime worker CPU, memory, file-descriptor, Postgres pool, and replica shape.
