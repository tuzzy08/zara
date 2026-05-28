# Observability And Evals Standard

## Product Rule

Zara emits runtime observability through OpenTelemetry, stores canonical runtime facts in the turn runtime packet and event log, and exports redacted AI traces and eval runs to LangSmith for debugging, regression analysis, and model-quality evaluation.

LangSmith is not the source of truth for routing, audit, billing, tenant-visible monitoring, or incident metrics. The turn runtime packet remains the decision state for a turn. Runtime events, traces, metrics, and eval records are derived from packet facts plus provider execution results.

AI runtime observability and eval regression state are platform-admin-only product surfaces. Tenants may see tenant-scoped call quality and replay data, but they must not see cross-tenant LangSmith links, eval experiment IDs, local trace IDs, platform regression status, or internal redaction metadata.

## Implementation Status

ISSUE-138, ISSUE-139, and ISSUE-140 are implemented as the baseline for this standard. Live sandbox turns build packet-backed trace spans, configure OpenTelemetry and LangSmith from environment, export only redacted LangSmith run projections when tracing is enabled, and isolate exporter failures into internal warning/metrics events. Runtime evals run through `npm run eval:runtime` using `.eval.ts` files, LangSmith/Vitest wrappers, deterministic packet scorecards, and openevals LLM-as-judge evaluator plans. The main CI workflow includes a separate runtime eval gate, and platform-admin runtime surfaces expose AI health and eval status for Zara staff.

## Library Standard

Runtime observability should use these packages:

- `langsmith`
- `@opentelemetry/api`
- `@opentelemetry/sdk-trace-node`
- `@opentelemetry/sdk-trace-base`
- `@opentelemetry/exporter-trace-otlp-http`
- `@opentelemetry/resources`

Runtime evals should use:

- existing `vitest`
- `langsmith`
- `openevals`

The repo keeps normal unit, integration, contract, and security tests under the existing Vitest commands. LangSmith evals run through `ls.vitest.config.ts` and `npm run eval:runtime` so eval reporters, datasets, and slower model calls do not change ordinary test output.

## Environment

Required production/staging variables when LangSmith export is enabled:

```txt
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<secret>
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_WORKSPACE_ID=<workspace-id>
LANGSMITH_PROJECT=zara-runtime
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.smith.langchain.com/otel
OTEL_EXPORTER_OTLP_HEADERS=x-api-key=<secret>,Langsmith-Project=zara-runtime
OTEL_SERVICE_NAME=zara-api
```

Regional or self-hosted LangSmith endpoints may replace `LANGSMITH_ENDPOINT` and `OTEL_EXPORTER_OTLP_ENDPOINT`. Local development should default tracing off unless the developer explicitly sets LangSmith credentials. CI eval jobs may enable LangSmith upload, but regular unit and integration jobs should be able to run without LangSmith credentials.

## Config Shape

Runtime observability config should be explicit and environment-owned:

```ts
type RuntimeObservabilityConfig = {
  enabled: boolean;
  serviceName: "zara-api";
  environment: "local" | "staging" | "production";
  releaseVersion: string;
  traceSampleRate: number;
  sinks: Array<"event-log" | "metrics" | "opentelemetry" | "langsmith">;
  langsmith?: {
    enabled: boolean;
    project: string;
    endpoint: string;
    workspaceId?: string;
    datasetPrefix: "zara";
  };
  redaction: {
    mode: "strict" | "diagnostic";
    includeTranscriptText: "never" | "redacted_excerpt" | "redacted_full";
    includeToolOutput: "summary_only" | "safe_output";
    includeAudio: false;
  };
};
```

`strict` is the default for production and staging. `diagnostic` can be used only in local or explicitly approved internal sandbox environments.

## Trace Model

Each call gets one trace rooted at the call session. Each caller turn gets a child span. Every runtime decision span carries enough IDs to correlate with packet facts and replay events.

Span hierarchy:

```txt
call.session
  turn.runtime
    packet.created
    graph.node_visited
    intent.classified
    tool.selection
    tool.execution
    transfer.created
    agent.model_call
    tts.synthesis
    packet.finalized
```

Required trace attributes:

- `zara.trace_id`
- `zara.organization_id`
- `zara.workspace_id`
- `zara.call_session_id`
- `zara.turn_id`
- `zara.packet_id`
- `zara.manifest_id`
- `zara.published_workflow_version_id`
- `zara.runtime_profile`
- `zara.release_version`

Decision-specific attributes:

- Intent spans include branch IDs, selected branch ID, selected intent key, confidence, classifier alias, fallback reason, and policy warnings.
- Tool spans include tool assignment ID, connector provider, tool ID, decision outcome, approval state, duration, retryability, and redacted status.
- Transfer spans include source agent ID, target agent ID, transfer reason code, matched intent key, loop depth, and transfer policy result.
- Model spans include provider, model ID, model alias, input/output token counts when available, prompt projection size, and safety warnings.

Do not put raw credentials, raw OAuth tokens, raw provider payloads, unredacted transcript, unredacted tool output, or audio payloads into span attributes.

## Runtime Metrics

Metrics stay available in Zara-owned dashboards even when LangSmith is unavailable.

