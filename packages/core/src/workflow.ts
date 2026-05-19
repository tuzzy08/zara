import type {
  AgentRoleKind,
  EscalationFallbackMode,
  EscalationPolicy,
  ID,
  LanguagePolicy,
  ModelTier,
  PublishedAgentVersion,
  RuntimeProfileId,
  TelephonyProvider,
  TenantEnvironment,
  ToolDefinition,
  VoiceAgentRole,
  VoiceRuntimeKind,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodePosition,
} from "./index";

export interface AgentRoleNodeConfig {
  kind: AgentRoleKind;
  name: string;
  instructions: string;
  defaultModelTier: ModelTier;
  runtimeProfileOverride?: RuntimeProfileId | undefined;
  languagePolicy: LanguagePolicy;
  reusableSpecialist: boolean;
}

export interface CreateAgentRoleNodeInput {
  id: string;
  label: string;
  position: WorkflowNodePosition;
  roleId?: string;
  role: AgentRoleNodeConfig;
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
  expression: string;
  targetNodeId: string;
}

export interface ConditionNodeConfig {
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

export interface DraftWorkflowManifest {
  entryNodeId?: string | undefined;
  entryRoleId?: string | undefined;
  tools: DraftWorkflowToolBinding[];
  handoffs: DraftWorkflowHandoff[];
  conditions: DraftWorkflowConditionRoute[];
  exitNodes: DraftWorkflowExitNode[];
  escalation: DraftWorkflowEscalationPolicy | null;
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
  | "workflow.missing_entry"
  | "workflow.duplicate_node_id"
  | "workflow.edge_missing_source"
  | "workflow.edge_missing_target"
  | "workflow.unreachable_node"
  | "workflow.unsafe_cycle"
  | "agent.missing_name"
  | "agent.duplicate_name"
  | "agent.missing_instructions"
  | "agent.missing_model_tier"
  | "agent.missing_default_language"
  | "agent.missing_supported_language"
  | "agent.unsupported_language"
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
        kind: input.role.kind,
        name: input.role.name,
        instructions: input.role.instructions,
        defaultModelTier: input.role.defaultModelTier,
        ...(input.role.runtimeProfileOverride !== undefined
          ? { runtimeProfileOverride: input.role.runtimeProfileOverride }
          : {}),
        languagePolicy: {
          defaultLanguage: input.role.languagePolicy.defaultLanguage,
          supportedLanguages: [...input.role.languagePolicy.supportedLanguages],
          allowMidCallSwitching: input.role.languagePolicy.allowMidCallSwitching,
        },
        reusableSpecialist: input.role.reusableSpecialist,
      },
    },
  };

  if (input.roleId !== undefined) {
    node.roleId = input.roleId;
  }

  return node;
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
        branches: input.condition.branches.map((branch) => ({ ...branch })),
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
      .map((node) => buildDraftToolBinding(node)),
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
    const instructions = role?.instructions.trim() ?? "";
    const defaultLanguage = role?.languagePolicy.defaultLanguage.trim() ?? "";
    const supportedLanguages = role?.languagePolicy.supportedLanguages ?? [];

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
  }

  return errors;
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

      if ((branch.targetNodeId.trim() ?? "").length === 0 || !nodesById.has(branch.targetNodeId)) {
        errors.push({
          code: "condition.invalid_target",
          nodeId: node.id,
          message: `Condition node '${node.label}' points to a missing branch target.`,
          suggestion: "Point each branch at an existing workflow node before publishing.",
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

    if (
      condition === undefined ||
      !nodesById.has(condition.fallbackTargetNodeId)
    ) {
      errors.push({
        code: "condition.invalid_fallback",
        nodeId: node.id,
        message: `Condition node '${node.label}' points to a missing fallback node.`,
        suggestion: "Point the fallback branch to an existing workflow node before publishing.",
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
  const tool = getToolNodeConfig(node);

  return {
    nodeId: node.id,
    label: node.label,
    ...(node.toolId !== undefined ? { toolId: node.toolId } : {}),
    connector: tool?.connector ?? "internal",
    toolName: tool?.toolName ?? node.label,
    ...(tool?.integrationConnectionId !== undefined
      ? { integrationConnectionId: tool.integrationConnectionId }
      : {}),
    ...(tool?.integrationLabel !== undefined ? { integrationLabel: tool.integrationLabel } : {}),
    risk: tool?.risk ?? "low",
    requiresHumanApproval: tool?.requiresHumanApproval ?? false,
    ...(tool?.request !== undefined
      ? {
          request: {
            method: tool.request.method,
            url: tool.request.url,
            headerCount: tool.request.headers.length,
            hasAuthToken: tool.request.authToken.trim().length > 0,
          },
        }
      : {}),
  };
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
    branches: condition?.branches.map((branch) => ({ ...branch })) ?? [],
    fallbackLabel: condition?.fallbackLabel ?? "",
    fallbackTargetNodeId: condition?.fallbackTargetNodeId ?? "",
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
          .map((toolNode) => toolNode.toolId ?? toolNode.id) ?? [];

      if (role === undefined) {
        return {
          id: node.roleId ?? node.id,
          kind: "custom",
          name: node.label,
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
        instructions: role.instructions,
        ...(handoffDescription === undefined ? {} : { handoffDescription }),
        defaultModelTier: role.defaultModelTier,
        ...(role.runtimeProfileOverride !== undefined
          ? { runtimeProfileOverride: role.runtimeProfileOverride }
          : {}),
        toolIds,
        languagePolicy: {
          defaultLanguage: role.languagePolicy.defaultLanguage,
          supportedLanguages: [...role.languagePolicy.supportedLanguages],
          allowMidCallSwitching: role.languagePolicy.allowMidCallSwitching,
        },
      } satisfies VoiceAgentRole;
    });
}

function deriveToolDefinitions(graph: WorkflowGraph): ToolDefinition[] {
  return graph.nodes
    .filter((node) => node.kind === "tool")
    .map((node) => {
      const tool = getToolNodeConfig(node);

      return {
        id: node.toolId ?? node.id,
        name: tool?.toolName ?? node.label,
        description: `Workflow tool node '${node.label}'.`,
        connector: tool?.connector ?? "internal",
        requiresHumanApproval: tool?.requiresHumanApproval ?? false,
        risk: tool?.risk ?? "low",
      } satisfies ToolDefinition;
    });
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
