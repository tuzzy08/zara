import {
  agentSupportsLanguage,
  agentToRuntimeAgentRef,
  buildAgentHandoffTargets,
  createTurnRuntimePacket,
  recordRuntimePacketAgentSelected,
  recordRuntimePacketIntent,
  recordRuntimePacketNodeVisit,
  recordRuntimePacketTransfer,
  recordRuntimePacketWarning,
  resolveAgentRoutePolicyClassification,
  resolveIntentRouteClassification,
  resolveConditionBranch,
  resolveRuntimeAgent,
  resolveRuntimeAgents,
  type CompiledRuntimeManifest,
  type ConditionRouteSelection,
  type AgentToolAssignment,
  type AgentRoutePolicyClassificationResolution,
  type Agent,
  type DraftWorkflowAgentRoutePolicy,
  type AgentTransferContext,
  type IntentClassifierOutput,
  type IntentRouteBranchConfig,
  type IntentRouteInputWindowConfig,
  type IntentRouteNodeConfig,
  type HandoffToAgentAction,
  type ModelRoutingContext,
  type RuntimeAgentRef,
  type ToolExecutionResult,
  type TranscriptTurn,
  type TurnRuntimePacket,
  type TurnRuntimePacketInputSource,
  type WorkflowEdge,
} from "@zara/core";

import { getConnectorToolSchemaById } from "../integrations/connector-tools.service";

export interface LiveSandboxRouteEvent {
  type: string;
  payload: Record<string, unknown>;
}

export type LiveSandboxTurnRouteResolution =
  | {
      kind: "agent";
      activeAgentId: string;
      nextFrontier: string[];
      preEvents: LiveSandboxRouteEvent[];
      context: Omit<ModelRoutingContext, "callPhase">;
      packet: TurnRuntimePacket;
    }
  | {
      kind: "terminal";
      nodeId: string;
      responseText: string;
      nextFrontier: string[];
      preEvents: LiveSandboxRouteEvent[];
      packet: TurnRuntimePacket;
    };

export type LiveSandboxAgentHandoffActionResolution =
  | {
      kind: "routed";
      activeAgentId: string;
      nextFrontier: string[];
      routeEvents: LiveSandboxRouteEvent[];
      context: Omit<ModelRoutingContext, "callPhase">;
      packet: TurnRuntimePacket;
      responseText: string;
    }
  | {
      kind: "rejected";
      activeAgentId: string;
      nextFrontier: string[];
      routeEvents: LiveSandboxRouteEvent[];
      packet: TurnRuntimePacket;
      responseText: string;
    };

export interface LiveSandboxTurnRoutePacketInput {
  callSessionId: string;
  turnId?: string | undefined;
  startedAt?: string | undefined;
  source?: TurnRuntimePacketInputSource | undefined;
  sttConfidence?: number | undefined;
  language?: string | undefined;
  recentTranscript?: TranscriptTurn[] | undefined;
}

export interface LiveSandboxIntentClassifierInput {
  nodeId: string;
  modelAlias: "intent-classifier-fast";
  confidenceThreshold: number;
  latestCallerTurn: string;
  recentTranscript: TranscriptTurn[];
  sourceAgent?: RuntimeAgentRef | undefined;
  branches: IntentRouteBranchConfig[];
  fallback: {
    label: string;
  };
  inputWindow: IntentRouteInputWindowConfig;
}

export interface LiveSandboxIntentClassifier {
  classify(input: LiveSandboxIntentClassifierInput): Promise<IntentClassifierOutput>;
}

