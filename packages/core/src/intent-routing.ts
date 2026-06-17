import type {
  AgentTransferContext,
  IntentRouteResult,
  RuntimeAgentRef,
  RuntimeWarning,
  ToolExecutionResult,
} from "./turn-runtime-packet";
import type {
  AgentRoutePolicyBranchConfig,
  AgentRoutePolicyTarget,
  DraftWorkflowAgentRoutePolicy,
} from "./workflow";

export type IntentClassifierModelAlias = "intent-classifier-fast";

export interface IntentRouteClassifierConfig {
  mode: "standard";
  modelAlias: IntentClassifierModelAlias;
  confidenceThreshold: number;
}

export interface IntentRouteInputWindowConfig {
  latestCallerTurn: boolean;
  recentTranscriptTurns: number;
  includeConversationSummary: boolean;
  includePreviousAgentContext: boolean;
  includeRecentToolResults: boolean;
}

export interface IntentRouteBranchConfig {
  id: string;
  label: string;
  intentKey: string;
  description: string;
  examples: string[];
  targetNodeId: string;
}

export interface IntentRouteFallbackConfig {
  label: string;
  targetNodeId: string;
}

export interface IntentRouteNodeConfig {
  classifier: IntentRouteClassifierConfig;
  inputWindow: IntentRouteInputWindowConfig;
  branches: IntentRouteBranchConfig[];
  fallback: IntentRouteFallbackConfig;
}

export interface IntentClassifierOutput {
  matchedBranchId: string | null;
  intentKey: string | null;
  confidence: number;
  reason: string;
  usedFallback: boolean;
}

export interface IntentRouteClassificationResolution {
  result: IntentRouteResult;
  warning?: RuntimeWarning | undefined;
}

export interface ResolveIntentRouteClassificationInput {
  nodeId: string;
  route: IntentRouteNodeConfig;
  output: unknown;
}

export interface AgentRoutePolicyRuntimeAgentRef extends RuntimeAgentRef {
  routePolicyTargetId?: string | undefined;
}

export interface ResolveAgentRoutePolicyClassificationInput {
  routePolicy: DraftWorkflowAgentRoutePolicy;
  sourceAgent: RuntimeAgentRef;
  targetAgents: AgentRoutePolicyRuntimeAgentRef[];
  transferId?: string | undefined;
  callerNeedSummary: string;
  recentToolResults?: ToolExecutionResult[] | undefined;
  output: unknown;
}

export interface AgentRoutePolicyClassificationResolution {
  intent: IntentRouteResult;
  target: AgentRoutePolicyTarget;
  warning?: RuntimeWarning | undefined;
  announcementText?: string | undefined;
  transfer?: AgentTransferContext | undefined;
}

