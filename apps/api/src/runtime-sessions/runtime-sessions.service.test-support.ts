import { describe, expect, it, vi } from "vitest";
import type {
  CompiledRuntimeManifest,
  PremiumRealtimeSession,
  RealtimeToolDeclaration,
  TurnRuntimePacket,
} from "@zara/core";
import type { PremiumRealtimeToolLoopService } from "./premium-realtime-tool-loop.service.js";
import { RuntimeSessionsService } from "./runtime-sessions.service.js";
import { defaultRuntimePromptPolicy } from "../runtime-prompt-policy/runtime-prompt-policy.models.js";
import { defaultPremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models.js";

export function baseProviderMessageInput() {
  return {
    organizationId: "tenant-1",
    sessionId: "session-1",
    workspaceId: "workspace-customer-success",
    actorUserId: "user-1",
    manifest: {
      tenantId: "tenant-1",
      toolBindings: [],
    } as unknown as CompiledRuntimeManifest,
    activeAgentId: "agent-support",
    transcript: "Caller needs a ticket update.",
    packet: {
      toolCalls: [],
    } as unknown as TurnRuntimePacket,
    at: "2026-06-14T09:30:00.000Z",
  };
}

export function createSession(overrides: Partial<PremiumRealtimeSession> = {}): PremiumRealtimeSession {
  const runtime = overrides.runtime ?? "openai-realtime";
  const model = overrides.model ?? "gpt-realtime";
  return {
    sessionId: "session-1",
    manifestId: "manifest-1",
    publishedVersionId: "published-1",
    activeAgentId: "agent-support",
    runtime,
    policy: "premium-realtime",
    model,
    voice: "expressive",
    transportUrl: "/runtime/realtime/sessions/manifest-1",
    expiresAt: "2026-06-14T10:00:00.000Z",
    toolDeclarations: [],
    observedEventTypes: [],
    ...overrides,
    providerConfig: overrides.providerConfig ?? testProviderConfig(runtime, model),
  };
}

export function testProviderConfig(runtime: PremiumRealtimeSession["runtime"], model: string) {
  return runtime === "gemini-live"
    ? {
        provider: "gemini-live" as const,
        model,
        mediaProfile: "browser" as const,
        conversationPolicyVersion: 1,
        media: {
          input: { mimeType: "audio/pcm;rate=16000" as const },
          output: { mimeType: "audio/pcm;rate=24000" as const },
        },
        activityHandling: { type: "provider_native" as const },
      }
    : {
        provider: "openai-realtime" as const,
        model,
        mediaProfile: "browser" as const,
        conversationPolicyVersion: 1,
        media: {
          input: { type: "audio/pcm" as const, rate: 24_000 as const },
          output: { type: "audio/pcm" as const, rate: 24_000 as const },
        },
        turnDetection: {
          type: "semantic_vad" as const,
          eagerness: "auto" as const,
          createResponse: true,
          interruptResponse: true,
        },
      };
}

export function basePacket(): TurnRuntimePacket {
  return {
    schemaVersion: "turn-runtime-packet.v1",
    ids: {
      tenantId: "tenant-1",
      workspaceId: "workspace-customer-success",
      callSessionId: "session-1",
      turnId: "session-1:turn:1",
      manifestId: "manifest-route-policy",
      manifestVersion: 1,
    },
    timing: {
      startedAt: "2026-06-14T09:30:00.000Z",
      sequence: 1,
    },
    callerInput: {
      latestCallerTurn: "",
      source: "voice",
      recentTranscript: [],
    },
    graph: {
      entryNodeId: "entry",
      currentNodeId: "agent-front",
      frontierNodeIds: ["agent-front"],
      visitedNodeIds: [],
    },
    availableTools: [],
    availableActions: [],
    toolCalls: [],
    safety: {
      untrustedSources: ["caller_transcript", "tool_output"],
      redactionApplied: true,
      maxModelContextBytes: 24_000,
    },
    diagnostics: {
      warnings: [],
      events: [],
    },
  };
}

export function buildRoutePolicyManifest(): CompiledRuntimeManifest {
  return {
    tenantId: "tenant-1",
    workspaceId: "workspace-customer-success",
    environment: "sandbox",
    manifestId: "manifest-route-policy",
    publishedVersionId: "published-route-policy",
    workflowId: "workflow-route-policy",
    version: 1,
    runtime: "openai-realtime",
    runtimeProfile: "premium-realtime",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryAgentId: "agent-front",
    entryNodeId: "entry",
    tools: [
      {
        id: "stripe.invoices.search",
        name: "Search invoices",
        description: "Find invoices by customer, email, or invoice number.",
        connector: "stripe",
        requiresHumanApproval: false,
        risk: "low",
      },
    ],
    graph: {
      id: "workflow-route-policy",
      name: "Route policy",
      nodes: [
        node("entry", "entry", "Entry"),
        {
          ...node("agent-front", "agent", "Front desk"),
          config: {
            role: {
              kind: "receptionist",
              name: "Front desk",
              businessName: "Zara AI",
              instructions: "Route callers to the right specialist.",
              defaultModelTier: "cheap",
              runtimeProfileOverride: "premium-realtime",
              realtimeProvider: "openai-realtime",
              languagePolicy: {
                defaultLanguage: "en",
                supportedLanguages: ["en"],
                allowMidCallSwitching: true,
              },
            },
          },
        },
        {
          ...node("agent-billing", "agent", "Billing specialist"),
          config: {
            role: {
              kind: "billing",
              name: "Billing specialist",
              businessName: "Zara AI",
              instructions: "Resolve invoice and payment questions.",
              defaultModelTier: "standard",
              runtimeProfileOverride: "premium-realtime",
              realtimeProvider: "openai-realtime",
              realtimeVoiceConfig: {
                provider: "openai-realtime",
                voice: "cedar",
                speed: 1.8,
              },
              languagePolicy: {
                defaultLanguage: "en",
                supportedLanguages: ["en"],
                allowMidCallSwitching: false,
              },
            },
          },
        },
      ],
      edges: [
        {
          id: "edge-entry-front",
          sourceNodeId: "entry",
          targetNodeId: "agent-front",
        },
      ],
    },
    modelRouting: [],
    escalation: {
      enabled: true,
      fallbackMode: "callback",
      triggers: ["user-request"],
      fallbackMessage: "A specialist will call back.",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    toolBindings: [],
    agentToolAssignments: [
      {
        id: "assignment-search-invoices",
        agentId: "agent-billing",
        toolId: "stripe.invoices.search",
        label: "Search invoices",
        description: "Find invoices by customer, email, or invoice number.",
        whenToUse: "Use after the caller provides invoice context.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
            },
          },
          required: ["query"],
        },
        requiredInputs: ["query"],
        risk: "low",
        requiresHumanApproval: false,
      },
    ],
    conditions: [],
    routePolicies: [
      {
        sourceAgentId: "agent-front",
        sourceAgentName: "Front desk",
        type: "route_by_intent",
        trigger: "on_caller_turn_end",
        activation: "until_routed",
        classifier: {
          mode: "standard",
          modelAlias: "intent-classifier-fast",
          confidenceThreshold: 0.65,
        },
        inputWindow: {
          latestCallerTurn: true,
          recentTranscriptTurns: 6,
          includeConversationSummary: true,
          includePreviousAgentContext: true,
          includeRecentToolResults: true,
        },
        readiness: {
          mode: "auto_with_clarification",
          maxClarificationTurns: 2,
        },
        announcement: {
          mode: "template",
          text: "I'll connect you with {targetAgentName}.",
        },
        branches: [
          {
            id: "branch-billing",
            label: "Billing",
            intentKey: "billing",
            target: {
              type: "agent",
              agentId: "agent-billing",
            },
          },
        ],
        fallback: {
          label: "Clarify",
          target: {
            type: "clarify_source_agent",
          },
        },
      },
    ],
    exitNodes: [],
    returnRoutes: [],
    escalationNode: null,
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 100,
      currentSpendUsd: 0,
      projectedCostPerMinuteUsd: 0.25,
      blockOnLimit: true,
    },
    serializedGraph: "{\"nodes\":[],\"edges\":[]}",
    compiledDefinitionHash: "hash-route-policy",
  } as CompiledRuntimeManifest;
}

