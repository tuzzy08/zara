import {
  createTurnRuntimePacket, parseAgentActionText, recordRuntimePacketIntent,
  recordRuntimePacketTransfer, recordRuntimePacketWarning, resolveAgentRoutePolicyClassification,
  resolveRuntimeAgent, type CompiledRuntimeManifest, type ToolExecutionResult,
} from "@zara/core";
import { RuntimeAgentToolExecutorService } from "../sandbox-live-sessions/runtime-agent-tool-executor.service";
import { OpenAiChatTextProvider } from "../sandbox-live-sessions/openai-chat-text.provider";
import { GeminiIntentClassifierProvider } from "../sandbox-live-sessions/sandbox-intent-classifier.provider";
import { createCompiledManifest } from "../sandbox-live-sessions/sandbox-live-sessions.websocket.test-support";
import type { RuntimeEvalExample } from "./runtime-eval-fixtures";
import type { RuntimeEvalOutput } from "./runtime-evaluators";

// Only inputs cross this boundary. Expected answers belong to the scorer.
export async function executeRuntimeEval(input: RuntimeEvalExample["inputs"]): Promise<RuntimeEvalOutput> {
  const manifest = buildRuntimeEvalManifest(input);
  const activeAgentId = manifest.entryAgentId;
  const at = "2026-09-15T00:00:00.000Z";
  const activeAgent = resolveRuntimeAgent(manifest, activeAgentId)!;
  let packet = createTurnRuntimePacket({
    ids: input.packet.ids, timing: { startedAt: at }, callerInput: input.packet.callerInput,
    graph: { entryNodeId: activeAgentId, activeAgent: { id: activeAgentId, name: activeAgent.name, kind: activeAgent.kind } },
    availableTools: manifest.agentToolAssignments,
  });
  const output: RuntimeEvalOutput = { toolCallIds: [], missingInputRejected: false };

  if (input.agentAction !== undefined) {
    const provider = new OpenAiChatTextProvider({
      apiKey: "eval-fake-key",
      fetch: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ action: JSON.parse(input.agentAction!) }) } }] }),
    });
    let text = "";
    for await (const chunk of provider.streamText({
      manifest, activeAgent, transcript: input.callerTurn, tier: "cheap",
      context: { callPhase: "discovery", language: "en" }, agentActionMode: true,
    })) text += chunk;
    try {
      const action = parseAgentActionText(text);
      if (action.type === "call_tool") {
        const executor = new RuntimeAgentToolExecutorService(
          { execute: async () => ({ summary: input.toolSummary ?? "Lookup completed", output: { status: "available" } }) },
          { evaluateToolExecution: async () => ({ allowed: true, approvalRequired: false, reason: "granted" }) },
        );
        packet = await executor.executeAgentTool({
          organizationId: manifest.tenantId, sessionId: input.packet.ids.callSessionId,
          workspaceId: input.packet.ids.workspaceId, actorUserId: "eval-actor", manifest,
          activeAgentId, transcript: input.callerTurn, action, packet, at,
        });
        output.toolCallIds = packet.toolCalls.flatMap((call) => call.result?.status === "completed" ? [call.request.toolAssignmentId] : []);
        output.missingInputRejected = packet.toolCalls.some((call) => call.result?.error?.code === "tool_input.missing_required");
      }
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AgentActionParseError") throw error;
      packet = recordRuntimePacketWarning(packet, { at, warning: { code: "agent_action.invalid", message: error.message, recoverable: true } });
    }
  }

  if (input.classifierOutput !== undefined) {
    const routePolicy = manifest.routePolicies[0]!;
    const classifier = new GeminiIntentClassifierProvider({
      apiKey: "eval-fake-key",
      fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(input.classifierOutput) }] } }] }),
    });
    const classified = await classifier.classify({
      nodeId: activeAgentId, modelAlias: "intent-classifier-fast", confidenceThreshold: 0.65,
      latestCallerTurn: input.callerTurn, recentTranscript: [], inputWindow: routePolicy.inputWindow,
      branches: routePolicy.branches.map((branch) => ({ ...branch, description: branch.label, examples: [], targetNodeId: input.manifestProjection.branchTargets[branch.intentKey]! })),
      fallback: { label: "Clarify" },
    });
    const recentToolResults = packet.toolCalls.flatMap((call) => call.result === undefined ? [] : [call.result]);
    if (input.previousToolSummary !== undefined) recentToolResults.push(previousToolResult(input.previousToolSummary));
    const resolution = resolveAgentRoutePolicyClassification({
      routePolicy, sourceAgent: { id: activeAgentId, name: activeAgent.name, kind: activeAgent.kind },
      targetAgents: manifest.graph.nodes.filter((node) => node.id !== activeAgentId).map((node) => ({ id: node.id, name: node.label, kind: "custom" })),
      callerNeedSummary: input.callerTurn, recentToolResults, output: classified,
    });
    packet = recordRuntimePacketIntent(packet, { ...resolution.intent, at });
    if (resolution.warning !== undefined) packet = recordRuntimePacketWarning(packet, { at, warning: resolution.warning });
    if (resolution.transfer !== undefined) packet = recordRuntimePacketTransfer(packet, { at, nodeId: activeAgentId, transfer: resolution.transfer });
    output.selectedIntentKey = packet.intent?.intentKey ?? undefined;
    output.selectedTargetNodeId = packet.intent?.targetNodeId;
    output.usedFallback = packet.intent?.usedFallback;
    if (packet.transfer !== undefined) {
      output.transferTargetAgentId = packet.transfer.targetAgent.id;
      output.transferContext = {
        sourceAgentId: packet.transfer.sourceAgent.id, reason: packet.transfer.reason,
        callerNeedSummary: packet.transfer.callerNeedSummary,
        matchedIntentKey: packet.transfer.matchedIntent?.intentKey,
        safeToolSummaries: packet.transfer.recentToolResults.map((result) => result.summary),
      };
    }
  }
  output.policyWarnings = packet.diagnostics.warnings.map((warning) => warning.code);
  output.redactedTrace = JSON.stringify(packet.diagnostics.events.map((event) => ({ type: event.type, sequence: event.sequence })));
  return output;
}