export async function resolveLiveSandboxTurnRoute(input: {
  manifest: CompiledRuntimeManifest;
  frontier: string[];
  transcript: string;
  intent?: string | undefined;
  turn?: LiveSandboxTurnRoutePacketInput | undefined;
  intentClassifier?: LiveSandboxIntentClassifier | undefined;
}): Promise<LiveSandboxTurnRouteResolution> {
  const nodeById = new Map(input.manifest.graph.nodes.map((node) => [node.id, node]));
  const edgesBySource = groupEdgesBySource(input.manifest.graph.edges);
  const visited = new Set<string>();
  const queue = [...input.frontier.filter((nodeId) => nodeId.length > 0)];
  const preEvents: LiveSandboxRouteEvent[] = [];
  let selectedIntent =
    normalizeIntent(input.intent)
    ?? (input.intentClassifier === undefined ? inferTranscriptIntent(input.manifest, input.transcript) : undefined);
  const packetStartedAt = input.turn?.startedAt ?? new Date().toISOString();
  let packet = createTurnRuntimePacket({
    ids: {
      tenantId: input.manifest.tenantId,
      workspaceId: input.manifest.workspaceId ?? "workspace-unscoped",
      callSessionId: input.turn?.callSessionId ?? input.manifest.manifestId,
      turnId: input.turn?.turnId ?? `${input.manifest.manifestId}:turn`,
      manifestId: input.manifest.manifestId,
      manifestVersion: input.manifest.version,
    },
    timing: {
      startedAt: packetStartedAt,
    },
    callerInput: {
      latestCallerTurn: input.transcript,
      source: input.turn?.source ?? "typed",
      recentTranscript: input.turn?.recentTranscript ?? [],
      ...(input.turn?.sttConfidence !== undefined ? { sttConfidence: input.turn.sttConfidence } : {}),
      ...(input.turn?.language !== undefined ? { language: input.turn.language } : {}),
    },
    graph: {
      entryNodeId: input.manifest.entryNodeId,
      frontierNodeIds: [...queue],
    },
    safety: {
      redactionApplied: input.manifest.telemetry.redactSensitiveData,
    },
  });
  let lastVisitedAgent: RuntimeAgentRef | undefined;

  if (queue.length === 0) {
    queue.push(input.manifest.entryNodeId);
    packet = {
      ...packet,
      graph: {
        ...packet.graph,
        frontierNodeIds: [input.manifest.entryNodeId],
      },
    };
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
    const flowTargets = outgoingTargets.filter((targetNodeId) => nodeById.get(targetNodeId)?.kind !== "tool");

    packet = recordRuntimePacketNodeVisit(packet, {
      at: packetStartedAt,
      nodeId: node.id,
      nodeKind: node.kind,
      label: node.label,
    });
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
        const agentRef = resolveAgentRef(input.manifest, node.id, node.label, node.kind);
        const previousAgent = lastVisitedAgent;
        const repeatedDirectTransferTarget = flowTargets.find((targetNodeId) => {
          const targetNode = nodeById.get(targetNodeId);
          return targetNode?.kind === "agent" && visited.has(targetNodeId);
        });
        const unvisitedFlowTargets = flowTargets.filter((targetNodeId) => !visited.has(targetNodeId));
        const shouldContinuePastAgent = flowTargets.some((targetNodeId) => {
          const targetNode = nodeById.get(targetNodeId);
          return (
            !visited.has(targetNodeId)
            && (
            targetNode?.kind === "condition"
            || targetNode?.kind === "handoff"
            || targetNode?.kind === "agent"
            )
          );
        });

        if (shouldContinuePastAgent) {
          lastVisitedAgent = agentRef;
          queue.unshift(...unvisitedFlowTargets);
          break;
        }

        const activeAgentId = agentRef.id;
        if (repeatedDirectTransferTarget !== undefined) {
          packet = recordRuntimePacketWarning(packet, {
            at: packetStartedAt,
            nodeId: node.id,
            warning: {
              code: "transfer_loop.detected",
              message: `Direct transfer target '${repeatedDirectTransferTarget}' was already visited, so routing stopped on '${agentRef.name}'.`,
              recoverable: true,
            },
          });
        }
        if (
          previousAgent !== undefined
          && previousAgent.id !== activeAgentId
          && packet.transfer === undefined
          && !roleSupportsCallerLanguage(input.manifest, activeAgentId, packet.callerInput.language)
        ) {
          packet = recordRuntimePacketWarning(packet, {
            at: packetStartedAt,
            nodeId: node.id,
            warning: buildUnsupportedTransferLanguageWarning(agentRef, packet.callerInput.language),
          });
          packet = withAgentCapabilities(packet, input.manifest, node.id, previousAgent.id);
          packet = recordRuntimePacketAgentSelected(packet, {
            at: packetStartedAt,
            nodeId: node.id,
            agent: previousAgent,
            nextFrontierNodeIds: [],
          });

          return {
            kind: "agent",
            activeAgentId: previousAgent.id,
            nextFrontier: [],
            preEvents,
            context: {
              ...(selectedIntent !== undefined ? { intent: selectedIntent } : {}),
            },
            packet,
          };
        }
        if (previousAgent !== undefined && previousAgent.id !== activeAgentId && packet.transfer === undefined) {
          const transfer = buildAgentTransferContext({
            packet,
            nodeId: `${previousAgent.id}:${activeAgentId}`,
            sourceAgent: previousAgent,
            targetAgent: agentRef,
            reason: `Direct route from ${previousAgent.name} to ${agentRef.name}.`,
            callerNeedSummary: input.transcript,
          });
          packet = recordRuntimePacketTransfer(packet, {
            at: packetStartedAt,
            nodeId: node.id,
            transfer,
          });
          preEvents.push(...buildTransferRouteEvents(node.id, transfer));
        }

        lastVisitedAgent = agentRef;
        packet = withAgentCapabilities(packet, input.manifest, node.id, activeAgentId);
        packet = recordRuntimePacketAgentSelected(packet, {
          at: packetStartedAt,
          nodeId: node.id,
          agent: agentRef,
          nextFrontierNodeIds: unvisitedFlowTargets,
        });

        return {
          kind: "agent",
          activeAgentId,
          nextFrontier: [...unvisitedFlowTargets],
          preEvents,
          context: {
            ...(selectedIntent !== undefined ? { intent: selectedIntent } : {}),
          },
          packet,
        };
      }
      case "condition": {
        const routeConfig = buildIntentRouteConfig(node);
        const classifierSelection =
          input.intentClassifier !== undefined && normalizeIntent(input.intent) === undefined && routeConfig !== null
            ? await classifyIntentRoute({
                classifier: input.intentClassifier,
                nodeId: node.id,
                routeConfig,
                packet,
                sourceAgent: lastVisitedAgent,
              })
            : null;
        const selection = classifierSelection?.selection ?? resolveLegacyConditionSelection(node, selectedIntent);

        if (classifierSelection !== null) {
          selectedIntent = classifierSelection.intentKey ?? undefined;
          packet = classifierSelection.packet;
        }

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
        if (classifierSelection === null) {
          const matchedBranch = readConditionBranches(node).find((branch) => branch.id === selection.branchId);
          const intentKey = selection.isFallback ? null : extractIntentKey(matchedBranch?.expression) ?? selectedIntent ?? null;
          packet = recordRuntimePacketIntent(packet, {
            at: packetStartedAt,
            nodeId: node.id,
            matchedBranchId: selection.isFallback ? null : selection.branchId,
            intentKey,
            label: selection.isFallback ? null : selection.label,
            confidence: selection.isFallback ? 0 : 1,
            reason: selection.isFallback
              ? `No configured branch matched; using fallback '${selection.label}'.`
              : `Matched configured intent branch '${selection.label}'.`,
            usedFallback: selection.isFallback,
            targetNodeId: selection.targetNodeId,
          });
        }
        queue.unshift(selection.targetNodeId);
        break;
      }
      case "handoff": {
        const handoff = node.config["handoff"] as {
          targetRoleId: string;
          targetRoleName: string;
          handoffReason: string;
        };

        const matchedIntent =
          packet.intent?.intentKey !== null
          && packet.intent?.intentKey !== undefined
          && packet.intent.label !== null
            ? {
                intentKey: packet.intent.intentKey,
                label: packet.intent.label,
                confidence: packet.intent.confidence,
              }
            : undefined;
        const sourceAgent =
          lastVisitedAgent
          ?? resolveAgentRef(input.manifest, input.manifest.entryAgentId, "Entry agent", "agent");
        const targetAgent = resolveAgentRef(input.manifest, handoff.targetRoleId, handoff.targetRoleName, "agent");

        if (!roleSupportsCallerLanguage(input.manifest, handoff.targetRoleId, packet.callerInput.language)) {
          packet = recordRuntimePacketWarning(packet, {
            at: packetStartedAt,
            nodeId: node.id,
            warning: buildUnsupportedTransferLanguageWarning(targetAgent, packet.callerInput.language),
          });
          packet = {
            ...packet,
            availableTools: resolveAvailableAgentTools(input.manifest, sourceAgent.id),
          };
          packet = recordRuntimePacketAgentSelected(packet, {
            at: packetStartedAt,
            nodeId: node.id,
            agent: sourceAgent,
            nextFrontierNodeIds: [],
          });

          return {
            kind: "agent",
            activeAgentId: sourceAgent.id,
            nextFrontier: [],
            preEvents,
            context: {
              ...(selectedIntent !== undefined ? { intent: selectedIntent } : {}),
            },
            packet,
          };
        }

        const transfer = buildAgentTransferContext({
          packet,
          nodeId: node.id,
          sourceAgent,
          targetAgent,
          reason: handoff.handoffReason,
          callerNeedSummary: input.transcript,
          ...(matchedIntent !== undefined ? { matchedIntent } : {}),
        });
        packet = recordRuntimePacketTransfer(packet, {
          at: packetStartedAt,
          nodeId: node.id,
          transfer,
        });
        preEvents.push(...buildTransferRouteEvents(node.id, transfer));
        queue.unshift(...outgoingTargets);
        break;
      }
      case "tool":
        queue.unshift(...flowTargets);
        break;
      case "human-escalation": {
        const escalation = node.config["escalation"] as { fallbackMessage: string };
        return {
          kind: "terminal",
          nodeId: node.id,
          responseText: escalation.fallbackMessage,
          nextFrontier: [],
          preEvents,
          packet,
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
          packet,
        };
      }
    }
  }

  const entryAgent = resolveAgentRef(input.manifest, input.manifest.entryAgentId, "Entry agent", "agent");
  packet = recordRuntimePacketAgentSelected(packet, {
    at: packetStartedAt,
    agent: entryAgent,
    nextFrontierNodeIds: [],
  });

  return {
    kind: "agent",
    activeAgentId: entryAgent.id,
    nextFrontier: [],
    preEvents,
    context: {
      ...(selectedIntent !== undefined ? { intent: selectedIntent } : {}),
    },
    packet,
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

function resolveLegacyConditionSelection(
  node: CompiledRuntimeManifest["graph"]["nodes"][number],
  selectedIntent: string | undefined,
): ConditionRouteSelection {
  return resolveConditionBranch(node, {
    ...(selectedIntent !== undefined ? { intent: selectedIntent } : {}),
  });
}

function resolveAvailableAgentTools(
  manifest: CompiledRuntimeManifest,
  activeAgentId: string,
): AgentToolAssignment[] {
  const assignments = resolveRuntimeAgent(manifest, activeAgentId)?.toolAssignments ?? [];

  return assignments
    .map((assignment) => {
      const connectorInputSchema = getConnectorToolSchemaById(assignment.toolId)?.inputSchema;

      return {
        id: assignment.id,
        toolId: assignment.toolId,
        label: assignment.label,
        description: assignment.description,
        whenToUse: assignment.whenToUse,
        inputSchema: resolveAgentToolInputSchema(assignment, connectorInputSchema),
        requiredInputs: resolveAgentToolRequiredInputs(assignment, connectorInputSchema?.required),
        risk: assignment.risk,
        requiresHumanApproval: assignment.requiresHumanApproval,
        ...(assignment.credentialRef !== undefined ? { credentialRef: assignment.credentialRef } : {}),
      };
    });
}

function withAgentCapabilities(
  packet: TurnRuntimePacket,
  manifest: CompiledRuntimeManifest,
  sourceNodeId: string,
  activeAgentId: string,
): TurnRuntimePacket {
  const routePolicy = findAgentRoutePolicy(manifest, sourceNodeId, activeAgentId);
  const nextPacket = {
    ...packet,
    availableTools: resolveAvailableAgentTools(manifest, activeAgentId),
  };
  const packetWithoutHandoffState = { ...nextPacket };
  delete packetWithoutHandoffState.handoffTargets;

  if (routePolicy !== undefined) {
    return {
      ...packetWithoutHandoffState,
      handoffTargets: buildAgentHandoffTargets(manifest, routePolicy),
    };
  }

  return packetWithoutHandoffState;
}

function resolveAgentToolInputSchema(
  assignment: AgentToolAssignment,
  connectorInputSchema: { required?: string[] } & Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (Object.keys(assignment.inputSchema).length > 0 || connectorInputSchema === undefined) {
    return { ...assignment.inputSchema };
  }

  return structuredClone(connectorInputSchema);
}

function resolveAgentToolRequiredInputs(
  assignment: AgentToolAssignment,
  connectorRequiredInputs: string[] | undefined,
): string[] {
  return Array.from(new Set([...assignment.requiredInputs, ...(connectorRequiredInputs ?? [])]));
}

function buildAgentTransferContext(input: {
  packet: TurnRuntimePacket;
  nodeId: string;
  sourceAgent: RuntimeAgentRef;
  targetAgent: RuntimeAgentRef;
  reason: string;
  callerNeedSummary: string;
  matchedIntent?: AgentTransferContext["matchedIntent"] | undefined;
}): AgentTransferContext {
  return {
    transferId: `${input.packet.ids.turnId}:${input.nodeId}`,
    sourceAgent: input.sourceAgent,
    targetAgent: input.targetAgent,
    reason: input.reason,
    callerNeedSummary: input.callerNeedSummary,
    recentToolResults: collectRecentSafeToolResults(input.packet),
    ...(input.matchedIntent !== undefined ? { matchedIntent: input.matchedIntent } : {}),
  };
}

function buildTransferRouteEvents(
  nodeId: string,
  transfer: AgentTransferContext,
): LiveSandboxRouteEvent[] {
  return [
    {
      type: "agent.handoff.requested",
      payload: {
        nodeId,
        transferId: transfer.transferId,
        sourceAgentId: transfer.sourceAgent.id,
        sourceAgentName: transfer.sourceAgent.name,
        targetAgentId: transfer.targetAgent.id,
        targetAgentName: transfer.targetAgent.name,
        reason: transfer.reason,
      },
    },
    {
      type: "agent.handoff.completed",
      payload: {
        nodeId,
        transferId: transfer.transferId,
        sourceAgentId: transfer.sourceAgent.id,
        sourceAgentName: transfer.sourceAgent.name,
        targetAgentId: transfer.targetAgent.id,
        targetAgentName: transfer.targetAgent.name,
      },
    },
  ];
}

function collectRecentSafeToolResults(packet: TurnRuntimePacket): ToolExecutionResult[] {
  return packet.toolCalls
    .flatMap((toolCall) => {
      if (toolCall.result === undefined) {
        return [];
      }

      const result = toolCall.result;
      return [
        {
          toolCallId: result.toolCallId,
          toolAssignmentId: result.toolAssignmentId,
          toolId: result.toolId,
          toolName: result.toolName,
          status: result.status,
          summary: result.summary,
          ...(result.safeOutput !== undefined ? { safeOutput: { ...result.safeOutput } } : {}),
          durationMs: result.durationMs,
          idempotencyKey: result.idempotencyKey,
          ...(result.error !== undefined ? { error: { ...result.error } } : {}),
        },
      ];
    })
    .slice(-4);
}

export function resolveLiveSandboxAgentHandoffAction(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: string;
  action: HandoffToAgentAction;
  packet: TurnRuntimePacket;
  at: string;
}): LiveSandboxAgentHandoffActionResolution {
  const nodeById = new Map(input.manifest.graph.nodes.map((node) => [node.id, node]));
  const routePolicy = findActiveAgentRoutePolicy(input.manifest, input.packet, input.activeAgentId);

  if (routePolicy === undefined) {
    return rejectAgentHandoffAction({
      ...input,
      code: "handoff_action.policy_missing",
      message: "The agent requested handoff, but the active agent has no handoff policy.",
    });
  }

  const matchedBranch = routePolicy.branches.find(
    (branch) => branch.target.type === "agent" && branch.target.agentId === input.action.targetAgentId,
  );
  if (matchedBranch === undefined) {
    return rejectAgentHandoffAction({
      ...input,
      code: "handoff_action.unknown_target",
      message: `The agent requested unknown handoff target '${input.action.targetAgentId}'.`,
    });
  }

  const sourceAgent = resolveRuntimeAgent(input.manifest, routePolicy.sourceAgentId)
    ?? resolveRuntimeAgent(input.manifest, input.activeAgentId);

  if (sourceAgent === undefined) {
    return rejectAgentHandoffAction({
      ...input,
      code: "handoff_action.source_unavailable",
      message: "The active handoff source does not resolve to an available agent.",
    });
  }

  const classifierOutput: IntentClassifierOutput = {
    matchedBranchId: matchedBranch.id,
    intentKey: matchedBranch.intentKey,
    confidence: 1,
    reason: input.action.reason,
    usedFallback: false,
  };
  const resolution = resolveAgentRoutePolicyClassification({
    routePolicy,
    sourceAgent: agentToRuntimeAgentRef(sourceAgent),
    targetAgents: resolveAgentRoutePolicyTargetAgents(input.manifest),
    transferId: matchedBranch.target.type === "agent"
      ? `${input.packet.ids.turnId}:${routePolicy.sourceAgentId}:${matchedBranch.target.agentId}`
      : undefined,
    callerNeedSummary: input.action.callerNeedSummary,
    recentToolResults: collectRecentSafeToolResults(input.packet),
    output: classifierOutput,
  });
  let packet = recordRuntimePacketIntent(input.packet, {
    at: input.at,
    ...resolution.intent,
  });
  if (resolution.warning !== undefined) {
    packet = recordRuntimePacketWarning(packet, {
      at: input.at,
      nodeId: routePolicy.sourceAgentId,
      warning: resolution.warning,
    });
  }

  const routedAgent = resolveAgentRoutePolicyTargetNode(input.manifest, nodeById, resolution.target);
  if (routedAgent === undefined || resolution.transfer === undefined) {
    return rejectAgentHandoffAction({
      manifest: input.manifest,
      activeAgentId: input.activeAgentId,
      packet,
      at: input.at,
      code: "handoff_action.unsupported_target",
      message: "The requested handoff target does not resolve to an available agent.",
    });
  }

  if (!agentSupportsLanguage(routedAgent.runtimeAgent, packet.callerInput.language)) {
    return rejectAgentHandoffAction({
      manifest: input.manifest,
      activeAgentId: input.activeAgentId,
      packet,
      at: input.at,
      code: "handoff_action.language_unsupported",
      message: buildUnsupportedTransferLanguageWarning(routedAgent.agent, packet.callerInput.language).message,
    });
  }

  const routeEvents = [
    ...(resolution.announcementText !== undefined
      ? [{
          type: "agent.route.announcement",
          payload: {
            nodeId: routePolicy.sourceAgentId,
            targetAgentId: routedAgent.agentId,
            text: resolution.announcementText,
          },
        } satisfies LiveSandboxRouteEvent]
      : []),
    ...buildTransferRouteEvents(routePolicy.sourceAgentId, resolution.transfer),
  ];

  packet = recordRuntimePacketTransfer(packet, {
    at: input.at,
    nodeId: routePolicy.sourceAgentId,
    transfer: resolution.transfer,
  });
  packet = recordRuntimePacketNodeVisit(packet, {
    at: input.at,
    nodeId: routedAgent.node.id,
    nodeKind: routedAgent.node.kind,
    label: routedAgent.node.label,
  });
  packet = withAgentCapabilities(packet, input.manifest, routedAgent.node.id, routedAgent.agentId);
  packet = recordRuntimePacketAgentSelected(packet, {
    at: input.at,
    nodeId: routedAgent.node.id,
    agent: routedAgent.agent,
    nextFrontierNodeIds: [routedAgent.node.id],
  });

  return {
    kind: "routed",
    activeAgentId: routedAgent.agentId,
    nextFrontier: [routedAgent.node.id],
    routeEvents,
    context: {
      ...(resolution.intent.intentKey !== null ? { intent: resolution.intent.intentKey } : {}),
    },
    packet,
    responseText: resolution.announcementText ?? `I'll connect you with ${routedAgent.agent.name}.`,
  };
}

