import { describe, expect, it } from "vitest";

import { createLiveSandboxTextModelProvider } from "./sandbox-text-model-provider-factory";
import { resolveLiveSandboxProviderConfig } from "./sandbox-live-env";

describe("createLiveSandboxTextModelProvider", () => {
  it("builds a router that can use Gemini when its credentials are configured", async () => {
    const recordedCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const provider = createLiveSandboxTextModelProvider(
      resolveLiveSandboxProviderConfig({
        OPENAI_API_KEY: "openai-key",
        GEMINI_API_KEY: "gemini-key",
      }),
      {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          recordedCalls.push([input, init]);
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: "Gemini reply.",
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
        }) as typeof fetch,
        getPromptPolicy: () => ({
          guardrails: ["Use the factory-supplied prompt policy."],
          rolePrompts: {
            receptionist: "Use the factory-supplied receptionist template.",
            custom: "Use the factory-supplied fallback template.",
          },
        }),
      },
    );

    const chunks: string[] = [];

    for await (const chunk of provider.streamText({
      manifest: createManifest(),
      activeRole: {
        ...createManifest().roles[0]!,
        modelProvider: "google-gemini",
      },
      transcript: "hello",
      tier: "standard",
      context: {
        callPhase: "greeting",
      },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Gemini reply."]);
    expect(String(recordedCalls[0]?.[0])).toContain("/v1beta/models/gemini-3.5-flash:generateContent");
    expect(JSON.parse(String(recordedCalls[0]?.[1]?.body))).toMatchObject({
      systemInstruction: {
        parts: [
          {
            text: expect.stringContaining("Use the factory-supplied prompt policy."),
          },
        ],
      },
    });
  });

  it("keeps OpenAI as the default provider when roles omit provider selection", async () => {
    const recordedCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const provider = createLiveSandboxTextModelProvider(
      resolveLiveSandboxProviderConfig({
        OPENAI_API_KEY: "openai-key",
        GEMINI_API_KEY: "gemini-key",
      }),
      {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          recordedCalls.push([input, init]);
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "OpenAI reply.",
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
      },
    );

    const chunks: string[] = [];

    for await (const chunk of provider.streamText({
      manifest: createManifest(),
      activeRole: createManifest().roles[0]!,
      transcript: "hello",
      tier: "cheap",
      context: {
        callPhase: "greeting",
      },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["OpenAI reply."]);
    expect(String(recordedCalls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
  });
});

function createManifest() {
  return {
    manifestId: "manifest-live-sandbox",
    publishedVersionId: "published-1",
    workflowId: "workflow-live-sandbox",
    version: 1,
    tenantId: "tenant-west-africa",
    environment: "production" as const,
    workspaceId: "workspace-operations",
    runtime: "sandwich-pipeline" as const,
    runtimeProfile: "cost-optimized" as const,
    telephonyProvider: "browser-webrtc" as const,
    telephonyOwnership: "platform" as const,
    entryNodeId: "entry",
    entryRoleId: "agent-front-desk",
    roles: [
      {
        id: "agent-front-desk",
        kind: "receptionist" as const,
        name: "Front desk triage",
        businessName: "Tuzzy Labs",
        instructions: "Help the caller and keep the tone concise.",
        defaultModelTier: "cheap" as const,
        toolIds: [],
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: true,
        },
      },
    ],
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
      fallbackMode: "ticket" as const,
      triggers: [],
      fallbackMessage: "",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor" as const],
    },
    toolBindings: [],
    agentToolAssignments: [],
    handoffs: [],
    conditions: [],
    exitNodes: [],
    escalationNode: null,
    memory: {
      mode: "scoped" as const,
      retrievalScopes: ["session" as const],
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
