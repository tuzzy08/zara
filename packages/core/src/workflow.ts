import type {
  AgentRoleKind,
  AgentVoiceConfig,
  EscalationFallbackMode,
  EscalationPolicy,
  ID,
  LanguagePolicy,
  ModelTier,
  PublishedAgentVersion,
  RealtimeProviderId,
  RuntimeProfileId,
  TextModelProviderId,
  TelephonyProvider,
  TenantEnvironment,
  ToolDefinition,
  VoiceAgentRole,
  VoiceRuntimeKind,
  WorkflowEdge,
  WorkflowEdgeKind,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodePosition,
  WorkflowNodeKind,
  WorkflowRelationshipHandleRole,
} from "./index";
import type { IntentRouteClassifierConfig, IntentRouteInputWindowConfig } from "./intent-routing";

export interface AgentRoleNodeConfig {
  kind: AgentRoleKind;
  name: string;
  businessName: string;
  instructions: string;
  defaultModelTier: ModelTier;
  modelProvider?: TextModelProviderId | undefined;
  modelId?: string | undefined;
  realtimeProvider?: RealtimeProviderId | undefined;
  realtimeModelId?: string | undefined;
  runtimeProfileOverride?: RuntimeProfileId | undefined;
  voiceConfig?: AgentVoiceConfig | undefined;
  languagePolicy: LanguagePolicy;
  reusableSpecialist: boolean;
  specialistTemplateId?: ID | undefined;
  specialistTemplateVersion?: number | undefined;
}

export interface CreateAgentRoleNodeInput {
  id: string;
  label: string;
  position: WorkflowNodePosition;
  roleId?: string;
  role: AgentRoleNodeConfig;
}

export interface SpecialistRoleTemplate {
  id: ID;
  workspaceId: ID;
  name: string;
  version: number;
  role: AgentRoleNodeConfig;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSpecialistRoleTemplateInput {
  id: ID;
  workspaceId: ID;
  role: AgentRoleNodeConfig;
  createdAt: string;
  existingTemplates: SpecialistRoleTemplate[];
}

export interface UpdateSpecialistRoleTemplateInput {
  role: AgentRoleNodeConfig;
  updatedAt: string;
}

export type ToolRequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ToolRequestHeader {
  name: string;
  value: string;
}

export interface ToolRequestConfig {
  method: ToolRequestMethod;
  url: string;
  authToken: string;
  headers: ToolRequestHeader[];
  bodyTemplate?: string | undefined;
}

export interface ToolNodeConfig {
  connector: ToolDefinition["connector"];
  toolName: string;
  integrationConnectionId?: string | undefined;
  integrationLabel?: string | undefined;
  connectionStatus: "connected" | "missing" | "revoked";
  risk: ToolDefinition["risk"];
  requiresAuthorization: boolean;
  requiresHumanApproval: boolean;
  request?: ToolRequestConfig | undefined;
  additionalTools?: ToolNodeAdditionalToolConfig[] | undefined;
}

export interface ToolNodeAdditionalToolConfig {
  toolId: string;
  toolName: string;
  risk: ToolDefinition["risk"];
  requiresHumanApproval: boolean;
  request?: ToolRequestConfig | undefined;
}

export interface CreateToolNodeInput {
  id: string;
  label: string;
  position: WorkflowNodePosition;
  toolId: string;
  tool: ToolNodeConfig;
}

export interface HandoffNodeConfig {
  targetRoleId: string;
  targetRoleName: string;
  handoffReason: string;
}

export interface CreateHandoffNodeInput {
  id: string;
  label: string;
  position: WorkflowNodePosition;
  handoff: HandoffNodeConfig;
}

export interface HumanEscalationNodeConfig {
  queueId: string;
  queueName: string;
  fallbackMode: EscalationFallbackMode;
  fallbackMessage: string;
}

export interface CreateHumanEscalationNodeInput {
  id: string;
  label: string;
  position: WorkflowNodePosition;
  escalation: HumanEscalationNodeConfig;
}

export interface ConditionBranchConfig {
  id: string;
  label: string;
  intentKey?: string | undefined;
  description?: string | undefined;
  examples?: string[] | undefined;
  expression: string;
  targetNodeId: string;
}

export interface ConditionNodeConfig {
  classifier?: IntentRouteClassifierConfig | undefined;
  inputWindow?: IntentRouteInputWindowConfig | undefined;
  branches: ConditionBranchConfig[];
  fallbackLabel: string;
  fallbackTargetNodeId: string;
}

export interface CreateConditionNodeInput {
  id: string;
  label: string;
  position: WorkflowNodePosition;
  condition: ConditionNodeConfig;
}

export interface EndNodeConfig {
  outcome: "resolved" | "voicemail" | "handoff-complete" | "failed";
  closingMessage: string;
}

export interface CreateEndNodeInput {
  id: string;
  label: string;
  position: WorkflowNodePosition;
  end: EndNodeConfig;
}

export interface DraftWorkflowToolRequestPreview {
  method: ToolRequestMethod;
  url: string;
  headerCount: number;
  hasAuthToken: boolean;
}

export interface DraftWorkflowToolBinding {
  nodeId: string;
  label: string;
  toolId?: string | undefined;
  connector: ToolDefinition["connector"];
  toolName: string;
  integrationConnectionId?: string | undefined;
  integrationLabel?: string | undefined;
  risk: ToolDefinition["risk"];
  requiresHumanApproval: boolean;
  request?: DraftWorkflowToolRequestPreview | undefined;
}

export interface DraftWorkflowHandoff {
  nodeId: string;
  label: string;
  targetRoleId: string;
  targetRoleName: string;
  handoffReason: string;
}

export interface DraftWorkflowConditionRoute {
  nodeId: string;
  label: string;
  classifier?: IntentRouteClassifierConfig | undefined;
  inputWindow?: IntentRouteInputWindowConfig | undefined;
  branches: ConditionBranchConfig[];
  fallbackLabel: string;
  fallbackTargetNodeId: string;
}

export interface DraftWorkflowExitNode {
  nodeId: string;
  label: string;
  outcome: EndNodeConfig["outcome"];
  closingMessage: string;
}

export interface DraftWorkflowEscalationPolicy extends EscalationPolicy {
  nodeId: string;
  label: string;
  queueName: string;
}

export interface DraftWorkflowReturnRoute {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition?: string | undefined;
}

export interface DraftWorkflowManifest {
  entryNodeId?: string | undefined;
  entryRoleId?: string | undefined;
  tools: DraftWorkflowToolBinding[];
  handoffs: DraftWorkflowHandoff[];
  conditions: DraftWorkflowConditionRoute[];
  exitNodes: DraftWorkflowExitNode[];
  escalation: DraftWorkflowEscalationPolicy | null;
  returnRoutes: DraftWorkflowReturnRoute[];
}

export interface RuntimeManifestPreviewMemoryConfig {
  mode: "session-only" | "scoped";
  retrievalScopes: Array<"session" | "caller" | "account" | "tenant">;
  approvalRequired: boolean;
}

export interface RuntimeManifestPreviewBudgetConfig {
  monthlyCapUsd: number;
  currentSpendUsd: number;
  projectedCostPerMinuteUsd: number;
  blockOnLimit: boolean;
}

export interface BuildRuntimeManifestPreviewInput {
  tenantId: ID;
  workspaceId?: ID | undefined;
  environment: TenantEnvironment;
  workflowId: ID;
  graph: WorkflowGraph;
  runtime: VoiceRuntimeKind;
  runtimeProfile?: RuntimeProfileId | undefined;
  telephonyProvider: TelephonyProvider;
  memory: RuntimeManifestPreviewMemoryConfig;
  budget: RuntimeManifestPreviewBudgetConfig;
  scope?: "draft" | "published";
  publishedVersionId?: ID | undefined;
}

export interface RuntimeManifestPreview extends DraftWorkflowManifest {
  manifestId: ID;
  workflowId: ID;
  workspaceId?: ID | undefined;
  scope: "draft" | "published";
  tenantId: ID;
  environment: TenantEnvironment;
  runtime: VoiceRuntimeKind;
  runtimeProfile: RuntimeProfileId;
  telephonyProvider: TelephonyProvider;
  memory: RuntimeManifestPreviewMemoryConfig;
  budget: RuntimeManifestPreviewBudgetConfig;
  validation: WorkflowValidationResult;
  warnings: string[];
  publishedVersionId?: ID | undefined;
}

export interface PublishWorkflowVersionInput extends BuildRuntimeManifestPreviewInput {
  createdBy: ID;
  createdAt?: string | undefined;
  existingVersions: PublishedWorkflowVersion[];
}

export interface PublishedWorkflowVersion extends PublishedAgentVersion {
  workspaceId?: ID | undefined;
  manifestPreview: RuntimeManifestPreview;
  serializedGraph: string;
}

export interface PinnedPublishedWorkflowVersion {
  callSessionId: ID;
  publishedVersionId: ID;
  version: number;
  workspaceId?: ID | undefined;
  graph: WorkflowGraph;
  manifestPreview: RuntimeManifestPreview;
  pinnedAt: string;
}

export interface ConditionRouteContext {
  [key: string]: string | number | boolean | undefined;
}

export interface ConditionRouteSelection {
  branchId: string;
  label: string;
  targetNodeId: string;
  isFallback: boolean;
  matchedExpression?: string | undefined;
}

export type WorkflowValidationErrorCode =
  | WorkflowRelationshipRejectionCode
  | "workflow.missing_entry"
  | "workflow.duplicate_node_id"
  | "workflow.edge_missing_source"
  | "workflow.edge_missing_target"
  | "workflow.unreachable_node"
  | "workflow.unsafe_cycle"
  | "agent.missing_name"
  | "agent.missing_business_name"
  | "agent.duplicate_name"
  | "agent.missing_instructions"
  | "agent.missing_model_tier"
  | "agent.missing_default_language"
  | "agent.missing_supported_language"
  | "agent.unsupported_language"
  | "agent.duplicate_language"
  | "agent.default_language_not_supported"
  | "agent.missing_language_prompt"
  | "agent.voice_unavailable"
  | "tool.missing_binding"
  | "tool.missing_authorization"
  | "tool.revoked_connection"
  | "tool.missing_request_method"
  | "tool.missing_request_url"
  | "tool.missing_request_auth_token"
  | "tool.missing_request_headers"
  | "handoff.missing_target"
  | "handoff.invalid_target"
  | "condition.missing_branch"
  | "condition.invalid_expression"
  | "condition.invalid_target"
  | "condition.missing_fallback"
  | "condition.invalid_fallback"
  | "escalation.missing_queue"
  | "escalation.missing_fallback_message";

export interface WorkflowValidationError {
  code: WorkflowValidationErrorCode;
  message: string;
  suggestion: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowValidationResult {
  ok: boolean;
  errors: WorkflowValidationError[];
}

interface ParsedConditionExpression {
  field: string;
  operator: "==" | "!=" | "contains";
  value: string;
}

const languageCodePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const conditionExpressionPattern =
  /^\s*([a-zA-Z][\w.]*)\s*(==|!=|contains)\s*"([^"]+)"\s*$/;

