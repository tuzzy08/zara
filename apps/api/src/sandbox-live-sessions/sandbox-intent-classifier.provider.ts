import type { IntentClassifierOutput } from "@zara/core";

import type { LiveSandboxIntentClassifier, LiveSandboxIntentClassifierInput } from "./sandbox-live-session-router";

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

export interface GeminiIntentClassifierProviderConfig {
  apiKey: string;
  baseUrl?: string | undefined;
  modelId?: string | undefined;
  fetch?: typeof fetch | undefined;
}

export class GeminiIntentClassifierProvider implements LiveSandboxIntentClassifier {
  readonly availability = {
    configured: true,
    missingEnv: [],
  };

  private readonly fetchImplementation: typeof fetch;
  private readonly modelId: string;

  constructor(private readonly config: GeminiIntentClassifierProviderConfig) {
    if (config.apiKey.trim().length === 0) {
      throw new Error("Gemini API key is required for intent classification.");
    }

    this.fetchImplementation = config.fetch ?? fetch;
    this.modelId = config.modelId?.trim() || "gemini-3.1-flash-lite";
  }

  async classify(input: LiveSandboxIntentClassifierInput): Promise<IntentClassifierOutput> {
    const response = await this.fetchImplementation(
      `${this.config.baseUrl ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${encodeURIComponent(this.modelId)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.config.apiKey,
        },
        body: JSON.stringify(buildGeminiIntentClassifierRequestBody(input)),
      },
    );
    const payload = await response.json() as GeminiGenerateContentResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Gemini intent classifier request failed.");
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text?.trim() ?? "")
      .join("")
      .trim() ?? "";

    if (text.length === 0) {
      throw new Error("Gemini intent classifier returned no text.");
    }

    return parseIntentClassifierOutput(text);
  }
}

export class UnavailableLiveSandboxIntentClassifierProvider implements LiveSandboxIntentClassifier {
  readonly availability = {
    configured: false,
    missingEnv: ["GEMINI_API_KEY"],
  };

  async classify(): Promise<IntentClassifierOutput> {
    throw new Error("Live sandbox intent classifier is not configured.");
  }
}

function buildGeminiIntentClassifierRequestBody(input: LiveSandboxIntentClassifierInput) {
  return {
    systemInstruction: {
      parts: [
        {
          text: [
            "You are Zara's intent route classifier.",
            "Return only valid JSON with keys matchedBranchId, intentKey, confidence, reason, and usedFallback.",
            "Choose only one configured branch id, or use fallback with matchedBranchId and intentKey set to null.",
            "Never invent branch ids, intents, or targets. Targets are resolved by the runtime, not the model.",
          ].join("\n"),
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify({
              modelAlias: input.modelAlias,
              nodeId: input.nodeId,
              confidenceThreshold: input.confidenceThreshold,
              latestCallerTurn: input.latestCallerTurn,
              recentTranscript: input.recentTranscript,
              sourceAgent: input.sourceAgent === undefined
                ? null
                : {
                    id: input.sourceAgent.id,
                    name: input.sourceAgent.name,
                    kind: input.sourceAgent.kind,
                  },
              branches: input.branches.map((branch) => ({
                id: branch.id,
                label: branch.label,
                intentKey: branch.intentKey,
                description: branch.description,
                examples: branch.examples,
              })),
              fallback: input.fallback,
              inputWindow: input.inputWindow,
            }),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  };
}

function parseIntentClassifierOutput(text: string): IntentClassifierOutput {
  const parsed = JSON.parse(stripJsonFence(text)) as unknown;

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Intent classifier returned non-object JSON.");
  }

  const record = parsed as Record<string, unknown>;
  const matchedBranchId = record["matchedBranchId"];
  const intentKey = record["intentKey"];
  const confidence = record["confidence"];
  const reason = record["reason"];
  const usedFallback = record["usedFallback"];

  if (
    !(typeof matchedBranchId === "string" || matchedBranchId === null)
    || !(typeof intentKey === "string" || intentKey === null)
    || typeof confidence !== "number"
    || typeof reason !== "string"
    || typeof usedFallback !== "boolean"
  ) {
    throw new Error("Intent classifier returned malformed JSON.");
  }

  return {
    matchedBranchId,
    intentKey,
    confidence,
    reason,
    usedFallback,
  };
}

function stripJsonFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
