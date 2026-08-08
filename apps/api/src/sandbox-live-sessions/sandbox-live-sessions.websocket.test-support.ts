import type { INestApplication } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRuntimeManifest, createAgentRoleNode, createConditionNode, createEndNode, createWorkflowGraph, publishWorkflowVersion, type CompiledRuntimeManifest, type ModelRoutingContext, type ModelRoutingRule, type RuntimeAgentDefinition, type SandwichTextModelProvider, type SandwichTtsProvider } from "@zara/core";
import WebSocket, { type RawData } from "ws";
import { installTestTenantAuth } from "../testing/tenant-auth-request.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";

export const routingRules: ModelRoutingRule[] = [
  {
    id: "route-greeting-cheap",
    priority: 10,
    when: {
      callPhase: "greeting",
      language: "en",
    },
    useTier: "cheap",
    reason: "Greeting turns can stay on the cheapest tier.",
  },
];

export function createTestingApplication(moduleRef: { createNestApplication: () => INestApplication }) {
  const app = moduleRef.createNestApplication();
  installTestTenantAuth(app);
  return app;
}

export function seedSandboxIntegrationState(directoryPath: string) {
  mkdirSync(directoryPath, { recursive: true });
  writeFileSync(
    join(directoryPath, "tenant-west-africa.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        organizationId: "tenant-west-africa",
        pendingConnects: [],
        connections: [
          {
            id: "hubspot-prod",
            organizationId: "tenant-west-africa",
            provider: "hubspot",
            status: "connected",
            connectedBy: "user-ops-lead",
            scopes: ["crm.objects.contacts.read", "crm.objects.notes.write"],
            availability: { scope: "organization" },
            credentialReference: {
              id: "credential-hubspot-prod",
              provider: "hubspot",
              kind: "oauth-token",
              preview: "...prod",
            },
            accountLabel: "HubSpot Production",
            connectedAt: "2026-05-22T10:00:00.000Z",
            health: {
              status: "healthy",
              checkedAt: "2026-05-22T10:00:00.000Z",
              message: "Connector credentials are available.",
            },
            auditEvents: [],
          },
        ],
        credentials: [
          {
            connectionId: "hubspot-prod",
          },
        ],
        toolGrants: [],
        webhookTools: [],
        webhookToolSecrets: [],
      },
      null,
      2,
    ),
    "utf8",
  );
}

export function getListeningPort(app: INestApplication) {
  const address = app.getHttpServer().address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected sandbox websocket test server to listen on a TCP port.");
  }

  return address.port;
}

