import { SpanKind, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type {
  CompiledRuntimeManifest,
  RuntimePacketEvent,
  ToolExecutionResult,
  TurnRuntimePacket,
} from "@zara/core";
import { Client } from "langsmith";

export const runtimeObservabilityRecorderToken = "RUNTIME_OBSERVABILITY_RECORDER";
export const pstnCallObservabilityRecorderToken = "PSTN_CALL_OBSERVABILITY_RECORDER";

export type RuntimeObservabilitySink = "event-log" | "metrics" | "opentelemetry" | "langsmith";

export interface RuntimeObservabilityConfig {
  enabled: boolean;
  serviceName: "zara-api";
  environment: "local" | "staging" | "production" | "test";
  releaseVersion: string;
  traceSampleRate: number;
  sinks: RuntimeObservabilitySink[];
  langsmith?: {
    enabled: boolean;
    project: string;
    endpoint: string;
    workspaceId?: string | undefined;
    datasetPrefix: "zara";
  } | undefined;
  redaction: {
    mode: "strict" | "diagnostic";
    includeTranscriptText: "never" | "redacted_excerpt" | "redacted_full";
    includeToolOutput: "summary_only" | "safe_output";
    includeAudio: false;
  };
}

export interface RuntimeTraceSpan {
  name: string;
  parentName?: string | undefined;
  startedAt: string;
  endedAt: string;
  attributes: Record<string, string | number | boolean>;
}

export interface RuntimeTraceModelFacts {
  provider: string;
  modelId?: string | undefined;
  modelAlias?: string | undefined;
  tier?: string | undefined;
  latencyMs?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  promptProjectionBytes?: number | undefined;
}

export interface RuntimeTraceTtsFacts {
  provider: string;
  latencyMs?: number | undefined;
}

export interface LangSmithRuntimeTraceProjection {
  traceId: string;
  ids: {
    organizationId: string;
    workspaceId: string;
    callSessionId: string;
    turnId: string;
    packetId: string;
    manifestId: string;
    manifestVersion: number;
    publishedWorkflowVersionId: string;
  };
  release: {
    environment: RuntimeObservabilityConfig["environment"];
    version: string;
  };
  runtime: {
    profile: string;
    serviceName: string;
  };
  inputs: {
    source: TurnRuntimePacket["callerInput"]["source"];
    language?: string | undefined;
    latestCallerTurn?: string | undefined;
  };
  intent?: {
    intentKey: string | null;
    selectedBranchId: string | null;
    selectedTargetNodeId: string;
    confidence: number;
    usedFallback: boolean;
    reason: string;
  } | undefined;
  tools: Array<{
    toolCallId: string;
    toolAssignmentId: string;
    toolId?: string | undefined;
    toolName?: string | undefined;
    status?: ToolExecutionResult["status"] | undefined;
    summary?: string | undefined;
    safeOutput?: Record<string, unknown> | undefined;
    errorCode?: string | undefined;
    recoverable?: boolean | undefined;
  }>;
  transfer?: {
    transferId: string;
    sourceAgentId: string;
    targetAgentId: string;
    matchedIntentKey?: string | undefined;
    reason: string;
  } | undefined;
  model?: RuntimeTraceModelFacts | undefined;
  tts?: RuntimeTraceTtsFacts | undefined;
  warnings: Array<{
    code: string;
    recoverable: boolean;
  }>;
}

export interface RuntimeTraceExportPlan {
  spans: RuntimeTraceSpan[];
  langsmithTrace?: LangSmithRuntimeTraceProjection | undefined;
}

export type PstnCallObservabilityEventType =
  | "webhook.received"
  | "route.selected"
  | "media.websocket_connected"
  | "media.first_inbound_frame"
  | "transcript.created"
  | "stt.reconnected"
  | "model.first_token"
  | "tts.first_byte"
  | "media.first_outbound_frame"
  | "barge_in.clear"
  | "call.ended"
  | "provider.failure"
  | "runtime.failure";

export interface PstnCallObservabilityEvent {
  type: PstnCallObservabilityEventType;
  at: string;
  payload: Record<string, unknown>;
}

export interface PstnCallTraceInput {
  config: RuntimeObservabilityConfig;
  traceId: string;
  call: {
    organizationId: string;
    workspaceId?: string | undefined;
    callSessionId: string;
    phoneNumberId?: string | undefined;
    connectionId?: string | undefined;
    provider: "twilio" | string;
    routeMode?: "test_route" | "live_route" | undefined;
    runtimeProfile?: string | undefined;
    publishedWorkflowVersionId?: string | undefined;
    mediaStreamId?: string | undefined;
  };
  events: PstnCallObservabilityEvent[];
}

export interface PstnCallQualityMetrics {
  firstResponseLatencyMs?: number | undefined;
  firstResponseLatencyClassification?: "good" | "warning" | "critical" | undefined;
  noFrameTimeoutCount: number;
  sttReconnectCount: number;
  ttsFirstByteTimeoutCount: number;
  modelTimeoutCount: number;
  bridgeErrorCount: number;
  bargeInCount: number;
  successfulPhoneTestRate?: number | undefined;
  twilioStopReasons: Record<string, number>;
}

export interface LangSmithPstnTraceProjection {
  traceId: string;
  ids: {
    organizationId: string;
    workspaceId?: string | undefined;
    callSessionId: string;
    phoneNumberId?: string | undefined;
    connectionId?: string | undefined;
    mediaStreamId?: string | undefined;
    publishedWorkflowVersionId?: string | undefined;
  };
  release: {
    environment: RuntimeObservabilityConfig["environment"];
    version: string;
  };
  pstn: {
    provider: string;
    routeMode?: "test_route" | "live_route" | undefined;
    runtimeProfile?: string | undefined;
    runtimePath: "pstn-sandwich";
  };
  model?: {
    provider?: string | undefined;
    modelId?: string | undefined;
    latencyMs?: number | undefined;
  } | undefined;
  tts?: {
    provider?: string | undefined;
    latencyMs?: number | undefined;
  } | undefined;
  metrics: PstnCallQualityMetrics;
  decisions: Array<{
    type: string;
    at: string;
    attributes: Record<string, string | number | boolean>;
  }>;
  policyWarnings: Array<{
    code: string;
    recoverable: boolean;
  }>;
  redaction: {
    state: "redacted";
    omitted: Array<"raw_audio" | "raw_transcript" | "caller_number" | "secrets" | "raw_tool_output">;
  };
}

export interface PstnCallTraceExportPlan {
  spans: RuntimeTraceSpan[];
  metrics: PstnCallQualityMetrics;
  langsmithTrace?: LangSmithPstnTraceProjection | undefined;
}

export interface RuntimeTraceExportInput {
  config: RuntimeObservabilityConfig;
  traceId: string;
  packet: TurnRuntimePacket;
  manifest: CompiledRuntimeManifest;
  model?: RuntimeTraceModelFacts | undefined;
  tts?: RuntimeTraceTtsFacts | undefined;
}

export interface RuntimeSpanExporter {
  exportSpans(spans: RuntimeTraceSpan[]): Promise<void>;
}

export interface RuntimeLangSmithExporter {
  exportTrace(trace: LangSmithRuntimeTraceProjection): Promise<void>;
}

export interface PstnCallLangSmithExporter {
  exportTrace(trace: LangSmithPstnTraceProjection): Promise<void>;
}

export interface RuntimeObservabilityRecorder {
  recordTurn(input: Omit<RuntimeTraceExportInput, "config">): Promise<RuntimeObservabilityRecorderResult>;
}

export interface RuntimeObservabilityRecorderResult {
  exportedSpanCount: number;
  langsmithExported: boolean;
  warnings: Array<{
    code: string;
    message: string;
    recoverable: true;
  }>;
  metrics: {
    langsmithExportFailureCount: number;
    spanExportFailureCount: number;
    droppedSpanCount: number;
  };
}

export interface PstnCallObservabilityRecorder {
  recordPstnCall(input: Omit<PstnCallTraceInput, "config">): Promise<RuntimeObservabilityRecorderResult>;
}

export function resolveRuntimeObservabilityConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeObservabilityConfig {
  const langsmithTracing = env["LANGSMITH_TRACING"] === "true";
  const langsmithApiKey = env["LANGSMITH_API_KEY"]?.trim() ?? "";
  const enabled = langsmithTracing && langsmithApiKey.length > 0;
  const environment = readEnvironment(env["NODE_ENV"]);
  const releaseVersion = env["ZARA_RELEASE_VERSION"]?.trim() || "local";
  const langsmithEndpoint = env["LANGSMITH_ENDPOINT"]?.trim() || "https://api.smith.langchain.com";
  const langsmithProject = env["LANGSMITH_PROJECT"]?.trim() || "zara-runtime";
  const workspaceId = env["LANGSMITH_WORKSPACE_ID"]?.trim();

  return {
    enabled,
    serviceName: "zara-api",
    environment,
    releaseVersion,
    traceSampleRate: readSampleRate(env["RUNTIME_TRACE_SAMPLE_RATE"]),
    sinks: enabled
      ? ["event-log", "metrics", "opentelemetry", "langsmith"]
      : ["event-log", "metrics"],
    langsmith: {
      enabled,
      project: langsmithProject,
      endpoint: langsmithEndpoint,
      ...(workspaceId !== undefined && workspaceId.length > 0 ? { workspaceId } : {}),
      datasetPrefix: "zara",
    },
    redaction: {
      mode: environment === "local" ? "diagnostic" : "strict",
      includeTranscriptText: enabled ? "redacted_excerpt" : "never",
      includeToolOutput: "safe_output",
      includeAudio: false,
    },
  };
}

export function buildRuntimeTraceExport(input: RuntimeTraceExportInput): RuntimeTraceExportPlan {
  const baseAttributes = buildBaseAttributes(input);
  const spans: RuntimeTraceSpan[] = [
    buildSpan("call.session", undefined, input.packet, baseAttributes),
    buildSpan("turn.runtime", "call.session", input.packet, baseAttributes),
    buildSpan("packet.created", "turn.runtime", input.packet, {
      ...baseAttributes,
      "zara.packet_schema_version": input.packet.schemaVersion,
    }),
    ...buildPacketEventSpans(input.packet, baseAttributes),
  ];

  if (input.model !== undefined) {
    spans.push(buildSpan("agent.model_call", "turn.runtime", input.packet, {
      ...baseAttributes,
      "zara.model_provider": input.model.provider,
      ...(input.model.modelId !== undefined ? { "zara.model_id": input.model.modelId } : {}),
      ...(input.model.modelAlias !== undefined ? { "zara.model_alias": input.model.modelAlias } : {}),
      ...(input.model.tier !== undefined ? { "zara.model_tier": input.model.tier } : {}),
      ...(input.model.latencyMs !== undefined ? { "zara.model_latency_ms": input.model.latencyMs } : {}),
      ...(input.model.inputTokens !== undefined ? { "zara.model_input_tokens": input.model.inputTokens } : {}),
      ...(input.model.outputTokens !== undefined ? { "zara.model_output_tokens": input.model.outputTokens } : {}),
      ...(input.model.promptProjectionBytes !== undefined
        ? { "zara.prompt_projection_bytes": input.model.promptProjectionBytes }
        : {}),
    }));
  }

  if (input.tts !== undefined) {
    spans.push(buildSpan("tts.synthesis", "turn.runtime", input.packet, {
      ...baseAttributes,
      "zara.tts_provider": input.tts.provider,
      ...(input.tts.latencyMs !== undefined ? { "zara.tts_latency_ms": input.tts.latencyMs } : {}),
    }));
  }

  spans.push(buildSpan("packet.finalized", "turn.runtime", input.packet, {
    ...baseAttributes,
    "zara.packet_sequence": input.packet.timing.sequence,
    "zara.policy_warning_count": input.packet.diagnostics.warnings.length,
  }));

  return {
    spans,
    ...(input.config.enabled && input.config.langsmith?.enabled === true
      ? {
          langsmithTrace: buildLangSmithTraceProjection(input),
        }
      : {}),
  };
}

export function buildPstnCallTraceExport(input: PstnCallTraceInput): PstnCallTraceExportPlan {
  const baseAttributes = buildPstnBaseAttributes(input);
  const metrics = buildPstnCallQualityMetrics(input.events);
  const spans: RuntimeTraceSpan[] = [
    buildPstnSpan("pstn.call.session", undefined, input, baseAttributes),
    ...input.events.map((event) => buildPstnSpanFromEvent(event, input, baseAttributes)),
  ];

  return {
    spans,
    metrics,
    ...(input.config.enabled && input.config.langsmith?.enabled === true
      ? { langsmithTrace: buildPstnLangSmithTraceProjection(input, metrics) }
      : {}),
  };
}

export function createRuntimeObservabilityRecorder(input: {
  config: RuntimeObservabilityConfig;
  spanExporter?: RuntimeSpanExporter | undefined;
  langsmithExporter?: RuntimeLangSmithExporter | undefined;
}): RuntimeObservabilityRecorder {
  return {
    async recordTurn(turn: Omit<RuntimeTraceExportInput, "config">): Promise<RuntimeObservabilityRecorderResult> {
      const exportPlan = buildRuntimeTraceExport({
        ...turn,
        config: input.config,
      });
      const warnings: RuntimeObservabilityRecorderResult["warnings"] = [];
      const metrics = {
        langsmithExportFailureCount: 0,
        spanExportFailureCount: 0,
        droppedSpanCount: 0,
      };
      let exportedSpanCount = 0;

      if (input.config.enabled && input.config.sinks.includes("opentelemetry")) {
        try {
          await input.spanExporter?.exportSpans(exportPlan.spans);
          exportedSpanCount = input.spanExporter === undefined ? 0 : exportPlan.spans.length;
        } catch (error) {
          metrics.spanExportFailureCount += 1;
          metrics.droppedSpanCount += exportPlan.spans.length;
          warnings.push({
            code: "opentelemetry.export_failed",
            message: readErrorMessage(error, "OpenTelemetry span export failed."),
            recoverable: true,
          });
        }
      }

      let langsmithExported = false;
      if (exportPlan.langsmithTrace !== undefined && input.config.sinks.includes("langsmith")) {
        try {
          await input.langsmithExporter?.exportTrace(exportPlan.langsmithTrace);
          langsmithExported = input.langsmithExporter !== undefined;
        } catch (error) {
          metrics.langsmithExportFailureCount += 1;
          warnings.push({
            code: "langsmith.export_failed",
            message: readErrorMessage(error, "LangSmith trace export failed."),
            recoverable: true,
          });
        }
      }

      return {
        exportedSpanCount,
        langsmithExported,
        warnings,
        metrics,
      };
    },
  };
}

export function createPstnCallObservabilityRecorder(input: {
  config: RuntimeObservabilityConfig;
  spanExporter?: RuntimeSpanExporter | undefined;
  langsmithExporter?: PstnCallLangSmithExporter | undefined;
}): PstnCallObservabilityRecorder {
  return {
    async recordPstnCall(call): Promise<RuntimeObservabilityRecorderResult> {
      const exportPlan = buildPstnCallTraceExport({
        ...call,
        config: input.config,
      });
      const warnings: RuntimeObservabilityRecorderResult["warnings"] = [];
      const metrics = {
        langsmithExportFailureCount: 0,
        spanExportFailureCount: 0,
        droppedSpanCount: 0,
      };
      let exportedSpanCount = 0;

      if (input.config.enabled && input.config.sinks.includes("opentelemetry")) {
        try {
          await input.spanExporter?.exportSpans(exportPlan.spans);
          exportedSpanCount = input.spanExporter === undefined ? 0 : exportPlan.spans.length;
        } catch (error) {
          metrics.spanExportFailureCount += 1;
          metrics.droppedSpanCount += exportPlan.spans.length;
          warnings.push({
            code: "opentelemetry.export_failed",
            message: readErrorMessage(error, "OpenTelemetry span export failed."),
            recoverable: true,
          });
        }
      }

      let langsmithExported = false;
      if (exportPlan.langsmithTrace !== undefined && input.config.sinks.includes("langsmith")) {
        try {
          await input.langsmithExporter?.exportTrace(exportPlan.langsmithTrace);
          langsmithExported = input.langsmithExporter !== undefined;
        } catch (error) {
          metrics.langsmithExportFailureCount += 1;
          warnings.push({
            code: "langsmith.export_failed",
            message: readErrorMessage(error, "LangSmith trace export failed."),
            recoverable: true,
          });
        }
      }

      return {
        exportedSpanCount,
        langsmithExported,
        warnings,
        metrics,
      };
    },
  };
}

export function createOpenTelemetryRuntimeSpanExporter(): RuntimeSpanExporter {
  const tracer = trace.getTracer("zara-runtime");

  return {
    async exportSpans(spans) {
      for (const runtimeSpan of spans) {
        const span = tracer.startSpan(runtimeSpan.name, {
          kind: SpanKind.INTERNAL,
          attributes: runtimeSpan.attributes,
        });
        span.end();
      }
    },
  };
}

export function configureOpenTelemetryRuntimeTracing(input: {
  config: RuntimeObservabilityConfig;
  env?: Record<string, string | undefined> | undefined;
}): RuntimeSpanExporter | undefined {
  if (!input.config.enabled || !input.config.sinks.includes("opentelemetry")) {
    return undefined;
  }

  const env = input.env ?? process.env;
  const otlpEndpoint = env["OTEL_EXPORTER_OTLP_ENDPOINT"]?.trim();
  const otlpHeaders = parseOtelHeaders(env["OTEL_EXPORTER_OTLP_HEADERS"]);
  const otlpExporter = new OTLPTraceExporter({
    ...(otlpEndpoint !== undefined && otlpEndpoint.length > 0 ? { url: otlpEndpoint } : {}),
    ...(otlpHeaders !== undefined ? { headers: otlpHeaders } : {}),
  });
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": input.config.serviceName,
      "service.version": input.config.releaseVersion,
      "deployment.environment.name": input.config.environment,
    }),
    spanProcessors: [new SimpleSpanProcessor(otlpExporter)],
  });

  provider.register();
  return createOpenTelemetryRuntimeSpanExporter();
}