function rejectAgentHandoffAction(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: string;
  packet: TurnRuntimePacket;
  at: string;
  code: string;
  message: string;
}): LiveSandboxAgentHandoffActionResolution {
  const sourceNodeId = input.packet.graph.currentNodeId ?? input.activeAgentId;
  let packet = recordRuntimePacketWarning(input.packet, {
    at: input.at,
    nodeId: sourceNodeId,
    warning: {
      code: input.code,
      message: input.message,
      recoverable: true,
    },
  });
  packet = withAgentCapabilities(packet, input.manifest, sourceNodeId, input.activeAgentId);

  return {
    kind: "rejected",
    activeAgentId: input.activeAgentId,
    nextFrontier: [sourceNodeId],
    routeEvents: [],
    packet,
    responseText: "I need one more detail before I can connect you to the right specialist.",
  };
}

function findActiveAgentRoutePolicy(
  manifest: CompiledRuntimeManifest,
  packet: TurnRuntimePacket,
  activeAgentId: string,
): DraftWorkflowAgentRoutePolicy | undefined {
  const currentNodeId = packet.graph.currentNodeId;
  if (currentNodeId !== undefined) {
    const routePolicy = findAgentRoutePolicy(manifest, currentNodeId, activeAgentId);
    if (routePolicy !== undefined) {
      return routePolicy;
    }
  }

  const activeNode = manifest.graph.nodes.find(
    (node) => node.kind === "agent" && node.id === activeAgentId,
  );
  return activeNode === undefined ? undefined : findAgentRoutePolicy(manifest, activeNode.id, activeAgentId);
}

