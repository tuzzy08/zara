import { describe, expect, it, vi } from "vitest";

import type {
  CompiledRuntimeManifest,
  RealtimeToolDeclaration,
  ResolvedRealtimeToolCall,
  TurnRuntimePacket,
} from "@zara/core";

import type { RuntimeAgentToolExecutorService } from "../sandbox-live-sessions/runtime-agent-tool-executor.service";
import { GeminiLiveRealtimeAdapter } from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "../sandbox-live-sessions/openai-realtime.adapter";
import { PremiumRealtimeToolLoopService } from "./premium-realtime-tool-loop.service";

describe("PremiumRealtimeToolLoopService", () => {
  const declaration: RealtimeToolDeclaration = {
    name: "zara_zendesk_search_tickets_1234abcd",
    toolAssignmentId: "tool-ticket-search",
    toolId: "zendesk.search_tickets",
    label: "Search tickets",
    description: "Search tickets\nRisk: low.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  };

  it("executes docs-style OpenAI response.done tool calls and returns identified continuation messages", async () => {
    const executor = createExecutor();
    const service = new PremiumRealtimeToolLoopService(executor);
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      tools: [declaration],
    });

    const result = await service.processOpenAiProviderMessage({
      ...baseLoopInput(),
      adapter,
      declarations: [declaration],
      rawProviderMessage: JSON.stringify({
        type: "response.done",
        response: {
          id: "response-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "provider-call-1",
              name: declaration.name,
              arguments: "{\"query\":\"account activation\"}",
            },
          ],
        },
      }),
    });

    expect(executor.executeRealtimeProviderToolCall).toHaveBeenCalledWith(expect.objectContaining({
      providerCallId: "provider-call-1",
      providerFunctionName: declaration.name,
      argumentsJson: "{\"query\":\"account activation\"}",
    }));
    expect(result.providerMessages).toEqual([
      {
        event_id: "zara_function_call_output_provider-call-1",
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "provider-call-1",
          output: JSON.stringify({
            status: "completed",
            summary: "Found one open ticket.",
            safeOutput: {
              count: 1,
            },
          }),
        },
      },
      {
        event_id: "zara_response_create_provider-call-1",
        type: "response.create",
      },
    ]);
  });

  it("does not execute the same OpenAI provider call twice when a completed response is replayed", async () => {
    const executor = createExecutor();
    const service = new PremiumRealtimeToolLoopService(executor);
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      tools: [declaration],
    });

    const result = await service.processOpenAiProviderMessage({
      ...baseLoopInput({
        packet: packetWithToolResult("provider-call-1"),
      }),
      adapter,
      declarations: [declaration],
      rawProviderMessage: JSON.stringify({
        type: "response.done",
        response: {
          id: "response-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "provider-call-1",
              name: declaration.name,
              arguments: "{\"query\":\"account activation\"}",
            },
          ],
        },
      }),
    });

    expect(executor.executeRealtimeProviderToolCall).not.toHaveBeenCalled();
    expect(result.packet).toEqual(packetWithToolResult("provider-call-1"));
    expect(result.providerMessages).toEqual([]);
  });

  it("executes Gemini provider tool calls and returns synchronous FunctionResponse messages", async () => {
    const executor = createExecutor();
    const service = new PremiumRealtimeToolLoopService(executor);
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
      tools: [declaration],
    });

    const result = await service.processGeminiProviderMessage({
      ...baseLoopInput(),
      adapter,
      declarations: [declaration],
      rawProviderMessage: JSON.stringify({
        tool_call: {
          function_calls: [
            {
              id: "provider-call-1",
              name: declaration.name,
              args: {
                query: "account activation",
              },
            },
          ],
        },
      }),
    });

    expect(executor.executeRealtimeProviderToolCall).toHaveBeenCalledWith(expect.objectContaining({
      providerCallId: "provider-call-1",
      providerFunctionName: declaration.name,
      arguments: {
        query: "account activation",
      },
    }));
    expect(result.providerMessages).toEqual([
      {
        toolResponse: {
          functionResponses: [
            {
              id: "provider-call-1",
              name: declaration.name,
              response: {
                status: "completed",
                summary: "Found one open ticket.",
                safeOutput: {
                  count: 1,
                },
              },
            },
          ],
        },
      },
    ]);
  });
});

function baseLoopInput(input: { packet?: TurnRuntimePacket | undefined } = {}) {
  return {
    organizationId: "tenant-1",
    sessionId: "session-1",
    workspaceId: "workspace-support",
    actorUserId: "user-1",
    manifest: {
      tenantId: "tenant-1",
      toolBindings: [],
    } as unknown as CompiledRuntimeManifest,
    activeRoleId: "agent-support",
    transcript: "Caller needs a ticket update.",
    packet: input.packet ?? {
      toolCalls: [],
    } as unknown as TurnRuntimePacket,
    at: "2026-06-14T09:00:00.000Z",
  };
}

function createExecutor(): Pick<RuntimeAgentToolExecutorService, "executeRealtimeProviderToolCall"> {
  return {
    executeRealtimeProviderToolCall: vi.fn(async (input) => ({
      resolvedCall: {
        providerCallId: input.providerCallId,
        toolAssignmentId: "tool-ticket-search",
        toolId: "zendesk.search_tickets",
        arguments: input.arguments ?? JSON.parse(input.argumentsJson ?? "{}") as Record<string, unknown>,
      } satisfies ResolvedRealtimeToolCall,
      packet: packetWithToolResult(input.providerCallId),
    })),
  };
}

function packetWithToolResult(providerCallId: string) {
  return {
    toolCalls: [
      {
        request: {
          type: "call_tool",
          toolCallId: providerCallId,
          toolAssignmentId: "tool-ticket-search",
          arguments: {
            query: "account activation",
          },
          reason: "Provider requested a realtime tool call.",
        },
        result: {
          toolCallId: providerCallId,
          toolAssignmentId: "tool-ticket-search",
          toolId: "zendesk.search_tickets",
          toolName: "Search tickets",
          status: "completed",
          summary: "Found one open ticket.",
          safeOutput: {
            count: 1,
          },
          durationMs: 25,
          idempotencyKey: `tool-call-${providerCallId}`,
        },
      },
    ],
  } as unknown as TurnRuntimePacket;
}