export function createLangSmithRuntimeTraceExporter(input: {
  config: RuntimeObservabilityConfig;
  apiKey?: string | undefined;
  client?: unknown;
}): RuntimeLangSmithExporter | undefined {
  if (!input.config.enabled || input.config.langsmith?.enabled !== true) {
    return undefined;
  }

  const apiKey = input.apiKey?.trim();
  const client = input.client ?? new Client({
    ...(apiKey !== undefined && apiKey.length > 0 ? { apiKey } : {}),
    apiUrl: input.config.langsmith.endpoint,
  });

  return {
    async exportTrace(traceProjection) {
      const langsmithClient = client as {
        createRun(input: Record<string, unknown>): Promise<unknown>;
      };
      await langsmithClient.createRun({
        name: "zara.runtime.turn",
        run_type: "chain",
        project_name: input.config.langsmith?.project,
        inputs: traceProjection.inputs,
        outputs: {
          intent: traceProjection.intent,
          tools: traceProjection.tools,
          transfer: traceProjection.transfer,
          warnings: traceProjection.warnings,
        },
        extra: {
          metadata: {
            traceId: traceProjection.traceId,
            ids: traceProjection.ids,
            release: traceProjection.release,
            runtime: traceProjection.runtime,
            model: traceProjection.model,
            tts: traceProjection.tts,
          },
        },
      });
    },
  };
}

