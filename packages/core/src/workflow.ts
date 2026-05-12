import type {
  AgentRoleKind,
  EscalationFallbackMode,
  EscalationPolicy,
  LanguagePolicy,
  ModelTier,
  ToolDefinition,
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

export interface ToolNodeConfig {
  connector: ToolDefinition["connector"];
  toolName: string;
  integrationConnectionId?: string | undefined;
  integrationLabel?: string | undefined;
  connectionStatus: "connected" | "missing" | "revoked";
  risk: ToolDefinition["risk"];
  requiresAuthorization: boolean;
  requiresHumanApproval: boolean;
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
}

export interface DraftWorkflowHandoff {
  nodeId: string;
  label: string;
  targetRoleId: string;
  targetRoleName: string;
  handoffReason: string;
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
  escalation: DraftWorkflowEscalationPolicy | null;
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
  | "handoff.missing_target"
  | "handoff.invalid_target"
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

const languageCodePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/;

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
  return {
    id: input.id,
    kind: "tool",
    label: input.label,
    position: { ...input.position },
    toolId: input.toolId,
    config: {
      tool: {
        connector: input.tool.connector,
        toolName: input.tool.toolName,
        integrationConnectionId: input.tool.integrationConnectionId,
        integrationLabel: input.tool.integrationLabel,
        connectionStatus: input.tool.connectionStatus,
        risk: input.tool.risk,
        requiresAuthorization: input.tool.requiresAuthorization,
        requiresHumanApproval: input.tool.requiresHumanApproval,
      },
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
      .map((node) => {
        const tool = getToolNodeConfig(node);

        return {
          nodeId: node.id,
          label: node.label,
          toolId: node.toolId,
          connector: tool?.connector ?? "internal",
          toolName: tool?.toolName ?? node.label,
          integrationConnectionId: tool?.integrationConnectionId,
          integrationLabel: tool?.integrationLabel,
          risk: tool?.risk ?? "low",
          requiresHumanApproval: tool?.requiresHumanApproval ?? false,
        };
      }),
    handoffs: graph.nodes
      .filter((node) => node.kind === "handoff")
      .map((node) => {
        const handoff = getHandoffNodeConfig(node);

        return {
          nodeId: node.id,
          label: node.label,
          targetRoleId: handoff?.targetRoleId ?? "",
          targetRoleName: handoff?.targetRoleName ?? "",
          handoffReason: handoff?.handoffReason ?? "",
        };
      }),
    escalation: buildDraftEscalationPolicy(graph.nodes.find((node) => node.kind === "human-escalation")),
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
