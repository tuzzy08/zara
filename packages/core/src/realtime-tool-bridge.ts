import { parseAgentActionText, type HandoffToAgentAction } from "./agent-action";
import { buildAgentHandoffTargets, resolveRuntimeAgent } from "./agent-runtime-context";
import type { CompiledRuntimeManifest } from "./runtime";

export interface RealtimeToolDeclaration {
  kind?: "agent_tool" | undefined;
  name: string;
  toolAssignmentId: string;
  toolId: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RealtimeInternalHandoffToolDeclaration {
  kind: "internal_handoff";
  name: "zara_handoff_to_agent";
  toolId: "zara.internal.handoff_to_agent";
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handoffTargetAgentIds: string[];
}

export type RealtimeProviderToolDeclaration = RealtimeToolDeclaration | RealtimeInternalHandoffToolDeclaration;

export interface ResolvedRealtimeToolCall {
  providerCallId: string;
  toolAssignmentId: string;
  toolId: string;
  arguments: Record<string, unknown>;
}

export interface ResolvedRealtimeHandoffToolCall {
  providerCallId: string;
  action: HandoffToAgentAction;
}

export function buildRealtimeToolDeclarations(input: {
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph">;
  activeAgentId: string;
}): RealtimeToolDeclaration[] {
  const assignments = resolveRuntimeAgent(input.manifest, input.activeAgentId)?.toolAssignments ?? [];

  return assignments.map((assignment) => ({
    name: createProviderSafeToolName(assignment.toolId, assignment.id),
    toolAssignmentId: assignment.id,
    toolId: assignment.toolId,
    label: assignment.label,
    description: [
      assignment.label,
      assignment.description,
      assignment.whenToUse ? `When to use: ${assignment.whenToUse}` : "",
      ...renderRequiredAlternativeInstructions(assignment),
      `Risk: ${assignment.risk}.`,
      assignment.requiresHumanApproval ? "Requires human approval before execution." : "May execute without human approval when grants allow it.",
    ]
      .filter(Boolean)
      .join("\n"),
    inputSchema: normalizeToolInputSchema(assignment.inputSchema, assignment.requiredInputs),
  }));
}

export function buildRealtimeProviderToolDeclarations(input: {
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph" | "routePolicies">;
  activeAgentId: string;
}): RealtimeProviderToolDeclaration[] {
  const declarations: RealtimeProviderToolDeclaration[] = [
    ...buildRealtimeToolDeclarations({
      manifest: input.manifest,
      activeAgentId: input.activeAgentId,
    }),
  ];
  const routePolicy = resolveActiveRoutePolicy(input);

  if (routePolicy !== undefined) {
    const handoffDeclaration = buildInternalHandoffToolDeclaration(routePolicy, input.manifest);

    if (handoffDeclaration !== undefined) {
      declarations.push(handoffDeclaration);
    }
  }

  return declarations;
}

export function resolveRealtimeToolCall(input: {
  declarations: RealtimeToolDeclaration[];
  providerCallId: string;
  name: string;
  argumentsJson?: string | undefined;
  arguments?: Record<string, unknown> | undefined;
}): ResolvedRealtimeToolCall {
  const declaration = input.declarations.find((candidate) => candidate.name === input.name);
  if (!declaration) {
    throw new Error(`Unknown realtime tool function: ${input.name}`);
  }

  return {
    providerCallId: input.providerCallId,
    toolAssignmentId: declaration.toolAssignmentId,
    toolId: declaration.toolId,
    arguments: input.arguments ?? parseProviderArguments(input.argumentsJson),
  };
}

export function resolveRealtimeHandoffToolCall(input: {
  declarations: RealtimeProviderToolDeclaration[];
  providerCallId: string;
  name: string;
  argumentsJson?: string | undefined;
  arguments?: Record<string, unknown> | undefined;
}): ResolvedRealtimeHandoffToolCall {
  const declaration = input.declarations.find(
    (candidate): candidate is RealtimeInternalHandoffToolDeclaration =>
      candidate.kind === "internal_handoff" && candidate.name === input.name,
  );

  if (declaration === undefined) {
    throw new Error(`Unknown realtime handoff function: ${input.name}`);
  }

  const args = input.arguments ?? parseProviderArguments(input.argumentsJson);
  const action = parseAgentActionText(JSON.stringify({
    ...args,
    type: "handoff_to_agent",
  }), { allowHandoffAction: true });

  if (action.type !== "handoff_to_agent") {
    throw new Error("Realtime handoff function did not resolve to a handoff action.");
  }

  if (!declaration.handoffTargetAgentIds.includes(action.targetAgentId)) {
    throw new Error(`Unknown handoff target: ${action.targetAgentId}`);
  }

  return {
    providerCallId: input.providerCallId,
    action,
  };
}

export function projectRealtimeProviderToolInputSchema(
  inputSchema: Record<string, unknown>,
): Record<string, unknown> {
  const schema = { ...inputSchema };

  delete schema.anyOf;
  delete schema.oneOf;
  delete schema.allOf;
  delete schema.not;
  delete schema.const;
  delete schema.enum;

  return schema;
}

function normalizeToolInputSchema(
  inputSchema: Record<string, unknown>,
  requiredInputs: string[],
): Record<string, unknown> {
  const schema: Record<string, unknown> =
    inputSchema && inputSchema.type === "object"
      ? projectRealtimeProviderToolInputSchema(inputSchema)
      : { type: "object", properties: {} };

  if (requiredInputs.length > 0 && !Array.isArray(schema.required)) {
    schema.required = [...requiredInputs];
  }

  return schema;
}

function renderRequiredAlternativeInstructions(input: {
  inputSchema: Record<string, unknown>;
  requiredAlternatives?: string[][] | undefined;
}) {
  const alternatives = readRequiredAlternatives(input);

  if (alternatives.length === 0) {
    return [];
  }

  const fields = Array.from(new Set(alternatives.flat()));

  return [
    `Requires one of: ${fields.join(", ")}.`,
    "If none is known, ask the caller for one of those values before using this tool.",
  ];
}

function readRequiredAlternatives(input: {
  inputSchema: Record<string, unknown>;
  requiredAlternatives?: string[][] | undefined;
}): string[][] {
  const anyOf = Array.isArray(input.inputSchema.anyOf) ? input.inputSchema.anyOf : [];

  return [
    ...(input.requiredAlternatives ?? []),
    ...anyOf
      .map((alternative) => {
        if (alternative === null || typeof alternative !== "object" || Array.isArray(alternative)) {
          return [];
        }

        const required = (alternative as { required?: unknown }).required;
        return Array.isArray(required)
          ? required.filter((value): value is string => typeof value === "string" && value.length > 0)
          : [];
      }),
  ].filter((required) => required.length > 0);
}

function resolveActiveRoutePolicy(input: {
  manifest: Pick<CompiledRuntimeManifest, "graph" | "routePolicies">;
  activeAgentId: string;
}): CompiledRuntimeManifest["routePolicies"][number] | undefined {
  const activeAgentNodeIds = new Set(
    input.manifest.graph.nodes
      .filter((node) => node.kind === "agent" && node.id === input.activeAgentId)
      .map((node) => node.id),
  );

  return input.manifest.routePolicies.find((routePolicy) => activeAgentNodeIds.has(routePolicy.sourceAgentId));
}

function buildInternalHandoffToolDeclaration(
  routePolicy: CompiledRuntimeManifest["routePolicies"][number],
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph">,
): RealtimeInternalHandoffToolDeclaration | undefined {
  const handoffTargets = buildAgentHandoffTargets(manifest, routePolicy);
  const handoffTargetAgentIds = handoffTargets.map((target) => target.targetAgentId);

  if (handoffTargetAgentIds.length === 0) {
    return undefined;
  }

  return {
    kind: "internal_handoff",
    name: "zara_handoff_to_agent",
    toolId: "zara.internal.handoff_to_agent",
    label: "Handoff caller",
    description: renderHandoffToolDescription(routePolicy, manifest),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["targetAgentId", "reason", "callerNeedSummary"],
      properties: {
        targetAgentId: {
          type: "string",
          enum: handoffTargetAgentIds,
        },
        reason: {
          type: "string",
        },
        callerNeedSummary: {
          type: "string",
        },
      },
    },
    handoffTargetAgentIds,
  };
}

function renderHandoffToolDescription(
  routePolicy: CompiledRuntimeManifest["routePolicies"][number],
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph">,
): string {
  const handoffTargets = buildAgentHandoffTargets(manifest, routePolicy);

  return [
    "Hand off the caller only when their need clearly matches one configured target agent.",
    "If the caller need is unclear, do not call this tool; ask a clarifying question.",
    "Configured handoff targets:",
    ...handoffTargets.map(
      (target) => `- ${target.targetAgentId}: ${target.targetAgentName} (${target.targetAgentKind}).`,
    ),
  ].join("\n");
}

function createProviderSafeToolName(toolId: string, assignmentId: string): string {
  const slug = toolId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `zara_${slug || "tool"}_${hashStableString(`${assignmentId}:${toolId}`)}`.slice(0, 64);
}

function parseProviderArguments(argumentsJson?: string): Record<string, unknown> {
  if (!argumentsJson?.trim()) {
    return {};
  }

  const parsed = JSON.parse(argumentsJson) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

function hashStableString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
