import { describe, expect, it } from "vitest";

import {
  createAgentRouteMenu,
  createAgentTurnContext,
  createTurnRuntimePacket,
  recordRuntimePacketToolRequest,
  recordRuntimePacketToolResult,
  recordRuntimePacketToolStarted,
  recordRuntimePacketWarning,
  recordRuntimePacketNodeVisit,
} from "./index";

describe("turn runtime packet", () => {
  it("creates a turn-scoped packet with manifest and graph identity", () => {
    const packet = createTurnRuntimePacket({
      ids: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        callSessionId: "session-1",
        turnId: "turn-1",
        manifestId: "manifest-1",
        manifestVersion: 3,
      },
      timing: {
        startedAt: "2026-05-27T09:00:00.000Z",
      },
      callerInput: {
        latestCallerTurn: "I need help with my invoice.",
        source: "typed",
        recentTranscript: [],
      },
      graph: {
        entryNodeId: "entry",
        frontierNodeIds: ["entry"],
      },
    });

    expect(packet).toMatchObject({
      schemaVersion: "turn-runtime-packet.v1",
      ids: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        callSessionId: "session-1",
        turnId: "turn-1",
        manifestId: "manifest-1",
        manifestVersion: 3,
      },
      timing: {
        startedAt: "2026-05-27T09:00:00.000Z",
        sequence: 0,
      },
      callerInput: {
        latestCallerTurn: "I need help with my invoice.",
        source: "typed",
        recentTranscript: [],
      },
      graph: {
        entryNodeId: "entry",
        visitedNodeIds: [],
        frontierNodeIds: ["entry"],
      },
      availableTools: [],
      toolCalls: [],
      safety: {
        untrustedSources: ["caller_transcript"],
        redactionApplied: true,
      },
      diagnostics: {
        warnings: [],
        events: [],
      },
    });
  });

  it("records node visits with turn ID and monotonic packet sequence", () => {
    const packet = createTurnRuntimePacket({
      ids: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        callSessionId: "session-1",
        turnId: "turn-1",
        manifestId: "manifest-1",
        manifestVersion: 3,
      },
      timing: {
        startedAt: "2026-05-27T09:00:00.000Z",
      },
      callerInput: {
        latestCallerTurn: "I need help with my invoice.",
        source: "typed",
      },
      graph: {
        entryNodeId: "entry",
        frontierNodeIds: ["entry"],
      },
    });

    const visitedEntry = recordRuntimePacketNodeVisit(packet, {
      at: "2026-05-27T09:00:01.000Z",
      nodeId: "entry",
      nodeKind: "entry",
      label: "Entry",
    });
    const visitedAgent = recordRuntimePacketNodeVisit(visitedEntry, {
      at: "2026-05-27T09:00:02.000Z",
      nodeId: "agent-front",
      nodeKind: "agent",
      label: "Front desk",
    });

    expect(visitedAgent.graph).toMatchObject({
      currentNodeId: "agent-front",
      visitedNodeIds: ["entry", "agent-front"],
    });
    expect(visitedAgent.timing.sequence).toBe(2);
    expect(visitedAgent.diagnostics.events).toEqual([
      {
        type: "node.visited",
        at: "2026-05-27T09:00:01.000Z",
        turnId: "turn-1",
        sequence: 1,
        nodeId: "entry",
        payload: {
          nodeKind: "entry",
          label: "Entry",
        },
      },
      {
        type: "node.visited",
        at: "2026-05-27T09:00:02.000Z",
        turnId: "turn-1",
        sequence: 2,
        nodeId: "agent-front",
        payload: {
          nodeKind: "agent",
          label: "Front desk",
        },
      },
    ]);
    expect(packet.diagnostics.events).toEqual([]);
  });

  it("projects only safe agent-facing context", () => {
    const packet = createTurnRuntimePacket({
      ids: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        callSessionId: "session-1",
        turnId: "turn-1",
        manifestId: "manifest-1",
        manifestVersion: 3,
      },
      timing: {
        startedAt: "2026-05-27T09:00:00.000Z",
      },
      callerInput: {
        latestCallerTurn: "Can you check order 123?",
        source: "typed",
        language: "en",
        recentTranscript: [
          {
            speaker: "caller",
            text: "My email is alex@example.com.",
          },
        ],
      },
      graph: {
        entryNodeId: "entry",
        frontierNodeIds: ["agent-front"],
      },
      availableTools: [
        {
          id: "assignment-order-lookup",
          toolId: "order.lookup",
          label: "Order lookup",
          description: "Find an order by ID.",
          whenToUse: "Use when the caller asks about an order.",
          inputSchema: { type: "object" },
          requiredInputs: ["orderId"],
          risk: "low",
          requiresHumanApproval: false,
          credentialRef: "secret://orders/token",
        },
      ],
      toolCalls: [
        {
          request: {
            type: "call_tool",
            toolCallId: "tool-call-1",
            toolAssignmentId: "assignment-order-lookup",
            arguments: { orderId: "123" },
            reason: "Caller asked for an order update.",
          },
          result: {
            toolCallId: "tool-call-1",
            toolAssignmentId: "assignment-order-lookup",
            toolId: "order.lookup",
            toolName: "Order lookup",
            status: "completed",
            summary: "Order 123 ships tomorrow.",
            output: {
              internalToken: "do-not-send",
              customerEmail: "alex@example.com",
            },
            safeOutput: {
              status: "shipping_tomorrow",
            },
            durationMs: 42,
            idempotencyKey: "session-1:turn-1:assignment-order-lookup",
          },
        },
      ],
    });

    const context = createAgentTurnContext(packet);

    expect(context).toEqual({
      latestCallerTurn: "Can you check order 123?",
      recentTranscript: [
        {
          speaker: "caller",
          text: "My email is alex@example.com.",
        },
      ],
      language: "en",
      availableTools: [
        {
          toolAssignmentId: "assignment-order-lookup",
          label: "Order lookup",
          description: "Find an order by ID.",
          whenToUse: "Use when the caller asks about an order.",
          inputSchema: { type: "object" },
          requiredInputs: ["orderId"],
          risk: "low",
          requiresHumanApproval: false,
        },
      ],
      toolResults: [
        {
          toolName: "Order lookup",
          status: "completed",
          summary: "Order 123 ships tomorrow.",
          safeOutput: {
            status: "shipping_tomorrow",
          },
        },
      ],
    });
    expect(JSON.stringify(context)).not.toContain("secret://orders/token");
    expect(JSON.stringify(context)).not.toContain("do-not-send");
  });

  it("projects a safe route menu without graph target IDs while preserving normal tools", () => {
    const routeMenu = createAgentRouteMenu({
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
        includeRecentToolResults: false,
      },
      readiness: {
        mode: "agent_requested",
      },
      announcement: {
        mode: "template",
        text: "I will connect you to {targetAgentName}.",
      },
      branches: [
        {
          id: "billing",
          label: "Billing",
          intentKey: "billing",
          description: "Caller needs invoice, payment, refund, or subscription help.",
          examples: ["I need to check an invoice."],
          target: {
            type: "agent",
            agentId: "agent-billing",
          },
          transferInstructions: "Do not expose this internal instruction to the caller.",
        },
      ],
      fallback: {
        label: "Ask a clarifying question",
        target: {
          type: "clarify_source_agent",
        },
      },
    });
    const packet = createTurnRuntimePacket({
      ids: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        callSessionId: "session-1",
        turnId: "turn-1",
        manifestId: "manifest-1",
        manifestVersion: 3,
      },
      timing: {
        startedAt: "2026-05-27T09:00:00.000Z",
      },
      callerInput: {
        latestCallerTurn: "I need help with my invoice.",
        source: "typed",
      },
      graph: {
        entryNodeId: "entry",
        frontierNodeIds: ["agent-front"],
      },
      availableTools: [
        {
          id: "assignment-zendesk-search",
          toolId: "zendesk.search_tickets",
          label: "Search tickets",
          description: "Find matching support tickets.",
          whenToUse: "Use when the caller asks about an existing ticket.",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
          requiredInputs: ["query"],
          risk: "low",
          requiresHumanApproval: false,
          credentialRef: "secret://zendesk/token",
        },
      ],
      routeMenu,
    });

    const context = createAgentTurnContext(packet);

    expect(context.routeMenu).toEqual({
      branches: [
        {
          branchId: "billing",
          label: "Billing",
          description: "Caller needs invoice, payment, refund, or subscription help.",
          examples: ["I need to check an invoice."],
        },
      ],
      fallback: {
        label: "Ask a clarifying question",
        behavior: "clarify_source_agent",
      },
    });
    expect(context.availableTools).toEqual([
      {
        toolAssignmentId: "assignment-zendesk-search",
        label: "Search tickets",
        description: "Find matching support tickets.",
        whenToUse: "Use when the caller asks about an existing ticket.",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        requiredInputs: ["query"],
        risk: "low",
        requiresHumanApproval: false,
      },
    ]);
    expect(JSON.stringify(context)).not.toContain("agent-billing");
    expect(JSON.stringify(context)).not.toContain("secret://zendesk/token");
    expect(JSON.stringify(context)).not.toContain("Do not expose this internal instruction");
  });

  it("records structured tool execution results and projects only safe output", () => {
    let packet = createTurnRuntimePacket({
      ids: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        callSessionId: "session-1",
        turnId: "turn-1",
        manifestId: "manifest-1",
        manifestVersion: 3,
      },
      timing: {
        startedAt: "2026-05-27T09:00:00.000Z",
      },
      callerInput: {
        latestCallerTurn: "Can you check order 123?",
        source: "typed",
      },
      graph: {
        entryNodeId: "entry",
        frontierNodeIds: ["agent-front"],
      },
      availableTools: [
        {
          id: "assignment-order-lookup",
          toolId: "order.lookup",
          label: "Order lookup",
          description: "Find an order by ID.",
          whenToUse: "Use when the caller asks about an order.",
          inputSchema: { type: "object" },
          requiredInputs: ["orderId"],
          risk: "low",
          requiresHumanApproval: false,
        },
      ],
    });

    packet = recordRuntimePacketToolRequest(packet, {
      at: "2026-05-27T09:00:01.000Z",
      nodeId: "agent-front",
      request: {
        type: "call_tool",
        toolCallId: "tool-call-1",
        toolAssignmentId: "assignment-order-lookup",
        arguments: { orderId: "123" },
        reason: "Caller asked for an order update.",
      },
    });
    packet = recordRuntimePacketToolStarted(packet, {
      at: "2026-05-27T09:00:02.000Z",
      nodeId: "agent-front",
      toolCallId: "tool-call-1",
      toolAssignmentId: "assignment-order-lookup",
      toolId: "order.lookup",
      toolName: "Order lookup",
    });
    packet = recordRuntimePacketToolResult(packet, {
      at: "2026-05-27T09:00:03.000Z",
      nodeId: "agent-front",
      result: {
        toolCallId: "tool-call-1",
        toolAssignmentId: "assignment-order-lookup",
        toolId: "order.lookup",
        toolName: "Order lookup",
        status: "completed",
        summary: "Order 123 ships tomorrow.",
        output: {
          internalToken: "do-not-send",
          customerEmail: "alex@example.com",
        },
        safeOutput: {
          status: "shipping_tomorrow",
        },
        durationMs: 42,
        idempotencyKey: "session-1:turn-1:assignment-order-lookup:tool-call-1",
      },
    });

    expect(packet.toolCalls).toEqual([
      {
        request: {
          type: "call_tool",
          toolCallId: "tool-call-1",
          toolAssignmentId: "assignment-order-lookup",
          arguments: { orderId: "123" },
          reason: "Caller asked for an order update.",
        },
        result: {
          toolCallId: "tool-call-1",
          toolAssignmentId: "assignment-order-lookup",
          toolId: "order.lookup",
          toolName: "Order lookup",
          status: "completed",
          summary: "Order 123 ships tomorrow.",
          output: {
            internalToken: "do-not-send",
            customerEmail: "alex@example.com",
          },
          safeOutput: {
            status: "shipping_tomorrow",
          },
          durationMs: 42,
          idempotencyKey: "session-1:turn-1:assignment-order-lookup:tool-call-1",
        },
      },
    ]);
    expect(packet.diagnostics.events.map((event) => ({
      type: event.type,
      sequence: event.sequence,
      nodeId: event.nodeId,
    }))).toEqual([
      { type: "tool.requested", sequence: 1, nodeId: "agent-front" },
      { type: "tool.started", sequence: 2, nodeId: "agent-front" },
      { type: "tool.completed", sequence: 3, nodeId: "agent-front" },
    ]);

    const context = createAgentTurnContext(packet);

    expect(context.toolResults).toEqual([
      {
        toolName: "Order lookup",
        status: "completed",
        summary: "Order 123 ships tomorrow.",
        safeOutput: {
          status: "shipping_tomorrow",
        },
      },
    ]);
    expect(JSON.stringify(context)).not.toContain("do-not-send");
    expect(JSON.stringify(context)).not.toContain("alex@example.com");
  });

  it("bounds the agent-facing projection to the packet context byte limit", () => {
    const packet = createTurnRuntimePacket({
      ids: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        callSessionId: "session-1",
        turnId: "turn-1",
        manifestId: "manifest-1",
        manifestVersion: 3,
      },
      timing: {
        startedAt: "2026-05-27T09:00:00.000Z",
      },
      callerInput: {
        latestCallerTurn: "short current turn",
        source: "typed",
        recentTranscript: [
          { speaker: "caller", text: "older ".repeat(80) },
          { speaker: "agent", text: "middle ".repeat(80) },
          { speaker: "caller", text: "newer ".repeat(80) },
        ],
      },
      graph: {
        entryNodeId: "entry",
        frontierNodeIds: ["agent-front"],
      },
      safety: {
        maxModelContextBytes: 220,
      },
    });

    const context = createAgentTurnContext(packet);

    expect(byteLength(JSON.stringify(context))).toBeLessThanOrEqual(220);
    expect(context.latestCallerTurn).toBe("short current turn");
    expect(context.recentTranscript.length).toBeLessThan(3);
  });

  it("records packet warnings as diagnostics and packet events", () => {
    const packet = createTurnRuntimePacket({
      ids: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        callSessionId: "session-1",
        turnId: "turn-1",
        manifestId: "manifest-1",
        manifestVersion: 3,
      },
      timing: {
        startedAt: "2026-05-27T09:00:00.000Z",
      },
      callerInput: {
        latestCallerTurn: "I am not sure what I need.",
        source: "typed",
      },
      graph: {
        entryNodeId: "entry",
        frontierNodeIds: ["condition-intent"],
      },
    });

    const warned = recordRuntimePacketWarning(packet, {
      at: "2026-05-27T09:00:03.000Z",
      nodeId: "condition-intent",
      warning: {
        code: "intent.low_confidence",
        message: "Intent confidence was below the routing threshold.",
        recoverable: true,
      },
    });

    expect(warned.diagnostics.warnings).toEqual([
      {
        code: "intent.low_confidence",
        message: "Intent confidence was below the routing threshold.",
        recoverable: true,
      },
    ]);
    expect(warned.diagnostics.events).toEqual([
      {
        type: "runtime.warning",
        at: "2026-05-27T09:00:03.000Z",
        turnId: "turn-1",
        sequence: 1,
        nodeId: "condition-intent",
        payload: {
          code: "intent.low_confidence",
          message: "Intent confidence was below the routing threshold.",
          recoverable: true,
        },
      },
    ]);
    expect(packet.diagnostics.warnings).toEqual([]);
  });
});

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
