import type {
  CallEvent,
  ID,
  AgentVoiceConfig,
  ModelRoutingRule,
  ModelTier,
  RealtimeProviderId,
  RealtimeVoiceConfig,
  RuntimeProfileId,
  RuntimeCallPhase,
  RuntimeManifest,
  RuntimeTtsVoice,
  TelemetryPolicy,
  TelephonyOwnershipMode,
  TelephonyProvider,
  ToolDefinition,
  VoiceRuntimeKind,
  VoiceAgentRole,
  WorkflowNode,
} from "./index";
import {
  createWorkflowGraph,
  runtimeManifestPreviewSchemaVersion,
  serializeWorkflowGraph,
  type DraftWorkflowConditionRoute,
  type DraftWorkflowEscalationPolicy,
  type DraftWorkflowExitNode,
  type DraftWorkflowAgentRoutePolicy,
  type DraftWorkflowReturnRoute,
  type AgentRoleNodeConfig,
  type PublishedWorkflowVersion,
  type RuntimeManifestPreview,
  type RuntimeManifestPreviewBudgetConfig,
  type RuntimeManifestPreviewMemoryConfig,
  type ToolNodeConfig,
  type ToolRequestConfig,
} from "./workflow";
import {
  resolveRuntimeAgent,
  type RuntimeAgentDefinition,
} from "./agent-runtime-context";
import type { AgentToolAssignment, AgentTurnContext } from "./turn-runtime-packet";
import {
  buildRealtimeProviderToolDeclarations,
  type RealtimeProviderToolDeclaration,
} from "./realtime-tool-bridge";

export type RuntimeManifestCompileErrorCode =
  | "runtime.unsupported_manifest_schema"
  | "runtime.missing_entry_agent"
  | "runtime.missing_tool_definition"
  | "runtime.missing_integration_connection"
  | "runtime.missing_escalation_queue"
  | "runtime.missing_model_routing"
  | "runtime.missing_telemetry_sink";

export class RuntimeManifestCompileError extends Error {
  code: RuntimeManifestCompileErrorCode;

  constructor(code: RuntimeManifestCompileErrorCode, message: string) {
    super(message);
    this.name = "RuntimeManifestCompileError";
    this.code = code;
  }
}

export interface CompiledRuntimeToolBinding {
  nodeId: ID;
  label: string;
  toolId: ID;
  connector: ToolDefinition["connector"];
  toolName: string;
  integrationConnectionId?: ID | undefined;
  integrationLabel?: string | undefined;
  risk: ToolDefinition["risk"];
  requiresHumanApproval: boolean;
  request?: ToolRequestConfig | undefined;
  tool: ToolDefinition;
}

export interface CompiledRuntimeAgentToolAssignment extends AgentToolAssignment {
  roleId: ID;
}

export interface CompiledRuntimeManifest extends RuntimeManifest {
  version: number;
  runtimeProfile: RuntimeProfileId;
  telephonyOwnership: TelephonyOwnershipMode;
  telephonyConnectionId?: ID | undefined;
  entryNodeId: ID;
  toolBindings: CompiledRuntimeToolBinding[];
  agentToolAssignments: CompiledRuntimeAgentToolAssignment[];
  conditions: DraftWorkflowConditionRoute[];
  routePolicies: DraftWorkflowAgentRoutePolicy[];
  exitNodes: DraftWorkflowExitNode[];
  returnRoutes?: DraftWorkflowReturnRoute[] | undefined;
  escalationNode: DraftWorkflowEscalationPolicy | null;
  memory: RuntimeManifestPreviewMemoryConfig;
  budget: RuntimeManifestPreviewBudgetConfig;
  serializedGraph: string;
  compiledDefinitionHash: string;
}

export interface CompileRuntimeManifestInput {
  publishedVersion: PublishedWorkflowVersion;
  modelRouting: ModelRoutingRule[];
  telemetry: TelemetryPolicy;
  telephonyProvider?: TelephonyProvider | undefined;
  telephonyOwnership?: TelephonyOwnershipMode | undefined;
  telephonyConnectionId?: ID | undefined;
  availableIntegrationConnectionIds?: ID[] | undefined;
  availableEscalationQueueIds?: ID[] | undefined;
}

export interface ModelRoutingContext {
  intent?: string | undefined;
  callPhase: RuntimeCallPhase;
  confidence?: number | undefined;
  language?: string | undefined;
  toolRisk?: ToolDefinition["risk"] | undefined;
  requestedToolId?: ID | undefined;
}

export type ModelRoutingDecisionSource = "rule" | "agent_default" | "profile_default" | "safety_override";

export interface ModelRoutingDecisionLog {
  tier: ModelTier;
  source: ModelRoutingDecisionSource;
  matchedRuleId?: ID | undefined;
  reason: string;
  context: {
    activeAgentId: ID;
    intent?: string | undefined;
    callPhase: RuntimeCallPhase;
    confidence: number;
    language: string;
    risk?: ToolDefinition["risk"] | undefined;
    requestedToolId?: ID | undefined;
  };
}

export interface ModelRoutingDecision {
  tier: ModelTier;
  source: ModelRoutingDecisionSource;
  matchedRuleId?: ID | undefined;
  reason: string;
  log: ModelRoutingDecisionLog;
}

export type RuntimeFailureStage = "stt" | "model" | "tts";
export type RuntimeFailureCode = "timeout" | "interrupted" | "failed" | "rate_limited" | "permission_denied";

export class RuntimeProviderFailure extends Error {
  stage: RuntimeFailureStage;
  code: RuntimeFailureCode;

  constructor(stage: RuntimeFailureStage, code: RuntimeFailureCode, message: string) {
    super(message);
    this.name = "RuntimeProviderFailure";
    this.stage = stage;
    this.code = code;
  }
}

export interface SandwichTranscriptionResult {
  transcript: string;
  confidence: number;
  language: string;
}

export interface SandwichTtsResult {
  firstByteLatencyMs: number;
  codec?: {
    name: string;
    sampleRateHz: number;
    channels: number;
  } | undefined;
  audio: AsyncIterable<string>;
  wordTimestamps?: Array<{
    word: string;
    start: number;
    end: number;
  }> | undefined;
}

export interface SandwichTtsSynthesisBaseInput {
  manifest: CompiledRuntimeManifest;
  activeAgent: RuntimeAgentDefinition;
  language: string;
  voiceProfile: RuntimeTtsVoice;
  voiceConfig?: AgentVoiceConfig | undefined;
  context: ModelRoutingContext;
  abortSignal?: AbortSignal | undefined;
}

export interface SandwichTtsSynthesisInput extends SandwichTtsSynthesisBaseInput {
  text: string;
}

export interface SandwichStreamingTtsSynthesisInput extends SandwichTtsSynthesisBaseInput {
  textStream: AsyncIterable<string>;
}

export interface SandwichSttProvider {
  transcribe(input: {
    audioFrames: string[];
    manifest: CompiledRuntimeManifest;
    activeAgent: RuntimeAgentDefinition;
    context: ModelRoutingContext;
  }): Promise<SandwichTranscriptionResult>;
}

export interface SandwichTextModelProvider {
  streamText(input: {
    manifest: CompiledRuntimeManifest;
    activeAgent: RuntimeAgentDefinition;
    transcript: string;
    tier: ModelTier;
    context: ModelRoutingContext;
    agentContext?: AgentTurnContext | undefined;
    agentActionMode?: boolean | undefined;
    untrustedContext?: RuntimeUntrustedContextItem[] | undefined;
  }): AsyncIterable<string>;
}

export type RuntimeUntrustedContextSource =
  | "tool_output"
  | "tenant_knowledge"
  | "memory"
  | "crm_note"
  | "website";

export interface RuntimeUntrustedContextItem {
  source: RuntimeUntrustedContextSource;
  label: string;
  content: string;
}

export interface SandwichTtsProvider {
  warm?(): void | Promise<void>;
  synthesize(input: SandwichTtsSynthesisInput): Promise<SandwichTtsResult>;
  synthesizeStreaming?(input: SandwichStreamingTtsSynthesisInput): Promise<SandwichTtsResult>;
}

export interface CostOptimizedSandwichRuntimeTurnInput {
  callSessionId: ID;
  manifest: CompiledRuntimeManifest;
  activeAgentId: ID;
  audioFrames: string[];
  context: ModelRoutingContext;
  untrustedContext?: RuntimeUntrustedContextItem[] | undefined;
  onAudioChunk?: ((
    chunk: string,
    index: number,
    telemetry: { firstByteLatencyMs: number },
  ) => void | Promise<void>) | undefined;
}

export interface CostOptimizedSandwichRuntimeTurnResult {
  transcript: string;
  responseText: string;
  audioChunks: string[];
  audioWordTimestamps?: SandwichTtsResult["wordTimestamps"] | undefined;
  events: CallEvent[];
  routingDecision: ModelRoutingDecision;
  degraded: boolean;
  failureStage?: RuntimeFailureStage | undefined;
}

export interface CostOptimizedSandwichRuntimeAdapter {
  runTurn(input: CostOptimizedSandwichRuntimeTurnInput): Promise<CostOptimizedSandwichRuntimeTurnResult>;
}

export interface CreateCostOptimizedSandwichRuntimeAdapterInput {
  stt: SandwichSttProvider;
  model: SandwichTextModelProvider;
  tts: SandwichTtsProvider;
  firstByteDelayThresholdMs?: number | undefined;
  now?: (() => string) | undefined;
  createEventId?: ((type: CallEvent["type"], index: number) => ID) | undefined;
}

