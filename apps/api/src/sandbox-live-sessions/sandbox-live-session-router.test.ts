import { describe, expect, it } from "vitest";
import type { CompiledRuntimeManifest, IntentClassifierOutput } from "@zara/core";

import {
  resolveLiveSandboxAgentHandoffAction,
  resolveLiveSandboxTurnRoute,
} from "./sandbox-live-session-router";

describe("resolveLiveSandboxTurnRoute", () => {
  it("walks condition routes before selecting the responding agent", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildRoutingManifest(),
      frontier: ["entry"],
      transcript: "I have a billing issue on my last invoice.",
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-billing");
    expect(route.nextFrontier).toEqual([]);
    expect(route.context).toEqual({ intent: "billing" });
    expect("toolInvocations" in route).toBe(false);
    expect(route.preEvents.map((event) => event.type)).toEqual([
      "node.transition",
      "node.transition",
      "node.transition",
      "node.transition",
      "node.transition",
      "agent.handoff.requested",
      "agent.handoff.completed",
    ]);
    expect(route.preEvents).toContainEqual({
      type: "node.transition",
      payload: {
        nodeId: "condition-intent",
        branchId: "branch-billing",
        branchLabel: "Billing",
        targetNodeId: "agent-billing",
        isFallback: false,
      },
    });
  });

  it("uses the selected sandbox intent when the transcript does not mention the branch name", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildRoutingManifest(),
      frontier: ["entry"],
      transcript: "Please route this to the right specialist.",
      intent: "billing",
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-billing");
    expect(route.context).toEqual({ intent: "billing" });
    expect(route.preEvents).toContainEqual({
      type: "node.transition",
      payload: {
        nodeId: "condition-intent",
        branchId: "branch-billing",
        branchLabel: "Billing",
        targetNodeId: "agent-billing",
        isFallback: false,
      },
    });
  });

  it("falls back to the manifest entry and stops on terminal nodes without model routing", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildTerminalManifest(),
      frontier: [],
      transcript: "thanks goodbye",
    });

    expect(route).toMatchObject({
      kind: "terminal",
      nodeId: "end-resolved",
      responseText: "Thanks for calling. Goodbye.",
      nextFrontier: [],
    });
    expect("toolInvocations" in route).toBe(false);
  });

  it("returns a packet-backed route with traversal, tool, transfer, and active-agent facts", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildRoutingManifest(),
      frontier: ["entry"],
      transcript: "I have a billing issue on my last invoice.",
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.packet.ids).toMatchObject({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      callSessionId: "session-1",
      turnId: "turn-1",
      manifestId: "manifest-routing",
      manifestVersion: 1,
    });
    expect(route.packet.graph.visitedNodeIds).toEqual([
      "entry",
      "agent-front",
      "condition-intent",
      "agent-billing",
    ]);
    expect(route.packet.graph.activeAgent).toMatchObject({
      id: "agent-billing",
      name: "Billing specialist",
      kind: "billing",
    });
    expect(route.packet.toolCalls.map((toolCall) => toolCall.request)).toEqual([]);
    expect(route.packet.transfer).toMatchObject({
      transferId: "turn-1:agent-front:agent-billing",
      sourceAgent: {
        id: "agent-front",
        name: "Front desk",
      },
      targetAgent: {
        id: "agent-billing",
        name: "Billing specialist",
      },
      reason: "Direct route from Front desk to Billing specialist.",
      callerNeedSummary: "I have a billing issue on my last invoice.",
      matchedIntent: {
        intentKey: "billing",
        label: "Billing",
        confidence: 1,
      },
    });
    expect(route.packet.diagnostics.events.map((event) => ({
      type: event.type,
      turnId: event.turnId,
      sequence: event.sequence,
      nodeId: event.nodeId,
    }))).toEqual([
      { type: "node.visited", turnId: "turn-1", sequence: 1, nodeId: "entry" },
      { type: "node.visited", turnId: "turn-1", sequence: 2, nodeId: "agent-front" },
      { type: "node.visited", turnId: "turn-1", sequence: 3, nodeId: "condition-intent" },
      { type: "intent.classified", turnId: "turn-1", sequence: 4, nodeId: "condition-intent" },
      { type: "node.visited", turnId: "turn-1", sequence: 5, nodeId: "agent-billing" },
      { type: "transfer.created", turnId: "turn-1", sequence: 6, nodeId: "agent-billing" },
      { type: "agent.selected", turnId: "turn-1", sequence: 7, nodeId: "agent-billing" },
    ]);
  });

  it("uses the intent classifier when no sandbox intent override is selected", async () => {
    const classifierCalls: Array<{ latestCallerTurn: string; branchIds: string[] }> = [];
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildRoutingManifest(),
      frontier: ["entry"],
      transcript: "Can someone help me understand this charge?",
      intentClassifier: {
        async classify(input) {
          classifierCalls.push({
            latestCallerTurn: input.latestCallerTurn,
            branchIds: input.branches.map((branch) => branch.id),
          });
          return {
            matchedBranchId: "branch-billing",
            intentKey: "billing",
            confidence: 0.91,
            reason: "The caller is asking about a charge.",
            usedFallback: false,
          } satisfies IntentClassifierOutput;
        },
      },
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(classifierCalls).toEqual([
      {
        latestCallerTurn: "Can someone help me understand this charge?",
        branchIds: ["branch-billing"],
      },
    ]);
    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-billing");
    expect(route.context).toEqual({ intent: "billing" });
    expect(route.packet.intent).toEqual({
      nodeId: "condition-intent",
      matchedBranchId: "branch-billing",
      intentKey: "billing",
      label: "Billing",
      confidence: 0.91,
      reason: "The caller is asking about a charge.",
      usedFallback: false,
      targetNodeId: "agent-billing",
    });
  });

  it("uses fallback without calling the classifier when caller input is empty", async () => {
    let classifierCalls = 0;
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildRoutingManifest(),
      frontier: ["entry"],
      transcript: "   ",
      intentClassifier: {
        async classify() {
          classifierCalls += 1;
          return {
            matchedBranchId: "branch-billing",
            intentKey: "billing",
            confidence: 0.99,
            reason: "Should not be called.",
            usedFallback: false,
          };
        },
      },
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(classifierCalls).toBe(0);
    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-front");
    expect(route.context).toEqual({});
    expect(route.packet.intent).toEqual({
      nodeId: "condition-intent",
      matchedBranchId: null,
      intentKey: null,
      label: null,
      confidence: 0,
      reason: "Caller input was empty; using fallback.",
      usedFallback: true,
      targetNodeId: "agent-front",
    });
    expect(route.packet.diagnostics.warnings).toContainEqual({
      code: "intent_classifier.empty_input",
      message: "Caller input was empty, so intent classification used fallback.",
      recoverable: true,
    });
  });

  it("selects a handoff-capable agent with safe handoff targets without classifying first", async () => {
    const classifierCalls: Array<{ nodeId: string; branchIds: string[] }> = [];
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildAgentRoutePolicyManifest(),
      frontier: ["agent-front"],
      transcript: "Can a billing specialist explain the charge on invoice INV-1042?",
      intentClassifier: {
        async classify(input) {
          classifierCalls.push({
            nodeId: input.nodeId,
            branchIds: input.branches.map((branch) => branch.id),
          });
          return {
            matchedBranchId: "branch-billing",
            intentKey: "billing",
            confidence: 0.94,
            reason: "The caller needs billing help.",
            usedFallback: false,
            targetNodeId: "agent-support",
          } as IntentClassifierOutput;
        },
      },
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(classifierCalls).toEqual([]);
    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-front");
    expect(route.nextFrontier).toEqual([]);
    expect(route.context).toEqual({});
    expect(route.packet.intent).toBeUndefined();
    expect(route.packet.transfer).toBeUndefined();
    expect(route.preEvents.map((event) => event.type)).not.toContain("agent.route.announcement");
    expect(route.preEvents.map((event) => event.type)).not.toContain("agent.handoff.completed");
    const packetView = route.packet as unknown as {
      availableActions?: unknown;
      handoffTargets?: unknown;
    };
    expect(packetView.handoffTargets).toBeUndefined();
    expect(packetView.availableActions).toEqual([
      expect.objectContaining({
        kind: "internal_handoff",
        actionType: "handoff_to_agent",
        targets: [
          {
            targetAgentId: "agent-billing",
            targetAgentName: "Billing specialist",
            targetAgentKind: "billing",
          },
        ],
      }),
    ]);
    expect(JSON.stringify(packetView.availableActions)).not.toContain("branch-billing");
    expect(JSON.stringify(packetView.availableActions)).not.toContain("agent-stale");
    expect(JSON.stringify(packetView.availableActions)).not.toContain("The caller needs help with invoices");
    expect(JSON.stringify(packetView.availableActions)).not.toContain("deleted specialist");
    expect(JSON.stringify(packetView.availableActions)).not.toContain("Review the invoice context");
  });

  it("rejects handoff actions to graph agents without named role snapshots", async () => {
    const manifest = buildStaleAgentRoutePolicyManifest();
    const route = await resolveLiveSandboxTurnRoute({
      manifest,
      frontier: ["agent-front"],
      transcript: "Please route me to the old specialist.",
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }

    const resolution = resolveLiveSandboxAgentHandoffAction({
      manifest,
      activeAgentId: route.activeAgentId,
      packet: route.packet,
      at: "2026-05-27T09:00:01.000Z",
      action: {
        type: "handoff_to_agent",
        targetAgentId: "agent-stale",
        reason: "Caller asked for the old specialist.",
        callerNeedSummary: "Caller wants the old specialist.",
      },
    });

    expect(resolution.kind).toBe("rejected");
    expect(resolution.activeAgentId).toBe("agent-front");
    expect(JSON.stringify(resolution)).not.toContain("New Agent");
    expect(resolution.packet.diagnostics.warnings).toContainEqual({
      code: "handoff_action.unsupported_target",
      message: "The requested handoff target does not resolve to an available agent.",
      recoverable: true,
    });
  });

  it("creates transfer context for direct agent-to-agent routes before selecting the target agent", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildDirectAgentTransferManifest(),
      frontier: ["entry"],
      transcript: "I need a billing specialist to review my invoice.",
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-billing");
    expect(route.packet.transfer).toMatchObject({
      transferId: "turn-1:agent-front:agent-billing",
      sourceAgent: {
        id: "agent-front",
        name: "Front desk",
      },
      targetAgent: {
        id: "agent-billing",
        name: "Billing specialist",
      },
      reason: "Direct route from Front desk to Billing specialist.",
      callerNeedSummary: "I need a billing specialist to review my invoice.",
      recentToolResults: [],
    });
    expect(route.packet.graph.activeAgent).toMatchObject({
      id: "agent-billing",
      name: "Billing specialist",
    });
    expect(route.preEvents).toContainEqual({
      type: "agent.handoff.requested",
      payload: expect.objectContaining({
        sourceAgentId: "agent-front",
        targetAgentId: "agent-billing",
        reason: "Direct route from Front desk to Billing specialist.",
      }),
    });
    expect(route.preEvents).toContainEqual({
      type: "agent.handoff.completed",
      payload: expect.objectContaining({
        sourceAgentId: "agent-front",
        targetAgentId: "agent-billing",
        targetAgentName: "Billing specialist",
      }),
    });
    expect(route.preEvents.some((event) => "targetRoleId" in event.payload)).toBe(false);
    expect(route.packet.diagnostics.events.map((event) => event.type)).toEqual([
      "node.visited",
      "node.visited",
      "node.visited",
      "transfer.created",
      "agent.selected",
    ]);
  });

  it("does not select direct transfer targets without concrete agent config", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildDirectAgentTransferMissingConcreteTargetManifest(),
      frontier: ["entry"],
      transcript: "I need a billing specialist to review my invoice.",
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-front");
    expect(route.nextFrontier).toEqual([]);
    expect(route.packet.transfer).toBeUndefined();
    expect(route.packet.graph.activeAgent).toMatchObject({
      id: "agent-front",
      name: "Front desk",
    });
    expect(route.packet.diagnostics.warnings).toContainEqual({
      code: "agent.missing_concrete_config",
      message: "Agent 'agent-billing' is missing concrete runtime configuration, so routing stayed with 'Front desk'.",
      recoverable: true,
    });
    expect(JSON.stringify(route)).not.toContain("New Agent");
  });

  it("stays with the source agent when a direct transfer target does not support the caller language", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildUnsupportedBillingLanguageManifest(buildDirectAgentTransferManifest()),
      frontier: ["entry"],
      transcript: "I need a billing specialist to review my invoice.",
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
        language: "en",
      },
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-front");
    expect(route.nextFrontier).toEqual([]);
    expect(route.packet.transfer).toBeUndefined();
    expect(route.packet.graph.activeAgent).toMatchObject({
      id: "agent-front",
      name: "Front desk",
    });
    expect(route.packet.diagnostics.warnings).toContainEqual({
      code: "transfer_language.unsupported",
      message: "Transfer target 'Billing specialist' does not support caller language 'en'.",
      recoverable: true,
    });
    expect(route.preEvents.map((event) => event.type)).not.toContain("agent.handoff.requested");
    expect(route.preEvents.map((event) => event.type)).not.toContain("agent.handoff.completed");
  });

  it("stays with the source agent when a handoff target does not support the caller language", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildUnsupportedBillingLanguageManifest(buildRoutingManifest()),
      frontier: ["entry"],
      transcript: "I have a billing issue on my last invoice.",
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
        language: "en",
      },
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-front");
    expect(route.nextFrontier).toEqual([]);
    expect(route.packet.transfer).toBeUndefined();
    expect(route.packet.graph.activeAgent).toMatchObject({
      id: "agent-front",
      name: "Front desk",
    });
    expect(route.packet.diagnostics.warnings).toContainEqual({
      code: "transfer_language.unsupported",
      message: "Transfer target 'Billing specialist' does not support caller language 'en'.",
      recoverable: true,
    });
    expect(route.preEvents.map((event) => event.type)).not.toContain("agent.handoff.requested");
    expect(route.preEvents.map((event) => event.type)).not.toContain("agent.handoff.completed");
  });

  it("stops direct transfer loops and emits a recoverable packet warning", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildDirectAgentTransferLoopManifest(),
      frontier: ["entry"],
      transcript: "I need a billing specialist to review my invoice.",
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-billing");
    expect(route.packet.diagnostics.warnings).toContainEqual({
      code: "transfer_loop.detected",
      message: "Direct transfer target 'agent-front' was already visited, so routing stopped on 'Billing specialist'.",
      recoverable: true,
    });
    expect(route.nextFrontier).toEqual([]);
  });

  it("selects an agent with assigned tools without executing them automatically", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildToolbeltManifest(),
      frontier: ["entry"],
      transcript: "Can you help me understand my account?",
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeAgentId).toBe("agent-front");
    expect(route.nextFrontier).toEqual([]);
    expect("toolInvocations" in route).toBe(false);
    expect(route.packet.availableTools).toEqual([
      {
        id: "tool-customer-profile",
        toolId: "hubspot.profile.lookup",
        label: "Customer profile lookup",
        description: "Customer profile lookup",
        whenToUse: "Use when Front desk needs Customer profile lookup",
        inputSchema: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string" },
          },
        },
        requiredInputs: ["email"],
        risk: "medium",
        requiresHumanApproval: false,
        credentialRef: "hubspot-prod",
      },
    ]);
    expect(route.packet.toolCalls).toEqual([]);
  });

  it("projects connector tool schemas into model-facing available tools", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildZendeskToolbeltManifest(),
      frontier: ["entry"],
      transcript: "That email is associated with the ticket. Please check the status.",
      turn: {
        callSessionId: "session-1",
        turnId: "turn-1",
        startedAt: "2026-05-27T09:00:00.000Z",
        source: "typed",
      },
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.packet.availableTools).toEqual([
      expect.objectContaining({
        id: "tool-customer-profile",
        toolId: "zendesk.tickets.search",
        label: "Search tickets",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
          },
        },
        requiredInputs: ["query"],
      }),
    ]);
  });
});