export function createLangSmithPstnCallTraceExporter(input: {
  config: RuntimeObservabilityConfig;
  apiKey?: string | undefined;
  client?: unknown;
}): PstnCallLangSmithExporter | undefined {
  if (!input.config.enabled || input.config.langsmith?.enabled !== true) {
    return undefined;
  }

  const apiKey = input.apiKey?.trim();
  const client = input.client ?? new Client({
    ...(apiKey !== undefined && apiKey.length > 0 ? { apiKey } : {}),
    apiUrl: input.config.langsmith.endpoint,
  });

  return {
    async exportTrace(traceProjection) {
      const langsmithClient = client as {
        createRun(input: Record<string, unknown>): Promise<unknown>;
      };
      await langsmithClient.createRun({
        name: "zara.pstn.call",
        run_type: "chain",
        project_name: input.config.langsmith?.project,
        inputs: {
          ids: traceProjection.ids,
          pstn: traceProjection.pstn,
        },
        outputs: {
          metrics: traceProjection.metrics,
          decisions: traceProjection.decisions,
          policyWarnings: traceProjection.policyWarnings,
        },
        extra: {
          metadata: {
            traceId: traceProjection.traceId,
            release: traceProjection.release,
            redaction: traceProjection.redaction,
            model: traceProjection.model,
            tts: traceProjection.tts,
          },
        },
      });
    },
  };
}

