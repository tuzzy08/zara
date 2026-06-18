import { parseAgentActionText, type RouteToAgentAction } from "./agent-action";
import type { CompiledRuntimeManifest } from "./runtime";
import {
  createAgentRouteMenu,
  type AgentRouteMenu,
} from "./turn-runtime-packet";
import { resolveAgentRouteRoleProfile } from "./workflow";

export interface RealtimeToolDeclaration {
  kind?: "agent_tool" | undefined;
  name: string;
  toolAssignmentId: string;
  toolId: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RealtimeInternalRouteToolDeclaration {
  kind: "internal_route";
  name: "zara_route_to_agent";
  toolId: "zara.internal.route_to_agent";
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
  routeMenu: AgentRouteMenu;
}

export type RealtimeProviderToolDeclaration = RealtimeToolDeclaration | RealtimeInternalRouteToolDeclaration;

export interface ResolvedRealtimeToolCall {
  providerCallId: string;
  toolAssignmentId: string;
  toolId: string;
  arguments: Record<string, unknown>;
}

export interface ResolvedRealtimeRouteToolCall {
  providerCallId: string;
  action: RouteToAgentAction;
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

export function buildRealtimeProviderToolDeclarations(input: {
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph" | "routePolicies" | "roles">;
  activeRoleId: string;
  activeAgentNodeId?: string | undefined;
}): RealtimeProviderToolDeclaration[] {
  const declarations: RealtimeProviderToolDeclaration[] = [
    ...buildRealtimeToolDeclarations({
      manifest: input.manifest,
      activeRoleId: input.activeRoleId,
    }),
  ];
  const routePolicy = resolveActiveRoutePolicy(input);

  if (routePolicy !== undefined) {
    declarations.push(buildInternalRouteToolDeclaration(routePolicy, input.manifest));
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

export function resolveRealtimeRouteToolCall(input: {
  declarations: RealtimeProviderToolDeclaration[];
  providerCallId: string;
  name: string;
  argumentsJson?: string | undefined;
  arguments?: Record<string, unknown> | undefined;
}): ResolvedRealtimeRouteToolCall {
  const declaration = input.declarations.find(
    (candidate): candidate is RealtimeInternalRouteToolDeclaration =>
      candidate.kind === "internal_route" && candidate.name === input.name,
  );

  if (declaration === undefined) {
    throw new Error(`Unknown realtime route function: ${input.name}`);
  }

  const args = input.arguments ?? parseProviderArguments(input.argumentsJson);
  const action = parseAgentActionText(JSON.stringify({
    ...args,
    type: "route_to_agent",
  }), { allowRouteAction: true });

  if (action.type !== "route_to_agent") {
    throw new Error("Realtime route function did not resolve to a route action.");
  }

  if (!declaration.routeMenu.branches.some((branch) => branch.branchId === action.branchId)) {
    throw new Error(`Unknown route branch: ${action.branchId}`);
  }

  return {
    providerCallId: input.providerCallId,
    action,
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

function resolveActiveRoutePolicy(input: {
  manifest: Pick<CompiledRuntimeManifest, "graph" | "routePolicies">;
  activeRoleId: string;
  activeAgentNodeId?: string | undefined;
}): CompiledRuntimeManifest["routePolicies"][number] | undefined {
  if (input.activeAgentNodeId !== undefined) {
    return input.manifest.routePolicies.find(
      (routePolicy) => routePolicy.sourceAgentId === input.activeAgentNodeId,
    );
  }

  const activeAgentNodeIds = new Set(
    input.manifest.graph.nodes
      .filter((node) => node.kind === "agent" && (node.roleId ?? node.id) === input.activeRoleId)
      .map((node) => node.id),
  );

  return input.manifest.routePolicies.find((routePolicy) => activeAgentNodeIds.has(routePolicy.sourceAgentId));
}

function buildInternalRouteToolDeclaration(
  routePolicy: CompiledRuntimeManifest["routePolicies"][number],
  manifest: Pick<CompiledRuntimeManifest, "graph" | "roles">,
): RealtimeInternalRouteToolDeclaration {
  const routeMenu = createAgentRouteMenu(routePolicy);

  return {
    kind: "internal_route",
    name: "zara_route_to_agent",
    toolId: "zara.internal.route_to_agent",
    label: "Route caller",
    description: renderRouteToolDescription(routeMenu, routePolicy, manifest),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["branchId", "reason", "callerNeedSummary"],
      properties: {
        branchId: {
          type: "string",
          enum: routeMenu.branches.map((branch) => branch.branchId),
        },
        reason: {
          type: "string",
        },
        callerNeedSummary: {
          type: "string",
        },
      },
    },
    routeMenu,
  };
}

function renderRouteToolDescription(
  routeMenu: AgentRouteMenu,
  routePolicy: CompiledRuntimeManifest["routePolicies"][number],
  manifest: Pick<CompiledRuntimeManifest, "graph" | "roles">,
): string {
  return [
    "Route the caller only when their need clearly matches one configured branch.",
    "If the caller need is unclear, do not call this tool; ask a clarifying question.",
    "Configured branches:",
    ...routeMenu.branches.map((branch) => {
      const targetRole = findRouteBranchTargetRole(routePolicy, branch.branchId, manifest);
      const targetRoleDescription = formatRouteBranchTargetRoleDescription(targetRole);
      const examples = branch.examples.length > 0 ? ` Examples: ${branch.examples.join("; ")}` : "";
      return `- ${branch.branchId}: ${branch.label}. ${branch.description}${targetRoleDescription}${examples}`;
    }),
    `Fallback when unclear: ${routeMenu.fallback.label}.`,
  ].join("\n");
}

function findRouteBranchTargetRole(
  routePolicy: CompiledRuntimeManifest["routePolicies"][number],
  branchId: string,
  manifest: Pick<CompiledRuntimeManifest, "graph" | "roles">,
): CompiledRuntimeManifest["roles"][number] | undefined {
  const branch = routePolicy.branches.find((candidate) => candidate.id === branchId);
  if (branch === undefined || branch.target.type !== "agent") {
    return undefined;
  }

  const target = branch.target;
  const targetAgentNode = manifest.graph.nodes.find((node) => node.id === target.agentId);
  const targetRoleId = targetAgentNode?.roleId ?? target.agentId;

  return manifest.roles.find((role) => role.id === targetRoleId);
}

function formatRouteBranchTargetRoleDescription(
  targetRole: CompiledRuntimeManifest["roles"][number] | undefined,
): string {
  if (targetRole === undefined) {
    return "";
  }

  const routingRole = resolveAgentRouteRoleProfile({
    kind: targetRole.kind,
    name: targetRole.name,
  }).label;

  return ` Routing role: ${routingRole}.`;
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
