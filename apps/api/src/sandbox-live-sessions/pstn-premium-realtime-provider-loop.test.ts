import { describe, expect, it, vi } from "vitest";

import type {
  PstnPremiumRealtimeProviderToolCall,
  RealtimeToolDeclaration,
} from "@zara/core";

import { GeminiLiveRealtimeAdapter } from "./gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "./openai-realtime.adapter";
import { processPstnPremiumRealtimeProviderToolMessage } from "./pstn-premium-realtime-provider-loop";

describe("PSTN premium realtime provider tool loop", () => {
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

  it("executes OpenAI native function calls through the PSTN executeToolCall callback", async () => {
    const executeToolCall = vi.fn(async () => completedToolCall("openai-call-1"));
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
      tools: [declaration],
    });

    const result = await processPstnPremiumRealtimeProviderToolMessage({
      provider: "openai-realtime",
      adapter,
      rawProviderMessage: JSON.stringify({
        type: "response.function_call_arguments.done",
        call_id: "openai-call-1",
        name: declaration.name,
        arguments: "{\"query\":\"account activation\"}",
      }),
      executeToolCall,
    });

    expect(executeToolCall).toHaveBeenCalledWith({
      providerCallId: "openai-call-1",
      providerFunctionName: declaration.name,
      argumentsJson: "{\"query\":\"account activation\"}",
    });
    expect(result.toolCalls).toEqual([completedToolCall("openai-call-1")]);
    expect(result.providerMessages).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "openai-call-1",
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
        type: "response.create",
      },
    ]);
  });

  it("executes Gemini native function calls through the PSTN executeToolCall callback", async () => {
    const executeToolCall = vi.fn(async () => completedToolCall("gemini-call-1"));
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
      tools: [declaration],
    });

    const result = await processPstnPremiumRealtimeProviderToolMessage({
      provider: "gemini-live",
      adapter,
      rawProviderMessage: JSON.stringify({
        tool_call: {
          function_calls: [
            {
              id: "gemini-call-1",
              name: declaration.name,
              args: {
                query: "account activation",
              },
            },
          ],
        },
      }),
      executeToolCall,
    });

    expect(executeToolCall).toHaveBeenCalledWith({
      providerCallId: "gemini-call-1",
      providerFunctionName: declaration.name,
      arguments: {
        query: "account activation",
      },
    });
    expect(result.toolCalls).toEqual([completedToolCall("gemini-call-1")]);
    expect(result.providerMessages).toEqual([
      {
        toolResponse: {
          functionResponses: [
            {
              id: "gemini-call-1",
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

function completedToolCall(providerCallId: string): PstnPremiumRealtimeProviderToolCall {
  return {
    nodeId: "tool-ticket-search",
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
      durationMs: 24,
      idempotencyKey: `tool-call-${providerCallId}`,
    },
  };
}