export interface StreamedCallEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> extends CallEvent<TPayload> {
  sequence: number;
  cursor: string;
}

export interface CallEventStreamPublishResult {
  accepted: number;
  duplicates: number;
  lastSequence: number;
}

export interface CallEventReplayOptions {
  afterSequence?: number | undefined;
  limit?: number | undefined;
}

export interface CallEventStream {
  publish(
    input: CallEvent | CallEvent[],
  ): CallEventStreamPublishResult;
  subscribe(
    listener: (events: StreamedCallEvent[]) => void,
    options?: CallEventReplayOptions,
  ): () => void;
  replay(options?: CallEventReplayOptions): StreamedCallEvent[];
  size(): number;
}

export interface RuntimeUsageMetrics {
  callMinutes: number;
  sttMinutes: number;
  modelInputTokens: number;
  modelOutputTokens: number;
  ttsCharacters: number;
  storageMb: number;
}

export interface RuntimePricingCatalog {
  telephonyPerMinuteUsd: Partial<Record<TelephonyProvider, number>>;
  sttPerMinuteUsd?: number | undefined;
  modelPer1kInputTokensUsd: Partial<Record<ModelTier, number>>;
  modelPer1kOutputTokensUsd: Partial<Record<ModelTier, number>>;
  ttsPer1kCharactersUsd?: number | undefined;
  storagePerMbUsd?: number | undefined;
}

export type RuntimeCostComponentKind =
  | "telephony"
  | "stt"
  | "model_input"
  | "model_output"
  | "tts"
  | "storage";

export interface RuntimeCostComponent {
  kind: RuntimeCostComponentKind;
  units: number;
  totalUsd: number;
  unitRateUsd?: number | undefined;
  missingPrice: boolean;
}

export interface RuntimeCostEstimate {
  tenantId: ID;
  callSessionId?: ID | undefined;
  currency: "USD";
  modelTier: ModelTier;
  totalUsd: number;
  complete: boolean;
  missingPrices: string[];
  components: RuntimeCostComponent[];
  usage: RuntimeUsageMetrics;
}

export interface ResolvedRuntimeProfilePolicy {
  id: RuntimeProfileId;
  runtime: VoiceRuntimeKind;
  routingFloor: ModelTier;
  ttsVoice: RuntimeTtsVoice;
  modelCostMultiplier: number;
  ttsCostMultiplier: number;
  requiresServerSession: boolean;
}

export interface PremiumRealtimeSession {
  sessionId: ID;
  manifestId: ID;
  publishedVersionId: ID;
  activeAgentId: ID;
  runtime: RealtimeProviderId;
  policy: "premium-realtime";
  model: string;
  voice: RuntimeTtsVoice;
  transportUrl: string;
  expiresAt: string;
  toolDeclarations: RealtimeProviderToolDeclaration[];
  observedEventTypes: Array<
    | "tool.requested"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "tool.approval_required"
    | "agent.handoff.requested"
    | "agent.handoff.completed"
  >;
}

export type PremiumRealtimeObservedAction =
  | {
      type: "tool";
      nodeId: ID;
      toolId: ID;
      summary: string;
    }
  | {
      type: "handoff";
      nodeId: ID;
      sourceAgentId: ID;
      targetAgentId: ID;
      targetAgentName: string;
    };

const runtimeProfileCatalog: Record<RuntimeProfileId, ResolvedRuntimeProfilePolicy> = {
  "cost-optimized": {
    id: "cost-optimized",
    runtime: "sandwich-pipeline",
    routingFloor: "cheap",
    ttsVoice: "economy",
    modelCostMultiplier: 1,
    ttsCostMultiplier: 1,
    requiresServerSession: false,
  },
  balanced: {
    id: "balanced",
    runtime: "sandwich-pipeline",
    routingFloor: "standard",
    ttsVoice: "neural-hd",
    modelCostMultiplier: 1.4,
    ttsCostMultiplier: 1.3,
    requiresServerSession: false,
  },
  "premium-realtime": {
    id: "premium-realtime",
    runtime: "openai-realtime",
    routingFloor: "standard",
    ttsVoice: "expressive",
    modelCostMultiplier: 1.9,
    ttsCostMultiplier: 1.8,
    requiresServerSession: true,
  },
};

export interface EvaluateRuntimeBudgetInput {
  manifest: CompiledRuntimeManifest;
  estimate: RuntimeCostEstimate;
  stage: "publish" | "call_start";
  reservationMinutes?: number | undefined;
}

export interface RuntimeBudgetDecision {
  allowed: boolean;
  stage: "publish" | "call_start";
  reason: string;
  projectedSpendUsd: number;
  reservedAdditionalCostUsd: number;
  overageUsd: number;
}

export type SandboxCallMode = "microphone" | "typed";
export type SandboxMicrophonePermission = "granted" | "denied";
export type SandboxCallStatus = "idle" | "active" | "blocked" | "ended";
export type SandboxTranscriptSpeaker = "caller" | "agent" | "system";

export interface SandboxTranscriptEntry {
  id: ID;
  speaker: SandboxTranscriptSpeaker;
  text: string;
  at: string;
}

export interface SandboxSessionMetrics {
  turnCount: number;
  toolCallCount: number;
  estimatedCostUsd: number;
  eventCount: number;
  durationMs: number;
  currentTier?: ModelTier | undefined;
  lastFirstByteLatencyMs?: number | undefined;
}

export interface SandboxToolExecutionResult {
  summary: string;
  output: Record<string, unknown>;
}

export interface SandboxToolExecutionInput {
  callSessionId: ID;
  manifest: CompiledRuntimeManifest;
  binding: CompiledRuntimeToolBinding;
  payload: Record<string, unknown>;
}

export type SandboxToolHandler = (
  input: SandboxToolExecutionInput,
) => Promise<SandboxToolExecutionResult>;

export interface SandboxCallSessionStartResult {
  status: SandboxCallStatus;
  mode: SandboxCallMode;
}

export interface SandboxCallSessionEndResult {
  status: SandboxCallStatus;
  disposition: string;
}

export interface SandboxCallerTurnInput {
  activeAgentId: ID;
  audioFrames: string[];
  context: ModelRoutingContext;
  durationMs?: number | undefined;
}

export interface SandboxCallerTurnResult extends CostOptimizedSandwichRuntimeTurnResult {
  costEstimate: RuntimeCostEstimate;
}

export interface SandboxInvokeToolInput {
  nodeId: ID;
  payload: Record<string, unknown>;
}

export interface CreateSandboxCallSessionInput {
  callSessionId: ID;
  manifest: CompiledRuntimeManifest;
  runtime: CostOptimizedSandwichRuntimeAdapter;
  pricing: RuntimePricingCatalog;
  eventStream?: CallEventStream | undefined;
  toolRegistry?: Record<ID, SandboxToolHandler> | undefined;
  now?: (() => string) | undefined;
  createEventId?: ((type: CallEvent["type"], index: number) => ID) | undefined;
}

export interface SandboxCallSession {
  start(input: {
    microphonePermission: SandboxMicrophonePermission;
    mode: SandboxCallMode;
  }): SandboxCallSessionStartResult;
  sendCallerTurn(input: SandboxCallerTurnInput): Promise<SandboxCallerTurnResult>;
  invokeTool(input: SandboxInvokeToolInput): Promise<SandboxToolExecutionResult>;
  end(input: { disposition: string }): SandboxCallSessionEndResult;
  getTranscript(): SandboxTranscriptEntry[];
  getMetrics(): SandboxSessionMetrics;
  replayEvents(options?: CallEventReplayOptions): StreamedCallEvent[];
  subscribeToEvents(
    listener: (events: StreamedCallEvent[]) => void,
    options?: CallEventReplayOptions,
  ): () => void;
}