export function createConfiguredRuntimeObservabilityRecorder(
  env: Record<string, string | undefined> = process.env,
): RuntimeObservabilityRecorder {
  const config = resolveRuntimeObservabilityConfig(env);

  return createRuntimeObservabilityRecorder({
    config,
    spanExporter: configureOpenTelemetryRuntimeTracing({ config, env }),
    langsmithExporter: createLangSmithRuntimeTraceExporter({
      config,
      apiKey: env["LANGSMITH_API_KEY"],
    }),
  });
}

export function createConfiguredPstnCallObservabilityRecorder(
  env: Record<string, string | undefined> = process.env,
): PstnCallObservabilityRecorder {
  const config = resolveRuntimeObservabilityConfig(env);

  return createPstnCallObservabilityRecorder({
    config,
    spanExporter: configureOpenTelemetryRuntimeTracing({ config, env }),
    langsmithExporter: createLangSmithPstnCallTraceExporter({
      config,
      apiKey: env["LANGSMITH_API_KEY"],
    }),
  });
}

function buildBaseAttributes(input: RuntimeTraceExportInput): RuntimeTraceSpan["attributes"] {
  return {
    "zara.trace_id": input.traceId,
    "zara.organization_id": input.packet.ids.tenantId,
    "zara.workspace_id": input.packet.ids.workspaceId,
    "zara.call_session_id": input.packet.ids.callSessionId,
    "zara.turn_id": input.packet.ids.turnId,
    "zara.packet_id": buildPacketId(input.packet),
    "zara.manifest_id": input.packet.ids.manifestId,
    "zara.manifest_version": input.packet.ids.manifestVersion,
    "zara.published_workflow_version_id": input.manifest.publishedVersionId,
    "zara.runtime_profile": input.manifest.runtimeProfile,
    "zara.release_version": input.config.releaseVersion,
    "zara.service_name": input.config.serviceName,
    "zara.environment": input.config.environment,
  };
}

