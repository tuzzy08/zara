# ISSUE-127 Agent Text Model Provider Selection

## Status

Implemented.

## Goal

Let agent role nodes choose the text model provider used by sandwich runtime turns, starting with OpenAI by default and Google Gemini as an additional provider, while keeping provider credentials server-side and making sandbox routing metadata visible.

## Work Completed

- Added `TextModelProviderId` plus optional `modelProvider` and `modelId` to shared agent role contracts.
- Preserved provider/model fields through workflow role cloning, publishing, and runtime role snapshots.
- Added Gemini live sandbox text generation through the Gemini `generateContent` API.
- Added a server-owned text model router that defaults to OpenAI and routes Gemini-selected roles to Gemini.
- Added environment config for `GEMINI_API_KEY`, `GEMINI_BASE_URL`, and tier model overrides.
- Updated OpenAI provider behavior so exact OpenAI model IDs on roles override tier defaults.
- Updated `routing.model_selected` events and sandbox formatting to expose provider/model metadata.
- Added workflow builder inspector controls for model provider and exact model ID, with Gemini presets.
- Documented the runtime, frontend, security, API, roadmap, and backlog contract changes.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "text model provider" --pool=threads`
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "text model provider" --pool=threads`
- RED/GREEN: `npm.cmd run test:run -- packages/core/src/runtime.test.ts apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-env.test.ts apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts -t "provider|explicit|Gemini|selected text|reads sandbox" --pool=threads`
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-text-model-router.provider.test.ts --pool=threads`
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-text-model-provider-factory.test.ts --pool=threads`
- RED/GREEN: `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts -t "selected provider" --pool=threads`
- RED/GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "Google Gemini" --pool=forks --fileParallelism=false --testTimeout=30000`
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-router.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-provider-factory.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-env.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`

## Decisions

- OpenAI remains the default for existing roles because `modelProvider` is optional and defaults to `openai`.
- Exact model IDs are optional; empty values fall back to tier defaults.
- Gemini credentials stay server-side and are not exposed to the browser.
- OpenRouter is deferred. It is useful as a future broker/fallback layer, but direct Gemini support gives clearer attribution, cost policy, credential ownership, and failure diagnostics for the first multi-provider slice.

## Pending Work

- Add OpenRouter only after per-tenant provider allowlists, provider-specific pricing, and broker data-routing policy are modeled.
- Consider a provider/model catalog API once model lists need to be centrally managed instead of maintained as UI presets.

## Risks

- Gemini model IDs can change over time; operators can still type exact IDs, but defaults should be reviewed periodically.
- Cost estimates still use tier-level pricing, not provider-specific model pricing.
- The first implementation routes by active role only; future graph-level model policies may need provider constraints.

## Next Recommended Step

Add provider-specific pricing and allowlist policy before enabling broker providers such as OpenRouter in production tenants.