export function compileRuntimeManifest(
  input: CompileRuntimeManifestInput,
): CompiledRuntimeManifest {
  const { publishedVersion } = input;
  const graph = createWorkflowGraph(publishedVersion.graph);
  const preview = publishedVersion.manifestPreview;

  if (preview.schemaVersion !== runtimeManifestPreviewSchemaVersion) {
    throw new RuntimeManifestCompileError(
      "runtime.unsupported_manifest_schema",
      `Published workflow '${publishedVersion.id}' uses an unsupported runtime manifest preview schema.`,
    );
  }
  rejectLegacyHandoffManifestPreview(publishedVersion.id, preview);

  const entryNodeId = preview.entryNodeId;
  const entryAgentId = preview.entryAgentId;

  if (entryNodeId === undefined || entryAgentId === undefined) {
    throw new RuntimeManifestCompileError(
      "runtime.missing_entry_agent",
      `Published workflow '${publishedVersion.id}' is missing an entry agent.`,
    );
  }

  const modelRouting = normalizeModelRoutingRules(input.modelRouting);
  if (modelRouting.length === 0) {
    throw new RuntimeManifestCompileError(
      "runtime.missing_model_routing",
      `Published workflow '${publishedVersion.id}' has no model routing policy.`,
    );
  }

  const telemetry = cloneTelemetryPolicy(input.telemetry);
  if (telemetry.sinks.length === 0) {
    throw new RuntimeManifestCompileError(
      "runtime.missing_telemetry_sink",
      `Published workflow '${publishedVersion.id}' must configure at least one telemetry sink.`,
    );
  }

  const roles = cloneRoles(publishedVersion.roles);
  const tools = cloneTools(publishedVersion.tools);
  const toolMap = new Map(tools.map((tool) => [tool.id, tool]));
  const hasIntegrationConnectionRegistry = input.availableIntegrationConnectionIds !== undefined;
  const availableIntegrationConnectionIds = new Set(input.availableIntegrationConnectionIds ?? []);
  const hasEscalationQueueRegistry = input.availableEscalationQueueIds !== undefined;
  const availableEscalationQueueIds = new Set(input.availableEscalationQueueIds ?? []);

  const toolBindings = graph.nodes
    .filter((node) => node.kind === "tool")
    .flatMap((node) =>
      buildCompiledToolBinding(
        node,
        toolMap,
        hasIntegrationConnectionRegistry,
        availableIntegrationConnectionIds,
      ))
    .sort(compareByNodeId);
  const agentToolAssignments = buildCompiledAgentToolAssignments(graph, toolBindings);

  const conditions = preview.conditions.map(cloneConditionRoute).sort(compareByNodeId);
  const routePolicies = preview.routePolicies.map(cloneAgentRoutePolicy).sort(compareBySourceAgentId);
  const exitNodes = preview.exitNodes.map(cloneExitNode).sort(compareByNodeId);
  const returnRoutes = (preview.returnRoutes ?? []).map(cloneReturnRoute).sort(compareByEdgeId);
  const escalationNode = preview.escalation === null ? null : cloneEscalationNode(preview.escalation);

  if (
    escalationNode !== null
    && hasEscalationQueueRegistry
    && escalationNode.queueId !== undefined
    && availableEscalationQueueIds.has(escalationNode.queueId) === false
  ) {
    throw new RuntimeManifestCompileError(
      "runtime.missing_escalation_queue",
      `Escalation node '${escalationNode.nodeId}' references unavailable queue '${escalationNode.queueId}'.`,
    );
  }

  const escalation = escalationNode === null
    ? {
        enabled: false,
        fallbackMode: "callback" as const,
        triggers: [],
        fallbackMessage: "",
      }
    : {
        enabled: escalationNode.enabled,
        ...(escalationNode.queueId !== undefined ? { queueId: escalationNode.queueId } : {}),
        fallbackMode: escalationNode.fallbackMode,
        triggers: [...escalationNode.triggers],
        fallbackMessage: escalationNode.fallbackMessage,
      };

  const memory = cloneMemoryConfig(preview.memory);
  const budget = cloneBudgetConfig(preview.budget);
  const serializedGraph = publishedVersion.serializedGraph || serializeWorkflowGraph(graph);
  const compiledDefinitionHash = hashStableString(
    stableStringify({
      publishedVersionId: publishedVersion.id,
      workflowId: publishedVersion.manifestPreview.workflowId,
      workspaceId: publishedVersion.workspaceId,
      runtime: preview.runtime,
      telephonyProvider: input.telephonyProvider ?? preview.telephonyProvider,
      telephonyOwnership: input.telephonyOwnership ?? "platform",
      telephonyConnectionId: input.telephonyConnectionId,
      entryNodeId,
      entryAgentId,
      toolBindings,
      conditions,
      routePolicies,
      exitNodes,
      returnRoutes,
      agentToolAssignments,
      escalationNode,
      modelRouting,
      memory,
      budget,
      telemetry,
      serializedGraph,
    }),
  );

  return {
    tenantId: publishedVersion.tenantId,
    environment: preview.environment,
    manifestId: `${publishedVersion.id}:runtime:${compiledDefinitionHash}`,
    publishedVersionId: publishedVersion.id,
    workflowId: publishedVersion.manifestPreview.workflowId,
    ...(publishedVersion.workspaceId !== undefined ? { workspaceId: publishedVersion.workspaceId } : {}),
    version: publishedVersion.version,
    runtime: preview.runtime,
    runtimeProfile: preview.runtimeProfile,
    telephonyProvider: input.telephonyProvider ?? preview.telephonyProvider,
    telephonyOwnership: input.telephonyOwnership ?? "platform",
    ...(input.telephonyConnectionId !== undefined
      ? { telephonyConnectionId: input.telephonyConnectionId }
      : {}),
    entryNodeId,
    entryAgentId,
    roles,
    tools,
    graph,
    modelRouting,
    toolBindings,
    agentToolAssignments,
    conditions,
    routePolicies,
    exitNodes,
    returnRoutes,
    escalation,
    escalationNode,
    telemetry,
    memory,
    budget,
    serializedGraph,
    compiledDefinitionHash,
  };
}

function rejectLegacyHandoffManifestPreview(
  publishedVersionId: string,
  preview: RuntimeManifestPreview,
): void {
  const legacyPreview = preview as RuntimeManifestPreview & { handoffs?: unknown };

  if (Object.prototype.hasOwnProperty.call(legacyPreview, "handoffs")) {
    throw new RuntimeManifestCompileError(
      "runtime.unsupported_manifest_schema",
      `Published workflow '${publishedVersionId}' contains legacy handoff manifest data.`,
    );
  }
}

export function selectModelRoutingDecision(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: ID;
  context: ModelRoutingContext;
}): ModelRoutingDecision {
  const activeAgent = resolveActiveRuntimeAgent(input.manifest, input.activeAgentId);

  const normalizedContext = normalizeRoutingContext(
    input.context,
    activeAgent,
    input.manifest,
  );
  const runtimeProfile = resolveRuntimeProfilePolicy({
    manifest: input.manifest,
    activeAgentId: input.activeAgentId,
  });
  const matchingRule = input.manifest.modelRouting.find((rule) =>
    modelRoutingRuleMatches(rule, normalizedContext),
  );

  if (matchingRule !== undefined) {
    const tier = raiseTierToRoutingFloor(matchingRule.useTier, runtimeProfile.routingFloor);

    if (tier !== matchingRule.useTier) {
      return buildRoutingDecision({
        tier,
        source: "profile_default",
        matchedRuleId: matchingRule.id,
        reason: `The ${runtimeProfile.id} profile raised the routing floor to ${tier}.`,
        context: normalizedContext,
      });
    }

    return buildRoutingDecision({
      tier,
      source: "rule",
      matchedRuleId: matchingRule.id,
      reason: matchingRule.reason,
      context: normalizedContext,
    });
  }

  if (normalizedContext.risk === "high" && normalizedContext.confidence < 0.45) {
    return buildRoutingDecision({
      tier: "sota",
      source: "safety_override",
      reason: "Low-confidence turns with high-risk actions are forced onto the safest tier.",
      context: normalizedContext,
    });
  }

  const defaultTier = raiseTierToRoutingFloor(activeAgent.defaultModelTier, runtimeProfile.routingFloor);

  if (defaultTier !== activeAgent.defaultModelTier) {
    return buildRoutingDecision({
      tier: defaultTier,
      source: "profile_default",
      reason: `The ${runtimeProfile.id} profile raised the default tier for '${activeAgent.name}'.`,
      context: normalizedContext,
    });
  }

  return buildRoutingDecision({
    tier: defaultTier,
    source: "agent_default",
    reason: `No routing rule matched, so Zara kept the active agent '${activeAgent.name}' on its default tier.`,
    context: normalizedContext,
  });
}

export function resolveRuntimeProfilePolicy(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: ID;
}): ResolvedRuntimeProfilePolicy {
  const activeAgent = resolveActiveRuntimeAgent(input.manifest, input.activeAgentId);

  return runtimeProfileCatalog[activeAgent.runtimeProfileOverride ?? input.manifest.runtimeProfile];
}

