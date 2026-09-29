import { describe, expect, it } from "vitest";
import type { AgentTurnContext } from "@zara/core";

import { buildAgentActionResponseSchema, unwrapAgentActionResponse } from "./agent-action-response-schema";
import { assertTextModelRequestBudget, selectBoundedUntrustedContext } from "./sandbox-text-request-budget";

describe("agent action response contract", () => {
  it("uses an object root and keeps optional inputs nullable", () => {
    const schema = buildAgentActionResponseSchema(context()) as StrictActionSchema;
    const toolSchema = schema.properties.action.anyOf[1]!;

    expect(schema).toMatchObject({ type: "object", additionalProperties: false, required: ["action"] });
    expect(toolSchema.properties.arguments.required).toEqual(["orderId", "note", "nullableNote", "metadata"]);
    expect(toolSchema.properties.arguments.properties.note).toEqual({
      anyOf: [{ type: "string", enum: ["brief", "full"] }, { type: "null" }],
    });
  });

  it("removes only absent optional null inputs from the provider wrapper", () => {
    expect(unwrapAgentActionResponse(JSON.stringify({ action: {
      type: "call_tool", toolCallId: "call-1", toolAssignmentId: "order-update",
      arguments: { orderId: null, note: null, nullableNote: null, metadata: { public: "yes", private: null } }, reason: "Update order",
    } }), context())).toBe(JSON.stringify({
      type: "call_tool", toolCallId: "call-1", toolAssignmentId: "order-update",
      arguments: { orderId: null, nullableNote: null, metadata: { public: "yes" } }, reason: "Update order",
    }));
  });

  it("keeps each required input alternative non-null in a strict schema branch", () => {
    const agentContext = context();
    const tool = agentContext.availableActions[0];
    if (tool?.kind === "agent_tool") tool.requiredAlternatives = [["orderId"], ["note"]];
    const alternatives = (buildAgentActionResponseSchema(agentContext) as StrictActionSchema).properties.action.anyOf;

    expect(alternatives[1]!.properties.arguments.properties.orderId).toEqual({ type: ["string", "null"] });
    expect(alternatives[1]!.properties.arguments.properties.note).toHaveProperty("anyOf");
    expect(alternatives[2]!.properties.arguments.properties.note).toEqual({ type: "string", enum: ["brief", "full"] });
  });

  it("counts UTF-8 bytes conservatively and removes only exact duplicated tool content", () => {
    expect(() => assertTextModelRequestBudget({ text: "😀".repeat(9_000) }, 512))
      .toThrow("input context budget");
    expect(selectBoundedUntrustedContext([
      { source: "tool_output", label: "exact", content: "Completed" },
      { source: "tool_output", label: "short", content: "Complete" },
    ], context()).map((item) => item.label)).toEqual(["short"]);
  });
});

function context(): AgentTurnContext {
  return {
    latestCallerTurn: "Update order 123", recentTranscript: [], availableActions: [{
      kind: "agent_tool", actionType: "call_tool", toolAssignmentId: "order-update",
      label: "Update order", description: "Update an order", whenToUse: "When requested",
      inputSchema: { type: "object", properties: {
        orderId: { type: ["string", "null"] },
        note: { type: "string", enum: ["brief", "full"] },
        nullableNote: { type: ["string", "null"] },
        metadata: { type: "object", properties: {
          public: { type: "string" }, private: { type: "string" },
        }, required: ["public"] },
      }, required: ["orderId"] },
      requiredInputs: ["orderId"], risk: "low", requiresHumanApproval: false,
    }], toolResults: [{ toolName: "Update order", status: "completed", summary: "Completed" }],
  };
}

interface StrictActionSchema {
  type: string;
  additionalProperties: boolean;
  required: string[];
  properties: {
    action: {
      anyOf: Array<{
        properties: {
          arguments: {
            required: string[];
            properties: Record<string, unknown>;
          };
        };
      }>;
    };
  };
}
