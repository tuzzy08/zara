import type {
  CompiledRuntimeManifest,
  ModelTier,
  SandwichTextModelProvider,
  VoiceAgentRole,
} from "@zara/core";

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
}

export class OpenAiChatTextProvider implements SandwichTextModelProvider {
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
          model: resolveModelForTier(input.tier, this.modelByTier),
          messages: buildMessages(input),
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

function buildMessages(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
  return [
    {
      role: "system",
      content: buildSystemPrompt(input.manifest, input.activeRole),
    },
    {
      role: "user",
      content: [
        `Caller transcript: ${input.transcript}`,
        `Call phase: ${input.context.callPhase}`,
        `Language: ${input.context.language ?? input.activeRole.languagePolicy.defaultLanguage}`,
        ...(input.context.intent !== undefined ? [`Intent: ${input.context.intent}`] : []),
      ].join("\n"),
    },
  ];
}

function buildSystemPrompt(manifest: CompiledRuntimeManifest, activeRole: VoiceAgentRole) {
  return [
    `You are Zara running the '${activeRole.name}' voice role inside workflow '${manifest.graph.name}'.`,
    activeRole.instructions,
    "Respond with the exact spoken reply only.",
    "Keep it concise and production-safe for a live caller.",
  ].join("\n");
}

function resolveModelForTier(
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
