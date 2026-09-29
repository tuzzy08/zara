# TypeSafe implementation plan

Date: 2026-09-27

Implementation state: Code implementation and agent review complete. All TypeSafe feature modes default to off. Provider quality, latency, cost, and customer-data terms are not yet qualified.

## 1. Goal and scope

Use model judgement where Zara must interpret meaning. Keep exact rules, permissions, calculations, and execution in code. Measure quality before replacing an existing decision.

Combine the six review points into three workstreams. Use one small provider adapter and one evaluation process across them.

| Workstream | Review points | Product result |
| --- | --- | --- |
| A. Post-call analysis | 1. Outcomes and action items | Distinguish a completed call from a resolved request. Detect remaining work without keyword matching. |
| B. Evidence-based drafts | 2. Memory extraction; 6. Knowledge classification | Suggest supported memory facts and document types for review. |
| C. Live decisions | 3. Intent routes; 4. Model routing; 5. Handoffs | Use measured decision signals while preserving runtime authority and agent-led handoffs. |

This is a plan and implementation evidence record, not a new issue record. Linear rejected issue creation because this workspace reached its free issue limit. External synchronization is blocked. No local-only issue numbers or handovers were created. Link the work to external issues when capacity is available; then add matching backlog records and one handover per issue. Existing completed issues provide context.

### Operating decisions

- Use TypeSafe for bounded decisions. Continue to use the speaking model for replies and free-text summaries.
- Preserve NestJS, TypeScript, current domain services, and current test tools.
- Use server-side native `fetch` for the small TypeSafe HTTP adapter. Do not add an SDK unless its verified features remove more code than they add.
- Keep domain questions and decision rules in their owning modules. Do not build a generic judgement engine, prompt builder, or new workflow system.
- Start with offline comparison. Then use shadow mode, which records a proposed decision without changing product behavior. Enable each feature separately after its checks pass.
- Do not add tenant controls or a new dashboard in the first release. Use server-owned configuration and existing diagnostics.
- Treat provider cost and latency as unmeasured until evaluated on Zara cases. No claimed savings are release evidence.

## 2. Code evidence and implementation boundaries

| Area | Current behavior | Main implementation locations |
| --- | --- | --- |
| Post-call analysis | Keyword checks generate dispositions and actions. No failure or escalation event produces `resolved`. | [Service](../apps/api/src/sandbox-live-sessions/sandbox-live-sessions.service.ts), [response types](../apps/api/src/sandbox-live-sessions/sandbox-live-sessions.models.ts), controller and current post-call tests |
| Memory drafts | Keyword rules select scope; confidence is a fixed number; full caller turns become draft text. | [Memory service](../apps/api/src/memory/memory.service.ts), memory models, extraction/controller tests |
| Knowledge drafts | Ordered keyword rules suggest the record type. Import and refresh already create review drafts. | Memory service, [knowledge safety](../apps/api/src/memory/knowledge-sync-safety.ts), import and refresh tests |
| Standalone intent | Gemini generates structured JSON; core validates it. A no-classifier path infers intent by substring. | [Classifier adapter](../apps/api/src/sandbox-live-sessions/sandbox-intent-classifier.provider.ts), [route resolver](../apps/api/src/sandbox-live-sessions/sandbox-live-session-router.ts), [core intent policy](../packages/core/src/intent-routing.ts) |
| Model selection | Rules and defaults select a tier. Speech confidence enters routing. Prompt defaults and exact model IDs affect the final request. | [Core runtime](../packages/core/src/runtime.ts), [PSTN runtime](../packages/core/src/pstn-sandwich-runtime.ts), [text router](../apps/api/src/sandbox-live-sessions/sandbox-text-model-router.provider.ts), OpenAI and Gemini text adapters |
| Handoffs | The speaking agent requests a configured target. Both sandbox and realtime paths assign intent confidence `1`. | Route resolver, [realtime service](../apps/api/src/runtime-sessions/runtime-sessions.service.ts), [turn packet](../packages/core/src/turn-runtime-packet.ts), transfer tests |

