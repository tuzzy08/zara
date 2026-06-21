import { describe, expect, it } from "vitest";

import { createDefaultSandboxPublishedWorkflow } from "./defaultSandboxWorkflow";

describe("default sandbox workflow", () => {
  it("uses a concrete agent route policy instead of seeded legacy handoff nodes", () => {
    const workflow = createDefaultSandboxPublishedWorkflow("workspace-customer-success");

    expect(workflow.manifestPreview).not.toHaveProperty("handoffs");
    expect(
      workflow.graph.nodes.some(
        (node) => String(node.kind) === "handoff" || node.id === "handoff-billing" || node.id === "condition-intent",
      ),
    ).toBe(false);
    expect(workflow.manifestPreview.routePolicies).toEqual([
      expect.objectContaining({
        sourceAgentId: "agent-front-desk",
        branches: [
          expect.objectContaining({
            id: "branch-billing",
            intentKey: "billing",
            target: {
              type: "agent",
              agentId: "agent-billing",
            },
            transferInstructions: "Move invoice and refund conversations to the billing specialist lane.",
          }),
        ],
        fallback: {
          label: "Resolved",
          target: {
            type: "exit",
            exitNodeId: "end-resolved",
          },
        },
      }),
    ]);
  });
});
