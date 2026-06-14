import { describe, expect, it } from "vitest";
import type {
  CompiledRuntimeManifest,
  SandwichTextModelProvider,
  TextModelProviderId,
  VoiceAgentRole,
} from "@zara/core";

import { SandboxTextModelRouterProvider } from "./sandbox-text-model-router.provider";

describe("SandboxTextModelRouterProvider", () => {
  it("routes Gemini agent roles to the Gemini provider", async () => {
    const openAi = createRecordingProvider("openai");
    const gemini = createRecordingProvider("google-gemini");
    const router = new SandboxTextModelRouterProvider({
      openai: openAi.provider,
      "google-gemini": gemini.provider,
    });

    const chunks = await collect(router.streamText({
      manifest: createManifest(),
      activeRole: {
        ...createRole(),
        modelProvider: "google-gemini",
      },
      transcript: "hello",
      tier: "standard",
      context: {
        callPhase: "greeting",
      },
    }));

    expect(chunks).toEqual(["google-gemini response"]);
    expect(openAi.calls).toHaveLength(0);
    expect(gemini.calls).toHaveLength(1);
  });

  it("defaults roles without a provider to OpenAI", async () => {
    const openAi = createRecordingProvider("openai");
    const gemini = createRecordingProvider("google-gemini");
    const router = new SandboxTextModelRouterProvider({
      openai: openAi.provider,
      "google-gemini": gemini.provider,
    });

    await collect(router.streamText({
      manifest: createManifest(),
      activeRole: createRole(),
      transcript: "hello",
      tier: "cheap",
      context: {
        callPhase: "greeting",
      },
    }));

    expect(openAi.calls).toHaveLength(1);
    expect(gemini.calls).toHaveLength(0);
  });

  it("surfaces selected provider setup errors", async () => {
    const router = new SandboxTextModelRouterProvider({
      openai: createRecordingProvider("openai").provider,
      "google-gemini": createUnavailableProvider("Gemini", ["GEMINI_API_KEY"]),
    });

    await expect(collect(router.streamText({
      manifest: createManifest(),
      activeRole: {
        ...createRole(),
        modelProvider: "google-gemini",
      },
      transcript: "hello",
      tier: "cheap",
      context: {
        callPhase: "greeting",
      },
    }))).rejects.toThrowError("Gemini text model is not configured. Missing: GEMINI_API_KEY.");
  });

  it("reports availability for the selected text model provider before runtime starts", () => {
    const router = new SandboxTextModelRouterProvider({
      openai: createRecordingProvider("openai").provider,
      "google-gemini": createUnavailableProvider("Gemini", ["GEMINI_API_KEY"]),
    });

    expect(router.getProviderAvailability("openai")).toEqual({
      configured: true,
      missingEnv: [],
    });
    expect(router.getProviderAvailability("google-gemini")).toEqual({
      configured: false,
      missingEnv: ["GEMINI_API_KEY"],
    });
  });
});

function createRecordingProvider(providerId: TextModelProviderId) {
  const calls: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
  const provider: SandwichTextModelProvider = {
    async *streamText(input) {
      calls.push(input);
      yield `${providerId} response`;
    },
  };

  return {
    calls,
    provider,
  };
}

function createUnavailableProvider(name: string, missingEnv: string[]): SandwichTextModelProvider {
  return {
    availability: {
      configured: false,
      missingEnv,
    },
    streamText() {
      throw new Error(`${name} should not be called directly.`);
    },
  } as SandwichTextModelProvider;
}

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
    workflowId: "workflow-live-sandbox",
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
