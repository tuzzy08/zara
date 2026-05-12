import type {
  AgentRoleKind,
  LanguagePolicy,
  ModelTier,
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
  | "tool.missing_authorization";

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

  return {
    ok: errors.length === 0,
    errors,
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

    const requiresAuthorization = node.config["requiresAuthorization"] === true;
    const hasCredential =
      typeof node.config["authorizationRef"] === "string" ||
      typeof node.config["integrationConnectionId"] === "string";

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
