import { describe, expect, it } from "vitest";
import type {
  CompiledRuntimeManifest,
  ModelRoutingContext,
  VoiceAgentRole,
} from "@zara/core";

import { OpenAiChatTextProvider } from "./openai-chat-text.provider";

describe("OpenAiChatTextProvider", () => {
  it("posts a chat completion request and yields the returned text", async () => {
    const recordedCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      recordedCalls.push([input, init]);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "I can help with your billing request.",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }) as typeof fetch;
    const provider = new OpenAiChatTextProvider({
      apiKey: "openai-test-key",
      fetch: fetchMock,
      modelByTier: {
        cheap: "gpt-4.1-mini",
        standard: "gpt-4.1",
        sota: "gpt-4.1",
      },
    });

    const chunks: string[] = [];

    for await (const chunk of provider.streamText({
      manifest: createManifest(),
      activeRole: createRole(),
      transcript: "I need help with billing",
      tier: "standard",
      context: {
        callPhase: "discovery",
        intent: "billing",
        language: "en",
      } satisfies ModelRoutingContext,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["I can help with your billing request."]);
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(recordedCalls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer openai-test-key",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(recordedCalls[0]?.[1]?.body))).toMatchObject({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
        },
        {
          role: "user",
        },
      ],
    });
  });

  it("throws when the provider returns a non-success status", async () => {
    const fetchMock = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Invalid API key",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        },
      )) as typeof fetch;
    const provider = new OpenAiChatTextProvider({
      apiKey: "bad-key",
      fetch: fetchMock,
    });

    const streamPromise = collect(provider.streamText({
      manifest: createManifest(),
      activeRole: createRole(),
      transcript: "hello",
      tier: "cheap",
      context: {
        callPhase: "greeting",
      },
    }));

    await expect(streamPromise).rejects.toThrowError("Invalid API key");
  });
});

async function collect(stream: AsyncIterable<string>) {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
}

function createManifest(): CompiledRuntimeManifest {
  return {
    manifestId: "manifest-live-sandbox",
    publishedVersionId: "published-1",
    version: 1,
    tenantId: "tenant-west-africa",
    environment: "production",
    workspaceId: "workspace-operations",
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryNodeId: "entry",
    entryRoleId: "agent-front-desk",
    roles: [createRole()],
    tools: [],
    graph: {
      id: "workflow-live-sandbox",
      name: "Live sandbox",
      nodes: [],
      edges: [],
    },
    modelRouting: [],
    escalation: {
      enabled: false,
      fallbackMode: "ticket",
      triggers: [],
      fallbackMessage: "",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    toolBindings: [],
    handoffs: [],
    conditions: [],
    exitNodes: [],
    escalationNode: null,
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 1000,
      currentSpendUsd: 100,
      projectedCostPerMinuteUsd: 0.3,
      blockOnLimit: true,
    },
    serializedGraph: "{\"nodes\":[],\"edges\":[]}",
    compiledDefinitionHash: "hash-live-sandbox",
  };
}

function createRole(): VoiceAgentRole {
  return {
    id: "agent-front-desk",
    kind: "receptionist",
    name: "Front desk triage",
    instructions: "Help the caller and keep the tone concise.",
    defaultModelTier: "cheap",
    toolIds: [],
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      allowMidCallSwitching: true,
    },
  };
}
