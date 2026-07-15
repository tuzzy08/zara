import { describe, expect, it, vi } from "vitest";
import type { CompiledRuntimeManifest, PremiumRealtimeSession } from "@zara/core";

import { WsPremiumRealtimeProviderTransport } from "./premium-realtime-provider-transport";

describe("WsPremiumRealtimeProviderTransport", () => {
  it("rejects a session whose mutable provider fields drift from its frozen provider contract", async () => {
    const websocketFactory = vi.fn(() => createSocketLike());
    const transport = new WsPremiumRealtimeProviderTransport(websocketFactory);
    const session = createSession({
      runtime: "openai-realtime",
      model: "gpt-realtime",
    });
    session.model = "drifted-model";

    await expect(transport.connect({
      organizationId: "tenant-1",
      workspaceId: "workspace-customer-success",
      actorUserId: "user-1",
      session,
      manifest: createManifest(),
    })).rejects.toThrow("Premium realtime session provider contract does not match the session projection.");
    expect(websocketFactory).not.toHaveBeenCalled();
  });

  it("waits for OpenAI session.updated before reporting ready", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });
      const ready = vi.fn();
      void connection.waitUntilReady().then(ready);

      await Promise.resolve();
      expect(ready).not.toHaveBeenCalled();

      socket.emitMessage(JSON.stringify({ type: "session.updated" }));
      await expect(connection.waitUntilReady()).resolves.toBeUndefined();
      expect(ready).toHaveBeenCalledOnce();
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("waits for Gemini setupComplete before reporting ready", async () => {
    const previousGeminiApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "gemini-live",
          model: "gemini-3.1-flash-live-preview",
        }),
        manifest: createManifest(),
      });
      const ready = vi.fn();
      void connection.waitUntilReady().then(ready);

      socket.emitMessage(JSON.stringify({ serverContent: {} }));
      await Promise.resolve();
      expect(ready).not.toHaveBeenCalled();

      socket.emitMessage(JSON.stringify({ setupComplete: {} }));
      await expect(connection.waitUntilReady()).resolves.toBeUndefined();
      expect(ready).toHaveBeenCalledOnce();
    } finally {
      if (previousGeminiApiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiApiKey;
      }
    }
  });

  it("rejects readiness when the provider errors before acknowledgement", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });
      const readiness = connection.waitUntilReady();

      socket.emitError(new Error("provider setup failed"));

      await expect(readiness).rejects.toThrow("provider setup failed");
      await expect(connection.waitUntilReady()).rejects.toThrow("provider setup failed");
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("rejects readiness when the provider closes before acknowledgement", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });
      const readiness = connection.waitUntilReady();

      socket.emitClose(1006, "setup rejected");

      await expect(readiness).rejects.toThrow(
        "Provider connection closed before readiness (1006): setup rejected",
      );
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("rejects connection establishment when the provider closes before WebSocket open", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike({ readyState: 0 });
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connecting = transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime" }),
        manifest: createManifest(),
      });
      socket.emitClose(1006, "closed before open");

      await expect(Promise.race([
        connecting,
        new Promise((_, reject) => setTimeout(() => reject(new Error("connection remained pending")), 50)),
      ])).rejects.toThrow("closed before open");
    } finally {
      if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    }
  });

  it("replays a terminal close to a handler registered after readiness", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime" }),
        manifest: createManifest(),
      });
      socket.emitMessage(JSON.stringify({ type: "session.updated" }));
      await connection.waitUntilReady();
      socket.emitClose(1006, "provider disappeared");
      const closes: Array<{ code: number; reason: string }> = [];
      connection.onClose((event) => closes.push(event));

      expect(closes).toEqual([{ code: 1006, reason: "provider disappeared" }]);
    } finally {
      if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    }
  });

  it("reports a provider error after readiness as one terminal close", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({ runtime: "openai-realtime", model: "gpt-realtime" }),
        manifest: createManifest(),
      });
      socket.emitMessage(JSON.stringify({ type: "session.updated" }));
      await connection.waitUntilReady();
      const closes: Array<{ code: number; reason: string }> = [];
      connection.onClose((event) => closes.push(event));

      socket.emitError(new Error("provider transport failed"));
      socket.emitClose(1006, "socket closed");

      expect(closes).toEqual([{ code: 1011, reason: "provider transport failed" }]);
    } finally {
      if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    }
  });

  it("delivers a ready message to a handler registered just after it arrives", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });
      const readyMessage = JSON.stringify({ type: "session.updated" });
      const received: string[] = [];

      socket.emitMessage(readyMessage);
      connection.onMessage((message) => received.push(message));

      expect(received).toEqual([readyMessage]);
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

  it("reports the provider socket buffered bytes after send", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    const socket = createSocketLike();
    const transport = new WsPremiumRealtimeProviderTransport(() => socket);

    try {
      const connection = await transport.connect({
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        session: createSession({
          runtime: "openai-realtime",
          model: "gpt-realtime",
        }),
        manifest: createManifest(),
      });

      connection.send({ type: "input_audio_buffer.append", audio: "AA==" });
      socket.bufferedAmount = 2_048;

      expect(connection.getBufferedAmountBytes()).toBe(2_048);
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });

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
          providerConfig: openAiProviderConfig("pstn"),
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
                type: "audio/pcmu",
                },
                transcription: {
                  model: "gpt-realtime-whisper",
                  language: "en",
                },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              format: {
                type: "audio/pcmu",
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
          providerConfig: openAiProviderConfig("browser"),
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
    providerConfig: input.runtime === "gemini-live"
      ? {
          provider: "gemini-live",
          model: input.model,
          mediaProfile: "browser",
          conversationPolicyVersion: 1,
          media: {
            input: { mimeType: "audio/pcm;rate=16000" },
            output: { mimeType: "audio/pcm;rate=24000" },
          },
          activityHandling: { type: "provider_native" },
        }
      : openAiProviderConfig("browser", input.model),
    voice: "expressive",
    transportUrl: "/runtime/realtime/sessions/session-1/stream",
    expiresAt: "2026-06-14T10:00:00.000Z",
    toolDeclarations: [],
    observedEventTypes: [],
  };
}

