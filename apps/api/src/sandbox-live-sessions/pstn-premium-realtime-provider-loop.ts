import type {
  PstnPremiumRealtimeProviderToolCall,
  PstnPremiumRealtimeProviderToolCallRequest,
  ToolExecutionResult,
} from "@zara/core";

import { GeminiLiveRealtimeAdapter } from "./gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "./openai-realtime.adapter";

export type PstnPremiumRealtimeProviderLoopInput =
  | {
      provider: "openai-realtime";
      adapter: OpenAiRealtimeAdapter;
      rawProviderMessage: string;
      executeToolCall(input: PstnPremiumRealtimeProviderToolCallRequest): Promise<PstnPremiumRealtimeProviderToolCall>;
    }
  | {
      provider: "gemini-live";
      adapter: GeminiLiveRealtimeAdapter;
      rawProviderMessage: string;
      executeToolCall(input: PstnPremiumRealtimeProviderToolCallRequest): Promise<PstnPremiumRealtimeProviderToolCall>;
    };

export interface PstnPremiumRealtimeProviderLoopResult {
  toolCalls: PstnPremiumRealtimeProviderToolCall[];
  providerMessages: Array<Record<string, unknown>>;
}

export async function processPstnPremiumRealtimeProviderToolMessage(
  input: PstnPremiumRealtimeProviderLoopInput,
): Promise<PstnPremiumRealtimeProviderLoopResult> {
  if (input.provider === "openai-realtime") {
    return processOpenAiProviderToolMessage(input);
  }

  return processGeminiProviderToolMessage(input);
}

async function processOpenAiProviderToolMessage(
  input: Extract<PstnPremiumRealtimeProviderLoopInput, { provider: "openai-realtime" }>,
): Promise<PstnPremiumRealtimeProviderLoopResult> {
  const providerMessages: Array<Record<string, unknown>> = [];
  const toolCalls: PstnPremiumRealtimeProviderToolCall[] = [];

  for (const event of input.adapter.parseServerMessage(input.rawProviderMessage)) {
    if (event.type !== "tool_call") {
      continue;
    }

    const toolCall = await input.executeToolCall({
      providerCallId: event.providerCallId,
      providerFunctionName: event.name,
      argumentsJson: event.argumentsJson,
    });
    toolCalls.push(toolCall);
    providerMessages.push(input.adapter.createFunctionCallOutputMessage({
      providerCallId: event.providerCallId,
      output: serializeToolResultForProvider(toolCall.result),
    }));
    providerMessages.push(input.adapter.createResponseCreateMessage());
  }

  return {
    toolCalls,
    providerMessages,
  };
}

async function processGeminiProviderToolMessage(
  input: Extract<PstnPremiumRealtimeProviderLoopInput, { provider: "gemini-live" }>,
): Promise<PstnPremiumRealtimeProviderLoopResult> {
  const providerMessages: Array<Record<string, unknown>> = [];
  const toolCalls: PstnPremiumRealtimeProviderToolCall[] = [];

  for (const event of input.adapter.parseServerMessage(input.rawProviderMessage)) {
    if (event.type !== "tool_call") {
      continue;
    }

    const toolCall = await input.executeToolCall({
      providerCallId: event.providerCallId,
      providerFunctionName: event.name,
      arguments: event.arguments,
    });
    toolCalls.push(toolCall);
    providerMessages.push(input.adapter.createToolResponseMessage({
      providerCallId: event.providerCallId,
      name: event.name,
      response: serializeToolResultForProvider(toolCall.result),
    }));
  }

  return {
    toolCalls,
    providerMessages,
  };
}

function serializeToolResultForProvider(result: ToolExecutionResult): Record<string, unknown> {
  return {
    status: result.status,
    summary: result.summary,
    ...(result.safeOutput !== undefined ? { safeOutput: result.safeOutput } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}
