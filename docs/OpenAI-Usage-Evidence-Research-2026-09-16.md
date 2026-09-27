# OpenAI Usage Evidence Research — 2026-09-16

Issue: [ISSUE-248 / ZAR-269](https://linear.app/zara-voice/issue/ZAR-269/run-shadow-billing-reconcile-draft-invoices-and-release-real-charges)

Scope: official documentation research only. No paid API request, credential read, live call, runtime change, or release approval was made. The OpenAI Docs and Research skills guided source selection and this note. Sources were searched with the OpenAI documentation tool, then fetched. The organization reference pages required the web reader because their Markdown routes returned 404.

## Decision

The reviewed documentation does not justify automated recovery of lost Realtime usage. It also does not establish a complete rule for matching Zara receipt time to provider billing buckets, or converting token-only input transcription to report seconds. Keep these evidence gaps open. This is a limit of the established evidence, not a claim that OpenAI has no possible recovery service.

## 1. Lost Realtime usage

### Documented facts

- `response.done` contains response usage. It is emitted for completed, cancelled, failed, and incomplete responses. Its response object is `realtime.response`; the schema does not supply a response billing timestamp. Emission is not a guarantee that a disconnected client received or saved the event. [Realtime server events](https://developers.openai.com/api/reference/resources/realtime/server-events#response.done)
- Input transcription has its own completion event and usage. It runs separately from response generation. Thus its completion can arrive before or after the response events. [Transcription completion event](https://developers.openai.com/api/reference/resources/realtime/server-events#conversation.item.input_audio_transcription.completed)
- `conversation.item.retrieve` requests an item from the current conversation history. Its documented result is the item, including available content and audio. It is not a documented replay of response or transcription usage. [Retrieve item](https://developers.openai.com/api/reference/resources/realtime/client-events#conversation.item.retrieve), [retrieved item](https://developers.openai.com/api/reference/resources/realtime/server-events#conversation.item.retrieved)
- The Realtime sideband interface connects a server to an in-progress WebRTC or SIP call through `call_id`. The guide describes event monitoring and session control. It does not establish replay of missed billing events after a process failure. Read its Realtime section; the GPT-Live section describes a different API. [Server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=realtime)
- Stored Responses API objects can be retrieved. The default retention is 30 days, and `store: false` disables that storage. This guidance concerns the Responses API, not Realtime response objects. Do not send a Realtime response ID to the Responses retrieval interface based only on their similar names. [Responses conversation state](https://developers.openai.com/api/docs/guides/conversation-state#data-retention-for-model-responses)

### Not established

No reviewed Realtime source establishes a durable event cursor, replay guarantee, or request-level usage lookup after the event is lost. The sources do not establish that stored Responses, conversation-item retrieval, sideband attachment, traces, or organization totals can reconstruct a missing tenant-qualified Realtime usage record.

### Safe next step

Keep the existing retained-event replay path separate from lost-event recovery. A saved, verified provider event can be replayed through existing identity and immutability checks. An event never saved cannot be invented. Keep its request unresolved. Obtain provider confirmation of a supported lookup/export, with retention and identity rules, before building automatic recovery. Do not add raw transcript or audio retention to solve this accounting gap.

## 2. Provider accounting time

### Documented facts

The Realtime cost guide says per-response cost starts when a response is created. Usage is read from its final event. Input transcription is charged separately when committed audio is transcribed. These facts do not specify how organization reporting assigns a request that crosses a day boundary. [Realtime costs](https://developers.openai.com/api/docs/guides/voice-latency-cost#per-response-costs)

Organization transcription queries use inclusive `start_time` and exclusive `end_time`, in Unix seconds. Reports support minute, hour, or day buckets. Each returned bucket has start and end times. The schema does not define request-level billing time, reporting delay, finalization time, or correction policy. [Organization transcription usage](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/audio_transcriptions)

### Safe next step

Preserve the distinction between Zara request-start time, first event receipt time, and provider bucket boundaries. Do not rename a local time as provider accounting time. With separate approval, compare controlled nonzero usage near a UTC boundary against later provider reports. Record the exact model, provider scope, request identity, and returned buckets. Ask OpenAI which lifecycle time determines the bucket and when reports are final. A local UTC-selection test cannot answer these provider questions.

## 3. Token-only transcription and report seconds

### Documented facts

The transcription event has two usage variants: native token counters, or native seconds. Its token variant has no seconds field. Transcription uses its own model and pricing. [Transcription usage schema](https://developers.openai.com/api/reference/resources/realtime/server-events#conversation.item.input_audio_transcription.completed)

The organization's `audio_transcriptions` result reports processed seconds and request count. It can group by project, user, API key, and model. It does not expose per-item token counters in that result. [Organization transcription usage](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/audio_transcriptions)

The Realtime guide's audio-token timing example concerns conversational response tokens. The same guide separates input transcription and its ASR model. It does not establish an exact conversion from transcription tokens to report seconds. [Realtime costs and input transcription](https://developers.openai.com/api/docs/guides/voice-latency-cost#input-transcription-costs)

### Safe next step

Retain native token counters and mark comparison seconds unknown. Do not substitute runtime duration, VAD intervals, transcript length, or response-token timing. A matching request count alone is not a complete usage match. Obtain a supported same-unit source and qualify its model, scope, timing, and coverage before accepting a match.

One candidate merits a separate check: the current Costs API documents `quantity` and `quantity_unit` when grouped by `line_item`. It also supports project and API-key grouping. These fields are optional, and the unit can be null. This does not prove that Zara's transcription models have usable token line items or request-level attribution. Inspect actual approved evidence before designing a mapping. Do not allocate a shared cost total to a tenant. [Organization costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)

## Validation and remaining work

- Source check: fetched the event schemas, item retrieval, Realtime controls/costs, Responses state, organization transcription usage, and Costs documentation.
- No runtime test was required for this research-only note. No release gate is satisfied by documentation alone.
- Remaining work: supported recovery source, provider time semantics, same-unit transcription comparison, then separately approved live qualification. Charge delivery remains disabled.