function buildRoutingManifest(): CompiledRuntimeManifest {
  return {
    tenantId: "tenant-1",
    environment: "sandbox",
    manifestId: "manifest-routing",
    publishedVersionId: "version-routing",
    workflowId: "workflow-routing",
    version: 1,
    workspaceId: "workspace-1",
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryAgentId: "agent-front",
    entryNodeId: "entry",
    roles: [
      role("role-front-desk", "receptionist", "Front desk"),
      role("role-billing", "billing", "Billing specialist"),
    ],
    tools: [],
    graph: {
      id: "workflow-routing",
      name: "Routing",
      nodes: [
        node("entry", "entry", "Entry"),
        agentNode("agent-front", "role-front-desk", "receptionist", "Front desk"),
        {
          ...node("condition-intent", "condition", "Intent"),
          config: {
            condition: {
              branches: [
                {
                  id: "branch-billing",
                  label: "Billing",
                  expression: 'intent == "billing"',
                  targetNodeId: "agent-billing",
                },
              ],
              fallbackTargetNodeId: "agent-front",
              fallbackLabel: "Other",
            },
          },
        },
        { ...node("tool-ticket-lookup", "tool", "Ticket lookup"), toolId: "zendesk.search" },
        agentNode("agent-billing", "role-billing", "billing", "Billing specialist"),
      ],
      edges: [
        edge("entry", "agent-front"),
        edge("agent-front", "condition-intent"),
        edge("condition-intent", "agent-billing"),
      ],
    },
    modelRouting: [],
    escalation: {
      enabled: true,
      fallbackMode: "callback",
      triggers: ["user-request"],
      fallbackMessage: "A specialist will call back.",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    toolBindings: [],
    agentToolAssignments: [],
    conditions: [
      {
        nodeId: "condition-intent",
        label: "Intent",
        branches: [
          {
            id: "branch-billing",
            label: "Billing",
            expression: 'intent == "billing"',
            targetNodeId: "agent-billing",
          },
        ],
        fallbackTargetNodeId: "agent-front",
        fallbackLabel: "Other",
      },
    ],
    routePolicies: [],
    exitNodes: [],
    returnRoutes: [],
    escalationNode: null,
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 1000,
      currentSpendUsd: 100,
      projectedCostPerMinuteUsd: 0.3,
      blockOnLimit: true,
    },
    serializedGraph: "{\"nodes\":[],\"edges\":[]}",
    compiledDefinitionHash: "hash-routing",
  };
}

