import type {
  CallEvent,
  ID,
  ModelRoutingRule,
  ModelTier,
  RuntimeCallPhase,
  RuntimeManifest,
  TelemetryPolicy,
  TelephonyOwnershipMode,
  TelephonyProvider,
  ToolDefinition,
  VoiceAgentRole,
  WorkflowNode,
} from "./index";
import {
  createWorkflowGraph,
  serializeWorkflowGraph,
  type DraftWorkflowConditionRoute,
  type DraftWorkflowEscalationPolicy,
  type DraftWorkflowExitNode,
  type DraftWorkflowHandoff,
  type PublishedWorkflowVersion,
  type RuntimeManifestPreviewBudgetConfig,
  type RuntimeManifestPreviewMemoryConfig,
  type ToolNodeConfig,
  type ToolRequestConfig,
} from "./workflow";

export type RuntimeManifestCompileErrorCode =
  | "runtime.missing_entry_role"
  | "runtime.missing_tool_definition"
  | "runtime.missing_integration_connection"
  | "runtime.missing_handoff_target"
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

export interface CompiledRuntimeHandoff extends DraftWorkflowHandoff {
  targetRole: VoiceAgentRole;
}

export interface CompiledRuntimeManifest extends RuntimeManifest {
  version: number;
  telephonyOwnership: TelephonyOwnershipMode;
  telephonyConnectionId?: ID | undefined;
  entryNodeId: ID;
  toolBindings: CompiledRuntimeToolBinding[];
  handoffs: CompiledRuntimeHandoff[];
  conditions: DraftWorkflowConditionRoute[];
  exitNodes: DraftWorkflowExitNode[];
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

export type ModelRoutingDecisionSource = "rule" | "role_default" | "safety_override";

export interface ModelRoutingDecisionLog {
  tier: ModelTier;
  source: ModelRoutingDecisionSource;
  matchedRuleId?: ID | undefined;
  reason: string;
  context: {
    activeRoleId: ID;
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
export type RuntimeFailureCode = "timeout" | "interrupted" | "failed";

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
  audio: AsyncIterable<string>;
}

export interface SandwichSttProvider {
  transcribe(input: {
    audioFrames: string[];
    manifest: CompiledRuntimeManifest;
    activeRole: VoiceAgentRole;
    context: ModelRoutingContext;
  }): Promise<SandwichTranscriptionResult>;
}

export interface SandwichTextModelProvider {
  streamText(input: {
    manifest: CompiledRuntimeManifest;
    activeRole: VoiceAgentRole;
    transcript: string;
    tier: ModelTier;
    context: ModelRoutingContext;
  }): AsyncIterable<string>;
}

export interface SandwichTtsProvider {
  synthesize(input: {
    manifest: CompiledRuntimeManifest;
    activeRole: VoiceAgentRole;
    text: string;
    language: string;
    context: ModelRoutingContext;
  }): Promise<SandwichTtsResult>;
}

export interface CostOptimizedSandwichRuntimeTurnInput {
  callSessionId: ID;
  manifest: CompiledRuntimeManifest;
  activeRoleId: ID;
  audioFrames: string[];
  context: ModelRoutingContext;
}

export interface CostOptimizedSandwichRuntimeTurnResult {
  transcript: string;
  responseText: string;
  audioChunks: string[];
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

export function compileRuntimeManifest(
  input: CompileRuntimeManifestInput,
): CompiledRuntimeManifest {
  const { publishedVersion } = input;
  const graph = createWorkflowGraph(publishedVersion.graph);
  const preview = publishedVersion.manifestPreview;
  const entryNodeId = preview.entryNodeId;
  const entryRoleId = preview.entryRoleId;

  if (entryNodeId === undefined || entryRoleId === undefined) {
    throw new RuntimeManifestCompileError(
      "runtime.missing_entry_role",
      `Published workflow '${publishedVersion.id}' is missing an entry role.`,
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
  const roleMap = new Map(roles.map((role) => [role.id, role]));
  const toolMap = new Map(tools.map((tool) => [tool.id, tool]));
  const hasIntegrationConnectionRegistry = input.availableIntegrationConnectionIds !== undefined;
  const availableIntegrationConnectionIds = new Set(input.availableIntegrationConnectionIds ?? []);
  const hasEscalationQueueRegistry = input.availableEscalationQueueIds !== undefined;
  const availableEscalationQueueIds = new Set(input.availableEscalationQueueIds ?? []);

  const toolBindings = graph.nodes
    .filter((node) => node.kind === "tool")
    .map((node) =>
      buildCompiledToolBinding(
        node,
        toolMap,
        hasIntegrationConnectionRegistry,
        availableIntegrationConnectionIds,
      ))
    .sort(compareByNodeId);

  const handoffs = preview.handoffs
    .map((handoff) => {
      const targetRole = roleMap.get(handoff.targetRoleId);

      if (targetRole === undefined) {
        throw new RuntimeManifestCompileError(
          "runtime.missing_handoff_target",
          `Handoff node '${handoff.nodeId}' points at missing role '${handoff.targetRoleId}'.`,
        );
      }

      return {
        ...cloneHandoff(handoff),
        targetRole: cloneRole(targetRole),
      };
    })
    .sort(compareByNodeId);

  const conditions = preview.conditions.map(cloneConditionRoute).sort(compareByNodeId);
  const exitNodes = preview.exitNodes.map(cloneExitNode).sort(compareByNodeId);
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
      runtime: preview.runtime,
      telephonyProvider: input.telephonyProvider ?? preview.telephonyProvider,
      telephonyOwnership: input.telephonyOwnership ?? "platform",
      telephonyConnectionId: input.telephonyConnectionId,
      entryNodeId,
      entryRoleId,
      toolBindings,
      handoffs,
      conditions,
      exitNodes,
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
    version: publishedVersion.version,
    runtime: preview.runtime,
    telephonyProvider: input.telephonyProvider ?? preview.telephonyProvider,
    telephonyOwnership: input.telephonyOwnership ?? "platform",
    ...(input.telephonyConnectionId !== undefined
      ? { telephonyConnectionId: input.telephonyConnectionId }
      : {}),
    entryNodeId,
    entryRoleId,
    roles,
    tools,
    graph,
    modelRouting,
    toolBindings,
    handoffs,
    conditions,
    exitNodes,
    escalation,
    escalationNode,
    telemetry,
    memory,
    budget,
    serializedGraph,
    compiledDefinitionHash,
  };
}

export function selectModelRoutingDecision(input: {
  manifest: CompiledRuntimeManifest;
  activeRoleId: ID;
  context: ModelRoutingContext;
}): ModelRoutingDecision {
  const activeRole = input.manifest.roles.find((role) => role.id === input.activeRoleId);

  if (activeRole === undefined) {
    throw new Error(`Role '${input.activeRoleId}' is not present in runtime manifest '${input.manifest.manifestId}'.`);
  }

  const normalizedContext = normalizeRoutingContext(
    input.context,
    activeRole,
    input.manifest,
  );
  const matchingRule = input.manifest.modelRouting.find((rule) =>
    modelRoutingRuleMatches(rule, normalizedContext),
  );

  if (matchingRule !== undefined) {
    return buildRoutingDecision({
      tier: matchingRule.useTier,
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

  return buildRoutingDecision({
    tier: activeRole.defaultModelTier,
    source: "role_default",
    reason: `No routing rule matched, so Zara kept the active role '${activeRole.name}' on its default tier.`,
    context: normalizedContext,
  });
}

export function createCostOptimizedSandwichRuntimeAdapter(
  input: CreateCostOptimizedSandwichRuntimeAdapterInput,
): CostOptimizedSandwichRuntimeAdapter {
  const now = input.now ?? (() => new Date().toISOString());
  const createEventId = input.createEventId ?? ((type, index) => `${type}:${index + 1}`);
  const firstByteDelayThresholdMs = input.firstByteDelayThresholdMs ?? 800;

  return {
    async runTurn(turnInput) {
      const activeRole = turnInput.manifest.roles.find((role) => role.id === turnInput.activeRoleId);

      if (activeRole === undefined) {
        throw new Error(`Role '${turnInput.activeRoleId}' is not present in runtime manifest '${turnInput.manifest.manifestId}'.`);
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
        activeRoleId: turnInput.activeRoleId,
        audioFrameCount: turnInput.audioFrames.length,
        callPhase: turnInput.context.callPhase,
      });

      let transcript = "";
      let confidence = turnInput.context.confidence ?? 0;
      let language = turnInput.context.language ?? activeRole.languagePolicy.defaultLanguage;
      let degraded = false;
      let failureStage: RuntimeFailureStage | undefined;

      try {
        const transcription = await input.stt.transcribe({
          audioFrames: [...turnInput.audioFrames],
          manifest: turnInput.manifest,
          activeRole,
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
        activeRoleId: turnInput.activeRoleId,
        context: {
          ...turnInput.context,
          confidence,
          language,
        },
      });

      emit("routing.model_selected", {
        tier: routingDecision.tier,
        source: routingDecision.source,
        matchedRuleId: routingDecision.matchedRuleId,
        reason: routingDecision.reason,
      });

      emit("turn.response.started", {
        activeRoleId: turnInput.activeRoleId,
        tier: routingDecision.tier,
        degraded,
      });

      let responseText = "";
      if (failureStage === "stt") {
        responseText = "I'm sorry, I didn't catch that. Could you repeat that?";
      } else {
        try {
          for await (const chunk of input.model.streamText({
            manifest: turnInput.manifest,
            activeRole,
            transcript,
            tier: routingDecision.tier,
            context: {
              ...turnInput.context,
              confidence,
              language,
            },
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
      }

      const ttsResult = await input.tts.synthesize({
        manifest: turnInput.manifest,
        activeRole,
        text: responseText,
        language,
        context: {
          ...turnInput.context,
          confidence,
          language,
        },
      });

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
      for await (const chunk of ttsResult.audio) {
        audioChunks.push(chunk);
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
        events,
        routingDecision,
        degraded,
        ...(failureStage !== undefined ? { failureStage } : {}),
      };
    },
  };
}

function buildCompiledToolBinding(
  node: WorkflowNode,
  toolMap: Map<ID, ToolDefinition>,
  hasIntegrationConnectionRegistry: boolean,
  availableIntegrationConnectionIds: Set<ID>,
): CompiledRuntimeToolBinding {
  const tool = getToolNodeConfig(node);
  const toolId = node.toolId;

  if (node.kind !== "tool" || tool === undefined || toolId === undefined) {
    throw new RuntimeManifestCompileError(
      "runtime.missing_tool_definition",
      `Tool node '${node.id}' is missing a runtime tool definition.`,
    );
  }

  const toolDefinition = toolMap.get(toolId);
  if (toolDefinition === undefined) {
    throw new RuntimeManifestCompileError(
      "runtime.missing_tool_definition",
      `Tool node '${node.id}' references missing tool '${toolId}'.`,
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

  return {
    nodeId: node.id,
    label: node.label,
    toolId,
    connector: tool.connector,
    toolName: tool.toolName,
    integrationConnectionId: tool.integrationConnectionId,
    integrationLabel: tool.integrationLabel,
    risk: tool.risk,
    requiresHumanApproval: tool.requiresHumanApproval,
    ...(tool.request !== undefined ? { request: cloneToolRequest(tool.request) } : {}),
    tool: cloneTool(toolDefinition),
  };
}

function normalizeRoutingContext(
  context: ModelRoutingContext,
  activeRole: VoiceAgentRole,
  manifest: CompiledRuntimeManifest,
): ModelRoutingDecisionLog["context"] {
  return {
    activeRoleId: activeRole.id,
    intent: context.intent,
    callPhase: context.callPhase,
    confidence: context.confidence ?? 0,
    language: context.language ?? activeRole.languagePolicy.defaultLanguage,
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

function cloneRole(role: VoiceAgentRole): VoiceAgentRole {
  return {
    ...role,
    toolIds: [...role.toolIds].sort(),
    languagePolicy: {
      defaultLanguage: role.languagePolicy.defaultLanguage,
      supportedLanguages: [...role.languagePolicy.supportedLanguages].sort(),
      allowMidCallSwitching: role.languagePolicy.allowMidCallSwitching,
    },
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

function cloneHandoff(handoff: DraftWorkflowHandoff): DraftWorkflowHandoff {
  return {
    nodeId: handoff.nodeId,
    label: handoff.label,
    targetRoleId: handoff.targetRoleId,
    targetRoleName: handoff.targetRoleName,
    handoffReason: handoff.handoffReason,
  };
}

function cloneConditionRoute(route: DraftWorkflowConditionRoute): DraftWorkflowConditionRoute {
  return {
    nodeId: route.nodeId,
    label: route.label,
    branches: [...route.branches]
      .map((branch) => ({
        id: branch.id,
        label: branch.label,
        expression: branch.expression,
        targetNodeId: branch.targetNodeId,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    fallbackLabel: route.fallbackLabel,
    fallbackTargetNodeId: route.fallbackTargetNodeId,
  };
}

function cloneExitNode(exitNode: DraftWorkflowExitNode): DraftWorkflowExitNode {
  return {
    nodeId: exitNode.nodeId,
    label: exitNode.label,
    outcome: exitNode.outcome,
    closingMessage: exitNode.closingMessage,
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

function compareByNodeId(left: { nodeId: ID }, right: { nodeId: ID }): number {
  return left.nodeId.localeCompare(right.nodeId);
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
