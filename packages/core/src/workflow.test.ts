import { describe, expect, it } from "vitest";

import {
  addWorkflowNode,
  buildDraftWorkflowManifest,
  buildRuntimeManifestPreview,
  decideWorkflowNodeRelationship,
  connectWorkflowNodes,
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createHumanEscalationNode,
  createToolNode,
  createWorkflowGraph,
  deleteWorkflowNode,
  moveWorkflowNode,
  pinPublishedWorkflowVersion,
  publishedWorkflowVersionSchemaVersion,
  publishWorkflowVersion,
  reconnectWorkflowEdge,
  resolveAgentRouteRoleProfile,
  resolveConditionBranch,
  runtimeManifestPreviewSchemaVersion,
  serializeWorkflowGraph,
  validateWorkflowGraph,
  workflowNodeRelationshipRules,
  type WorkflowNode,
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
    businessName: "Tuzzy Labs",
    instructions: "Resolve invoice disputes and hand off refund exceptions.",
    defaultModelTier: "standard",
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en", "fr"],
      allowMidCallSwitching: true,
    },
  },
});

const frontDeskAgent = createAgentRoleNode({
  id: "agent-front-desk",
  label: "Front desk triage",
  position: { x: 120, y: 80 },
  role: {
    kind: "receptionist",
    name: "Front desk triage",
    businessName: "Tuzzy Labs",
    instructions: "Welcome callers, identify intent, and route specialist work.",
    defaultModelTier: "cheap",
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en", "fr"],
      allowMidCallSwitching: true,
    },
  },
});

function codes(errors: WorkflowValidationError[]) {
  return errors.map((error) => error.code);
}

describe("agent route role profiles", () => {
  it("derives built-in route branches from role kind instead of agent name", () => {
    expect(resolveAgentRouteRoleProfile({ kind: "billing", name: "Bill" })).toEqual(
      expect.objectContaining({
        label: "Billing",
        intentKey: "billing",
      }),
    );
    expect(resolveAgentRouteRoleProfile({ kind: "billing", name: "Bill" })).not.toHaveProperty("description");
    expect(resolveAgentRouteRoleProfile({ kind: "billing", name: "Bill" })).not.toHaveProperty("examples");
  });

  it("uses the configured name for custom route roles", () => {
    expect(resolveAgentRouteRoleProfile({ kind: "custom", name: "Returns desk" })).toEqual(
      expect.objectContaining({
        label: "Returns desk",
        intentKey: "returns-desk",
      }),
    );
  });
});

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

  it("reconnects an existing edge so builders can rearrange flow without recreating links", () => {
    const graph = createWorkflowGraph({
      id: "workflow-reconnect",
      name: "Reconnect flow",
      nodes: [entryNode, frontDeskAgent, billingAgent],
      edges: [
        {
          id: "edge-entry-front-desk",
          sourceNodeId: "entry",
          targetNodeId: "agent-front-desk",
        },
      ],
    });

    const reconnected = reconnectWorkflowEdge(graph, "edge-entry-front-desk", {
      sourceNodeId: "agent-front-desk",
      targetNodeId: "agent-billing",
    });

    expect(graph.edges).toEqual([
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
    ]);
    expect(reconnected.edges).toEqual([
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "agent-billing",
      },
    ]);
  });

  it("preserves return edges so tool and intermediary-agent responses can route back to their caller", () => {
    const profileTool = createToolNode({
      id: "tool-profile",
      label: "Profile lookup",
      position: { x: 520, y: 80 },
      toolId: "hubspot.profile.lookup",
      tool: {
        connector: "hubspot",
        toolName: "Profile lookup",
        integrationConnectionId: "hubspot-main",
        integrationLabel: "HubSpot - Revenue ops",
        connectionStatus: "connected",
        risk: "low",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      },
    });
    const responseEdge = {
      id: "edge-tool-profile-agent-front-desk-return",
      sourceNodeId: "tool-profile",
      targetNodeId: "agent-front-desk",
      kind: "return" as const,
      condition: "success",
    };
    const graph = createWorkflowGraph({
      id: "workflow-return-edge",
      name: "Return edge",
      nodes: [entryNode, frontDeskAgent, profileTool],
      edges: [
        {
          id: "edge-entry-front-desk",
          sourceNodeId: "entry",
          targetNodeId: "agent-front-desk",
        },
        {
          id: "edge-front-desk-tool-profile",
          sourceNodeId: "agent-front-desk",
          targetNodeId: "tool-profile",
        },
        responseEdge,
      ],
    });

    expect(validateWorkflowGraph(graph).ok).toBe(true);
    expect(JSON.parse(serializeWorkflowGraph(graph))).toEqual(
      expect.objectContaining({
        edges: expect.arrayContaining([
          expect.objectContaining({
            id: "edge-tool-profile-agent-front-desk-return",
            kind: "return",
            condition: "success",
          }),
        ]),
      }),
    );
    expect((buildDraftWorkflowManifest(graph) as { returnRoutes?: unknown[] }).returnRoutes).toEqual([
      expect.objectContaining({
        sourceNodeId: "tool-profile",
        targetNodeId: "agent-front-desk",
        condition: "success",
      }),
    ]);
  });
});