export interface WorkflowRelationshipCompanionEdgeRule {
  relationshipId: string;
  source: "source" | "target";
  target: "source" | "target";
  edgeKind: WorkflowEdgeKind;
  sourceHandleRole: WorkflowRelationshipHandleRole;
  targetHandleRole: WorkflowRelationshipHandleRole;
  condition?: string | undefined;
}

export interface WorkflowNodeRelationshipRule {
  id: string;
  sourceKind: WorkflowNodeKind;
  targetKind: WorkflowNodeKind;
  edgeKind: WorkflowEdgeKind;
  sourceHandleRole: WorkflowRelationshipHandleRole;
  targetHandleRole: WorkflowRelationshipHandleRole;
  autoCreateCompanionEdges?: WorkflowRelationshipCompanionEdgeRule[] | undefined;
  requiresExistingDirectFlowEdgeFromTargetToSource?: boolean | undefined;
  requiresExistingFlowPathFromTargetToSource?: boolean | undefined;
  rejectsTargetWhenTargetCallsSource?: boolean | undefined;
}

export const workflowNodeRelationshipRules: WorkflowNodeRelationshipRule[] = [
  {
    id: "entry_to_agent",
    sourceKind: "entry",
    targetKind: "agent",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "agent_to_agent",
    sourceKind: "agent",
    targetKind: "agent",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "delegated_agent_returns_to_caller",
    sourceKind: "agent",
    targetKind: "agent",
    edgeKind: "return",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
    requiresExistingFlowPathFromTargetToSource: true,
  },
  {
    id: "agent_calls_tool",
    sourceKind: "agent",
    targetKind: "tool",
    edgeKind: "flow",
    sourceHandleRole: "tool-call-source",
    targetHandleRole: "tool-call-target",
    autoCreateCompanionEdges: [
      {
        relationshipId: "tool_returns_to_agent",
        source: "target",
        target: "source",
        edgeKind: "return",
        sourceHandleRole: "tool-result-source",
        targetHandleRole: "tool-result-target",
        condition: "success",
      },
    ],
  },
  {
    id: "tool_returns_to_agent",
    sourceKind: "tool",
    targetKind: "agent",
    edgeKind: "return",
    sourceHandleRole: "tool-result-source",
    targetHandleRole: "tool-result-target",
    requiresExistingDirectFlowEdgeFromTargetToSource: true,
  },
  {
    id: "agent_to_intent_route",
    sourceKind: "agent",
    targetKind: "condition",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "intent_route_to_agent",
    sourceKind: "condition",
    targetKind: "agent",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "intent_route_to_handoff",
    sourceKind: "condition",
    targetKind: "handoff",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "intent_route_to_escalation",
    sourceKind: "condition",
    targetKind: "human-escalation",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "intent_route_to_exit",
    sourceKind: "condition",
    targetKind: "end",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "agent_to_handoff",
    sourceKind: "agent",
    targetKind: "handoff",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "handoff_to_agent",
    sourceKind: "handoff",
    targetKind: "agent",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "agent_to_escalation",
    sourceKind: "agent",
    targetKind: "human-escalation",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
  {
    id: "agent_to_exit",
    sourceKind: "agent",
    targetKind: "end",
    edgeKind: "flow",
    sourceHandleRole: "flow-source",
    targetHandleRole: "flow-target",
  },
];

export type WorkflowRelationshipRejectionCode =
  | "relationship.unsupported"
  | "relationship.invalid_handle"
  | "relationship.entry_must_start_with_agent"
  | "relationship.entry_cannot_receive_route"
  | "relationship.intent_requires_agent_source"
  | "relationship.intent_uses_flow_handles"
  | "relationship.intent_invalid_target"
  | "relationship.intent_cannot_target_caller"
  | "relationship.tool_call_requires_tool_handles"
  | "relationship.tool_result_requires_caller"
  | "relationship.tool_result_uses_result_handles";

export type WorkflowNodeRelationshipDecision =
  | {
      allowed: true;
      ruleId: string;
      edgeKind: WorkflowEdgeKind;
      sourceHandleRole: WorkflowRelationshipHandleRole;
      targetHandleRole: WorkflowRelationshipHandleRole;
      autoCreateCompanionEdges: WorkflowRelationshipCompanionEdgeRule[];
    }
  | {
      allowed: false;
      reasonCode: WorkflowRelationshipRejectionCode;
      message: string;
      suggestion: string;
    };

export interface WorkflowNodeRelationshipDecisionInput {
  sourceNodeId: ID;
  targetNodeId: ID;
  sourceKind: WorkflowNodeKind;
  targetKind: WorkflowNodeKind;
  requestedEdgeKind?: WorkflowEdgeKind | undefined;
  sourceHandleRole?: WorkflowRelationshipHandleRole | undefined;
  targetHandleRole?: WorkflowRelationshipHandleRole | undefined;
  strictHandleRoles?: boolean | undefined;
  existingEdges?: WorkflowEdge[] | undefined;
  currentEdgeId?: string | undefined;
}

export function decideWorkflowNodeRelationship(
  input: WorkflowNodeRelationshipDecisionInput,
): WorkflowNodeRelationshipDecision {
  const strictHandleRoles =
    input.strictHandleRoles ?? (input.sourceHandleRole !== undefined || input.targetHandleRole !== undefined);
  const sourceHandleRole = input.sourceHandleRole ?? "flow-source";
  const targetHandleRole = input.targetHandleRole ?? "flow-target";

  if (input.targetKind === "condition" && input.sourceKind !== "agent") {
    return rejectWorkflowRelationship("relationship.intent_requires_agent_source");
  }

  if (
    (input.sourceKind === "condition" || input.targetKind === "condition") &&
    strictHandleRoles &&
    (sourceHandleRole !== "flow-source" || targetHandleRole !== "flow-target")
  ) {
    return rejectWorkflowRelationship("relationship.intent_uses_flow_handles");
  }

  if (
    input.sourceKind === "condition" &&
    !isIntentRouteTargetKind(input.targetKind)
  ) {
    return rejectWorkflowRelationship("relationship.intent_invalid_target");
  }

  if (input.sourceKind === "entry" && input.targetKind !== "agent") {
    return rejectWorkflowRelationship("relationship.entry_must_start_with_agent");
  }

  if (input.targetKind === "entry") {
    return rejectWorkflowRelationship("relationship.entry_cannot_receive_route");
  }

  if (
    input.sourceKind === "agent" &&
    input.targetKind === "tool" &&
    strictHandleRoles &&
    (sourceHandleRole !== "tool-call-source" || targetHandleRole !== "tool-call-target")
  ) {
    return rejectWorkflowRelationship("relationship.tool_call_requires_tool_handles");
  }

  if (
    input.sourceKind === "tool" &&
    input.targetKind === "agent" &&
    strictHandleRoles &&
    (sourceHandleRole !== "tool-result-source" || targetHandleRole !== "tool-result-target")
  ) {
    return rejectWorkflowRelationship("relationship.tool_result_uses_result_handles");
  }

  const matchingRules = workflowNodeRelationshipRules.filter(
    (rule) =>
      rule.sourceKind === input.sourceKind &&
      rule.targetKind === input.targetKind &&
      (input.requestedEdgeKind === undefined || rule.edgeKind === input.requestedEdgeKind),
  ).sort((left, right) => {
    if (left.edgeKind === right.edgeKind) {
      return 0;
    }

    return left.edgeKind === "return" ? -1 : 1;
  });

  for (const rule of matchingRules) {
    if (
      strictHandleRoles &&
      (rule.sourceHandleRole !== sourceHandleRole || rule.targetHandleRole !== targetHandleRole)
    ) {
      continue;
    }

    if (
      rule.requiresExistingDirectFlowEdgeFromTargetToSource &&
      !hasDirectWorkflowFlowEdge(input.existingEdges ?? [], input.targetNodeId, input.sourceNodeId, input.currentEdgeId)
    ) {
      return rejectWorkflowRelationship("relationship.tool_result_requires_caller");
    }

    if (
      rule.requiresExistingFlowPathFromTargetToSource &&
      !hasWorkflowFlowPath(input.existingEdges ?? [], input.targetNodeId, input.sourceNodeId, input.currentEdgeId)
    ) {
      continue;
    }

    if (
      rule.rejectsTargetWhenTargetCallsSource &&
      hasDirectWorkflowFlowEdge(input.existingEdges ?? [], input.targetNodeId, input.sourceNodeId, input.currentEdgeId)
    ) {
      return rejectWorkflowRelationship("relationship.intent_cannot_target_caller");
    }

    return {
      allowed: true,
      ruleId: rule.id,
      edgeKind: rule.edgeKind,
      sourceHandleRole: rule.sourceHandleRole,
      targetHandleRole: rule.targetHandleRole,
      autoCreateCompanionEdges: rule.autoCreateCompanionEdges ?? [],
    };
  }

  if (strictHandleRoles && matchingRules.length > 0) {
    return rejectWorkflowRelationship("relationship.invalid_handle");
  }

  return rejectWorkflowRelationship("relationship.unsupported");
}

function rejectWorkflowRelationship(
  reasonCode: WorkflowRelationshipRejectionCode,
): WorkflowNodeRelationshipDecision {
  switch (reasonCode) {
    case "relationship.entry_must_start_with_agent":
      return {
        allowed: false,
        reasonCode,
        message: "Inbound calls must start with an agent.",
        suggestion: "Connect the entry node to the first agent role.",
      };
    case "relationship.entry_cannot_receive_route":
      return {
        allowed: false,
        reasonCode,
        message: "Entry nodes cannot receive workflow routes.",
        suggestion: "Route back to an agent, handoff, escalation, or exit instead.",
      };
    case "relationship.intent_requires_agent_source":
      return {
        allowed: false,
        reasonCode,
        message: "Intent routes can only be placed after an agent.",
        suggestion: "Connect the agent that determines the intent to the intent route.",
      };
    case "relationship.intent_uses_flow_handles":
      return {
        allowed: false,
        reasonCode,
        message: "Intent routes use normal flow handles, not tool handles.",
        suggestion: "Use the horizontal flow handles for intent routing.",
      };
    case "relationship.intent_invalid_target":
      return {
        allowed: false,
        reasonCode,
        message: "Intent route branches cannot target that node type.",
        suggestion: "Route intent branches to agents, handoffs, escalations, or exits.",
      };
    case "relationship.intent_cannot_target_caller":
      return {
        allowed: false,
        reasonCode,
        message: "Intent routes cannot target the agent that produced the intent.",
        suggestion: "Choose a downstream agent, handoff, escalation, or exit for this branch.",
      };
    case "relationship.tool_call_requires_tool_handles":
      return {
        allowed: false,
        reasonCode,
        message: "Tool calls must use the agent tool-call handle and tool call handle.",
        suggestion: "Create tools from an agent so the call and return edges are created together.",
      };
    case "relationship.tool_result_requires_caller":
      return {
        allowed: false,
        reasonCode,
        message: "Tool results can only return to the agent that called the tool.",
        suggestion: "Connect the tool result back to its calling agent.",
      };
    case "relationship.tool_result_uses_result_handles":
      return {
        allowed: false,
        reasonCode,
        message: "Tool results must use the tool result handle and agent result handle.",
        suggestion: "Use the tool result handles so the edge is treated as a return path.",
      };
    case "relationship.invalid_handle":
      return {
        allowed: false,
        reasonCode,
        message: "This relationship uses the wrong handles.",
        suggestion: "Use the handles assigned to this relationship type.",
      };
    default:
      return {
        allowed: false,
        reasonCode,
        message: "These node types cannot be connected.",
        suggestion: "Choose a relationship that is supported by the workflow policy.",
      };
  }
}

function isIntentRouteTargetKind(kind: WorkflowNodeKind): boolean {
  return kind === "agent" || kind === "handoff" || kind === "human-escalation" || kind === "end";
}

function hasDirectWorkflowFlowEdge(
  edges: WorkflowEdge[],
  sourceNodeId: string,
  targetNodeId: string,
  currentEdgeId?: string | undefined,
): boolean {
  return edges.some(
    (edge) =>
      edge.id !== currentEdgeId &&
      edge.sourceNodeId === sourceNodeId &&
      edge.targetNodeId === targetNodeId &&
      edge.kind !== "return",
  );
}

function hasWorkflowFlowPath(
  edges: WorkflowEdge[],
  startNodeId: string,
  targetNodeId: string,
  currentEdgeId?: string | undefined,
): boolean {
  const edgesBySource = new Map<string, WorkflowEdge[]>();

  for (const edge of edges) {
    if (edge.id === currentEdgeId || edge.kind === "return") {
      continue;
    }

    const group = edgesBySource.get(edge.sourceNodeId) ?? [];
    group.push(edge);
    edgesBySource.set(edge.sourceNodeId, group);
  }

  const queue = [startNodeId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift();

    if (nodeId === undefined || visited.has(nodeId)) {
      continue;
    }

    if (nodeId === targetNodeId) {
      return true;
    }

    visited.add(nodeId);

    for (const edge of edgesBySource.get(nodeId) ?? []) {
      queue.push(edge.targetNodeId);
    }
  }

  return false;
}

function cloneAgentRoleConfig(role: AgentRoleNodeConfig): AgentRoleNodeConfig {
  return {
    kind: role.kind,
    name: role.name,
    businessName: role.businessName ?? "",
    instructions: role.instructions,
    defaultModelTier: role.defaultModelTier,
    ...(role.modelProvider !== undefined ? { modelProvider: role.modelProvider } : {}),
    ...(role.modelId !== undefined && role.modelId.trim().length > 0
      ? { modelId: role.modelId.trim() }
      : {}),
    ...(role.realtimeProvider !== undefined ? { realtimeProvider: role.realtimeProvider } : {}),
    ...(role.realtimeModelId !== undefined && role.realtimeModelId.trim().length > 0
      ? { realtimeModelId: role.realtimeModelId.trim() }
      : {}),
    ...(role.runtimeProfileOverride !== undefined ? { runtimeProfileOverride: role.runtimeProfileOverride } : {}),
    ...(role.voiceConfig !== undefined ? { voiceConfig: cloneAgentVoiceConfig(role.voiceConfig) } : {}),
    languagePolicy: {
      defaultLanguage: role.languagePolicy.defaultLanguage,
      supportedLanguages: [...role.languagePolicy.supportedLanguages],
      allowMidCallSwitching: role.languagePolicy.allowMidCallSwitching,
      ...(role.languagePolicy.languagePrompts !== undefined
        ? { languagePrompts: { ...role.languagePolicy.languagePrompts } }
        : {}),
    },
    reusableSpecialist: role.reusableSpecialist,
    ...(role.specialistTemplateId !== undefined ? { specialistTemplateId: role.specialistTemplateId } : {}),
    ...(role.specialistTemplateVersion !== undefined
      ? { specialistTemplateVersion: role.specialistTemplateVersion }
      : {}),
  };
}

function cloneAgentVoiceConfig(voiceConfig: AgentVoiceConfig): AgentVoiceConfig {
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

export function createWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    id: graph.id,
    name: graph.name,
    nodes: graph.nodes.map(cloneNode),
    edges: graph.edges.map(cloneEdge),
  };
}