function buildTerminalManifest(): CompiledRuntimeManifest {
  return {
    ...buildRoutingManifest(),
    manifestId: "manifest-terminal",
    entryNodeId: "entry",
    graph: {
      id: "workflow-terminal",
      name: "Terminal",
      nodes: [
        node("entry", "entry", "Entry"),
        {
          ...node("end-resolved", "end", "Resolved"),
          config: {
            end: {
              outcome: "resolved",
              closingMessage: "Thanks for calling. Goodbye.",
            },
          },
        },
      ],
      edges: [edge("entry", "end-resolved")],
    },
    conditions: [],
  };
}

function buildAgentRoutePolicyManifest(): CompiledRuntimeManifest {
  return {
    ...buildRoutingManifest(),
    manifestId: "manifest-agent-route-policy",
    graph: {
      id: "workflow-agent-route-policy",
      name: "Agent route policy",
      nodes: [
        node("entry", "entry", "Entry"),
        agentNode("agent-front", "role-front-desk", "receptionist", "Front desk"),
        agentNode("agent-billing", "role-billing", "billing", "Billing specialist"),
      ],
      edges: [
        edge("entry", "agent-front"),
      ],
    },
    conditions: [],
    routePolicies: [
      {
        sourceAgentId: "agent-front",
        sourceAgentName: "Front desk",
        type: "route_by_intent",
        trigger: "on_caller_turn_end",
        activation: "until_routed",
        classifier: {
          mode: "standard",
          modelAlias: "intent-classifier-fast",
          confidenceThreshold: 0.65,
        },
        inputWindow: {
          latestCallerTurn: true,
          recentTranscriptTurns: 6,
          includeConversationSummary: true,
          includePreviousAgentContext: true,
          includeRecentToolResults: true,
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
            transferInstructions: "Review the invoice context before greeting the caller.",
          },
          {
            id: "branch-stale",
            label: "Stale",
            intentKey: "stale",
            target: {
              type: "agent",
              agentId: "agent-stale",
            },
            transferInstructions: "This should never reach the agent prompt.",
          },
        ],
        fallback: {
          label: "Clarify need",
          target: {
            type: "clarify_source_agent",
          },
        },
      },
    ],
  };
}

