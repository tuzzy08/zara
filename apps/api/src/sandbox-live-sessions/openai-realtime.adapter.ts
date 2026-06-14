import type { RealtimeToolDeclaration } from "@zara/core";

export interface OpenAiRealtimeAdapterConfig {
  model: string;
  systemPrompt: string;
  tools?: RealtimeToolDeclaration[] | undefined;
}

export type OpenAiRealtimeEvent = {
  type: "tool_call";
  providerCallId: string;
  name: string;
  argumentsJson: string;
};

interface OpenAiServerMessage {
  type?: string | undefined;
  call_id?: string | undefined;
  name?: string | undefined;
  arguments?: string | undefined;
  response?: {
    output?: Array<{
      type?: string | undefined;
      call_id?: string | undefined;
      name?: string | undefined;
      arguments?: string | undefined;
    }> | undefined;
  } | undefined;
}

export class OpenAiRealtimeAdapter {
  constructor(private readonly config: OpenAiRealtimeAdapterConfig) {
    if (config.model.trim().length === 0) {
      throw new Error("OpenAI Realtime model is required for realtime voice sessions.");
    }
  }

  createSessionUpdateMessage() {
    return {
      type: "session.update",
      session: {
        model: this.config.model,
        instructions: this.config.systemPrompt,
        modalities: ["audio", "text"],
        tool_choice: "auto",
        tools: (this.config.tools ?? []).map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })),
      },
    };
  }

  parseServerMessage(raw: string): OpenAiRealtimeEvent[] {
    const payload = JSON.parse(raw) as OpenAiServerMessage;
    if (payload.type === "response.function_call_arguments.done") {
      if (payload.call_id === undefined || payload.name === undefined) {
        return [];
      }

      return [
        {
          type: "tool_call",
          providerCallId: payload.call_id,
          name: payload.name,
          argumentsJson: payload.arguments ?? "{}",
        },
      ];
    }

    if (payload.type !== "response.done") {
      return [];
    }

    return (payload.response?.output ?? []).flatMap((item) => {
      if (item.type !== "function_call" || item.call_id === undefined || item.name === undefined) {
        return [];
      }

      return {
        type: "tool_call",
        providerCallId: item.call_id,
        name: item.name,
        argumentsJson: item.arguments ?? "{}",
      } satisfies OpenAiRealtimeEvent;
    });
  }

  createFunctionCallOutputMessage(input: {
    providerCallId: string;
    output: Record<string, unknown>;
  }) {
    return {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: input.providerCallId,
        output: JSON.stringify(input.output),
      },
    };
  }

  createResponseCreateMessage() {
    return {
      type: "response.create",
    };
  }
}
