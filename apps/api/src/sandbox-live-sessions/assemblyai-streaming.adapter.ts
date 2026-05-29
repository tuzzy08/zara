import { RuntimeProviderFailure } from "@zara/core";

const defaultAssemblyAiUrl = "wss://streaming.assemblyai.com/v3/ws";

export interface AssemblyAiStreamingAdapterConfig {
  apiKey: string;
  websocketUrl?: string | undefined;
}

export interface AssemblyAiStreamingSessionContract {
  websocketUrl: string;
  headers: {
    Authorization: string;
  };
  keepAliveMessage: string;
  terminateMessage: string;
}

export interface AssemblyAiTranscriptEvent {
  kind: "partial" | "final";
  transcript: string;
  utterance: string;
  endOfTurn: boolean;
  endOfTurnConfidence?: number | undefined;
  confidence: number;
}

export type AssemblyAiAudioEncoding = "pcm_s16le" | "pcm_mulaw";

interface AssemblyAiTurnMessage {
  type?: string | undefined;
  transcript?: string | undefined;
  utterance?: string | undefined;
  end_of_turn?: boolean | undefined;
  end_of_turn_confidence?: number | undefined;
  words?: Array<{
    confidence?: number | undefined;
  }> | undefined;
}

export class AssemblyAiStreamingAdapter {
  constructor(private readonly config: AssemblyAiStreamingAdapterConfig) {
    if (this.config.apiKey.trim().length === 0) {
      throw new Error("AssemblyAI API key is required for live sandbox STT.");
    }
  }

  createSession(input: {
    sampleRateHz: number;
    encoding?: AssemblyAiAudioEncoding | undefined;
    speechModel?: string | undefined;
    minTurnSilenceMs?: number | undefined;
    maxTurnSilenceMs?: number | undefined;
    continuousPartials?: boolean | undefined;
  }): AssemblyAiStreamingSessionContract {
    if (input.sampleRateHz <= 0) {
      throw new Error("AssemblyAI sample rate must be greater than zero.");
    }

    const url = new URL(this.config.websocketUrl ?? defaultAssemblyAiUrl);
    url.searchParams.set("sample_rate", String(input.sampleRateHz));
    url.searchParams.set("speech_model", input.speechModel ?? "u3-rt-pro");
    url.searchParams.set("encoding", input.encoding ?? "pcm_s16le");

    if (input.minTurnSilenceMs !== undefined) {
      url.searchParams.set("min_turn_silence", String(input.minTurnSilenceMs));
    }

    if (input.maxTurnSilenceMs !== undefined) {
      url.searchParams.set("max_turn_silence", String(input.maxTurnSilenceMs));
    }

    if (input.continuousPartials !== undefined) {
      url.searchParams.set("continuous_partials", String(input.continuousPartials));
    }

    return {
      websocketUrl: url.toString(),
      headers: {
        Authorization: this.config.apiKey,
      },
      keepAliveMessage: JSON.stringify({ type: "KeepAlive" }),
      terminateMessage: JSON.stringify({ type: "Terminate" }),
    };
  }

  parseMessage(raw: string): AssemblyAiTranscriptEvent | null {
    const payload = JSON.parse(raw) as AssemblyAiTurnMessage;

    if (payload.type !== "Turn" || payload.transcript === undefined || payload.transcript.trim().length === 0) {
      return null;
    }

    return {
      kind: payload.end_of_turn === true ? "final" : "partial",
      transcript: payload.transcript,
      utterance: payload.utterance ?? "",
      endOfTurn: payload.end_of_turn === true,
      ...(payload.end_of_turn_confidence !== undefined
        ? { endOfTurnConfidence: payload.end_of_turn_confidence }
        : {}),
      confidence: deriveConfidence(payload.words),
    };
  }

  mapCloseToRuntimeFailure(input: {
    code: number;
    reason?: string | undefined;
  }) {
    const normalizedReason = (input.reason ?? "").toLowerCase();

    if (input.code === 4008 || normalizedReason.includes("timeout") || normalizedReason.includes("inactivity")) {
      return withCloseDiagnostics(
        new RuntimeProviderFailure("stt", "timeout", "AssemblyAI streaming session timed out."),
        input,
      );
    }

    if (input.code === 1000 || normalizedReason.includes("cancel") || normalizedReason.includes("closed")) {
      return withCloseDiagnostics(
        new RuntimeProviderFailure("stt", "interrupted", "AssemblyAI streaming session was interrupted."),
        input,
      );
    }

    const reason = input.reason?.trim();
    return withCloseDiagnostics(
      new RuntimeProviderFailure(
        "stt",
        "failed",
        reason === undefined || reason.length === 0
          ? `AssemblyAI streaming session failed with close code ${input.code}.`
          : `AssemblyAI streaming session failed with close code ${input.code}: ${reason}.`,
      ),
      input,
    );
  }
}

function withCloseDiagnostics<TFailure extends RuntimeProviderFailure>(
  failure: TFailure,
  input: {
    code: number;
    reason?: string | undefined;
  },
) {
  return Object.assign(failure, {
    closeCode: input.code,
    ...(input.reason !== undefined && input.reason.length > 0 ? { closeReason: input.reason } : {}),
  });
}

function deriveConfidence(words: AssemblyAiTurnMessage["words"]) {
  if (words === undefined || words.length === 0) {
    return 0;
  }

  const confidences = words
    .map((word) => word.confidence)
    .filter((confidence): confidence is number => typeof confidence === "number");

  if (confidences.length === 0) {
    return 0;
  }

  return confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length;
}
