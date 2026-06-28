import { describe, expect, it } from "vitest";

import type { WorkflowEdgeKind, WorkflowNodeKind } from "@zara/core";

import {
  applyBuilderEdgeHandleRoles,
  builderFlowSourceHandleId,
  builderFlowTargetHandleId,
  getBuilderConnectionDecision,
  resolveWorkflowBuilderWorkbench,
} from "./workflowBuilderWorkbench";

describe("workflowBuilderWorkbench", () => {
  it("resolves selected-node actions behind a focused workbench interface", () => {
    const nodes = buildWorkbenchNodes();
    const edges = [
      edge("entry", "agent-front-desk"),
      edge("agent-front-desk", "agent-billing"),
    ];

    const agentWorkbench = resolveWorkflowBuilderWorkbench({
      nodes,
      edges,
      selectedNodeId: "agent-front-desk",
    });

    expect(agentWorkbench.selectedNode?.id).toBe("agent-front-desk");
    expect(agentWorkbench.actions).toMatchObject({
      addAgent: true,
      addEscalation: true,
      addExit: true,
      deleteSelected: true,
    });

    const entryWorkbench = resolveWorkflowBuilderWorkbench({
      nodes,
      edges,
      selectedNodeId: "entry",
    });

    expect(entryWorkbench.actions).toMatchObject({
      addAgent: true,
      addEscalation: false,
      addExit: false,
      deleteSelected: false,
    });
  });

  it("maps canonical relationship handles to the builder's React Flow handles", () => {
    expect(
      applyBuilderEdgeHandleRoles(
        { id: "edge-agent-route", source: "agent-front-desk", target: "agent-billing" },
        "flow-source",
        "flow-target",
      ),
    ).toMatchObject({
      sourceHandle: builderFlowSourceHandleId,
      targetHandle: builderFlowTargetHandleId,
    });

    expect(
      getBuilderConnectionDecision(buildWorkbenchNodes(), [], {
        source: "agent-front-desk",
        target: "agent-billing",
        sourceHandle: "unknown-source-handle",
        targetHandle: "unknown-target-handle",
      }),
    ).toMatchObject({
      kind: "flow",
      sourceHandleRole: "flow-source",
      targetHandleRole: "flow-target",
    });
  });
});

function buildWorkbenchNodes() {
  return [
    node("entry", "entry", "Entry"),
    node("agent-front-desk", "agent", "Front desk"),
    node("agent-billing", "agent", "Billing specialist"),
    node("end-resolved", "end", "Resolved"),
  ];
}

function node(id: string, kind: WorkflowNodeKind, label: string) {
  return {
    id,
    data: {
      kind,
      label,
    },
  };
}

function edge(source: string, target: string, kind?: WorkflowEdgeKind) {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    ...(kind !== undefined ? { data: { kind } } : {}),
  };
}