export function removeRealtimeProviderFields(manifest: CompiledRuntimeManifest): CompiledRuntimeManifest {
  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((node) => {
        const role = node.config["role"];
        if (node.kind !== "agent" || role === null || typeof role !== "object") {
          return node;
        }
        const nextRole = { ...(role as Record<string, unknown>) };
        delete nextRole["realtimeProvider"];
        delete nextRole["realtimeModelId"];
        return {
          ...node,
          config: {
            ...node.config,
            role: nextRole,
          },
        };
      }),
    },
  };
}

export function buildRoutePolicyManifestWithCatalogZendeskSchema(): CompiledRuntimeManifest {
  const manifest = buildRoutePolicyManifest();

  return {
    ...manifest,
    tools: [
      {
        id: "zendesk.tickets.search",
        name: "Search tickets",
        description: "Search Zendesk tickets by query.",
        connector: "zendesk",
        requiresHumanApproval: false,
        risk: "low",
      },
    ],
    agentToolAssignments: manifest.agentToolAssignments.map((assignment) => ({
      ...assignment,
      toolId: "zendesk.tickets.search",
      label: "Search tickets",
      description: "Search Zendesk tickets by query.",
      whenToUse: "Use after the caller provides support-ticket context.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      requiredInputs: [],
    })),
  } as CompiledRuntimeManifest;
}

