# Prompt Provider Research

Date: 2026-09-15

Status: Research for an exploratory review. This note does not change product rules.

## Scope And Local Context

This note covers prompt roles, untrusted data, tool calls, prompt releases, evaluation, and context size. It does not assess all Zara runtime paths.

The text provider factory uses OpenAI and Google Gemini. OpenAI uses Chat Completions. Gemini uses GenerateContent. The adapters share prompt builder functions and keep system instructions separate from user content. Sources: `apps/api/src/sandbox-live-sessions/sandbox-text-model-provider-factory.ts`, `openai-chat-text.provider.ts`, and `gemini-chat-text.provider.ts` in that directory.

Zara already requires separate untrusted context, server checks for actions, packet-backed runtime state, and redacted evaluation data. Preserve these rules. Sources: `docs/Security-Compliance.md`, `docs/Turn-Runtime-Packet-v1.md`, and `docs/Observability-And-Evals-Standard.md`.

## Provider Findings

### Realtime Response Overrides

OpenAI `response.create` can override the session instructions for one response. Zara must retain the selected platform prompt when it adds response-specific handoff or announcement instructions. Updating the session prompt first is not sufficient if the next response replaces it. [OpenAI Realtime client events](https://platform.openai.com/docs/api-reference/realtime-client-events).

### 1. Keep Instructions Separate From Data

OpenAI assigns application rules to developer messages. User messages carry inputs and configuration at a lower priority. Its prompt guide recommends clear sections for identity, instructions, examples, and context. Formatting can mark logical boundaries. [OpenAI prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering).

OpenAI advises against inserting untrusted variables into developer messages. It recommends lower-priority user messages and structured data between steps to reduce injection risk. [OpenAI agent safety](https://developers.openai.com/api/docs/guides/agent-builder-safety).

Google recommends clear instructions, explicit constraints, and examples. Prompt design remains an iterative process that must be checked against observed outputs. [Gemini prompt design](https://ai.google.dev/gemini-api/docs/prompting-strategies).

**Recommendation for Zara:** Define a clear ownership order: platform rules, approved tenant configuration, caller requests, and external data. Keep retrieved text, tool output, memory, and caller text out of the trusted instruction block. Treat tenant free text as a separate configuration input. Explain which fields can change behavior. Do not treat prompt wording as an access-control check.

### 2. Use Schemas And Server Checks For Actions

OpenAI recommends strict function schemas. Strict mode requires `additionalProperties: false` and required fields. Nullable fields can represent optional values. Chat Completions is non-strict by default. [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).

Google separates model function proposals from application execution. It recommends specific descriptions, strong parameter types, validation, error handling, and authentication. [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling).

**Recommendation for Zara:** Use a typed action contract. Check the tool name, arguments, tenant, permissions, approval state, and retry state on the server. Use native function calls where they fit the current adapter. If Zara keeps a JSON action envelope, enforce the same contract after parsing. A successful parse must not authorize an action. Add tests for rejected calls and false success claims.

**Compatibility note:** Current Google pages also describe the newer Interactions API. Zara uses GenerateContent. Verify the exact GenerateContent schema before implementation. Do not copy Interactions fields into the existing adapter.

### 3. Release Prompts With Versions And Evaluation Evidence

OpenAI now recommends production prompts stored in code, typed inputs, fixtures, tests, evaluation checks, and staged deployment. It states that reusable API prompt objects are being retired. This favors Zara's existing prompt builder approach. [OpenAI prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering).

OpenAI recommends task-specific evaluations with stated success criteria. Test data should include normal, edge, and adversarial cases. Run evaluations on each change and use human review to calibrate automated scores. [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

**Recommendation for Zara:** Record the platform prompt version, tenant configuration version, manifest version, model, and adapter version for each session. Freeze the selected versions for the session. Keep a rollback target. Extend the existing evaluation harness with actual provider output tests for instruction conflicts, prompt injection, tool failure, conversation continuity, and answer grounding. Use synthetic or redacted data under Zara's existing rules. Do not add hosted prompt IDs as a new dependency.

### 4. Budget Context For The Selected Model

OpenAI states that the context limit includes input and output, plus reasoning where applicable. Excess context can cause truncated outputs. [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state).

Google exposes token counting before requests and usage counts after responses. Its guide notes that text and other inputs consume tokens. [Gemini token counting](https://ai.google.dev/gemini-api/docs/tokens).

OpenAI cache reuse depends on matching prefixes. Stable instructions should precede changing content. Cache behavior and size limits depend on the selected model and request settings. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

**Recommendation for Zara:** Keep byte limits for transport protection. Add a model-specific token budget for generation. Reserve output space before selecting context. Always retain trusted rules, the latest caller request, pending action state, and required tool results. Select recent history and useful retrieval within the remaining budget. Record dropped sources and token counts. Keep shared instructions stable, but measure cost and latency before adding cache settings.

## Suggested Review Checks

These are recommendations, not confirmed defects:

1. Can tenant text replace or conflict with platform rules?
2. Can external text create a fake instruction section or action?
3. Do all text and realtime adapters preserve the same trust boundaries?
4. Does the model receive the caller history needed to answer a follow-up?
5. Can the model claim an action succeeded before the server confirms success?
6. Can the team reproduce a session from its prompt and configuration versions?
7. Do evaluations call each supported provider, or only test packet assembly?
8. Does context selection retain current facts when old content must be removed?

## Validation

Read the routing docs and focused security, runtime packet, and evaluation docs. Inspected the provider factory and two text adapters. Read primary provider documentation. No production code or issue record changed. No live model requests or tests ran.
