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
  };
}
