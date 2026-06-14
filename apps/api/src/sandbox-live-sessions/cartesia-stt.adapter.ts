import { RuntimeProviderFailure } from "@zara/core";

const defaultCartesiaSttWebsocketUrl = "wss://api.cartesia.ai/stt/turns/websocket";
const defaultCartesiaSttModelId = "ink-2";

export type CartesiaSttAudioEncoding =
  | "pcm_s16le"
  | "pcm_s32le"
  | "pcm_f16le"
  | "pcm_f32le"
  | "pcm_mulaw"
  | "pcm_alaw";

export interface CartesiaSttAdapterConfig {
  apiKey: string;
  apiVersion: string;
  websocketUrl?: string | undefined;
  modelId?: string | undefined;
}

export interface CartesiaSttSessionContract {
  websocketUrl: string;
  headers: Record<string, string>;
  closeMessage: string;
}

export type CartesiaSttTurnEvent =
  | {
      kind: "telemetry";
      event: "turn.start" | "turn.eager_end" | "turn.resume";
      transcript?: string | undefined;
      requestId?: string | undefined;
    }
  | {
      kind: "partial";
      event: "turn.update";
      transcript: string;
      requestId?: string | undefined;
    }
  | {
      kind: "final";
      event: "turn.end";
      transcript: string;
      requestId?: string | undefined;
    }
  | RuntimeProviderFailure;

interface CartesiaSttWireMessage {
  type?: string | undefined;
  transcript?: string | undefined;
  request_id?: string | undefined;
  title?: string | undefined;
  message?: string | undefined;
  error_code?: string | undefined;
}

export class CartesiaSttAdapter {
  constructor(private readonly config: CartesiaSttAdapterConfig) {
    if (this.config.apiKey.trim().length === 0) {
      throw new Error("Cartesia API key is required for Ink 2 STT.");
    }

    if (this.config.apiVersion.trim().length === 0) {
      throw new Error("Cartesia API version is required for Ink 2 STT.");
    }
  }

  createSession(input: {
    sampleRateHz: number;
    encoding?: CartesiaSttAudioEncoding | undefined;
    languageCode?: string | undefined;
  }): CartesiaSttSessionContract {
    if (input.sampleRateHz <= 0) {
      throw new Error("Cartesia STT sample rate must be greater than zero.");
    }

    this.assertSupportedLanguage(input.languageCode ?? "en");

    const url = new URL(this.config.websocketUrl ?? defaultCartesiaSttWebsocketUrl);
    url.searchParams.set("model", this.config.modelId ?? defaultCartesiaSttModelId);
    url.searchParams.set("encoding", input.encoding ?? "pcm_s16le");
    url.searchParams.set("sample_rate", String(input.sampleRateHz));
    url.searchParams.set("cartesia_version", this.config.apiVersion);

    return {
      websocketUrl: url.toString(),
      headers: {
        "X-API-Key": this.config.apiKey,
      },
      closeMessage: JSON.stringify({ type: "close" }),
    };
  }

  assertSupportedLanguage(languageCode: string) {
    if (languageCode !== "en") {
      throw new Error("Cartesia Ink 2 STT is English-only.");
    }
  }

  parseMessage(raw: string): CartesiaSttTurnEvent | null {
    const payload = JSON.parse(raw) as CartesiaSttWireMessage;
    const requestId = payload.request_id;

    switch (payload.type) {
      case "connected":
        return null;
      case "turn.start":
        return {
          kind: "telemetry",
          event: "turn.start",
          ...(requestId !== undefined ? { requestId } : {}),
        };
      case "turn.update":
        if (payload.transcript === undefined) {
          return null;
        }

        return {
          kind: "partial",
          event: "turn.update",
          transcript: payload.transcript,
          ...(requestId !== undefined ? { requestId } : {}),
        };
      case "turn.eager_end":
        return {
          kind: "telemetry",
          event: "turn.eager_end",
          ...(payload.transcript !== undefined ? { transcript: payload.transcript } : {}),
          ...(requestId !== undefined ? { requestId } : {}),
        };
      case "turn.resume":
        return {
          kind: "telemetry",
          event: "turn.resume",
          ...(requestId !== undefined ? { requestId } : {}),
        };
      case "turn.end":
        if (payload.transcript === undefined) {
          return null;
        }

        return {
          kind: "final",
          event: "turn.end",
          transcript: payload.transcript,
          ...(requestId !== undefined ? { requestId } : {}),
        };
      case "error":
        return new RuntimeProviderFailure(
          "stt",
          "failed",
          payload.message ?? payload.title ?? "Cartesia Ink 2 STT websocket failed.",
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

    if (input.code === 1013 || normalizedReason.includes("timeout") || normalizedReason.includes("try again later")) {
      return new RuntimeProviderFailure("stt", "timeout", "Cartesia Ink 2 STT session timed out.");
    }

    if (input.code === 1000 || normalizedReason.includes("cancel") || normalizedReason.includes("closed")) {
      return new RuntimeProviderFailure("stt", "interrupted", "Cartesia Ink 2 STT session was interrupted.");
    }

    return new RuntimeProviderFailure(
      "stt",
      "failed",
      `Cartesia Ink 2 STT session failed with close code ${input.code}.`,
    );
  }
}
