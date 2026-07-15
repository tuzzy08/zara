import type { PremiumRealtimeProviderSessionConfig, RealtimeProviderId } from "@zara/core";

import type {
  PremiumRealtimeConversationPolicy,
  PremiumRealtimeMediaProfile,
} from "./premium-realtime-conversation-policy.models";

export function resolvePremiumRealtimeProviderSessionConfig(input: {
  policy: PremiumRealtimeConversationPolicy;
  mediaProfile: PremiumRealtimeMediaProfile;
  platformOverride?: {
    provider?: RealtimeProviderId | undefined;
    model?: string | undefined;
  } | undefined;
}): PremiumRealtimeProviderSessionConfig {
  const provider = input.platformOverride?.provider ?? input.policy.defaultProvider;
  if (provider === "gemini-live") {
    const channel = input.policy.providers.geminiLive.channels[input.mediaProfile];
    return {
      provider,
      model: input.platformOverride?.model ?? input.policy.providers.geminiLive.defaultModel,
      mediaProfile: input.mediaProfile,
      conversationPolicyVersion: input.policy.version,
      media: structuredClone(channel.media),
      activityHandling: structuredClone(channel.activityHandling),
    };
  }

  const channel = input.policy.providers.openaiRealtime.channels[input.mediaProfile];
  return {
    provider,
    model: input.platformOverride?.model ?? input.policy.providers.openaiRealtime.defaultModel,
    mediaProfile: input.mediaProfile,
    conversationPolicyVersion: input.policy.version,
    media: structuredClone(channel.media),
    turnDetection: structuredClone(channel.turnDetection),
  };
}
