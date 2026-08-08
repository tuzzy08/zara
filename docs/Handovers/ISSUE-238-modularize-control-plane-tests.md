# ISSUE-238: Modularize oversized API, memory, and integration suites

External: [Linear ZAR-242](https://linear.app/zara-voice/issue/ZAR-242/modularize-oversized-api-memory-and-integration-suites)

Status: Implemented

## Work completed

- Split the 3,781-line memory controller suite into seven capability suites covering records, knowledge, website sources, provider-import safety, provider imports, provider refresh, and ingestion/privacy.
- Split the 3,746-line connector contract suite into eight provider/capability suites covering schemas, Zendesk, CRM/calendar, collaboration, Salesforce, Confluence, knowledge, and commerce.
- Split the 2,096-line integrations controller suite into catalog, lifecycle, execution, and explicit tenant-isolation suites.
- Extracted three typed test-support modules for application setup, provider connection, repository, response, and schema helpers rather than duplicating those arrangements.
- Preserved all 88 candidate tests and reduced the largest affected suite from 3,781 lines to 899 lines.
- Corrected adjacent API test harnesses exposed by the complete lane: compliance now overrides both telephony persistence seams, sandbox websocket tests import the public integrations controller module when using its HTTP endpoints, and the production ESM scan has a contention-safe timeout.

## Tests run

- Candidate baseline: 3 files and 88 tests passed in 98.07 seconds; 9,624 source lines.
- Focused post-split memory/integrations run: 25 files and 119 tests passed in 36.27 seconds, including all 88 candidate tests.
- Affected-domain ESLint passed with no errors.
- Root typecheck passed in 223.7 seconds.
- RED: the complete API/integration lane initially failed 11 tests because compliance reached PostgreSQL and sandbox websocket fixtures exercised integration HTTP routes without importing their controller module.
- GREEN: the two affected files passed 40 tests in 11.26 seconds after correcting their test-module persistence and controller seams.
- The production ESM scan and Twilio websocket suite passed independently: 1 test in 5.75 seconds and 32 tests in 30.26 seconds.
- REFACTOR verification: the complete API/integration lane passed serially in 257.34 seconds with `--maxWorkers=1`.
- Final affected-file ESLint passed with no errors; final root typecheck passed in 154.1 seconds.
- Final inventory: 200 ordinary files / 1,367 static declarations / 88,446 lines; API layer 150 files / 1,056 static declarations / 69,534 lines.

## Pending work

- None for ISSUE-238.

## Risks

- The default parallel API run remains sensitive to cross-file process environment and filesystem-state interference; the complete serial lane is authoritative for this pass.
- Existing unrelated worktree changes remain outside the ISSUE-238 commits.

## Decisions

- Preserve backend behavior and aggregate assertions; optimize organization rather than test count.
- Public endpoint/capability boundaries determine file ownership; security and tenant-isolation scenarios remain explicit and searchable.
- Shared typed test support is limited to repeated setup and public-request helpers.
- Tests that call another module's public HTTP endpoints import that controller-owning module explicitly; runtime-only module imports do not imply controller availability.

## Next recommended step

- Continue with ISSUE-239 runtime and telephony suite modularization.