export function createCostOptimizedSandwichRuntimeAdapter(
  input: CreateCostOptimizedSandwichRuntimeAdapterInput,
): CostOptimizedSandwichRuntimeAdapter {
  const now = input.now ?? (() => new Date().toISOString());
  const createEventId = input.createEventId ?? ((type, index) => `${type}:${index + 1}`);
  const firstByteDelayThresholdMs = input.firstByteDelayThresholdMs ?? 800;

  return {
    async runTurn(turnInput) {
      const activeAgent = resolveRuntimeAgent(turnInput.manifest, turnInput.activeAgentId);
      if (activeAgent === undefined) {
        throw new Error(`Agent '${turnInput.activeAgentId}' is not present in runtime manifest '${turnInput.manifest.manifestId}'.`);
      }

      const events: CallEvent[] = [];
      const emit = (type: CallEvent["type"], payload: Record<string, unknown>) => {
        events.push({
          id: createEventId(type, events.length),
          callSessionId: turnInput.callSessionId,
          tenantId: turnInput.manifest.tenantId,
          type,
          at: now(),
          payload,
        });
      };

      emit("turn.started", {
        activeAgentId: turnInput.activeAgentId,
        audioFrameCount: turnInput.audioFrames.length,
        callPhase: turnInput.context.callPhase,
      });

      let transcript = "";
      let confidence = turnInput.context.confidence ?? 0;
      let language = turnInput.context.language ?? activeAgent.languagePolicy.defaultLanguage;
      let degraded = false;
      let failureStage: RuntimeFailureStage | undefined;

      try {
        const transcription = await input.stt.transcribe({
          audioFrames: [...turnInput.audioFrames],
          manifest: turnInput.manifest,
          activeAgent,
          context: turnInput.context,
        });

        transcript = transcription.transcript.trim();
        confidence = transcription.confidence;
        language = transcription.language;

        emit("turn.transcribed", {
          transcript,
          confidence,
          language,
        });
      } catch (error) {
        degraded = true;
        failureStage = "stt";

        const failure = normalizeProviderFailure(error, "stt");
        emit("call.failed", {
          stage: failure.stage,
          code: failure.code,
          recoverable: true,
          message: failure.message,
        });
      }

      const routingDecision = selectModelRoutingDecision({
        manifest: turnInput.manifest,
        activeAgentId: activeAgent.agentId,
        context: {
          ...turnInput.context,
          confidence,
          language,
        },
      });
      const runtimeProfile = resolveRuntimeProfilePolicy({
        manifest: turnInput.manifest,
        activeAgentId: activeAgent.agentId,
      });

      emit("routing.model_selected", {
        tier: routingDecision.tier,
        provider: activeAgent.modelProvider ?? "openai",
        ...(activeAgent.modelId !== undefined && activeAgent.modelId.trim().length > 0
          ? { modelId: activeAgent.modelId.trim() }
          : {}),
        source: routingDecision.source,
        matchedRuleId: routingDecision.matchedRuleId,
        reason: routingDecision.reason,
      });

      emit("turn.response.started", {
        activeAgentId: turnInput.activeAgentId,
        tier: routingDecision.tier,
        degraded,
      });

      const turnContext = {
        ...turnInput.context,
        confidence,
        language,
      };
      const synthesizeBaseInput: SandwichTtsSynthesisBaseInput = {
        manifest: turnInput.manifest,
        activeAgent,
        language,
        voiceProfile: runtimeProfile.ttsVoice,
        ...(activeAgent.voiceConfig !== undefined ? { voiceConfig: cloneVoiceConfig(activeAgent.voiceConfig) } : {}),
        context: turnContext,
      };
      let responseText = "";
      let ttsResult: SandwichTtsResult;
      if (failureStage === "stt") {
        responseText = "I'm sorry, I didn't catch that. Could you repeat that?";
        ttsResult = await input.tts.synthesize({
          ...synthesizeBaseInput,
          text: responseText,
        });
      } else if (input.tts.synthesizeStreaming !== undefined) {
        const responseChunks: string[] = [];
        const modelStream = input.model.streamText({
          manifest: turnInput.manifest,
          activeAgent,
          transcript,
          tier: routingDecision.tier,
          context: turnContext,
          untrustedContext: turnInput.untrustedContext?.map(cloneUntrustedContextItem),
        });
        const iterator = modelStream[Symbol.asyncIterator]();
        const bufferedChunks: string[] = [];
        let hasResponseChunk = false;

        try {
          while (true) {
            const next = await iterator.next();
            if (next.done === true) {
              break;
            }

            bufferedChunks.push(next.value);
            if (next.value.trim().length > 0) {
              hasResponseChunk = true;
              break;
            }
          }
        } catch (error) {
          degraded = true;
          failureStage = "model";

          const failure = normalizeProviderFailure(error, "model");
          emit("quality.flagged", {
            stage: failure.stage,
            code: failure.code,
            recoverable: true,
            message: failure.message,
          });
        }

        if (hasResponseChunk) {
          responseChunks.push(...bufferedChunks);
          const textStream: AsyncIterable<string> = {
            async *[Symbol.asyncIterator]() {
              yield* bufferedChunks;

              try {
                while (true) {
                  const next = await iterator.next();
                  if (next.done === true) {
                    break;
                  }

                  responseChunks.push(next.value);
                  yield next.value;
                }
              } catch (error) {
                degraded = true;
                failureStage = "model";

                const failure = normalizeProviderFailure(error, "model");
                emit("quality.flagged", {
                  stage: failure.stage,
                  code: failure.code,
                  recoverable: true,
                  message: failure.message,
                });
              }
            },
          };

          ttsResult = await input.tts.synthesizeStreaming({
            ...synthesizeBaseInput,
            textStream,
          });
          responseText = responseChunks.join("").trim();
        } else {
          responseText = "I'm sorry, I had trouble responding just now. Could you try that again?";
          ttsResult = await input.tts.synthesize({
            ...synthesizeBaseInput,
            text: responseText,
          });
        }
      } else {
        try {
          for await (const chunk of input.model.streamText({
            manifest: turnInput.manifest,
            activeAgent,
            transcript,
            tier: routingDecision.tier,
            context: turnContext,
            untrustedContext: turnInput.untrustedContext?.map(cloneUntrustedContextItem),
          })) {
            responseText += chunk;
          }
        } catch (error) {
          degraded = true;
          failureStage = "model";

          const failure = normalizeProviderFailure(error, "model");
          emit("quality.flagged", {
            stage: failure.stage,
            code: failure.code,
            recoverable: true,
            message: failure.message,
          });
        }

        responseText = responseText.trim();
        if (responseText.length === 0) {
          responseText = "I'm sorry, I had trouble responding just now. Could you try that again?";
        }

        ttsResult = await input.tts.synthesize({
          ...synthesizeBaseInput,
          text: responseText,
        });
      }

      if (ttsResult.firstByteLatencyMs > firstByteDelayThresholdMs) {
        emit("quality.flagged", {
          stage: "tts",
          code: "first_byte_delay",
          latencyMs: ttsResult.firstByteLatencyMs,
        });
      }

      emit("turn.audio.first_byte", {
        latencyMs: ttsResult.firstByteLatencyMs,
      });

      const audioChunks: string[] = [];
      let audioChunkIndex = 0;
      for await (const chunk of ttsResult.audio) {
        audioChunks.push(chunk);
        await turnInput.onAudioChunk?.(chunk, audioChunkIndex, {
          firstByteLatencyMs: ttsResult.firstByteLatencyMs,
        });
        audioChunkIndex += 1;
      }

      emit("turn.completed", {
        transcript,
        responseText,
        audioChunkCount: audioChunks.length,
        degraded,
        ...(failureStage !== undefined ? { failureStage } : {}),
      });

      return {
        transcript,
        responseText,
        audioChunks,
        ...(ttsResult.wordTimestamps !== undefined ? { audioWordTimestamps: ttsResult.wordTimestamps } : {}),
        events,
        routingDecision,
        degraded,
        ...(failureStage !== undefined ? { failureStage } : {}),
      };
    },
  };
}

function cloneUntrustedContextItem(
  item: RuntimeUntrustedContextItem,
): RuntimeUntrustedContextItem {
  return {
    source: item.source,
    label: item.label,
    content: item.content,
  };
}

export function createCallEventStream(): CallEventStream {
  const events: StreamedCallEvent[] = [];
  const seenEventIds = new Set<ID>();
  const listeners = new Set<(events: StreamedCallEvent[]) => void>();

  return {
    publish(input) {
      const batch = Array.isArray(input) ? input : [input];
      const streamedEvents: StreamedCallEvent[] = [];
      let duplicates = 0;

      for (const event of batch) {
        if (seenEventIds.has(event.id)) {
          duplicates += 1;
          continue;
        }

        seenEventIds.add(event.id);
        const sequence = events.length + 1;
        const streamedEvent: StreamedCallEvent = {
          ...cloneCallEvent(event),
          sequence,
          cursor: String(sequence),
        };

        events.push(streamedEvent);
        streamedEvents.push(streamedEvent);
      }

      if (streamedEvents.length > 0) {
        for (const listener of listeners) {
          listener(streamedEvents.map(cloneStreamedCallEvent));
        }
      }

      return {
        accepted: streamedEvents.length,
        duplicates,
        lastSequence: events.at(-1)?.sequence ?? 0,
      };
    },
    subscribe(listener, options) {
      listeners.add(listener);
      const replayEvents = replayStreamedEvents(events, options);

      if (replayEvents.length > 0) {
        listener(replayEvents);
      }

      return () => {
        listeners.delete(listener);
      };
    },
    replay(options) {
      return replayStreamedEvents(events, options);
    },
    size() {
      return events.length;
    },
  };
}

export function estimateRuntimeCost(input: {
  manifest: CompiledRuntimeManifest;
  pricing: RuntimePricingCatalog;
  usage: RuntimeUsageMetrics;
  modelTier: ModelTier;
  activeAgentId?: ID | undefined;
  callSessionId?: ID | undefined;
}): RuntimeCostEstimate {
  const runtimeProfile = resolveRuntimeProfileForCostEstimate({
    manifest: input.manifest,
    activeAgentId: input.activeAgentId,
  });
  const missingPrices: string[] = [];
  const components: RuntimeCostComponent[] = [
    buildRuntimeCostComponent({
      kind: "telephony",
      units: input.usage.callMinutes,
      unitRateUsd: input.pricing.telephonyPerMinuteUsd[input.manifest.telephonyProvider],
      missingKey: `telephony:${input.manifest.telephonyProvider}`,
      missingPrices,
    }),
    buildRuntimeCostComponent({
      kind: "stt",
      units: input.usage.sttMinutes,
      unitRateUsd: input.pricing.sttPerMinuteUsd,
      missingKey: "stt",
      missingPrices,
    }),
    buildRuntimeCostComponent({
      kind: "model_input",
      units: input.usage.modelInputTokens / 1000,
      unitRateUsd:
        (input.pricing.modelPer1kInputTokensUsd[input.modelTier] ?? 0) * runtimeProfile.modelCostMultiplier,
      missingKey: `model_input:${input.modelTier}`,
      missingPrices,
    }),
    buildRuntimeCostComponent({
      kind: "model_output",
      units: input.usage.modelOutputTokens / 1000,
      unitRateUsd:
        (input.pricing.modelPer1kOutputTokensUsd[input.modelTier] ?? 0) * runtimeProfile.modelCostMultiplier,
      missingKey: `model_output:${input.modelTier}`,
      missingPrices,
    }),
    buildRuntimeCostComponent({
      kind: "tts",
      units: input.usage.ttsCharacters / 1000,
      unitRateUsd:
        input.pricing.ttsPer1kCharactersUsd === undefined
          ? undefined
          : input.pricing.ttsPer1kCharactersUsd * runtimeProfile.ttsCostMultiplier,
      missingKey: "tts",
      missingPrices,
    }),
    buildRuntimeCostComponent({
      kind: "storage",
      units: input.usage.storageMb,
      unitRateUsd: input.pricing.storagePerMbUsd,
      missingKey: "storage",
      missingPrices,
    }),
  ];

  return {
    tenantId: input.manifest.tenantId,
    ...(input.callSessionId !== undefined ? { callSessionId: input.callSessionId } : {}),
    currency: "USD",
    modelTier: input.modelTier,
    totalUsd: roundUsd(components.reduce((total, component) => total + component.totalUsd, 0)),
    complete: missingPrices.length === 0,
    missingPrices,
    components,
    usage: cloneUsageMetrics(input.usage),
  };
}

