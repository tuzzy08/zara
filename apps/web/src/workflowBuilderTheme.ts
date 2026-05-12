import type { WorkflowNodeKind } from "@zara/core";

interface BuilderNodeAccent {
  accent: string;
  tint: string;
  minimap: string;
}

const builderNodeAccents: Record<WorkflowNodeKind, BuilderNodeAccent> = {
  entry: {
    accent: "#0072f5",
    tint: "rgba(0, 114, 245, 0.12)",
    minimap: "#0072f5",
  },
  agent: {
    accent: "#7928ca",
    tint: "rgba(121, 40, 202, 0.12)",
    minimap: "#7928ca",
  },
  tool: {
    accent: "#0f766e",
    tint: "rgba(15, 118, 110, 0.12)",
    minimap: "#0f766e",
  },
  handoff: {
    accent: "#de1d8d",
    tint: "rgba(222, 29, 141, 0.12)",
    minimap: "#de1d8d",
  },
  condition: {
    accent: "#4f46e5",
    tint: "rgba(79, 70, 229, 0.12)",
    minimap: "#4f46e5",
  },
  "human-escalation": {
    accent: "#ff5b4f",
    tint: "rgba(255, 91, 79, 0.12)",
    minimap: "#ff5b4f",
  },
  end: {
    accent: "#6b7280",
    tint: "rgba(107, 114, 128, 0.14)",
    minimap: "#6b7280",
  },
};

export function getBuilderNodeAccent(kind: WorkflowNodeKind): BuilderNodeAccent {
  return builderNodeAccents[kind];
}
