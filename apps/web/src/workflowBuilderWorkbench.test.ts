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
  it("resolves selected-node actions and route targets behind a focused workbench interface", () => {
    const nodes = buildWorkbenchNodes();
    const edges = [
      edge("entry", "agent-front-desk"),
      edge("agent-front-desk", "condition-route"),
      edge("agent-front-desk", "tool-zendesk"),
      edge("tool-zendesk", "agent-front-desk", "return"),
    ];

    const agentWorkbench = resolveWorkflowBuilderWorkbench({
      nodes,
      edges,
      selectedNodeId: "agent-front-desk",
    });

    expect(agentWorkbench.selectedNode?.id).toBe("agent-front-desk");
    expect(agentWorkbench.actions).toMatchObject({
      addAgent: true,
      addTool: true,
      addHandoff: true,
      addIntentRoute: true,
      addEscalation: true,
      addExit: true,
      deleteSelected: true,
    });
    expect(agentWorkbench.routeTargetOptions).toEqual([]);

    const routeWorkbench = resolveWorkflowBuilderWorkbench({
      nodes,
      edges,
      selectedNodeId: "condition-route",
    });

    expect(routeWorkbench.actions).toMatchObject({
      addAgent: true,
      addTool: false,
      addHandoff: true,
      addIntentRoute: false,
      addEscalation: true,
      addExit: true,
      deleteSelected: true,
    });
    expect(routeWorkbench.routeTargetOptions.map((option) => option.id)).toEqual([
      "handoff-billing",
      "agent-billing",
      "end-resolved",
    ]);
  });

  it("maps canonical relationship handles to the builder's React Flow handles", () => {
    expect(
      applyBuilderEdgeHandleRoles(
        { id: "edge-agent-route", source: "agent-front-desk", target: "condition-route" },
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
        target: "condition-route",
        sourceHandle: "agent-tool-call-source-top",
        targetHandle: builderFlowTargetHandleId,
      }),
    ).toEqual({
      kind: null,
      message: "Intent routes use normal flow handles, not tool handles.",
    });
  });
});

function buildWorkbenchNodes() {
  return [
    node("entry", "entry", "Entry"),
    node("agent-front-desk", "agent", "Front desk"),
    node("tool-zendesk", "tool", "Ticket lookup"),
    node("condition-route", "condition", "Intent route"),
    node("handoff-billing", "handoff", "Billing handoff"),
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