export function evaluateRuntimeBudget(
  input: EvaluateRuntimeBudgetInput,
): RuntimeBudgetDecision {
  const reservationMinutes = input.reservationMinutes ?? 1;
  const reservedAdditionalCostUsd =
    input.stage === "publish"
      ? Math.max(input.estimate.totalUsd, input.manifest.budget.projectedCostPerMinuteUsd * reservationMinutes)
      : input.estimate.totalUsd;
  const projectedSpendUsd = input.manifest.budget.currentSpendUsd + reservedAdditionalCostUsd;
  const overageUsd = Math.max(0, projectedSpendUsd - input.manifest.budget.monthlyCapUsd);

  if (input.manifest.budget.blockOnLimit && input.estimate.complete === false) {
    return {
      allowed: false,
      stage: input.stage,
      reason: `Runtime ${input.stage.replaceAll("_", " ")} is blocked because pricing is incomplete.`,
      projectedSpendUsd: roundUsd(projectedSpendUsd),
      reservedAdditionalCostUsd: roundUsd(reservedAdditionalCostUsd),
      overageUsd: roundUsd(overageUsd),
    };
  }

  if (input.manifest.budget.blockOnLimit && projectedSpendUsd > input.manifest.budget.monthlyCapUsd) {
    return {
      allowed: false,
      stage: input.stage,
      reason: `Runtime ${input.stage.replaceAll("_", " ")} exceeds the tenant budget cap.`,
      projectedSpendUsd: roundUsd(projectedSpendUsd),
      reservedAdditionalCostUsd: roundUsd(reservedAdditionalCostUsd),
      overageUsd: roundUsd(overageUsd),
    };
  }

  return {
    allowed: true,
    stage: input.stage,
    reason: `Runtime ${input.stage.replaceAll("_", " ")} is within budget.`,
    projectedSpendUsd: roundUsd(projectedSpendUsd),
    reservedAdditionalCostUsd: roundUsd(reservedAdditionalCostUsd),
    overageUsd: roundUsd(overageUsd),
  };
}

export function createPremiumRealtimeSession(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: ID;
  budgetAllowed: boolean;
  defaultOpenAiRealtimeModel?: string | undefined;
  defaultGeminiLiveModel?: string | undefined;
  now?: (() => string) | undefined;
  ttlMinutes?: number | undefined;
}): PremiumRealtimeSession {
  const activeAgent = resolveActiveRuntimeAgent(input.manifest, input.activeAgentId);

  const runtimeProfile = resolveRuntimeProfilePolicy({
    manifest: input.manifest,
    activeAgentId: input.activeAgentId,
  });

  if (runtimeProfile.id !== "premium-realtime") {
    throw new Error(`Premium realtime is not enabled for agent '${input.activeAgentId}'.`);
  }

  if (!input.budgetAllowed) {
    throw new Error("Premium realtime is blocked by the current budget policy.");
  }

  const now = input.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const ttlMinutes = input.ttlMinutes ?? 30;
  const realtimeProvider = activeAgent.realtimeProvider ?? "openai-realtime";
  const model =
    activeAgent.realtimeModelId ??
    (realtimeProvider === "gemini-live"
      ? input.defaultGeminiLiveModel ?? "gemini-3.1-flash-live-preview"
      : input.defaultOpenAiRealtimeModel ?? "gpt-realtime");

  return {
    sessionId: `${input.manifest.manifestId}:premium-session`,
    manifestId: input.manifest.manifestId,
    publishedVersionId: input.manifest.publishedVersionId,
    activeAgentId: input.activeAgentId,
    runtime: realtimeProvider,
    policy: "premium-realtime",
    model,
    voice: runtimeProfile.ttsVoice,
    transportUrl: `/runtime/realtime/sessions/${encodeURIComponent(`${input.manifest.manifestId}:premium-session`)}/stream`,
    expiresAt: new Date(new Date(startedAt).getTime() + ttlMinutes * 60_000).toISOString(),
    toolDeclarations: buildRealtimeProviderToolDeclarations({
      manifest: input.manifest,
      activeAgentId: input.activeAgentId,
    }),
    observedEventTypes: [
      "tool.requested",
      "tool.started",
      "tool.completed",
      "tool.failed",
      "tool.approval_required",
      "agent.handoff.requested",
      "agent.handoff.completed",
    ],
  };
}

export function createPremiumRealtimeSessionObservedEvents(input: {
  session: PremiumRealtimeSession;
  callSessionId: ID;
  tenantId: ID;
  at: string;
  action: PremiumRealtimeObservedAction;
}): CallEvent[] {
  if (input.action.type === "tool") {
    return [
      {
        id: `${input.session.sessionId}:tool-started`,
        callSessionId: input.callSessionId,
        tenantId: input.tenantId,
        type: "tool.started",
        at: input.at,
        payload: {
          nodeId: input.action.nodeId,
          toolId: input.action.toolId,
        },
      },
      {
        id: `${input.session.sessionId}:tool-completed`,
        callSessionId: input.callSessionId,
        tenantId: input.tenantId,
        type: "tool.completed",
        at: input.at,
        payload: {
          nodeId: input.action.nodeId,
          toolId: input.action.toolId,
          summary: input.action.summary,
        },
      },
    ];
  }

  return [
    {
      id: `${input.session.sessionId}:handoff-requested`,
      callSessionId: input.callSessionId,
      tenantId: input.tenantId,
      type: "agent.handoff.requested",
      at: input.at,
      payload: {
        nodeId: input.action.nodeId,
        sourceAgentId: input.action.sourceAgentId,
        targetAgentId: input.action.targetAgentId,
      },
    },
    {
      id: `${input.session.sessionId}:handoff-completed`,
      callSessionId: input.callSessionId,
      tenantId: input.tenantId,
      type: "agent.handoff.completed",
      at: input.at,
      payload: {
        nodeId: input.action.nodeId,
        targetAgentId: input.action.targetAgentId,
        targetAgentName: input.action.targetAgentName,
      },
    },
  ];
}