function buildStaleAgentRoutePolicyManifest(): CompiledRuntimeManifest {
  const manifest = buildAgentRoutePolicyManifest();

  return {
    ...manifest,
    manifestId: "manifest-stale-agent-route-policy",
    graph: {
      ...manifest.graph,
      nodes: [
        ...manifest.graph.nodes,
        { ...node("agent-stale", "agent", "New Agent"), roleId: "role-stale" },
      ],
    },
  };
}

function buildDirectAgentTransferLoopManifest(): CompiledRuntimeManifest {
  return {
    ...buildDirectAgentTransferManifest(),
    manifestId: "manifest-direct-transfer-loop",
    graph: {
      id: "workflow-direct-transfer-loop",
      name: "Direct transfer loop",
      nodes: [
        node("entry", "entry", "Entry"),
        agentNode("agent-front", "role-front-desk", "receptionist", "Front desk"),
        agentNode("agent-billing", "role-billing", "billing", "Billing specialist"),
      ],
      edges: [
        edge("entry", "agent-front"),
        edge("agent-front", "agent-billing"),
        edge("agent-billing", "agent-front"),
      ],
    },
  };
}

function buildDirectAgentTransferManifest(): CompiledRuntimeManifest {
  return {
    ...buildRoutingManifest(),
    manifestId: "manifest-direct-transfer",
    graph: {
      id: "workflow-direct-transfer",
      name: "Direct transfer",
      nodes: [
        node("entry", "entry", "Entry"),
        agentNode("agent-front", "role-front-desk", "receptionist", "Front desk"),
        agentNode("agent-billing", "role-billing", "billing", "Billing specialist"),
      ],
      edges: [
        edge("entry", "agent-front"),
        edge("agent-front", "agent-billing"),
      ],
    },
    conditions: [],
  };
}

