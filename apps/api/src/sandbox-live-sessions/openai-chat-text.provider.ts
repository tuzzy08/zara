import type { ModelTier, SandwichTextModelProvider } from "@zara/core";

import {
  buildSandboxTextSystemPrompt,
  buildSandboxTextTurnPrompt,
  buildSandboxUntrustedContextMessage,
  type SandboxTextPromptPolicy,
} from "./sandbox-text-model-prompts";

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }> | undefined;
  error?: {
    message?: string | undefined;
  } | undefined;
}

export interface OpenAiChatTextProviderConfig {
  apiKey: string;
  baseUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
  modelByTier?: Partial<Record<Exclude<ModelTier, "rules">, string>> | undefined;
  getPromptPolicy?: (() => SandboxTextPromptPolicy | Promise<SandboxTextPromptPolicy>) | undefined;
}

export class OpenAiChatTextProvider implements SandwichTextModelProvider {
  readonly availability = {
    configured: true,
    missingEnv: [],
  };

  private readonly fetchImplementation: typeof fetch;
  private readonly modelByTier: Record<Exclude<ModelTier, "rules">, string>;

  constructor(private readonly config: OpenAiChatTextProviderConfig) {
    if (this.config.apiKey.trim().length === 0) {
      throw new Error("OpenAI API key is required for live sandbox text generation.");
    }

    this.fetchImplementation = this.config.fetch ?? fetch;
    this.modelByTier = {
      cheap: this.config.modelByTier?.cheap ?? "gpt-4.1-mini",
      standard: this.config.modelByTier?.standard ?? "gpt-4.1",
      sota: this.config.modelByTier?.sota ?? "gpt-4.1",
    };
  }

  async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
    const response = await this.fetchImplementation(
      `${this.config.baseUrl ?? "https://api.openai.com"}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: resolveOpenAiModel(input, this.modelByTier),
          messages: await buildMessages(input, this.config.getPromptPolicy),
        }),
      },
    );
    const payload = await response.json() as OpenAiChatCompletionResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "OpenAI chat completion failed.");
    }

    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";

    if (text.length === 0) {
      throw new Error("OpenAI chat completion returned no text.");
    }

    yield text;
  }
}

async function buildMessages(
  input: Parameters<SandwichTextModelProvider["streamText"]>[0],
  getPromptPolicy?: (() => SandboxTextPromptPolicy | Promise<SandboxTextPromptPolicy>) | undefined,
) {
  const promptPolicy = await getPromptPolicy?.();
  const messages = [
    {
      role: "system",
      content: buildSandboxTextSystemPrompt(input.manifest, input.activeAgent, promptPolicy),
    },
    {
      role: "user",
      content: buildSandboxTextTurnPrompt(input),
    },
  ];

  if (input.untrustedContext !== undefined && input.untrustedContext.length > 0) {
    messages.push({
      role: "user",
      content: buildSandboxUntrustedContextMessage(input.untrustedContext),
    });
  }

  return messages;
}

function resolveOpenAiModel(
  input: Parameters<SandwichTextModelProvider["streamText"]>[0],
  models: Record<Exclude<ModelTier, "rules">, string>,
) {
  const explicitModelId = input.activeAgent.modelProvider !== "google-gemini"
    ? input.activeAgent.modelId?.trim()
    : undefined;

  return explicitModelId !== undefined && explicitModelId.length > 0
    ? explicitModelId
    : resolveModelForTier(input.tier, models);
}

export function resolveModelForTier(
  tier: ModelTier,
  models: Record<Exclude<ModelTier, "rules">, string>,
) {
  switch (tier) {
    case "cheap":
      return models.cheap;
    case "standard":
      return models.standard;
    case "sota":
      return models.sota;
    case "rules":
      return models.cheap;
  }
}
