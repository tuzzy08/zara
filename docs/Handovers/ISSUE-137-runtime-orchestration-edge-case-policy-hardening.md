# ISSUE-137: Runtime orchestration edge-case policy hardening

Status: Implemented
Date: 2026-09-17
External: [Linear ZAR-71](https://linear.app/zara-voice/issue/ZAR-71/issue-137-runtime-orchestration-edge-case-policy-hardening)

## Work Completed

### 2026-09-17 instruction enrichment

- Reopened the same external issue for the user-approved enrichment flow because Linear still rejects new issues at its issue limit. Used Ponytail and test-first changes. Preserved unrelated edits.
- Added one shared review panel to reusable-agent creation and the workflow agent inspector. It supports editable suggestions, original text, change reasons, questions, conflicts, explicit apply, and restore. Late results cannot replace newer instructions or settings. Apply does not publish.
- Added a guarded endpoint with exact workspace membership checks, bounded safe draft projection, connector-owned input rules, strict provider output, known capability checks, a shared six-per-minute tenant limit, provider timeout, and generic provider errors. Reused the existing rate-limit and supplier usage tables. No migration or new dependency was added.
- Added deployment variables for the API container. A new contract check first failed because that container did not receive `OPENAI_API_KEY`; the Compose mapping now supplies the key, optional project, and drafting model. The example environment file documents those fields.
- Drafting uses `gpt-4.1` by default. The smaller candidate repeatedly produced rigid tool steps or unsupported examples in live checks. The prompt now places existing tool outcomes before new-request input collection. Business decisions remain review questions. Human review remains required because schema validation does not prove semantic correctness.
- Added a live comparison for original versus improved instructions with synthetic data and both production text adapters. These narrow checks do not establish general quality gains. The first smaller-model checks failed; the latest stronger-model check passed eight cases. One test pattern was corrected to accept the valid wording “do not have an order status”.

Validation: service/API checks passed (18 tests, isolated database test skipped without its URL); the isolated Postgres pass then passed all 10 service tests, including concurrent rate limiting and window reset. Both UI suites passed all five tests. There are 24 distinct focused tests across these checks. The UI boundary remains nine files and 25 tests. The forced workspace TypeScript check and focused source lint passed. Eight live comparisons passed twice with `gpt-4.1` drafting and `gpt-4.1-mini` / `gemini-3.1-flash-lite` answering. Original and improved instructions both passed those cases; the result proves no measured regression in this small sample, not an overall quality gain. The temporary Postgres container was removed. Repository contracts and all workspace builds passed after the deployment-variable fix. Vite retains its tenant bundle-size warning. Whitespace checks passed.

### 2026-09-15 prompt fixes

- Reopened ZAR-71 for the user-approved prompt review fixes. New issue creation failed because Linear reached its issue limit.
- Assigned three Sol agents: prompt rules and language; policy lifecycle; action schemas and context limits. Root owns evaluations, tenant guidance, integration review, and status records.
- All three Sol agents and root used ponytail and RED/GREEN/REFACTOR. Root reviewed and synchronized the completed changes. Existing unrelated working-tree edits are preserved.
- Replaced reference-answer execution in the runtime eval gate with production adapter, parser, tool-check, and route-resolution execution. Expected answers remain in the scorer. A changed route and an unassigned tool fail their scores.
- Added separate live prompt checks for OpenAI and Gemini with synthetic data. The checks cover instruction conflicts, tool output injection, missing inputs, tool selection, tool failure, conversation history, and language policy.
- Added a 12,000-character limit for tenant instructions and each language prompt. API and workflow validation enforce the limit. Tenant forms show a compact prompt example in the existing field.
- Root review found and returned further faults to agents: invalid root JSON schema, optional-null argument loss, byte/token budget errors, policy reset during storage migration, incomplete rollback, and a missing PSTN sandwich policy path.
- Provider-document review found that OpenAI response instructions replace the session instructions. The shared adapter must preserve the complete selected prompt for handoff and announcement response overrides.

The prompt follow-up addresses the original review as follows:

| Finding | Implemented change |
| --- | --- |
| 1. Realtime policy omission | Text and realtime builders include the selected platform guardrails and specialist template. Response overrides retain that prompt. |
| 2. Handoff summary authority | Caller need summaries remain in conversation/tool data. Continuation uses fixed directives. |
| 3. Self-scoring eval gate | The executor runs production adapters and guards with independent expected answers. A separate command checks live model behaviour. |
| 4. Language conflict | One language formatter handles supported languages, switching, and saved language guidance. The adapter no longer adds a conflicting English-only rule. |
| 5. Tenant authority and format | Platform rules define the boundary. Tenant identity/instructions are JSON data. Response contracts are system instructions. Tenant forms include bounded authoring guidance. |
| 6. Unconstrained actions | OpenAI and Gemini receive strict action schemas. Optional null placeholders are removed without losing valid null values. Server permission and argument checks remain. |
| 7. Policy lifecycle | Postgres stores immutable revisions, hashes, and session selections. Atomic updates detect stale versions. Exact historical content supports recovery and audited rollback promotion. |
| 8. Context limits | Full text requests have a conservative token bound and output reserve. Exact duplicate removal and older-first compaction preserve the latest tool outcome. |

### Earlier baseline

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added edge-case and mitigation policy standards in `docs/Runtime-Orchestration-Edge-Cases-And-Policies.md`.
- Linked policy testing expectations from roadmap, architecture, manifest, feature-flow, and testing docs.
- Moved Linear `ZAR-71` and local `ISSUE-137` records to `In Progress` before implementation.
- Added direct transfer loop prevention: if the next direct agent target was already visited, routing stops on the current target agent, clears the frontier, and emits a recoverable `transfer_loop.detected` packet warning.
- Locked in the zero-tools product rule with a live websocket regression: manifests may have an explicit empty `agentToolAssignments` array, the active agent receives `availableTools: []`, action mode is disabled, and no tool events are emitted.
- Added invalid structured agent-command handling: command-shaped model output outside `respond` or assigned `call_tool` is ignored, emits recoverable `agent_action.invalid`, is not spoken to the caller, and cannot mutate graph routing.
- Added transfer language mismatch guards for both direct agent-to-agent routes and handoff routes. When caller language is known and the target role does not support it, routing keeps the source agent active, clears the frontier, avoids transfer events, and emits `transfer_language.unsupported`.
- Added tool failure classification for timeout and rate-limit errors using recoverable `tool_execution.timeout` and `tool_execution.rate_limited` packet results.
- Added partial tool success support so registries can return `status: "partial"`, emit `tool.completed`, and project only `summary` plus `safeOutput` back to the same agent.
- Updated the Gemini provider test to assert the current prompt contract: platform/agent policy lives in `systemInstruction`, and the turn response format lives in the user prompt.
- Synced runtime, manifest, API, security, testing, roadmap, and issue-backlog docs to the implemented baseline.

## Tests Run

### 2026-09-15 pass

- Tenant limit RED: 3 expected failures (API accepted oversized instructions; workflow validation accepted oversized instruction/language fields). GREEN: 52 tests across workflow, agent API, eval executor, and scorecards.
- Runtime eval command: 5/5 pass through the production execution target.
- Tenant agent and workflow builder smoke tests: 5/5 pass.
- Root changed-file lint passed before the final live-eval metadata edit.
- Live provider checks: the initial set passed 14/14. Expanded checks found history reuse and fixed-language faults. Shared prompt rules now require known-fact reuse and replies in the configured language. The tool-data fixture now binds caller and result to the same order ID, so the check does not penalize valid identity clarification. The latest expanded run passed 16/16 with real OpenAI and Gemini calls. No injection marker was spoken; missing inputs caused a question, while complete inputs produced the assigned tool action.
- Combined core/provider/authoring/eval regression: 88/88 tests across 10 files. Focused lint and owned diff checks passed.
- Final live prompt set passed 16/16 twice in succession. The runtime eval gate also passed 5/5 after the final fixture type correction.
- Shared prompt builder tests: 10/10 pass. Adapter and runtime handoff/policy tests: 37/37 pass.
- Premium PSTN media/handoff tests: 23/23 pass. Sandwich runtime tests: 53/53 pass.
- UI test boundary check passed. Changed prompt/runtime file diff checks passed.
- Policy repository/service/admin checks: 20/20 pass. Schema/provider routing checks: 22/22 pass.
- Real isolated pgvector/Postgres checks: 24/24 pass across migration 0040 and premium dispatch snapshot persistence. They cover atomic saves, immutable revisions and session pins, and exact revision recovery. The isolated test container was removed.
- Drizzle schema consistency, focused policy lint, and policy diff checks passed. The migration journal, schema snapshot, and guarded rollback script are present.
- Final prompt/runtime type-correction regression: 60/60 pass. API scoped TypeScript check passed after the required session fields and schema-test index assertions were corrected.
- Provider benchmark caller regression: 13/13 pass after the shared realtime response override change.
- Corrected runtime gate metadata defaults to dataset `v2`. RED: the version assertion failed against `v1`; GREEN: 12/12 scorecard tests and 5/5 runtime gate tests passed.
- Final forced workspace TypeScript check passed: `node node_modules/typescript/bin/tsc -b --force --pretty false`.
- Final repository contract checks and all workspace builds passed: `npm.cmd run validate:contracts`. Vite reported tenant bundle-size and plugin-time warnings; the build passed.
- Final changed-file whitespace checks passed.

### Neon migration and commit pass

- The user approved updating the configured Neon database through migration 0040 and including the required existing migration/runtime dependencies in the commit.
- Preflight found migrations 0000 through 0006 recorded, 22 public tables, 81 existing rows, no execution sessions, and no other database clients. Tenant relationship, duplicate-key, extension, and future-table checks passed.
- Created a private custom-format backup under `.git/private-backups/neon-before-0040-2026-09-15T18-53-51.008Z.dump`. The archive is readable, contains 137 entries, and is 67,957 bytes. It is outside the commit. The first backup attempt failed on missing container root certificates; the successful attempt used the system trust store and retained certificate verification.
- Applied migrations 0007 through 0040 with the installed Drizzle migrator inside one transaction, with a 5-second lock timeout and a 60-second statement timeout. The transaction committed at `2026-09-15T18:57:58.598Z`.
- Verified all 41 migration records, migration 0040's hash, its three tables, five functions, and two enabled immutable-data triggers. All 22 existing table row counts remained unchanged. All public constraints are validated.
- The commit includes the required 0037–0039 migration chain, usage-recording dependencies, and standard PSTN runtime. Unrelated billing collection/report changes, billing UI changes, and audit data remain outside the commit. A stale zero-byte Git index lock from 2026-09-09 was removed after confirming that no Git process was running.
- A separate copy of the staged files passed 204 tests in 10 suites. The first attempt lacked links to the installed workspace dependencies; after those links were added, all selected tests passed without source changes.
- The staged-file TypeScript check passed. The initial full check reported only API dependency-resolution failures before the workspace dependency links were present. The API check then passed with those links in place. Staged whitespace checks also passed.

### Earlier baseline

- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --testNamePattern "transfer loops"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "explicit empty toolbelt"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "unsupported structured agent commands"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --testNamePattern "caller language"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "timeout failure|rate-limit failure|partial tool results"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts`
- `npm.cmd run test:run -- packages/core/src/intent-routing.test.ts packages/core/src/turn-runtime-packet.test.ts packages/core/src/runtime.test.ts apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- All eight original prompt findings and the instruction enrichment follow-up are implemented, reviewed, and tested. No requested implementation work remains. The enrichment changes remain local and uncommitted; no deployment or Neon change was made in this pass.
- Migration 0040 is applied to the configured Neon database. The application and worker deployment remain a separate release step.
- Future hardening can add caller-refusal transfer cancellation, runtime restart reconstruction, configurable tool-call loop limits, and provider outage fallback as separate issues.

## Risks

- Instruction enrichment is a model-generated proposal. Schema and capability checks do not prove that all business rules or examples are faithful. Builders must review the proposal and run relevant sandbox cases before publishing. The original text and restore action remain in the current review panel; they are not a new durable revision store. Accepted instructions use the existing save/version flow.
- This follow-up uses only submitted draft context and static connector schemas. It does not retrieve approved business knowledge. Generation adds supplier cost, bounded by the tenant request limit and token budget. It is not billed as a customer call.

- Apply migration 0040 before the updated API starts. Drain calls from the previous release before replacing workers. Old premium snapshots lack prompt revision/hash fields and are rejected during recovery.
- Live text checks use synthetic inputs and two configured text models. Realtime behaviour is checked through provider payload and phone-call harness tests. This pass does not establish live voice quality or deploy the app.

- The policy baseline depends on ISSUE-133 through ISSUE-136 packet, intent, toolbelt, and transfer contracts.
- Future restart/provider-fallback work must preserve the existing packet event mapping.
- Live websocket tests rely on in-memory state and fake providers; broader production provider outage tests should stay isolated from live-call availability.

## Decisions

- Policy guards should validate model outputs rather than trusting them.
- Runtime never accepts graph target IDs from model output.
- Human approval gates are runtime states, not UI-only hints.
- Direct transfer loops stop on the current target agent instead of falling back to the entry role.
- Transfer language mismatch keeps the source agent active rather than silently routing to an unsupported specialist.
- Partial tool success is a successful `tool.completed` event with `status: "partial"` so monitors can distinguish degraded results without treating them as crashes.
- Timeout and rate-limit errors are recoverable failed tool results with specific codes for agent recovery and monitoring.

## Next Recommended Step

- For release, confirm migration 0040 in any other target environment and drain calls from the previous release before replacing workers. Neon is already migrated. Retain the synthetic eval results and complete live voice qualification in the release environment.