function buildPstnBaseAttributes(input: PstnCallTraceInput): RuntimeTraceSpan["attributes"] {
  return {
    "zara.trace_id": input.traceId,
    "zara.organization_id": input.call.organizationId,
    ...(input.call.workspaceId !== undefined ? { "zara.workspace_id": input.call.workspaceId } : {}),
    "zara.call_session_id": input.call.callSessionId,
    ...(input.call.phoneNumberId !== undefined ? { "zara.phone_number_id": input.call.phoneNumberId } : {}),
    ...(input.call.connectionId !== undefined ? { "zara.telephony_connection_id": input.call.connectionId } : {}),
    "zara.telephony_provider": input.call.provider,
    ...(input.call.routeMode !== undefined ? { "zara.route_mode": input.call.routeMode } : {}),
    ...(input.call.runtimeProfile !== undefined ? { "zara.runtime_profile": input.call.runtimeProfile } : {}),
    ...(input.call.publishedWorkflowVersionId !== undefined
      ? { "zara.published_workflow_version_id": input.call.publishedWorkflowVersionId }
      : {}),
    ...(input.call.mediaStreamId !== undefined ? { "zara.media_stream_id": input.call.mediaStreamId } : {}),
    "zara.runtime_path": "pstn-sandwich",
    "zara.release_version": input.config.releaseVersion,
    "zara.service_name": input.config.serviceName,
    "zara.environment": input.config.environment,
  };
}

function buildPstnSpan(
  name: string,
  parentName: string | undefined,
  input: PstnCallTraceInput,
  attributes: RuntimeTraceSpan["attributes"],
): RuntimeTraceSpan {
  const firstAt = input.events[0]?.at ?? new Date(0).toISOString();
  const lastAt = input.events.at(-1)?.at ?? firstAt;

  return {
    name,
    ...(parentName !== undefined ? { parentName } : {}),
    startedAt: firstAt,
    endedAt: lastAt,
    attributes,
  };
}

function buildPstnSpanFromEvent(
  event: PstnCallObservabilityEvent,
  input: PstnCallTraceInput,
  baseAttributes: RuntimeTraceSpan["attributes"],
): RuntimeTraceSpan {
  return {
    name: mapPstnEventToSpanName(event.type),
    parentName: "pstn.call.session",
    startedAt: event.at,
    endedAt: event.at,
    attributes: {
      ...baseAttributes,
      "zara.pstn_event_type": event.type,
      ...sanitizePstnSpanPayload(event.payload),
      ...(input.call.mediaStreamId !== undefined ? { "zara.media_stream_id": input.call.mediaStreamId } : {}),
    },
  };
}