describe("workflow node relationship policy", () => {
  it("models canonical node relationships with edge kinds, handle roles, and companion edges", () => {
    expect(workflowNodeRelationshipRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entry_to_agent",
          sourceKind: "entry",
          targetKind: "agent",
          edgeKind: "flow",
          sourceHandleRole: "flow-source",
          targetHandleRole: "flow-target",
        }),
        expect.objectContaining({
          id: "agent_calls_tool",
          sourceKind: "agent",
          targetKind: "tool",
          edgeKind: "flow",
          sourceHandleRole: "tool-call-source",
          targetHandleRole: "tool-call-target",
          autoCreateCompanionEdges: [
            expect.objectContaining({
              relationshipId: "tool_returns_to_agent",
              edgeKind: "return",
              condition: "success",
              sourceHandleRole: "tool-result-source",
              targetHandleRole: "tool-result-target",
            }),
          ],
        }),
        expect.objectContaining({
          id: "agent_to_intent_route",
          sourceKind: "agent",
          targetKind: "condition",
          edgeKind: "flow",
          sourceHandleRole: "flow-source",
          targetHandleRole: "flow-target",
        }),
      ]),
    );
    expect(
      workflowNodeRelationshipRules.some(
        (rule) => String(rule.sourceKind) === "handoff" || String(rule.targetKind) === "handoff",
      ),
    )
      .toBe(false);
  });

  it("decides relationships from node kinds, handle roles, edge kind, and graph context", () => {
    expect(
      decideWorkflowNodeRelationship({
        sourceNodeId: "agent-front-desk",
        targetNodeId: "tool-profile",
        sourceKind: "agent",
        targetKind: "tool",
        sourceHandleRole: "tool-call-source",
        targetHandleRole: "tool-call-target",
        strictHandleRoles: true,
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        ruleId: "agent_calls_tool",
        edgeKind: "flow",
        autoCreateCompanionEdges: [
          expect.objectContaining({
            relationshipId: "tool_returns_to_agent",
            edgeKind: "return",
            condition: "success",
          }),
        ],
      }),
    );

    expect(
      decideWorkflowNodeRelationship({
        sourceNodeId: "tool-profile",
        targetNodeId: "agent-front-desk",
        sourceKind: "tool",
        targetKind: "agent",
        requestedEdgeKind: "return",
        sourceHandleRole: "tool-result-source",
        targetHandleRole: "tool-result-target",
        existingEdges: [
          {
            id: "edge-agent-tool",
            sourceNodeId: "agent-front-desk",
            targetNodeId: "tool-profile",
          },
        ],
        strictHandleRoles: true,
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        ruleId: "tool_returns_to_agent",
        edgeKind: "return",
      }),
    );

    expect(
      decideWorkflowNodeRelationship({
        sourceNodeId: "entry",
        targetNodeId: "condition-route",
        sourceKind: "entry",
        targetKind: "condition",
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reasonCode: "relationship.intent_requires_agent_source",
      }),
    );

    expect(
      decideWorkflowNodeRelationship({
        sourceNodeId: "agent-front-desk",
        targetNodeId: "condition-route",
        sourceKind: "agent",
        targetKind: "condition",
        sourceHandleRole: "tool-call-source",
        targetHandleRole: "flow-target",
        strictHandleRoles: true,
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reasonCode: "relationship.intent_uses_flow_handles",
      }),
    );
  });

  it("validates graph edges against the canonical relationship policy", () => {
    const condition = createConditionNode({
      id: "condition-route",
      label: "Intent route",
      position: { x: 320, y: 160 },
      condition: {
        branches: [
          {
            id: "branch-vip",
            label: "VIP",
            expression: 'intent == "vip"',
            targetNodeId: "tool-profile",
          },
        ],
        fallbackLabel: "Fallback",
        fallbackTargetNodeId: "agent-front-desk",
      },
    });
    const profileTool = createToolNode({
      id: "tool-profile",
      label: "Profile lookup",
      position: { x: 520, y: 80 },
      toolId: "hubspot.profile.lookup",
      tool: {
        connector: "hubspot",
        toolName: "Profile lookup",
        integrationConnectionId: "hubspot-main",
        integrationLabel: "HubSpot - Revenue ops",
        connectionStatus: "connected",
        risk: "low",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      },
    });

    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-invalid-relationships",
        name: "Invalid relationships",
        nodes: [entryNode, frontDeskAgent, condition, profileTool],
        edges: [
          {
            id: "edge-entry-condition",
            sourceNodeId: "entry",
            targetNodeId: "condition-route",
          },
          {
            id: "edge-entry-agent",
            sourceNodeId: "entry",
            targetNodeId: "agent-front-desk",
          },
          {
            id: "edge-agent-condition",
            sourceNodeId: "agent-front-desk",
            targetNodeId: "condition-route",
          },
          {
            id: "edge-condition-tool",
            sourceNodeId: "condition-route",
            targetNodeId: "tool-profile",
          },
          {
            id: "edge-tool-agent",
            sourceNodeId: "tool-profile",
            targetNodeId: "agent-front-desk",
            kind: "return",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        "relationship.intent_requires_agent_source",
        "relationship.intent_invalid_target",
        "relationship.tool_result_requires_caller",
        "condition.invalid_target",
      ]),
    );
  });

  it("allows an intent route fallback to return to the calling agent", () => {
    const resolvedExit = createEndNode({
      id: "end-resolved",
      label: "Resolved",
      position: { x: 560, y: 160 },
      end: {
        outcome: "resolved",
        closingMessage: "Close the call after the request is handled.",
      },
    });
    const condition = createConditionNode({
      id: "condition-route",
      label: "Intent route",
      position: { x: 320, y: 160 },
      condition: {
        branches: [
          {
            id: "branch-support",
            label: "Support",
            expression: 'intent == "support"',
            targetNodeId: "end-resolved",
          },
        ],
        fallbackLabel: "Fallback",
        fallbackTargetNodeId: "agent-front-desk",
      },
    });

    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-fallback-to-caller",
        name: "Fallback to caller",
        nodes: [entryNode, frontDeskAgent, condition, resolvedExit],
        edges: [
          {
            id: "edge-entry-agent",
            sourceNodeId: "entry",
            targetNodeId: "agent-front-desk",
          },
          {
            id: "edge-agent-condition",
            sourceNodeId: "agent-front-desk",
            targetNodeId: "condition-route",
          },
          {
            id: "edge-condition-end",
            sourceNodeId: "condition-route",
            targetNodeId: "end-resolved",
            condition: "Support",
          },
          {
            id: "edge-condition-agent-fallback",
            sourceNodeId: "condition-route",
            targetNodeId: "agent-front-desk",
            condition: "Fallback",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("rejects stale serialized handoff nodes as unsupported workflow nodes", () => {
    const staleHandoffNode = {
      id: "handoff-billing",
      kind: "handoff",
      label: "Billing handoff",
      position: { x: 460, y: 180 },
      config: {
        handoff: {
          targetRoleId: "agent-billing",
          targetRoleName: "Billing specialist",
          handoffReason: "Escalate invoice and refund conversations to the billing lane.",
        },
      },
    } as unknown as WorkflowNode;

    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-stale-handoff",
        name: "Stale handoff",
        nodes: [entryNode, frontDeskAgent, staleHandoffNode, billingAgent],
        edges: [
          {
            id: "edge-entry-front-desk",
            sourceNodeId: "entry",
            targetNodeId: "agent-front-desk",
          },
          {
            id: "edge-front-desk-handoff",
            sourceNodeId: "agent-front-desk",
            targetNodeId: "handoff-billing",
          },
          {
            id: "edge-handoff-billing",
            sourceNodeId: "handoff-billing",
            targetNodeId: "agent-billing",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "workflow.unsupported_node_kind",
          nodeId: "handoff-billing",
        }),
      ]),
    );
  });
});

