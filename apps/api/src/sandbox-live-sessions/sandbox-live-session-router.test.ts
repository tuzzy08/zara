import { describe, expect, it } from "vitest";
import type { CompiledRuntimeManifest } from "@zara/core";

import { resolveLiveSandboxTurnRoute } from "./sandbox-live-session-router";

describe("resolveLiveSandboxTurnRoute", () => {
  it("walks condition, tool, and handoff nodes before selecting the responding role", () => {
    const route = resolveLiveSandboxTurnRoute({
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

  it("falls back to the manifest entry and stops on terminal nodes without model routing", () => {
    const route = resolveLiveSandboxTurnRoute({
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
    roles: [],
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
