import type {
  CompiledRuntimeManifest,
  RuntimeAgentDefinition,
  SandwichTtsProvider,
  VoiceAgentRole,
} from "@zara/core";

import { CartesiaTtsProvider } from "../sandbox-live-sessions/cartesia-tts.provider";
import type { VoicePreviewSynthesizer } from "./voice-library.service";

export class UnavailableVoicePreviewSynthesizer implements VoicePreviewSynthesizer {
  async synthesize() {
    return {};
  }
}

export class CartesiaVoicePreviewSynthesizer implements VoicePreviewSynthesizer {
  private readonly tts: SandwichTtsProvider;

  constructor(input: {
    apiKey: string;
    apiVersion: string;
  }) {
    this.tts = new CartesiaTtsProvider({
      apiKey: input.apiKey,
      apiVersion: input.apiVersion,
    });
  }

  async synthesize(input: {
    providerVoiceId: string;
    text: string;
    language: string;
    speed?: number | undefined;
    volume?: number | undefined;
    emotion?: string | undefined;
  }) {
    const result = await this.tts.synthesize({
      manifest: previewManifest,
      activeAgent: previewAgent,
      text: input.text,
      language: input.language,
      voiceProfile: "economy",
      voiceConfig: {
        provider: "cartesia",
        voiceId: input.providerVoiceId,
        label: "Preview voice",
        sourceType: "catalog",
        speed: input.speed,
        volume: input.volume,
        emotion: input.emotion,
      },
      context: {
        callPhase: "discovery",
        language: input.language,
      },
    });

    const chunks: Buffer[] = [];
    for await (const chunk of result.audio) {
      chunks.push(Buffer.from(chunk, "base64"));
    }

    return {
      audioBase64: createPcm16Wav(Buffer.concat(chunks), 16_000).toString("base64"),
      audioContentType: "audio/wav" as const,
    };
  }
}

const previewRole: VoiceAgentRole = {
  id: "voice-preview-role",
  kind: "custom",
  name: "Voice preview",
  businessName: "Zara AI",
  instructions: "Preview selected voice.",
  defaultModelTier: "cheap",
  toolIds: [],
  languagePolicy: {
    defaultLanguage: "en",
    supportedLanguages: ["en"],
    allowMidCallSwitching: false,
  },
};

const previewAgent: RuntimeAgentDefinition = {
  agentId: previewRole.id,
  nodeId: previewRole.id,
  roleId: previewRole.id,
  kind: previewRole.kind,
  name: previewRole.name,
  businessName: previewRole.businessName,
  instructions: previewRole.instructions,
  defaultModelTier: previewRole.defaultModelTier,
  toolAssignments: [],
  languagePolicy: previewRole.languagePolicy,
};

const previewManifest = {
  tenantId: "voice-preview",
  environment: "sandbox",
  manifestId: "voice-preview",
  publishedVersionId: "voice-preview",
  version: 1,
  workflowId: "voice-preview",
  runtime: "sandwich-pipeline",
  runtimeProfile: "cost-optimized",
  telephonyProvider: "browser-webrtc",
  telephonyOwnership: "platform",
  entryAgentId: previewRole.id,
  roles: [previewRole],
  tools: [],
  graph: {
    id: "voice-preview",
    name: "Voice preview",
    nodes: [],
    edges: [],
  },
  modelRouting: [],
  escalation: {
    enabled: false,
    fallbackMode: "callback",
    triggers: [],
    fallbackMessage: "",
  },
  escalationNode: null,
  telemetry: {
    captureAudio: false,
    captureTranscript: false,
    redactSensitiveData: true,
    sinks: ["live-monitor"],
  },
  entryNodeId: "voice-preview-entry",
  toolBindings: [],
  agentToolAssignments: [],
  conditions: [],
  routePolicies: [],
  exitNodes: [],
  returnRoutes: [],
  memory: {
    mode: "session-only",
    retrievalScopes: ["session"],
    approvalRequired: false,
  },
  budget: {
    monthlyCapUsd: 0,
    currentSpendUsd: 0,
    projectedCostPerMinuteUsd: 0,
    blockOnLimit: false,
  },
  compiledDefinitionHash: "voice-preview",
  serializedGraph: "{}",
} satisfies CompiledRuntimeManifest;

function createPcm16Wav(pcm: Buffer, sampleRateHz: number) {
  const header = Buffer.alloc(44);
  const dataLength = pcm.length;
  const byteRate = sampleRateHz * 2;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return Buffer.concat([header, pcm]);
}