export function readPayloadString(event: Record<string, unknown>, key: string) {
  const payload = event.payload;

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function nextMatchingMessage(
  socket: WebSocket,
  predicate: (event: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (buffer: RawData) => {
      try {
        const event = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;

        if (!predicate(event)) {
          return;
        }

        cleanup();
        resolve(event);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`Socket closed before matching message: ${code} ${reason.toString("utf8")}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
    };

    socket.on("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

export function nextOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("close", (code, reason) => {
      reject(new Error(`Socket closed before open: ${code} ${reason.toString("utf8")}`));
    });
    socket.once("error", reject);
  });
}

export function settle() {
  return new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

export function withTimeout<TValue>(promise: Promise<TValue>, label: string, timeoutMs = 3_000) {
  return Promise.race([
    promise,
    new Promise<TValue>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    });
    socket.once("error", reject);
  });
}

export function sendVoiceTurn(
  socket: WebSocket,
  transcript: string,
  options: {
    callPhase?: string | undefined;
    intent?: string | undefined;
    sampleRateHz?: number | undefined;
  } = {},
) {
  socket.send(JSON.stringify({
    type: "input.audio.append",
    audioBase64: Buffer.from(transcript, "utf8").toString("base64"),
    sampleRateHz: options.sampleRateHz ?? 16_000,
    ...(options.callPhase !== undefined ? { callPhase: options.callPhase } : {}),
    ...(options.intent !== undefined ? { intent: options.intent } : {}),
  }));
}

export function createCompiledManifest(workspaceId: string): CompiledRuntimeManifest {
  const graph = createWorkflowGraph({
    id: "workflow-live-sandbox-websocket-api",
    name: "Live sandbox websocket API",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 160, y: 80 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Greet the caller and route safely.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: true,
          },
        },
      }),
      createEndNode({
        id: "end-resolved",
        label: "Resolved exit",
        position: { x: 420, y: 140 },
        end: {
          outcome: "resolved",
          closingMessage: "Thanks for calling.",
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-end",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "end-resolved",
      },
    ],
  });

  return compileRuntimeManifest({
    publishedVersion: publishWorkflowVersion({
      workflowId: "workflow-live-sandbox-websocket-api",
      tenantId: "tenant-west-africa",
      workspaceId,
      environment: "production",
      createdBy: "ops-lead",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 420,
        projectedCostPerMinuteUsd: 0.34,
        blockOnLimit: true,
      },
    }),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
  });
}

export function createAgentRoutePolicyManifest(workspaceId: string): CompiledRuntimeManifest {
  const graph = createWorkflowGraph({
    id: "workflow-agent-handoff-action",
    name: "Agent handoff action",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 180, y: 80 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Clarify caller needs and hand off only when the next specialist is clear.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: true,
          },
          routePolicy: {
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
              mode: "agent_requested",
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
                transferInstructions: "Review invoice context before greeting the caller.",
              },
            ],
            fallback: {
              label: "Ask a clarifying question",
              target: {
                type: "clarify_source_agent",
              },
            },
          },
        },
      }),
      createAgentRoleNode({
        id: "agent-billing",
        label: "Billing specialist",
        position: { x: 520, y: 80 },
        role: {
          kind: "billing",
          name: "Billing specialist",
          businessName: "Tuzzy Labs",
          instructions: "Handle invoice and payment questions.",
          defaultModelTier: "standard",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
    ],
  });

  return compileRuntimeManifest({
    publishedVersion: publishWorkflowVersion({
      workflowId: "workflow-agent-handoff-action",
      tenantId: "tenant-west-africa",
      workspaceId,
      environment: "production",
      createdBy: "ops-lead",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 420,
        projectedCostPerMinuteUsd: 0.34,
        blockOnLimit: true,
      },
    }),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
  });
}

export function ensureWorkspaceAccess(workspacesService: WorkspacesService) {
  const organizationId = "tenant-west-africa";
  const workspaceId = "workspace-default";
  const actorUserId = "user-ops-lead";
  const state = workspacesService.getWorkspaceState(organizationId);

  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) {
    workspacesService.createWorkspace({
      organizationId,
      name: "Default workspace",
      actorUserId,
    });
  }

  const nextState = workspacesService.getWorkspaceState(organizationId);
  if (!nextState.memberships.some((membership) =>
    membership.workspaceId === workspaceId
    && membership.tenantId === organizationId
    && membership.userId === actorUserId
  )) {
    workspacesService.setMembershipRole({
      organizationId,
      workspaceId,
      userId: actorUserId,
      role: "admin",
      actorUserId,
    });
  }
}

export function createConditionAgentRouteManifest(workspaceId: string): CompiledRuntimeManifest {
  const graph = createWorkflowGraph({
    id: "workflow-live-sandbox-graph-execution",
    name: "Live sandbox graph execution",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 180, y: 80 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Greet the caller and identify the lane.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: true,
          },
        },
      }),
      createConditionNode({
        id: "condition-route",
        label: "Intent route",
        position: { x: 420, y: 80 },
        condition: {
          branches: [
            {
              id: "branch-billing",
              label: "Billing",
              expression: 'intent == "billing"',
              targetNodeId: "agent-billing",
            },
          ],
          fallbackLabel: "Resolved",
          fallbackTargetNodeId: "end-resolved",
        },
      }),
      createAgentRoleNode({
        id: "agent-billing",
        label: "Billing specialist",
        position: { x: 860, y: 24 },
        role: {
          kind: "billing",
          name: "Billing specialist",
          businessName: "Tuzzy Labs",
          instructions: "Handle billing questions clearly and directly.",
          defaultModelTier: "standard",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
        },
      }),
      createEndNode({
        id: "end-resolved",
        label: "Resolved exit",
        position: { x: 860, y: 180 },
        end: {
          outcome: "resolved",
          closingMessage: "Thanks for calling.",
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-condition",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "condition-route",
      },
      {
        id: "edge-condition-billing",
        sourceNodeId: "condition-route",
        targetNodeId: "agent-billing",
      },
      {
        id: "edge-condition-fallback",
        sourceNodeId: "condition-route",
        targetNodeId: "end-resolved",
      },
    ],
  });

  return compileRuntimeManifest({
    publishedVersion: publishWorkflowVersion({
      workflowId: "workflow-live-sandbox-graph-execution",
      tenantId: "tenant-west-africa",
      workspaceId,
      environment: "production",
      createdBy: "ops-lead",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 420,
        projectedCostPerMinuteUsd: 0.34,
        blockOnLimit: true,
      },
    }),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
  });
}

export function createConditionAgentRouteManifestWithStaleBillingSnapshot(workspaceId: string): CompiledRuntimeManifest {
  const manifest = createConditionAgentRouteManifest(workspaceId);

  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) => {
        if (graphNode.id !== "agent-billing") {
          return graphNode;
        }

        const config = graphNode.config as Record<string, unknown>;
        const roleConfig = config["role"] as Record<string, unknown>;

        return {
          ...graphNode,
          label: "Stale graph label",
          config: {
            ...config,
            role: {
              ...roleConfig,
              name: "Billing specialist",
              modelProvider: "google-gemini",
              languagePolicy: {
                defaultLanguage: "fr",
                supportedLanguages: ["fr"],
                allowMidCallSwitching: false,
              },
            },
          },
        };
      }),
    },
  };
}

export function withAgentRoleConfig(
  manifest: CompiledRuntimeManifest,
  agentId: string,
  overrides: Record<string, unknown>,
): CompiledRuntimeManifest {
  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) => {
        if (graphNode.id !== agentId) {
          return graphNode;
        }

        const config = graphNode.config as Record<string, unknown>;
        const roleConfig = config["role"] as Record<string, unknown>;

        return {
          ...graphNode,
          config: {
            ...config,
            role: {
              ...roleConfig,
              ...overrides,
            },
          },
        };
      }),
    },
  };
}

export function createToolExecutionManifest(
  workspaceId: string,
  input: {
    toolId?: string | undefined;
    toolLabel?: string | undefined;
    toolName?: string | undefined;
    connector?: "zendesk" | "hubspot" | "google-workspace" | "notion" | "webhook" | "internal" | undefined;
  } = {},
): CompiledRuntimeManifest {
  const toolId = input.toolId ?? "hubspot.profile.lookup";
  const toolLabel = input.toolLabel ?? "Customer profile API";
  const toolName = input.toolName ?? "Customer profile lookup";
  const connector = input.connector ?? "webhook";
  const graph = createWorkflowGraph({
    id: "workflow-live-sandbox-tool-execution",
    name: "Live sandbox tool execution",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 180, y: 80 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Greet the caller, use tools when needed, then continue safely.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: true,
          },
          toolbeltAssignments: [
            {
              id: "customer-profile-lookup",
              toolId,
              label: toolLabel,
              description: toolName,
              whenToUse: `Use when Front desk triage needs ${toolName}.`,
              connector,
              toolName,
              integrationConnectionId: "hubspot-prod",
              integrationLabel: "HubSpot - Production",
              connectionStatus: "connected",
              risk: "medium",
              requiresAuthorization: false,
              requiresHumanApproval: false,
              request: {
                method: "POST",
                url: "https://sandbox.example.test/customer-profile",
                authToken: "sandbox-tool-token",
                headers: [
                  { name: "content-type", value: "application/json" },
                ],
                bodyTemplate: "{\"transcript\":\"{{turn.transcript}}\"}",
              },
            },
          ],
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
    ],
  });

  return compileRuntimeManifest({
    publishedVersion: publishWorkflowVersion({
      workflowId: "workflow-live-sandbox-tool-execution",
      tenantId: "tenant-west-africa",
      workspaceId,
      environment: "production",
      createdBy: "ops-lead",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 420,
        projectedCostPerMinuteUsd: 0.34,
        blockOnLimit: true,
      },
    }),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    availableIntegrationConnectionIds: ["hubspot-prod"],
  });
}

export function createToolExecutionManifestWithStaleEntrySnapshot(
  workspaceId: string,
  input: Parameters<typeof createToolExecutionManifest>[1] = {},
): CompiledRuntimeManifest {
  const manifest = createToolExecutionManifest(workspaceId, input);

  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) => {
        if (graphNode.id !== "agent-front-desk") {
          return graphNode;
        }

        const config = graphNode.config as Record<string, unknown>;
        const roleConfig = config["role"] as Record<string, unknown>;

        return {
          ...graphNode,
          config: {
            ...config,
            role: {
              ...roleConfig,
              name: "Front desk triage",
              languagePolicy: {
                defaultLanguage: "fr",
                supportedLanguages: ["fr"],
                allowMidCallSwitching: false,
              },
            },
          },
        };
      }),
    },
  };
}

export function createFakeTextModelProvider(): SandwichTextModelProvider {
  return {
    async *streamText(input: {
      manifest: CompiledRuntimeManifest;
      activeAgent: RuntimeAgentDefinition;
      transcript: string;
      tier: "rules" | "cheap" | "standard" | "sota";
      context: ModelRoutingContext;
    }) {
      void input;
      yield "Billing support is ready to help with that request.";
    },
  };
}

export function createFailingTextModelProvider(): SandwichTextModelProvider {
  return {
    streamText() {
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.reject(new Error("Live sandbox text model failed after transcription."));
            },
          };
        },
      };
    },
  };
}

export function createTextModelProviderWithAvailability(
  availabilityByProvider: Partial<Record<"openai" | "google-gemini", { configured: boolean; missingEnv: string[] }>>,
): SandwichTextModelProvider {
  return {
    getProviderAvailability(providerId: "openai" | "google-gemini") {
      return availabilityByProvider[providerId] ?? {
        configured: true,
        missingEnv: [],
      };
    },
    async *streamText() {
      yield "This provider should not run when preflight fails.";
    },
  } as SandwichTextModelProvider;
}

export function createFakeTtsProvider(): SandwichTtsProvider {
  return {
    async synthesize() {
      return {
        firstByteLatencyMs: 120,
        wordTimestamps: [
          {
            word: "Billing",
            start: 0,
            end: 0.4,
          },
        ],
        audio: (async function* () {
          yield "QmlsbGluZyBhdWRpbyBjaHVuaw==";
        })(),
      };
    },
  };
}

export function createDelayedAudioTtsProvider(secondAudioChunkGate: Promise<void>): SandwichTtsProvider {
  return {
    async synthesize() {
      return {
        firstByteLatencyMs: 120,
        audio: (async function* () {
          yield "QmlsbGluZyBhdWRpbyBjaHVuay0x";
          await secondAudioChunkGate;
          yield "QmlsbGluZyBhdWRpbyBjaHVuay0y";
        })(),
      };
    },
  };
}

export function createFakeSttProvider() {
  return {
    async transcribeTurn() {
      return {
        transcript: "I need help with billing",
        confidence: 0.93,
        language: "en",
      };
    },
  };
}

export function createStreamingFakeSttProvider(language = "en") {
  const sessions: Array<{
    appendCount: number;
    forceEndpointCount: number;
    terminateCount: number;
    config: Record<string, unknown>;
    updates: Array<Record<string, unknown>>;
  }> = [];

  return {
    sessions,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onPartial: (event: { transcript: string; confidence: number; language: string }) => void;
      onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
      config?: Record<string, unknown> | undefined;
    }) {
      const session = {
        appendCount: 0,
        forceEndpointCount: 0,
        terminateCount: 0,
        config: input.config ?? {},
        updates: [] as Array<Record<string, unknown>>,
      };
      sessions.push(session);

      return {
        appendAudioFrame(audioBase64: string) {
          session.appendCount += 1;
          const transcript = Buffer.from(audioBase64, "base64").toString("utf8")
            || "I need help with billing";
          const partialTranscript = transcript.split(/\s+/).slice(0, 3).join(" ") || transcript;

          input.onPartial({
            transcript: partialTranscript,
            confidence: 0.88,
            language,
          });
          input.onFinal({
            transcript,
            confidence: 0.93,
            language,
          });
        },
        forceEndpoint() {
          session.forceEndpointCount += 1;
        },
        terminate() {
          session.terminateCount += 1;
        },
        updateConfiguration(update: Record<string, unknown>) {
          session.updates.push(update);
        },
        close() {
          session.terminateCount += 1;
        },
      };
    },
    async transcribeTurn() {
      throw new Error("Legacy buffered transcription should not be used for streaming voice sessions.");
    },
  };
}

export function createDuplicateFinalStreamingSttProvider() {
  const sessions: Array<{
    appendCount: number;
    forceEndpointCount: number;
    terminateCount: number;
    config: Record<string, unknown>;
    updates: Array<Record<string, unknown>>;
  }> = [];

  return {
    sessions,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onPartial: (event: { transcript: string; confidence: number; language: string }) => void;
      onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
      config?: Record<string, unknown> | undefined;
    }) {
      const session = {
        appendCount: 0,
        forceEndpointCount: 0,
        terminateCount: 0,
        config: input.config ?? {},
        updates: [] as Array<Record<string, unknown>>,
      };
      sessions.push(session);

      return {
        appendAudioFrame() {
          session.appendCount += 1;

          input.onPartial({
            transcript: "The email address is",
            confidence: 0.88,
            language: "en",
          });
          input.onFinal({
            transcript: "The email address is francis@example.com.",
            confidence: 0.91,
            language: "en",
          });
          input.onFinal({
            transcript: "francis@example.com.",
            confidence: 0.87,
            language: "en",
          });
        },
        forceEndpoint() {
          session.forceEndpointCount += 1;
        },
        terminate() {
          session.terminateCount += 1;
        },
        updateConfiguration(update: Record<string, unknown>) {
          session.updates.push(update);
        },
        close() {
          session.terminateCount += 1;
        },
      };
    },
    async transcribeTurn() {
      throw new Error("Legacy buffered transcription should not be used for streaming voice sessions.");
    },
  };
}

export function createScriptedStreamingSttProvider(
  turns: Array<{
    partial: string;
    final: string;
  }>,
) {
  const sessions: Array<{
    appendCount: number;
    forceEndpointCount: number;
    terminateCount: number;
    config: Record<string, unknown>;
    updates: Array<Record<string, unknown>>;
  }> = [];

  return {
    sessions,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onPartial: (event: { transcript: string; confidence: number; language: string }) => void;
      onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
      config?: Record<string, unknown> | undefined;
    }) {
      const session = {
        appendCount: 0,
        forceEndpointCount: 0,
        terminateCount: 0,
        config: input.config ?? {},
        updates: [] as Array<Record<string, unknown>>,
      };
      sessions.push(session);

      return {
        appendAudioFrame() {
          const turn = turns[session.appendCount];
          session.appendCount += 1;

          if (turn === undefined) {
            return;
          }

          input.onPartial({
            transcript: turn.partial,
            confidence: 0.9,
            language: "en",
          });
          input.onFinal({
            transcript: turn.final,
            confidence: 0.95,
            language: "en",
          });
        },
        forceEndpoint() {
          session.forceEndpointCount += 1;
        },
        terminate() {
          session.terminateCount += 1;
        },
        updateConfiguration(update: Record<string, unknown>) {
          session.updates.push(update);
        },
        close() {
          session.terminateCount += 1;
        },
      };
    },
    async transcribeTurn() {
      throw new Error("Legacy buffered transcription should not be used for streaming voice sessions.");
    },
  };
}

export function createFailingStreamingSttProvider() {
  return {
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onError: (error: Error & { closeCode?: number | undefined; closeReason?: string | undefined }) => void;
    }) {
      return {
        appendAudioFrame() {
          const error = new Error("AssemblyAI streaming session failed with close code 3006: Invalid Message Type.") as Error & {
            closeCode?: number;
            closeReason?: string;
          };
          error.closeCode = 3006;
          error.closeReason = "Invalid Message Type";
          input.onError(error);
        },
        forceEndpoint() {},
        terminate() {},
        updateConfiguration() {},
        close() {},
      };
    },
    async transcribeTurn() {
      throw new Error("Legacy buffered transcription should not be used for streaming voice sessions.");
    },
  };
}

export function createCartesiaLifecycleStreamingSttProvider() {
  const sessions: Array<{
    endTurn: () => void;
  }> = [];

  return {
    providerId: "cartesia-ink-2" as const,
    sessions,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onPartial?: ((event: { transcript: string; confidence: number; language: string }) => void) | undefined;
      onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
      onTelemetry?: ((event: {
        event: "turn.start" | "turn.update" | "turn.eager_end" | "turn.resume" | "turn.end";
        transcript?: string | undefined;
        requestId?: string | undefined;
      }) => void) | undefined;
    }) {
      const session = {
        endTurn() {
          input.onTelemetry?.({
            event: "turn.end",
            transcript: "I need help with regards to",
            requestId: "req-cartesia-1",
          });
          input.onFinal({
            transcript: "I need help with regards to",
            confidence: 1,
            language: "en",
          });
        },
      };
      sessions.push(session);

      return {
        appendAudioFrame() {
          input.onTelemetry?.({
            event: "turn.start",
            requestId: "req-cartesia-1",
          });
          input.onPartial?.({
            transcript: "I need help",
            confidence: 1,
            language: "en",
          });
          input.onTelemetry?.({
            event: "turn.update",
            transcript: "I need help",
            requestId: "req-cartesia-1",
          });
          input.onTelemetry?.({
            event: "turn.eager_end",
            transcript: "I need help with regards to",
            requestId: "req-cartesia-1",
          });
          input.onTelemetry?.({
            event: "turn.resume",
            requestId: "req-cartesia-1",
          });
        },
        forceEndpoint() {},
        terminate() {},
        updateConfiguration() {},
        close() {},
      };
    },
    async transcribeTurn() {
      throw new Error("Cartesia Ink 2 buffered transcription should not be used.");
    },
  };
}

export function createCartesiaInkFakeSttProvider() {
  return {
    providerId: "cartesia-ink-2" as const,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession() {
      return {
        appendAudioFrame() {},
        forceEndpoint() {},
        terminate() {},
        updateConfiguration() {},
        close() {},
      };
    },
    async transcribeTurn() {
      throw new Error("Cartesia Ink 2 buffered transcription should not be used.");
    },
  };
}
