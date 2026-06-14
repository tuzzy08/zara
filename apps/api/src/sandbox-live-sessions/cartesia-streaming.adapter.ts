import { RuntimeProviderFailure } from "@zara/core";

const defaultCartesiaWebsocketUrl = "wss://api.cartesia.ai/tts/websocket";
const defaultModelId = "sonic-3.5";

export interface CartesiaStreamingAdapterConfig {
  apiKey: string;
  apiVersion: string;
  websocketUrl?: string | undefined;
  modelId?: string | undefined;
}

export interface CartesiaStreamingSessionContract {
  websocketUrl: string;
  headers: {
    "X-API-Key": string;
  };
}

export interface CartesiaGenerationRequest {
  model_id: string;
  transcript: string;
  voice: {
    mode: "id";
    id: string;
  };
  language: string;
  generation_config?: CartesiaGenerationConfig | undefined;
  context_id: string;
  output_format: {
    container: "raw";
    encoding: CartesiaRawAudioEncoding;
    sample_rate: number;
  };
  add_timestamps: true;
  continue: boolean;
}

export interface CartesiaGenerationConfig {
  speed?: number | undefined;
  volume?: number | undefined;
  emotion?: string | undefined;
}

export type CartesiaRawAudioEncoding = "pcm_s16le" | "pcm_mulaw" | "pcm_alaw";

export type CartesiaStreamMessage =
  | {
      kind: "chunk";
      contextId: string;
      audioBase64: string;
      stepTimeMs: number;
      done: boolean;
    }
  | {
      kind: "timestamps";
      contextId: string;
      words: string[];
      start: number[];
      end: number[];
      done: boolean;
    }
  | {
      kind: "done";
      contextId: string;
      done: true;
    }
  | RuntimeProviderFailure;

interface CartesiaChunkMessage {
  type?: string | undefined;
  data?: string | undefined;
  done?: boolean | undefined;
  step_time?: number | undefined;
  context_id?: string | undefined;
  word_timestamps?: {
    words?: string[] | undefined;
    start?: number[] | undefined;
    end?: number[] | undefined;
  } | undefined;
  title?: string | undefined;
  message?: string | undefined;
  error_code?: string | undefined;
}

export class CartesiaStreamingAdapter {
  constructor(private readonly config: CartesiaStreamingAdapterConfig) {
    if (this.config.apiKey.trim().length === 0) {
      throw new Error("Cartesia API key is required for live sandbox TTS.");
    }

    if (this.config.apiVersion.trim().length === 0) {
      throw new Error("Cartesia API version is required for live sandbox TTS.");
    }
  }

  createSession(): CartesiaStreamingSessionContract {
    const url = new URL(this.config.websocketUrl ?? defaultCartesiaWebsocketUrl);
    url.searchParams.set("cartesia_version", this.config.apiVersion);

    return {
      websocketUrl: url.toString(),
      headers: {
        "X-API-Key": this.config.apiKey,
      },
    };
  }

  createGenerationRequest(input: {
    transcript: string;
    contextId: string;
    voiceId: string;
    language: string;
    sampleRateHz?: number | undefined;
    outputFormat?: {
      encoding: CartesiaRawAudioEncoding;
      sampleRateHz: number;
    } | undefined;
    generationConfig?: CartesiaGenerationConfig | undefined;
    continueGeneration?: boolean | undefined;
  }): CartesiaGenerationRequest {
    const outputFormat = input.outputFormat ?? {
      encoding: "pcm_s16le" as const,
      sampleRateHz: input.sampleRateHz,
    };
    if (outputFormat.sampleRateHz === undefined || outputFormat.sampleRateHz <= 0) {
      throw new Error("Cartesia sample rate must be greater than zero.");
    }

    return {
      model_id: this.config.modelId ?? defaultModelId,
      transcript: input.transcript,
      voice: {
        mode: "id",
        id: input.voiceId,
      },
      language: input.language,
      ...(input.generationConfig !== undefined
        ? { generation_config: normalizeGenerationConfig(input.generationConfig) }
        : {}),
      context_id: input.contextId,
      output_format: {
        container: "raw",
        encoding: outputFormat.encoding,
        sample_rate: outputFormat.sampleRateHz,
      },
      add_timestamps: true,
      continue: input.continueGeneration === true,
    };
  }

  parseMessage(raw: string): CartesiaStreamMessage | null {
    const payload = JSON.parse(raw) as CartesiaChunkMessage;

    switch (payload.type) {
      case "chunk":
        if (payload.data === undefined || payload.context_id === undefined) {
          return null;
        }

        return {
          kind: "chunk",
          contextId: payload.context_id,
          audioBase64: payload.data,
          stepTimeMs: payload.step_time ?? 0,
          done: payload.done === true,
        };
      case "timestamps":
        if (payload.context_id === undefined || payload.word_timestamps === undefined) {
          return null;
        }

        return {
          kind: "timestamps",
          contextId: payload.context_id,
          words: payload.word_timestamps.words ?? [],
          start: payload.word_timestamps.start ?? [],
          end: payload.word_timestamps.end ?? [],
          done: payload.done === true,
        };
      case "done":
        if (payload.context_id === undefined) {
          return null;
        }

        return {
          kind: "done",
          contextId: payload.context_id,
          done: true,
        };
      case "error":
        return new RuntimeProviderFailure(
          "tts",
          "failed",
          payload.message ?? payload.title ?? "Cartesia websocket generation failed.",
        );
      default:
        return null;
    }
  }

  mapCloseToRuntimeFailure(input: {
    code: number;
    reason?: string | undefined;
  }) {
    const normalizedReason = (input.reason ?? "").toLowerCase();

    if (input.code === 1013 || normalizedReason.includes("try again later") || normalizedReason.includes("timeout")) {
      return new RuntimeProviderFailure("tts", "timeout", "Cartesia streaming session timed out.");
    }

    if (input.code === 1000 || normalizedReason.includes("cancel") || normalizedReason.includes("closed")) {
      return new RuntimeProviderFailure("tts", "interrupted", "Cartesia streaming session was interrupted.");
    }

    return new RuntimeProviderFailure(
      "tts",
      "failed",
      `Cartesia streaming session failed with close code ${input.code}.`,
    );
  }
}

function normalizeGenerationConfig(config: CartesiaGenerationConfig): CartesiaGenerationConfig {
  return {
    ...(config.speed !== undefined ? { speed: config.speed } : {}),
    ...(config.volume !== undefined ? { volume: config.volume } : {}),
    ...(config.emotion !== undefined ? { emotion: config.emotion } : {}),
  };
}
