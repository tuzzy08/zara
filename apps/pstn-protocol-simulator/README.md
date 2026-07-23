# PSTN protocol simulator and load suite

This workspace runs outside the API and realtime worker processes. It provides:

- a Twilio virtual caller that signs the real form webhook, validates `<Connect><Stream>` TwiML, and emits 8 kHz mono PCMU at 20 ms cadence;
- an OpenAI Realtime WebSocket simulator with deterministic readiness, audio, transcript, tool, handoff, pressure, and failure behavior;
- stepped, burst, failure, and two-hour soak load profiles correlated with Zara's staff-only capacity posture;
- redacted `zara.pstn-load-report.v1` JSON artifacts.

## Topology

Run release-scale load from a dedicated load-generator host or isolated resource pool. A separate process on the same API host is not sufficient because its CPU, memory, sockets, and event-loop pressure would contaminate the server measurements.

The API must run in test or staging with the simulator transport selected:

```text
NODE_ENV=staging
ZARA_PREMIUM_REALTIME_TRANSPORT=simulator
ZARA_PREMIUM_REALTIME_SIMULATOR_URL=wss://load-generator.example.test/realtime
ZARA_PREMIUM_REALTIME_SIMULATOR_TOKEN=<at-least-32-random-characters>
```

Loopback development may use `ws://127.0.0.1:4319/realtime`. A remote simulator requires a TLS reverse proxy that exposes `wss`, forwards to the load process, and passes the same simulator token to both processes. Never expose an unauthenticated remote simulator.

## Staging prerequisites

Before a load run:

1. Deploy the exact commit under test to an isolated single-instance staging resource shape.
2. Seed published premium workflows and active test routes for every scenario destination. Draft workflows are invalid.
3. Assign a connector tool to the tool-call workflow, two OpenAI agents to the same-provider handoff workflow, and an OpenAI router plus Gemini specialist to the cross-provider workflow.
4. Configure a dedicated exporter-failure route or staging instance whose OTLP exporter fails without failing calls.
5. Provide at least two tenant routes for the cross-tenant burst profile.
6. Obtain a staff-authorized session cookie for `GET /platform-admin/runtime/ai-observability`. A bearer token works only when the staging gateway maps that service identity to Zara's platform guard.
7. Confirm the load generator is not sharing the API/realtime worker CPU or memory limits.

Store tenant secrets outside the repository. `ZARA_PSTN_LOAD_TENANTS_FILE` points to a JSON file with this shape:

```json
{
  "tenants": [
    {
      "accountSid": "AC...",
      "authToken": "...",
      "from": "+15550001111",
      "webhookUrl": "https://api.example.test/telephony/webhooks/twilio",
      "destinations": {
        "default": "+15550002222",
        "tool-call": "+15550002223",
        "same-provider-handoff": "+15550002224",
        "cross-provider-handoff": "+15550002225",
        "exporter-failure": "+15550002226"
      }
    }
  ]
}
```

The destination keys are route fixtures, not values written to reports. The file must not be committed.

## Environment

```text
NODE_ENV=staging
ZARA_PSTN_LOAD_TENANTS_FILE=/run/secrets/zara-pstn-load-tenants.json
ZARA_PSTN_LOAD_TELEMETRY_URL=https://api.example.test/platform-admin/runtime/ai-observability
ZARA_PSTN_LOAD_TELEMETRY_COOKIE=<staff-session-cookie>
ZARA_PSTN_LOAD_SIMULATOR_HOST=0.0.0.0
ZARA_PSTN_LOAD_SIMULATOR_PORT=4319
ZARA_PREMIUM_REALTIME_SIMULATOR_TOKEN=<same-token-as-api>
ZARA_RELEASE_SHA=<deployed-git-sha>
ZARA_PSTN_LOAD_PROVIDER=openai-realtime
ZARA_PSTN_LOAD_RUNTIME_PATH=pstn-premium-realtime
ZARA_PSTN_LOAD_REPORT_DIR=artifacts/pstn-load
```

`ZARA_PSTN_LOAD_TELEMETRY_BEARER_TOKEN` may replace the cookie only in deployments with an authorized service-identity gateway. Inline tenant JSON is rejected.

## Commands

The deterministic CI smoke is small and never authorizes release-scale execution:

```text
npm run load:pstn:ci
```

Every release-scale command requires a human to set `ZARA_PSTN_LOAD_APPROVED=true`:

```text
npm run load:pstn:release -- stepped
npm run load:pstn:release -- burst
npm run load:pstn:release -- failure
ZARA_PSTN_LOAD_QUALIFIED_TARGET=20 npm run load:pstn:release -- soak
```

The stepped profile tests 1, 5, 10, 20, 40, 60, and 100 concurrent calls. The runner stops the remaining profile when capacity telemetry reaches `exhausted`. Do not choose a soak target until the stepped report identifies a passing level below the first hard safety stop.

## Cost boundaries

The virtual caller does not place a carrier PSTN call, so it does not incur Twilio voice-minute charges. Simulator-backed OpenAI legs do not incur OpenAI model charges. A cross-provider route can intentionally connect a real Gemini target and therefore incurs realtime provider charges; it belongs only in an approved release job. Any route configured to a real provider, real PSTN leg, or paid observability backend must be reviewed for rate and spend limits before approval.

The two-hour soak is never an ordinary CI job. Stop it when the runner reports exhaustion, missing telemetry, identity isolation failure, absent traffic, or a hard SLO breach.

## Reports

Reports contain commit SHA, environment, declared resource shape, profile/stage/scenario, tenant mode, arrival rate, concurrency, duration, p50/p95/p99 latencies, bounded failure taxonomy, and SLO results. They exclude credentials, caller numbers, tenant IDs, stream tokens, transcripts, media, and provider payloads.

Interpretation:

- `outcome: passed` means every executed stage produced meaningful isolated traffic, met hard SLOs, retained required telemetry, and drained calls, sockets, queues, reservations, and memory to the permitted baseline window.
- `resource_exhausted` means the hard stop fired; later stages were deliberately not run.
- `scenario_not_exercised` means a declared scenario produced no call result and the report is invalid.
- `exporter_failure_not_observed` means the failure route did not produce the required nonfatal exporter evidence.
- `drain_not_recovered` means the worker did not return to baseline and must not be qualified.

For the first pre-persistence baseline, set `ZARA_PSTN_LOAD_REPORT_DIR=artifacts/pstn-load/baselines`, run the approved `stepped` profile against the current single-instance deployment, and retain the generated JSON with its deployment resource manifest. A synthetic or local workstation report is not capacity certification.

## Protocol smoke

The original single-call protocol smoke remains available:

```text
ZARA_PSTN_SIMULATOR_TWILIO_ACCOUNT_SID=AC... \
ZARA_PSTN_SIMULATOR_TWILIO_AUTH_TOKEN=... \
ZARA_PSTN_SIMULATOR_FROM=+15550001111 \
ZARA_PSTN_SIMULATOR_TO=+15550002222 \
ZARA_PSTN_SIMULATOR_WEBHOOK_URL=https://api.example.test/telephony/webhooks/twilio \
npm run smoke:pstn-protocol
```

Both smoke and load commands keep signatures, stream credentials, transcripts, media, and raw provider errors out of output.
