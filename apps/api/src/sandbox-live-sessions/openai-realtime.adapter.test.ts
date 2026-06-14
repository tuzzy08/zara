import { describe, expect, it } from "vitest";

import type { RealtimeToolDeclaration } from "@zara/core";
import { OpenAiRealtimeAdapter } from "./openai-realtime.adapter";

describe("OpenAiRealtimeAdapter", () => {
  const tool = {
    name: "zara_zendesk_search_tickets_1234abcd",
    toolAssignmentId: "assignment-1",
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
  } satisfies RealtimeToolDeclaration;

  it("declares Zara tools in the OpenAI Realtime session update", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      tools: [tool],
    });

    expect(adapter.createSessionUpdateMessage()).toEqual({
      type: "session.update",
      session: {
        model: "gpt-realtime",
        instructions: "Configured prompt",
        modalities: ["audio", "text"],
        tool_choice: "auto",
        tools: [
          {
            type: "function",
            name: "zara_zendesk_search_tickets_1234abcd",
            description: "Search tickets\nRisk: low.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        ],
      },
    });
  });

  it("parses provider function calls and builds output plus continuation messages", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      tools: [tool],
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "openai-call-1",
      name: "zara_zendesk_search_tickets_1234abcd",
      arguments: "{\"query\":\"account activation\"}",
    }))).toEqual([
      {
        type: "tool_call",
        providerCallId: "openai-call-1",
        name: "zara_zendesk_search_tickets_1234abcd",
        argumentsJson: "{\"query\":\"account activation\"}",
      },
    ]);

    expect(adapter.createFunctionCallOutputMessage({
      providerCallId: "openai-call-1",
      output: {
        status: "completed",
        safeOutput: { count: 1 },
      },
    })).toEqual({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "openai-call-1",
        output: JSON.stringify({
          status: "completed",
          safeOutput: { count: 1 },
        }),
      },
    });
    expect(adapter.createResponseCreateMessage()).toEqual({
      type: "response.create",
    });
  });

  it("parses docs-style response.done function call output items", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
      tools: [tool],
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            call_id: "openai-call-2",
            name: "zara_zendesk_search_tickets_1234abcd",
            arguments: "{\"query\":\"billing\"}",
          },
        ],
      },
    }))).toEqual([
      {
        type: "tool_call",
        providerCallId: "openai-call-2",
        name: "zara_zendesk_search_tickets_1234abcd",
        argumentsJson: "{\"query\":\"billing\"}",
      },
    ]);
  });
});
