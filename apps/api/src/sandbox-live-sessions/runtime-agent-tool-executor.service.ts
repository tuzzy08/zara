import { Inject, Injectable } from "@nestjs/common";
import {
  recordRuntimePacketToolRequest,
  recordRuntimePacketToolResult,
  recordRuntimePacketToolStarted,
  resolveRealtimeToolCall,
  createAgentRuntimeContext,
  type AgentAction,
  type AgentToolAssignment,
  type CompiledRuntimeManifest,
  type RealtimeToolDeclaration,
  type ResolvedRealtimeToolCall,
  type ToolExecutionResult,
  type TurnRuntimePacket,
} from "@zara/core";

import { ToolPermissionGrantsService } from "../integrations/tool-permission-grants.service";
import {
  classifyLiveSandboxToolExecutionFailure,
  isLiveSandboxSideEffectTool,
} from "./sandbox-live-tool-failures";
import {
  liveSandboxToolRegistryToken,
  type LiveSandboxToolRegistry,
} from "./sandbox-live-sessions.providers";

export type RuntimeAgentToolSideEffectStatus = "pending" | "succeeded" | "failed" | "unknown";
export type RuntimeAgentToolSideEffectRetryPosture =
  | "in_progress"
  | "safe_to_retry"
  | "manual_review_required"
  | "do_not_retry";

export interface RuntimeAgentToolSideEffectEvent {
  organizationId: string;
  sessionId: string;
  at: string;
  status: RuntimeAgentToolSideEffectStatus;
  retryPosture: RuntimeAgentToolSideEffectRetryPosture;
  binding: CompiledRuntimeManifest["toolBindings"][number];
  toolCallId: string;
  toolAssignmentId: string;
  idempotencyKey: string;
  provider: string;
  connector: string;
  toolId: string;
  toolName: string;
  integrationConnectionId?: string | undefined;
  errorCode?: string | undefined;
}

export interface RuntimeAgentToolExecutorInput {
  organizationId: string;
  sessionId: string;
  workspaceId: string;
  actorUserId: string;
  manifest: CompiledRuntimeManifest;
  activeAgentId: string;
  transcript: string;
  action: Extract<AgentAction, { type: "call_tool" }>;
  packet: TurnRuntimePacket;
  at: string;
  publishSideEffect?: ((event: RuntimeAgentToolSideEffectEvent) => void) | undefined;
}

export interface RuntimeRealtimeProviderToolCallInput extends Omit<
  RuntimeAgentToolExecutorInput,
  "action"
> {
  declarations: RealtimeToolDeclaration[];
  providerCallId: string;
  providerFunctionName: string;
  argumentsJson?: string | undefined;
  arguments?: Record<string, unknown> | undefined;
}

export interface RuntimeRealtimeProviderToolCallResult {
  resolvedCall: ResolvedRealtimeToolCall;
  packet: TurnRuntimePacket;
}

@Injectable()
export class RuntimeAgentToolExecutorService {
  constructor(
    @Inject(liveSandboxToolRegistryToken)
    private readonly toolRegistry: LiveSandboxToolRegistry,
    @Inject(ToolPermissionGrantsService)
    private readonly toolPermissionGrantsService: Pick<ToolPermissionGrantsService, "evaluateToolExecution">,
  ) {}

  async executeRealtimeProviderToolCall(
    input: RuntimeRealtimeProviderToolCallInput,
  ): Promise<RuntimeRealtimeProviderToolCallResult> {
    const resolvedCall = resolveRealtimeToolCall({
      declarations: input.declarations,
      providerCallId: input.providerCallId,
      name: input.providerFunctionName,
      argumentsJson: input.argumentsJson,
      arguments: input.arguments,
    });
    const packet = await this.executeAgentTool({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      manifest: input.manifest,
      activeAgentId: input.activeAgentId,
      transcript: input.transcript,
      packet: input.packet,
      at: input.at,
      publishSideEffect: input.publishSideEffect,
      action: {
        type: "call_tool",
        toolCallId: resolvedCall.providerCallId,
        toolAssignmentId: resolvedCall.toolAssignmentId,
        arguments: resolvedCall.arguments,
        reason: "Provider requested a realtime tool call.",
      },
    });

    return {
      resolvedCall,
      packet,
    };
  }