function findAgentRoutePolicy(
  manifest: CompiledRuntimeManifest,
  sourceNodeId: string,
  sourceAgentId: string,
): DraftWorkflowAgentRoutePolicy | undefined {
  return manifest.routePolicies.find(
    (routePolicy) => routePolicy.sourceAgentId === sourceNodeId || routePolicy.sourceAgentId === sourceAgentId,
  );
}

function resolveAgentRoutePolicyTargetAgents(
  manifest: CompiledRuntimeManifest,
): Array<RuntimeAgentRef & { routePolicyTargetId?: string | undefined }> {
  return resolveRuntimeAgents(manifest).map((agent) => ({
    ...agentToRuntimeAgentRef(agent),
    routePolicyTargetId: agent.agentId,
  }));
}

function resolveAgentRoutePolicyTargetNode(
  manifest: CompiledRuntimeManifest,
  nodeById: Map<string, CompiledRuntimeManifest["graph"]["nodes"][number]>,
  target: AgentRoutePolicyClassificationResolution["target"],
):
  | {
      node: CompiledRuntimeManifest["graph"]["nodes"][number];
      agentId: string;
      agent: RuntimeAgentRef;
      runtimeAgent: Agent;
    }
  | undefined {
  if (target.type !== "agent") {
    return undefined;
  }

  const runtimeAgent = resolveRuntimeAgent(manifest, target.agentId);
  if (runtimeAgent === undefined) {
    return undefined;
  }

  const node = nodeById.get(runtimeAgent.agentId);
  if (node?.kind !== "agent") {
    return undefined;
  }

  return {
    node,
    agentId: runtimeAgent.agentId,
    agent: agentToRuntimeAgentRef(runtimeAgent),
    runtimeAgent,
  };
}

