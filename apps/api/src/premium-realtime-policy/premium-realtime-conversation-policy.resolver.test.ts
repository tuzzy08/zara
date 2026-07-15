import { describe, expect, it } from "vitest";

import { defaultPremiumRealtimeConversationPolicy } from "./premium-realtime-conversation-policy.models";
import { resolvePremiumRealtimeProviderSessionConfig } from "./premium-realtime-conversation-policy.resolver";

describe("resolvePremiumRealtimeProviderSessionConfig", () => {
  it("uses the versioned channel default when no platform agent override exists", () => {
    const resolved = resolvePremiumRealtimeProviderSessionConfig({
      policy: {
        ...defaultPremiumRealtimeConversationPolicy,
        version: 9,
      },
      mediaProfile: "pstn",
    });

    expect(resolved).toEqual({
      provider: "openai-realtime",
      model: "gpt-realtime-2.1",
      mediaProfile: "pstn",
      conversationPolicyVersion: 9,
      media: {
        input: { type: "audio/pcmu" },
        output: { type: "audio/pcmu" },
      },
      turnDetection: {
        type: "semantic_vad",
        eagerness: "low",
        createResponse: true,
        interruptResponse: true,
      },
    });
  });

  it("lets an explicit platform agent provider and model override the global defaults", () => {
    const resolved = resolvePremiumRealtimeProviderSessionConfig({
      policy: defaultPremiumRealtimeConversationPolicy,
      mediaProfile: "browser",
      platformOverride: {
        provider: "gemini-live",
        model: "gemini-live-platform-canary",
      },
    });

    expect(resolved).toMatchObject({
      provider: "gemini-live",
      model: "gemini-live-platform-canary",
      mediaProfile: "browser",
      conversationPolicyVersion: 1,
      activityHandling: { type: "provider_native" },
    });
  });
});