function mapPstnEventToSpanName(type: PstnCallObservabilityEventType) {
  switch (type) {
    case "webhook.received":
      return "pstn.webhook.received";
    case "route.selected":
      return "pstn.route.selected";
    case "media.websocket_connected":
      return "pstn.media.websocket_connected";
    case "media.first_inbound_frame":
      return "pstn.media.first_inbound_frame";
    case "transcript.created":
      return "pstn.transcript.created";
    case "stt.reconnected":
      return "pstn.stt.reconnected";
    case "model.first_token":
      return "pstn.model.first_token";
    case "tts.first_byte":
      return "pstn.tts.first_byte";
    case "media.first_outbound_frame":
      return "pstn.media.first_outbound_frame";
    case "barge_in.clear":
      return "pstn.barge_in.clear";
    case "call.ended":
      return "pstn.call.ended";
    case "provider.failure":
      return "pstn.provider.failure";
    case "runtime.failure":
      return "pstn.runtime.failure";
  }
}

function sanitizePstnSpanPayload(payload: Record<string, unknown>): RuntimeTraceSpan["attributes"] {
  const attributes: RuntimeTraceSpan["attributes"] = {};
  const stringFields = [
    "routeMode",
    "targetNodeId",
    "provider",
    "modelId",
    "reason",
    "stage",
    "code",
    "stopReason",
    "classification",
  ];
  const numberFields = [
    "latencyMs",
    "thresholdMs",
    "frameSequence",
    "sequence",
    "durationMs",
  ];
  const booleanFields = [
    "recoverable",
    "successfulPhoneTest",
  ];

  for (const field of stringFields) {
    const value = payload[field];
    if (typeof value === "string") {
      attributes[`zara.${toSnakeCase(field)}`] = redactText(value);
    }
  }

  for (const field of numberFields) {
    const value = payload[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      attributes[`zara.${toSnakeCase(field)}`] = value;
    }
  }

  for (const field of booleanFields) {
    const value = payload[field];
    if (typeof value === "boolean") {
      attributes[`zara.${toSnakeCase(field)}`] = value;
    }
  }

  return attributes;
}

export function buildPstnCallQualityMetrics(events: PstnCallObservabilityEvent[]): PstnCallQualityMetrics {
  const firstOutboundFrame = events.find((event) => event.type === "media.first_outbound_frame");
  const firstResponseLatencyMs = readOptionalNumber(firstOutboundFrame?.payload["latencyMs"]);
  const endedEvents = events.filter((event) => event.type === "call.ended");
  const successfulTestCount = endedEvents.filter((event) => event.payload["successfulPhoneTest"] === true).length;
  const stopReasons = endedEvents.reduce<Record<string, number>>((accumulator, event) => {
    const stopReason = readOptionalString(event.payload["stopReason"]);
    if (stopReason !== undefined) {
      accumulator[stopReason] = (accumulator[stopReason] ?? 0) + 1;
    }
    return accumulator;
  }, {});

  return {
    ...(firstResponseLatencyMs !== undefined
      ? {
          firstResponseLatencyMs,
          firstResponseLatencyClassification: classifyPstnFirstResponseLatency(firstResponseLatencyMs),
        }
      : {}),
    noFrameTimeoutCount: countPstnCode(events, "media_no_frame_timeout"),
    sttReconnectCount: events.filter((event) => event.type === "stt.reconnected").length,
    ttsFirstByteTimeoutCount: countPstnCode(events, "tts_first_byte_timeout"),
    modelTimeoutCount: events.filter((event) =>
      event.type === "runtime.failure"
      && readOptionalString(event.payload["stage"]) === "model"
      && (readOptionalString(event.payload["code"]) === "timeout" || readOptionalString(event.payload["code"]) === "model_timeout"),
    ).length,
    bridgeErrorCount: events.filter((event) =>
      event.type === "provider.failure"
      && (
        readOptionalString(event.payload["stage"]) === "bridge"
        || readOptionalString(event.payload["code"])?.startsWith("twilio_media.") === true
      ),
    ).length,
    bargeInCount: events.filter((event) => event.type === "barge_in.clear").length,
    ...(endedEvents.length > 0 ? { successfulPhoneTestRate: successfulTestCount / endedEvents.length } : {}),
    twilioStopReasons: stopReasons,
  };
}

