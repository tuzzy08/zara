import type { ToolCallRequest } from "./turn-runtime-packet";

export type AgentAction =
  | {
      type: "respond";
      responseText: string;
    }
  | ToolCallRequest;

export interface RouteToAgentAction {
  type: "route_to_agent";
  branchId: string;
  reason: string;
  callerNeedSummary: string;
}

export type ParsedAgentAction = AgentAction | RouteToAgentAction;

export interface AgentActionParseOptions {
  allowRouteAction?: boolean | undefined;
}

export class AgentActionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentActionParseError";
  }
}

export function parseAgentActionText(text: string): AgentAction;
export function parseAgentActionText(text: string, options: { allowRouteAction: true }): ParsedAgentAction;
export function parseAgentActionText(text: string, options?: AgentActionParseOptions): ParsedAgentAction {
  const parsed = parseJsonObject(text);
  const type = parsed["type"];

  if (type === "respond") {
    const responseText = parsed["responseText"];

    if (typeof responseText !== "string" || responseText.trim().length === 0) {
      throw new AgentActionParseError("Agent respond action is missing responseText.");
    }

    return {
      type: "respond",
      responseText: responseText.trim(),
    };
  }

  if (type === "call_tool") {
    const toolCallId = parsed["toolCallId"];
    const toolAssignmentId = parsed["toolAssignmentId"];
    const args = parsed["arguments"];
    const reason = parsed["reason"];

    if (
      typeof toolCallId !== "string"
      || toolCallId.trim().length === 0
      || typeof toolAssignmentId !== "string"
      || toolAssignmentId.trim().length === 0
      || !isRecord(args)
      || typeof reason !== "string"
      || reason.trim().length === 0
    ) {
      throw new AgentActionParseError("Agent tool action is missing required fields.");
    }

    return {
      type: "call_tool",
      toolCallId: toolCallId.trim(),
      toolAssignmentId: toolAssignmentId.trim(),
      arguments: structuredClone(args) as Record<string, unknown>,
      reason: reason.trim(),
    };
  }

  if (type === "route_to_agent" && options?.allowRouteAction === true) {
    const branchId = parsed["branchId"];
    const reason = parsed["reason"];
    const callerNeedSummary = parsed["callerNeedSummary"];

    if (
      typeof branchId !== "string"
      || branchId.trim().length === 0
      || typeof reason !== "string"
      || reason.trim().length === 0
      || typeof callerNeedSummary !== "string"
      || callerNeedSummary.trim().length === 0
    ) {
      throw new AgentActionParseError("Agent route action is missing required fields.");
    }

    return {
      type: "route_to_agent",
      branchId: branchId.trim(),
      reason: reason.trim(),
      callerNeedSummary: callerNeedSummary.trim(),
    };
  }

  throw new AgentActionParseError("Unsupported agent action type.");
}

function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new AgentActionParseError("Agent action must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new AgentActionParseError("Agent action must be a JSON object.");
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