function buildDirectAgentTransferMissingConcreteTargetManifest(): CompiledRuntimeManifest {
  const manifest = buildDirectAgentTransferManifest();

  return {
    ...manifest,
    manifestId: "manifest-direct-transfer-missing-concrete-target",
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) =>
        graphNode.id === "agent-billing"
          ? {
              ...node("agent-billing", "agent", "New Agent"),
              roleId: "role-billing",
            }
          : graphNode),
    },
  };
}

function buildUnsupportedBillingLanguageManifest(
  manifest: CompiledRuntimeManifest,
): CompiledRuntimeManifest {
  return {
    ...manifest,
    roles: manifest.roles.map((manifestRole) => (
      manifestRole.id === "role-billing"
        ? {
            ...manifestRole,
            languagePolicy: {
              ...manifestRole.languagePolicy,
              defaultLanguage: "es",
              supportedLanguages: ["es"],
            },
          }
        : manifestRole
    )),
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) => {
        if (graphNode.id !== "agent-billing") {
          return graphNode;
        }

        const config = typeof graphNode.config === "object" && graphNode.config !== null
          ? graphNode.config
          : {};
        const graphRole = typeof config["role"] === "object" && config["role"] !== null
          ? config["role"] as Record<string, unknown>
          : role("role-billing", "billing", "Billing specialist");

        return {
          ...graphNode,
          config: {
            ...config,
            role: {
              ...graphRole,
              languagePolicy: {
                defaultLanguage: "es",
                supportedLanguages: ["es"],
                allowMidCallSwitching: true,
              },
            },
          },
        };
      }),
    },
  };
}

