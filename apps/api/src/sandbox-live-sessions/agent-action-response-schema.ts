import type { AgentTurnContext } from "@zara/core";

const respondSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["respond"] },
    responseText: { type: "string" },
  },
  required: ["type", "responseText"],
  additionalProperties: false,
} as const;

export function buildAgentActionResponseSchema(context?: AgentTurnContext) {
  const actionSchemas: Record<string, unknown>[] = [respondSchema];

  for (const action of context?.availableActions ?? []) {
    if (action.kind === "agent_tool") {
      for (const requiredAlternative of action.requiredAlternatives ?? [[]]) {
        actionSchemas.push(buildToolActionSchema(action, new Set(requiredAlternative)));
      }
      continue;
    }

    actionSchemas.push({
      type: "object",
      properties: {
        type: { type: "string", enum: ["handoff_to_agent"] },
        targetAgentId: { type: "string", enum: action.targets.map((target) => target.targetAgentId) },
        reason: { type: "string" },
        callerNeedSummary: { type: "string" },
      },
      required: ["type", "targetAgentId", "reason", "callerNeedSummary"],
      additionalProperties: false,
    });
  }

  return {
    type: "object",
    properties: { action: actionSchemas.length === 1 ? respondSchema : { anyOf: actionSchemas } },
    required: ["action"],
    additionalProperties: false,
  };
}

export function unwrapAgentActionResponse(text: string, context?: AgentTurnContext) {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || !isRecord(parsed.action)) {
    throw new Error("Model returned an invalid agent action envelope.");
  }
  const action = parsed.action;
  if (action.type !== "call_tool") return JSON.stringify(action);
  const assignment = context?.availableActions.find((candidate) =>
    candidate.kind === "agent_tool" && candidate.toolAssignmentId === action.toolAssignmentId);
  if (assignment?.kind !== "agent_tool" || !isRecord(action.arguments)) return JSON.stringify(action);
  return JSON.stringify({
    ...action,
    arguments: stripOptionalNulls(action.arguments, assignment.inputSchema),
  });
}

function buildToolActionSchema(
  action: Extract<AgentTurnContext["availableActions"][number], { kind: "agent_tool" }>,
  requiredAlternative: Set<string>,
) {
  return {
    type: "object",
    properties: {
      type: { type: "string", enum: ["call_tool"] },
      toolCallId: { type: "string" },
      toolAssignmentId: { type: "string", enum: [action.toolAssignmentId] },
      arguments: normalizeObjectSchema(action.inputSchema, requiredAlternative),
      reason: { type: "string" },
    },
    required: ["type", "toolCallId", "toolAssignmentId", "arguments", "reason"],
    additionalProperties: false,
  };
}

function normalizeObjectSchema(schema: Record<string, unknown>, forcedRequired = new Set<string>()) {
  const rawProperties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const properties = Object.fromEntries(Object.entries(rawProperties).map(([key, value]) => {
    const normalized = isRecord(value) ? normalizeSchema(value) : {};
    return [key, required.has(key) || forcedRequired.has(key) ? normalized : makeNullable(normalized)];
  }));
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object" || isRecord(schema.properties)) return normalizeObjectSchema(schema);
  if (schema.type === "array" && isRecord(schema.items)) {
    return { ...schema, items: normalizeSchema(schema.items) };
  }
  return { ...schema };
}

function makeNullable(schema: Record<string, unknown>) {
  if (acceptsNull(schema)) return schema;
  return { anyOf: [schema, { type: "null" }] };
}

function stripOptionalNulls(value: unknown, schema: Record<string, unknown>): unknown {
  if (Array.isArray(value)) {
    const itemSchema = schema.items;
    return isRecord(itemSchema) ? value.map((item) => stripOptionalNulls(item, itemSchema)) : value;
  }
  if (!isRecord(value)) return value;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const propertySchema = isRecord(properties[key]) ? properties[key] : {};
    if (entry === null && !required.has(key) && !acceptsNull(propertySchema)) return [];
    return [[key, stripOptionalNulls(entry, propertySchema)]];
  }));
}

function acceptsNull(schema: Record<string, unknown>) {
  return (Array.isArray(schema.type) && schema.type.includes("null"))
    || (Array.isArray(schema.anyOf) && schema.anyOf.some((entry) => isRecord(entry) && entry.type === "null"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