export function createSandboxCallSession(
  input: CreateSandboxCallSessionInput,
): SandboxCallSession {
  const now = input.now ?? (() => new Date().toISOString());
  const createEventId = input.createEventId ?? ((type, index) => `${input.callSessionId}:${type}:${index + 1}`);
  const eventStream = input.eventStream ?? createCallEventStream();
  const toolRegistry = input.toolRegistry ?? {};
  const transcript: SandboxTranscriptEntry[] = [];
  const usage = createEmptyUsageMetrics();
  const metrics: SandboxSessionMetrics = {
    turnCount: 0,
    toolCallCount: 0,
    estimatedCostUsd: 0,
    eventCount: 0,
    durationMs: 0,
  };

  let status: SandboxCallStatus = "idle";
  let startedAt: string | undefined;

  const addTranscriptEntry = (speaker: SandboxTranscriptSpeaker, text: string) => {
    transcript.push({
      id: `${input.callSessionId}:transcript:${transcript.length + 1}`,
      speaker,
      text,
      at: now(),
    });
  };

  const publishEvent = (event: CallEvent | CallEvent[]) => {
    const result = eventStream.publish(event);
    metrics.eventCount = result.lastSequence;
    return result;
  };

  return {
    start(startInput) {
      if (startInput.mode === "microphone" && startInput.microphonePermission === "denied") {
        status = "blocked";
        publishEvent({
          id: createEventId("call.failed", metrics.eventCount),
          callSessionId: input.callSessionId,
          tenantId: input.manifest.tenantId,
          type: "call.failed",
          at: now(),
          payload: {
            reason: "microphone_denied",
            mode: startInput.mode,
          },
        });
        addTranscriptEntry("system", "Microphone access was denied. Retry or switch to typed sandbox mode.");

        return {
          status,
          mode: startInput.mode,
        };
      }

      status = "active";
      startedAt = now();
      publishEvent({
        id: createEventId("call.started", metrics.eventCount),
        callSessionId: input.callSessionId,
        tenantId: input.manifest.tenantId,
        type: "call.started",
        at: startedAt,
        payload: {
          mode: startInput.mode,
        },
      });
      addTranscriptEntry("system", `Sandbox call started in ${startInput.mode} mode.`);

      return {
        status,
        mode: startInput.mode,
      };
    },
    async sendCallerTurn(turnInput) {
      if (status !== "active") {
        throw new Error("Sandbox call is not active.");
      }

      const turnIndex = metrics.turnCount + 1;
      const result = await input.runtime.runTurn({
        callSessionId: input.callSessionId,
        manifest: input.manifest,
        activeAgentId: turnInput.activeAgentId,
        audioFrames: [...turnInput.audioFrames],
        context: turnInput.context,
      });
      const streamedEvents = result.events.map((event, index) => ({
        ...cloneCallEvent(event),
        id: `${input.callSessionId}:turn:${turnIndex}:${event.type}:${index + 1}`,
      }));

      publishEvent(streamedEvents);
      metrics.turnCount = turnIndex;
      metrics.currentTier = result.routingDecision.tier;
      metrics.durationMs += turnInput.durationMs ?? 15000;
      metrics.lastFirstByteLatencyMs = extractFirstByteLatency(result.events);

      addTranscriptEntry("caller", result.transcript);
      addTranscriptEntry("agent", result.responseText);

      const usageDelta = deriveRuntimeUsageMetrics({
        transcript: result.transcript,
        responseText: result.responseText,
        durationMs: turnInput.durationMs ?? 15000,
      });
      mergeUsageMetrics(usage, usageDelta);

      const costEstimate = estimateRuntimeCost({
        manifest: input.manifest,
        pricing: input.pricing,
        usage: usageDelta,
        modelTier: result.routingDecision.tier,
        activeAgentId: turnInput.activeAgentId,
        callSessionId: input.callSessionId,
      });

      metrics.estimatedCostUsd = roundUsd(metrics.estimatedCostUsd + costEstimate.totalUsd);

      return {
        ...result,
        costEstimate,
      };
    },
    async invokeTool(toolInput) {
      if (status !== "active") {
        throw new Error("Sandbox call is not active.");
      }

      const binding = input.manifest.toolBindings.find((tool) => tool.nodeId === toolInput.nodeId);
      if (binding === undefined) {
        throw new Error(`Sandbox tool node '${toolInput.nodeId}' is not present in runtime manifest.`);
      }

      const handler = toolRegistry[binding.toolId];
      const startedEventId = createEventId("tool.started", metrics.eventCount);

      publishEvent({
        id: startedEventId,
        callSessionId: input.callSessionId,
        tenantId: input.manifest.tenantId,
        type: "tool.started",
        at: now(),
        payload: {
          nodeId: binding.nodeId,
          toolId: binding.toolId,
        },
      });

      if (handler === undefined) {
        publishEvent({
          id: createEventId("tool.failed", metrics.eventCount),
          callSessionId: input.callSessionId,
          tenantId: input.manifest.tenantId,
          type: "tool.failed",
          at: now(),
          payload: {
            nodeId: binding.nodeId,
            toolId: binding.toolId,
            reason: "missing_tool_handler",
          },
        });
        throw new Error(`Sandbox tool '${binding.toolId}' has no simulated handler.`);
      }

      const result = await handler({
        callSessionId: input.callSessionId,
        manifest: input.manifest,
        binding,
        payload: cloneRecord(toolInput.payload),
      });

      metrics.toolCallCount += 1;
      addTranscriptEntry("system", result.summary);

      publishEvent({
        id: createEventId("tool.completed", metrics.eventCount),
        callSessionId: input.callSessionId,
        tenantId: input.manifest.tenantId,
        type: "tool.completed",
        at: now(),
        payload: {
          nodeId: binding.nodeId,
          toolId: binding.toolId,
          summary: result.summary,
        },
      });

      return {
        summary: result.summary,
        output: cloneRecord(result.output),
      };
    },
    end(endInput) {
      if (status === "ended") {
        return {
          status,
          disposition: endInput.disposition,
        };
      }

      status = "ended";
      publishEvent({
        id: createEventId("call.ended", metrics.eventCount),
        callSessionId: input.callSessionId,
        tenantId: input.manifest.tenantId,
        type: "call.ended",
        at: now(),
        payload: {
          disposition: endInput.disposition,
          startedAt,
        },
      });
      addTranscriptEntry("system", "Sandbox call ended.");

      return {
        status,
        disposition: endInput.disposition,
      };
    },
    getTranscript() {
      return transcript.map(cloneTranscriptEntry);
    },
    getMetrics() {
      return {
        ...metrics,
      };
    },
    replayEvents(options) {
      return eventStream.replay(options);
    },
    subscribeToEvents(listener, options) {
      return eventStream.subscribe(listener, options);
    },
  };
}

function buildCompiledToolBinding(
  node: WorkflowNode,
  toolMap: Map<ID, ToolDefinition>,
  hasIntegrationConnectionRegistry: boolean,
  availableIntegrationConnectionIds: Set<ID>,
): CompiledRuntimeToolBinding[] {
  const tool = getToolNodeConfig(node);
  const toolId = node.toolId;

  if (node.kind !== "tool" || tool === undefined || toolId === undefined) {
    throw new RuntimeManifestCompileError(
      "runtime.missing_tool_definition",
      `Tool node '${node.id}' is missing a runtime tool definition.`,
    );
  }

  if (
    tool.requiresAuthorization
    && (tool.integrationConnectionId === undefined
      || (hasIntegrationConnectionRegistry
        && availableIntegrationConnectionIds.has(tool.integrationConnectionId) === false))
  ) {
    throw new RuntimeManifestCompileError(
      "runtime.missing_integration_connection",
      `Tool node '${node.id}' requires missing integration connection '${tool.integrationConnectionId}'.`,
    );
  }

  return getRuntimeToolBindingConfigs(node, tool).map((binding) => {
    const toolDefinition = toolMap.get(binding.toolId);
    if (toolDefinition === undefined) {
      throw new RuntimeManifestCompileError(
        "runtime.missing_tool_definition",
        `Tool node '${node.id}' references missing tool '${binding.toolId}'.`,
      );
    }

    return {
      nodeId: node.id,
      label: binding.label,
      toolId: binding.toolId,
      connector: tool.connector,
      toolName: binding.toolName,
      integrationConnectionId: tool.integrationConnectionId,
      integrationLabel: tool.integrationLabel,
      risk: binding.risk,
      requiresHumanApproval: binding.requiresHumanApproval,
      ...(binding.request !== undefined ? { request: cloneToolRequest(binding.request) } : {}),
      tool: cloneTool(toolDefinition),
    };
  });
}