Required runtime metrics:

- call containment rate
- turn count per call
- first-audio latency
- total turn latency
- STT/model/TTS latency
- intent classification confidence and fallback rate
- tool decision rate, execution rate, success rate, failure rate, timeout rate, and approval-block rate
- transfer rate, loop prevention rate, and human escalation rate
- policy warning count by code
- packet projection size and truncation count
- LangSmith export success, failure, and dropped-span count

## Redaction

The LangSmith export receives a redacted projection, not the raw packet.

Production export rules:

- Use stable internal IDs or approved hashed identifiers for tenant and workspace correlation.
- Include redacted transcript excerpts only when the manifest telemetry policy allows transcript capture.
- Include tool summaries and safe outputs only. Raw tool output stays in trusted storage or is discarded according to the tool policy.
- Include no audio payloads or recordings.
- Include no secrets, bearer tokens, OAuth tokens, API keys, passwords, payment data, or provider credentials.
- Mark redaction failures as export-blocking. A dropped LangSmith span is preferable to leaking sensitive content.

## Eval Model

Runtime evals should run from packet fixtures and manifest projections. The target under test may be a pure reducer/classifier, a provider adapter with a fake model, or an end-to-end runtime turn harness.

Eval input shape:

```ts
type RuntimeEvalExample = {
  id: string;
  suite: string;
  inputs: {
    packet: unknown;
    manifestProjection: unknown;
    callerTurn: string;
  };
  referenceOutputs: {
    selectedIntentKey?: string;
    selectedTargetNodeId?: string;
    expectedToolCallIds?: string[];
    expectedTransferTargetAgentId?: string;
    expectedPolicyWarnings?: string[];
    disallowedOutputs?: string[];
  };
};
```

Baseline datasets:

- `zara.intent-routing.v1`
- `zara.toolbelt.v1`
- `zara.transfer.v1`
- `zara.policy-guards.v1`
- `zara.end-to-end-call.v1`

## Evaluators

Use deterministic evaluators wherever possible:

- exact selected intent
- no invented branch or graph target
- fallback selected when confidence is below threshold
- assigned tools only
- no tool call when required inputs are missing
- transfer context includes source, target, reason, caller need summary, matched intent, and safe tool summaries
- policy warning codes match expected edge cases
- redaction output contains no known sensitive strings

Use `openevals` LLM-as-judge evaluators only for qualitative behavior that cannot be reliably captured by exact assertions:

- agent response acknowledges transfer context
- agent asks for missing tool inputs instead of pretending a tool succeeded
- agent summarizes safe tool output without obeying untrusted instructions
- agent response is helpful while staying inside configured role and policy guardrails

LLM-as-judge evals should record the evaluator prompt version, model alias, score key, score, and explanation. They must not block the ordinary unit suite. CI can enforce a separate eval threshold for protected branches once the dataset is stable.

## Eval Thresholds

Deterministic runtime eval suites require a 100% pass rate for protected prompt, model, routing, tool, transfer, and policy changes. The protected deterministic suites are `zara.intent-routing.v1`, `zara.toolbelt.v1`, `zara.transfer.v1`, `zara.policy-guards.v1`, and `zara.end-to-end-call.v1`.

LLM-as-judge runtime evals require a minimum score of 0.8 for each configured qualitative score key. A score below 0.8 triggers manual review fallback by the release owner before promotion. Manual review does not relax redaction or deterministic pass requirements.

## Eval Execution

The eval command uses the separate `ls.vitest.config.ts` config with `.eval.ts` files. Evals import from `langsmith/vitest` and use the `langsmith/vitest/reporter` reporter when LangSmith tracking is enabled.

Regular local and CI test commands must continue to pass without LangSmith credentials. Eval jobs should support:

- local dry-run without upload
- LangSmith upload for named experiment runs
- dataset version tags
- release version tags
- model alias tags
- packet/schema version tags

## Online Evaluation

Production calls must not wait on eval scoring. Online evals are asynchronous and sampled from redacted traces or packet projections after the turn or call completes.

Online eval sampling should be configurable by environment, tenant plan, runtime profile, and safety posture. High-risk policy warnings, fallback spikes, transfer loops, and tool failures may force inclusion in an eval queue, but still must use redacted inputs.

## Failure Policy

LangSmith or OTel exporter failure must not break live calls. Export failures should produce internal metrics and warning events with `traceId`, service, environment, release version, and drop count.

Eval failures block only the specific CI gate or release gate configured for evals. They do not affect active runtime sessions.

Protected release changes fail closed when the runtime eval gate fails. A LangSmith outage override is allowed only for emergency runtime fixes when local deterministic evals pass, the release owner records the exception, and owner signoff is attached to the release notes. The override does not permit publishing unredacted LangSmith data or bypassing deterministic safety checks.

## Documentation Links

Implementation issues for this standard must keep these docs aligned:

- `docs/Architecture.md`
- `docs/Runtime-Manifests.md`
- `docs/Observability-Dashboards.md`
- `docs/Testing-Strategy.md`
- `docs/Security-Compliance.md`
- `docs/Feature-Flows.md`
