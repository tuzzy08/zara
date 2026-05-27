import { describe, expect, it } from "vitest";

import { resolveLiveSandboxProviderConfig } from "./sandbox-live-env";

describe("resolveLiveSandboxProviderConfig", () => {
  it("reads sandbox provider credentials and model overrides from env", () => {
    expect(resolveLiveSandboxProviderConfig({
      ASSEMBLYAI_API_KEY: "assembly-key",
      CARTESIA_API_KEY: "cartesia-key",
      CARTESIA_API_VERSION: "2026-03-01",
      OPENAI_API_KEY: "openai-key",
      OPENAI_CHEAP_MODEL: "gpt-4.1-mini",
      OPENAI_STANDARD_MODEL: "gpt-4.1",
      OPENAI_SOTA_MODEL: "gpt-4.1",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_BASE_URL: "https://generativelanguage.googleapis.com",
      GEMINI_CHEAP_MODEL: "gemini-3.1-flash-lite",
      GEMINI_STANDARD_MODEL: "gemini-3.5-flash",
      GEMINI_SOTA_MODEL: "gemini-3.1-pro-preview",
      GEMINI_LIVE_MODEL: "gemini-3.1-flash-live-preview",
    })).toEqual({
      assemblyAiApiKey: "assembly-key",
      cartesiaApiKey: "cartesia-key",
      cartesiaApiVersion: "2026-03-01",
      openAiApiKey: "openai-key",
      openAiBaseUrl: "https://api.openai.com",
      openAiModelByTier: {
        cheap: "gpt-4.1-mini",
        standard: "gpt-4.1",
        sota: "gpt-4.1",
      },
      geminiApiKey: "gemini-key",
      geminiBaseUrl: "https://generativelanguage.googleapis.com",
      geminiModelByTier: {
        cheap: "gemini-3.1-flash-lite",
        standard: "gemini-3.5-flash",
        sota: "gemini-3.1-pro-preview",
      },
      geminiLiveModel: "gemini-3.1-flash-live-preview",
    });
  });

  it("falls back to the default base URL and model map when overrides are absent", () => {
    expect(resolveLiveSandboxProviderConfig({
      OPENAI_API_KEY: "openai-key",
    })).toEqual({
      assemblyAiApiKey: "",
      cartesiaApiKey: "",
      cartesiaApiVersion: "2026-03-01",
      openAiApiKey: "openai-key",
      openAiBaseUrl: "https://api.openai.com",
      openAiModelByTier: {
        cheap: "gpt-4.1-mini",
        standard: "gpt-4.1",
        sota: "gpt-4.1",
      },
      geminiApiKey: "",
      geminiBaseUrl: "https://generativelanguage.googleapis.com",
      geminiModelByTier: {
        cheap: "gemini-3.1-flash-lite",
        standard: "gemini-3.5-flash",
        sota: "gemini-3.1-pro-preview",
      },
      geminiLiveModel: "gemini-3.1-flash-live-preview",
    });
  });
});