export function createAgentRoleNode(input: CreateAgentRoleNodeInput): WorkflowNode {
  const node: WorkflowNode = {
    id: input.id,
    kind: "agent",
    label: input.label,
    position: { ...input.position },
    config: {
      role: {
        ...cloneAgentRoleConfig(input.role),
      },
    },
  };

  if (input.roleId !== undefined) {
    node.roleId = input.roleId;
  }

  return node;
}

export function createSpecialistRoleTemplate(
  input: CreateSpecialistRoleTemplateInput,
): SpecialistRoleTemplate {
  const templateName = input.role.name.trim();
  const duplicateTemplate = input.existingTemplates.find(
    (template) =>
      template.workspaceId === input.workspaceId &&
      template.name.trim().toLocaleLowerCase() === templateName.toLocaleLowerCase(),
  );

  if (duplicateTemplate !== undefined) {
    throw new Error(`Specialist template '${templateName}' already exists in this workspace.`);
  }

  return {
    id: input.id,
    workspaceId: input.workspaceId,
    name: templateName,
    version: 1,
    role: cloneAgentRoleConfig({
      ...input.role,
      reusableSpecialist: true,
      specialistTemplateId: input.id,
      specialistTemplateVersion: 1,
    }),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function updateSpecialistRoleTemplate(
  template: SpecialistRoleTemplate,
  input: UpdateSpecialistRoleTemplateInput,
): SpecialistRoleTemplate {
  const version = template.version + 1;

  return {
    ...template,
    name: input.role.name.trim(),
    version,
    role: cloneAgentRoleConfig({
      ...input.role,
      reusableSpecialist: true,
      specialistTemplateId: template.id,
      specialistTemplateVersion: version,
    }),
    updatedAt: input.updatedAt,
  };
}

export function applySpecialistRoleTemplate(template: SpecialistRoleTemplate): AgentRoleNodeConfig {
  return cloneAgentRoleConfig({
    ...template.role,
    reusableSpecialist: true,
    specialistTemplateId: template.id,
    specialistTemplateVersion: template.version,
  });
}

export function createToolNode(input: CreateToolNodeInput): WorkflowNode {
  const tool: ToolNodeConfig = {
    connector: input.tool.connector,
    toolName: input.tool.toolName,
    connectionStatus: input.tool.connectionStatus,
    risk: input.tool.risk,
    requiresAuthorization: input.tool.requiresAuthorization,
    requiresHumanApproval: input.tool.requiresHumanApproval,
    ...(input.tool.integrationConnectionId !== undefined
      ? { integrationConnectionId: input.tool.integrationConnectionId }
      : {}),
    ...(input.tool.integrationLabel !== undefined
      ? { integrationLabel: input.tool.integrationLabel }
      : {}),
    ...(input.tool.request !== undefined
      ? { request: cloneToolRequestConfig(input.tool.request) }
      : {}),
    ...(input.tool.additionalTools !== undefined
      ? { additionalTools: cloneAdditionalToolConfigs(input.tool.additionalTools) }
      : {}),
  };

  return {
    id: input.id,
    kind: "tool",
    label: input.label,
    position: { ...input.position },
    toolId: input.toolId,
    config: {
      tool,
    },
  };
}

export function createHandoffNode(input: CreateHandoffNodeInput): WorkflowNode {
  return {
    id: input.id,
    kind: "handoff",
    label: input.label,
    position: { ...input.position },
    config: {
      handoff: {
        targetRoleId: input.handoff.targetRoleId,
        targetRoleName: input.handoff.targetRoleName,
        handoffReason: input.handoff.handoffReason,
      },
    },
  };
}

export function createHumanEscalationNode(input: CreateHumanEscalationNodeInput): WorkflowNode {
  return {
    id: input.id,
    kind: "human-escalation",
    label: input.label,
    position: { ...input.position },
    config: {
      escalation: {
        queueId: input.escalation.queueId,
        queueName: input.escalation.queueName,
        fallbackMode: input.escalation.fallbackMode,
        fallbackMessage: input.escalation.fallbackMessage,
      },
    },
  };
}

export function createConditionNode(input: CreateConditionNodeInput): WorkflowNode {
  return {
    id: input.id,
    kind: "condition",
    label: input.label,
    position: { ...input.position },
    config: {
      condition: {
        ...(input.condition.classifier !== undefined ? { classifier: { ...input.condition.classifier } } : {}),
        ...(input.condition.inputWindow !== undefined ? { inputWindow: { ...input.condition.inputWindow } } : {}),
        branches: input.condition.branches.map(cloneConditionBranchConfig),
        fallbackLabel: input.condition.fallbackLabel,
        fallbackTargetNodeId: input.condition.fallbackTargetNodeId,
      },
    },
  };
}

export function createEndNode(input: CreateEndNodeInput): WorkflowNode {
  return {
    id: input.id,
    kind: "end",
    label: input.label,
    position: { ...input.position },
    config: {
      end: {
        outcome: input.end.outcome,
        closingMessage: input.end.closingMessage,
      },
    },
  };
}

export function addWorkflowNode(graph: WorkflowGraph, node: WorkflowNode): WorkflowGraph {
  if (graph.nodes.some((existingNode) => existingNode.id === node.id)) {
    throw new Error(`Workflow node '${node.id}' already exists.`);
  }

  return createWorkflowGraph({
    ...graph,
    nodes: [...graph.nodes, node],
  });
}

export function moveWorkflowNode(
  graph: WorkflowGraph,
  nodeId: string,
  position: WorkflowNodePosition,
): WorkflowGraph {
  return createWorkflowGraph({
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            position: { ...position },
          }
        : node,
    ),
  });
}