function buildPstnLangSmithTraceProjection(
  input: PstnCallTraceInput,
  metrics: PstnCallQualityMetrics,
): LangSmithPstnTraceProjection {
  const modelEvent = input.events.find((event) => event.type === "model.first_token");
  const ttsEvent = input.events.find((event) => event.type === "tts.first_byte");

  return {
    traceId: input.traceId,
    ids: {
      organizationId: input.call.organizationId,
      ...(input.call.workspaceId !== undefined ? { workspaceId: input.call.workspaceId } : {}),
      callSessionId: input.call.callSessionId,
      ...(input.call.phoneNumberId !== undefined ? { phoneNumberId: input.call.phoneNumberId } : {}),
      ...(input.call.connectionId !== undefined ? { connectionId: input.call.connectionId } : {}),
      ...(input.call.mediaStreamId !== undefined ? { mediaStreamId: input.call.mediaStreamId } : {}),
      ...(input.call.publishedWorkflowVersionId !== undefined
        ? { publishedWorkflowVersionId: input.call.publishedWorkflowVersionId }
        : {}),
    },
    release: {
      environment: input.config.environment,
      version: input.config.releaseVersion,
    },
    pstn: {
      provider: input.call.provider,
      ...(input.call.routeMode !== undefined ? { routeMode: input.call.routeMode } : {}),
      ...(input.call.runtimeProfile !== undefined ? { runtimeProfile: input.call.runtimeProfile } : {}),
      runtimePath: "pstn-sandwich",
    },
    ...(modelEvent !== undefined
      ? {
          model: {
            provider: readOptionalString(modelEvent.payload["provider"]),
            modelId: readOptionalString(modelEvent.payload["modelId"]),
            latencyMs: readOptionalNumber(modelEvent.payload["latencyMs"]),
          },
        }
      : {}),
    ...(ttsEvent !== undefined
      ? {
          tts: {
            provider: readOptionalString(ttsEvent.payload["provider"]),
            latencyMs: readOptionalNumber(ttsEvent.payload["latencyMs"]),
          },
        }
      : {}),
    metrics,
    decisions: input.events
      .filter((event) => event.type === "route.selected" || event.type === "model.first_token" || event.type === "tts.first_byte")
      .map((event) => ({
        type: event.type,
        at: event.at,
        attributes: sanitizePstnSpanPayload(event.payload),
      })),
    policyWarnings: input.events
      .filter((event) => event.type === "provider.failure" || event.type === "runtime.failure")
      .map((event) => ({
        code: readOptionalString(event.payload["code"]) ?? "unknown",
        recoverable: event.payload["recoverable"] === true,
      })),
    redaction: {
      state: "redacted",
      omitted: ["raw_audio", "raw_transcript", "caller_number", "secrets", "raw_tool_output"],
    },
  };
}

export function classifyPstnFirstResponseLatency(latencyMs: number): "good" | "warning" | "critical" {
  if (latencyMs <= 1500) {
    return "good";
  }

  if (latencyMs <= 3000) {
    return "warning";
  }

  return "critical";
}

function countPstnCode(events: PstnCallObservabilityEvent[], code: string) {
  return events.filter((event) => readOptionalString(event.payload["code"]) === code).length;
}

function buildPacketEventSpans(
  packet: TurnRuntimePacket,
  baseAttributes: RuntimeTraceSpan["attributes"],
): RuntimeTraceSpan[] {
  return packet.diagnostics.events.flatMap((event) => {
    switch (event.type) {
      case "node.visited":
        return [
          buildSpanFromEvent("graph.node_visited", event, baseAttributes, {
            "zara.graph_node_id": event.nodeId ?? "",
            "zara.graph_node_kind": readString(event.payload["nodeKind"]),
          }),
        ];
      case "intent.classified":
        return [
          buildSpanFromEvent("intent.classified", event, baseAttributes, {
            "zara.intent_key": readNullableString(event.payload["intentKey"]),
            "zara.intent_branch_id": readNullableString(event.payload["matchedBranchId"]),
            "zara.intent_target_node_id": readString(event.payload["targetNodeId"]),
            "zara.intent_confidence": readNumber(event.payload["confidence"]),
            "zara.intent_used_fallback": readBoolean(event.payload["usedFallback"]),
          }),
        ];
      case "tool.requested":
        return [
          buildSpanFromEvent("tool.selection", event, baseAttributes, {
            "zara.tool_call_id": readString(event.payload["toolCallId"]),
            "zara.tool_assignment_id": readString(event.payload["toolAssignmentId"]),
          }),
        ];
      case "tool.completed":
      case "tool.failed":
      case "tool.approval_required":
        return [
          buildSpanFromEvent("tool.execution", event, baseAttributes, {
            "zara.tool_call_id": readString(event.payload["toolCallId"]),
            "zara.tool_assignment_id": readString(event.payload["toolAssignmentId"]),
            "zara.tool_id": readString(event.payload["toolId"]),
            "zara.tool_name": readString(event.payload["toolName"]),
            "zara.tool_status": readString(event.payload["status"]),
            "zara.tool_duration_ms": readNumber(event.payload["durationMs"]),
            "zara.tool_retryable": readRecoverable(event.payload["error"]),
          }),
        ];
      case "transfer.created":
        return [
          buildSpanFromEvent("transfer.created", event, baseAttributes, {
            "zara.transfer_id": readString(event.payload["transferId"]),
            "zara.transfer_source_agent_id": readString(event.payload["sourceAgentId"]),
            "zara.transfer_target_agent_id": readString(event.payload["targetAgentId"]),
          }),
        ];
      default:
        return [];
    }
  });
}

