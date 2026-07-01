import type { SandwichTextModelProvider } from "@zara/core";

import { GeminiChatTextProvider } from "./gemini-chat-text.provider";
import { OpenAiChatTextProvider } from "./openai-chat-text.provider";
import type { resolveLiveSandboxProviderConfig } from "./sandbox-live-env";
import type { SandboxTextPromptPolicy } from "./sandbox-text-model-prompts";
import {
  UnavailableLiveSandboxTextModelProvider,
} from "./sandbox-live-sessions.providers";
import { SandboxTextModelRouterProvider } from "./sandbox-text-model-router.provider";

type LiveSandboxProviderConfig = ReturnType<typeof resolveLiveSandboxProviderConfig>;

export function createLiveSandboxTextModelProvider(
  config: LiveSandboxProviderConfig,
  options: {
    fetch?: typeof fetch | undefined;
    getPromptPolicy?: (() => SandboxTextPromptPolicy | Promise<SandboxTextPromptPolicy>) | undefined;
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
          baseUrl: config.openAiBaseUrl,
          fetch: options.fetch,
          getPromptPolicy: options.getPromptPolicy,
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
          getPromptPolicy: options.getPromptPolicy,
          modelByTier: config.geminiModelByTier,
        });

  return new SandboxTextModelRouterProvider({
    openai: openAiProvider,
    "google-gemini": geminiProvider,
  }, {
    getPromptPolicy: options.getPromptPolicy,
  });
}
