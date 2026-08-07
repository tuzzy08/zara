# ISSUE-238: Modularize oversized API, memory, and integration suites

External: [Linear ZAR-242](https://linear.app/zara-voice/issue/ZAR-242/modularize-oversized-api-memory-and-integration-suites)

Status: In Progress

## Work completed

- Split the 3,781-line memory controller suite into seven capability suites covering records, knowledge, website sources, provider-import safety, provider imports, provider refresh, and ingestion/privacy.
- Split the 3,746-line connector contract suite into eight provider/capability suites covering schemas, Zendesk, CRM/calendar, collaboration, Salesforce, Confluence, knowledge, and commerce.
- Split the 2,096-line integrations controller suite into catalog, lifecycle, execution, and explicit tenant-isolation suites.
- Extracted three typed test-support modules for application setup, provider connection, repository, response, and schema helpers rather than duplicating those arrangements.
- Preserved all 88 candidate tests and reduced the largest affected suite from 3,781 lines to 899 lines.

## Tests run

- Candidate baseline: 3 files and 88 tests passed in 98.07 seconds; 9,624 source lines.
- Focused post-split memory/integrations run: 25 files and 119 tests passed in 36.27 seconds, including all 88 candidate tests.
- Affected-domain ESLint passed with no errors.
- Root typecheck passed in 223.7 seconds.
- The complete API/integration lane ran 203.6 seconds and failed 11 tests outside the affected memory/integrations suites: 2 compliance tests require unavailable local PostgreSQL state and 9 sandbox websocket tests return 404 while overlapping sandbox module changes are present in the worktree.

## Pending work

- Resolve or isolate the 11 pre-existing/unrelated complete-lane failures, then rerun `npm run test:api` to satisfy the final acceptance criterion.
- Complete final review, commit the isolated ISSUE-238 diff, and synchronize local/Linear status when the complete lane is green.

## Risks

- The complete API/integration lane is not green in the current worktree, so the issue must remain In Progress despite the affected suites being green.
- Existing sandbox module/test edits and unavailable local PostgreSQL are outside this refactor and must not be silently changed or masked.

## Decisions

- Preserve backend behavior and aggregate assertions; optimize organization rather than test count.
- Public endpoint/capability boundaries determine file ownership; security and tenant-isolation scenarios remain explicit and searchable.
- Shared typed test support is limited to repeated setup and public-request helpers.

## Next recommended step

- Restore a green complete API/integration environment, rerun the lane, then close ISSUE-238.
