import { Injectable } from "@nestjs/common";
import type {
  CompiledRuntimeManifest,
  ModelRoutingContext,
  SandwichTextModelProvider,
  SandwichTtsProvider,
  SandwichTtsResult,
  VoiceAgentRole,
} from "@zara/core";

export const liveSandboxTextModelProviderToken = "LIVE_SANDBOX_TEXT_MODEL_PROVIDER";
export const liveSandboxTtsProviderToken = "LIVE_SANDBOX_TTS_PROVIDER";
export const liveSandboxSttProviderToken = "LIVE_SANDBOX_STT_PROVIDER";

export interface LiveSandboxSttProvider {
  transcribeTurn(input: {
    audioFramesBase64: string[];
    sampleRateHz: number;
    onPartial?: ((event: {
      transcript: string;
      confidence: number;
      language?: string | undefined;
    }) => void) | undefined;
  }): Promise<{
    transcript: string;
    confidence: number;
    language: string;
  }>;
}

@Injectable()
export class UnavailableLiveSandboxTextModelProvider implements SandwichTextModelProvider {
  streamText(input: {
    manifest: CompiledRuntimeManifest;
    activeRole: VoiceAgentRole;
    transcript: string;
    tier: "rules" | "cheap" | "standard" | "sota";
    context: ModelRoutingContext;
  }) {
    void input;

    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(new Error("Live sandbox text model is not configured."));
          },
        } satisfies AsyncIterator<string>;
      },
    } satisfies AsyncIterable<string>;
  }
}

@Injectable()
export class UnavailableLiveSandboxTtsProvider implements SandwichTtsProvider {
  async synthesize(): Promise<SandwichTtsResult> {
    throw new Error("Live sandbox TTS is not configured.");
  }
}

@Injectable()
export class UnavailableLiveSandboxSttProvider implements LiveSandboxSttProvider {
  async transcribeTurn(): Promise<{
    transcript: string;
    confidence: number;
    language: string;
  }> {
    throw new Error("Live sandbox STT is not configured.");
  }
}