export function resolveIntentRouteClassification(
  input: ResolveIntentRouteClassificationInput,
): IntentRouteClassificationResolution {
  const parsedOutput = parseIntentClassifierOutput(input.output);

  if (parsedOutput === null) {
    return buildFallbackResolution({
      nodeId: input.nodeId,
      route: input.route,
      confidence: 0,
      reason: "Intent classifier returned invalid structured output.",
      warning: {
        code: "intent_classifier.invalid_output",
        message: "Intent classifier returned invalid structured output.",
        recoverable: true,
      },
    });
  }

  if (!Number.isFinite(parsedOutput.confidence) || parsedOutput.confidence < 0 || parsedOutput.confidence > 1) {
    return buildFallbackResolution({
      nodeId: input.nodeId,
      route: input.route,
      confidence: 0,
      reason: "Intent classifier returned an invalid confidence score.",
      warning: {
        code: "intent_classifier.invalid_confidence",
        message: "Intent classifier returned an invalid confidence score.",
        recoverable: true,
      },
    });
  }

  if (parsedOutput.usedFallback || parsedOutput.matchedBranchId === null) {
    return buildFallbackResolution({
      nodeId: input.nodeId,
      route: input.route,
      confidence: parsedOutput.confidence,
      reason: normalizeReason(parsedOutput.reason, `Classifier selected fallback '${input.route.fallback.label}'.`),
    });
  }

  if (parsedOutput.confidence < input.route.classifier.confidenceThreshold) {
    return buildFallbackResolution({
      nodeId: input.nodeId,
      route: input.route,
      confidence: parsedOutput.confidence,
      reason: `Classifier confidence ${parsedOutput.confidence.toFixed(2)} was below threshold ${input.route.classifier.confidenceThreshold.toFixed(2)}.`,
      warning: {
        code: "intent_classifier.low_confidence",
        message: "Intent classifier confidence was below the configured threshold.",
        recoverable: true,
      },
    });
  }

  const matchedBranch = input.route.branches.find((branch) => branch.id === parsedOutput.matchedBranchId);

  if (matchedBranch === undefined) {
    return buildFallbackResolution({
      nodeId: input.nodeId,
      route: input.route,
      confidence: parsedOutput.confidence,
      reason: "Intent classifier selected an unknown branch.",
      warning: {
        code: "intent_classifier.unknown_branch",
        message: "Intent classifier selected an unknown branch.",
        recoverable: true,
      },
    });
  }

  if (parsedOutput.intentKey !== null && parsedOutput.intentKey !== matchedBranch.intentKey) {
    return buildFallbackResolution({
      nodeId: input.nodeId,
      route: input.route,
      confidence: parsedOutput.confidence,
      reason: "Intent classifier returned an intent key that does not match the selected branch.",
      warning: {
        code: "intent_classifier.intent_mismatch",
        message: "Intent classifier returned an intent key that does not match the selected branch.",
        recoverable: true,
      },
    });
  }

  return {
    result: {
      nodeId: input.nodeId,
      matchedBranchId: matchedBranch.id,
      intentKey: matchedBranch.intentKey,
      label: matchedBranch.label,
      confidence: parsedOutput.confidence,
      reason: normalizeReason(parsedOutput.reason, `Matched configured intent branch '${matchedBranch.label}'.`),
      usedFallback: false,
      targetNodeId: matchedBranch.targetNodeId,
    },
  };
}

export function resolveAgentRoutePolicyClassification(
  input: ResolveAgentRoutePolicyClassificationInput,
): AgentRoutePolicyClassificationResolution {
  const route = buildIntentRouteFromAgentRoutePolicy(input.routePolicy);
  const intentResolution = resolveIntentRouteClassification({
    nodeId: input.routePolicy.sourceAgentId,
    route,
    output: input.output,
  });
  const matchedBranch =
    intentResolution.result.matchedBranchId === null
      ? undefined
      : input.routePolicy.branches.find((branch) => branch.id === intentResolution.result.matchedBranchId);
  const target = cloneAgentRoutePolicyTarget(matchedBranch?.target ?? input.routePolicy.fallback.target);
  const targetAgent =
    target.type === "agent" ? findAgentRoutePolicyTarget(input.targetAgents, target.agentId) : undefined;
  const transfer =
    target.type === "agent" && targetAgent !== undefined
      ? buildAgentRoutePolicyTransfer({
          sourceAgent: input.sourceAgent,
          targetAgent,
          transferId: input.transferId,
          intent: intentResolution.result,
          callerNeedSummary: input.callerNeedSummary,
          recentToolResults: input.recentToolResults ?? [],
          branch: matchedBranch,
        })
      : undefined;
  const announcementText =
    target.type === "agent" && targetAgent !== undefined
      ? renderAgentRoutePolicyAnnouncement(input.routePolicy, targetAgent)
      : undefined;

  return {
    intent: intentResolution.result,
    target,
    ...(intentResolution.warning !== undefined ? { warning: intentResolution.warning } : {}),
    ...(announcementText !== undefined ? { announcementText } : {}),
    ...(transfer !== undefined ? { transfer } : {}),
  };
}

function parseIntentClassifierOutput(output: unknown): IntentClassifierOutput | null {
  if (typeof output !== "object" || output === null) {
    return null;
  }

  const record = output as Record<string, unknown>;
  const matchedBranchId = record["matchedBranchId"];
  const intentKey = record["intentKey"];
  const confidence = record["confidence"];
  const reason = record["reason"];
  const usedFallback = record["usedFallback"];

  if (
    !(typeof matchedBranchId === "string" || matchedBranchId === null)
    || !(typeof intentKey === "string" || intentKey === null)
    || typeof confidence !== "number"
    || typeof reason !== "string"
    || typeof usedFallback !== "boolean"
  ) {
    return null;
  }

  return {
    matchedBranchId,
    intentKey,
    confidence,
    reason,
    usedFallback,
  };
}

