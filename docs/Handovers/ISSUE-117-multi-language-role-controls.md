# ISSUE-117: Multi-language role controls

External: [Linear ZAR-126](https://linear.app/zara-voice/issue/ZAR-126/issue-117-multi-language-role-controls)

Issue link: https://github.com/tuzzy08/zara/issues/117

## Goal

Deliver richer multi-language controls for workflow role nodes so builders can configure supported languages, defaults, and runtime-facing language policy explicitly.

## Acceptance Criteria

- Role nodes can configure multiple supported languages with a default fallback
- Builder validation blocks unsupported or duplicate language entries
- Runtime-facing role config preserves language policy for routing and prompt selection

## Work Completed

- Extended `LanguagePolicy` with optional `languagePrompts` for language-specific prompt selection metadata.
- Added workflow validation errors for duplicate supported languages, default language outside the supported-language list, and empty language prompt text.
- Runtime-facing published roles now preserve `defaultLanguage`, `supportedLanguages`, `allowMidCallSwitching`, and `languagePrompts`.
- Agent inspectors now edit supported languages as a comma-separated list, toggle mid-call switching, and edit English language prompt text.
- Builder validation messaging now maps the new language-policy validation errors to readable guidance.
- Updated `docs/Issue-Backlog.md`, `docs/Roadmap.md`, and `docs/Frontend-Architecture.md`.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "validates multi-language"` failed because only the old unsupported-language check existed.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "validates multi-language"` passed after adding language-policy validation and prompt metadata preservation.
- RED/GREEN UI evidence is shared with ISSUE-116 because the same builder inspector pass added the multi-language controls.
- Focused verification: `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/web/src/WorkflowBuilder.test.tsx` passed with 2 test files and 20 tests.
- Type verification: `npm.cmd run typecheck` passed.
- Lint verification: `npm.cmd run lint` passed.
- Build verification: `npm.cmd run build` passed. Vite reported the existing tenant-app large chunk warning.
- Full suite: `npm.cmd run test:run -- --maxWorkers=1 --no-file-parallelism` passed with 48 test files and 239 tests. The suite emitted the existing logged AssemblyAI sandbox-provider failure fixture while still exiting successfully.

## Pending Work

- None for ISSUE-117 acceptance criteria.

## Risks And Edge Cases

- Unknown caller language is handled by preserving a default fallback language in runtime-facing config.
- Removing the default language from supported languages blocks publish through `agent.default_language_not_supported`.
- Empty language-specific prompt text blocks publish through `agent.missing_language_prompt` when prompt metadata is present.

## Decisions

- Supported languages use ISO-style codes already accepted by workflow validation, such as `en`, `fr`, `es`, and `en-US`.
- Prompt metadata is optional, so existing roles without language-specific prompts remain valid.
- Multi-language controls stay compact in the inspector to preserve the dense builder layout.

## Next Recommended Step

When additional language-specific prompts are needed in the UI, extend the inspector prompt controls for every supported language using the same `languagePrompts` contract.