function buildCompiledAgentToolAssignments(
  graph: PublishedWorkflowVersion["graph"],
  toolBindings: CompiledRuntimeToolBinding[],
): CompiledRuntimeAgentToolAssignment[] {
  const primaryToolIdByNodeId = new Map<ID, ID>();
  const toolBindingsByNodeId = new Map<ID, CompiledRuntimeToolBinding[]>();
  for (const binding of toolBindings) {
    if (!primaryToolIdByNodeId.has(binding.nodeId)) {
      primaryToolIdByNodeId.set(binding.nodeId, binding.toolId);
    }
    toolBindingsByNodeId.set(binding.nodeId, [
      ...(toolBindingsByNodeId.get(binding.nodeId) ?? []),
      binding,
    ]);
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  return graph.nodes
    .filter((node) => node.kind === "agent")
    .flatMap((agentNode) => {
      const role = getAgentNodeRoleConfig(agentNode);
      if (role === undefined || role.name.trim().length === 0) {
        return [];
      }
      const roleId = agentNode.roleId ?? agentNode.id;
      const connectedToolNodeIds = graph.edges
        .filter((edge) =>
          edge.sourceNodeId === agentNode.id
          && nodeById.get(edge.targetNodeId)?.kind === "tool")
        .map((edge) => edge.targetNodeId);

      return connectedToolNodeIds
        .flatMap((toolNodeId) => toolBindingsByNodeId.get(toolNodeId) ?? [])
        .map((binding) => {
          const description = binding.tool.description.trim().length > 0
            ? binding.tool.description
            : binding.toolName;

          return {
            id: primaryToolIdByNodeId.get(binding.nodeId) === binding.toolId
              ? binding.nodeId
              : `${binding.nodeId}:${binding.toolId}`,
            roleId,
            toolId: binding.toolId,
            label: binding.label,
            description,
            whenToUse: `Use when ${role.name} needs ${description}`,
            inputSchema: {},
            requiredInputs: [],
            risk: binding.risk,
            requiresHumanApproval: binding.requiresHumanApproval,
            ...(binding.integrationConnectionId !== undefined
              ? { credentialRef: binding.integrationConnectionId }
              : {}),
          } satisfies CompiledRuntimeAgentToolAssignment;
        });
    })
    .sort((left, right) => {
      const roleComparison = left.roleId.localeCompare(right.roleId);
      return roleComparison === 0 ? left.id.localeCompare(right.id) : roleComparison;
    });
}

function getAgentNodeRoleConfig(node: WorkflowNode): AgentRoleNodeConfig | undefined {
  if (node.kind !== "agent") {
    return undefined;
  }

  const role = node.config["role"];

  if (typeof role !== "object" || role === null) {
    return undefined;
  }

  return role as AgentRoleNodeConfig;
}

interface RuntimeToolBindingConfig {
  toolId: ID;
  label: string;
  toolName: string;
  risk: ToolDefinition["risk"];
  requiresHumanApproval: boolean;
  request?: ToolRequestConfig | undefined;
}

function getRuntimeToolBindingConfigs(
  node: WorkflowNode,
  tool: ToolNodeConfig,
): RuntimeToolBindingConfig[] {
  const primary: RuntimeToolBindingConfig = {
    toolId: node.toolId!,
    label: node.label,
    toolName: tool.toolName,
    risk: tool.risk,
    requiresHumanApproval: tool.requiresHumanApproval,
    ...(tool.request !== undefined ? { request: tool.request } : {}),
  };
  const seenToolIds = new Set([primary.toolId]);
  const additionalTools = (tool.additionalTools ?? [])
    .filter((additionalTool) => {
      if (seenToolIds.has(additionalTool.toolId)) {
        return false;
      }

      seenToolIds.add(additionalTool.toolId);
      return true;
    })
    .map((additionalTool) => ({
      toolId: additionalTool.toolId,
      label: additionalTool.toolName,
      toolName: additionalTool.toolName,
      risk: additionalTool.risk,
      requiresHumanApproval: additionalTool.requiresHumanApproval,
      ...(additionalTool.request !== undefined ? { request: additionalTool.request } : {}),
    } satisfies RuntimeToolBindingConfig));

  return [primary, ...additionalTools];
}

function resolveActiveRuntimeAgent(
  manifest: CompiledRuntimeManifest,
  activeAgentId: ID,
): RuntimeAgentDefinition {
  const activeAgent = resolveRuntimeAgent(manifest, activeAgentId);

  if (activeAgent === undefined) {
    throw new Error(`Agent '${activeAgentId}' is not present in runtime manifest '${manifest.manifestId}'.`);
  }

  return activeAgent;
}

function normalizeRoutingContext(
  context: ModelRoutingContext,
  activeAgent: RuntimeAgentDefinition,
  manifest: CompiledRuntimeManifest,
): ModelRoutingDecisionLog["context"] {
  return {
    activeAgentId: activeAgent.agentId,
    intent: context.intent,
    callPhase: context.callPhase,
    confidence: context.confidence ?? 0,
    language: context.language ?? activeAgent.languagePolicy.defaultLanguage,
    risk: resolveToolRisk(context, manifest.tools),
    ...(context.requestedToolId !== undefined ? { requestedToolId: context.requestedToolId } : {}),
  };
}

function modelRoutingRuleMatches(
  rule: ModelRoutingRule,
  context: ModelRoutingDecisionLog["context"],
): boolean {
  if (rule.when.intent !== undefined && rule.when.intent !== context.intent) {
    return false;
  }

  if (rule.when.language !== undefined && rule.when.language !== context.language) {
    return false;
  }

  if (rule.when.callPhase !== undefined && rule.when.callPhase !== context.callPhase) {
    return false;
  }

  if (rule.when.minConfidence !== undefined && context.confidence < rule.when.minConfidence) {
    return false;
  }

  if (rule.when.maxConfidence !== undefined && context.confidence > rule.when.maxConfidence) {
    return false;
  }

  if (rule.when.minRisk !== undefined) {
    if (context.risk === undefined || riskWeight(context.risk) < riskWeight(rule.when.minRisk)) {
      return false;
    }
  }

  if (rule.when.maxRisk !== undefined) {
    if (context.risk === undefined || riskWeight(context.risk) > riskWeight(rule.when.maxRisk)) {
      return false;
    }
  }

  return true;
}

function buildRoutingDecision(input: {
  tier: ModelTier;
  source: ModelRoutingDecisionSource;
  matchedRuleId?: ID | undefined;
  reason: string;
  context: ModelRoutingDecisionLog["context"];
}): ModelRoutingDecision {
  return {
    tier: input.tier,
    source: input.source,
    ...(input.matchedRuleId !== undefined ? { matchedRuleId: input.matchedRuleId } : {}),
    reason: input.reason,
    log: {
      tier: input.tier,
      source: input.source,
      ...(input.matchedRuleId !== undefined ? { matchedRuleId: input.matchedRuleId } : {}),
      reason: input.reason,
      context: input.context,
    },
  };
}

function normalizeModelRoutingRules(rules: ModelRoutingRule[]): ModelRoutingRule[] {
  return [...rules]
    .map((rule) => ({
      id: rule.id,
      ...(rule.priority !== undefined ? { priority: rule.priority } : {}),
      when: {
        ...rule.when,
      },
      useTier: rule.useTier,
      reason: rule.reason,
    }))
    .sort((left, right) => {
      const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const specificityDelta = routingRuleSpecificity(right) - routingRuleSpecificity(left);
      if (specificityDelta !== 0) {
        return specificityDelta;
      }

      return left.id.localeCompare(right.id);
    });
}

function routingRuleSpecificity(rule: ModelRoutingRule): number {
  return Object.values(rule.when).filter((value) => value !== undefined).length;
}

function resolveToolRisk(
  context: ModelRoutingContext,
  tools: ToolDefinition[],
): ToolDefinition["risk"] | undefined {
  if (context.toolRisk !== undefined) {
    return context.toolRisk;
  }

  if (context.requestedToolId === undefined) {
    return undefined;
  }

  return tools.find((tool) => tool.id === context.requestedToolId)?.risk;
}

function normalizeProviderFailure(
  error: unknown,
  stage: RuntimeFailureStage,
): RuntimeProviderFailure {
  if (error instanceof RuntimeProviderFailure) {
    return error;
  }

  if (error instanceof Error) {
    return new RuntimeProviderFailure(stage, "failed", error.message);
  }

  return new RuntimeProviderFailure(stage, "failed", `Unknown ${stage} provider failure.`);
}

function riskWeight(risk: ToolDefinition["risk"]): number {
  switch (risk) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    default:
      return 0;
  }
}

function modelTierWeight(tier: ModelTier): number {
  switch (tier) {
    case "rules":
      return 0;
    case "cheap":
      return 1;
    case "standard":
      return 2;
    case "sota":
      return 3;
    default:
      return 0;
  }
}

function raiseTierToRoutingFloor(tier: ModelTier, floor: ModelTier): ModelTier {
  return modelTierWeight(tier) >= modelTierWeight(floor) ? tier : floor;
}

function resolveRuntimeProfileForCostEstimate(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId?: ID | undefined;
}): ResolvedRuntimeProfilePolicy {
  if (input.activeAgentId === undefined) {
    return runtimeProfileCatalog[input.manifest.runtimeProfile];
  }

  return resolveRuntimeProfilePolicy({
    manifest: input.manifest,
    activeAgentId: input.activeAgentId,
  });
}

function cloneRole(role: VoiceAgentRole): VoiceAgentRole {
  return {
    ...role,
    ...(role.realtimeVoiceConfig !== undefined
      ? { realtimeVoiceConfig: cloneRealtimeVoiceConfig(role.realtimeVoiceConfig) }
      : {}),
    ...(role.voiceConfig !== undefined ? { voiceConfig: cloneVoiceConfig(role.voiceConfig) } : {}),
    toolIds: [...role.toolIds].sort(),
    languagePolicy: {
      defaultLanguage: role.languagePolicy.defaultLanguage,
      supportedLanguages: [...role.languagePolicy.supportedLanguages].sort(),
      allowMidCallSwitching: role.languagePolicy.allowMidCallSwitching,
    },
  };
}

function cloneRealtimeVoiceConfig(realtimeVoiceConfig: RealtimeVoiceConfig): RealtimeVoiceConfig {
  if (realtimeVoiceConfig.provider === "openai-realtime") {
    return {
      provider: realtimeVoiceConfig.provider,
      voice: realtimeVoiceConfig.voice,
      ...(realtimeVoiceConfig.speed !== undefined ? { speed: realtimeVoiceConfig.speed } : {}),
    };
  }

  return {
    provider: realtimeVoiceConfig.provider,
    voiceName: realtimeVoiceConfig.voiceName,
  };
}

function cloneVoiceConfig(voiceConfig: AgentVoiceConfig): AgentVoiceConfig {
  return {
    provider: voiceConfig.provider,
    voiceId: voiceConfig.voiceId,
    label: voiceConfig.label,
    sourceType: voiceConfig.sourceType,
    ...(voiceConfig.cloneStatus !== undefined ? { cloneStatus: voiceConfig.cloneStatus } : {}),
    ...(voiceConfig.speed !== undefined ? { speed: voiceConfig.speed } : {}),
    ...(voiceConfig.volume !== undefined ? { volume: voiceConfig.volume } : {}),
    ...(voiceConfig.emotion !== undefined ? { emotion: voiceConfig.emotion } : {}),
  };
}

function cloneRoles(roles: VoiceAgentRole[]): VoiceAgentRole[] {
  return [...roles].map(cloneRole).sort((left, right) => left.id.localeCompare(right.id));
}

function cloneTool(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
  };
}

function cloneTools(tools: ToolDefinition[]): ToolDefinition[] {
  return [...tools].map(cloneTool).sort((left, right) => left.id.localeCompare(right.id));
}

function cloneTelemetryPolicy(telemetry: TelemetryPolicy): TelemetryPolicy {
  return {
    captureAudio: telemetry.captureAudio,
    captureTranscript: telemetry.captureTranscript,
    redactSensitiveData: telemetry.redactSensitiveData,
    sinks: [...telemetry.sinks].sort(),
  };
}

function cloneMemoryConfig(
  memory: RuntimeManifestPreviewMemoryConfig,
): RuntimeManifestPreviewMemoryConfig {
  return {
    mode: memory.mode,
    retrievalScopes: [...memory.retrievalScopes].sort(),
    approvalRequired: memory.approvalRequired,
  };
}

function cloneBudgetConfig(
  budget: RuntimeManifestPreviewBudgetConfig,
): RuntimeManifestPreviewBudgetConfig {
  return {
    monthlyCapUsd: budget.monthlyCapUsd,
    currentSpendUsd: budget.currentSpendUsd,
    projectedCostPerMinuteUsd: budget.projectedCostPerMinuteUsd,
    blockOnLimit: budget.blockOnLimit,
  };
}

