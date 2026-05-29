import type { ModelTier, SandwichTextModelProvider } from "@zara/core";

import {
  buildSandboxTextSystemPrompt,
  buildSandboxTextTurnPrompt,
  buildSandboxUntrustedContextMessage,
  type SandboxTextPromptPolicy,
} from "./sandbox-text-model-prompts";
import { resolveModelForTier } from "./openai-chat-text.provider";

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string | undefined;
      }> | undefined;
    } | undefined;
  }> | undefined;
  error?: {
    message?: string | undefined;
  } | undefined;
}

export interface GeminiChatTextProviderConfig {
  apiKey: string;
  baseUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
  modelByTier?: Partial<Record<Exclude<ModelTier, "rules">, string>> | undefined;
  getPromptPolicy?: (() => SandboxTextPromptPolicy | Promise<SandboxTextPromptPolicy>) | undefined;
}

export class GeminiChatTextProvider implements SandwichTextModelProvider {
  readonly availability = {
    configured: true,
    missingEnv: [],
  };

  private readonly fetchImplementation: typeof fetch;
  private readonly modelByTier: Record<Exclude<ModelTier, "rules">, string>;

  constructor(private readonly config: GeminiChatTextProviderConfig) {
    if (this.config.apiKey.trim().length === 0) {
      throw new Error("Gemini API key is required for live sandbox text generation.");
    }

    this.fetchImplementation = this.config.fetch ?? fetch;
    this.modelByTier = {
      cheap: this.config.modelByTier?.cheap ?? "gemini-3.1-flash-lite",
      standard: this.config.modelByTier?.standard ?? "gemini-3.5-flash",
      sota: this.config.modelByTier?.sota ?? "gemini-3.1-pro-preview",
    };
  }

  async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
    const model = resolveGeminiModel(input, this.modelByTier);
    const response = await this.fetchImplementation(
      `${this.config.baseUrl ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.config.apiKey,
        },
        body: JSON.stringify(await buildGeminiRequestBody(input, this.config.getPromptPolicy)),
      },
    );
    const payload = await response.json() as GeminiGenerateContentResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Gemini generateContent request failed.");
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text?.trim() ?? "")
      .join("")
      .trim() ?? "";

    if (text.length === 0) {
      throw new Error("Gemini generateContent returned no text.");
    }

    yield text;
  }
}

async function buildGeminiRequestBody(
  input: Parameters<SandwichTextModelProvider["streamText"]>[0],
  getPromptPolicy?: (() => SandboxTextPromptPolicy | Promise<SandboxTextPromptPolicy>) | undefined,
) {
  const promptPolicy = await getPromptPolicy?.();
  const contents = [
    {
      role: "user",
      parts: [
        {
          text: buildSandboxTextTurnPrompt(input),
        },
      ],
    },
  ];

  if (input.untrustedContext !== undefined && input.untrustedContext.length > 0) {
    contents.push({
      role: "user",
      parts: [
        {
          text: buildSandboxUntrustedContextMessage(input.untrustedContext),
        },
      ],
    });
  }

  return {
    systemInstruction: {
      parts: [
        {
          text: buildSandboxTextSystemPrompt(input.manifest, input.activeRole, promptPolicy),
        },
      ],
    },
    contents,
  };
}

function resolveGeminiModel(
  input: Parameters<SandwichTextModelProvider["streamText"]>[0],
  models: Record<Exclude<ModelTier, "rules">, string>,
) {
  const explicitModelId = input.activeRole.modelProvider === "google-gemini"
    ? input.activeRole.modelId?.trim()
    : undefined;

  return explicitModelId !== undefined && explicitModelId.length > 0
    ? explicitModelId
    : resolveModelForTier(input.tier, models);
}