Trace all callers again when each package starts. The repository can change between planning and implementation. In particular, verify which standalone intent paths remain reachable after the concrete-agent changes in ISSUE-182. Do not build new support for retired workflows.

## 3. Shared foundation

### Provider boundary

Add one server-side TypeSafe adapter near the existing provider adapters. It accepts a bounded state object, typed questions, a model identifier, a deadline, and an abort signal. It returns validated answers plus safe metadata.

Use `Choice` for a defined set of results. Use `Noul` for an independent yes/no question; its value is the probability of yes. A Noul has no separate confidence field. Choice confidence describes its probability distribution, not proof that the answer is true. These meanings must remain distinct in code and logs. See the [API](https://docs.typesafe.ai/api) and [confidence documentation](https://docs.typesafe.ai/confidence).

Required adapter behavior:

1. Keep the API key server-side. Validate enabled-feature configuration at startup.
2. Pin a tested model version for release, and record the model returned by the provider. Recheck the current model catalog before implementation.
3. Validate expected question IDs, answer types, finite numeric ranges, configured choice membership, and probability distributions with a documented rounding tolerance.
4. Map timeout, abort, rate limit, authentication failure, malformed output, and provider failure into safe error codes. Do not return raw provider error bodies to clients.
5. Bound input size, candidate count, concurrency, and total request time. Never silently truncate away corrections or later refusals. Return an incomplete-input state when required evidence cannot fit.
6. Use no automatic retry in the live turn path. For background work, retry only transient failures with a bounded attempt count and total deadline.
7. Record actual usage, elapsed time, model, question revision, policy revision, and application result. Keep provider usage separate from customer charges; this plan does not change billing policy.

### Shared evidence, separate authority

Prepare state from trusted server-side sources. Include speaker, ordered turn ID, relevant safe tool results, and the applicable configured choices. Remove duplicate transcript entries emitted by both transcription and completion events.

Tenant text, caller text, imported documents, and transfer summaries remain untrusted data. They cannot modify the question, select credentials, change scope, or grant execution rights.

Store source references and revisions with accepted decisions. Bind live results to session, turn, active agent, and frozen manifest. Bind draft results to transcript or source snapshot version. Reject results when their source has changed, been deleted, or become unavailable to the tenant.

Use purpose-specific redaction before external requests. Do not send full packets, raw audio, credentials, or unrelated customer records. Verify provider data-use, retention, and region terms before using customer data. Synthetic evaluation can start first. Apply existing deletion and retention rules to stored judgement metadata.

### Reuse and batching

Batch independent questions that use the same permitted state. Keep memory questions separate when memory opt-in is absent. Do not combine live routing with post-call analysis. Do not build cross-tenant caches. An existing decision for the same source revision and question revision can be reused within its tenant.

The adapter is shared; output application remains domain-specific. A model response alone must never save memory, transfer a caller, run a tool, or create an external ticket.

## 4. Workstream A: post-call analysis

### Changes

1. Build one ordered, deduplicated transcript projection from existing session events. Preserve speaker identity and safe tool completion evidence.
2. Ask independent questions about confirmed resolution, remaining callback work, and remaining ticket work. Distinguish a request from a refusal, an offer, and work already completed.
3. Map answers to existing action types in code. Use stable action identities so repeated analysis cannot duplicate work.
4. Keep call failure and accepted/failed escalation as observed lifecycle facts. They do not prove business resolution. Add a separate `businessResolution` result: `resolved`, `unresolved`, or `unknown`.
5. Correct the existing `outcome` fallback: add `unknown` instead of assuming `resolved` when events do not establish resolution. Update API types and all consumers in the same slice. Existing records without semantic evidence map to unknown business resolution; do not reinterpret old `resolved` values as verified success.
6. Preserve the existing single disposition contract with documented precedence: outstanding callback, outstanding ticket, verified resolution, then needs review. Preserve all independent action items even when the disposition can show only one.
7. Use `unknown` and `needs_review` when evidence is incomplete, uncertainty is too high, or the provider fails. Never create an inferred external action automatically.
8. Keep free-text summary generation outside TypeSafe. The first slice may retain the current summary renderer. A better generated summary is separate work.

### Execution and persistence

The current summary method is synchronous. First use offline evaluation. For initial product integration, make the existing post-call request await one bounded analysis and keep its response envelope. This occurs after the call and adds no live-turn delay. Update the controller explicitly; do not return an unresolved promise inside its response object.

Do not assume a durable post-call worker already exists. If automatic analysis on call completion is required, reuse a verified durable job facility. If none exists, add only a tenant-scoped job record and bounded worker for this use. Do not use an untracked fire-and-forget promise. Automatic background execution is not required for the first on-demand release.

Save accepted analysis with its source revision. On repeat requests, reuse that result unless explicit reanalysis is requested. Reanalysis must not overwrite operator-completed action state or resend CRM work. CRM sync must use one finalized summary revision and existing execution permissions.

### Acceptance and TDD cases

- “Do not call back” creates no callback action.
- An agent offering a callback does not establish caller acceptance.
- A callback requested and later cancelled is not outstanding.
- A successful ticket tool result does not create another ticket request for the same work.
- A call with no failure event but an unresolved request is not reported as resolved.
- An empty or incomplete transcript produces unknown/review.
- Repeated analysis, provider failure, and a source revision change do not duplicate actions or CRM work.
- Tenant access, redaction, and existing lifecycle facts remain correct.

## 5. Workstream B: memory and knowledge drafts

These features share a draft-and-review pattern and the provider boundary. Their questions remain separate because memory interprets caller facts while knowledge classifies documents.

### Memory changes

1. Keep opt-in, caller/account ownership, speaker checks, and sensitive-data filters before inference.
2. Treat eligible caller turns as candidates with stable source IDs. Include enough surrounding dialogue to understand corrections, negation, and temporary requests.
3. Ask whether each candidate contains a lasting, caller-asserted fact worth retaining. Select `caller`, `account`, or `none`; account is unavailable without authorized account context.
4. Copy accepted source text and its source IDs. Do not ask TypeSafe to generate a new fact. Reject or leave for review any mixed-content turn that cannot be copied safely. Do not add a free-text extraction model in this slice.
5. Recheck sensitive content and source scope before returning a draft. Keep all outputs pending review under the existing contract; extraction must not activate durable memory.
6. Remove fixed confidence constants. Store named assessment metadata and use a documented decision score for any legacy numeric draft field. Do not mix it with retrieval similarity or approval authority.
7. On uncertainty or provider failure, return no accepted draft for that candidate and a safe review/unavailable reason. Do not fabricate a score.

Tests cover preferences without keywords, temporary needs, quoted third-party facts, corrections, negation, sensitive mixed content, missing account context, no opt-in, source provenance, and duplicate requests. Existing approval, deletion, retention, and tenant-isolation tests remain release gates.

### Knowledge changes

1. Use `Choice` over existing record types, plus an internal no-clear-type result. Evaluate title and bounded content from one source revision.
2. Apply it to imported and changed-source review drafts. Preserve explicit operator record types for manual sources and approved records.
3. Map no-clear-type to a review-required general-reference suggestion with an explicit uncertainty marker. It is not permission to activate.
4. Keep sensitivity labels, activation blockers, and high-risk confirmation independent of the model's primary type. A low-risk type must not clear a prior high-risk signal. Preserve existing high-risk posture on refresh until review resolves it.
5. Do not change source fetching, provider auth, crawl scope, HTML parsing, or deletion detection. A document's type does not establish that its source is valid or safe.
6. Recheck the source revision before saving. A late result cannot replace a newer review draft or operator choice.

Tests cover refund procedures versus price lists, escalation wording without exact keywords, mixed policy content, legal content classified as general reference, unchanged operator types, refresh races, secrets, provider failure, and cross-tenant sources.

## 6. Workstream C: live decisions

### C1. Correct decision contracts and model precedence

Do this before enabling TypeSafe decisions in live calls.

- Separate transcription confidence, intent-classifier confidence, and model-assistance assessment. Unknown is not zero or one.
- Add explicit decision origin: classifier, agent action, rule, or fallback. An agent handoff must not be described as a classifier result with certainty `1`.
- Introduce versioned packet/event fields where current required numeric fields cannot express unknown. Update reducers, prompt projections, replay, eval fixtures, and consumers together. Old assigned values remain legacy evidence, not calibrated scores.
- Retain a direct runtime path for validated agent handoff actions. Do not force these actions through a classifier threshold or a fabricated classifier result.
- Define one effective provider/model resolution before execution. Apply platform restrictions and runtime floors first; then eligible rules and agent/class defaults. Defaults fill missing values and cannot overwrite an already effective decision.
- Check whether an exact configured model satisfies the required tier. If no authoritative mapping exists, do not assume that it does. Reject the incompatible configuration or use an explicitly configured permitted fallback; never silently bypass a required floor.
- Review and test the current rule-before-safety ordering. Make mandatory safety floors non-bypassable. Document precedence as policy, not an accidental return order.
- Emit the provider and model actually requested. Test both OpenAI and Gemini paths and both browser and PSTN sandwich callers.

Acceptance cases include high speech confidence with unclear intent, low speech confidence with a simple request, a matching cheap rule plus a required safety floor, prompt defaults after tier selection, explicit model IDs, missing confidence, and unavailable allowed models.

### C2. Standalone intent classification

Use the existing classifier interface. Add a TypeSafe implementation only for reachable, supported standalone routes. Do not reintroduce removed builder nodes.

Provide configured branch IDs plus `none` as choices. Code derives intent key, label, graph target, and fallback status from the chosen branch. Build a diagnostic reason in code; TypeSafe need not generate a prose reason.

Keep range, membership, manifest, and fallback checks in core. Select provider through server configuration. Retain Gemini as the explicit rollback option during rollout. A TypeSafe outage should use the configured route fallback, not start an unbounded second provider request.

Replace transcript substring inference in supported no-classifier paths with explicit supplied intent or configured fallback. Keep parsing of trusted stored expressions deterministic. Do not send expressions to a model to recover graph semantics.

Recalibrate thresholds on Zara data. Do not copy Gemini's current confidence threshold into TypeSafe policy. Cover greetings, negation, synonyms, mixed intent, language changes, no match, empty choices, unknown choice IDs, input limits, timeout, and provider unavailability.

### C3. Handoff quality checks

Preserve the active agent as the live handoff decision maker. Use TypeSafe first as a sampled, post-turn evaluator. Ask whether the selected target fits the caller need, whether a refusal was ignored, and whether the summary is supported by the transcript and safe tool results.

Send only permitted target metadata from the frozen manifest. Record scores separately from the original action and runtime validation result. Evaluator failure must not block transfer execution.

Keep target membership, language support, loop limits, source announcements, tool authorization, and provider-session changes deterministic. Existing sandbox and premium transfer tests must pass unchanged except for intentional metadata contract changes.

If evaluation later proves a specific, frequent handoff error, propose a separate targeted live check with its own latency and accuracy evidence. Do not add a second classifier before every handoff as part of this plan.

### C4. Model assistance assessment

After C1, evaluate an advisory choice over `routine`, `needs_clarification`, and `needs_stronger_reasoning`. Define each using concrete examples and evidence requirements. Keep human-transfer requests separate from reasoning difficulty.

Measure the recommendation against outcomes from the candidate text models on the same held-out cases. Do not treat the model's own tier choice as the correct label.

In live rollout, code maps advice to allowed text tiers. Hard policy, budgets, availability, and configured model constraints still apply. A clarification result informs the speaking agent; it cannot directly generate caller speech or execute a transfer. A timeout keeps the safe deterministic routing result.

Batch this question with standalone intent only where both are actually needed and use the same state. Agent-led routes must not acquire a classifier call merely for batching. Start with sampled shadow evaluation and enable live assessment only where measured quality or cost gains justify its delay.

Limit automatic adaptation to sandwich text models in this slice. Do not switch an active premium audio session to another provider or runtime because of this assessment. Premium session policy and lifecycle remain governed by their existing contracts.

## 7. Evaluation and release gates

Use existing Vitest, runtime eval, prompt eval, and redacted trace tools. Ordinary tests use scripted provider responses and need no API key. Live model evaluations are separate, explicitly configured runs.

Create a versioned synthetic dataset with human-reviewed expected outcomes. Split it into threshold-tuning and held-out sets. Include supported languages, mixed-language requests, corrections, ambiguity, refusals, prompt injection, absent evidence, service failures, and rare high-risk cases. Do not place expected labels in provider state.

| Feature | Quality measures | Release requirement |
| --- | --- | --- |
| Post-call | False callback/ticket actions; missed unresolved requests; abstention rate | Beat keyword baseline on held-out cases; no automatic external writes |
| Memory | Supported-fact precision; wrong scope; approval rejection; missed useful facts | No known sensitive-data or scope regression; better useful-draft quality |
| Knowledge | Correct type; high-risk misses; operator correction rate | Better classification with all existing approval/blocking controls preserved |
| Intent | Wrong route; missed route; fallback rate by language | No safety regression; improved or equal quality at acceptable total latency |
| Handoff checks | Agreement with human review; false alarms; missed refusal/summary errors | Useful signal; no live dependency |
| Model assistance | Task success by selected tier; total provider cost; added p50/p95/p99 delay | Equal or better task success with a measured quality or cost benefit |

Set numeric feature thresholds and cost/latency budgets from baseline measurements before live activation. Record sample counts and uncertainty intervals; do not claim safety from zero errors in a small sample. Compare methods at similar abstention rates so a model cannot appear better merely by refusing all cases.

Required deterministic gates: 100% of policy, contract, isolation, failure, and runtime cases pass. Keep the existing runtime qualitative score threshold of 0.8 and manual review procedure where applicable. These existing gates supplement, but do not replace, feature-specific evaluation.

Run focused tests during each RED/GREEN/REFACTOR cycle. Before release, run the applicable commands: `npm run test:unit`, `npm run test:api`, `npm run typecheck`, `npm run lint`, and `npm run validate:contracts`. Run `npm run eval:runtime` for protected runtime changes and `npm run eval:pstn` for affected PSTN paths. Use `npm run eval:prompts` for supported live prompt checks; add a separately selected TypeSafe live suite to the existing evaluation setup. UI smoke tests are required only when an affected result contract changes a critical UI flow.

## 8. Delivery order and rollback

Each row is a proposed implementation package, not an already-created issue.

| Order | Package | Depends on | Completion evidence |
| --- | --- | --- | --- |
| 0 | Current-code trace, Linear specification, baseline dataset, privacy/configuration decisions | None | Linked work records; reachable paths confirmed; baseline results and budgets recorded |
| 1 | Small TypeSafe adapter and evaluation support | 0 | Fake-provider contract/failure tests; separate live evaluation command; redacted usage evidence |
| 2 | Post-call analysis and result contracts | 1 | Held-out comparison; unknown behavior; no duplicate actions; API compatibility checks |
| 3 | Memory and knowledge draft decisions | 1 | Quality comparison; source/approval/sensitivity/tenant tests |
| 4 | Routing confidence and effective model resolution | 0 | End-to-end precedence and actual-model tests; packet/event compatibility evidence |
| 5 | Supported standalone intent adapter and handoff evaluation | 1, 4 | Intent comparison; fallback tests; independent transfer quality results |
| 6 | Advisory model assistance and limited live rollout | 1, 4, 5 | Actual task quality, cost, and latency comparison; approved thresholds |

Packages 2 and 3 do not depend on live routing changes. Handoff evaluation may share post-call evidence preparation, but it must not require memory opt-in or write memory. Keep the shared projection limited to evidence that each feature is permitted to use.

For each feature, use off, shadow, then enabled operation. Roll out to a small configured cohort, review failure and quality measures, then expand. Pin question, model, and policy revisions. Live calls keep their call-start policy; apply changes to new calls unless an existing emergency policy requires otherwise.

Rollback disables the affected feature, cancels or ignores pending results, and restores a known supported provider or safe fallback. Post-call and memory failures remain unknown/review instead of reverting to false certainty. Knowledge drafts remain pending. Intent uses configured fallback or the explicitly selected Gemini provider. Model assistance returns to deterministic selection. Handoff evaluation can stop without changing calls.

Do not undo operator-approved records, executed actions, or externally synced summaries during rollback. Preserve their source and decision revision for audit. Schema changes must permit the rollback application to read affected records, or the deployment must include a documented forward-only recovery path.

## 9. Documentation and completion

Update only the documents affected by each implemented package:

- Post-call: API, data model, observability/evals, and relevant product flow.
- Memory and knowledge: Memory, API, data model, and security boundaries.
- Routing and handoffs: Architecture, runtime manifests, intent routing, transfer standard, turn packet, and runtime edge-case policy.
- Provider setup and operation: deployment environment reference, diagnostics, limits, disable procedure, and evaluation instructions.
- If UI contracts change, read DESIGN.md first and use the existing presentation patterns.
- Keep each external issue, local backlog entry, handover, and completed roadmap slice synchronized. Record RED failure, GREEN result, refactor checks, commands, risks, and next step.

The plan is complete when all six review points are either implemented and qualified or explicitly shown by evaluation to offer no benefit. A rejected live model-assistance experiment is a valid outcome if the deterministic correction is complete and the evidence explains why added inference was not enabled.

## Sources

- TypeSafe skill: `typesafe-ai/SKILL.md` in the local agent skill catalog
- [TypeSafe API](https://docs.typesafe.ai/api)
- [Choice](https://docs.typesafe.ai/primitives/choice) and [Noul](https://docs.typesafe.ai/primitives/noul)
- [Confidence](https://docs.typesafe.ai/confidence)
- [Source-value selection](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook)
- [Intent routing standard](Intent-Routing-Standard.md)
- [Agent tools and transfers](Agent-Tool-And-Transfer-Standard.md)
- [Memory](Memory.md), [security](Security-Compliance.md), and [testing strategy](Testing-Strategy.md)
- [Concrete-agent handover](Handovers/ISSUE-182-concrete-agent-runtime-and-handoff-model.md)

The original planning pass used source and contract inspection only. Implementation validation is recorded below. No provider request with customer data is authorized by this plan.

## 10. Operation and implementation evidence

The server adapter uses native fetch. It validates the full response and bounds each request to 100,000 bytes, 64 questions, 255 options per choice, and a 1,000,000-byte response. The default total deadline is five seconds. Eight requests can run per process; excess requests abstain without a queue. There are no automatic retries or new dependencies.

Deployment configuration is in `deploy/coolify.env.example` and `compose.coolify.yml`. Set `TYPESAFE_API_KEY` and a versioned `TYPESAFE_MODEL` only on the server. All feature modes default to `off`. Keep each mode off until its evaluation and provider data-use checks pass. Shadow mode records proposed decisions without applying them. It still sends permitted evidence to the provider.

| Configuration | Implemented operation |
| --- | --- |
| `TYPESAFE_POST_CALL_MODE` | Off returns the corrected unknown/review baseline. Shadow records proposed scores. Enabled applies bounded analysis to the summary. |
| `TYPESAFE_MEMORY_MODE` | Off retains legacy extraction. Shadow adds separate assessments. Enabled returns supported source-copy drafts for review. |
| `TYPESAFE_KNOWLEDGE_MODE` | Off retains legacy suggestions. Shadow records assessments. Enabled proposes types while preserving approval and risk controls. |
| `INTENT_CLASSIFIER_PROVIDER`, `TYPESAFE_INTENT_MODE` | Gemini is the default and rollback provider. TypeSafe shadow compares against Gemini; enabled uses TypeSafe with configured fallback on failure. |
| `TYPESAFE_INTENT_CONFIDENCE_THRESHOLD` | Required explicit value for TypeSafe intent shadow/enabled operation. Select it from evaluation; a blank value is not zero. |
| `TYPESAFE_INTENT_SHADOW_SAMPLE_RATE` | Fraction of eligible standalone intent calls to compare; default 0.05. |
| `TYPESAFE_HANDOFF_MODE`, `TYPESAFE_MODEL_ASSISTANCE_MODE` | Off or sampled shadow only. Enabled operation is rejected until a later qualified live rollout. |

Live shadow checks require the frozen manifest to permit transcript capture and sensitive-data redaction. Handoff and model-assistance sampling is 10 percent, with at most four pending requests per service and a 1.5-second provider deadline. Results contain identity and assessment metadata; they do not change the current turn. Pending work is tracked until completion or process shutdown. Runtime assistance does not switch an active premium audio session.

Run `npm run eval:typesafe` only with synthetic inputs and explicit test credentials. This is a paid provider evaluation, separate from deterministic tests. The small fixtures are an initial regression set, not enough evidence for release. Expand held-out cases and measure false actions, uncertainty, latency, usage, and actual task quality before enabling a feature. No live provider evaluation has run in this implementation pass.

Disable a feature by setting its mode to `off` and restarting the affected process. Keep intent provider selection at `gemini` for rollback. Do not delete approved records or reset CRM sync state during rollback. Current summary caching and request admission are per process; no durable background job was added.

### Test and review evidence

The implementation used RED/GREEN cycles for the provider boundary, semantic draft application, post-call outcome correction, repeated analysis, source changes, routing safety floors, and exact model selection. Tests first reproduced false resolution, duplicate transcript evidence, missed preference drafts, incorrect knowledge type, stale source writes, leaked contact data, and model pins that bypassed a selected tier.

Review corrections include separate speech and intent confidence, unknown confidence without an invented score, stable CRM sync identity, delayed explicit CRM sync, independent knowledge risk checks, bounded inference, safe source evidence, and actual requested-model telemetry. No new dependency, dashboard, queue, or durable analysis worker was added.

Memory/knowledge source guards use the existing service and repository model. They reject same-process refresh, approval, and deletion races. They do not add cross-process compare-and-swap to the file repository. A multi-writer deployment needs that repository guarantee before this feature is enabled there.

Release qualification remains pending: expand and review held-out labels, run paid synthetic evaluations, compare candidate text-model outcomes for model advice, set measured thresholds, verify provider data-use terms, and run a controlled shadow cohort. Synthetic advice labels alone do not prove that a stronger model improves the task. Linear synchronization remains blocked by the workspace issue limit.

Final validation on 2026-09-27:

- Three Sol agents implemented the workstreams with the implement, TypeSafe, TDD, and Ponytail instructions. The parent reviewed integration; agents reviewed specification and code quality. Review findings were corrected.
- `npm run lint`, `npm run typecheck`, `npm run validate:contracts` (including workspace builds), and `npm run test:boundaries` passed. The build retains its existing frontend chunk-size warning.
- The full suite ran once: 2,234 tests passed, 69 skipped, and three failed. The failures were a stale confidence expectation, the new disabled-mode startup test during its RED/GREEN cycle, and build outputs read during concurrent compilation. After the fixes and a completed sequential type check, all three affected files passed: 31 tests. The full suite was not repeated.
- Focused provider, post-call, draft, routing, handoff, and privacy tests passed. Deterministic runtime and PSTN evaluations passed (5 and 25 cases). Paid TypeSafe evaluations and deployment were not run.
- Disabled memory and knowledge modes now skip provider construction, so partial credentials do not prevent startup or rollback.
