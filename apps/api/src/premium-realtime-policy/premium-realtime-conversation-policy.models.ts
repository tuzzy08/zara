import type { RealtimeProviderId } from "@zara/core";

export type PremiumRealtimeMediaProfile = "browser" | "pstn";
export type OpenAiRealtimeSemanticVadEagerness = "low" | "medium" | "high" | "auto";

export type OpenAiRealtimeTurnDetectionPolicy =
  | {
      type: "semantic_vad";
      eagerness: OpenAiRealtimeSemanticVadEagerness;
      createResponse: boolean;
      interruptResponse: boolean;
    }
  | {
      type: "server_vad";
      threshold: number;
      prefixPaddingMs: number;
      silenceDurationMs: number;
      createResponse: boolean;
      interruptResponse: boolean;
    };

export interface PremiumRealtimeOpenAiChannelPolicy {
  media: {
    input: { type: "audio/pcm"; rate: 24_000 } | { type: "audio/pcmu" };
    output: { type: "audio/pcm"; rate: 24_000 } | { type: "audio/pcmu" };
  };
  turnDetection: OpenAiRealtimeTurnDetectionPolicy;
}

export interface PremiumRealtimeGeminiChannelPolicy {
  media: {
    input: { mimeType: "audio/pcm;rate=16000" };
    output: { mimeType: "audio/pcm;rate=24000" };
  };
  activityHandling: { type: "provider_native" };
}

export interface PremiumRealtimeConversationPolicy {
  schemaVersion: 1;
  version: number;
  defaultProvider: RealtimeProviderId;
  providers: {
    openaiRealtime: {
      defaultModel: string;
      channels: Record<PremiumRealtimeMediaProfile, PremiumRealtimeOpenAiChannelPolicy>;
    };
    geminiLive: {
      defaultModel: string;
      channels: Record<PremiumRealtimeMediaProfile, PremiumRealtimeGeminiChannelPolicy>;
    };
  };
  updatedBy: string;
  updatedAt: string;
}

export interface UpdatePremiumRealtimeConversationPolicyInput {
  expectedVersion: number;
  reason: string;
  defaultProvider?: RealtimeProviderId | undefined;
  providers?: {
    openaiRealtime?: {
      defaultModel?: string | undefined;
      channels?: Partial<Record<PremiumRealtimeMediaProfile, {
        turnDetection?: OpenAiRealtimeTurnDetectionPolicy | undefined;
      }>> | undefined;
    } | undefined;
    geminiLive?: {
      defaultModel?: string | undefined;
    } | undefined;
  } | undefined;
}

const openAiPcmMedia = {
  input: { type: "audio/pcm" as const, rate: 24_000 as const },
  output: { type: "audio/pcm" as const, rate: 24_000 as const },
};

const openAiPcmuMedia = {
  input: { type: "audio/pcmu" as const },
  output: { type: "audio/pcmu" as const },
};

const geminiMedia = {
  input: { mimeType: "audio/pcm;rate=16000" as const },
  output: { mimeType: "audio/pcm;rate=24000" as const },
};

export const defaultPremiumRealtimeConversationPolicy: PremiumRealtimeConversationPolicy = {
  schemaVersion: 1,
  version: 1,
  defaultProvider: "openai-realtime",
  providers: {
    openaiRealtime: {
      defaultModel: "gpt-realtime-2.1",
      channels: {
        browser: {
          media: openAiPcmMedia,
          turnDetection: {
            type: "semantic_vad",
            eagerness: "auto",
            createResponse: true,
            interruptResponse: true,
          },
        },
        pstn: {
          media: openAiPcmuMedia,
          turnDetection: {
            type: "semantic_vad",
            eagerness: "low",
            createResponse: true,
            interruptResponse: true,
          },
        },
      },
    },
    geminiLive: {
      defaultModel: "gemini-3.1-flash-live-preview",
      channels: {
        browser: {
          media: geminiMedia,
          activityHandling: { type: "provider_native" },
        },
        pstn: {
          media: geminiMedia,
          activityHandling: { type: "provider_native" },
        },
      },
    },
  },
  updatedBy: "system",
  updatedAt: "2026-07-15T00:00:00.000Z",
};
