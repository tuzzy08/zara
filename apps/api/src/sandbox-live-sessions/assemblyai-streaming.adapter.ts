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
  forceEndpointMessage: string;
  terminateMessage: string;
  updateConfigurationMessage(input: AssemblyAiStreamingUpdateConfiguration): string;
}

export interface AssemblyAiTranscriptEvent {
  kind: "partial" | "final";
  transcript: string;
  utterance: string;
  endOfTurn: boolean;
  endOfTurnConfidence?: number | undefined;
  confidence: number;
  languageCode?: string | undefined;
}

export type AssemblyAiAudioEncoding = "pcm_s16le" | "pcm_mulaw";

export interface AssemblyAiStreamingConfiguration {
  languageCode?: string | undefined;
  keytermsPrompt?: string[] | undefined;
  agentContext?: string | undefined;
  minTurnSilenceMs?: number | undefined;
  maxTurnSilenceMs?: number | undefined;
  continuousPartials?: boolean | undefined;
}

export type AssemblyAiStreamingUpdateConfiguration = AssemblyAiStreamingConfiguration;

interface AssemblyAiTurnMessage {
  type?: string | undefined;
  transcript?: string | undefined;
  utterance?: string | undefined;
  end_of_turn?: boolean | undefined;
  end_of_turn_confidence?: number | undefined;
  language_code?: string | undefined;
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
  } & AssemblyAiStreamingConfiguration): AssemblyAiStreamingSessionContract {
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

    if (input.languageCode !== undefined && input.languageCode.trim().length > 0) {
      url.searchParams.set("language_code", input.languageCode.trim());
    }

    const keyterms = normalizeKeyterms(input.keytermsPrompt);
    if (keyterms.length > 0) {
      url.searchParams.set("keyterms_prompt", JSON.stringify(keyterms));
    }

    const prompt = normalizeAgentContext(input.agentContext);
    if (prompt !== undefined) {
      url.searchParams.set("prompt", prompt);
    }

    return {
      websocketUrl: url.toString(),
      headers: {
        Authorization: this.config.apiKey,
      },
      keepAliveMessage: JSON.stringify({ type: "KeepAlive" }),
      forceEndpointMessage: JSON.stringify({ type: "ForceEndpoint" }),
      terminateMessage: JSON.stringify({ type: "Terminate" }),
      updateConfigurationMessage: (update) => JSON.stringify(toUpdateConfigurationPayload(update)),
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
      ...(payload.language_code !== undefined && payload.language_code.length > 0
        ? { languageCode: payload.language_code }
        : {}),
    };
  }

  mapCloseToRuntimeFailure(input: {
    code: number;
    reason?: string | undefined;
  }) {
    const normalizedReason = (input.reason ?? "").toLowerCase();

    if (input.code === 3007) {
      return withCloseDiagnostics(
        new RuntimeProviderFailure(
          "stt",
          "rate_limited",
          "AssemblyAI streaming session rejected audio chunks. Send 50-1000ms chunks at realtime pace.",
        ),
        input,
      );
    }

    if (input.code === 3008) {
      return withCloseDiagnostics(
        new RuntimeProviderFailure("stt", "timeout", "AssemblyAI streaming session expired before termination."),
        input,
      );
    }

    if (
      input.code === 3001
      || input.code === 3002
      || normalizedReason.includes("auth")
      || normalizedReason.includes("not authorized")
      || normalizedReason.includes("unauthorized")
    ) {
      return withCloseDiagnostics(
        new RuntimeProviderFailure("stt", "permission_denied", "AssemblyAI streaming authorization failed."),
        input,
      );
    }

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

function toUpdateConfigurationPayload(input: AssemblyAiStreamingUpdateConfiguration) {
  const payload: Record<string, unknown> = {
    type: "UpdateConfiguration",
  };
  const keyterms = normalizeKeyterms(input.keytermsPrompt);
  const agentContext = normalizeAgentContext(input.agentContext);

  if (keyterms.length > 0) {
    payload.keyterms_prompt = keyterms;
  }

  if (input.minTurnSilenceMs !== undefined) {
    payload.min_turn_silence = input.minTurnSilenceMs;
  }

  if (input.maxTurnSilenceMs !== undefined) {
    payload.max_turn_silence = input.maxTurnSilenceMs;
  }

  if (input.continuousPartials !== undefined) {
    payload.continuous_partials = input.continuousPartials;
  }

  if (agentContext !== undefined) {
    payload.agent_context = agentContext;
  }

  return payload;
}

function normalizeKeyterms(keyterms: string[] | undefined) {
  if (keyterms === undefined) {
    return [];
  }

  return [...new Set(
    keyterms
      .map((term) => term.trim())
      .filter((term) => term.length > 0)
      .slice(0, 50),
  )];
}

function normalizeAgentContext(agentContext: string | undefined) {
  const normalized = agentContext?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  return normalized.slice(0, 1500);
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
