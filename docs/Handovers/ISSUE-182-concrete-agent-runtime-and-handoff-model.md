# ISSUE-182: Concrete agent runtime and handoff model

Status: In Progress

External: [Linear ZAR-182](https://linear.app/zara-voice/issue/ZAR-182/breaking-refactor-concrete-agent-runtime-and-handoff-model)

## Work Completed

- Created external Linear issue ZAR-182.
- Added local backlog, roadmap, and this issue-specific handover.
- Decision: this is a breaking refactor. Existing role-based drafts, published snapshots, tenant branch copy, and old specialist templates do not need legacy runtime support.
- Follow-up platform-admin prompt-policy schema pass: added RED repository/API tests for a staff-owned agent class template catalog carrying `basePrompt` plus `routingProfile` metadata.
- Added `agentClassTemplates` to the runtime prompt policy model, keyed by the current agent role kinds, with default labels, base prompts, routing descriptions, routing examples, and existing route-policy fallback vocabulary.
- Platform-admin `PATCH /platform-admin/runtime/prompt-policy` can update agent class template catalog entries while keeping raw base prompt and routing profile text out of audit metadata.
- File-backed prompt-policy persistence now validates, saves, and deep-clones the nested catalog so routing examples survive repository recreation.
- Replaced model-facing `route_to_agent` / `zara_route_to_agent` with `handoff_to_agent` / `zara_handoff_to_agent` and concrete `targetAgentId` arguments.
- Unified connector and internal handoff declarations in one runtime tool list; router agents with only the handoff tool no longer get the misleading "No tools are assigned" prompt line.
- Removed route menus and branch-copy prompt exposure from sandbox/premium runtime prompts. Prompts now list configured handoff targets by concrete agent ID/name/kind.
- Updated sandbox handoff resolution to validate target agents, reject unsupported/unknown/language-incompatible targets, and expose `handoffTargets` in the constrained runtime context.
- Removed tenant-builder branch description/examples controls, stale specialist-template controls, local specialist-template storage/helpers, role type selector, and reusable-specialist metadata.
- Removed stale `SpecialistRoleTemplate` core helpers and removed `reusableSpecialist` / `specialistTemplateId` / `specialistTemplateVersion` from `AgentRoleNodeConfig`.
- Changed prompt wording from old "Role type" language to "Agent class" to match the platform-admin class-template model.
- Premium realtime OpenAI handoff now updates the registered session to the target role, reconnects the backend provider connection, and sends target-agent session config/voice before the target response while preserving the caller-facing browser websocket.
- Added `Agent` / `AgentRuntimeContext` core helpers that derive concrete runtime agents from graph agent nodes plus named role snapshots.
- Sandbox tool execution now receives a constrained `AgentRuntimeContext` with org/workspace/session/actor/active-agent facts, without graph, roles, or route policies.
- Shared handoff-target projection now filters stale/missing/unnamed target agents for sandbox prompts, premium prompts, realtime provider tool declarations, and sandbox/premium handoff validation.
- Premium realtime provider setup resolves active concrete agent node IDs to the target role snapshot before prompt/voice setup, so node labels such as `New Agent` are not used.
- Published workflow snapshots are stamped with `zara.published-workflow.v2`; runtime manifest previews are stamped with `zara.runtime-manifest-preview.v2`; local sandbox registry drops legacy/stale published snapshots and runtime compilation rejects unsupported preview schemas.
- Synced Linear ZAR-182 with the concrete-agent/runtime schema slice comment.
- Synced Linear ZAR-182 with an implementation-slice comment; status remains In Progress.
- Audited the tenant workflow builder storage paths and found no separate draft workflow local/session storage; draft workflows are in React state, while the published sandbox registry is the only workflow snapshot browser persistence and is already schema/stale-metadata guarded.
- Removed the tenant-builder role label fallback that preserved stale canvas text such as `New agent` or a previous name after the role name was cleared; agent node labels now derive from the role name only.
- Tightened provider/prompt handoff projection so stale route policies with no valid named target agents do not declare `zara_handoff_to_agent` or render router instructions with an empty target list.
- Updated platform-admin runtime route-policy preview copy from classifier/branch-target language to router-agent handoff governance language.
- Updated current runtime/docs standards to describe the concrete `handoff_to_agent` / `zara_handoff_to_agent` contract, configured target agent IDs, source-agent announcements, and target provider-session handoff instead of branch-ID route menus.
- Renamed misleading test descriptions/fixtures from "route action/tool" to "handoff action/tool" where behavior already used the new handoff contract.
- Updated active architecture/API/backlog/roadmap docs from tenant-local specialist/role-template language to platform-admin agent class templates and fresh concrete agent configuration.
- Removed tenant-local branch descriptions/examples from agent-attached route profiles and route-policy branches; route policies now carry only label/intent/target/transfer fields while standalone intent-route classifier branches still own descriptions/examples.
- Updated builder/runtime/API fixtures so generated router-agent handoff policies no longer persist stale branch copy, and the internal intent-classifier shim derives minimal classifier metadata from the branch label.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/runtime-prompt-policy/runtime-prompt-policy.repository.test.ts -t "agent class template" --pool=threads` failed because `defaultRuntimePromptPolicy.agentClassTemplates.billing` did not exist.
- RED: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts -t "runtime prompt policy" --pool=threads` failed because the prompt-policy API did not return `agentClassTemplates`.
- GREEN: `npm.cmd run test:run -- apps/api/src/runtime-prompt-policy/runtime-prompt-policy.repository.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts -t "agent class template|runtime prompt policy" --pool=threads` passed, 3 tests with 5 skipped by filter.
- Refactor verification: `npm.cmd run test:run -- apps/api/src/runtime-prompt-policy/runtime-prompt-policy.repository.test.ts apps/api/src/runtime-route-policy/runtime-route-policy.repository.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts --pool=threads` passed, 9 tests.
- RED: `npm.cmd exec -- vitest run apps/web/src/WorkflowBuilder.test.tsx --maxWorkers=1 --no-file-parallelism --testTimeout 10000 --reporter=verbose -t "tenant-local specialist metadata"` failed because the old Specialist template selector still rendered.
- GREEN: `npm.cmd exec -- vitest run apps/web/src/WorkflowBuilder.test.tsx --maxWorkers=1 --no-file-parallelism --testTimeout 10000 --reporter=verbose -t "tenant-local specialist metadata"` passed after removing the stale inspector/storage path.
- `npm.cmd exec -- vitest run apps/web/src/WorkflowBuilder.test.tsx --maxWorkers=1 --no-file-parallelism --testTimeout 10000 --reporter=verbose` passed, 13 tests.
- `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts packages/core/src/sandbox.test.ts packages/core/src/runtime-profiles.test.ts packages/core/src/workspace-workflow.test.ts packages/core/src/live-call-session.test.ts packages/core/src/pstn-premium-realtime-runtime.test.ts packages/core/src/pstn-sandwich-runtime.test.ts apps/web/src/sandboxRuntimeManifest.test.ts apps/api/src/workflows/workflows.controller.test.ts apps/api/src/runtime-sessions/runtime-sessions.controller.test.ts --pool=threads` passed, 88 tests.
- `npm.cmd run test:run -- packages/core/src/agent-action.test.ts packages/core/src/turn-runtime-packet.test.ts packages/core/src/realtime-tool-bridge.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-prompts.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts apps/api/src/runtime-sessions/premium-realtime-role-prompt.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts --pool=threads` passed, 40 tests.
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-provider-factory.test.ts apps/api/src/runtime-prompt-policy/runtime-prompt-policy.repository.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts apps/platform-admin/src/index.test.tsx --pool=threads` passed, 58 tests.
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-role-prompt.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --pool=threads` passed, 14 tests.
- `npm.cmd run lint` passed.
- `npm.cmd run typecheck` passed.
- RED: `npm.cmd run test:run -- packages/core/src/realtime-tool-bridge.test.ts --pool=threads` failed because stale handoff targets leaked into the provider enum.
- GREEN: `npm.cmd run test:run -- packages/core/src/realtime-tool-bridge.test.ts --pool=threads` passed after using shared concrete-agent handoff targets.
- RED/GREEN: `npm.cmd run test:run -- packages/core/src/agent-runtime-context.test.ts --pool=threads` covered concrete agent derivation and constrained tool context.
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts --pool=threads` covered registry execution receiving `AgentRuntimeContext`.
- RED/GREEN: `npm.cmd run test:run -- apps/web/src/workflowSandboxRegistry.test.ts --pool=threads` covered dropping legacy/stale published snapshots.
- RED/GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts --pool=threads` covered published workflow and runtime preview schema stamps.
- RED/GREEN: `npm.cmd run test:run -- packages/core/src/runtime.test.ts --pool=threads` covered compile-time rejection of unsupported manifest preview schemas.
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --pool=threads` covered stale graph targets being rejected instead of falling back to `New Agent`.
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.service.test.ts --pool=threads` covered premium handoff rejecting stale graph targets.
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts --pool=threads` covered node-id active sessions resolving role voice/prompt config.
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-role-prompt.test.ts --pool=threads` covered premium prompts filtering stale target metadata.
- `npm.cmd run test:run -- packages/core/src/agent-runtime-context.test.ts packages/core/src/realtime-tool-bridge.test.ts packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts apps/web/src/workflowSandboxRegistry.test.ts --pool=threads` passed, 57 tests.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/premium-realtime-role-prompt.test.ts apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts --pool=threads` passed, 38 tests.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts --pool=threads` passed, 11 tests.
- `npm.cmd run lint` passed after the concrete-agent/schema slice.
- `npm.cmd run typecheck` passed after the concrete-agent/schema slice.
- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "starts blank" --pool=threads` failed because clearing a named agent left the canvas label as `Billing reviewer`.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "starts blank" --pool=threads` passed after removing the stale role-name fallback.
- RED: `npm.cmd run test:run -- packages/core/src/realtime-tool-bridge.test.ts apps/api/src/runtime-sessions/premium-realtime-role-prompt.test.ts -t "no branch targets|all branch targets" --pool=threads` failed because stale route policies still declared/rendered an empty handoff tool.
- GREEN: `npm.cmd run test:run -- packages/core/src/realtime-tool-bridge.test.ts apps/api/src/runtime-sessions/premium-realtime-role-prompt.test.ts -t "no branch targets|all branch targets" --pool=threads` passed after skipping handoff tools/prompts with no resolved targets.
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx packages/core/src/realtime-tool-bridge.test.ts apps/api/src/runtime-sessions/premium-realtime-role-prompt.test.ts --pool=threads` passed, 21 tests.
- `npm.cmd run test:run -- packages/core/src/agent-runtime-context.test.ts packages/core/src/realtime-tool-bridge.test.ts apps/api/src/runtime-sessions/premium-realtime-role-prompt.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --pool=threads` passed, 41 tests.
- `npm.cmd run lint` passed.
- `npm.cmd run typecheck` passed.
- `git diff --check` passed with line-ending warnings only.
- RED: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx -t "router-agent handoff governance" --pool=threads` failed because the runtime route-policy preview still rendered "runtime-owned classifier" and "Configured branch and fallback targets only".
- GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx -t "router-agent handoff governance" --pool=threads` passed after updating the platform-admin route-policy preview copy.
- `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx --pool=threads` passed, 8 tests.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "hands off only when" --pool=threads` passed, 1 test with 35 skipped.
- `git diff --check` passed with line-ending warnings only after the docs/platform-admin terminology slice.
- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "agent-attached route-by-intent|published agent role snapshots" --pool=threads` failed because agent route policies still persisted `description`.
- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "tenant-local specialist metadata" --pool=threads` failed because router-agent branches still included branch copy.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "agent-attached route-by-intent|published agent role snapshots" --pool=threads` passed after removing agent route branch descriptions/examples.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "tenant-local specialist metadata" --pool=threads` passed after removing generated branch copy from the builder.
- `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts packages/core/src/intent-routing.test.ts --pool=threads` passed, 54 tests.
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "tenant-local specialist metadata|preserves existing route policy branches" --pool=threads` passed, 2 tests with 11 skipped.
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-role-prompt.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts --pool=threads` passed, 12 tests.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts -t "selects a handoff-capable agent with safe handoff targets|rejects handoff actions to graph agents without named role snapshots" --pool=threads` passed, 2 tests with 12 skipped.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "hands off only when a handoff-capable agent emits a handoff action" --pool=threads` passed, 1 test with 35 skipped.
- `npm.cmd run typecheck` passed after the branch-copy removal slice.

## Pending Work

- Continue replacing remaining runtime APIs that still accept `VoiceAgentRole` shapes directly when the change is behaviorally useful and covered by tests.
- Move the sandbox text-model prompt path to receive a concrete runtime agent projection rather than raw `VoiceAgentRole`, while leaving provider config surfaces on role snapshots until voice/STT/TTS contracts are refactored deliberately.
- Continue replacing internal naming that still says route/branch where the domain is now handoff, while avoiding broad unrelated churn; current remaining `route_to_agent` strings are intentional parser-rejection coverage and stale-snapshot guards unless a deeper storage migration removes them.
- Decide whether `intent_route_to_agent` relationship-rule IDs should be renamed in a separate migration-safe slice.
- Re-check draft snapshot rejection only if a future persistence path is added; the current builder has no separate draft snapshot browser storage.

## Risks

- The working tree already contains unrelated modified files in runtime websocket, builder tests, audit artifacts, and ISSUE-179 handover; do not revert them.
- The requested breaking change touches shared runtime contracts, so tests should be added vertically and kept behavior-focused.
- Prompt-policy persisted state is now breaking for older `prompt-policy.json` files without `agentClassTemplates`; this matches the allowed breaking direction but should be called out before any shared local/staging state reuse.
- Runtime still maps handoff target IDs through the existing route-policy storage internally. Caller/model-facing behavior is handoff-based, but the storage-level route policy remains until the deeper concrete agent model lands.
- Agent-attached route policies now synthesize minimal classifier metadata from branch labels for the existing classifier helper; platform-admin agent class routing profiles remain the source of rich descriptions/examples.
- Premium realtime provider reconnection is covered for OpenAI in browser websocket tests; Gemini handoff still uses provider-native tool response mechanics without a separate voice-reconnect path.

## Decisions

- Handoff targets concrete agent instances, not role profiles.
- Agent class templates own specialist prompt and routing descriptions.
- Tenant builder should not expose branch description/examples.
- Tools receive explicit arguments plus a least-privilege execution context, not the full runtime context.
- Keep the first catalog slice in runtime prompt policy, keyed by existing `AgentRoleKind`, so platform-admin can own base prompt and routing profile defaults without changing builder/runtime behavior.
- Reuse route-policy fallback target vocabulary for agent class routing profiles instead of inventing a separate fallback enum.
- Platform audit metadata stays on the existing safe prompt-policy summary path and does not store base prompt or routing-profile text.
- Router agents receive the internal handoff tool in the same available-tool list as connector tools; connector execution explicitly skips `internal_handoff`.
- Tenant builder uses role names only for route target labels; unnamed agents are not eligible handoff targets and stale canvas labels are not fallback display names.
- Tenant-local specialist templates and reusable-specialist metadata are deleted rather than hidden.
- Empty/stale route policies do not expose the internal handoff tool or router instructions; a router must have at least one resolved named target agent before model-facing handoff affordances appear.
- Agent-attached route-policy branches do not own descriptions/examples. Standalone intent-route branches still retain classifier descriptions/examples.

## Next Recommended Step

Move sandbox text-model prompt construction from raw role snapshots toward concrete runtime agent identity, then continue replacing route/branch naming only where tests show user-facing leakage or runtime ambiguity.
