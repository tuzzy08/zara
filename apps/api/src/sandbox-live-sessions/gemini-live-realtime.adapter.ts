const defaultGeminiLiveWebsocketUrl =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const defaultAudioInputMimeType = "audio/pcm;rate=16000";

export interface GeminiLiveRealtimeAdapterConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
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
    };

interface GeminiLiveServerMessage {
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
    return {
      config: {
        model: `models/${this.config.model}`,
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [
            {
              text: this.config.systemPrompt,
            },
          ],
        },
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
}