export function connectWorkflowNodes(graph: WorkflowGraph, edge: WorkflowEdge): WorkflowGraph {
  const alreadyConnected = graph.edges.some((existingEdge) => existingEdge.id === edge.id);

  if (alreadyConnected) {
    return createWorkflowGraph(graph);
  }

  return createWorkflowGraph({
    ...graph,
    edges: [...graph.edges, edge],
  });
}

export function reconnectWorkflowEdge(
  graph: WorkflowGraph,
  edgeId: string,
  connection: {
    sourceNodeId: string;
    targetNodeId: string;
  },
): WorkflowGraph {
  return createWorkflowGraph({
    ...graph,
    edges: graph.edges.map((edge) =>
      edge.id === edgeId
        ? {
            ...edge,
            sourceNodeId: connection.sourceNodeId,
            targetNodeId: connection.targetNodeId,
          }
        : edge,
    ),
  });
}

export function deleteWorkflowNode(graph: WorkflowGraph, nodeId: string): WorkflowGraph {
  return createWorkflowGraph({
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
  });
}

export function serializeWorkflowGraph(graph: WorkflowGraph): string {
  const normalizedGraph = {
    id: graph.id,
    name: graph.name,
    nodes: [...graph.nodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) =>
        omitUndefined({
          id: node.id,
          kind: node.kind,
          label: node.label,
          position: {
            x: node.position.x,
            y: node.position.y,
          },
          roleId: node.roleId,
          toolId: node.toolId,
          config: normalizeValue(node.config),
        }),
      ),
    edges: [...graph.edges]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) =>
        omitUndefined({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          kind: edge.kind,
          sourceHandleRole: edge.sourceHandleRole,
          targetHandleRole: edge.targetHandleRole,
          condition: edge.condition,
        }),
      ),
  };

  return JSON.stringify(normalizedGraph);
}

export function validateWorkflowGraph(graph: WorkflowGraph): WorkflowValidationResult {
  const errors: WorkflowValidationError[] = [];
  const nodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      duplicateNodeIds.add(node.id);
    }

    nodeIds.add(node.id);
  }

  for (const nodeId of duplicateNodeIds) {
    errors.push({
      code: "workflow.duplicate_node_id",
      nodeId,
      message: `Node '${nodeId}' is duplicated.`,
      suggestion: "Keep one node with this identifier before publishing.",
    });
  }

  const entryNodes = graph.nodes.filter((node) => node.kind === "entry");

  if (entryNodes.length === 0) {
    errors.push({
      code: "workflow.missing_entry",
      message: "Workflow has no entry node.",
      suggestion: "Add one entry node so inbound or outbound calls know where to start.",
    });
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.sourceNodeId)) {
      errors.push({
        code: "workflow.edge_missing_source",
        edgeId: edge.id,
        message: `Edge '${edge.id}' references a missing source node.`,
        suggestion: "Reconnect or remove this edge before publishing.",
      });
    }

    if (!nodeIds.has(edge.targetNodeId)) {
      errors.push({
        code: "workflow.edge_missing_target",
        edgeId: edge.id,
        message: `Edge '${edge.id}' references a missing target node.`,
        suggestion: "Reconnect or remove this edge before publishing.",
      });
    }
  }

  errors.push(...validateWorkflowRelationshipEdges(graph));

  const reachableIds = collectReachableNodeIds(graph, entryNodes[0]?.id);

  if (entryNodes.length > 0) {
    for (const node of graph.nodes) {
      if (!reachableIds.has(node.id)) {
        errors.push({
          code: "workflow.unreachable_node",
          nodeId: node.id,
          message: `Node '${node.label}' is not reachable from the entry path.`,
          suggestion: "Connect this node to the entry path or delete it from the draft.",
        });
      }
    }
  }

  errors.push(...findUnsafeCycleErrors(graph));
  errors.push(...validateAgentNodes(graph.nodes));
  errors.push(...validateToolNodes(graph.nodes));
  errors.push(...validateHandoffNodes(graph));
  errors.push(...validateConditionNodes(graph));
  errors.push(...validateEscalationNodes(graph.nodes));

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function buildDraftWorkflowManifest(graph: WorkflowGraph): DraftWorkflowManifest {
  const entryNodeId = graph.nodes.find((node) => node.kind === "entry")?.id;

  return {
    entryNodeId,
    entryRoleId: findFirstReachableAgentId(graph, entryNodeId),
    tools: graph.nodes
      .filter((node) => node.kind === "tool")
      .flatMap((node) => buildDraftToolBindings(node)),
    handoffs: graph.nodes
      .filter((node) => node.kind === "handoff")
      .map((node) => buildDraftHandoff(node)),
    conditions: graph.nodes
      .filter((node) => node.kind === "condition")
      .map((node) => buildDraftConditionRoute(node)),
    exitNodes: graph.nodes
      .filter((node) => node.kind === "end")
      .map((node) => buildDraftExitNode(node)),
    escalation: buildDraftEscalationPolicy(graph.nodes.find((node) => node.kind === "human-escalation")),
    returnRoutes: graph.edges
      .filter((edge) => edge.kind === "return")
      .map((edge) => buildDraftReturnRoute(edge)),
  };
}

