import type { ModelTier, SandwichTextModelProvider } from "@zara/core";
import type { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";
import { buildAgentActionResponseSchema, unwrapAgentActionResponse } from "./agent-action-response-schema";
import { assertTextModelRequestBudget, selectBoundedUntrustedContext } from "./sandbox-text-request-budget";

import {
  buildSandboxTextSystemPrompt,
  buildSandboxTextTurnPrompt,
  buildSandboxUntrustedContextMessage,
} from "./sandbox-text-model-prompts";

interface OpenAiChatCompletionResponse {
  id?: string;
  created?: number;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
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
  projectId?: string | undefined;
  usageRecorder?: ProviderUsageRecordingRepository | undefined;
  baseUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
  modelByTier?: Partial<Record<Exclude<ModelTier, "rules">, string>> | undefined;
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
    const model = resolveOpenAiModel(input, this.modelByTier);
    const messages = buildMessages(input);
    const recordingId = await this.config.usageRecorder?.begin({
      organizationId: input.manifest.tenantId, sessionId: input.callSessionId ?? null,
      externalScopeId: this.config.projectId?.trim() || null, provider: "openai", model,
      occurredAt: new Date().toISOString(),
    });
    const requestBody = {
      model,
      messages,
      max_completion_tokens: input.agentActionMode === true ? 1_024 : 512,
      ...(input.agentActionMode === true ? {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "zara_agent_action",
            strict: true,
            schema: buildAgentActionResponseSchema(input.agentContext),
          },
        },
      } : {}),
    };
    assertTextModelRequestBudget(requestBody, requestBody.max_completion_tokens);
    const response = await this.fetchImplementation(
      `${this.config.baseUrl ?? "https://api.openai.com"}/v1/chat/completions`,
      {
        method: "POST",
        ...(input.abortSignal === undefined ? {} : { signal: input.abortSignal }),
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          ...(this.config.projectId?.trim() ? { "OpenAI-Project": this.config.projectId.trim() } : {}),
        },
        body: JSON.stringify(requestBody),
      },
    );
    const payload = await response.json() as OpenAiChatCompletionResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "OpenAI chat completion failed.");
    }

    if (recordingId !== undefined && payload.usage != null
      && typeof payload.id === "string" && payload.id.trim().length > 0
      && typeof payload.created === "number" && Number.isFinite(new Date(payload.created * 1000).getTime())
      && [payload.usage.prompt_tokens, payload.usage.completion_tokens, payload.usage.total_tokens]
        .every(value => Number.isSafeInteger(value) && value >= 0)
      && payload.usage.prompt_tokens + payload.usage.completion_tokens === payload.usage.total_tokens) {
      await this.config.usageRecorder!.complete(input.manifest.tenantId, recordingId, {
        providerRequestId: payload.id, occurredAt: new Date(payload.created * 1000).toISOString(),
        totals: { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens, requestCount: 1 },
      });
    }

    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";

    if (text.length === 0) {
      throw new Error("OpenAI chat completion returned no text.");
    }

    yield input.agentActionMode === true ? unwrapAgentActionResponse(text, input.agentContext) : text;
  }
}

function buildMessages(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
  const messages = [
    {
      role: "system",
      content: buildSandboxTextSystemPrompt(
        input.manifest,
        input.activeAgent,
        input.promptPolicy,
        input.context.language,
        input,
      ),
    },
    {
      role: "user",
      content: buildSandboxTextTurnPrompt(input),
    },
  ];

  const untrustedContext = selectBoundedUntrustedContext(input.untrustedContext, input.agentContext);
  if (untrustedContext.length > 0) {
    messages.push({
      role: "user",
      content: buildSandboxUntrustedContextMessage(untrustedContext),
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