export function buildRuntimeEvalManifest(input: RuntimeEvalExample["inputs"]): CompiledRuntimeManifest {
  const manifest = createCompiledManifest(input.packet.ids.workspaceId);
  const entryAgentId = input.manifestProjection.entryAgentId;
  const agents = [...new Set([entryAgentId, ...Object.values(input.manifestProjection.branchTargets)])];
  const assignments = input.packet.availableTools.map((tool) => ({
    ...tool, agentId: entryAgentId, description: tool.label, whenToUse: tool.label,
    inputSchema: { type: "object", properties: Object.fromEntries(tool.requiredInputs.map((key) => [key, { type: "string" }])), required: tool.requiredInputs, additionalProperties: false },
    risk: "low" as const, requiresHumanApproval: false,
  }));
  return {
    ...manifest, tenantId: input.packet.ids.tenantId, manifestId: input.packet.ids.manifestId,
    publishedVersionId: input.manifestProjection.publishedWorkflowVersionId, entryAgentId, entryNodeId: entryAgentId,
    agentToolAssignments: assignments,
    toolBindings: assignments.map((tool) => ({
      nodeId: tool.id, label: tool.label, toolId: tool.toolId, connector: "internal", toolName: tool.label,
      risk: tool.risk, requiresHumanApproval: false,
      tool: { id: tool.toolId, name: tool.label, description: tool.label, connector: "internal", risk: tool.risk, requiresHumanApproval: false },
    })),
    graph: {
      ...manifest.graph, edges: [], nodes: agents.map((id) => ({
        id, kind: "agent", label: id, position: { x: 0, y: 0 },
        config: { role: { kind: "custom", name: id, businessName: "Eval business", instructions: "Help the caller. Ask for missing required inputs before using a tool.", defaultModelTier: "cheap", toolIds: [], languagePolicy: { defaultLanguage: "en", supportedLanguages: ["en"], allowMidCallSwitching: false } } },
      })),
    },
    routePolicies: [{
      sourceAgentId: entryAgentId, sourceAgentName: entryAgentId,
      type: "route_by_intent", trigger: "on_caller_turn_end", activation: "until_routed",
      readiness: { mode: "auto_with_clarification", maxClarificationTurns: 2 },
      classifier: { mode: "standard", modelAlias: "intent-classifier-fast", confidenceThreshold: 0.65 },
      inputWindow: { latestCallerTurn: true, recentTranscriptTurns: 6, includeConversationSummary: true, includePreviousAgentContext: true, includeRecentToolResults: true },
      branches: Object.entries(input.manifestProjection.branchTargets).map(([intentKey, agentId]) => ({ id: intentKey, label: intentKey, intentKey, target: { type: "agent", agentId } })),
      fallback: { label: "Clarify", target: { type: "clarify_source_agent" } },
      announcement: { mode: "none" },
    }],
  };
}

function previousToolResult(summary: string): ToolExecutionResult {
  return { toolCallId: "prior-lookup", toolAssignmentId: "prior-lookup", toolId: "lookup", toolName: "Lookup", status: "completed", summary, durationMs: 0, idempotencyKey: "prior-lookup" };
}
