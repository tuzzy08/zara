import { describe, expect, it, vi } from "vitest";

import {
  buildRealtimeToolDeclarations,
  createTurnRuntimePacket,
  type AgentAction,
  type AgentToolAssignment,
  type CompiledRuntimeManifest,
  type CompiledRuntimeToolBinding,
  type TurnRuntimePacket,
} from "@zara/core";

import type { ToolPermissionDecision } from "../integrations/tool-permission-grants.service";
import {
  RuntimeAgentToolExecutorService,
  type RuntimeAgentToolSideEffectEvent,
} from "./runtime-agent-tool-executor.service";
import type { LiveSandboxToolRegistry } from "./sandbox-live-sessions.providers";

describe("RuntimeAgentToolExecutorService", () => {
  it("skips execution when required provider input is missing", async () => {
    const registry = createRegistry();
    const executor = createExecutor({ registry });

    const packet = await executor.executeAgentTool({
      ...baseInput(),
      packet: createPacket({
        requiredInputs: ["query"],
      }),
      action: createToolAction({ arguments: {} }),
    });

    expect(registry.execute).not.toHaveBeenCalled();
    expect(packet.toolCalls[0]?.result).toMatchObject({
      status: "skipped",
      error: {
        code: "tool_input.missing_required",
      },
    });
  });

  it("returns approval_required without executing when grant or assignment requires approval", async () => {
    const registry = createRegistry();
    const executor = createExecutor({
      registry,
      decision: {
        allowed: true,
        approvalRequired: true,
        reason: "granted",
      },
    });

    const packet = await executor.executeAgentTool({
      ...baseInput(),
      packet: createPacket(),
      action: createToolAction(),
    });

    expect(registry.execute).not.toHaveBeenCalled();
    expect(packet.toolCalls[0]?.result).toMatchObject({
      status: "approval_required",
      error: {
        code: "tool_approval.required",
      },
    });
  });

  it("executes connector tools through the registry and stores only redacted safe output", async () => {
    const registry = createRegistry({
      output: {
        count: 1,
        email: "caller@example.com",
        nested: {
          status: "open",
          token: "secret-token",
        },
      },
    });
    const executor = createExecutor({ registry });

    const packet = await executor.executeAgentTool({
      ...baseInput(),
      packet: createPacket(),
      action: createToolAction({
        arguments: {
          query: "account activation",
        },
      }),
    });

    expect(registry.execute).toHaveBeenCalledWith(expect.objectContaining({
      callSessionId: "session-1",
      toolCallId: "tool-call-1",
      toolAssignmentId: "tool-ticket-search",
      arguments: {
        query: "account activation",
      },
      idempotencyKey: "session-1:turn-1:tool-ticket-search:tool-call-1",
      transcript: "Caller needs ticket status.",
      actorUserId: "user-1",
      workspaceId: "workspace-customer-success",
      agentContext: expect.objectContaining({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        callSessionId: "session-1",
        actorUserId: "user-1",
        agent: expect.objectContaining({
          agentId: "agent-support",
          roleId: "role-support",
          name: "Support",
          kind: "support",
        }),
      }),
    }));
    const executeInput = vi.mocked(registry.execute).mock.calls[0]?.[0] as
      | { agentContext?: Record<string, unknown> }
      | undefined;
    expect(executeInput?.agentContext).not.toHaveProperty("graph");
    expect(executeInput?.agentContext).not.toHaveProperty("roles");
    expect(executeInput?.agentContext).not.toHaveProperty("routePolicies");
    expect(packet.toolCalls[0]?.result).toMatchObject({
      status: "completed",
      safeOutput: {
        count: 1,
        nested: {
          status: "open",
        },
      },
    });
  });

  it("records side-effect ledger transitions around write tools", async () => {
    const sideEffects: RuntimeAgentToolSideEffectEvent[] = [];
    const executor = createExecutor({
      registry: createRegistry(),
    });

    const packet = await executor.executeAgentTool({
      ...baseInput({
        binding: createBinding({
          toolId: "zendesk.create_ticket",
          toolName: "Create ticket",
        }),
      }),
      packet: createPacket({
        toolId: "zendesk.create_ticket",
        label: "Create ticket",
      }),
      action: createToolAction({
        arguments: {
          query: "account activation",
        },
      }),
      publishSideEffect: (event) => sideEffects.push(event),
    });

    expect(packet.toolCalls[0]?.result?.status).toBe("completed");
    expect(sideEffects).toEqual([
      expect.objectContaining({
        status: "pending",
        retryPosture: "in_progress",
        toolId: "zendesk.create_ticket",
      }),
      expect.objectContaining({
        status: "succeeded",
        retryPosture: "do_not_retry",
        toolId: "zendesk.create_ticket",
      }),
    ]);
  });

  it("normalizes provider-native realtime calls into the shared Zara tool executor", async () => {
    const registry = createRegistry();
    const executor = createExecutor({ registry });
    const packet = createPacket();
    const runtimeInput = baseInput();
    const declarations = buildRealtimeToolDeclarations({
      manifest: runtimeInput.manifest,
      activeAgentId: runtimeInput.activeAgentId,
    });

    const executed = await executor.executeRealtimeProviderToolCall({
      ...runtimeInput,
      packet,
      declarations,
      providerCallId: "provider-call-1",
      providerFunctionName: declarations[0]!.name,
      argumentsJson: JSON.stringify({
        query: "account activation",
      }),
    });

    expect(executed.resolvedCall).toMatchObject({
      providerCallId: "provider-call-1",
      toolAssignmentId: "tool-ticket-search",
      toolId: "zendesk.search_tickets",
      arguments: {
        query: "account activation",
      },
    });
    expect(executed.packet.toolCalls[0]?.request).toMatchObject({
      toolCallId: "provider-call-1",
      toolAssignmentId: "tool-ticket-search",
      arguments: {
        query: "account activation",
      },
    });
    expect(registry.execute).toHaveBeenCalledOnce();
  });

  it("rejects provider-invented function names before execution", async () => {
    const registry = createRegistry();
    const executor = createExecutor({ registry });

    await expect(
      executor.executeRealtimeProviderToolCall({
        ...baseInput(),
        packet: createPacket(),
        declarations: [],
        providerCallId: "provider-call-unknown",
        providerFunctionName: "zara_invented_tool_deadbeef",
        argumentsJson: "{}",
      }),
    ).rejects.toThrow("Unknown realtime tool function");
    expect(registry.execute).not.toHaveBeenCalled();
  });
});