function openAiProviderConfig(
  mediaProfile: "browser" | "pstn",
  model = "gpt-realtime",
): Extract<PremiumRealtimeSession["providerConfig"], { provider: "openai-realtime" }> {
  return {
    provider: "openai-realtime",
    model,
    mediaProfile,
    conversationPolicyVersion: 1,
    media: mediaProfile === "pstn"
      ? {
          input: { type: "audio/pcmu" },
          output: { type: "audio/pcmu" },
        }
      : {
          input: { type: "audio/pcm", rate: 24_000 },
          output: { type: "audio/pcm", rate: 24_000 },
        },
    turnDetection: {
      type: "semantic_vad",
      eagerness: mediaProfile === "pstn" ? "low" : "auto",
      createResponse: true,
      interruptResponse: true,
    },
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

function createManifest() {
  return {
    manifestId: "manifest-1",
    graph: {
      nodes: [
        agentNode("agent-support", {
          kind: "support",
          name: "Support",
          instructions: "Handle support calls.",
        }),
      ],
    },
  } as unknown as CompiledRuntimeManifest;
}

function createSocketLike(options: { readyState?: number } = {}) {
  const handlers = new Map<string, (...args: never[]) => void>();
  const socket = {
    readyState: options.readyState ?? 1,
    bufferedAmount: 0,
    sent: [] as string[],
    send: vi.fn((message: string) => {
      socket.sent.push(message);
    }),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: never[]) => void) => {
      handlers.set(event, handler);
    }),
    emitMessage(message: string) {
      handlers.get("message")?.(message as never);
    },
    emitError(error: Error) {
      handlers.get("error")?.(error as never);
    },
    emitClose(code: number, reason: string) {
      handlers.get("close")?.(code as never, Buffer.from(reason) as never);
    },
  };

  return socket;
}