export function buildRuntimeManifestPreview(
  input: BuildRuntimeManifestPreviewInput,
): RuntimeManifestPreview {
  const draftManifest = buildDraftWorkflowManifest(input.graph);
  const validation = validateWorkflowGraph(input.graph);
  const warnings: string[] = [];
  const scope = input.scope ?? "draft";

  if (input.budget.currentSpendUsd > input.budget.monthlyCapUsd) {
    warnings.push("budget.limit_exceeded");
  }

  if (scope === "draft" && input.environment === "production" && input.telephonyProvider === "browser-webrtc") {
    warnings.push("telephony.preview_only");
  }

  return {
    ...draftManifest,
    manifestId:
      scope === "published" && input.publishedVersionId !== undefined
        ? `${input.publishedVersionId}:manifest`
        : `${input.workflowId}:draft-preview`,
    workflowId: input.workflowId,
    scope,
    tenantId: input.tenantId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    environment: input.environment,
    runtime: input.runtime,
    runtimeProfile: input.runtimeProfile ?? inferRuntimeProfileFromRuntime(input.runtime),
    telephonyProvider: input.telephonyProvider,
    memory: cloneMemoryPreviewConfig(input.memory),
    budget: cloneBudgetPreviewConfig(input.budget),
    validation,
    warnings,
    ...(input.publishedVersionId !== undefined
      ? { publishedVersionId: input.publishedVersionId }
      : {}),
  };
}

export function publishWorkflowVersion(
  input: PublishWorkflowVersionInput,
): PublishedWorkflowVersion {
  const validation = validateWorkflowGraph(input.graph);

  if (!validation.ok) {
    throw new Error("Workflow must validate before it can publish.");
  }

  const versionNumber =
    input.existingVersions.reduce(
      (highestVersion, version) => Math.max(highestVersion, version.version),
      0,
    ) + 1;
  const versionId = `${input.workflowId}-v${versionNumber}`;
  const graph = createWorkflowGraph(input.graph);
  const manifestPreview = buildRuntimeManifestPreview({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    environment: input.environment,
    workflowId: input.workflowId,
    graph,
    runtime: input.runtime,
    runtimeProfile: input.runtimeProfile,
    telephonyProvider: input.telephonyProvider,
    memory: input.memory,
    budget: input.budget,
    scope: "published",
    publishedVersionId: versionId,
  });

  return {
    id: versionId,
    tenantId: input.tenantId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    version: versionNumber,
    graph,
    roles: deriveVoiceAgentRoles(graph),
    tools: deriveToolDefinitions(graph),
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy,
    serializedGraph: serializeWorkflowGraph(graph),
    manifestPreview,
  };
}

export function pinPublishedWorkflowVersion(input: {
  callSessionId: ID;
  publishedVersion: PublishedWorkflowVersion;
  pinnedAt?: string | undefined;
}): PinnedPublishedWorkflowVersion {
  return {
    callSessionId: input.callSessionId,
    publishedVersionId: input.publishedVersion.id,
    version: input.publishedVersion.version,
    ...(input.publishedVersion.workspaceId !== undefined ? { workspaceId: input.publishedVersion.workspaceId } : {}),
    graph: createWorkflowGraph(input.publishedVersion.graph),
    manifestPreview: deepClone(input.publishedVersion.manifestPreview),
    pinnedAt: input.pinnedAt ?? new Date().toISOString(),
  };
}

export function filterPublishedWorkflowVersionsForWorkspace(input: {
  versions: PublishedWorkflowVersion[];
  tenantId: ID;
  workspaceId: ID;
}): PublishedWorkflowVersion[] {
  return input.versions.filter(
    (version) => version.tenantId === input.tenantId && version.workspaceId === input.workspaceId,
  );
}

export function resolveConditionBranch(
  node: WorkflowNode,
  context: ConditionRouteContext,
): ConditionRouteSelection {
  const condition = getConditionNodeConfig(node);

  if (node.kind !== "condition" || condition === undefined) {
    throw new Error(`Node '${node.id}' is not a condition node.`);
  }

  for (const branch of condition.branches) {
    const parsedExpression = parseConditionExpression(branch.expression);

    if (parsedExpression !== null && evaluateConditionExpression(parsedExpression, context)) {
      return {
        branchId: branch.id,
        label: branch.label,
        targetNodeId: branch.targetNodeId,
        isFallback: false,
        matchedExpression: branch.expression,
      };
    }
  }

  return {
    branchId: "fallback",
    label: condition.fallbackLabel,
    targetNodeId: condition.fallbackTargetNodeId,
    isFallback: true,
  };
}

function validateAgentNodes(nodes: WorkflowNode[]): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const roleNames = new Map<string, string>();

  for (const node of nodes) {
    if (node.kind !== "agent") {
      continue;
    }

    const role = getAgentRoleConfig(node);
    const roleName = role?.name.trim() ?? "";
    const businessName = role?.businessName.trim() ?? "";
    const instructions = role?.instructions.trim() ?? "";
    const defaultLanguage = role?.languagePolicy.defaultLanguage.trim() ?? "";
    const supportedLanguages = role?.languagePolicy.supportedLanguages ?? [];
    const languagePrompts = role?.languagePolicy.languagePrompts ?? {};

    if (roleName.length === 0) {
      errors.push({
        code: "agent.missing_name",
        nodeId: node.id,
        message: `Agent node '${node.label}' has no role name.`,
        suggestion: "Add a role name that operators can recognize in monitoring and handoffs.",
      });
    } else {
      const normalizedName = roleName.toLocaleLowerCase();
      const existingNodeId = roleNames.get(normalizedName);

      if (existingNodeId !== undefined) {
        errors.push({
          code: "agent.duplicate_name",
          nodeId: node.id,
          message: `Agent role '${roleName}' is used by more than one node.`,
          suggestion: "Rename one specialist or reuse the existing specialist role intentionally.",
        });
      } else {
        roleNames.set(normalizedName, node.id);
      }
    }

    if (businessName.length === 0) {
      errors.push({
        code: "agent.missing_business_name",
        nodeId: node.id,
        message: `Agent role '${node.label}' has no business name.`,
        suggestion: "Add the agency, company, or business name the caller should hear.",
      });
    }

    if (instructions.length === 0) {
      errors.push({
        code: "agent.missing_instructions",
        nodeId: node.id,
        message: `Agent role '${node.label}' has no instructions.`,
        suggestion: "Write the operating instructions this specialist should follow before publishing.",
      });
    }

    if (role?.defaultModelTier === undefined) {
      errors.push({
        code: "agent.missing_model_tier",
        nodeId: node.id,
        message: `Agent role '${node.label}' has no default model tier.`,
        suggestion: "Choose cheap, standard, or sota routing for this specialist.",
      });
    }

    if (defaultLanguage.length === 0) {
      errors.push({
        code: "agent.missing_default_language",
        nodeId: node.id,
        message: `Agent role '${node.label}' has no default language.`,
        suggestion: "Choose the language this specialist should start with.",
      });
    }

    if (supportedLanguages.length === 0) {
      errors.push({
        code: "agent.missing_supported_language",
        nodeId: node.id,
        message: `Agent role '${node.label}' has no supported languages.`,
        suggestion: "Add at least one supported language before publishing.",
      });
    }

    if (defaultLanguage.length > 0 && supportedLanguages.length > 0 && !supportedLanguages.includes(defaultLanguage)) {
      errors.push({
        code: "agent.default_language_not_supported",
        nodeId: node.id,
        message: `Agent role '${node.label}' default language is not in its supported languages.`,
        suggestion: "Keep the default fallback language in the supported-language list.",
      });
    }

    const seenLanguages = new Set<string>();
    for (const language of supportedLanguages) {
      const normalizedLanguage = language.trim().toLocaleLowerCase();

      if (normalizedLanguage.length === 0) {
        continue;
      }

      if (seenLanguages.has(normalizedLanguage)) {
        errors.push({
          code: "agent.duplicate_language",
          nodeId: node.id,
          message: `Agent role '${node.label}' lists language '${language}' more than once.`,
          suggestion: "Remove duplicate supported-language entries before publishing.",
        });
        break;
      }

      seenLanguages.add(normalizedLanguage);
    }

    for (const language of [defaultLanguage, ...supportedLanguages]) {
      if (language.length > 0 && !languageCodePattern.test(language)) {
        errors.push({
          code: "agent.unsupported_language",
          nodeId: node.id,
          message: `Agent role '${node.label}' uses unsupported language code '${language}'.`,
          suggestion: "Use ISO-style language codes such as en, fr, es, or en-US.",
        });
      }
    }

    for (const [language, prompt] of Object.entries(languagePrompts)) {
      if (prompt.trim().length === 0) {
        errors.push({
          code: "agent.missing_language_prompt",
          nodeId: node.id,
          message: `Agent role '${node.label}' has no prompt text for language '${language}'.`,
          suggestion: "Remove the empty language prompt or write the language-specific prompt text.",
        });
      }
    }

    if (role?.voiceConfig !== undefined && !isAgentVoiceConfigPublishable(role.voiceConfig)) {
      errors.push({
        code: "agent.voice_unavailable",
        nodeId: node.id,
        message: `Agent role '${node.label}' uses a cloned voice that is not approved for publishing.`,
        suggestion: "Choose an approved voice or complete clone approval before publishing this workflow.",
      });
    }
  }

  return errors;
}