export function buildStaleRoutePolicyManifest(): CompiledRuntimeManifest {
  const manifest = buildRoutePolicyManifest();

  return {
    ...manifest,
    manifestId: "manifest-stale-route-policy",
    graph: {
      ...manifest.graph,
      nodes: [
        ...manifest.graph.nodes,
        node("agent-stale", "agent", "New Agent"),
      ],
    },
    routePolicies: manifest.routePolicies.map((routePolicy) => ({
      ...routePolicy,
      branches: [
        ...routePolicy.branches,
        {
          id: "branch-stale",
          label: "Stale",
          intentKey: "stale",
          target: {
            type: "agent",
            agentId: "agent-stale",
          },
        },
      ],
    })),
  };
}

export function buildStaleRoleSnapshotRoutePolicyManifest(): CompiledRuntimeManifest {
  const manifest = buildRoutePolicyManifest();

  return {
    ...manifest,
    manifestId: "manifest-stale-role-snapshot-route-policy",
    routePolicies: [],
  } as CompiledRuntimeManifest;
}

export function buildConcreteAgentConfigRoutePolicyManifest(): CompiledRuntimeManifest {
  const manifest = buildRoutePolicyManifest();
  const concreteBillingRole = {
    kind: "billing",
    name: "James Billing",
    businessName: "Zara AI",
    instructions: "Concrete billing prompt.",
    defaultModelTier: "standard",
    runtimeProfileOverride: "premium-realtime",
    realtimeProvider: "openai-realtime",
    realtimeVoiceConfig: {
      provider: "openai-realtime",
      voice: "verse",
      speed: 1.25,
    },
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      allowMidCallSwitching: false,
    },
  } as const;

  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) =>
        graphNode.id === "agent-billing"
          ? {
              ...graphNode,
              label: "Stale graph label",
              config: {
                ...graphNode.config,
                role: concreteBillingRole,
              },
            }
          : graphNode,
      ),
    },
  };
}

export function buildGeminiRoutePolicyManifest(): CompiledRuntimeManifest {
  const manifest = buildRoutePolicyManifest();
  return {
    ...manifest,
    runtime: "gemini-live",
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) => {
        if (graphNode.kind !== "agent") {
          return graphNode;
        }

        const config = graphNode.config as Record<string, unknown>;
        const role = config["role"] as Record<string, unknown>;

        return {
          ...graphNode,
          config: {
            ...config,
            role: {
              ...role,
              realtimeProvider: "gemini-live",
            },
          },
        };
      }),
    },
  } as CompiledRuntimeManifest;
}