  async executeAgentTool(input: RuntimeAgentToolExecutorInput): Promise<TurnRuntimePacket> {
    let packet = recordRuntimePacketToolRequest(input.packet, {
      at: input.at,
      nodeId: input.activeAgentId,
      request: input.action,
    });
    const assignment = packet.availableTools.find((tool) => tool.id === input.action.toolAssignmentId);
    const binding = assignment === undefined
      ? undefined
      : input.manifest.toolBindings.find(
          (candidate) => candidate.nodeId === assignment.id || candidate.toolId === assignment.toolId,
        );
    const agentContext = createAgentRuntimeContext({
      manifest: input.manifest,
      activeAgentId: input.activeAgentId,
      callSessionId: input.sessionId,
      actorUserId: input.actorUserId,
    });
    const idempotencyKey = `${packet.ids.callSessionId}:${packet.ids.turnId}:${input.action.toolAssignmentId}:${input.action.toolCallId}`;

    if (assignment === undefined) {
      return recordRuntimePacketToolResult(packet, {
        at: input.at,
        nodeId: input.activeAgentId,
        result: buildToolExecutionResult({
          action: input.action,
          idempotencyKey,
          status: "failed",
          summary: `Tool assignment '${input.action.toolAssignmentId}' is not available to this agent.`,
          durationMs: 0,
          error: {
            code: "tool_assignment.not_available",
            message: "The requested tool is not assigned to the active agent.",
            recoverable: true,
          },
        }),
      });
    }

    const missingInputs = findMissingToolInputs(assignment, input.action.arguments);

    if (missingInputs.length > 0) {
      return recordRuntimePacketToolResult(packet, {
        at: input.at,
        nodeId: input.activeAgentId,
        result: buildToolExecutionResult({
          action: input.action,
          assignment,
          binding,
          idempotencyKey,
          status: "skipped",
          summary: `Missing required tool input: ${missingInputs.join(", ")}.`,
          durationMs: 0,
          error: {
            code: "tool_input.missing_required",
            message: `Missing required tool input: ${missingInputs.join(", ")}.`,
            recoverable: true,
          },
        }),
      });
    }

    if (binding === undefined) {
      return recordRuntimePacketToolResult(packet, {
        at: input.at,
        nodeId: input.activeAgentId,
        result: buildToolExecutionResult({
          action: input.action,
          assignment,
          idempotencyKey,
          status: "failed",
          summary: `Tool '${assignment.label}' is missing runtime binding metadata.`,
          durationMs: 0,
          error: {
            code: "tool_binding.missing",
            message: "The requested tool does not have executable runtime binding metadata.",
            recoverable: true,
          },
        }),
      });
    }

    const permissionDecision = await this.toolPermissionGrantsService.evaluateToolExecution({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      activeAgentId: input.activeAgentId,
      manifest: input.manifest,
      binding,
    });

    if (permissionDecision.allowed === false) {
      return recordRuntimePacketToolResult(packet, {
        at: input.at,
        nodeId: input.activeAgentId,
        result: buildToolExecutionResult({
          action: input.action,
          assignment,
          binding,
          idempotencyKey,
          status: "failed",
          summary: `Tool '${assignment.label}' could not run because permission was denied.`,
          durationMs: 0,
          error: {
            code: permissionDecision.reason,
            message: "The active agent is not allowed to execute the requested tool.",
            recoverable: true,
          },
        }),
      });
    }

    if (permissionDecision.approvalRequired || assignment.requiresHumanApproval || binding.requiresHumanApproval) {
      return recordRuntimePacketToolResult(packet, {
        at: input.at,
        nodeId: input.activeAgentId,
        result: buildToolExecutionResult({
          action: input.action,
          assignment,
          binding,
          idempotencyKey,
          status: "approval_required",
          summary: `Tool '${assignment.label}' requires human approval before execution.`,
          durationMs: 0,
          error: {
            code: "tool_approval.required",
            message: "Human approval is required before executing this tool.",
            recoverable: true,
          },
        }),
      });
    }

    packet = recordRuntimePacketToolStarted(packet, {
      at: input.at,
      nodeId: input.activeAgentId,
      toolCallId: input.action.toolCallId,
      toolAssignmentId: input.action.toolAssignmentId,
      toolId: binding.toolId,
      toolName: binding.toolName,
    });
    const startedAt = Date.now();
    const hasSideEffect = isLiveSandboxSideEffectTool(binding.toolId);

    if (hasSideEffect) {
      input.publishSideEffect?.(buildSideEffectEvent({
        ...input,
        binding,
        idempotencyKey,
        status: "pending",
        retryPosture: "in_progress",
      }));
    }

    try {
      const result = await this.toolRegistry.execute({
        callSessionId: input.sessionId,
        manifest: input.manifest,
        agentContext,
        binding,
        toolCallId: input.action.toolCallId,
        toolAssignmentId: input.action.toolAssignmentId,
        arguments: input.action.arguments,
        idempotencyKey,
        transcript: input.transcript,
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId,
      });
      const durationMs = result.durationMs ?? Math.max(0, Date.now() - startedAt);

      if (hasSideEffect) {
        input.publishSideEffect?.(buildSideEffectEvent({
          ...input,
          binding,
          idempotencyKey,
          status: "succeeded",
          retryPosture: "do_not_retry",
        }));
      }

      return recordRuntimePacketToolResult(packet, {
        at: input.at,
        nodeId: input.activeAgentId,
        result: buildToolExecutionResult({
          action: input.action,
          assignment,
          binding,
          idempotencyKey,
          status: result.status === "partial" ? "partial" : "completed",
          summary: result.summary,
          output: result.output,
          safeOutput: result.safeOutput ?? buildSafeToolOutput(result.output),
          durationMs,
        }),
      });
    } catch (error) {
      const durationMs = Math.max(0, Date.now() - startedAt);
      const failure = classifyLiveSandboxToolExecutionFailure(error, assignment.label);
      if (hasSideEffect) {
        const sideEffectStatus = failure.code === "tool_execution.side_effect_unknown" ? "unknown" : "failed";
        input.publishSideEffect?.(buildSideEffectEvent({
          ...input,
          binding,
          idempotencyKey,
          status: sideEffectStatus,
          retryPosture: sideEffectStatus === "unknown" ? "manual_review_required" : "safe_to_retry",
          errorCode: failure.code,
        }));
      }

      return recordRuntimePacketToolResult(packet, {
        at: input.at,
        nodeId: input.activeAgentId,
        result: buildToolExecutionResult({
          action: input.action,
          assignment,
          binding,
          idempotencyKey,
          status: "failed",
          summary: failure.summary,
          durationMs,
          error: {
            code: failure.code,
            message: failure.message,
            recoverable: true,
          },
        }),
      });
    }
  }
}