function isAgentVoiceConfigPublishable(voiceConfig: AgentVoiceConfig): boolean {
  return voiceConfig.sourceType !== "cloned" || voiceConfig.cloneStatus === "approved";
}

function validateToolNodes(nodes: WorkflowNode[]): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  for (const node of nodes) {
    if (node.kind !== "tool") {
      continue;
    }

    if ((node.toolId?.trim() ?? "").length === 0) {
      errors.push({
        code: "tool.missing_binding",
        nodeId: node.id,
        message: `Tool node '${node.label}' is not bound to a permitted integration tool.`,
        suggestion: "Choose a permitted connector tool before publishing.",
      });
      continue;
    }

    const tool = getToolNodeConfig(node);
    const requiresAuthorization =
      tool?.requiresAuthorization ?? node.config["requiresAuthorization"] === true;
    const hasCredential =
      typeof tool?.integrationConnectionId === "string" ||
      typeof node.config["authorizationRef"] === "string" ||
      typeof node.config["integrationConnectionId"] === "string";
    const connectionStatus = tool?.connectionStatus;
    const request = tool?.request;
    const requiresRequestConfig = tool?.connector === "webhook" || request !== undefined;

    if (connectionStatus === "revoked") {
      errors.push({
        code: "tool.revoked_connection",
        nodeId: node.id,
        message: `Tool node '${node.label}' is bound to a revoked integration connection.`,
        suggestion: "Reconnect or replace the revoked integration before publishing.",
      });
    }

    if (requiresAuthorization && !hasCredential) {
      errors.push({
        code: "tool.missing_authorization",
        nodeId: node.id,
        message: `Tool node '${node.label}' has no authorized integration connection.`,
        suggestion: "Connect an authorized integration account before this workflow can publish.",
      });
    }

    if (requiresRequestConfig) {
      if ((request?.method.trim() ?? "").length === 0) {
        errors.push({
          code: "tool.missing_request_method",
          nodeId: node.id,
          message: `Tool node '${node.label}' has no request method.`,
          suggestion: "Choose the HTTP method this tool request should use before publishing.",
        });
      }

      if ((request?.url.trim() ?? "").length === 0) {
        errors.push({
          code: "tool.missing_request_url",
          nodeId: node.id,
          message: `Tool node '${node.label}' has no request URL.`,
          suggestion: "Set the destination URL for this tool request before publishing.",
        });
      }

      if ((request?.authToken.trim() ?? "").length === 0) {
        errors.push({
          code: "tool.missing_request_auth_token",
          nodeId: node.id,
          message: `Tool node '${node.label}' has no request auth token.`,
          suggestion: "Provide the auth token or secret reference this tool request needs before publishing.",
        });
      }

      const validHeaders =
        request?.headers.filter(
          (header) => header.name.trim().length > 0 && header.value.trim().length > 0,
        ) ?? [];

      if (validHeaders.length === 0) {
        errors.push({
          code: "tool.missing_request_headers",
          nodeId: node.id,
          message: `Tool node '${node.label}' has no request headers.`,
          suggestion: "Add at least one request header before publishing this tool call.",
        });
      }
    }
  }

  return errors;
}

function validateWorkflowRelationshipEdges(graph: WorkflowGraph): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));

  for (const edge of graph.edges) {
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);

    if (sourceNode === undefined || targetNode === undefined) {
      continue;
    }

    const decision = decideWorkflowNodeRelationship({
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceKind: sourceNode.kind,
      targetKind: targetNode.kind,
      requestedEdgeKind: edge.kind ?? "flow",
      sourceHandleRole: edge.sourceHandleRole,
      targetHandleRole: edge.targetHandleRole,
      strictHandleRoles: edge.sourceHandleRole !== undefined || edge.targetHandleRole !== undefined,
      existingEdges: graph.edges,
      currentEdgeId: edge.id,
    });

    if (decision.allowed) {
      continue;
    }

    errors.push({
      code: decision.reasonCode,
      edgeId: edge.id,
      message: decision.message,
      suggestion: decision.suggestion,
    });
  }

  return errors;
}

function validateHandoffNodes(graph: WorkflowGraph): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));

  for (const node of graph.nodes) {
    if (node.kind !== "handoff") {
      continue;
    }

    const handoff = getHandoffNodeConfig(node);
    const targetRoleId = handoff?.targetRoleId.trim() ?? "";

    if (targetRoleId.length === 0) {
      errors.push({
        code: "handoff.missing_target",
        nodeId: node.id,
        message: `Handoff node '${node.label}' has no specialist target.`,
        suggestion: "Choose an existing specialist role for this handoff node before publishing.",
      });
      continue;
    }

    const targetNode = nodesById.get(targetRoleId);

    if (targetNode?.kind !== "agent") {
      errors.push({
        code: "handoff.invalid_target",
        nodeId: node.id,
        message: `Handoff node '${node.label}' targets a specialist that does not exist.`,
        suggestion: "Choose an existing specialist role for this handoff node before publishing.",
      });
    }
  }

  return errors;
}

function validateConditionNodes(graph: WorkflowGraph): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));

  for (const node of graph.nodes) {
    if (node.kind !== "condition") {
      continue;
    }

    const condition = getConditionNodeConfig(node);
    const branches = condition?.branches ?? [];

    if (branches.length === 0) {
      errors.push({
        code: "condition.missing_branch",
        nodeId: node.id,
        message: `Condition node '${node.label}' has no branches.`,
        suggestion: "Add at least one branch expression before publishing.",
      });
    }

    for (const branch of branches) {
      if (parseConditionExpression(branch.expression) === null) {
        errors.push({
          code: "condition.invalid_expression",
          nodeId: node.id,
          message: `Condition node '${node.label}' has an invalid branch expression '${branch.expression}'.`,
          suggestion: 'Use expressions like intent == "billing" or language == "fr".',
        });
      }

      const branchTargetNode = nodesById.get(branch.targetNodeId);
      const branchRelationship =
        branchTargetNode !== undefined
          ? decideWorkflowNodeRelationship({
              sourceNodeId: node.id,
              targetNodeId: branchTargetNode.id,
              sourceKind: node.kind,
              targetKind: branchTargetNode.kind,
              requestedEdgeKind: "flow",
              existingEdges: graph.edges,
            })
          : null;

      if (
        branch.targetNodeId.trim().length === 0 ||
        branchTargetNode === undefined ||
        branchRelationship?.allowed === false
      ) {
        errors.push({
          code: "condition.invalid_target",
          nodeId: node.id,
          message: `Condition node '${node.label}' points to a missing branch target.`,
          suggestion:
            branchRelationship?.allowed === false
              ? branchRelationship.suggestion
              : "Point each branch at an existing workflow node before publishing.",
        });
      }
    }

    if (
      (condition?.fallbackTargetNodeId.trim() ?? "").length === 0 ||
      (condition?.fallbackLabel.trim() ?? "").length === 0
    ) {
      errors.push({
        code: "condition.missing_fallback",
        nodeId: node.id,
        message: `Condition node '${node.label}' has no fallback branch.`,
        suggestion: "Add a fallback branch so unmatched callers still have a deterministic route.",
      });
      continue;
    }

    const fallbackTargetNode =
      condition !== undefined ? nodesById.get(condition.fallbackTargetNodeId) : undefined;
    const fallbackRelationship =
      condition !== undefined && fallbackTargetNode !== undefined
        ? decideWorkflowNodeRelationship({
            sourceNodeId: node.id,
            targetNodeId: fallbackTargetNode.id,
            sourceKind: node.kind,
            targetKind: fallbackTargetNode.kind,
            requestedEdgeKind: "flow",
            existingEdges: graph.edges,
          })
        : null;

    if (
      condition === undefined ||
      fallbackTargetNode === undefined ||
      fallbackRelationship?.allowed === false
    ) {
      errors.push({
        code: "condition.invalid_fallback",
        nodeId: node.id,
        message: `Condition node '${node.label}' points to a missing fallback node.`,
        suggestion:
          fallbackRelationship?.allowed === false
            ? fallbackRelationship.suggestion
            : "Point the fallback branch to an existing workflow node before publishing.",
      });
    }
  }

  return errors;
}

function validateEscalationNodes(nodes: WorkflowNode[]): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  for (const node of nodes) {
    if (node.kind !== "human-escalation") {
      continue;
    }

    const escalation = getHumanEscalationNodeConfig(node);

    if ((escalation?.queueId.trim() ?? "").length === 0) {
      errors.push({
        code: "escalation.missing_queue",
        nodeId: node.id,
        message: `Escalation node '${node.label}' has no queue binding.`,
        suggestion: "Bind this escalation to a live queue before publishing.",
      });
    }

    if ((escalation?.fallbackMessage.trim() ?? "").length === 0) {
      errors.push({
        code: "escalation.missing_fallback_message",
        nodeId: node.id,
        message: `Escalation node '${node.label}' has no fallback message.`,
        suggestion: "Add the callback or fallback language the caller should hear when humans are unavailable.",
      });
    }
  }

  return errors;
}

