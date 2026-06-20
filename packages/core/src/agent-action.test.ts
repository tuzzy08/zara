import { describe, expect, it } from "vitest";

import { parseAgentActionText } from "./index";

describe("agent action parsing", () => {
  it("parses a spoken response action", () => {
    expect(parseAgentActionText(`{"type":"respond","responseText":"I can help with that."}`)).toEqual({
      type: "respond",
      responseText: "I can help with that.",
    });
  });

  it("parses a tool-call action with structured arguments", () => {
    expect(parseAgentActionText(JSON.stringify({
      type: "call_tool",
      toolCallId: "tool-call-1",
      toolAssignmentId: "assignment-order-lookup",
      arguments: {
        orderId: "123",
      },
      reason: "Caller asked about order 123.",
    }))).toEqual({
      type: "call_tool",
      toolCallId: "tool-call-1",
      toolAssignmentId: "assignment-order-lookup",
      arguments: {
        orderId: "123",
      },
      reason: "Caller asked about order 123.",
    });
  });

  it("rejects unknown actions and malformed tool calls", () => {
    expect(() => parseAgentActionText(`{"type":"handoff","target":"billing"}`)).toThrow(
      "Unsupported agent action type",
    );
    expect(() => parseAgentActionText(JSON.stringify({
      type: "route_to_agent",
      branchId: "branch-billing",
      reason: "Caller needs billing support.",
      callerNeedSummary: "Caller has an invoice question.",
    }))).toThrow("Unsupported agent action type");
    expect(() => parseAgentActionText(`{"type":"call_tool","toolAssignmentId":"assignment-order-lookup"}`)).toThrow(
      "Agent tool action is missing required fields",
    );
  });

  it("parses handoff-to-agent actions only when handoff actions are enabled", () => {
    expect(parseAgentActionText(JSON.stringify({
      type: "handoff_to_agent",
      targetAgentId: "agent-billing",
      reason: "Caller needs help with a pending invoice.",
      callerNeedSummary: "Caller wants to check the status of a pending invoice.",
      targetNodeId: "node-billing",
    }), { allowHandoffAction: true })).toEqual({
      type: "handoff_to_agent",
      targetAgentId: "agent-billing",
      reason: "Caller needs help with a pending invoice.",
      callerNeedSummary: "Caller wants to check the status of a pending invoice.",
    });

    expect(() => parseAgentActionText(JSON.stringify({
      type: "handoff_to_agent",
      targetAgentId: "agent-billing",
      reason: "Caller needs help with a pending invoice.",
      callerNeedSummary: "Caller wants to check the status of a pending invoice.",
    }))).toThrow("Unsupported agent action type");
  });
});
