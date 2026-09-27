# Provider billing support requests — 2026-09-16

Status: drafts only. Neither request has been sent. No provider reply is available.

Issue: [ISSUE-248 / ZAR-269](https://linear.app/zara-voice/issue/ZAR-269/run-shadow-billing-reconcile-draft-invoices-and-release-real-charges)

These requests use the saved [OpenAI findings](OpenAI-Usage-Evidence-Research-2026-09-16.md) and [Cartesia findings](Cartesia-Usage-Evidence-Research-2026-09-16.md). They ask for missing evidence. They do not assume that a recovery service or exact conversion exists.

## OpenAI request

Subject: Realtime usage recovery, billing time, and transcription units

We are building Zara, a voice application used by multiple customers. We need to compare saved usage records with provider billing reports. We use the OpenAI Realtime WebSocket API. We record response usage and input-transcription usage separately. We do not use conversation content to estimate billing quantities.

Please confirm these points and provide the applicable API documentation:

1. If a connection or process fails before we save `response.done` or `conversation.item.input_audio_transcription.completed`, can we retrieve the original usage later? If so, please identify the endpoint or export, required identifiers, permissions, retention period, and replay limits. Please distinguish Realtime usage recovery from stored Responses API retrieval. Can recovery work if the final response or item identifier was also lost?
2. Which provider timestamp assigns a Realtime response or transcription to an organization usage or cost bucket? Please include requests that cross midnight UTC, cancelled responses, failed responses, and delayed transcription. Is this timestamp available for each request? When are report totals final, and how are later corrections exposed?
3. For input-transcription events that report tokens but no seconds, which independent report supplies the same token units? Does the Costs API supply `quantity` and `quantity_unit` for these models when grouped by `line_item`? Please specify supported models, input/output/cache categories, grouping rules, and the meaning of missing or null quantities. If only seconds are available, is there a documented exact reconciliation method that does not estimate seconds from tokens?

An example response with no customer data would help. If a capability is unsupported, please state the limit and the recommended accounting method. We cannot assign a shared project total to an individual customer without supporting evidence.

## Cartesia request

Subject: Exact request credits and billing-day assignment

We are building Zara, a voice application used by multiple customers. We need exact provider usage records for TTS WebSocket contexts and, where applicable, streaming STT sessions. Our billing client currently uses API version `2026-03-01`.

Please confirm these points and provide the applicable API documentation:

1. Is there a supported API or export for exact charged credits for each request, TTS context, or STT session? Which stable identifiers link the credit record to the request? Can we retrieve it after a connection or process failure? Please specify permissions, retention, pagination, and replay limits.
2. Does the record include final credits after text preprocessing? How does it represent continued TTS contexts, cancellation, partial audio, failed requests, and retries? Please specify the credit unit and numeric precision. We do not want to use input character length as an exact credit count.
3. Which provider timestamp assigns usage to a UTC billing day? Is it available for each request or context? When are aggregate credit reports final, and how are later corrections exposed?
4. Which capabilities are supported with `2026-03-01`? If a newer version is required, please identify the minimum version and the billing-related contract changes.

An example response with no customer data would help. If request-level evidence is unavailable, please state that limit and the supported method for reconciling usage from a shared API key across customers.

## Before sending

- Select the account and support channel for each provider. Use an existing support case if it covers these questions.
- Obtain the user's approval to send the two request bodies. Do not send this internal preparation section.
- Do not attach API keys, authorization headers, customer identities, audio, transcripts, raw logs, or the repository.
- If support requires account or request identifiers, obtain approval for those specific fields and use a private support channel.

## How to use a reply

Record the case reference, reply date, supported API version, and evidence links in the issue handover. Do not store credentials or customer content there.

For each question, record one result: supported with evidence, explicitly unsupported, or unanswered. An aggregate report alone does not prove request-level recovery. A sample alone does not establish complete model coverage or report finality.

Only design the next implementation after the reply supplies a usable contract. Verify it with failing tests at the approved public interface before changing production code. Live qualification still requires a separate approved scope and cost limit. These drafts and any later support reply do not authorize deployment or customer charges.
