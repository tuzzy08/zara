import type { ModelTier, SandwichTextModelProvider } from "@zara/core";

import {
  buildSandboxTextSystemPrompt,
  buildSandboxTextTurnPrompt,
  buildSandboxUntrustedContextMessage,
} from "./sandbox-text-model-prompts";
import { resolveModelForTier } from "./openai-chat-text.provider";
import { buildAgentActionResponseSchema, unwrapAgentActionResponse } from "./agent-action-response-schema";
import { assertTextModelRequestBudget, selectBoundedUntrustedContext } from "./sandbox-text-request-budget";

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
    const { modelId: model } = this.resolveRequestedModel(input);
    const requestBody = buildGeminiRequestBody(input);
    const outputTokens = input.agentActionMode === true ? 1_024 : 512;
    assertTextModelRequestBudget(requestBody, outputTokens);
    const response = await this.fetchImplementation(
      `${this.config.baseUrl ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        ...(input.abortSignal === undefined ? {} : { signal: input.abortSignal }),
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.config.apiKey,
        },
        body: JSON.stringify(requestBody),
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

    yield input.agentActionMode === true ? unwrapAgentActionResponse(text, input.agentContext) : text;
  }

  resolveRequestedModel(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
    const explicitModelId = input.activeAgent.modelProvider === "google-gemini" ? input.activeAgent.modelId?.trim() : undefined;
    return { provider: "google-gemini" as const, modelId: resolveModelForTier(input.tier, this.modelByTier, explicitModelId) };
  }
}

function buildGeminiRequestBody(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
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

  const untrustedContext = selectBoundedUntrustedContext(input.untrustedContext, input.agentContext);
  if (untrustedContext.length > 0) {
    contents.push({
      role: "user",
      parts: [
        {
          text: buildSandboxUntrustedContextMessage(untrustedContext),
        },
      ],
    });
  }

  return {
    systemInstruction: {
      parts: [
        {
          text: buildSandboxTextSystemPrompt(
            input.manifest,
            input.activeAgent,
            input.promptPolicy,
            input.context.language,
            input,
          ),
        },
      ],
    },
    contents,
    generationConfig: input.agentActionMode === true
      ? {
          responseMimeType: "application/json",
          responseJsonSchema: buildAgentActionResponseSchema(input.agentContext),
          maxOutputTokens: 1_024,
        }
      : { maxOutputTokens: 512 },
  };
}