function buildToolbeltManifest(): CompiledRuntimeManifest {
  return {
    ...buildRoutingManifest(),
    manifestId: "manifest-toolbelt",
    entryNodeId: "entry",
    graph: {
      id: "workflow-toolbelt",
      name: "Toolbelt",
      nodes: [
        node("entry", "entry", "Entry"),
        agentNode("agent-front", "role-front-desk", "receptionist", "Front desk"),
        { ...node("tool-customer-profile", "tool", "Customer profile lookup"), toolId: "hubspot.profile.lookup" },
      ],
      edges: [
        edge("entry", "agent-front"),
        edge("agent-front", "tool-customer-profile"),
      ],
    },
    toolBindings: [
      {
        nodeId: "tool-customer-profile",
        label: "Customer profile lookup",
        toolId: "hubspot.profile.lookup",
        connector: "hubspot",
        toolName: "Customer profile lookup",
        integrationConnectionId: "hubspot-prod",
        integrationLabel: "HubSpot",
        risk: "medium",
        requiresHumanApproval: false,
        tool: {
          id: "hubspot.profile.lookup",
          name: "Customer profile lookup",
          description: "Customer profile lookup",
          connector: "hubspot",
          requiresHumanApproval: false,
          risk: "medium",
        },
      },
    ],
    agentToolAssignments: [
      {
        id: "tool-customer-profile",
        agentId: "agent-front",
        toolId: "hubspot.profile.lookup",
        label: "Customer profile lookup",
        description: "Customer profile lookup",
        whenToUse: "Use when Front desk needs Customer profile lookup",
        inputSchema: {},
        requiredInputs: [],
        risk: "medium",
        requiresHumanApproval: false,
        credentialRef: "hubspot-prod",
      },
    ],
    conditions: [],
  };
}