function createExecutor(input: {
  registry?: LiveSandboxToolRegistry | undefined;
  decision?: ToolPermissionDecision | undefined;
} = {}) {
  const defaultDecision: ToolPermissionDecision = {
    allowed: true,
    approvalRequired: false,
    reason: "granted",
  };

  return new RuntimeAgentToolExecutorService(
    input.registry ?? createRegistry(),
    {
      evaluateToolExecution: vi.fn(async () => input.decision ?? defaultDecision),
    },
  );
}

function baseInput(overrides: {
  binding?: CompiledRuntimeToolBinding | undefined;
} = {}) {
  const binding = overrides.binding ?? createBinding();
  const manifest = {
    tenantId: "tenant-1",
    workspaceId: "workspace-customer-success",
    manifestId: "manifest-1",
    publishedVersionId: "published-1",
    workflowId: "workflow-1",
    version: 1,
    graph: {
      id: "workflow-1",
      name: "Support workflow",
      nodes: [
        {
          id: "agent-support",
          kind: "agent",
          label: "Stale support label",
          roleId: "role-support",
          position: { x: 0, y: 0 },
          config: {
            role: {
              kind: "support",
              name: "Support",
              businessName: "Zara AI",
              instructions: "Help support callers.",
              defaultModelTier: "standard",
              toolIds: ["zendesk.search_tickets"],
              languagePolicy: {
                defaultLanguage: "en",
                supportedLanguages: ["en"],
                allowMidCallSwitching: false,
              },
            },
          },
        },
      ],
      edges: [],
    },
    roles: [
      {
        id: "role-support",
        kind: "support",
        name: "Support",
        businessName: "Zara AI",
        instructions: "Help support callers.",
        defaultModelTier: "standard",
        toolIds: ["zendesk.search_tickets"],
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
      },
    ],
    agentToolAssignments: [
      {
        id: "tool-ticket-search",
        roleId: "role-support",
        toolId: "zendesk.search_tickets",
        label: "Search tickets",
        description: "Search tickets.",
        whenToUse: "Use when a caller asks about a ticket.",
        inputSchema: {
          type: "object",
        },
        requiredInputs: [],
        risk: "low",
        requiresHumanApproval: false,
      },
    ],
    toolBindings: [binding],
  } as unknown as CompiledRuntimeManifest;

  return {
    organizationId: "tenant-1",
    sessionId: "session-1",
    workspaceId: "workspace-customer-success",
    actorUserId: "user-1",
    manifest,
    activeAgentId: "agent-support",
    transcript: "Caller needs ticket status.",
    at: "2026-06-14T08:30:00.000Z",
  };
}