function collectReachableNodeIds(graph: WorkflowGraph, entryNodeId: string | undefined): Set<string> {
  const reachableIds = new Set<string>();

  if (entryNodeId === undefined) {
    return reachableIds;
  }

  const edgesBySource = groupEdgesBySource(graph.edges);
  const queue = [entryNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();

    if (nodeId === undefined || reachableIds.has(nodeId)) {
      continue;
    }

    reachableIds.add(nodeId);

    for (const edge of edgesBySource.get(nodeId) ?? []) {
      queue.push(edge.targetNodeId);
    }
  }

  return reachableIds;
}

function findFirstReachableAgentId(graph: WorkflowGraph, entryNodeId: string | undefined): string | undefined {
  if (entryNodeId === undefined) {
    return undefined;
  }

  const edgesBySource = groupEdgesBySource(graph.edges);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const queue = [entryNodeId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift();

    if (nodeId === undefined || visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    const node = nodesById.get(nodeId);

    if (node?.kind === "agent") {
      return node.id;
    }

    for (const edge of edgesBySource.get(nodeId) ?? []) {
      queue.push(edge.targetNodeId);
    }
  }

  return undefined;
}

function findUnsafeCycleErrors(graph: WorkflowGraph): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const edgesBySource = groupEdgesBySource(graph.edges);
  const stateByNode = new Map<string, "visiting" | "visited">();

  const visit = (nodeId: string) => {
    stateByNode.set(nodeId, "visiting");

    for (const edge of edgesBySource.get(nodeId) ?? []) {
      if (edge.kind === "return") {
        continue;
      }

      const targetState = stateByNode.get(edge.targetNodeId);

      if (targetState === "visiting" && edge.condition === undefined) {
        errors.push({
          code: "workflow.unsafe_cycle",
          edgeId: edge.id,
          message: `Edge '${edge.id}' creates a cycle without an exit condition.`,
          suggestion: "Add an explicit exit condition or remove the loop before publishing.",
        });
        continue;
      }

      if (targetState === undefined) {
        visit(edge.targetNodeId);
      }
    }

    stateByNode.set(nodeId, "visited");
  };

  for (const node of graph.nodes) {
    if (stateByNode.get(node.id) === undefined) {
      visit(node.id);
    }
  }

  return errors;
}

function groupEdgesBySource(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const groups = new Map<string, WorkflowEdge[]>();

  for (const edge of edges) {
    const group = groups.get(edge.sourceNodeId) ?? [];
    group.push(edge);
    groups.set(edge.sourceNodeId, group);
  }

  return groups;
}

function getAgentRoleConfig(node: WorkflowNode): AgentRoleNodeConfig | undefined {
  const role = node.config["role"];

  if (typeof role !== "object" || role === null) {
    return undefined;
  }

  return role as AgentRoleNodeConfig;
}

function getToolNodeConfig(node: WorkflowNode): ToolNodeConfig | undefined {
  const tool = node.config["tool"];

  if (typeof tool !== "object" || tool === null) {
    return undefined;
  }

  return tool as ToolNodeConfig;
}

function getHandoffNodeConfig(node: WorkflowNode): HandoffNodeConfig | undefined {
  const handoff = node.config["handoff"];

  if (typeof handoff !== "object" || handoff === null) {
    return undefined;
  }

  return handoff as HandoffNodeConfig;
}

function getHumanEscalationNodeConfig(node: WorkflowNode): HumanEscalationNodeConfig | undefined {
  const escalation = node.config["escalation"];

  if (typeof escalation !== "object" || escalation === null) {
    return undefined;
  }

  return escalation as HumanEscalationNodeConfig;
}

function getConditionNodeConfig(node: WorkflowNode): ConditionNodeConfig | undefined {
  const condition = node.config["condition"];

  if (typeof condition !== "object" || condition === null) {
    return undefined;
  }

  return condition as ConditionNodeConfig;
}

function getEndNodeConfig(node: WorkflowNode): EndNodeConfig | undefined {
  const end = node.config["end"];

  if (typeof end !== "object" || end === null) {
    return undefined;
  }

  return end as EndNodeConfig;
}

function buildDraftToolBinding(node: WorkflowNode): DraftWorkflowToolBinding {
  const binding = getToolBindingConfigs(node)[0];

  return {
    nodeId: node.id,
    label: node.label,
    ...(binding?.toolId !== undefined ? { toolId: binding.toolId } : {}),
    connector: binding?.connector ?? "internal",
    toolName: binding?.toolName ?? node.label,
    ...(binding?.integrationConnectionId !== undefined
      ? { integrationConnectionId: binding.integrationConnectionId }
      : {}),
    ...(binding?.integrationLabel !== undefined ? { integrationLabel: binding.integrationLabel } : {}),
    risk: binding?.risk ?? "low",
    requiresHumanApproval: binding?.requiresHumanApproval ?? false,
    ...(binding?.request !== undefined
      ? {
          request: {
            method: binding.request.method,
            url: binding.request.url,
            headerCount: binding.request.headers.length,
            hasAuthToken: binding.request.authToken.trim().length > 0,
          },
        }
      : {}),
  };
}

function buildDraftToolBindings(node: WorkflowNode): DraftWorkflowToolBinding[] {
  const bindings = getToolBindingConfigs(node);

  return bindings.length === 0
    ? [buildDraftToolBinding(node)]
    : bindings.map((binding) => ({
        nodeId: node.id,
        label: binding.label,
        toolId: binding.toolId,
        connector: binding.connector,
        toolName: binding.toolName,
        ...(binding.integrationConnectionId !== undefined
          ? { integrationConnectionId: binding.integrationConnectionId }
          : {}),
        ...(binding.integrationLabel !== undefined ? { integrationLabel: binding.integrationLabel } : {}),
        risk: binding.risk,
        requiresHumanApproval: binding.requiresHumanApproval,
        ...(binding.request !== undefined
          ? {
              request: {
                method: binding.request.method,
                url: binding.request.url,
                headerCount: binding.request.headers.length,
                hasAuthToken: binding.request.authToken.trim().length > 0,
              },
            }
          : {}),
      }));
}

function buildDraftHandoff(node: WorkflowNode): DraftWorkflowHandoff {
  const handoff = getHandoffNodeConfig(node);

  return {
    nodeId: node.id,
    label: node.label,
    targetRoleId: handoff?.targetRoleId ?? "",
    targetRoleName: handoff?.targetRoleName ?? "",
    handoffReason: handoff?.handoffReason ?? "",
  };
}

function buildDraftConditionRoute(node: WorkflowNode): DraftWorkflowConditionRoute {
  const condition = getConditionNodeConfig(node);

  return {
    nodeId: node.id,
    label: node.label,
    ...(condition?.classifier !== undefined ? { classifier: { ...condition.classifier } } : {}),
    ...(condition?.inputWindow !== undefined ? { inputWindow: { ...condition.inputWindow } } : {}),
    branches: condition?.branches.map(cloneConditionBranchConfig) ?? [],
    fallbackLabel: condition?.fallbackLabel ?? "",
    fallbackTargetNodeId: condition?.fallbackTargetNodeId ?? "",
  };
}

function cloneConditionBranchConfig(branch: ConditionBranchConfig): ConditionBranchConfig {
  return {
    id: branch.id,
    label: branch.label,
    ...(branch.intentKey !== undefined ? { intentKey: branch.intentKey } : {}),
    ...(branch.description !== undefined ? { description: branch.description } : {}),
    ...(branch.examples !== undefined ? { examples: [...branch.examples] } : {}),
    expression: branch.expression,
    targetNodeId: branch.targetNodeId,
  };
}

function buildDraftExitNode(node: WorkflowNode): DraftWorkflowExitNode {
  const end = getEndNodeConfig(node);

  return {
    nodeId: node.id,
    label: node.label,
    outcome: end?.outcome ?? "resolved",
    closingMessage: end?.closingMessage ?? "",
  };
}

function buildDraftEscalationPolicy(
  escalationNode: WorkflowNode | undefined,
): DraftWorkflowEscalationPolicy | null {
  if (escalationNode?.kind !== "human-escalation") {
    return null;
  }

  const escalation = getHumanEscalationNodeConfig(escalationNode);

  if (escalation === undefined) {
    return null;
  }

  return {
    nodeId: escalationNode.id,
    label: escalationNode.label,
    enabled: true,
    queueId: escalation.queueId,
    queueName: escalation.queueName,
    fallbackMode: escalation.fallbackMode,
    fallbackMessage: escalation.fallbackMessage,
    triggers: ["user-request", "repeated-failure"],
  };
}

function buildDraftReturnRoute(edge: WorkflowEdge): DraftWorkflowReturnRoute {
  return {
    edgeId: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    ...(edge.condition !== undefined ? { condition: edge.condition } : {}),
  };
}

