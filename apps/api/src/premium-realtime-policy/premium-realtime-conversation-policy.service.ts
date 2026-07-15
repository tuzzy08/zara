import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";

import {
  defaultPremiumRealtimeConversationPolicy,
  type OpenAiRealtimeTurnDetectionPolicy,
  type PremiumRealtimeConversationPolicy,
  type PremiumRealtimeMediaProfile,
  type UpdatePremiumRealtimeConversationPolicyInput,
} from "./premium-realtime-conversation-policy.models";
import type { PremiumRealtimeConversationPolicyRepository } from "./premium-realtime-conversation-policy.repository";

export const premiumRealtimeConversationPolicyRepositoryToken = Symbol(
  "premiumRealtimeConversationPolicyRepository",
);

@Injectable()
export class PremiumRealtimeConversationPolicyService {
  constructor(
    @Inject(premiumRealtimeConversationPolicyRepositoryToken)
    private readonly repository: PremiumRealtimeConversationPolicyRepository,
  ) {}

  async getPolicy(): Promise<PremiumRealtimeConversationPolicy> {
    const stored = await this.repository.load();
    if (stored === null) {
      return structuredClone(defaultPremiumRealtimeConversationPolicy);
    }
    assertStoredPolicy(stored);
    return structuredClone(stored);
  }

  async updatePolicy(
    input: UpdatePremiumRealtimeConversationPolicyInput & {
      actorUserId: string;
      updatedAt?: string | undefined;
    },
  ) {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new BadRequestException(
        "Premium realtime conversation policy expected version must be a positive integer.",
      );
    }
    const current = await this.getPolicy();
    if (input.expectedVersion !== current.version) {
      throw new ConflictException("Premium realtime conversation policy has changed. Refresh before saving.");
    }

    if (typeof input.reason !== "string") {
      throw new BadRequestException("Premium realtime conversation policy update reason must be a string.");
    }
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new BadRequestException("Premium realtime conversation policy updates require a reason.");
    }

    const next = mergePolicy(current, input);
    next.version += 1;
    next.updatedBy = input.actorUserId;
    next.updatedAt = input.updatedAt ?? new Date().toISOString();
    await this.repository.save(next);

    return {
      policy: structuredClone(next),
      changedKeys: getChangedKeys(input),
      reason,
    };
  }
}

function mergePolicy(
  current: PremiumRealtimeConversationPolicy,
  input: UpdatePremiumRealtimeConversationPolicyInput,
) {
  validateUpdateShape(input);
  const next = structuredClone(current);
  if (input.defaultProvider !== undefined) {
    if (input.defaultProvider !== "openai-realtime" && input.defaultProvider !== "gemini-live") {
      throw new BadRequestException(`Premium realtime provider '${input.defaultProvider}' is not supported.`);
    }
    next.defaultProvider = input.defaultProvider;
  }

  const openAi = input.providers?.openaiRealtime;
  if (openAi?.defaultModel !== undefined) {
    next.providers.openaiRealtime.defaultModel = normalizeModel(openAi.defaultModel, "OpenAI Realtime");
  }
  mergeOpenAiChannel(next, "browser", openAi?.channels?.browser?.turnDetection);
  mergeOpenAiChannel(next, "pstn", openAi?.channels?.pstn?.turnDetection);

  const gemini = input.providers?.geminiLive;
  if (gemini?.defaultModel !== undefined) {
    next.providers.geminiLive.defaultModel = normalizeModel(gemini.defaultModel, "Gemini Live");
  }
  return next;
}

function mergeOpenAiChannel(
  policy: PremiumRealtimeConversationPolicy,
  channel: PremiumRealtimeMediaProfile,
  turnDetection: OpenAiRealtimeTurnDetectionPolicy | undefined,
) {
  if (turnDetection === undefined) return;
  policy.providers.openaiRealtime.channels[channel].turnDetection = normalizeTurnDetection(turnDetection);
}

function normalizeTurnDetection(
  turnDetection: unknown,
): OpenAiRealtimeTurnDetectionPolicy {
  if (!isRecord(turnDetection)) {
    throw new BadRequestException("OpenAI turn detection policy is invalid.");
  }
  if (
    typeof turnDetection["createResponse"] !== "boolean"
    || typeof turnDetection["interruptResponse"] !== "boolean"
  ) {
    throw new BadRequestException("OpenAI turn detection response settings must be boolean.");
  }
  if (turnDetection.type === "semantic_vad") {
    if (
      typeof turnDetection["eagerness"] !== "string"
      || !["low", "medium", "high", "auto"].includes(turnDetection["eagerness"])
    ) {
      throw new BadRequestException("OpenAI semantic VAD eagerness is not supported.");
    }
    return {
      type: "semantic_vad",
      eagerness: turnDetection["eagerness"] as "low" | "medium" | "high" | "auto",
      createResponse: turnDetection["createResponse"],
      interruptResponse: turnDetection["interruptResponse"],
    };
  }

  if (turnDetection.type !== "server_vad") {
    throw new BadRequestException("OpenAI turn detection type is not supported.");
  }
  const threshold = turnDetection["threshold"];
  const prefixPaddingMs = turnDetection["prefixPaddingMs"];
  const silenceDurationMs = turnDetection["silenceDurationMs"];
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new BadRequestException("OpenAI server VAD threshold must be between 0 and 1.");
  }
  if (typeof prefixPaddingMs !== "number" || !Number.isInteger(prefixPaddingMs) || prefixPaddingMs < 0) {
    throw new BadRequestException("OpenAI server VAD prefix padding must be a non-negative integer.");
  }
  if (typeof silenceDurationMs !== "number" || !Number.isInteger(silenceDurationMs) || silenceDurationMs <= 0) {
    throw new BadRequestException("OpenAI server VAD silence duration must be a positive integer.");
  }
  return {
    type: "server_vad",
    threshold,
    prefixPaddingMs,
    silenceDurationMs,
    createResponse: turnDetection["createResponse"],
    interruptResponse: turnDetection["interruptResponse"],
  };
}

