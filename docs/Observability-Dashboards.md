# Observability Dashboards

## Dashboard Coverage

Production observability is split into staff-facing dashboards that map to the systems Zara operators need during a release, incident, or support escalation.

Required dashboards include calls, latency, errors, cost, integrations, and telephony:

- Calls: active calls, completed calls, failed calls, human escalations, fallback-triggered calls, call containment rate, and per-workspace call volume.
- Latency: first-audio latency, STT latency, model latency, TTS first-byte latency, tool duration, websocket reconnect latency, and p95/p99 turn latency.
- Errors: API 5xx rate, provider error rate, webhook signature failures, live sandbox provider failures, queue failures, workflow validation failures, and background job failures.
- Cost: usage events, telephony minutes, runtime cost deltas, Polar usage forwarding, tenant budget warnings, premium realtime spend, and missing-rate events.
- Integrations: OAuth connection health, token refresh failures, connector revocations, tool execution failures, CRM sync status, and webhook HTTP tool retries.
- Telephony: connection health, provider heartbeats, route failures, webhook dedupe rejects, inbound/outbound dispatch failures, recording notice status, DNC/timezone blocks, and provider fallback activity.
- AI runtime: intent fallback rate, classifier confidence, tool decision/use rate, tool failure rate, transfer rate, transfer loop prevention, packet projection truncation, policy warning count, LangSmith export health, eval regression status, and PSTN call-quality signals.

Each dashboard must filter by `environment`, `tenantId`, `workspaceId`, `provider`, `runtimeProfile`, and `releaseVersion` where the signal carries that dimension. Platform-admin dashboards may aggregate cross-tenant posture, but tenant dashboards must stay tenant scoped.

## Platform-admin-only AI runtime observability

AI runtime health is a Zara staff surface only. Tenant dashboards must not expose cross-tenant LangSmith links, eval experiment IDs, local trace IDs, redacted trace metadata, or platform regression-gate state.

The platform-admin runtime view and `GET /platform-admin/runtime/ai-observability` expose:

- intent fallback rate
- classifier confidence
- tool use rate and tool failure rate
- transfer loop prevention count
- policy warning count
- packet truncation count
- LangSmith export health
- eval regression status
- PSTN first-response p95 latency
- PSTN no-frame timeout count
- PSTN STT reconnect count
- PSTN TTS first-byte timeout count
- PSTN model timeout count
- PSTN bridge error count
- PSTN barge-in count
- PSTN premium realtime provider failure count
- PSTN premium realtime blocked-fallback count
- PSTN Twilio stop reason distribution
- PSTN successful Phone test rate
- PSTN eval gate status from `npm run eval:pstn`

Failing eval runs may link to LangSmith experiments and local trace IDs only after redaction has succeeded. The surface must show redaction state and release ownership, but never raw caller text, raw tool output, provider payloads, credentials, or unredacted trace data.

## Alert Thresholds

Alerts must page only when an operator can take action. Warning-level alerts go to the release channel or operations queue; page-level alerts wake the on-call owner.

Thresholds:

- Calls page: active-call failure rate is above 5% for 10 minutes or more than 3 active calls fail in one workspace within 5 minutes.
- Latency warning: p95 first-audio latency is above 1800 ms for 10 minutes. Latency page: p95 first-audio latency is above 3000 ms for 5 minutes.
- PSTN latency warning: PSTN first-response p95 latency is above 1500 ms for 10 minutes. PSTN latency page: PSTN first-response p95 latency is above 3000 ms for 5 minutes or `npm run eval:pstn` fails for the release candidate.
- Errors page: API 5xx rate is above 2% for 5 minutes, or provider error rate is above 5% for 10 minutes.
- Cost warning: tenant projected monthly spend reaches 80% of configured budget. Cost page: budget policy returns `block` for production calls or Polar usage forwarding fails for 15 minutes.
- Integrations warning: connector sync failure rate is above 10% for 30 minutes. Integrations page: OAuth token refresh failures affect more than 5 tenants for 15 minutes.
- Telephony page: provider heartbeat is missing for 5 minutes, webhook signature rejection spikes above 10 events in 5 minutes, or routed inbound calls cannot resolve a healthy route.

alert noise controls:

- Group alerts by `environment`, `tenantId`, `workspaceId`, `provider`, and `traceId` where available.
- Suppress duplicate alerts while the same incident is open.
- Downgrade known staging-only drift to warning unless the exact production candidate is being promoted.
- Include runbook links and the most recent deploy version in every page.

## Trace ID Correlation

Every production request, call, provider event, webhook, billing usage event, and background job must carry or derive a `traceId`.

Trace correlation rules:

- API ingress creates `traceId` when a request does not provide one.
- Live sandbox sessions attach the same `traceId` to lifecycle events, transcript events, provider telemetry, tool execution, cost deltas, and replay reads.
- Telephony webhooks derive `traceId` from provider event ID plus tenant route when a header is missing.
- Billing usage events include `traceId`, `tenantId`, `workspaceId`, `callSessionId`, and idempotency key.
- Integration tool execution includes `traceId`, connector provider, connection ID, tool ID, and workflow node ID.
- Platform-admin audit records include the `traceId` of the staff operation when the action was initiated from a dashboard.
- LangSmith traces receive the same `traceId`, call session ID, turn ID, packet ID, manifest ID, runtime profile, and release version through redacted OpenTelemetry attributes.

Missing correlation ID response:

1. Treat a missing correlation ID as an observability defect, not an incident by itself.
2. Synthesize a server-side `traceId` at the boundary.
3. Add `missing_correlation_id=true` to the event metadata.
4. Include the affected route, provider, tenant, and release version in the warning event.
5. File a follow-up before the release can be marked fully clean if the missing ID appears in production smoke tests.

## Dashboard Ownership

The release owner verifies dashboards during staging validation and production smoke tests. The on-call owner owns alert threshold tuning. Security signs off dashboards that expose cross-tenant aggregates. Billing signs off cost dashboards and Polar forwarding alerts.

## AI Trace And Eval Ownership

LangSmith is the workbench for redacted AI traces and runtime eval experiments. The implemented baseline exports packet-backed traces only when configured, records exporter failures as internal warning/metrics events, and keeps local runtime eval dry-runs available without LangSmith credentials. It does not replace Zara-owned dashboards, audit logs, billing ledgers, or tenant event replay. A missing LangSmith export is an observability defect; it must not block live calls.

Runtime eval scorecards should link back to the release version, dataset version, model alias, packet schema version, and trace IDs for failing examples. Release owners verify eval dashboards during model, prompt, routing, and runtime-policy changes.

PSTN media eval scorecards should link back to `zara.pstn-media.v1`, the release version, the PSTN runtime path, and the affected trace IDs. Premium realtime PSTN evals must be visible as `pstn-premium-realtime` rather than blended into sandwich results. Release owners verify PSTN evals before promoting telephony or bridge changes, and provider outages may be overridden only when local deterministic PSTN evals pass and the exception is recorded.
