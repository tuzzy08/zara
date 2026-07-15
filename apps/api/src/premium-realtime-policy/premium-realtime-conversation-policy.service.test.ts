import { describe, expect, it } from "vitest";

import { defaultPremiumRealtimeConversationPolicy } from "./premium-realtime-conversation-policy.models";
import { InMemoryPremiumRealtimeConversationPolicyRepository } from "./premium-realtime-conversation-policy.repository";
import { PremiumRealtimeConversationPolicyService } from "./premium-realtime-conversation-policy.service";

describe("PremiumRealtimeConversationPolicyService", () => {
  it("defaults premium realtime to OpenAI gpt-realtime-2.1 with channel-specific provider turn policy", async () => {
    const service = new PremiumRealtimeConversationPolicyService(
      new InMemoryPremiumRealtimeConversationPolicyRepository(),
    );

    const policy = await service.getPolicy();

    expect(policy).toMatchObject({
      schemaVersion: 1,
      version: 1,
      defaultProvider: "openai-realtime",
      providers: {
        openaiRealtime: {
          defaultModel: "gpt-realtime-2.1",
          channels: {
            browser: {
              turnDetection: {
                type: "semantic_vad",
                eagerness: "auto",
                createResponse: true,
                interruptResponse: true,
              },
            },
            pstn: {
              turnDetection: {
                type: "semantic_vad",
                eagerness: "low",
                createResponse: true,
                interruptResponse: true,
              },
            },
          },
        },
        geminiLive: {
          channels: {
            browser: { activityHandling: { type: "provider_native" } },
            pstn: { activityHandling: { type: "provider_native" } },
          },
        },
      },
    });
  });

  it("requires expected version and an audit reason for provider-specific updates", async () => {
    const service = new PremiumRealtimeConversationPolicyService(
      new InMemoryPremiumRealtimeConversationPolicyRepository(),
    );

    await expect(service.updatePolicy({
      expectedVersion: 1,
      reason: " ",
      actorUserId: "platform-admin-1",
      providers: {
        openaiRealtime: {
          defaultModel: "gpt-realtime-2.1-canary",
        },
      },
    })).rejects.toThrow("Premium realtime conversation policy updates require a reason.");

    const updated = await service.updatePolicy({
      expectedVersion: 1,
      reason: "Canary the approved OpenAI realtime model.",
      actorUserId: "platform-admin-1",
      updatedAt: "2026-07-15T16:00:00.000Z",
      providers: {
        openaiRealtime: {
          defaultModel: "gpt-realtime-2.1-canary",
        },
      },
    });

    expect(updated.policy).toMatchObject({
      version: 2,
      updatedBy: "platform-admin-1",
      updatedAt: "2026-07-15T16:00:00.000Z",
      providers: {
        openaiRealtime: { defaultModel: "gpt-realtime-2.1-canary" },
      },
    });
    expect(updated.changedKeys).toEqual(["providers.openaiRealtime.defaultModel"]);

    await expect(service.updatePolicy({
      expectedVersion: 1,
      reason: "Stale write.",
      actorUserId: "platform-admin-2",
    })).rejects.toThrow("Premium realtime conversation policy has changed. Refresh before saving.");
  });

  it("rejects malformed platform-admin update payloads with stable validation errors", async () => {
    const service = new PremiumRealtimeConversationPolicyService(
      new InMemoryPremiumRealtimeConversationPolicyRepository(),
    );

    await expect(service.updatePolicy({
      expectedVersion: 1.5,
      reason: "Invalid version.",
      actorUserId: "platform-admin-1",
    })).rejects.toThrow("Premium realtime conversation policy expected version must be a positive integer.");
    await expect(service.updatePolicy({
      expectedVersion: 1,
      reason: 42 as never,
      actorUserId: "platform-admin-1",
    })).rejects.toThrow("Premium realtime conversation policy update reason must be a string.");
    await expect(service.updatePolicy({
      expectedVersion: 1,
      reason: "Invalid model.",
      actorUserId: "platform-admin-1",
      providers: { openaiRealtime: { defaultModel: 42 as never } },
    })).rejects.toThrow("OpenAI Realtime default model must be a string.");
    await expect(service.updatePolicy({
      expectedVersion: 1,
      reason: "Invalid turn response settings.",
      actorUserId: "platform-admin-1",
      providers: {
        openaiRealtime: {
          channels: {
            pstn: {
              turnDetection: {
                type: "semantic_vad",
                eagerness: "low",
                createResponse: "yes" as never,
                interruptResponse: true,
              },
            },
          },
        },
      },
    })).rejects.toThrow("OpenAI turn detection response settings must be boolean.");
  });

  it("rejects an invalid persisted conversation policy instead of using it for sessions", async () => {
    const repository = new InMemoryPremiumRealtimeConversationPolicyRepository();
    const invalidPolicy = structuredClone(defaultPremiumRealtimeConversationPolicy);
    invalidPolicy.providers.openaiRealtime.channels.pstn.media.input = {
      type: "audio/pcm",
      rate: 24_000,
    };
    await repository.save(invalidPolicy);
    const service = new PremiumRealtimeConversationPolicyService(repository);

    await expect(service.getPolicy()).rejects.toThrow(
      "Stored premium realtime conversation policy is invalid.",
    );
  });
});
