import {
  decideWorkflowNodeRelationship,
  type WorkflowEdgeKind,
  type WorkflowNodeKind,
  type WorkflowRelationshipHandleRole,
} from "@zara/core";

export const builderFlowSourceHandleId = "flow-source-right";
export const builderFlowTargetHandleId = "flow-target-left";

export interface WorkflowBuilderWorkbenchNode {
  id: string;
  data: {
    kind: WorkflowNodeKind;
    label: string;
  };
}

export interface WorkflowBuilderWorkbenchEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null | undefined;
  targetHandle?: string | null | undefined;
  label?: unknown;
  className?: string | undefined;
  data?: {
    kind?: WorkflowEdgeKind | undefined;
  } | undefined;
}

export interface WorkflowBuilderWorkbenchActions {
  addAgent: boolean;
  addTool: boolean;
  addEscalation: boolean;
  addExit: boolean;
  deleteSelected: boolean;
}

export interface WorkflowBuilderWorkbenchState<TNode extends WorkflowBuilderWorkbenchNode> {
  selectedNode: TNode | undefined;
  actions: WorkflowBuilderWorkbenchActions;
}

export type BuilderConnectionDecision =
  | {
      kind: WorkflowEdgeKind;
      sourceHandleRole: WorkflowRelationshipHandleRole;
      targetHandleRole: WorkflowRelationshipHandleRole;
      autoCreateCompanionEdges: Array<{
        relationshipId: string;
        source: "source" | "target";
        target: "source" | "target";
        edgeKind: WorkflowEdgeKind;
        sourceHandleRole: WorkflowRelationshipHandleRole;
        targetHandleRole: WorkflowRelationshipHandleRole;
        condition?: string | undefined;
      }>;
      message?: never;
    }
  | { kind: null; message: string };

export function resolveWorkflowBuilderWorkbench<TNode extends WorkflowBuilderWorkbenchNode>(input: {
  nodes: TNode[];
  edges: WorkflowBuilderWorkbenchEdge[];
  selectedNodeId: string;
}): WorkflowBuilderWorkbenchState<TNode> {
  const selectedNode = input.nodes.find((node) => node.id === input.selectedNodeId) ?? input.nodes[0];
  const selectedSourceKind = selectedNode?.data.kind ?? "entry";

  return {
    selectedNode,
    actions: {
      addAgent: canCreateBuilderRelationshipFromKind(selectedSourceKind, "agent"),
      addTool:
        selectedNode !== undefined &&
        canCreateBuilderRelationshipFromKind(selectedNode.data.kind, "tool"),
      addEscalation: canCreateBuilderRelationshipFromKind(selectedSourceKind, "human-escalation"),
      addExit: canCreateBuilderRelationshipFromKind(selectedSourceKind, "end"),
      deleteSelected: selectedNode?.data.kind !== "entry",
    },
  };
}

export function getBuilderConnectionDecision(
  nodes: WorkflowBuilderWorkbenchNode[],
  edges: WorkflowBuilderWorkbenchEdge[],
  connection: {
    source: string | null;
    target: string | null;
    sourceHandle?: string | null | undefined;
    targetHandle?: string | null | undefined;
  },
): BuilderConnectionDecision {
  return getBuilderPolicyDecision({
    nodes,
    edges,
    sourceId: connection.source,
    targetId: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    strictHandleRoles: true,
  });
}