export function withTargetRealtimeConfig(
  manifest: CompiledRuntimeManifest,
  realtimeConfig: Record<string, unknown>,
): CompiledRuntimeManifest {
  return withAgentRealtimeConfig(manifest, "agent-billing", realtimeConfig);
}

export function withAgentRealtimeConfig(
  manifest: CompiledRuntimeManifest,
  agentId: string,
  realtimeConfig: Record<string, unknown>,
): CompiledRuntimeManifest {
  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) => {
        if (graphNode.id !== agentId) {
          return graphNode;
        }

        const role = graphNode.config["role"] as Record<string, unknown>;
        return {
          ...graphNode,
          config: {
            ...graphNode.config,
            role: {
              ...role,
              ...realtimeConfig,
            },
          },
        };
      }),
    },
  };
}

export function openAiHandoffMessage(input: {
  providerCallId: string;
  responseId?: string;
  announcementAlreadySpoken: boolean;
}) {
  return JSON.stringify({
    type: "response.done",
    response: {
      id: input.responseId ?? `response-${input.providerCallId}`,
      status: "completed",
      output: [
        ...(input.announcementAlreadySpoken
          ? [{
              type: "message",
              content: [{
                type: "output_text",
                text: "I'll connect you with Billing specialist.",
              }],
            }]
          : []),
        {
          type: "function_call",
          call_id: input.providerCallId,
          name: "zara_handoff_to_agent",
          arguments: JSON.stringify({
            targetAgentId: "agent-billing",
            reason: "Caller needs invoice status support.",
            callerNeedSummary: "Francis wants the status of a pending invoice.",
          }),
        },
      ],
    },
  });
}

export function openAiResponseDone(responseId: string, status = "completed") {
  return JSON.stringify({
    type: "response.done",
    response: {
      id: responseId,
      status,
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: "I'll connect you with Billing specialist.",
        }],
      }],
    },
  });
}

export function openAiResponseCreated(
  responseId: string,
  metadata: Record<string, string> = handoffResponseMetadata(),
) {
  return JSON.stringify({
    type: "response.created",
    response: {
      id: responseId,
      status: "in_progress",
      metadata,
    },
  });
}

export function handoffResponseMetadata() {
  return {
    zara_handoff_transfer_id: "session-1:turn:1:agent-front:agent-billing",
  };
}

export function buildRoutePolicyManifestWithFrontDeskTool(): CompiledRuntimeManifest {
  const manifest = buildRoutePolicyManifest();
  return {
    ...manifest,
    agentToolAssignments: [
      ...manifest.agentToolAssignments,
      {
        id: "assignment-front-search-invoices",
        agentId: "agent-front",
        toolId: "stripe.invoices.search",
        label: "Search invoices",
        description: "Find invoices by customer, email, or invoice number.",
        whenToUse: "Use if the front desk can answer an invoice lookup directly.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
            },
          },
          required: ["query"],
        },
        requiredInputs: ["query"],
        risk: "low",
        requiresHumanApproval: false,
      },
    ],
  };
}

export function node(
  id: string,
  kind: CompiledRuntimeManifest["graph"]["nodes"][number]["kind"],
  label: string,
) {
  return {
    id,
    kind,
    label,
    position: { x: 0, y: 0 },
    config: {},
  };
}

export function getDefaultBillingTemplate() {
  const template = defaultRuntimePromptPolicy.agentClassTemplates.billing;

  if (template === undefined) {
    throw new Error("Default billing template is missing.");
  }

  return template;
}

export function createLoop(): Pick<
  PremiumRealtimeToolLoopService,
  "processOpenAiProviderMessage" | "processGeminiProviderMessage"
> {
  return {
    processOpenAiProviderMessage: vi.fn(async (input) => ({
      packet: input.packet,
      providerMessages: [
        {
          type: "response.create",
        },
      ],
    })),
    processGeminiProviderMessage: vi.fn(async (input) => ({
      packet: input.packet,
      providerMessages: [
        {
          toolResponse: {
            functionResponses: [],
          },
        },
      ],
    })),
  };
}
