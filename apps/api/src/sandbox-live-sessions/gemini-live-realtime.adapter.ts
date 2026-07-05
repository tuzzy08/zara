import { projectRealtimeProviderToolInputSchema, type RealtimeProviderToolDeclaration } from "@zara/core";

const defaultGeminiLiveWebsocketUrl =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const defaultAudioInputMimeType = "audio/pcm;rate=16000";

export interface GeminiLiveRealtimeAdapterConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  voiceName?: string | undefined;
  tools?: RealtimeProviderToolDeclaration[] | undefined;
  websocketUrl?: string | undefined;
}

export interface GeminiLiveRealtimeSessionContract {
  websocketUrl: string;
}

export type GeminiLiveRealtimeEvent =
  | {
      type: "session_ready";
    }
  | {
      type: "provider_event";
      event:
        | "setup_complete"
        | "input_transcription"
        | "output_transcription"
        | "generation_complete"
        | "turn_complete"
        | "interrupted"
        | "activity_start"
        | "activity_end"
        | "tool_call"
        | "tool_call_cancellation";
      evidence: Record<string, unknown>;
    }
  | {
      type: "audio";
      audioBase64: string;
      mimeType: string;
    }
  | {
      type: "input_transcript" | "output_transcript";
      text: string;
      done: boolean;
    }
  | {
      type: "turn_complete";
    }
  | {
      type: "tool_call";
      providerCallId: string;
      name: string;
      arguments: Record<string, unknown>;
    };

interface GeminiLiveServerMessage {
  setupComplete?: Record<string, never> | undefined;
  setup_complete?: Record<string, never> | undefined;
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
  toolCallCancellation?: {
    ids?: string[] | undefined;
  } | undefined;
  tool_call_cancellation?: {
    ids?: string[] | undefined;
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
    turnComplete?: boolean | undefined;
    generationComplete?: boolean | undefined;
    interrupted?: boolean | undefined;
    activityStart?: Record<string, never> | undefined;
    activityEnd?: Record<string, never> | undefined;
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
                parameters: projectRealtimeProviderToolInputSchema(tool.inputSchema),
              })),
            },
          ],
        }
      : {};

    return {
      setup: {
        model: `models/${this.config.model}`,
        responseModalities: ["AUDIO"],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [
            {
              text: this.config.systemPrompt,
            },
          ],
        },
        ...(this.config.voiceName !== undefined
          ? {
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: this.config.voiceName,
                  },
                },
              },
            }
          : {}),
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
    const events: GeminiLiveRealtimeEvent[] = [];

    if (payload.setupComplete !== undefined || payload.setup_complete !== undefined) {
      events.push({
        type: "session_ready",
      });
      events.push({
        type: "provider_event",
        event: "setup_complete",
        evidence: {
          hasSetupComplete: true,
        },
      });
    }

    const serverContent = payload.serverContent;

    const functionCalls = payload.toolCall?.functionCalls ?? payload.tool_call?.function_calls ?? [];
    if (functionCalls.length > 0) {
      events.push({
        type: "provider_event",
        event: "tool_call",
        evidence: {
          functionCallCount: functionCalls.length,
          functionCallIds: functionCalls.flatMap((functionCall) =>
            functionCall.id !== undefined ? [functionCall.id] : [],
          ),
          functionNames: functionCalls.flatMap((functionCall) =>
            functionCall.name !== undefined ? [functionCall.name] : [],
          ),
        },
      });
    }

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

    const canceledToolCallIds = payload.toolCallCancellation?.ids ?? payload.tool_call_cancellation?.ids ?? [];
    if (canceledToolCallIds.length > 0) {
      events.push({
        type: "provider_event",
        event: "tool_call_cancellation",
        evidence: {
          ids: canceledToolCallIds,
        },
      });
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
        done: false,
      });
      events.push({
        type: "provider_event",
        event: "input_transcription",
        evidence: {
          textLength: serverContent.inputTranscription.text.length,
        },
      });
    }

    if (serverContent.outputTranscription?.text !== undefined) {
      events.push({
        type: "output_transcript",
        text: serverContent.outputTranscription.text,
        done: false,
      });
      events.push({
        type: "provider_event",
        event: "output_transcription",
        evidence: {
          textLength: serverContent.outputTranscription.text.length,
        },
      });
    }

    if (serverContent.generationComplete === true) {
      events.push({
        type: "provider_event",
        event: "generation_complete",
        evidence: {
          generationComplete: true,
        },
      });
    }

    if (serverContent.interrupted === true) {
      events.push({
        type: "provider_event",
        event: "interrupted",
        evidence: {
          interrupted: true,
        },
      });
    }

    if (serverContent.activityStart !== undefined) {
      events.push({
        type: "provider_event",
        event: "activity_start",
        evidence: {
          hasActivityStart: true,
        },
      });
    }

    if (serverContent.activityEnd !== undefined) {
      events.push({
        type: "provider_event",
        event: "activity_end",
        evidence: {
          hasActivityEnd: true,
        },
      });
    }

    if (serverContent.turnComplete === true) {
      events.push({
        type: "turn_complete",
      });
      events.push({
        type: "provider_event",
        event: "turn_complete",
        evidence: {
          turnComplete: true,
        },
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
