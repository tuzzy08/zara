import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";

type LiveCanvasStatus = "idle" | "connecting" | "active" | "error" | "ended";

interface LiveCanvasNode {
  id: string;
  className?: string | undefined;
  data: Record<string, unknown>;
}

interface LiveCanvasEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean | undefined;
  className?: string | undefined;
}

export function decorateLiveWorkflowCanvas<TNode extends LiveCanvasNode, TEdge extends LiveCanvasEdge>(input: {
  nodes: TNode[];
  edges: TEdge[];
  liveEvents: LiveSandboxStreamEvent[];
  liveStatus: LiveCanvasStatus;
}): {
  nodes: TNode[];
  edges: TEdge[];
} {
  if (input.liveStatus !== "active") {
    return {
      nodes: input.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          liveState: "idle",
        },
      })),
      edges: input.edges.map((edge) => ({
        ...edge,
        animated: false,
      })),
    };
  }

  const visitedNodeIds = new Set(
    input.liveEvents
      .map((event) => readLiveEventNodeId(event))
      .filter((nodeId): nodeId is string => nodeId !== undefined),
  );
  const currentNodeId = [...input.liveEvents]
    .reverse()
    .map((event) => readLiveEventNodeId(event))
    .find((nodeId): nodeId is string => nodeId !== undefined);

  return {
    nodes: input.nodes.map((node) => {
      const liveState =
        node.id === currentNodeId
          ? "current"
          : visitedNodeIds.has(node.id)
            ? "visited"
            : "active";

      return {
        ...node,
        className: joinClassNames(
          node.className,
          "builder-node-live",
          liveState === "current" ? "builder-node-live-current" : undefined,
          liveState === "visited" ? "builder-node-live-visited" : undefined,
        ),
        data: {
          ...node.data,
          liveState,
        },
      };
    }),
    edges: input.edges.map((edge) => ({
      ...edge,
      animated: true,
      className: joinClassNames(
        edge.className,
        "workflow-live-edge",
        edge.target === currentNodeId ? "workflow-live-edge-current" : undefined,
      ),
    })),
  };
}

function readLiveEventNodeId(event: LiveSandboxStreamEvent): string | undefined {
  return typeof event.payload.nodeId === "string" ? event.payload.nodeId : undefined;
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter((className): className is string => className !== undefined && className.length > 0).join(" ");
}
