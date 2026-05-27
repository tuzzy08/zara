import {
  createTurnRuntimePacket,
  recordRuntimePacketAgentSelected,
  recordRuntimePacketIntent,
  recordRuntimePacketNodeVisit,
  recordRuntimePacketTransfer,
  recordRuntimePacketWarning,
  resolveIntentRouteClassification,
  resolveConditionBranch,
  type CompiledRuntimeManifest,
  type ConditionRouteSelection,
  type AgentToolAssignment,
  type IntentClassifierOutput,
  type IntentRouteBranchConfig,
  type IntentRouteInputWindowConfig,
  type IntentRouteNodeConfig,
  type ModelRoutingContext,
  type RuntimeAgentRef,
  type TranscriptTurn,
  type TurnRuntimePacket,
  type TurnRuntimePacketInputSource,
  type WorkflowEdge,
} from "@zara/core";

export interface LiveSandboxRouteEvent {
  type: string;
  payload: Record<string, unknown>;
}

export type LiveSandboxTurnRouteResolution =
  | {
      kind: "agent";
      activeRoleId: string;
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
        const agentRef = resolveAgentRef(input.manifest, node.roleId ?? node.id, node.label, node.kind);
        lastVisitedAgent = agentRef;
        const shouldContinuePastAgent = flowTargets.some((targetNodeId) => {
          const targetNode = nodeById.get(targetNodeId);
          return (
            targetNode?.kind === "condition"
            || targetNode?.kind === "handoff"
          );
        });

        if (shouldContinuePastAgent) {
          queue.unshift(...flowTargets);
          break;
        }

        const activeRoleId = node.roleId ?? node.id;
        packet = {
          ...packet,
          availableTools: resolveAvailableAgentTools(input.manifest, activeRoleId),
        };
        packet = recordRuntimePacketAgentSelected(packet, {
          at: packetStartedAt,
          nodeId: node.id,
          agent: agentRef,
          nextFrontierNodeIds: flowTargets,
        });

        return {
          kind: "agent",
          activeRoleId,
          nextFrontier: [...flowTargets],
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
        packet = recordRuntimePacketTransfer(packet, {
          at: packetStartedAt,
          nodeId: node.id,
          transfer: {
            transferId: `${packet.ids.turnId}:${node.id}`,
            sourceAgent:
              lastVisitedAgent
              ?? resolveAgentRef(input.manifest, input.manifest.entryRoleId, "Entry agent", "agent"),
            targetAgent: resolveAgentRef(input.manifest, handoff.targetRoleId, handoff.targetRoleName, "agent"),
            reason: handoff.handoffReason,
            callerNeedSummary: input.transcript,
            recentToolResults: [],
            ...(matchedIntent !== undefined ? { matchedIntent } : {}),
          },
        });
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

  packet = recordRuntimePacketAgentSelected(packet, {
    at: packetStartedAt,
    agent: resolveAgentRef(input.manifest, input.manifest.entryRoleId, "Entry agent", "agent"),
    nextFrontierNodeIds: [],
  });

  return {
    kind: "agent",
    activeRoleId: input.manifest.entryRoleId,
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
  activeRoleId: string,
): AgentToolAssignment[] {
  return manifest.agentToolAssignments
    .filter((assignment) => assignment.roleId === activeRoleId)
    .map((assignment) => ({
      id: assignment.id,
      toolId: assignment.toolId,
      label: assignment.label,
      description: assignment.description,
      whenToUse: assignment.whenToUse,
      inputSchema: { ...assignment.inputSchema },
      requiredInputs: [...assignment.requiredInputs],
      risk: assignment.risk,
      requiresHumanApproval: assignment.requiresHumanApproval,
      ...(assignment.credentialRef !== undefined ? { credentialRef: assignment.credentialRef } : {}),
    }));
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
  roleId: string,
  fallbackName: string,
  fallbackKind: string,
): RuntimeAgentRef {
  const role = manifest.roles.find((candidate) => candidate.id === roleId);

  return {
    id: role?.id ?? roleId,
    name: role?.name ?? fallbackName,
    kind: role?.kind ?? fallbackKind,
  };
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
