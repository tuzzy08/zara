import type { CompiledRuntimeManifest } from "./runtime";

export interface RealtimeToolDeclaration {
  name: string;
  toolAssignmentId: string;
  toolId: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ResolvedRealtimeToolCall {
  providerCallId: string;
  toolAssignmentId: string;
  toolId: string;
  arguments: Record<string, unknown>;
}

export function buildRealtimeToolDeclarations(input: {
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments">;
  activeRoleId: string;
}): RealtimeToolDeclaration[] {
  return input.manifest.agentToolAssignments
    .filter((assignment) => assignment.roleId === input.activeRoleId)
    .map((assignment) => ({
      name: createProviderSafeToolName(assignment.toolId, assignment.id),
      toolAssignmentId: assignment.id,
      toolId: assignment.toolId,
      label: assignment.label,
      description: [
        assignment.label,
        assignment.description,
        assignment.whenToUse ? `When to use: ${assignment.whenToUse}` : "",
        `Risk: ${assignment.risk}.`,
        assignment.requiresHumanApproval ? "Requires human approval before execution." : "May execute without human approval when grants allow it.",
      ]
        .filter(Boolean)
        .join("\n"),
      inputSchema: normalizeToolInputSchema(assignment.inputSchema, assignment.requiredInputs),
    }));
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

function normalizeToolInputSchema(
  inputSchema: Record<string, unknown>,
  requiredInputs: string[],
): Record<string, unknown> {
  const schema: Record<string, unknown> =
    inputSchema && inputSchema.type === "object"
      ? { ...inputSchema }
      : { type: "object", properties: {} };

  if (requiredInputs.length > 0 && !Array.isArray(schema.required)) {
    schema.required = [...requiredInputs];
  }

  return schema;
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
