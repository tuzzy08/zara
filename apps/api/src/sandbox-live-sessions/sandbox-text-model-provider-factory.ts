import type { SandwichTextModelProvider } from "@zara/core";
import type { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";

import { GeminiChatTextProvider } from "./gemini-chat-text.provider";
import { OpenAiChatTextProvider } from "./openai-chat-text.provider";
import type { resolveLiveSandboxProviderConfig } from "./sandbox-live-env";
import {
  UnavailableLiveSandboxTextModelProvider,
} from "./sandbox-live-sessions.providers";
import { SandboxTextModelRouterProvider } from "./sandbox-text-model-router.provider";

type LiveSandboxProviderConfig = ReturnType<typeof resolveLiveSandboxProviderConfig>;

export function createLiveSandboxTextModelProvider(
  config: LiveSandboxProviderConfig,
  options: {
    usageRecorder?: ProviderUsageRecordingRepository | undefined;
    openAiProjectId?: string | undefined;
    fetch?: typeof fetch | undefined;
  } = {},
): SandwichTextModelProvider {
  const openAiProvider =
    config.openAiApiKey.length === 0
      ? new UnavailableLiveSandboxTextModelProvider({
          providerName: "OpenAI",
          missingEnv: ["OPENAI_API_KEY"],
        })
      : new OpenAiChatTextProvider({
          apiKey: config.openAiApiKey,
          usageRecorder: options.usageRecorder,
          projectId: options.openAiProjectId,
          baseUrl: config.openAiBaseUrl,
          fetch: options.fetch,
          modelByTier: config.openAiModelByTier,
        });
  const geminiProvider =
    config.geminiApiKey.length === 0
      ? new UnavailableLiveSandboxTextModelProvider({
          providerName: "Gemini",
          missingEnv: ["GEMINI_API_KEY"],
        })
      : new GeminiChatTextProvider({
          apiKey: config.geminiApiKey,
          baseUrl: config.geminiBaseUrl,
          fetch: options.fetch,
          modelByTier: config.geminiModelByTier,
        });

  return new SandboxTextModelRouterProvider({
    openai: openAiProvider,
    "google-gemini": geminiProvider,
  });
}