export function getBuilderPolicyDecision(input: {
  nodes: WorkflowBuilderWorkbenchNode[];
  edges: WorkflowBuilderWorkbenchEdge[];
  sourceId: string | null;
  targetId: string | null;
  sourceHandle?: string | null | undefined;
  targetHandle?: string | null | undefined;
  requestedEdgeKind?: WorkflowEdgeKind | undefined;
  strictHandleRoles?: boolean | undefined;
}): BuilderConnectionDecision {
  const sourceId = input.sourceId;
  const targetId = input.targetId;

  if (sourceId === null || targetId === null) {
    return {
      kind: null,
      message: "Reconnect or remove the broken edge before publishing.",
    };
  }

  const sourceNode = input.nodes.find((node) => node.id === sourceId);
  const targetNode = input.nodes.find((node) => node.id === targetId);

  if (sourceNode === undefined || targetNode === undefined) {
    return {
      kind: null,
      message: "Reconnect or remove the broken edge before publishing.",
    };
  }

  const decision = decideWorkflowNodeRelationship({
    sourceNodeId: sourceId,
    targetNodeId: targetId,
    sourceKind: sourceNode.data.kind,
    targetKind: targetNode.data.kind,
    requestedEdgeKind: input.requestedEdgeKind,
    sourceHandleRole: toWorkflowRelationshipSourceHandleRole(input.sourceHandle),
    targetHandleRole: toWorkflowRelationshipTargetHandleRole(input.targetHandle),
    strictHandleRoles: input.strictHandleRoles ?? true,
    existingEdges: input.edges.map(toWorkflowRelationshipEdge),
  });

  if (!decision.allowed) {
    return {
      kind: null,
      message: decision.message,
    };
  }

  return {
    kind: decision.edgeKind,
    sourceHandleRole: decision.sourceHandleRole,
    targetHandleRole: decision.targetHandleRole,
    autoCreateCompanionEdges: decision.autoCreateCompanionEdges,
  };
}

export function canCreateBuilderRelationshipFromKind(
  sourceKind: WorkflowNodeKind,
  targetKind: WorkflowNodeKind,
): boolean {
  return decideWorkflowNodeRelationship({
    sourceNodeId: "source",
    targetNodeId: "target",
    sourceKind,
    targetKind,
    requestedEdgeKind: "flow",
    strictHandleRoles: false,
  }).allowed;
}

export function toWorkflowRelationshipEdge(edge: WorkflowBuilderWorkbenchEdge) {
  return {
    id: edge.id,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    ...(edge.data?.kind === "return" ? { kind: edge.data.kind } : {}),
    sourceHandleRole: toWorkflowRelationshipSourceHandleRole(edge.sourceHandle),
    targetHandleRole: toWorkflowRelationshipTargetHandleRole(edge.targetHandle),
  };
}

export function applyBuilderEdgeHandleRoles<T extends WorkflowBuilderWorkbenchEdge>(
  edge: T,
  sourceHandleRole: WorkflowRelationshipHandleRole,
  targetHandleRole: WorkflowRelationshipHandleRole,
): T {
  const sourceHandle = toBuilderSourceHandle(sourceHandleRole);
  const targetHandle = toBuilderTargetHandle(targetHandleRole);

  return {
    ...edge,
    ...(sourceHandle !== undefined ? { sourceHandle } : {}),
    ...(targetHandle !== undefined ? { targetHandle } : {}),
  };
}

export function toWorkflowRelationshipSourceHandleRole(
  handle: string | null | undefined,
): WorkflowRelationshipHandleRole {
  switch (handle) {
    case "agent-tool-call-source-top":
      return "tool-call-source";
    case "tool-result-source-bottom":
      return "tool-result-source";
    default:
      return "flow-source";
  }
}

export function toWorkflowRelationshipTargetHandleRole(
  handle: string | null | undefined,
): WorkflowRelationshipHandleRole {
  switch (handle) {
    case "tool-call-target-bottom":
      return "tool-call-target";
    case "agent-tool-result-target-top":
      return "tool-result-target";
    default:
      return "flow-target";
  }
}

function toBuilderSourceHandle(role: WorkflowRelationshipHandleRole): string | undefined {
  switch (role) {
    case "flow-source":
      return builderFlowSourceHandleId;
    case "tool-call-source":
      return "agent-tool-call-source-top";
    case "tool-result-source":
      return "tool-result-source-bottom";
    default:
      return undefined;
  }
}

function toBuilderTargetHandle(role: WorkflowRelationshipHandleRole): string | undefined {
  switch (role) {
    case "flow-target":
      return builderFlowTargetHandleId;
    case "tool-call-target":
      return "tool-call-target-bottom";
    case "tool-result-target":
      return "agent-tool-result-target-top";
    default:
      return undefined;
  }
}