function buildLangSmithTraceProjection(input: RuntimeTraceExportInput): LangSmithRuntimeTraceProjection {
  return {
    traceId: input.traceId,
    ids: {
      organizationId: input.packet.ids.tenantId,
      workspaceId: input.packet.ids.workspaceId,
      callSessionId: input.packet.ids.callSessionId,
      turnId: input.packet.ids.turnId,
      packetId: buildPacketId(input.packet),
      manifestId: input.packet.ids.manifestId,
      manifestVersion: input.packet.ids.manifestVersion,
      publishedWorkflowVersionId: input.manifest.publishedVersionId,
    },
    release: {
      environment: input.config.environment,
      version: input.config.releaseVersion,
    },
    runtime: {
      profile: input.manifest.runtimeProfile,
      serviceName: input.config.serviceName,
    },
    inputs: {
      source: input.packet.callerInput.source,
      ...(input.packet.callerInput.language !== undefined ? { language: input.packet.callerInput.language } : {}),
      ...(input.config.redaction.includeTranscriptText === "never"
        ? {}
        : { latestCallerTurn: redactText(input.packet.callerInput.latestCallerTurn) }),
    },
    ...(input.packet.intent !== undefined
      ? {
          intent: {
            intentKey: input.packet.intent.intentKey,
            selectedBranchId: input.packet.intent.matchedBranchId,
            selectedTargetNodeId: input.packet.intent.targetNodeId,
            confidence: input.packet.intent.confidence,
            usedFallback: input.packet.intent.usedFallback,
            reason: redactText(input.packet.intent.reason),
          },
        }
      : {}),
    tools: input.packet.toolCalls.map((toolCall) => ({
      toolCallId: toolCall.request.toolCallId,
      toolAssignmentId: toolCall.request.toolAssignmentId,
      ...(toolCall.result?.toolId !== undefined ? { toolId: toolCall.result.toolId } : {}),
      ...(toolCall.result?.toolName !== undefined ? { toolName: toolCall.result.toolName } : {}),
      ...(toolCall.result?.status !== undefined ? { status: toolCall.result.status } : {}),
      ...(toolCall.result?.summary !== undefined ? { summary: redactText(toolCall.result.summary) } : {}),
      ...(input.config.redaction.includeToolOutput === "safe_output" && toolCall.result?.safeOutput !== undefined
        ? { safeOutput: redactRecord(toolCall.result.safeOutput) }
        : {}),
      ...(toolCall.result?.error?.code !== undefined ? { errorCode: toolCall.result.error.code } : {}),
      ...(toolCall.result?.error?.recoverable !== undefined ? { recoverable: toolCall.result.error.recoverable } : {}),
    })),
    ...(input.packet.transfer !== undefined
      ? {
          transfer: {
            transferId: input.packet.transfer.transferId,
            sourceAgentId: input.packet.transfer.sourceAgent.id,
            targetAgentId: input.packet.transfer.targetAgent.id,
            ...(input.packet.transfer.matchedIntent !== undefined
              ? { matchedIntentKey: input.packet.transfer.matchedIntent.intentKey }
              : {}),
            reason: redactText(input.packet.transfer.reason),
          },
        }
      : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.tts !== undefined ? { tts: input.tts } : {}),
    warnings: input.packet.diagnostics.warnings.map((warning) => ({
      code: warning.code,
      recoverable: warning.recoverable,
    })),
  };
}

function buildSpan(
  name: string,
  parentName: string | undefined,
  packet: TurnRuntimePacket,
  attributes: RuntimeTraceSpan["attributes"],
): RuntimeTraceSpan {
  return {
    name,
    ...(parentName !== undefined ? { parentName } : {}),
    startedAt: packet.timing.startedAt,
    endedAt: packet.timing.startedAt,
    attributes,
  };
}

function buildSpanFromEvent(
  name: string,
  event: RuntimePacketEvent,
  baseAttributes: RuntimeTraceSpan["attributes"],
  attributes: RuntimeTraceSpan["attributes"],
): RuntimeTraceSpan {
  return {
    name,
    parentName: "turn.runtime",
    startedAt: event.at,
    endedAt: event.at,
    attributes: {
      ...baseAttributes,
      ...attributes,
      "zara.packet_sequence": event.sequence,
    },
  };
}

function buildPacketId(packet: TurnRuntimePacket) {
  return `${packet.ids.callSessionId}:${packet.ids.turnId}`;
}

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, redactValue(value)]),
  );
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactText(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (typeof value === "object" && value !== null) {
    return redactRecord(value as Record<string, unknown>);
  }

  return value;
}

function redactText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-payment-card]")
    .replace(/\+[1-9]\d{7,14}\b/g, "[redacted-phone]")
    .replace(/secret:\/\/[^\s)]+/gi, "[redacted-secret]")
    .replace(/\b(password|token|api key)\s*[:=]\s*[^\s]+/gi, "$1=[redacted-secret]");
}

function readEnvironment(value: string | undefined): RuntimeObservabilityConfig["environment"] {
  if (value === "production" || value === "staging" || value === "test") {
    return value;
  }

  return "local";
}

function readSampleRate(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "1");

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(1, Math.max(0, parsed));
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? redactText(value) : undefined;
}

function readBoolean(value: unknown) {
  return value === true;
}

function readRecoverable(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (value as { recoverable?: unknown }).recoverable === true;
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function parseOtelHeaders(value: string | undefined): Record<string, string> | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .flatMap((entry) => {
        const separatorIndex = entry.indexOf("=");

        if (separatorIndex <= 0) {
          return [];
        }

        return [[entry.slice(0, separatorIndex).trim(), entry.slice(separatorIndex + 1).trim()]];
      }),
  );
}

function toSnakeCase(value: string) {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}
