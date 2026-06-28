import { describe, expect, it, vi } from "vitest";
import type { CompiledRuntimeManifest, PremiumRealtimeSession } from "@zara/core";

import { WsPremiumRealtimeProviderTransport } from "./premium-realtime-provider-transport";

describe("WsPremiumRealtimeProviderTransport", () => {
  it("configures OpenAI Realtime from provider-native voice settings, not Cartesia voice config", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: {
          sessionId: "session-1",
          manifestId: "manifest-1",
          publishedVersionId: "published-1",
          activeAgentId: "agent-support-node",
          runtime: "openai-realtime",
          policy: "premium-realtime",
          model: "gpt-realtime",
          voice: "expressive",
          transportUrl: "/runtime/realtime/sessions/session-1/stream",
          expiresAt: "2026-06-14T10:00:00.000Z",
          toolDeclarations: [],
          observedEventTypes: [],
        } satisfies PremiumRealtimeSession,
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-support-node", {
                kind: "specialist",
                name: "Jane",
                instructions: "You are Jane.",
                realtimeVoiceConfig: {
                  provider: "openai-realtime",
                  voice: "cedar",
                  speed: 0.9,
                },
                voiceConfig: {
                  provider: "cartesia",
                  voiceId: "cartesia-catalog-female-1",
                  label: "Female 1",
                  sourceType: "catalog",
                  speed: 1.15,
                },
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      });

      expect(connection).toBeTruthy();
      expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
        type: "session.update",
        session: {
          type: "realtime",
          audio: {
            input: {
              format: {
                type: "audio/pcm",
                rate: 24000,
                },
                transcription: {
                  model: "gpt-realtime-whisper",
                  language: "en",
                },
              turn_detection: {
                type: "semantic_vad",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              format: {
                type: "audio/pcm",
                rate: 24000,
              },
              voice: "cedar",
              speed: 0.9,
            },
          },
        },
      });
      expect(String(socket.sent[0])).toContain("The conversation will be only in English.");
      expect(String(socket.sent[0])).toContain("You are Jane for Zara AI.");
      expect(String(socket.sent[0])).not.toContain("New Agent");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("configures OpenAI Realtime from concrete active agent config", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: {
          sessionId: "session-1",
          manifestId: "manifest-1",
          publishedVersionId: "published-1",
          activeAgentId: "agent-support-node",
          runtime: "openai-realtime",
          policy: "premium-realtime",
          model: "gpt-realtime",
          voice: "expressive",
          transportUrl: "/runtime/realtime/sessions/session-1/stream",
          expiresAt: "2026-06-14T10:00:00.000Z",
          toolDeclarations: [],
          observedEventTypes: [],
        } satisfies PremiumRealtimeSession,
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-support-node", {
                kind: "support",
                name: "Jane",
                instructions: "Fresh concrete support instructions.",
                realtimeVoiceConfig: {
                  provider: "openai-realtime",
                  voice: "cedar",
                  speed: 0.9,
                },
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          instructions?: string;
          audio?: {
            output?: {
              voice?: string;
              speed?: number;
            };
          };
        };
      };

      expect(setup.session?.audio?.output?.voice).toBe("cedar");
      expect(setup.session?.audio?.output?.speed).toBe(0.9);
      expect(setup.session?.instructions).toContain("You are Jane for Zara AI.");
      expect(setup.session?.instructions).toContain("Fresh concrete support instructions.");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("builds the premium realtime prompt from the configured role and active tools", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime-2",
        }),
        manifest: {
          agentToolAssignments: [
            {
              id: "assignment-1",
              agentId: "agent-support",
              toolId: "zendesk.search_tickets",
              label: "Search tickets",
              description: "Find support tickets by email, ticket number, or issue summary.",
              whenToUse: "Use after the caller provides enough account or ticket context.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                  },
                },
              },
              requiredInputs: ["query"],
              risk: "low",
              requiresHumanApproval: false,
            },
          ],
          graph: {
            nodes: [
              agentNode("agent-support", {
                kind: "specialist",
                name: "Jane",
                instructions: "Handle inbound calls and determine the caller's support needs.",
                toolIds: ["zendesk.search_tickets"],
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          instructions?: string;
        };
      };

      expect(setup.session?.instructions).toContain("You are Jane for Zara AI.");
      expect(setup.session?.instructions).toContain("Agent class: specialist.");
      expect(setup.session?.instructions).toContain(
        "Handle inbound calls and determine the caller's support needs.",
      );
      expect(setup.session?.instructions).toContain("Available Zara tools");
      expect(setup.session?.instructions).toContain("Search tickets");
      expect(setup.session?.instructions).toContain(
        "Use after the caller provides enough account or ticket context.",
      );
      expect(setup.session?.instructions).not.toContain("api.openai.com");
      expect(setup.session?.instructions).not.toContain("credentialRef");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("keeps OpenAI auto-response enabled when the active agent has an attached route policy", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          activeAgentId: "agent-front-desk",
          runtime: "openai-realtime",
          model: "gpt-realtime-2",
        }),
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-front-desk", {
                kind: "receptionist",
                name: "Front desk",
                instructions: "Understand the caller and route them when a specialist is needed.",
              }),
              agentNode("agent-billing", {
                kind: "billing",
                name: "Bill",
                instructions: "Handle invoice questions.",
              }),
            ],
          },
          routePolicies: [
            {
              sourceAgentId: "agent-front-desk",
              sourceAgentName: "Front desk",
              type: "route_by_intent",
              trigger: "on_caller_turn_end",
              activation: "until_routed",
              classifier: {
                modelAlias: "intent-classifier-fast",
                confidenceThreshold: 0.65,
              },
              inputWindow: {
                latestCallerTurnOnly: false,
                recentTranscriptTurns: 4,
              },
              readiness: {
                mode: "auto_with_clarification",
                maxClarificationTurns: 1,
              },
              announcement: {
                mode: "template",
                text: "I will route you to {targetAgentName}.",
              },
              branches: [
                {
                  id: "route-billing",
                  label: "Bill",
                  intentKey: "billing",
                  description: "Caller needs help from Bill.",
                  examples: ["I need help with an invoice."],
                  target: {
                    type: "agent",
                    agentId: "agent-billing",
                  },
                },
              ],
              fallback: {
                label: "Keep with front desk",
                target: {
                  type: "clarify_source_agent",
                },
              },
            },
          ],
        } as unknown as CompiledRuntimeManifest,
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          instructions?: string;
        };
      };

      expect(setup).toMatchObject({
        session: {
          audio: {
            input: {
              turn_detection: {
                create_response: true,
                interrupt_response: true,
              },
            },
          },
        },
      });
      expect(setup.session?.instructions).toContain("Configured handoff targets:");
      expect(setup.session?.instructions).toContain("agent-billing: Bill (billing).");
      expect(setup.session?.instructions).toContain("Handoff before doing specialist work yourself.");
      expect(setup.session?.instructions).toContain(
        "Do not ask for specialist-specific account, invoice, order, ticket, or payment details before handoff.",
      );
      expect(setup.session?.instructions).not.toContain("route-billing");
      expect(setup.session?.instructions).not.toContain("Caller needs help from Bill.");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("omits handoff instructions when no route policy is attached to the active agent", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          activeAgentId: "agent-front-desk",
          runtime: "openai-realtime",
          model: "gpt-realtime-2",
        }),
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-front-desk", {
                kind: "receptionist",
                name: "Front desk",
                instructions: "Understand the caller and route them when a specialist is needed.",
              }),
              agentNode("agent-billing", {
                kind: "billing",
                name: "Billing specialist",
                instructions: "Handle invoice questions.",
              }),
            ],
          },
          routePolicies: [],
        } as unknown as CompiledRuntimeManifest,
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          instructions?: string;
        };
      };

      expect(setup.session?.instructions).not.toContain("Configured handoff targets:");
      expect(setup.session?.instructions).not.toContain("Billing specialist");
      expect(setup.session?.instructions).not.toContain("zara_handoff_to_agent");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("rejects premium realtime transport setup when the active agent is missing from the manifest", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await expect(transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime-2",
        }),
        manifest: {
          manifestId: "manifest-1",
          graph: {
            nodes: [
              agentNode("agent-other", {
                kind: "support",
                name: "Other",
                instructions: "Handle calls.",
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      })).rejects.toThrow(
        "Premium realtime active agent 'agent-support' was not found in runtime manifest 'manifest-1'.",
      );
      expect(socket.sent).toEqual([]);
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("defaults OpenAI Realtime to its provider default when only Cartesia TTS config exists", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-support", {
                kind: "specialist",
                name: "Jane",
                instructions: "You are Jane.",
                voiceConfig: {
                  provider: "cartesia",
                  voiceId: "cartesia-catalog-female-1",
                  label: "Female 1",
                  sourceType: "catalog",
                  speed: 1.15,
                },
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      });

      const setup = JSON.parse(socket.sent[0] ?? "{}") as {
        session?: {
          audio?: {
            output?: Record<string, unknown>;
          };
        };
      };
      expect(setup.session?.audio?.output).toMatchObject({
        voice: "marin",
      });
      expect(setup.session?.audio?.output).not.toHaveProperty("speed");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("configures Gemini Live from provider-native voice settings", async () => {
    const previousGeminiApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "gemini-live",
          model: "gemini-3.1-flash-live-preview",
        }),
        manifest: {
          graph: {
            nodes: [
              agentNode("agent-support", {
                kind: "specialist",
                name: "Jane",
                instructions: "You are Jane.",
                realtimeVoiceConfig: {
                  provider: "gemini-live",
                  voiceName: "Puck",
                },
                voiceConfig: {
                  provider: "cartesia",
                  voiceId: "cartesia-catalog-female-1",
                  label: "Female 1",
                  sourceType: "catalog",
                },
              }),
            ],
          },
        } as unknown as CompiledRuntimeManifest,
      });

      expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
        setup: {
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Puck",
              },
            },
          },
        },
      });
    } finally {
      if (previousGeminiApiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiApiKey;
      }
    }
  });
});

