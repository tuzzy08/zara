import { describe, expect, it } from "vitest";

import {
  addWorkflowNode,
  connectWorkflowNodes,
  createAgentRoleNode,
  createWorkflowGraph,
  deleteWorkflowNode,
  moveWorkflowNode,
  serializeWorkflowGraph,
  validateWorkflowGraph,
  type WorkflowValidationError,
} from "./index";

const entryNode = {
  id: "entry",
  kind: "entry",
  label: "Inbound call",
  position: { x: 0, y: 0 },
  config: {},
} as const;

const billingAgent = createAgentRoleNode({
  id: "agent-billing",
  label: "Billing specialist",
  position: { x: 240, y: 80 },
  role: {
    kind: "billing",
    name: "Billing specialist",
    instructions: "Resolve invoice disputes and hand off refund exceptions.",
    defaultModelTier: "standard",
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en", "fr"],
      allowMidCallSwitching: true,
    },
    reusableSpecialist: true,
  },
});

function codes(errors: WorkflowValidationError[]) {
  return errors.map((error) => error.code);
}

describe("workflow graph operations", () => {
  it("adds, moves, connects, deletes, and serializes graph state deterministically", () => {
    const graph = createWorkflowGraph({
      id: "workflow-inbound",
      name: "Inbound support",
      nodes: [entryNode],
      edges: [],
    });

    const withAgent = addWorkflowNode(graph, billingAgent);
    const moved = moveWorkflowNode(withAgent, "agent-billing", { x: 320, y: 120 });
    const connected = connectWorkflowNodes(moved, {
      id: "edge-entry-agent",
      sourceNodeId: "entry",
      targetNodeId: "agent-billing",
    });
    const deleted = deleteWorkflowNode(connected, "agent-billing");

    expect(graph.nodes).toHaveLength(1);
    expect(withAgent.nodes).toHaveLength(2);
    expect(moved.nodes.find((node) => node.id === "agent-billing")?.position).toEqual({
      x: 320,
      y: 120,
    });
    expect(connected.edges).toEqual([
      {
        id: "edge-entry-agent",
        sourceNodeId: "entry",
        targetNodeId: "agent-billing",
      },
    ]);
    expect(deleted.nodes).toEqual([entryNode]);
    expect(deleted.edges).toEqual([]);

    const shuffledGraph = createWorkflowGraph({
      id: "workflow-inbound",
      name: "Inbound support",
      nodes: [billingAgent, entryNode],
      edges: [
        {
          id: "edge-entry-agent",
          sourceNodeId: "entry",
          targetNodeId: "agent-billing",
        },
      ],
    });

    const orderedGraph = createWorkflowGraph({
      id: "workflow-inbound",
      name: "Inbound support",
      nodes: [entryNode, billingAgent],
      edges: [
        {
          id: "edge-entry-agent",
          sourceNodeId: "entry",
          targetNodeId: "agent-billing",
        },
      ],
    });

    expect(serializeWorkflowGraph(shuffledGraph)).toEqual(serializeWorkflowGraph(orderedGraph));
  });
});

describe("agent role workflow nodes", () => {
  it("captures instructions, language policy, default model tier, and reusable specialist intent", () => {
    expect(billingAgent.kind).toBe("agent");
    expect(billingAgent.label).toBe("Billing specialist");
    expect(billingAgent.config).toEqual({
      role: {
        kind: "billing",
        name: "Billing specialist",
        instructions: "Resolve invoice disputes and hand off refund exceptions.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en", "fr"],
          allowMidCallSwitching: true,
        },
        reusableSpecialist: true,
      },
    });
  });

  it("blocks publishing when required agent fields are missing", () => {
    const invalidAgent = createAgentRoleNode({
      id: "agent-empty",
      label: "Empty specialist",
      position: { x: 240, y: 80 },
      role: {
        kind: "support",
        name: "",
        instructions: "",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "",
          supportedLanguages: [],
          allowMidCallSwitching: false,
        },
        reusableSpecialist: false,
      },
    });

    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-invalid-agent",
        name: "Invalid agent",
        nodes: [entryNode, invalidAgent],
        edges: [
          {
            id: "edge-entry-empty",
            sourceNodeId: "entry",
            targetNodeId: "agent-empty",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual([
      "agent.missing_name",
      "agent.missing_instructions",
      "agent.missing_default_language",
      "agent.missing_supported_language",
    ]);
    expect(result.errors[0]?.suggestion).toContain("Add a role name");
  });
});

describe("workflow validation contract", () => {
  it("catches missing entry, unreachable nodes, unsafe cycles, and missing tool authorization", () => {
    const missingEntry = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-missing-entry",
        name: "Missing entry",
        nodes: [billingAgent],
        edges: [],
      }),
    );

    expect(codes(missingEntry.errors)).toContain("workflow.missing_entry");

    const unreachableAgent = createAgentRoleNode({
      id: "agent-unreachable",
      label: "Unreachable specialist",
      position: { x: 600, y: 120 },
      role: {
        kind: "support",
        name: "Unreachable specialist",
        instructions: "Handle overflow support.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        reusableSpecialist: false,
      },
    });

    const invalidGraph = createWorkflowGraph({
      id: "workflow-invalid",
      name: "Invalid graph",
      nodes: [
        entryNode,
        billingAgent,
        unreachableAgent,
        {
          id: "tool-zendesk",
          kind: "tool",
          label: "Zendesk lookup",
          position: { x: 520, y: 80 },
          toolId: "zendesk.search",
          config: {
            requiresAuthorization: true,
          },
        },
      ],
      edges: [
        {
          id: "edge-entry-agent",
          sourceNodeId: "entry",
          targetNodeId: "agent-billing",
        },
        {
          id: "edge-agent-entry",
          sourceNodeId: "agent-billing",
          targetNodeId: "entry",
        },
        {
          id: "edge-agent-tool",
          sourceNodeId: "agent-billing",
          targetNodeId: "tool-zendesk",
        },
      ],
    });

    const result = validateWorkflowGraph(invalidGraph);

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual([
      "workflow.unreachable_node",
      "workflow.unsafe_cycle",
      "tool.missing_authorization",
    ]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "agent-unreachable",
          suggestion: "Connect this node to the entry path or delete it from the draft.",
        }),
        expect.objectContaining({
          edgeId: "edge-agent-entry",
          suggestion: "Add an explicit exit condition or remove the loop before publishing.",
        }),
        expect.objectContaining({
          nodeId: "tool-zendesk",
          suggestion: "Connect an authorized integration account before this workflow can publish.",
        }),
      ]),
    );
  });
});
