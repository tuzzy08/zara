import {
  resolveConditionBranch,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type WorkflowEdge,
} from "@zara/core";

export interface LiveSandboxRouteEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface ResolvedLiveSandboxToolInvocation {
  nodeId: string;
}

export type LiveSandboxTurnRouteResolution =
  | {
      kind: "agent";
      activeRoleId: string;
      nextFrontier: string[];
      preEvents: LiveSandboxRouteEvent[];
      toolInvocations: ResolvedLiveSandboxToolInvocation[];
      context: Omit<ModelRoutingContext, "callPhase">;
    }
  | {
      kind: "terminal";
      nodeId: string;
      responseText: string;
      nextFrontier: string[];
      preEvents: LiveSandboxRouteEvent[];
      toolInvocations: ResolvedLiveSandboxToolInvocation[];
    };

export function resolveLiveSandboxTurnRoute(input: {
  manifest: CompiledRuntimeManifest;
  frontier: string[];
  transcript: string;
}): LiveSandboxTurnRouteResolution {
  const nodeById = new Map(input.manifest.graph.nodes.map((node) => [node.id, node]));
  const edgesBySource = groupEdgesBySource(input.manifest.graph.edges);
  const visited = new Set<string>();
  const queue = [...input.frontier.filter((nodeId) => nodeId.length > 0)];
  const preEvents: LiveSandboxRouteEvent[] = [];
  const toolInvocations: ResolvedLiveSandboxToolInvocation[] = [];
  const inferredIntent = inferTranscriptIntent(input.manifest, input.transcript);

  if (queue.length === 0) {
    queue.push(input.manifest.entryNodeId);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift();

    if (nodeId === undefined || visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    const node = nodeById.get(nodeId);

    if (node === undefined) {
      continue;
    }

    const outgoingTargets = getOutgoingTargets(node.id, edgesBySource);

    preEvents.push({
      type: "node.transition",
      payload: {
        nodeId: node.id,
        nodeKind: node.kind,
        label: node.label,
      },
    });

    switch (node.kind) {
      case "entry":
        queue.unshift(...outgoingTargets);
        break;
      case "agent": {
        const shouldContinuePastAgent = outgoingTargets.some((targetNodeId) => {
          const targetNode = nodeById.get(targetNodeId);
          return (
            targetNode?.kind === "condition"
            || targetNode?.kind === "handoff"
            || targetNode?.kind === "tool"
          );
        });

        if (shouldContinuePastAgent) {
          queue.unshift(...outgoingTargets);
          break;
        }

        return {
          kind: "agent",
          activeRoleId: node.roleId ?? node.id,
          nextFrontier: [...outgoingTargets],
          preEvents,
          toolInvocations,
          context: {
            ...(inferredIntent !== undefined ? { intent: inferredIntent } : {}),
          },
        };
      }
      case "condition": {
        const selection = resolveConditionBranch(node, {
          ...(inferredIntent !== undefined ? { intent: inferredIntent } : {}),
        });

        preEvents.push({
          type: "node.transition",
          payload: {
            nodeId: node.id,
            branchId: selection.branchId,
            branchLabel: selection.label,
            targetNodeId: selection.targetNodeId,
            isFallback: selection.isFallback,
          },
        });
        queue.unshift(selection.targetNodeId);
        break;
      }
      case "handoff": {
        const handoff = node.config["handoff"] as {
          targetRoleId: string;
          targetRoleName: string;
          handoffReason: string;
        };

        preEvents.push({
          type: "agent.handoff.requested",
          payload: {
            nodeId: node.id,
            targetRoleId: handoff.targetRoleId,
            reason: handoff.handoffReason,
          },
        });
        preEvents.push({
          type: "agent.handoff.completed",
          payload: {
            nodeId: node.id,
            targetRoleId: handoff.targetRoleId,
            targetRoleName: handoff.targetRoleName,
          },
        });
        queue.unshift(...outgoingTargets);
        break;
      }
      case "tool":
        toolInvocations.push({
          nodeId: node.id,
        });
        queue.unshift(...outgoingTargets);
        break;
      case "human-escalation": {
        const escalation = node.config["escalation"] as { fallbackMessage: string };
        return {
          kind: "terminal",
          nodeId: node.id,
          responseText: escalation.fallbackMessage,
          nextFrontier: [],
          preEvents,
          toolInvocations,
        };
      }
      case "end": {
        const end = node.config["end"] as { closingMessage: string };
        return {
          kind: "terminal",
          nodeId: node.id,
          responseText: end.closingMessage,
          nextFrontier: [],
          preEvents,
          toolInvocations,
        };
      }
    }
  }

  return {
    kind: "agent",
    activeRoleId: input.manifest.entryRoleId,
    nextFrontier: [],
    preEvents,
    toolInvocations,
    context: {
      ...(inferredIntent !== undefined ? { intent: inferredIntent } : {}),
    },
  };
}

function groupEdgesBySource(edges: WorkflowEdge[]) {
  const grouped = new Map<string, WorkflowEdge[]>();

  for (const edge of edges) {
    const current = grouped.get(edge.sourceNodeId) ?? [];
    current.push(edge);
    grouped.set(edge.sourceNodeId, current);
  }

  return grouped;
}

function getOutgoingTargets(nodeId: string, edgesBySource: Map<string, WorkflowEdge[]>) {
  return (edgesBySource.get(nodeId) ?? []).map((edge) => edge.targetNodeId);
}

function inferTranscriptIntent(manifest: CompiledRuntimeManifest, transcript: string) {
  const normalizedTranscript = transcript.toLowerCase();
  const candidates = new Set<string>();

  manifest.conditions.forEach((condition) => {
    condition.branches.forEach((branch) => {
      const match = branch.expression.match(/intent\s*==\s*"([^"]+)"/i);

      if (match?.[1] !== undefined) {
        candidates.add(match[1].toLowerCase());
      }
    });
  });

  for (const candidate of candidates) {
    if (normalizedTranscript.includes(candidate)) {
      return candidate;
    }
  }

  return undefined;
}