function cloneToolRequest(request: ToolRequestConfig): ToolRequestConfig {
  return {
    method: request.method,
    url: request.url,
    authToken: request.authToken,
    headers: request.headers
      .map((header) => ({
        name: header.name,
        value: header.value,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    ...(request.bodyTemplate !== undefined ? { bodyTemplate: request.bodyTemplate } : {}),
  };
}

function cloneConditionRoute(route: DraftWorkflowConditionRoute): DraftWorkflowConditionRoute {
  return {
    nodeId: route.nodeId,
    label: route.label,
    ...(route.classifier !== undefined ? { classifier: { ...route.classifier } } : {}),
    ...(route.inputWindow !== undefined ? { inputWindow: { ...route.inputWindow } } : {}),
    branches: [...route.branches]
      .map((branch) => ({
        id: branch.id,
        label: branch.label,
        ...(branch.intentKey !== undefined ? { intentKey: branch.intentKey } : {}),
        ...(branch.description !== undefined ? { description: branch.description } : {}),
        ...(branch.examples !== undefined ? { examples: [...branch.examples] } : {}),
        expression: branch.expression,
        targetNodeId: branch.targetNodeId,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    fallbackLabel: route.fallbackLabel,
    fallbackTargetNodeId: route.fallbackTargetNodeId,
  };
}

function cloneAgentRoutePolicy(routePolicy: DraftWorkflowAgentRoutePolicy): DraftWorkflowAgentRoutePolicy {
  return {
    sourceAgentId: routePolicy.sourceAgentId,
    sourceAgentName: routePolicy.sourceAgentName,
    type: routePolicy.type,
    trigger: routePolicy.trigger,
    activation: routePolicy.activation,
    classifier: { ...routePolicy.classifier },
    inputWindow: { ...routePolicy.inputWindow },
    readiness: {
      mode: routePolicy.readiness.mode,
      ...(routePolicy.readiness.maxClarificationTurns !== undefined
        ? { maxClarificationTurns: routePolicy.readiness.maxClarificationTurns }
        : {}),
    },
    announcement: {
      mode: routePolicy.announcement.mode,
      ...(routePolicy.announcement.text !== undefined ? { text: routePolicy.announcement.text } : {}),
    },
    branches: routePolicy.branches.map((branch) => ({
      id: branch.id,
      label: branch.label,
      intentKey: branch.intentKey,
      target: cloneAgentRoutePolicyTarget(branch.target),
      ...(branch.transferInstructions !== undefined
        ? { transferInstructions: branch.transferInstructions }
        : {}),
    })),
    fallback: {
      label: routePolicy.fallback.label,
      target: cloneAgentRoutePolicyTarget(routePolicy.fallback.target),
    },
  };
}

function cloneAgentRoutePolicyTarget(
  target: DraftWorkflowAgentRoutePolicy["branches"][number]["target"],
): DraftWorkflowAgentRoutePolicy["branches"][number]["target"] {
  switch (target.type) {
    case "agent":
      return {
        type: target.type,
        agentId: target.agentId,
      };
    case "human_escalation":
      return {
        type: target.type,
        queueId: target.queueId,
      };
    case "exit":
      return {
        type: target.type,
        exitNodeId: target.exitNodeId,
      };
    case "clarify_source_agent":
      return {
        type: target.type,
      };
    default:
      return target;
  }
}

function cloneExitNode(exitNode: DraftWorkflowExitNode): DraftWorkflowExitNode {
  return {
    nodeId: exitNode.nodeId,
    label: exitNode.label,
    outcome: exitNode.outcome,
    closingMessage: exitNode.closingMessage,
  };
}

function cloneReturnRoute(route: DraftWorkflowReturnRoute): DraftWorkflowReturnRoute {
  return {
    edgeId: route.edgeId,
    sourceNodeId: route.sourceNodeId,
    targetNodeId: route.targetNodeId,
    ...(route.condition !== undefined ? { condition: route.condition } : {}),
  };
}

function cloneEscalationNode(
  escalation: DraftWorkflowEscalationPolicy,
): DraftWorkflowEscalationPolicy {
  return {
    nodeId: escalation.nodeId,
    label: escalation.label,
    queueName: escalation.queueName,
    enabled: escalation.enabled,
    ...(escalation.queueId !== undefined ? { queueId: escalation.queueId } : {}),
    fallbackMode: escalation.fallbackMode,
    triggers: [...escalation.triggers].sort(),
    fallbackMessage: escalation.fallbackMessage,
  };
}

function getToolNodeConfig(node: WorkflowNode): ToolNodeConfig | undefined {
  if (node.kind !== "tool" || isRecord(node.config) === false) {
    return undefined;
  }

  const tool = node.config.tool;
  return isRecord(tool) ? (tool as unknown as ToolNodeConfig) : undefined;
}

function buildRuntimeCostComponent(input: {
  kind: RuntimeCostComponentKind;
  units: number;
  unitRateUsd: number | undefined;
  missingKey: string;
  missingPrices: string[];
}): RuntimeCostComponent {
  if (input.unitRateUsd === undefined) {
    input.missingPrices.push(input.missingKey);
    return {
      kind: input.kind,
      units: roundUsage(input.units),
      totalUsd: 0,
      missingPrice: true,
    };
  }

  return {
    kind: input.kind,
    units: roundUsage(input.units),
    unitRateUsd: input.unitRateUsd,
    totalUsd: roundUsd(input.units * input.unitRateUsd),
    missingPrice: false,
  };
}

function replayStreamedEvents(
  events: StreamedCallEvent[],
  options?: CallEventReplayOptions,
): StreamedCallEvent[] {
  const afterSequence = options?.afterSequence ?? 0;
  const replay = events
    .filter((event) => event.sequence > afterSequence)
    .slice(0, options?.limit);

  return replay.map(cloneStreamedCallEvent);
}

function deriveRuntimeUsageMetrics(input: {
  transcript: string;
  responseText: string;
  durationMs: number;
}): RuntimeUsageMetrics {
  const callMinutes = input.durationMs / 60000;
  return {
    callMinutes: roundUsage(callMinutes),
    sttMinutes: roundUsage(callMinutes),
    modelInputTokens: Math.max(1, Math.ceil(input.transcript.length / 4)),
    modelOutputTokens: Math.max(1, Math.ceil(input.responseText.length / 4)),
    ttsCharacters: input.responseText.length,
    storageMb: roundUsage(callMinutes * 0.4),
  };
}

function mergeUsageMetrics(
  target: RuntimeUsageMetrics,
  delta: RuntimeUsageMetrics,
): void {
  target.callMinutes = roundUsage(target.callMinutes + delta.callMinutes);
  target.sttMinutes = roundUsage(target.sttMinutes + delta.sttMinutes);
  target.modelInputTokens += delta.modelInputTokens;
  target.modelOutputTokens += delta.modelOutputTokens;
  target.ttsCharacters += delta.ttsCharacters;
  target.storageMb = roundUsage(target.storageMb + delta.storageMb);
}

function createEmptyUsageMetrics(): RuntimeUsageMetrics {
  return {
    callMinutes: 0,
    sttMinutes: 0,
    modelInputTokens: 0,
    modelOutputTokens: 0,
    ttsCharacters: 0,
    storageMb: 0,
  };
}

function extractFirstByteLatency(events: CallEvent[]): number | undefined {
  const firstByteEvent = events.find((event) => event.type === "turn.audio.first_byte");
  const latency = firstByteEvent?.payload.latencyMs;
  return typeof latency === "number" ? latency : undefined;
}

function cloneCallEvent<TPayload extends Record<string, unknown>>(
  event: CallEvent<TPayload>,
): CallEvent<TPayload> {
  return {
    id: event.id,
    callSessionId: event.callSessionId,
    tenantId: event.tenantId,
    type: event.type,
    at: event.at,
    payload: cloneRecord(event.payload) as TPayload,
  };
}

function cloneStreamedCallEvent(
  event: StreamedCallEvent,
): StreamedCallEvent {
  return {
    ...cloneCallEvent(event),
    sequence: event.sequence,
    cursor: event.cursor,
  };
}

function cloneTranscriptEntry(
  entry: SandboxTranscriptEntry,
): SandboxTranscriptEntry {
  return {
    id: entry.id,
    speaker: entry.speaker,
    text: entry.text,
    at: entry.at,
  };
}

function cloneUsageMetrics(
  usage: RuntimeUsageMetrics,
): RuntimeUsageMetrics {
  return {
    callMinutes: usage.callMinutes,
    sttMinutes: usage.sttMinutes,
    modelInputTokens: usage.modelInputTokens,
    modelOutputTokens: usage.modelOutputTokens,
    ttsCharacters: usage.ttsCharacters,
    storageMb: usage.storageMb,
  };
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, entryValue]),
  );
}

function compareByNodeId(left: { nodeId: ID }, right: { nodeId: ID }): number {
  return left.nodeId.localeCompare(right.nodeId);
}

function compareByEdgeId(left: { edgeId: ID }, right: { edgeId: ID }): number {
  return left.edgeId.localeCompare(right.edgeId);
}

function compareBySourceAgentId(
  left: { sourceAgentId: ID },
  right: { sourceAgentId: ID },
): number {
  return left.sourceAgentId.localeCompare(right.sourceAgentId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (isRecord(value)) {
    const sortedEntries = Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}

function hashStableString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

function roundUsage(value: number): number {
  return Number(value.toFixed(4));
}
