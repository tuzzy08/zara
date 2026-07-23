# PSTN protocol simulator

This workspace runs outside the API process and models both sides of a premium PSTN call:

- a Twilio virtual caller that signs the real form webhook, validates `<Connect><Stream>` TwiML, and emits 8 kHz mono PCMU media at 20 ms cadence;
- an OpenAI Realtime WebSocket simulator with deterministic readiness, audio, transcript, tool, handoff, incomplete, error, pressure, and closure scenarios.

The API must run in test or staging with:

```text
NODE_ENV=staging
ZARA_PREMIUM_REALTIME_TRANSPORT=simulator
ZARA_PREMIUM_REALTIME_SIMULATOR_URL=ws://127.0.0.1:4319/realtime
```

Loopback may use `ws`. A simulator on another host must use `wss` and set the same token on both processes:

```text
ZARA_PREMIUM_REALTIME_SIMULATOR_TOKEN=a-random-secret-with-at-least-32-characters
```

Pass that value as `authToken` when starting `OpenAiRealtimeProtocolSimulator` outside loopback.

Run the external smoke process with a seeded Twilio connection, imported number, published premium workflow, and active route:

```text
ZARA_PSTN_SIMULATOR_TWILIO_ACCOUNT_SID=AC... \
ZARA_PSTN_SIMULATOR_TWILIO_AUTH_TOKEN=... \
ZARA_PSTN_SIMULATOR_FROM=+15550001111 \
ZARA_PSTN_SIMULATOR_TO=+15550002222 \
ZARA_PSTN_SIMULATOR_WEBHOOK_URL=https://api.example.test/telephony/webhooks/twilio \
npm run smoke:pstn-protocol
```

The command reports only scenario outcomes, counts, and a credential-free endpoint. It never prints request signatures, stream tokens, credentials, transcripts, or audio payloads.