function buildZendeskToolbeltManifest(): CompiledRuntimeManifest {
  const manifest = buildToolbeltManifest();

  return {
    ...manifest,
    tools: [
      {
        id: "zendesk.tickets.search",
        name: "Search tickets",
        description: "Search Zendesk tickets by query.",
        connector: "zendesk",
        requiresHumanApproval: false,
        risk: "low",
      },
    ],
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((node) =>
        node.id === "tool-customer-profile"
          ? { ...node, label: "Search tickets", toolId: "zendesk.tickets.search" }
          : node),
    },
    toolBindings: manifest.toolBindings.map((binding) => ({
      ...binding,
      label: "Search tickets",
      toolId: "zendesk.tickets.search",
      connector: "zendesk",
      toolName: "Search tickets",
      integrationConnectionId: "zendesk-prod",
      integrationLabel: "Zendesk",
      risk: "low",
      tool: {
        id: "zendesk.tickets.search",
        name: "Search tickets",
        description: "Search Zendesk tickets by query.",
        connector: "zendesk",
        requiresHumanApproval: false,
        risk: "low",
      },
    })),
    agentToolAssignments: manifest.agentToolAssignments.map((assignment) => ({
      ...assignment,
      toolId: "zendesk.tickets.search",
      label: "Search tickets",
      description: "Search Zendesk tickets by query.",
      whenToUse: "Use when Front desk needs to search Zendesk tickets.",
      inputSchema: {},
      requiredInputs: [],
      risk: "low",
      credentialRef: "zendesk-prod",
    })),
  };
}

function node(id: string, kind: CompiledRuntimeManifest["graph"]["nodes"][number]["kind"], label: string) {
  return {
    id,
    kind,
    label,
    position: { x: 0, y: 0 },
    config: {},
  };
}

function agentNode(
  id: string,
  roleId: string,
  kind: "receptionist" | "billing",
  name: string,
) {
  return {
    ...node(id, "agent", name),
    roleId,
    config: {
      role: role(roleId, kind, name),
    },
  };
}

function edge(sourceNodeId: string, targetNodeId: string) {
  return {
    id: `edge-${sourceNodeId}-${targetNodeId}`,
    sourceNodeId,
    targetNodeId,
  };
}

function role(
  id: string,
  kind: "receptionist" | "billing",
  name: string,
): CompiledRuntimeManifest["roles"][number] {
  return {
    id,
    kind,
    name,
    businessName: "Tuzzy Labs",
    instructions: `${name} instructions.`,
    defaultModelTier: "cheap",
    toolIds: [],
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      allowMidCallSwitching: true,
    },
  };
}