function normalizeModel(model: unknown, provider: string) {
  if (typeof model !== "string") {
    throw new BadRequestException(`${provider} default model must be a string.`);
  }
  const normalized = model.trim();
  if (normalized.length === 0) {
    throw new BadRequestException(`${provider} default model is required.`);
  }
  return normalized;
}

function getChangedKeys(input: UpdatePremiumRealtimeConversationPolicyInput) {
  const keys: string[] = [];
  if (input.defaultProvider !== undefined) keys.push("defaultProvider");
  if (input.providers?.openaiRealtime?.defaultModel !== undefined) {
    keys.push("providers.openaiRealtime.defaultModel");
  }
  if (input.providers?.openaiRealtime?.channels?.browser?.turnDetection !== undefined) {
    keys.push("providers.openaiRealtime.channels.browser.turnDetection");
  }
  if (input.providers?.openaiRealtime?.channels?.pstn?.turnDetection !== undefined) {
    keys.push("providers.openaiRealtime.channels.pstn.turnDetection");
  }
  if (input.providers?.geminiLive?.defaultModel !== undefined) {
    keys.push("providers.geminiLive.defaultModel");
  }
  return keys;
}

function validateUpdateShape(input: UpdatePremiumRealtimeConversationPolicyInput) {
  if (input.providers !== undefined && !isRecord(input.providers)) {
    throw new BadRequestException("Premium realtime provider policy update is invalid.");
  }
  const openAi = input.providers?.openaiRealtime;
  if (openAi !== undefined && !isRecord(openAi)) {
    throw new BadRequestException("OpenAI Realtime policy update is invalid.");
  }
  if (openAi?.channels !== undefined && !isRecord(openAi.channels)) {
    throw new BadRequestException("OpenAI Realtime channel policy update is invalid.");
  }
  for (const channel of [openAi?.channels?.browser, openAi?.channels?.pstn]) {
    if (channel !== undefined && !isRecord(channel)) {
      throw new BadRequestException("OpenAI Realtime channel policy update is invalid.");
    }
  }
  const gemini = input.providers?.geminiLive;
  if (gemini !== undefined && !isRecord(gemini)) {
    throw new BadRequestException("Gemini Live policy update is invalid.");
  }
}

function assertStoredPolicy(policy: unknown): asserts policy is PremiumRealtimeConversationPolicy {
  try {
    if (!isRecord(policy) || policy["schemaVersion"] !== 1) throw new Error("schema");
    if (!Number.isInteger(policy["version"]) || (policy["version"] as number) < 1) throw new Error("version");
    if (policy["defaultProvider"] !== "openai-realtime" && policy["defaultProvider"] !== "gemini-live") {
      throw new Error("provider");
    }
    if (typeof policy["updatedBy"] !== "string" || typeof policy["updatedAt"] !== "string") {
      throw new Error("audit");
    }
    const providers = requireRecord(policy["providers"]);
    const openAi = requireRecord(providers["openaiRealtime"]);
    const openAiChannels = requireRecord(openAi["channels"]);
    const openAiBrowser = requireRecord(openAiChannels["browser"]);
    const openAiPstn = requireRecord(openAiChannels["pstn"]);
    const gemini = requireRecord(providers["geminiLive"]);
    const geminiChannels = requireRecord(gemini["channels"]);
    const geminiBrowser = requireRecord(geminiChannels["browser"]);
    const geminiPstn = requireRecord(geminiChannels["pstn"]);
    normalizeModel(openAi["defaultModel"], "OpenAI Realtime");
    normalizeModel(gemini["defaultModel"], "Gemini Live");
    normalizeTurnDetection(openAiBrowser["turnDetection"]);
    normalizeTurnDetection(openAiPstn["turnDetection"]);
    if (!matchesFixedContract(openAiBrowser["media"], defaultPremiumRealtimeConversationPolicy.providers.openaiRealtime.channels.browser.media)) {
      throw new Error("openai-browser-media");
    }
    if (!matchesFixedContract(openAiPstn["media"], defaultPremiumRealtimeConversationPolicy.providers.openaiRealtime.channels.pstn.media)) {
      throw new Error("openai-pstn-media");
    }
    for (const channel of [geminiBrowser, geminiPstn]) {
      if (!matchesFixedContract(channel["media"], defaultPremiumRealtimeConversationPolicy.providers.geminiLive.channels.pstn.media)) {
        throw new Error("gemini-media");
      }
      if (!matchesFixedContract(channel["activityHandling"], { type: "provider_native" })) {
        throw new Error("gemini-activity");
      }
    }
  } catch {
    throw new Error("Stored premium realtime conversation policy is invalid.");
  }
}

function requireRecord(value: unknown) {
  if (!isRecord(value)) throw new Error("record");
  return value;
}

function matchesFixedContract(actual: unknown, expected: unknown) {
  return isDeepStrictEqual(actual, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