describe("agent role workflow nodes", () => {
  it("captures instructions, language policy, and default model tier", () => {
    expect(billingAgent.kind).toBe("agent");
    expect(billingAgent.label).toBe("Billing specialist");
    expect(billingAgent.config).toEqual({
      role: {
        kind: "billing",
        name: "Billing specialist",
        businessName: "Tuzzy Labs",
        instructions: "Resolve invoice disputes and hand off refund exceptions.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en", "fr"],
          allowMidCallSwitching: true,
        },
      },
    });
  });

  it("captures an agent-attached route-by-intent policy in the draft manifest without visible handoff plumbing", () => {
    const triageAgent = createAgentRoleNode({
      id: "agent-triage",
      label: "Front desk triage",
      position: { x: 120, y: 80 },
      role: {
        kind: "receptionist",
        name: "Front desk triage",
        businessName: "Tuzzy Labs",
        instructions: "Clarify caller needs and hand off only when the next specialist is clear.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        routePolicy: {
          type: "route_by_intent",
          trigger: "on_caller_turn_end",
          activation: "until_routed",
          classifier: {
            mode: "standard",
            modelAlias: "intent-classifier-fast",
            confidenceThreshold: 0.75,
          },
          inputWindow: {
            latestCallerTurn: true,
            recentTranscriptTurns: 4,
            includeConversationSummary: true,
            includePreviousAgentContext: true,
            includeRecentToolResults: false,
          },
          readiness: {
            mode: "auto_with_clarification",
            maxClarificationTurns: 2,
          },
          announcement: {
            mode: "template",
            text: "I'll connect you with {targetAgentName}.",
          },
          branches: [
            {
              id: "branch-billing",
              label: "Billing",
              intentKey: "billing",
              target: {
                type: "agent",
                agentId: "agent-billing",
              },
              transferInstructions: "Continue with billing context; do not repeat triage questions.",
            },
          ],
          fallback: {
            label: "Clarify",
            target: {
              type: "clarify_source_agent",
            },
          },
        },
      },
    });
    const graph = createWorkflowGraph({
      id: "workflow-route-policy",
      name: "Route policy",
      nodes: [entryNode, triageAgent, billingAgent],
      edges: [
        {
          id: "edge-entry-triage",
          sourceNodeId: "entry",
          targetNodeId: "agent-triage",
        },
      ],
    });

    expect(validateWorkflowGraph(graph).ok).toBe(true);
    const routePolicies = buildDraftWorkflowManifest(graph).routePolicies;

    expect(routePolicies).toEqual([
      expect.objectContaining({
        sourceAgentId: "agent-triage",
        trigger: "on_caller_turn_end",
        activation: "until_routed",
        readiness: {
          mode: "auto_with_clarification",
          maxClarificationTurns: 2,
        },
        announcement: {
          mode: "template",
          text: "I'll connect you with {targetAgentName}.",
        },
        branches: [
          expect.objectContaining({
            id: "branch-billing",
            intentKey: "billing",
            target: {
              type: "agent",
              agentId: "agent-billing",
            },
            transferInstructions: "Continue with billing context; do not repeat triage questions.",
          }),
        ],
        fallback: {
          label: "Clarify",
          target: {
            type: "clarify_source_agent",
          },
        },
      }),
    ]);
    expect(routePolicies[0]?.branches[0]).not.toHaveProperty("description");
    expect(routePolicies[0]?.branches[0]).not.toHaveProperty("examples");
  });

  it("preserves route policy metadata in published agent role snapshots", () => {
    const triageAgent = createAgentRoleNode({
      id: "agent-triage",
      label: "Front desk triage",
      position: { x: 120, y: 80 },
      role: {
        kind: "receptionist",
        name: "Front desk triage",
        businessName: "Tuzzy Labs",
        instructions: "Clarify caller needs and hand off only when the next specialist is clear.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        routePolicy: {
          type: "route_by_intent",
          trigger: "on_caller_turn_end",
          activation: "until_routed",
          classifier: {
            mode: "standard",
            modelAlias: "intent-classifier-fast",
            confidenceThreshold: 0.75,
          },
          inputWindow: {
            latestCallerTurn: true,
            recentTranscriptTurns: 4,
            includeConversationSummary: true,
            includePreviousAgentContext: true,
            includeRecentToolResults: false,
          },
          readiness: {
            mode: "auto_with_clarification",
            maxClarificationTurns: 2,
          },
          announcement: {
            mode: "template",
            text: "I'll connect you with {targetAgentName}.",
          },
          branches: [
            {
              id: "branch-billing",
              label: "Billing",
              intentKey: "billing",
              target: {
                type: "agent",
                agentId: "agent-billing",
              },
            },
          ],
          fallback: {
            label: "Clarify",
            target: {
              type: "clarify_source_agent",
            },
          },
        },
      },
    });
    const graph = createWorkflowGraph({
      id: "workflow-route-policy-role-snapshot",
      name: "Route policy role snapshot",
      nodes: [entryNode, triageAgent, billingAgent],
      edges: [
        {
          id: "edge-entry-triage",
          sourceNodeId: "entry",
          targetNodeId: "agent-triage",
        },
      ],
    });
    const published = publishWorkflowVersion({
      workflowId: graph.id,
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-default",
      environment: "sandbox",
      createdBy: "user-1",
      graph,
      existingVersions: [],
      runtime: "openai-realtime",
      runtimeProfile: "premium-realtime",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: false,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 214,
        projectedCostPerMinuteUsd: 0.18,
        blockOnLimit: true,
      },
    });

    expect(publishedWorkflowVersionSchemaVersion).toBe("zara.published-workflow.v2");
    expect(published.schemaVersion).toBe(publishedWorkflowVersionSchemaVersion);
    expect(published.roles.find((role) => role.id === "agent-triage")).toMatchObject({
      routePolicy: {
        branches: [
          expect.objectContaining({
            id: "branch-billing",
          }),
        ],
      },
    });
    const publishedRole = published.roles.find((role) => role.id === "agent-triage") as
      | { routePolicy?: { branches?: Array<Record<string, unknown>> } }
      | undefined;
    const publishedBranch = publishedRole?.routePolicy?.branches?.[0];
    expect(publishedBranch).not.toHaveProperty("description");
    expect(publishedBranch).not.toHaveProperty("examples");
  });

  it("rejects route-by-intent branches that target the source agent directly", () => {
    const selfRoutingAgent = createAgentRoleNode({
      id: "agent-self-routing",
      label: "Self routing triage",
      position: { x: 120, y: 80 },
      role: {
        kind: "receptionist",
        name: "Self routing triage",
        businessName: "Tuzzy Labs",
        instructions: "Route only when a different destination is clear.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        routePolicy: {
          type: "route_by_intent",
          trigger: "on_caller_turn_end",
          activation: "until_routed",
          classifier: {
            mode: "standard",
            modelAlias: "intent-classifier-fast",
            confidenceThreshold: 0.75,
          },
          inputWindow: {
            latestCallerTurn: true,
            recentTranscriptTurns: 4,
            includeConversationSummary: true,
            includePreviousAgentContext: true,
            includeRecentToolResults: false,
          },
          readiness: {
            mode: "auto_with_clarification",
          },
          announcement: {
            mode: "template",
            text: "I'll connect you with {targetAgentName}.",
          },
          branches: [
            {
              id: "branch-loop",
              label: "Loop",
              intentKey: "loop",
              target: {
                type: "agent",
                agentId: "agent-self-routing",
              },
            },
          ],
          fallback: {
            label: "Clarify",
            target: {
              type: "clarify_source_agent",
            },
          },
        },
      },
    });
    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-self-routing",
        name: "Self routing",
        nodes: [entryNode, selfRoutingAgent],
        edges: [
          {
            id: "edge-entry-self-routing",
            sourceNodeId: "entry",
            targetNodeId: "agent-self-routing",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain("agent.route_policy_invalid_target");
  });

  it("preserves agent text model provider and explicit model id in published snapshots", () => {
    const geminiAgent = createAgentRoleNode({
      id: "agent-gemini",
      label: "Gemini specialist",
      position: { x: 240, y: 80 },
      role: {
        kind: "support",
        name: "Gemini specialist",
        businessName: "Tuzzy Labs",
        instructions: "Use the selected Gemini model for concise support responses.",
        defaultModelTier: "standard",
        modelProvider: "google-gemini",
        modelId: "gemini-3.1-pro-preview",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
      },
    });
    const published = publishWorkflowVersion({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-default",
      environment: "production",
      workflowId: "workflow-gemini",
      graph: createWorkflowGraph({
        id: "workflow-gemini",
        name: "Gemini workflow",
        nodes: [entryNode, geminiAgent],
        edges: [
          {
            id: "edge-entry-gemini",
            sourceNodeId: "entry",
            targetNodeId: "agent-gemini",
          },
        ],
      }),
      createdBy: "user-ops-lead",
      existingVersions: [],
      runtime: "sandwich-pipeline",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "session-only",
        retrievalScopes: ["session"],
        approvalRequired: false,
      },
      budget: {
        monthlyCapUsd: 1000,
        currentSpendUsd: 0,
        projectedCostPerMinuteUsd: 0.2,
        blockOnLimit: true,
      },
    });

    expect(published.roles[0]).toMatchObject({
      modelProvider: "google-gemini",
      modelId: "gemini-3.1-pro-preview",
    });
  });

  it("preserves approved Cartesia voice configuration in published agent snapshots", () => {
    const voiceAgent = createAgentRoleNode({
      id: "agent-voice",
      label: "Voice specialist",
      position: { x: 240, y: 80 },
      role: {
        kind: "support",
        name: "Voice specialist",
        businessName: "Tuzzy Labs",
        instructions: "Use the approved support voice for caller conversations.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        voiceConfig: {
          provider: "cartesia",
          voiceId: "voice-support-approved",
          label: "Support voice",
          sourceType: "catalog",
          speed: 1.08,
          volume: 1.1,
          emotion: "calm",
        },
      },
    });

    const published = publishWorkflowVersion({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-default",
      environment: "production",
      workflowId: "workflow-voice",
      graph: createWorkflowGraph({
        id: "workflow-voice",
        name: "Voice workflow",
        nodes: [entryNode, voiceAgent],
        edges: [
          {
            id: "edge-entry-voice",
            sourceNodeId: "entry",
            targetNodeId: "agent-voice",
          },
        ],
      }),
      createdBy: "user-ops-lead",
      existingVersions: [],
      runtime: "sandwich-pipeline",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "session-only",
        retrievalScopes: ["session"],
        approvalRequired: false,
      },
      budget: {
        monthlyCapUsd: 1000,
        currentSpendUsd: 0,
        projectedCostPerMinuteUsd: 0.2,
        blockOnLimit: true,
      },
    });

    expect(published.roles[0]?.voiceConfig).toEqual({
      provider: "cartesia",
      voiceId: "voice-support-approved",
      label: "Support voice",
      sourceType: "catalog",
      speed: 1.08,
      volume: 1.1,
      emotion: "calm",
    });
  });

  it("preserves provider-native premium realtime voice configuration separately from Cartesia voice config", () => {
    const realtimeVoiceAgent = createAgentRoleNode({
      id: "agent-realtime-voice",
      label: "Realtime voice specialist",
      position: { x: 240, y: 80 },
      role: {
        kind: "support",
        name: "Realtime voice specialist",
        businessName: "Tuzzy Labs",
        instructions: "Use the selected native realtime provider voice.",
        defaultModelTier: "standard",
        realtimeProvider: "openai-realtime",
        runtimeProfileOverride: "premium-realtime",
        realtimeVoiceConfig: {
          provider: "openai-realtime",
          voice: "cedar",
          speed: 0.92,
        },
        voiceConfig: {
          provider: "cartesia",
          voiceId: "voice-support-approved",
          label: "Support voice",
          sourceType: "catalog",
          speed: 1.08,
        },
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
      },
    });

    const published = publishWorkflowVersion({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-default",
      environment: "production",
      workflowId: "workflow-realtime-voice",
      graph: createWorkflowGraph({
        id: "workflow-realtime-voice",
        name: "Realtime voice workflow",
        nodes: [entryNode, realtimeVoiceAgent],
        edges: [
          {
            id: "edge-entry-realtime-voice",
            sourceNodeId: "entry",
            targetNodeId: "agent-realtime-voice",
          },
        ],
      }),
      createdBy: "user-ops-lead",
      existingVersions: [],
      runtime: "openai-realtime",
      runtimeProfile: "premium-realtime",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "session-only",
        retrievalScopes: ["session"],
        approvalRequired: false,
      },
      budget: {
        monthlyCapUsd: 1000,
        currentSpendUsd: 0,
        projectedCostPerMinuteUsd: 0.2,
        blockOnLimit: true,
      },
    });

    expect(published.roles[0]?.realtimeVoiceConfig).toEqual({
      provider: "openai-realtime",
      voice: "cedar",
      speed: 0.92,
    });
    expect(published.roles[0]?.voiceConfig).toEqual({
      provider: "cartesia",
      voiceId: "voice-support-approved",
      label: "Support voice",
      sourceType: "catalog",
      speed: 1.08,
    });
  });

  it("blocks publishing when a cloned voice is not approved for use", () => {
    const clonedVoiceAgent = createAgentRoleNode({
      id: "agent-cloned-voice",
      label: "Cloned voice specialist",
      position: { x: 240, y: 80 },
      role: {
        kind: "support",
        name: "Cloned voice specialist",
        businessName: "Tuzzy Labs",
        instructions: "Use a tenant-owned cloned support voice.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        voiceConfig: {
          provider: "cartesia",
          voiceId: "voice-clone-disabled",
          label: "Disabled cloned voice",
          sourceType: "cloned",
          cloneStatus: "disabled",
        },
      },
    });

    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-disabled-clone",
        name: "Disabled clone workflow",
        nodes: [entryNode, clonedVoiceAgent],
        edges: [
          {
            id: "edge-entry-cloned-voice",
            sourceNodeId: "entry",
            targetNodeId: "agent-cloned-voice",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain("agent.voice_unavailable");
  });

  it("blocks publishing when required agent fields are missing", () => {
    const invalidAgent = createAgentRoleNode({
      id: "agent-empty",
      label: "Empty specialist",
      position: { x: 240, y: 80 },
      role: {
        kind: "support",
        name: "",
        businessName: "",
        instructions: "",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "",
          supportedLanguages: [],
          allowMidCallSwitching: false,
        },
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
      "agent.missing_business_name",
      "agent.missing_instructions",
      "agent.missing_default_language",
      "agent.missing_supported_language",
    ]);
    expect(result.errors[0]?.suggestion).toContain("Add a role name");
  });

  it("validates multi-language policy and preserves runtime prompt selection metadata", () => {
    const multilingualAgent = createAgentRoleNode({
      id: "agent-multilingual",
      label: "Multilingual specialist",
      position: { x: 240, y: 80 },
      role: {
        kind: "support",
        name: "Multilingual specialist",
        businessName: "Tuzzy Labs",
        instructions: "Support callers in the configured languages.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "fr",
          supportedLanguages: ["en", "en", "zz-top"],
          allowMidCallSwitching: true,
          languagePrompts: {
            en: "Respond in English unless the caller switches languages.",
            "zz-top": "",
          },
        },
      },
    });
    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-multilingual-invalid",
        name: "Multilingual invalid",
        nodes: [entryNode, multilingualAgent],
        edges: [
          {
            id: "edge-entry-multilingual",
            sourceNodeId: "entry",
            targetNodeId: "agent-multilingual",
          },
        ],
      }),
    );

    expect(codes(result.errors)).toEqual([
      "agent.default_language_not_supported",
      "agent.duplicate_language",
      "agent.unsupported_language",
      "agent.missing_language_prompt",
    ]);

    const validAgent = createAgentRoleNode({
      id: "agent-multilingual-valid",
      label: "Multilingual specialist",
      position: { x: 240, y: 80 },
      role: {
        kind: "support",
        name: "Multilingual specialist",
        businessName: "Tuzzy Labs",
        instructions: "Support callers in the configured languages.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "fr",
          supportedLanguages: ["en", "fr"],
          allowMidCallSwitching: true,
          languagePrompts: {
            en: "Respond in English unless the caller switches languages.",
            fr: "Respond in French when the caller prefers French.",
          },
        },
      },
    });
    const published = publishWorkflowVersion({
      tenantId: "tenant-west-africa",
      environment: "production",
      workflowId: "workflow-multilingual-valid",
      graph: createWorkflowGraph({
        id: "workflow-multilingual-valid",
        name: "Multilingual valid",
        nodes: [entryNode, validAgent],
        edges: [
          {
            id: "edge-entry-multilingual-valid",
            sourceNodeId: "entry",
            targetNodeId: "agent-multilingual-valid",
          },
        ],
      }),
      runtime: "sandwich-pipeline",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "session-only",
        retrievalScopes: ["session"],
        approvalRequired: false,
      },
      budget: {
        monthlyCapUsd: 120,
        currentSpendUsd: 0,
        projectedCostPerMinuteUsd: 0.1,
        blockOnLimit: true,
      },
      createdBy: "ops-lead",
      existingVersions: [],
    });

    expect(published.roles[0]?.languagePolicy).toEqual({
      defaultLanguage: "fr",
      supportedLanguages: ["en", "fr"],
      allowMidCallSwitching: true,
      languagePrompts: {
        en: "Respond in English unless the caller switches languages.",
        fr: "Respond in French when the caller prefers French.",
      },
    });
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
        businessName: "Tuzzy Labs",
        instructions: "Handle overflow support.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
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
      "relationship.entry_cannot_receive_route",
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

