import { describe, expect, it } from "vitest";
import type { CompiledRuntimeManifest, IntentClassifierOutput } from "@zara/core";

import { resolveLiveSandboxTurnRoute } from "./sandbox-live-session-router";

describe("resolveLiveSandboxTurnRoute", () => {
  it("walks condition, tool, and handoff nodes before selecting the responding role", async () => {
    const route = await resolveLiveSandboxTurnRoute({
      manifest: buildRoutingManifest(),
      frontier: ["entry"],
      transcript: "I have a billing issue on my last invoice.",
    });

    expect(route.kind).toBe("agent");
    if (route.kind !== "agent") {
      throw new Error("Expected agent route.");
    }
    expect(route.activeRoleId).toBe("role-billing");
    expect(route.nextFrontier).toEqual([]);
    expect(route.context).toEqual({ intent: "billing" });
    expect(route.toolInvocations).toEqual([{ nodeId: "tool-ticket-lookup" }]);
    expect(route.preEvents.map((event) => event.type)).toEqual([
      "node.transition",
      "node.transition",
      "node.transition",
      "node.transition",
      "node.transition",
      "node.transition",
      "agent.handoff.requested",
      "agent.handoff.completed",
      "node.transition",
    ]);
    expect(route.preEvents).toContainEqual({
      type: "node.transition",
      payload: {
        nodeId: "condition-intent",
        branchId: "branch-billing",
        branchLabel: "Billing",
        targetNodeId: "tool-ticket-lookup",
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
    expect(route.activeRoleId).toBe("role-billing");
    expect(route.context).toEqual({ intent: "billing" });
    expect(route.preEvents).toContainEqual({
      type: "node.transition",
      payload: {
        nodeId: "condition-intent",
        branchId: "branch-billing",
        branchLabel: "Billing",
        targetNodeId: "tool-ticket-lookup",
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
      toolInvocations: [],
    });
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
      "tool-ticket-lookup",
      "handoff-billing",
      "agent-billing",
    ]);
    expect(route.packet.graph.activeAgent).toMatchObject({
      id: "role-billing",
      name: "Billing specialist",
      kind: "billing",
    });
    expect(route.packet.toolCalls.map((toolCall) => toolCall.request)).toEqual([
      {
        type: "call_tool",
        toolCallId: "turn-1:tool-ticket-lookup",
        toolAssignmentId: "tool-ticket-lookup",
        arguments: {},
        reason: "Workflow routed through tool node 'Ticket lookup'.",
      },
    ]);
    expect(route.packet.transfer).toMatchObject({
      transferId: "turn-1:handoff-billing",
      sourceAgent: {
        id: "role-front-desk",
        name: "Front desk",
      },
      targetAgent: {
        id: "role-billing",
        name: "Billing specialist",
      },
      reason: "Caller has a billing issue.",
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
      { type: "node.visited", turnId: "turn-1", sequence: 5, nodeId: "tool-ticket-lookup" },
      { type: "tool.requested", turnId: "turn-1", sequence: 6, nodeId: "tool-ticket-lookup" },
      { type: "node.visited", turnId: "turn-1", sequence: 7, nodeId: "handoff-billing" },
      { type: "transfer.created", turnId: "turn-1", sequence: 8, nodeId: "handoff-billing" },
      { type: "node.visited", turnId: "turn-1", sequence: 9, nodeId: "agent-billing" },
      { type: "agent.selected", turnId: "turn-1", sequence: 10, nodeId: "agent-billing" },
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
    expect(route.activeRoleId).toBe("role-billing");
    expect(route.context).toEqual({ intent: "billing" });
    expect(route.packet.intent).toEqual({
      nodeId: "condition-intent",
      matchedBranchId: "branch-billing",
      intentKey: "billing",
      label: "Billing",
      confidence: 0.91,
      reason: "The caller is asking about a charge.",
      usedFallback: false,
      targetNodeId: "tool-ticket-lookup",
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
    expect(route.activeRoleId).toBe("role-front-desk");
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
});

function buildRoutingManifest(): CompiledRuntimeManifest {
  return {
    tenantId: "tenant-1",
    environment: "sandbox",
    manifestId: "manifest-routing",
    publishedVersionId: "version-routing",
    version: 1,
    workspaceId: "workspace-1",
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryRoleId: "role-front-desk",
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
        { ...node("agent-front", "agent", "Front desk"), roleId: "role-front-desk" },
        {
          ...node("condition-intent", "condition", "Intent"),
          config: {
            condition: {
              branches: [
                {
                  id: "branch-billing",
                  label: "Billing",
                  expression: 'intent == "billing"',
                  targetNodeId: "tool-ticket-lookup",
                },
              ],
              fallbackTargetNodeId: "agent-front",
              fallbackLabel: "Other",
            },
          },
        },
        { ...node("tool-ticket-lookup", "tool", "Ticket lookup"), toolId: "zendesk.search" },
        {
          ...node("handoff-billing", "handoff", "Billing handoff"),
          config: {
            handoff: {
              targetRoleId: "role-billing",
              targetRoleName: "Billing specialist",
              handoffReason: "Caller has a billing issue.",
            },
          },
        },
        { ...node("agent-billing", "agent", "Billing specialist"), roleId: "role-billing" },
      ],
      edges: [
        edge("entry", "agent-front"),
        edge("agent-front", "condition-intent"),
        edge("condition-intent", "tool-ticket-lookup"),
        edge("tool-ticket-lookup", "handoff-billing"),
        edge("handoff-billing", "agent-billing"),
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
    handoffs: [],
    conditions: [
      {
        nodeId: "condition-intent",
        label: "Intent",
        branches: [
          {
            id: "branch-billing",
            label: "Billing",
            expression: 'intent == "billing"',
            targetNodeId: "tool-ticket-lookup",
          },
        ],
        fallbackTargetNodeId: "agent-front",
        fallbackLabel: "Other",
      },
    ],
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

function node(id: string, kind: CompiledRuntimeManifest["graph"]["nodes"][number]["kind"], label: string) {
  return {
    id,
    kind,
    label,
    position: { x: 0, y: 0 },
    config: {},
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
