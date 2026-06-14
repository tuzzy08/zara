import { Inject, Injectable } from "@nestjs/common";
import type {
  CompiledRuntimeManifest,
  RealtimeToolDeclaration,
  ToolExecutionResult,
  TurnRuntimePacket,
} from "@zara/core";

import { GeminiLiveRealtimeAdapter } from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "../sandbox-live-sessions/openai-realtime.adapter";
import { RuntimeAgentToolExecutorService } from "../sandbox-live-sessions/runtime-agent-tool-executor.service";

export interface PremiumRealtimeToolLoopInput {
  organizationId: string;
  sessionId: string;
  workspaceId: string;
  actorUserId: string;
  manifest: CompiledRuntimeManifest;
  activeRoleId: string;
  transcript: string;
  packet: TurnRuntimePacket;
  declarations: RealtimeToolDeclaration[];
  rawProviderMessage: string;
  at: string;
}

export interface PremiumRealtimeToolLoopResult {
  packet: TurnRuntimePacket;
  providerMessages: Array<Record<string, unknown>>;
}

@Injectable()
export class PremiumRealtimeToolLoopService {
  constructor(
    @Inject(RuntimeAgentToolExecutorService)
    private readonly runtimeAgentToolExecutor: Pick<
      RuntimeAgentToolExecutorService,
      "executeRealtimeProviderToolCall"
    >,
  ) {}

  async processOpenAiProviderMessage(
    input: PremiumRealtimeToolLoopInput & { adapter: OpenAiRealtimeAdapter },
  ): Promise<PremiumRealtimeToolLoopResult> {
    let packet = input.packet;
    const providerMessages: Array<Record<string, unknown>> = [];

    for (const event of input.adapter.parseServerMessage(input.rawProviderMessage)) {
      if (event.type !== "tool_call") {
        continue;
      }

      const executed = await this.runtimeAgentToolExecutor.executeRealtimeProviderToolCall({
        ...input,
        packet,
        providerCallId: event.providerCallId,
        providerFunctionName: event.name,
        argumentsJson: event.argumentsJson,
      });
      packet = executed.packet;
      providerMessages.push(input.adapter.createFunctionCallOutputMessage({
        providerCallId: event.providerCallId,
        output: buildProviderToolOutput(packet, event.providerCallId),
      }));
      providerMessages.push(input.adapter.createResponseCreateMessage());
    }

    return {
      packet,
      providerMessages,
    };
  }

  async processGeminiProviderMessage(
    input: PremiumRealtimeToolLoopInput & { adapter: GeminiLiveRealtimeAdapter },
  ): Promise<PremiumRealtimeToolLoopResult> {
    let packet = input.packet;
    const providerMessages: Array<Record<string, unknown>> = [];

    for (const event of input.adapter.parseServerMessage(input.rawProviderMessage)) {
      if (event.type !== "tool_call") {
        continue;
      }

      const executed = await this.runtimeAgentToolExecutor.executeRealtimeProviderToolCall({
        ...input,
        packet,
        providerCallId: event.providerCallId,
        providerFunctionName: event.name,
        arguments: event.arguments,
      });
      packet = executed.packet;
      providerMessages.push(input.adapter.createToolResponseMessage({
        providerCallId: event.providerCallId,
        name: event.name,
        response: buildProviderToolOutput(packet, event.providerCallId),
      }));
    }

    return {
      packet,
      providerMessages,
    };
  }
}

function buildProviderToolOutput(
  packet: TurnRuntimePacket,
  providerCallId: string,
): Record<string, unknown> {
  const result = packet.toolCalls.find((toolCall) => toolCall.request.toolCallId === providerCallId)?.result;

  if (result === undefined) {
    return {
      status: "failed",
      summary: "Tool execution did not produce a result.",
      error: {
        code: "tool_result.missing",
        message: "The requested tool did not produce a result.",
        recoverable: true,
      },
    };
  }

  return serializeToolResultForProvider(result);
}

function serializeToolResultForProvider(result: ToolExecutionResult): Record<string, unknown> {
  return {
    status: result.status,
    summary: result.summary,
    ...(result.safeOutput !== undefined ? { safeOutput: result.safeOutput } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}