describe("tool workflow nodes", () => {
  it("captures connector binding, risk, and approval state", () => {
    const zendeskTool = createToolNode({
      id: "tool-zendesk",
      label: "Zendesk lookup",
      position: { x: 520, y: 80 },
      toolId: "zendesk.search",
      tool: {
        connector: "zendesk",
        toolName: "Ticket lookup",
        integrationConnectionId: "zendesk-wa-prod",
        integrationLabel: "Zendesk · West Africa support",
        connectionStatus: "connected",
        risk: "medium",
        requiresAuthorization: true,
        requiresHumanApproval: true,
      },
    });

    expect(zendeskTool.kind).toBe("tool");
    expect(zendeskTool.toolId).toBe("zendesk.search");
    expect(zendeskTool.config).toEqual({
      tool: {
        connector: "zendesk",
        toolName: "Ticket lookup",
        integrationConnectionId: "zendesk-wa-prod",
        integrationLabel: "Zendesk · West Africa support",
        connectionStatus: "connected",
        risk: "medium",
        requiresAuthorization: true,
        requiresHumanApproval: true,
      },
    });
  });

  it("blocks publishing when a permitted tool is missing credentials", () => {
    const zendeskTool = createToolNode({
      id: "tool-zendesk",
      label: "Zendesk lookup",
      position: { x: 520, y: 80 },
      toolId: "zendesk.search",
      tool: {
        connector: "zendesk",
        toolName: "Ticket lookup",
        connectionStatus: "missing",
        risk: "medium",
        requiresAuthorization: true,
        requiresHumanApproval: true,
      },
    });

    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-missing-tool-auth",
        name: "Tool auth missing",
        nodes: [entryNode, frontDeskAgent, zendeskTool],
        edges: [
          {
            id: "edge-entry-front-desk",
            sourceNodeId: "entry",
            targetNodeId: "agent-front-desk",
          },
          {
            id: "edge-front-desk-tool",
            sourceNodeId: "agent-front-desk",
            targetNodeId: "tool-zendesk",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(["tool.missing_authorization"]);
    expect(result.errors[0]?.suggestion).toContain("authorized integration account");
  });

  it("captures api request details and rejects missing request parameters", () => {
    const webhookTool = createToolNode({
      id: "tool-webhook",
      label: "Webhook action",
      position: { x: 520, y: 80 },
      toolId: "webhook.post",
      tool: {
        connector: "webhook",
        toolName: "Webhook action",
        connectionStatus: "connected",
        risk: "high",
        requiresAuthorization: false,
        requiresHumanApproval: true,
        request: {
          method: "POST",
          url: "https://hooks.zara.ai/inbound",
          authToken: "{{secrets.webhook_token}}",
          headers: [{ name: "X-Zara-Tenant", value: "{{tenant.id}}" }],
          bodyTemplate: '{"callId":"{{call.id}}"}',
        },
      },
    });

    expect(webhookTool.config).toEqual({
      tool: {
        connector: "webhook",
        toolName: "Webhook action",
        connectionStatus: "connected",
        risk: "high",
        requiresAuthorization: false,
        requiresHumanApproval: true,
        request: {
          method: "POST",
          url: "https://hooks.zara.ai/inbound",
          authToken: "{{secrets.webhook_token}}",
          headers: [{ name: "X-Zara-Tenant", value: "{{tenant.id}}" }],
          bodyTemplate: '{"callId":"{{call.id}}"}',
        },
      },
    });

    const invalidWebhookTool = createToolNode({
      id: "tool-webhook-invalid",
      label: "Broken webhook",
      position: { x: 520, y: 80 },
      toolId: "webhook.post",
      tool: {
        connector: "webhook",
        toolName: "Webhook action",
        connectionStatus: "connected",
        risk: "high",
        requiresAuthorization: false,
        requiresHumanApproval: true,
        request: {
          method: "POST",
          url: "",
          authToken: "",
          headers: [],
          bodyTemplate: "",
        },
      },
    });

    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-missing-request-config",
        name: "Missing request config",
        nodes: [entryNode, frontDeskAgent, invalidWebhookTool],
        edges: [
          {
            id: "edge-entry-front-desk",
            sourceNodeId: "entry",
            targetNodeId: "agent-front-desk",
          },
          {
            id: "edge-front-desk-tool",
            sourceNodeId: "agent-front-desk",
            targetNodeId: "tool-webhook-invalid",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual([
      "tool.missing_request_url",
      "tool.missing_request_auth_token",
      "tool.missing_request_headers",
    ]);
  });
});

describe("tool and escalation workflow nodes", () => {
  it("distinguishes tools from escalation policy in the draft manifest", () => {
    const zendeskTool = createToolNode({
      id: "tool-zendesk",
      label: "Zendesk lookup",
      position: { x: 520, y: 60 },
      toolId: "zendesk.search",
      tool: {
        connector: "zendesk",
        toolName: "Ticket lookup",
        integrationConnectionId: "zendesk-wa-prod",
        integrationLabel: "Zendesk · West Africa support",
        connectionStatus: "connected",
        risk: "low",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      },
    });
    const escalation = createHumanEscalationNode({
      id: "human-escalation",
      label: "Human escalation",
      position: { x: 720, y: 260 },
      escalation: {
        queueId: "support-ops",
        queueName: "Support operations",
        fallbackMode: "callback",
        fallbackMessage: "Offer a callback if no human is immediately available.",
      },
    });

    const graph = createWorkflowGraph({
      id: "workflow-manifest-shape",
      name: "Manifest shape",
      nodes: [entryNode, frontDeskAgent, billingAgent, zendeskTool, escalation],
      edges: [
        {
          id: "edge-entry-front-desk",
          sourceNodeId: "entry",
          targetNodeId: "agent-front-desk",
        },
        {
          id: "edge-front-desk-tool",
          sourceNodeId: "agent-front-desk",
          targetNodeId: "tool-zendesk",
        },
        {
          id: "edge-front-desk-escalation",
          sourceNodeId: "agent-front-desk",
          targetNodeId: "human-escalation",
        },
      ],
    });

    const manifest = buildDraftWorkflowManifest(graph);

    expect(manifest.tools).toEqual([
      expect.objectContaining({
        nodeId: "tool-zendesk",
        toolId: "zendesk.search",
        connector: "zendesk",
      }),
    ]);
    expect(manifest.tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ nodeId: "human-escalation" })]),
    );
    expect(manifest.escalation).toEqual(
      expect.objectContaining({
        enabled: true,
        queueId: "support-ops",
        queueName: "Support operations",
        fallbackMode: "callback",
        fallbackMessage: "Offer a callback if no human is immediately available.",
      }),
    );
  });

  it("rejects invalid escalation queues", () => {
    const invalidEscalation = createHumanEscalationNode({
      id: "human-escalation",
      label: "Broken escalation",
      position: { x: 720, y: 260 },
      escalation: {
        queueId: "",
        queueName: "",
        fallbackMode: "callback",
        fallbackMessage: "",
      },
    });

    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-invalid-routes",
        name: "Invalid routes",
        nodes: [entryNode, frontDeskAgent, invalidEscalation],
        edges: [
          {
            id: "edge-entry-front-desk",
            sourceNodeId: "entry",
            targetNodeId: "agent-front-desk",
          },
          {
            id: "edge-front-desk-escalation",
            sourceNodeId: "agent-front-desk",
            targetNodeId: "human-escalation",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual([
      "escalation.missing_queue",
      "escalation.missing_fallback_message",
    ]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "human-escalation",
          suggestion: "Bind this escalation to a live queue before publishing.",
        }),
      ]),
    );
  });
});

