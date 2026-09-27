# Cartesia Usage Evidence Research — 2026-09-16

Issue: [ISSUE-248 / ZAR-269](https://linear.app/zara-voice/issue/ZAR-269/run-shadow-billing-reconcile-draft-invoices-and-release-real-charges)

## Evidence limits

The documented TTS WebSocket completion message has `type`, `done`, `status_code`, and `context_id`. It does not provide credits or an accounting timestamp. The local `docs/cartesia/TTS-WS.md` Done Response schema has the same fields. This does not prove that no other provider service can supply request-level evidence. [TTS WebSocket](https://docs.cartesia.ai/api-reference/tts/websocket)

Cartesia describes standard TTS pricing as approximately one credit per character. Text preprocessing can change the exact count. Thus Zara cannot use input text length as exact provider credits. [Pricing](https://docs.cartesia.ai/pricing)

The credit usage API returns aggregate buckets. It supports an API-key filter and grouping by capability, model, voice, or API key. The documented result does not identify individual requests. Start and end times are rounded to UTC-day boundaries. Zara must not allocate a shared-key total to one tenant or one request. [Credit usage API](https://docs.cartesia.ai/api-reference/usage/credits)

The current reference uses API version `2026-08-14`. Zara's existing billing client remains pinned to `2026-03-01`. This research does not qualify a version migration or change voice payloads.

## Local validation repair

The existing billing-report interface now rejects non-numeric credits instead of converting them to numbers. Tests first showed that null, empty text, booleans, numeric text, and arrays could become accepted zero or positive facts. Numeric zero remains valid provider evidence. Existing nonnegative safe-integer validation remains unchanged. This repair does not supply missing request-level credits or prove complete recording.

## Questions that need provider evidence

1. Is there a supported request-level usage export or lookup? Which stable identity links it to a TTS context or STT session?
2. Does it give exact charged credits after preprocessing, including cancelled and continued contexts?
3. Which provider time assigns usage to a reporting day? When are reports final, and how are corrections exposed?
4. Which API versions support this evidence, and what are its retention and replay limits?

No provider message was sent. No credential, paid request, deployment, or charge setting changed. Keep Cartesia recording coverage incomplete until supported evidence is qualified. The next implementation must not estimate credits or fill missing facts with zero.