function createBinding(overrides: Partial<CompiledRuntimeToolBinding> = {}): CompiledRuntimeToolBinding {
  return {
    nodeId: "tool-ticket-search",
    label: "Search tickets",
    toolId: "zendesk.search_tickets",
    connector: "zendesk",
    toolName: "Search tickets",
    integrationConnectionId: "conn-zendesk",
    integrationLabel: "Zendesk",
    risk: "low",
    requiresHumanApproval: false,
    tool: {
      id: "zendesk.search_tickets",
      name: "Search tickets",
      description: "Search tickets.",
      connector: "zendesk",
      risk: "low",
      requiresHumanApproval: false,
    },
    ...overrides,
  };
}

function createPacket(overrides: Partial<AgentToolAssignment> = {}): TurnRuntimePacket {
  return createTurnRuntimePacket({
    ids: {
      tenantId: "tenant-1",
      workspaceId: "workspace-customer-success",
      callSessionId: "session-1",
      turnId: "turn-1",
      manifestId: "manifest-1",
      manifestVersion: 1,
    },
    timing: {
      startedAt: "2026-06-14T08:30:00.000Z",
    },
    callerInput: {
      latestCallerTurn: "Caller needs ticket status.",
      source: "voice",
      language: "en",
      sttConfidence: 0.9,
    },
    graph: {
      entryNodeId: "entry",
      activeAgent: {
        id: "agent-support",
        name: "Support",
        kind: "support",
      },
    },
    availableTools: [
      {
        id: "tool-ticket-search",
        toolId: "zendesk.search_tickets",
        label: "Search tickets",
        description: "Search tickets.",
        whenToUse: "Use when a caller asks about a ticket.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
        requiredInputs: [],
        risk: "low",
        requiresHumanApproval: false,
        credentialRef: "conn-zendesk",
        ...overrides,
      },
    ],
  });
}

function createToolAction(overrides: Partial<Extract<AgentAction, { type: "call_tool" }>> = {}): Extract<AgentAction, { type: "call_tool" }> {
  return {
    type: "call_tool",
    toolAssignmentId: "tool-ticket-search",
    toolCallId: "tool-call-1",
    arguments: {
      query: "account activation",
    },
    reason: "Caller asked for ticket status.",
    ...overrides,
  };
}

function createRegistry(result: {
  output?: Record<string, unknown> | undefined;
} = {}): LiveSandboxToolRegistry {
  return {
    execute: vi.fn(async () => ({
      summary: "Executed Search tickets.",
      output: result.output ?? {
        count: 1,
      },
    })),
  };
}