describe("condition routing and exit nodes", () => {
  it("routes callers through condition branches and falls back to an exit node", () => {
    const resolvedExit = createEndNode({
      id: "end-resolved",
      label: "Resolved exit",
      position: { x: 720, y: 260 },
      end: {
        outcome: "resolved",
        closingMessage: "End the call when the front desk resolves the request.",
      },
    });
    const condition = createConditionNode({
      id: "condition-route",
      label: "Intent route",
      position: { x: 320, y: 200 },
      condition: {
        branches: [
          {
            id: "branch-billing",
            label: "Billing",
            expression: 'intent == "billing"',
            targetNodeId: "agent-billing",
          },
        ],
        fallbackLabel: "Resolved",
        fallbackTargetNodeId: "end-resolved",
      },
    });

    const graph = createWorkflowGraph({
      id: "workflow-condition-routing",
      name: "Condition routing",
      nodes: [entryNode, frontDeskAgent, billingAgent, resolvedExit, condition],
      edges: [
        {
          id: "edge-entry-front-desk",
          sourceNodeId: "entry",
          targetNodeId: "agent-front-desk",
        },
        {
          id: "edge-front-desk-condition",
          sourceNodeId: "agent-front-desk",
          targetNodeId: "condition-route",
        },
        {
          id: "edge-condition-billing",
          sourceNodeId: "condition-route",
          targetNodeId: "agent-billing",
          condition: "Billing",
        },
        {
          id: "edge-condition-exit",
          sourceNodeId: "condition-route",
          targetNodeId: "end-resolved",
          condition: "Resolved",
        },
      ],
    });

    expect(validateWorkflowGraph(graph).ok).toBe(true);
    expect(resolveConditionBranch(condition, { intent: "billing" })).toEqual(
      expect.objectContaining({
        branchId: "branch-billing",
        targetNodeId: "agent-billing",
        isFallback: false,
      }),
    );
    expect(resolveConditionBranch(condition, { intent: "support" })).toEqual(
      expect.objectContaining({
        branchId: "fallback",
        targetNodeId: "end-resolved",
        isFallback: true,
      }),
    );
  });

  it("rejects invalid condition expressions and missing fallback branches", () => {
    const brokenCondition = createConditionNode({
      id: "condition-broken",
      label: "Broken route",
      position: { x: 320, y: 200 },
      condition: {
        branches: [
          {
            id: "branch-billing",
            label: "Billing",
            expression: "intent = billing",
            targetNodeId: "agent-billing",
          },
        ],
        fallbackLabel: "",
        fallbackTargetNodeId: "",
      },
    });

    const result = validateWorkflowGraph(
      createWorkflowGraph({
        id: "workflow-invalid-condition",
        name: "Invalid condition",
        nodes: [entryNode, frontDeskAgent, billingAgent, brokenCondition],
        edges: [
          {
            id: "edge-entry-front-desk",
            sourceNodeId: "entry",
            targetNodeId: "agent-front-desk",
          },
          {
            id: "edge-front-desk-condition",
            sourceNodeId: "agent-front-desk",
            targetNodeId: "condition-broken",
          },
          {
            id: "edge-condition-billing",
            sourceNodeId: "condition-broken",
            targetNodeId: "agent-billing",
            condition: "Billing",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual([
      "condition.invalid_expression",
      "condition.missing_fallback",
    ]);
  });
});

describe("publishing and manifest preview", () => {
  it("publishes immutable versions, pins calls to the published snapshot, and previews runtime settings", () => {
    const resolvedExit = createEndNode({
      id: "end-resolved",
      label: "Resolved exit",
      position: { x: 720, y: 260 },
      end: {
        outcome: "resolved",
        closingMessage: "End the call when the front desk resolves the request.",
      },
    });
    const condition = createConditionNode({
      id: "condition-route",
      label: "Intent route",
      position: { x: 320, y: 200 },
      condition: {
        branches: [
          {
            id: "branch-billing",
            label: "Billing",
            expression: 'intent == "billing"',
            targetNodeId: "agent-billing",
          },
        ],
        fallbackLabel: "Resolved",
        fallbackTargetNodeId: "end-resolved",
      },
    });
    const zendeskTool = createToolNode({
      id: "tool-zendesk",
      label: "Zendesk lookup",
      position: { x: 520, y: 60 },
      toolId: "zendesk.search",
      tool: {
        connector: "zendesk",
        toolName: "Ticket lookup",
        integrationConnectionId: "zendesk-wa-prod",
        integrationLabel: "Zendesk - West Africa support",
        connectionStatus: "connected",
        risk: "low",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      },
    });

    const draftGraph = createWorkflowGraph({
      id: "workflow-publishable",
      name: "Publishable workflow",
      nodes: [entryNode, frontDeskAgent, billingAgent, resolvedExit, condition, zendeskTool],
      edges: [
        {
          id: "edge-entry-front-desk",
          sourceNodeId: "entry",
          targetNodeId: "agent-front-desk",
        },
        {
          id: "edge-front-desk-tool",
          sourceNodeId: "agent-front-desk",
          targetNodeId: "tool-zendesk",
        },
        {
          id: "edge-front-desk-condition",
          sourceNodeId: "agent-front-desk",
          targetNodeId: "condition-route",
        },
        {
          id: "edge-condition-billing",
          sourceNodeId: "condition-route",
          targetNodeId: "agent-billing",
          condition: "Billing",
        },
        {
          id: "edge-condition-exit",
          sourceNodeId: "condition-route",
          targetNodeId: "end-resolved",
          condition: "Resolved",
        },
      ],
    });

    const preview = buildRuntimeManifestPreview({
      tenantId: "tenant-west-africa",
      environment: "production",
      workflowId: "workflow-publishable",
      graph: draftGraph,
      runtime: "sandwich-pipeline",
      telephonyProvider: "twilio",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session", "caller"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 482,
        projectedCostPerMinuteUsd: 0.24,
        blockOnLimit: true,
      },
    });

    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: runtimeManifestPreviewSchemaVersion,
        scope: "draft",
        runtime: "sandwich-pipeline",
        telephonyProvider: "twilio",
        entryAgentId: "agent-front-desk",
      }),
    );
    expect(preview).not.toHaveProperty("entryRoleId");
    expect(preview.memory).toEqual(
      expect.objectContaining({
        mode: "scoped",
        retrievalScopes: ["session", "caller"],
      }),
    );
    expect(preview.budget).toEqual(
      expect.objectContaining({
        monthlyCapUsd: 1200,
        blockOnLimit: true,
      }),
    );
    expect(preview.conditions).toEqual([
      expect.objectContaining({
        nodeId: "condition-route",
        fallbackTargetNodeId: "end-resolved",
      }),
    ]);
    expect(preview.exitNodes).toEqual([
      expect.objectContaining({
        nodeId: "end-resolved",
        outcome: "resolved",
      }),
    ]);

    const publishedVersion = publishWorkflowVersion({
      workflowId: "workflow-publishable",
      tenantId: "tenant-west-africa",
      environment: "production",
      createdBy: "user-1",
      graph: draftGraph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      telephonyProvider: "twilio",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session", "caller"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 482,
        projectedCostPerMinuteUsd: 0.24,
        blockOnLimit: true,
      },
    });

    const pinnedCall = pinPublishedWorkflowVersion({
      callSessionId: "call-1",
      publishedVersion,
    });

    draftGraph.nodes[1]!.label = "Mutated draft";

    expect(publishedVersion.version).toBe(1);
    expect(publishedVersion.graph.nodes.find((node) => node.id === "agent-front-desk")?.label).toBe("Front desk triage");
    expect(publishedVersion.manifestPreview.scope).toBe("published");
    expect(publishedVersion.manifestPreview.schemaVersion).toBe(runtimeManifestPreviewSchemaVersion);
    expect(publishedVersion.manifestPreview).toEqual(
      expect.objectContaining({
        entryAgentId: "agent-front-desk",
      }),
    );
    expect(publishedVersion.manifestPreview).not.toHaveProperty("entryRoleId");
    expect(pinnedCall.publishedVersionId).toBe(publishedVersion.id);
    expect(pinnedCall.graph.nodes.find((node) => node.id === "agent-front-desk")?.label).toBe("Front desk triage");

    const republished = publishWorkflowVersion({
      workflowId: "workflow-publishable",
      tenantId: "tenant-west-africa",
      environment: "production",
      createdBy: "user-1",
      graph: draftGraph,
      existingVersions: [publishedVersion],
      runtime: "sandwich-pipeline",
      telephonyProvider: "twilio",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session", "caller"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 482,
        projectedCostPerMinuteUsd: 0.24,
        blockOnLimit: true,
      },
    });

    expect(republished.version).toBe(2);
    expect(publishedVersion.version).toBe(1);
  });
});
