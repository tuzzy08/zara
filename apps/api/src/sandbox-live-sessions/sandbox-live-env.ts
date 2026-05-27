export function resolveLiveSandboxProviderConfig(env: Record<string, string | undefined>) {
  return {
    assemblyAiApiKey: env.ASSEMBLYAI_API_KEY?.trim() ?? "",
    cartesiaApiKey: env.CARTESIA_API_KEY?.trim() ?? "",
    cartesiaApiVersion: env.CARTESIA_API_VERSION?.trim() || "2026-03-01",
    openAiApiKey: env.OPENAI_API_KEY?.trim() ?? "",
    openAiBaseUrl: env.OPENAI_BASE_URL?.trim() || "https://api.openai.com",
    openAiModelByTier: {
      cheap: env.OPENAI_CHEAP_MODEL?.trim() || "gpt-4.1-mini",
      standard: env.OPENAI_STANDARD_MODEL?.trim() || "gpt-4.1",
      sota: env.OPENAI_SOTA_MODEL?.trim() || "gpt-4.1",
    },
    geminiApiKey: env.GEMINI_API_KEY?.trim() ?? "",
    geminiBaseUrl: env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com",
    geminiModelByTier: {
      cheap: env.GEMINI_CHEAP_MODEL?.trim() || "gemini-3.1-flash-lite",
      standard: env.GEMINI_STANDARD_MODEL?.trim() || "gemini-3.5-flash",
      sota: env.GEMINI_SOTA_MODEL?.trim() || "gemini-3.1-pro-preview",
    },
    geminiLiveModel: env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.1-flash-live-preview",
  };
}