function deriveVoiceAgentRoles(graph: WorkflowGraph): VoiceAgentRole[] {
  const edgesBySource = groupEdgesBySource(graph.edges);
  const incomingHandoffs = new Map<string, string>();

  for (const node of graph.nodes) {
    if (node.kind !== "handoff") {
      continue;
    }

    const handoff = getHandoffNodeConfig(node);

    if (handoff !== undefined && handoff.targetRoleId.trim().length > 0) {
      incomingHandoffs.set(handoff.targetRoleId, handoff.handoffReason);
    }
  }

  return graph.nodes
    .filter((node) => node.kind === "agent")
    .map((node) => {
      const role = getAgentRoleConfig(node);
      const toolIds =
        edgesBySource
          .get(node.id)
          ?.map((edge) => graph.nodes.find((candidate) => candidate.id === edge.targetNodeId))
          .filter((candidate): candidate is WorkflowNode => candidate?.kind === "tool")
          .flatMap((toolNode) => getToolBindingConfigs(toolNode).map((binding) => binding.toolId)) ?? [];

      if (role === undefined) {
        return {
          id: node.roleId ?? node.id,
          kind: "custom",
          name: node.label,
          businessName: "",
          instructions: "",
          defaultModelTier: "cheap",
          toolIds,
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
        } satisfies VoiceAgentRole;
      }

      const handoffDescription = incomingHandoffs.get(node.id);

      return {
        id: node.roleId ?? node.id,
        kind: role.kind,
        name: role.name,
        businessName: role.businessName,
        instructions: role.instructions,
        ...(handoffDescription === undefined ? {} : { handoffDescription }),
        defaultModelTier: role.defaultModelTier,
        ...(role.modelProvider !== undefined ? { modelProvider: role.modelProvider } : {}),
        ...(role.modelId !== undefined && role.modelId.trim().length > 0
          ? { modelId: role.modelId.trim() }
          : {}),
        ...(role.realtimeProvider !== undefined ? { realtimeProvider: role.realtimeProvider } : {}),
        ...(role.realtimeModelId !== undefined && role.realtimeModelId.trim().length > 0
          ? { realtimeModelId: role.realtimeModelId.trim() }
          : {}),
        ...(role.runtimeProfileOverride !== undefined
          ? { runtimeProfileOverride: role.runtimeProfileOverride }
          : {}),
        ...(role.voiceConfig !== undefined ? { voiceConfig: cloneAgentVoiceConfig(role.voiceConfig) } : {}),
        toolIds,
        languagePolicy: {
          defaultLanguage: role.languagePolicy.defaultLanguage,
          supportedLanguages: [...role.languagePolicy.supportedLanguages],
          allowMidCallSwitching: role.languagePolicy.allowMidCallSwitching,
          ...(role.languagePolicy.languagePrompts !== undefined
            ? { languagePrompts: { ...role.languagePolicy.languagePrompts } }
            : {}),
        },
      } satisfies VoiceAgentRole;
    });
}

function deriveToolDefinitions(graph: WorkflowGraph): ToolDefinition[] {
  return graph.nodes
    .filter((node) => node.kind === "tool")
    .flatMap((node) =>
      getToolBindingConfigs(node).map((binding) => ({
        id: binding.toolId,
        name: binding.toolName,
        description: binding.toolName,
        connector: binding.connector,
        requiresHumanApproval: binding.requiresHumanApproval,
        risk: binding.risk,
      } satisfies ToolDefinition)),
    );
}

interface ToolBindingConfig {
  toolId: string;
  label: string;
  connector: ToolDefinition["connector"];
  toolName: string;
  integrationConnectionId?: string | undefined;
  integrationLabel?: string | undefined;
  risk: ToolDefinition["risk"];
  requiresHumanApproval: boolean;
  request?: ToolRequestConfig | undefined;
}

function getToolBindingConfigs(node: WorkflowNode): ToolBindingConfig[] {
  const tool = getToolNodeConfig(node);

  if (node.kind !== "tool" || tool === undefined || node.toolId === undefined) {
    return [];
  }

  const primary: ToolBindingConfig = {
    toolId: node.toolId,
    label: node.label,
    connector: tool.connector,
    toolName: tool.toolName,
    ...(tool.integrationConnectionId !== undefined ? { integrationConnectionId: tool.integrationConnectionId } : {}),
    ...(tool.integrationLabel !== undefined ? { integrationLabel: tool.integrationLabel } : {}),
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
      connector: tool.connector,
      toolName: additionalTool.toolName,
      ...(tool.integrationConnectionId !== undefined ? { integrationConnectionId: tool.integrationConnectionId } : {}),
      ...(tool.integrationLabel !== undefined ? { integrationLabel: tool.integrationLabel } : {}),
      risk: additionalTool.risk,
      requiresHumanApproval: additionalTool.requiresHumanApproval,
      ...(additionalTool.request !== undefined ? { request: additionalTool.request } : {}),
    } satisfies ToolBindingConfig));

  return [primary, ...additionalTools];
}

function parseConditionExpression(expression: string): ParsedConditionExpression | null {
  const match = conditionExpressionPattern.exec(expression);

  if (match === null) {
    return null;
  }

  const [, field, operator, value] = match;

  if (field === undefined || operator === undefined || value === undefined) {
    return null;
  }

  return {
    field,
    operator: operator as ParsedConditionExpression["operator"],
    value,
  };
}

function evaluateConditionExpression(
  expression: ParsedConditionExpression,
  context: ConditionRouteContext,
): boolean {
  const contextValue = readConditionContextValue(context, expression.field);
  const normalizedContextValue =
    typeof contextValue === "string" || typeof contextValue === "number" || typeof contextValue === "boolean"
      ? String(contextValue)
      : "";

  switch (expression.operator) {
    case "==":
      return normalizedContextValue === expression.value;
    case "!=":
      return normalizedContextValue !== expression.value;
    case "contains":
      return normalizedContextValue.includes(expression.value);
    default:
      return false;
  }
}

function readConditionContextValue(
  context: ConditionRouteContext,
  field: string,
): string | number | boolean | undefined {
  if (!field.includes(".")) {
    return context[field];
  }

  const segments = field.split(".");
  let currentValue: unknown = context;

  for (const segment of segments) {
    if (typeof currentValue !== "object" || currentValue === null) {
      return undefined;
    }

    currentValue = (currentValue as Record<string, unknown>)[segment];
  }

  if (
    typeof currentValue === "string" ||
    typeof currentValue === "number" ||
    typeof currentValue === "boolean"
  ) {
    return currentValue;
  }

  return undefined;
}

function cloneToolRequestConfig(request: ToolRequestConfig): ToolRequestConfig {
  return {
    method: request.method,
    url: request.url,
    authToken: request.authToken,
    headers: request.headers.map((header) => ({
      name: header.name,
      value: header.value,
    })),
    ...(request.bodyTemplate !== undefined ? { bodyTemplate: request.bodyTemplate } : {}),
  };
}

function cloneAdditionalToolConfigs(
  additionalTools: ToolNodeAdditionalToolConfig[],
): ToolNodeAdditionalToolConfig[] {
  return additionalTools.map((tool) => ({
    toolId: tool.toolId,
    toolName: tool.toolName,
    risk: tool.risk,
    requiresHumanApproval: tool.requiresHumanApproval,
    ...(tool.request !== undefined ? { request: cloneToolRequestConfig(tool.request) } : {}),
  }));
}

function cloneMemoryPreviewConfig(
  memory: RuntimeManifestPreviewMemoryConfig,
): RuntimeManifestPreviewMemoryConfig {
  return {
    mode: memory.mode,
    retrievalScopes: [...memory.retrievalScopes],
    approvalRequired: memory.approvalRequired,
  };
}

function cloneBudgetPreviewConfig(
  budget: RuntimeManifestPreviewBudgetConfig,
): RuntimeManifestPreviewBudgetConfig {
  return {
    monthlyCapUsd: budget.monthlyCapUsd,
    currentSpendUsd: budget.currentSpendUsd,
    projectedCostPerMinuteUsd: budget.projectedCostPerMinuteUsd,
    blockOnLimit: budget.blockOnLimit,
  };
}

function inferRuntimeProfileFromRuntime(runtime: VoiceRuntimeKind): RuntimeProfileId {
  return runtime === "openai-realtime" ? "premium-realtime" : "cost-optimized";
}

function cloneNode(node: WorkflowNode): WorkflowNode {
  const clonedNode: WorkflowNode = {
    id: node.id,
    kind: node.kind,
    label: node.label,
    position: { ...node.position },
    config: normalizeValue(node.config) as Record<string, unknown>,
  };

  if (node.roleId !== undefined) {
    clonedNode.roleId = node.roleId;
  }

  if (node.toolId !== undefined) {
    clonedNode.toolId = node.toolId;
  }

  return clonedNode;
}

function cloneEdge(edge: WorkflowEdge): WorkflowEdge {
  const clonedEdge: WorkflowEdge = {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
  };

  if (edge.condition !== undefined) {
    clonedEdge.condition = edge.condition;
  }

  if (edge.kind !== undefined) {
    clonedEdge.kind = edge.kind;
  }

  if (edge.sourceHandleRole !== undefined) {
    clonedEdge.sourceHandleRole = edge.sourceHandleRole;
  }

  if (edge.targetHandleRole !== undefined) {
    clonedEdge.targetHandleRole = edge.targetHandleRole;
  }

  return clonedEdge;
}

function deepClone<TValue>(value: TValue): TValue {
  return normalizeValue(value) as TValue;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const normalizedEntries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, entryValue]) => [key, normalizeValue(entryValue)] as const);

  return Object.fromEntries(normalizedEntries);
}

function omitUndefined<TValue extends Record<string, unknown>>(value: TValue): TValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue;
}
