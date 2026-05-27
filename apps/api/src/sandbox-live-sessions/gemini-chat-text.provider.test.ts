import { describe, expect, it } from "vitest";
import type {
  CompiledRuntimeManifest,
  ModelRoutingContext,
  VoiceAgentRole,
} from "@zara/core";

import { GeminiChatTextProvider } from "./gemini-chat-text.provider";

describe("GeminiChatTextProvider", () => {
  it("posts a Gemini generateContent request and yields the returned text", async () => {
    const recordedCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      recordedCalls.push([input, init]);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "I can help with your plan.",
                  },
                ],
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
    const provider = new GeminiChatTextProvider({
      apiKey: "gemini-test-key",
      fetch: fetchMock,
      modelByTier: {
        cheap: "gemini-3.1-flash-lite",
        standard: "gemini-3.5-flash",
        sota: "gemini-3.1-pro-preview",
      },
    });

    const chunks: string[] = [];

    for await (const chunk of provider.streamText({
      manifest: createManifest(),
      activeRole: {
        ...createRole(),
        modelProvider: "google-gemini",
        modelId: "gemini-3.1-pro-preview",
      },
      transcript: "I need help with my plan",
      tier: "standard",
      context: {
        callPhase: "discovery",
        intent: "support",
        language: "en",
      } satisfies ModelRoutingContext,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["I can help with your plan."]);
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent");
    expect(recordedCalls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": "gemini-test-key",
      },
    });

    const body = JSON.parse(String(recordedCalls[0]?.[1]?.body)) as {
      systemInstruction?: {
        parts?: Array<{
          text?: string;
        }>;
      };
      contents?: Array<{
        role: string;
        parts: Array<{
          text: string;
        }>;
      }>;
    };

    expect(body.systemInstruction?.parts?.[0]?.text).toContain("Respond with the exact spoken reply only.");
    expect(body.contents).toEqual([
      {
        role: "user",
        parts: [
          {
            text: expect.stringContaining("Caller transcript: I need help with my plan"),
          },
        ],
      },
    ]);
  });

  it("throws provider error messages from failed Gemini responses", async () => {
    const provider = new GeminiChatTextProvider({
      apiKey: "bad-key",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "API key not valid.",
            },
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
            },
          },
        )) as typeof fetch,
    });

    await expect(collect(provider.streamText({
      manifest: createManifest(),
      activeRole: createRole(),
      transcript: "hello",
      tier: "cheap",
      context: {
        callPhase: "greeting",
      },
    }))).rejects.toThrowError("API key not valid.");
  });

  it("defaults the standard tier to the configured Gemini Flash model", async () => {
    const recordedCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const provider = new GeminiChatTextProvider({
      apiKey: "gemini-test-key",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        recordedCalls.push([input, init]);

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "Standard Gemini response." }],
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
      }) as typeof fetch,
    });

    await collect(provider.streamText({
      manifest: createManifest(),
      activeRole: {
        ...createRole(),
        modelProvider: "google-gemini",
      },
      transcript: "hello",
      tier: "standard",
      context: {
        callPhase: "discovery",
      },
    }));

    expect(recordedCalls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
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
    agentToolAssignments: [],
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
    businessName: "Tuzzy Labs",
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
