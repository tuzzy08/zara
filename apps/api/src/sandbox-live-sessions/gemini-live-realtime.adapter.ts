import type { RealtimeToolDeclaration } from "@zara/core";

const defaultGeminiLiveWebsocketUrl =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const defaultAudioInputMimeType = "audio/pcm;rate=16000";

export interface GeminiLiveRealtimeAdapterConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  tools?: RealtimeToolDeclaration[] | undefined;
  websocketUrl?: string | undefined;
}

export interface GeminiLiveRealtimeSessionContract {
  websocketUrl: string;
}

export type GeminiLiveRealtimeEvent =
  | {
      type: "audio";
      audioBase64: string;
      mimeType: string;
    }
  | {
      type: "input_transcript" | "output_transcript";
      text: string;
    }
  | {
      type: "tool_call";
      providerCallId: string;
      name: string;
      arguments: Record<string, unknown>;
    };

interface GeminiLiveServerMessage {
  toolCall?: {
    functionCalls?: Array<{
      id?: string | undefined;
      name?: string | undefined;
      args?: Record<string, unknown> | undefined;
    }> | undefined;
  } | undefined;
  tool_call?: {
    function_calls?: Array<{
      id?: string | undefined;
      name?: string | undefined;
      args?: Record<string, unknown> | undefined;
    }> | undefined;
  } | undefined;
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        inlineData?: {
          data?: string | undefined;
          mimeType?: string | undefined;
        } | undefined;
      }> | undefined;
    } | undefined;
    inputTranscription?: {
      text?: string | undefined;
    } | undefined;
    outputTranscription?: {
      text?: string | undefined;
    } | undefined;
  } | undefined;
}

export class GeminiLiveRealtimeAdapter {
  constructor(private readonly config: GeminiLiveRealtimeAdapterConfig) {
    if (config.apiKey.trim().length === 0) {
      throw new Error("Gemini Live API key is required for realtime voice sessions.");
    }

    if (config.model.trim().length === 0) {
      throw new Error("Gemini Live model is required for realtime voice sessions.");
    }
  }

  createSession(): GeminiLiveRealtimeSessionContract {
    const url = new URL(this.config.websocketUrl ?? defaultGeminiLiveWebsocketUrl);
    url.searchParams.set("key", this.config.apiKey);

    return {
      websocketUrl: url.toString(),
    };
  }

  createSetupMessage() {
    const tools = this.config.tools?.length
      ? {
          tools: [
            {
              functionDeclarations: this.config.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              })),
            },
          ],
        }
      : {};

    return {
      setup: {
        model: `models/${this.config.model}`,
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [
            {
              text: this.config.systemPrompt,
            },
          ],
        },
        ...tools,
      },
    };
  }

  createTextInputMessage(text: string) {
    return {
      realtimeInput: {
        text,
      },
    };
  }

  createAudioInputMessage(audioBase64: string) {
    return {
      realtimeInput: {
        audio: {
          data: audioBase64,
          mimeType: defaultAudioInputMimeType,
        },
      },
    };
  }

  parseServerMessage(raw: string): GeminiLiveRealtimeEvent[] {
    const payload = JSON.parse(raw) as GeminiLiveServerMessage;
    const serverContent = payload.serverContent;
    const events: GeminiLiveRealtimeEvent[] = [];

    const functionCalls = payload.toolCall?.functionCalls ?? payload.tool_call?.function_calls ?? [];
    for (const functionCall of functionCalls) {
      if (functionCall.id !== undefined && functionCall.name !== undefined) {
        events.push({
          type: "tool_call",
          providerCallId: functionCall.id,
          name: functionCall.name,
          arguments: functionCall.args ?? {},
        });
      }
    }

    if (serverContent === undefined) {
      return events;
    }

    for (const part of serverContent.modelTurn?.parts ?? []) {
      const inlineData = part.inlineData;

      if (inlineData?.data !== undefined) {
        events.push({
          type: "audio",
          audioBase64: inlineData.data,
          mimeType: inlineData.mimeType ?? "audio/pcm;rate=24000",
        });
      }
    }

    if (serverContent.inputTranscription?.text !== undefined) {
      events.push({
        type: "input_transcript",
        text: serverContent.inputTranscription.text,
      });
    }

    if (serverContent.outputTranscription?.text !== undefined) {
      events.push({
        type: "output_transcript",
        text: serverContent.outputTranscription.text,
      });
    }

    return events;
  }

  createToolResponseMessage(input: {
    providerCallId: string;
    name: string;
    response: Record<string, unknown>;
  }) {
    return {
      toolResponse: {
        functionResponses: [
          {
            id: input.providerCallId,
            name: input.name,
            response: input.response,
          },
        ],
      },
    };
  }
}