function buildSideEffectEvent(input: RuntimeAgentToolExecutorInput & {
  binding: CompiledRuntimeManifest["toolBindings"][number];
  idempotencyKey: string;
  status: RuntimeAgentToolSideEffectStatus;
  retryPosture: RuntimeAgentToolSideEffectRetryPosture;
  errorCode?: string | undefined;
}): RuntimeAgentToolSideEffectEvent {
  return {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    at: input.at,
    status: input.status,
    retryPosture: input.retryPosture,
    binding: input.binding,
    toolCallId: input.action.toolCallId,
    toolAssignmentId: input.action.toolAssignmentId,
    idempotencyKey: input.idempotencyKey,
    provider: input.binding.connector,
    connector: input.binding.connector,
    toolId: input.binding.toolId,
    toolName: input.binding.toolName,
    ...(input.binding.integrationConnectionId !== undefined
      ? { integrationConnectionId: input.binding.integrationConnectionId }
      : {}),
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
  };
}

function findMissingToolInputs(
  assignment: AgentToolAssignment,
  args: Record<string, unknown>,
) {
  const schemaRequired = Array.isArray(assignment.inputSchema["required"])
    ? assignment.inputSchema["required"].filter((value): value is string => typeof value === "string")
    : [];
  const requiredInputs = [...new Set([...assignment.requiredInputs, ...schemaRequired])];

  return requiredInputs.filter((key) => !hasToolInputValue(args[key]));
}

function hasToolInputValue(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }

  return typeof value !== "string" || value.trim().length > 0;
}

function buildToolExecutionResult(input: {
  action: Extract<AgentAction, { type: "call_tool" }>;
  assignment?: AgentToolAssignment | undefined;
  binding?: CompiledRuntimeManifest["toolBindings"][number] | undefined;
  idempotencyKey: string;
  status: ToolExecutionResult["status"];
  summary: string;
  output?: Record<string, unknown> | undefined;
  safeOutput?: Record<string, unknown> | undefined;
  durationMs: number;
  error?: ToolExecutionResult["error"] | undefined;
}): ToolExecutionResult {
  return {
    toolCallId: input.action.toolCallId,
    toolAssignmentId: input.action.toolAssignmentId,
    toolId: input.binding?.toolId ?? input.assignment?.toolId ?? "unknown",
    toolName: input.binding?.toolName ?? input.assignment?.label ?? "Unknown tool",
    status: input.status,
    summary: input.summary,
    ...(input.output !== undefined ? { output: cloneRecord(input.output) } : {}),
    ...(input.safeOutput !== undefined ? { safeOutput: cloneRecord(input.safeOutput) } : {}),
    durationMs: input.durationMs,
    idempotencyKey: input.idempotencyKey,
    ...(input.error !== undefined ? { error: { ...input.error } } : {}),
  };
}

function buildSafeToolOutput(output: Record<string, unknown>): Record<string, unknown> {
  return redactToolOutputRecord(output, 0);
}

function redactToolOutputRecord(output: Record<string, unknown>, depth: number): Record<string, unknown> {
  if (depth > 3) {
    return {
      truncated: true,
    };
  }

  return Object.fromEntries(
    Object.entries(output)
      .filter(([key]) => !isSensitiveToolOutputKey(key))
      .map(([key, value]) => [key, redactToolOutputValue(value, depth + 1)]),
  );
}

function redactToolOutputValue(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactToolOutputValue(item, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    return redactToolOutputRecord(value as Record<string, unknown>, depth + 1);
  }

  if (typeof value === "string" && value.length > 1000) {
    return `${value.slice(0, 1000)}...`;
  }

  return value;
}

function isSensitiveToolOutputKey(key: string) {
  const normalized = key.toLowerCase();
  return [
    "authorization",
    "auth",
    "token",
    "secret",
    "password",
    "email",
    "phone",
    "ssn",
    "card",
  ].some((fragment) => normalized.includes(fragment));
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(record) as Record<string, unknown>;
}