function buildFallbackResolution(input: {
  nodeId: string;
  route: IntentRouteNodeConfig;
  confidence: number;
  reason: string;
  warning?: RuntimeWarning | undefined;
}): IntentRouteClassificationResolution {
  const result: IntentRouteResult = {
    nodeId: input.nodeId,
    matchedBranchId: null,
    intentKey: null,
    label: null,
    confidence: input.confidence,
    reason: normalizeReason(input.reason, `Using fallback '${input.route.fallback.label}'.`),
    usedFallback: true,
    targetNodeId: input.route.fallback.targetNodeId,
  };

  return input.warning === undefined
    ? { result }
    : {
        result,
        warning: input.warning,
      };
}

function normalizeReason(reason: string, fallback: string) {
  const normalized = reason.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function buildIntentRouteFromAgentRoutePolicy(routePolicy: DraftWorkflowAgentRoutePolicy): IntentRouteNodeConfig {
  return {
    classifier: routePolicy.classifier,
    inputWindow: routePolicy.inputWindow,
    branches: routePolicy.branches.map((branch) => ({
      id: branch.id,
      label: branch.label,
      intentKey: branch.intentKey,
      description: branch.description,
      examples: [...branch.examples],
      targetNodeId: getAgentRoutePolicyTargetId(branch.target, routePolicy.sourceAgentId),
    })),
    fallback: {
      label: routePolicy.fallback.label,
      targetNodeId: getAgentRoutePolicyTargetId(routePolicy.fallback.target, routePolicy.sourceAgentId),
    },
  };
}

function getAgentRoutePolicyTargetId(target: AgentRoutePolicyTarget, sourceAgentId: string): string {
  switch (target.type) {
    case "agent":
      return target.agentId;
    case "exit":
      return target.exitNodeId;
    case "human_escalation":
      return target.queueId;
    case "clarify_source_agent":
      return sourceAgentId;
  }
}

function findAgentRoutePolicyTarget(
  targetAgents: AgentRoutePolicyRuntimeAgentRef[],
  routePolicyTargetId: string,
): RuntimeAgentRef | undefined {
  return targetAgents.find(
    (agent) => agent.routePolicyTargetId === routePolicyTargetId || agent.id === routePolicyTargetId,
  );
}

function buildAgentRoutePolicyTransfer(input: {
  sourceAgent: RuntimeAgentRef;
  targetAgent: RuntimeAgentRef;
  transferId?: string | undefined;
  intent: IntentRouteResult;
  callerNeedSummary: string;
  recentToolResults: ToolExecutionResult[];
  branch: AgentRoutePolicyBranchConfig | undefined;
}): AgentTransferContext {
  return {
    transferId:
      input.transferId ?? `${input.sourceAgent.id}:${input.targetAgent.id}:${input.intent.intentKey ?? "fallback"}`,
    sourceAgent: { ...input.sourceAgent },
    targetAgent: { ...input.targetAgent },
    reason: input.intent.reason,
    callerNeedSummary: input.callerNeedSummary,
    recentToolResults: structuredClone(input.recentToolResults) as ToolExecutionResult[],
    ...(input.intent.intentKey !== null && input.intent.label !== null
      ? {
          matchedIntent: {
            intentKey: input.intent.intentKey,
            label: input.intent.label,
            confidence: input.intent.confidence,
          },
        }
      : {}),
    ...(input.branch?.transferInstructions !== undefined
      ? { instructionsToTarget: input.branch.transferInstructions }
      : {}),
  };
}

function renderAgentRoutePolicyAnnouncement(
  routePolicy: DraftWorkflowAgentRoutePolicy,
  targetAgent: RuntimeAgentRef,
): string | undefined {
  if (routePolicy.announcement.mode === "none" || routePolicy.announcement.text === undefined) {
    return undefined;
  }

  return routePolicy.announcement.text.replaceAll("{targetAgentName}", targetAgent.name);
}

function cloneAgentRoutePolicyTarget(target: AgentRoutePolicyTarget): AgentRoutePolicyTarget {
  return { ...target };
}