async function classifyIntentRoute(input: {
  classifier: LiveSandboxIntentClassifier;
  nodeId: string;
  routeConfig: IntentRouteNodeConfig;
  packet: TurnRuntimePacket;
  sourceAgent: RuntimeAgentRef | undefined;
}): Promise<{
  selection: ConditionRouteSelection;
  intentKey: string | null;
  packet: TurnRuntimePacket;
}> {
  let packet = input.packet;

  if (input.packet.callerInput.latestCallerTurn.trim().length === 0) {
    const resolution = resolveIntentRouteClassification({
      nodeId: input.nodeId,
      route: input.routeConfig,
      output: {
        matchedBranchId: null,
        intentKey: null,
        confidence: 0,
        reason: "Caller input was empty; using fallback.",
        usedFallback: true,
      },
    });
    packet = recordRuntimePacketIntent(packet, {
      at: packet.timing.startedAt,
      ...resolution.result,
    });
    packet = recordRuntimePacketWarning(packet, {
      at: packet.timing.startedAt,
      nodeId: input.nodeId,
      warning: {
        code: "intent_classifier.empty_input",
        message: "Caller input was empty, so intent classification used fallback.",
        recoverable: true,
      },
    });

    return {
      selection: {
        branchId: "fallback",
        label: input.routeConfig.fallback.label,
        targetNodeId: resolution.result.targetNodeId,
        isFallback: true,
      },
      intentKey: null,
      packet,
    };
  }

  let classifierOutput: IntentClassifierOutput | unknown;
  let providerWarning:
    | {
        code: string;
        message: string;
        recoverable: boolean;
      }
    | undefined;

  try {
    classifierOutput = await input.classifier.classify({
      nodeId: input.nodeId,
      modelAlias: input.routeConfig.classifier.modelAlias,
      confidenceThreshold: input.routeConfig.classifier.confidenceThreshold,
      latestCallerTurn: input.packet.callerInput.latestCallerTurn,
      recentTranscript: input.packet.callerInput.recentTranscript.slice(
        Math.max(0, input.packet.callerInput.recentTranscript.length - input.routeConfig.inputWindow.recentTranscriptTurns),
      ),
      ...(input.sourceAgent !== undefined ? { sourceAgent: input.sourceAgent } : {}),
      branches: input.routeConfig.branches,
      fallback: {
        label: input.routeConfig.fallback.label,
      },
      inputWindow: input.routeConfig.inputWindow,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intent classifier failed.";
    providerWarning = {
      code: "intent_classifier.provider_error",
      message,
      recoverable: true,
    };
    classifierOutput = {
      matchedBranchId: null,
      intentKey: null,
      confidence: 0,
      reason: "Intent classifier failed; using fallback.",
      usedFallback: true,
    };
  }

  const resolution = resolveIntentRouteClassification({
    nodeId: input.nodeId,
    route: input.routeConfig,
    output: classifierOutput,
  });
  packet = recordRuntimePacketIntent(packet, {
    at: packet.timing.startedAt,
    ...resolution.result,
  });

  const warning = providerWarning ?? resolution.warning;
  if (warning !== undefined) {
    packet = recordRuntimePacketWarning(packet, {
      at: packet.timing.startedAt,
      nodeId: input.nodeId,
      warning,
    });
  }

  return {
    selection: {
      branchId: resolution.result.matchedBranchId ?? "fallback",
      label: resolution.result.label ?? input.routeConfig.fallback.label,
      targetNodeId: resolution.result.targetNodeId,
      isFallback: resolution.result.usedFallback,
    },
    intentKey: resolution.result.intentKey,
    packet,
  };
}

function resolveAgentRef(
  manifest: CompiledRuntimeManifest,
  agentId: string,
  fallbackName: string,
  fallbackKind: string,
): RuntimeAgentRef {
  const agent = resolveRuntimeAgent(manifest, agentId);
  if (agent !== undefined) {
    return agentToRuntimeAgentRef(agent);
  }

  return {
    id: agentId,
    name: fallbackName,
    kind: fallbackKind,
  };
}

function roleSupportsCallerLanguage(
  manifest: CompiledRuntimeManifest,
  agentId: string,
  language: string | undefined,
) {
  const normalizedLanguage = normalizeLanguageCode(language);

  if (normalizedLanguage === undefined) {
    return true;
  }

  const agent = resolveRuntimeAgent(manifest, agentId);
  if (agent !== undefined) {
    return agentSupportsLanguage(agent, language);
  }

  return true;
}

function buildUnsupportedTransferLanguageWarning(
  targetAgent: RuntimeAgentRef,
  language: string | undefined,
) {
  return {
    code: "transfer_language.unsupported",
    message: `Transfer target '${targetAgent.name}' does not support caller language '${language?.trim() || "unknown"}'.`,
    recoverable: true,
  };
}

function normalizeLanguageCode(language: string | undefined) {
  const normalized = language?.trim().toLowerCase();

  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  return normalized.split(/[-_]/)[0];
}

function readConditionBranches(node: CompiledRuntimeManifest["graph"]["nodes"][number]) {
  const condition = node.config["condition"];

  if (typeof condition !== "object" || condition === null) {
    return [];
  }

  const branches = (condition as { branches?: unknown }).branches;
  return Array.isArray(branches)
    ? branches.flatMap((branch) => {
        if (typeof branch !== "object" || branch === null) {
          return [];
        }

        const record = branch as Record<string, unknown>;
        return typeof record["id"] === "string" && typeof record["expression"] === "string"
          ? [{ id: record["id"], expression: record["expression"] }]
          : [];
      })
    : [];
}

function buildIntentRouteConfig(
  node: CompiledRuntimeManifest["graph"]["nodes"][number],
): IntentRouteNodeConfig | null {
  const condition = node.config["condition"];

  if (typeof condition !== "object" || condition === null) {
    return null;
  }

  const record = condition as Record<string, unknown>;
  const branchesValue = record["branches"];
  const fallbackTargetNodeId = record["fallbackTargetNodeId"];
  const fallbackLabel = record["fallbackLabel"];

  if (!Array.isArray(branchesValue) || typeof fallbackTargetNodeId !== "string" || typeof fallbackLabel !== "string") {
    return null;
  }

  return {
    classifier: readClassifierConfig(record["classifier"]),
    inputWindow: readInputWindowConfig(record["inputWindow"]),
    branches: branchesValue.flatMap(readIntentRouteBranch),
    fallback: {
      label: fallbackLabel,
      targetNodeId: fallbackTargetNodeId,
    },
  };
}

function readIntentRouteBranch(branch: unknown): IntentRouteBranchConfig[] {
  if (typeof branch !== "object" || branch === null) {
    return [];
  }

  const record = branch as Record<string, unknown>;
  const id = record["id"];
  const label = record["label"];
  const expression = record["expression"];
  const targetNodeId = record["targetNodeId"];

  if (typeof id !== "string" || typeof label !== "string" || typeof targetNodeId !== "string") {
    return [];
  }

  const configuredIntentKey = typeof record["intentKey"] === "string" ? record["intentKey"] : undefined;
  const intentKey = normalizeIntent(configuredIntentKey)
    ?? (typeof expression === "string" ? extractIntentKey(expression) : undefined)
    ?? slugifyIntentLabel(label);
  const configuredDescription = typeof record["description"] === "string" ? record["description"].trim() : "";

  return [
    {
      id,
      label,
      intentKey,
      description: configuredDescription.length > 0 ? configuredDescription : `${label} caller intent.`,
      examples: Array.isArray(record["examples"])
        ? record["examples"].filter((example): example is string => typeof example === "string")
        : [],
      targetNodeId,
    },
  ];
}

function readClassifierConfig(config: unknown): IntentRouteNodeConfig["classifier"] {
  if (typeof config === "object" && config !== null) {
    const record = config as Record<string, unknown>;
    const threshold = record["confidenceThreshold"];

    return {
      mode: "standard",
      modelAlias: "intent-classifier-fast",
      confidenceThreshold: typeof threshold === "number" && Number.isFinite(threshold) ? threshold : 0.65,
    };
  }

  return {
    mode: "standard",
    modelAlias: "intent-classifier-fast",
    confidenceThreshold: 0.65,
  };
}

function readInputWindowConfig(config: unknown): IntentRouteInputWindowConfig {
  if (typeof config === "object" && config !== null) {
    const record = config as Record<string, unknown>;
    const recentTranscriptTurns = record["recentTranscriptTurns"];

    return {
      latestCallerTurn: record["latestCallerTurn"] !== false,
      recentTranscriptTurns:
        typeof recentTranscriptTurns === "number" && Number.isFinite(recentTranscriptTurns)
          ? Math.max(0, Math.trunc(recentTranscriptTurns))
          : 6,
      includeConversationSummary: record["includeConversationSummary"] !== false,
      includePreviousAgentContext: record["includePreviousAgentContext"] !== false,
      includeRecentToolResults: record["includeRecentToolResults"] !== false,
    };
  }

  return {
    latestCallerTurn: true,
    recentTranscriptTurns: 6,
    includeConversationSummary: true,
    includePreviousAgentContext: true,
    includeRecentToolResults: true,
  };
}

function extractIntentKey(expression: string | undefined) {
  return expression?.match(/intent\s*==\s*"([^"]+)"/i)?.[1]?.toLowerCase();
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

function normalizeIntent(intent: string | undefined) {
  const normalized = intent?.trim().toLowerCase();
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined;
}

function slugifyIntentLabel(label: string) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "unknown";
}