function createSession(input: {
  runtime: PremiumRealtimeSession["runtime"];
  model: string;
  activeAgentId?: string | undefined;
}): PremiumRealtimeSession {
  return {
    sessionId: "session-1",
    manifestId: "manifest-1",
    publishedVersionId: "published-1",
    activeAgentId: input.activeAgentId ?? "agent-support",
    runtime: input.runtime,
    policy: "premium-realtime",
    model: input.model,
    voice: "expressive",
    transportUrl: "/runtime/realtime/sessions/session-1/stream",
    expiresAt: "2026-06-14T10:00:00.000Z",
    toolDeclarations: [],
    observedEventTypes: [],
  };
}

function agentNode(id: string, role: Record<string, unknown>) {
  return {
    id,
    kind: "agent",
    label: String(role.name ?? id),
    config: {
      role: {
        businessName: "Zara AI",
        defaultModelTier: "standard",
        toolIds: [],
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        ...role,
      },
    },
  };
}

function createSocketLike() {
  const handlers = new Map<string, (...args: never[]) => void>();
  const socket = {
    readyState: 1,
    sent: [] as string[],
    send: vi.fn((message: string) => {
      socket.sent.push(message);
    }),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: never[]) => void) => {
      handlers.set(event, handler);
    }),
  };

  return socket;
}
