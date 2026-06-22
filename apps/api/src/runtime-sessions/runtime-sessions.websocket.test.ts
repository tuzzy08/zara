import { describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import WebSocket, { type RawData } from "ws";
import type {
  CompiledRuntimeManifest,
  PremiumRealtimeSession,
  TurnRuntimePacket,
} from "@zara/core";

import {
  premiumRealtimeProviderTransportToken,
  type PremiumRealtimeProviderConnection,
  type PremiumRealtimeProviderTransport,
} from "./premium-realtime-provider-transport";
import { RuntimeSessionsWebSocketBridge } from "./runtime-sessions.websocket-bridge";
import { RuntimeSessionsService } from "./runtime-sessions.service";

describe("RuntimeSessionsWebSocketBridge", () => {
  it("requires a single-use transport token before premium provider attachment", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const consumedTokens = new Set<string>();
    const runtimeSessionsService = createRuntimeSessionsService({}, {
      consumeRealtimeSessionTransportToken: vi.fn((input: { sessionId: string; token?: string | undefined }) => {
        if (input.sessionId !== "session-1" || input.token !== "token-1" || consumedTokens.has(input.token)) {
          return null;
        }

        consumedTokens.add(input.token);
        return createRegisteredSession();
      }),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const missingTokenSocket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream");
    await expect(withTimeout(nextCloseWithReason(missingTokenSocket), "missing token close")).resolves.toEqual({
      code: 4401,
      reason: "missing_transport_token",
    });
    expect(providerTransport.connections).toHaveLength(0);

    const mismatchedTokenSocket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-2/stream?token=token-1");
    await expect(withTimeout(nextCloseWithReason(mismatchedTokenSocket), "mismatched token close")).resolves.toEqual({
      code: 4401,
      reason: "invalid_transport_token",
    });
    expect(providerTransport.connections).toHaveLength(0);

    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    await withTimeout(nextOpen(socket), "websocket open");
    expect(providerTransport.connections).toHaveLength(1);
    socket.close();
    await withTimeout(nextClose(socket), "websocket close");

    const replaySocket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    await expect(withTimeout(nextCloseWithReason(replaySocket), "replay token close")).resolves.toEqual({
      code: 4401,
      reason: "invalid_transport_token",
    });
    expect(providerTransport.connections).toHaveLength(1);

    await app.close();
  }, 20_000);

  it("keeps premium browser realtime behind Zara while provider tool calls continue server-side", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const readyPromise = nextMessage(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    expect(providerTransport.connections).toHaveLength(1);
    expect(providerTransport.connections[0]?.input.session.sessionId).toBe("session-1");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));

    const ready = await withTimeout(readyPromise, "session.ready");
    expect(ready).toMatchObject({
      type: "session.ready",
      sessionId: "session-1",
      payload: {
        transport: "websocket",
        provider: "openai-realtime",
      },
    });

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "response-1",
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "provider-call-1",
            name: "zara_zendesk_search_tickets_1234abcd",
            arguments: "{\"query\":\"account activation\"}",
          },
        ],
      },
    }));

    await waitFor(() => providerTransport.connections[0]?.connection.sent.length === 1);

    expect(runtimeSessionsService.processProviderMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      rawProviderMessage: expect.stringContaining("response.done"),
    }));
    expect(providerTransport.connections[0]?.connection.sent).toEqual([
      {
        type: "response.create",
      },
    ]);

    expect(JSON.stringify(ready)).not.toContain("api.openai.com");
    expect(JSON.stringify(ready)).not.toContain("generativelanguage.googleapis.com");

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("surfaces packet-backed tool lifecycle events for docs-style OpenAI function calls", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const processProviderMessage = vi.fn(async () => ({
      packet: packetWithToolLifecycleEvents(),
      providerMessages: [
        {
          event_id: "zara_function_call_output_provider-call-1",
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: "provider-call-1",
            output: JSON.stringify({
              status: "completed",
              summary: "Found one open ticket.",
              safeOutput: {
                count: 1,
              },
            }),
          },
        },
        {
          event_id: "zara_response_create_provider-call-1",
          type: "response.create",
        },
      ],
    }));
    const runtimeSessionsService = createRuntimeSessionsService({}, {
      processProviderMessage,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "response-1",
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "provider-call-1",
            name: "zara_zendesk_search_tickets_1234abcd",
            arguments: "{\"query\":\"account activation\"}",
          },
        ],
      },
    }));

    await waitFor(() => messages.some((message) => message.type === "tool.approval_required"));
    expect(processProviderMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      rawProviderMessage: expect.stringContaining("\"type\":\"response.done\""),
    }));
    expect(messages.map((message) => message.type)).toEqual(expect.arrayContaining([
      "tool.requested",
      "tool.started",
      "tool.completed",
      "tool.failed",
      "tool.approval_required",
    ]));
    expect(messages.find((message) => message.type === "tool.completed")).toMatchObject({
      payload: {
        toolCallId: "provider-call-1",
        toolAssignmentId: "tool-ticket-search",
        toolId: "zendesk.search_tickets",
        toolName: "Search tickets",
        status: "completed",
        summary: "Found one open ticket.",
        safeOutput: {
          count: 1,
        },
      },
    });
    expect(providerTransport.connections[0]?.connection.sent).toEqual([
      {
        event_id: "zara_function_call_output_provider-call-1",
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "provider-call-1",
          output: JSON.stringify({
            status: "completed",
            summary: "Found one open ticket.",
            safeOutput: {
              count: 1,
            },
          }),
        },
      },
      {
        event_id: "zara_response_create_provider-call-1",
        type: "response.create",
      },
    ]);
    expect(JSON.stringify(messages)).not.toContain("provider-secret");
    expect(JSON.stringify(messages)).not.toContain("Authorization");

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("projects premium provider transcripts and audio into sandbox stream events", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const readyPromise = nextMessage(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await withTimeout(readyPromise, "session.ready");

    socket.send(JSON.stringify({
      type: "text.input",
      text: "Hello from the premium sandbox.",
    }));

    const callerTurn = await withTimeout(nextMessage(socket), "turn.transcribed");
    expect(callerTurn).toMatchObject({
      type: "turn.transcribed",
      sessionId: "session-1",
      payload: {
        transcript: "Hello from the premium sandbox.",
        source: "typed",
        provider: "openai-realtime",
      },
    });

    await waitFor(() =>
      providerTransport.connections[0]?.connection.sent.some((message) => message.type === "response.create") ?? false,
    );

    const audioChunkPromise = nextMessageOfType(socket, "turn.audio.chunk");
    const completedPromise = nextMessageOfType(socket, "turn.completed");

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.output_audio.delta",
      delta: "UHJlbWl1bSBhdWRpbyBjaHVuaw==",
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.output_audio_transcript.done",
      transcript: "Premium realtime is active.",
    }));

    const audioChunk = await withTimeout(audioChunkPromise, "turn.audio.chunk");
    expect(audioChunk).toMatchObject({
      type: "turn.audio.chunk",
      sessionId: "session-1",
      payload: {
        audioBase64: "UHJlbWl1bSBhdWRpbyBjaHVuaw==",
        sampleRateHz: 24000,
        provider: "openai-realtime",
      },
    });

    const completed = await withTimeout(completedPromise, "turn.completed");
    expect(completed).toMatchObject({
      type: "turn.completed",
      sessionId: "session-1",
      payload: {
        responseText: "Premium realtime is active.",
        provider: "openai-realtime",
      },
    });

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("handles OpenAI handoff-capable turns before sending an explicit provider response", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const processProviderMessage = vi.fn(async (input) => ({
      session: {
        ...input.session,
        activeAgentId: "agent-billing",
        toolDeclarations: [],
      },
      activeAgentId: "agent-billing",
      packet: {
        ...input.packet,
        intent: {
          nodeId: "agent-front",
          matchedBranchId: "branch-billing",
          intentKey: "billing",
          label: "Billing",
          confidence: 0.93,
          reason: "The caller needs billing help.",
          usedFallback: false,
          targetNodeId: "agent-billing",
        },
      } as TurnRuntimePacket,
      routeEvents: [
        {
          type: "agent.route.announcement",
          payload: {
            nodeId: "agent-front",
            targetAgentId: "agent-billing",
            text: "I'll connect you with Billing specialist.",
          },
        },
        {
          type: "agent.handoff.completed",
            payload: {
              nodeId: "agent-front",
              transferId: "session-1:turn:1:agent-front:agent-billing",
              sourceAgentId: "agent-front",
              sourceAgentName: "Front desk",
              targetAgentId: "agent-billing",
              targetAgentName: "Billing specialist",
            },
          },
      ],
      providerMessages: [
        {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: "provider-handoff-1",
            output: JSON.stringify({ status: "completed" }),
          },
        },
        {
          type: "session.update",
          session: {
            instructions: "You are Billing specialist.",
            audio: {
              output: {
                voice: "cedar",
              },
              input: {
                turn_detection: {
                  create_response: true,
                },
              },
            },
          },
        },
        {
          type: "response.create",
        },
      ],
    }));
    const runtimeSessionsService = createRuntimeSessionsService({
      activeAgentId: "role-front",
    }, {
      processProviderMessage,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-user-1",
      transcript: "I need help with invoice INV-1042.",
    }));

    await waitFor(() =>
      providerTransport.connections[1]?.connection.sent.some((message) => message.type === "response.create") ?? false,
    );

    expect(processProviderMessage).toHaveBeenCalledWith(expect.objectContaining({
      activeAgentId: "role-front",
      rawProviderMessage: expect.stringContaining("INV-1042"),
    }));
    expect(runtimeSessionsService.updateRegisteredSession).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        activeAgentId: "agent-billing",
      }),
      activeAgentId: "agent-billing",
      packet: expect.objectContaining({
        intent: expect.objectContaining({
          intentKey: "billing",
        }),
      }),
    }));
    await waitFor(() => providerTransport.connections.length === 2);
    expect(providerTransport.connections[1]?.input.session).toMatchObject({
      activeAgentId: "agent-billing",
      toolDeclarations: [],
    });
    expect(providerTransport.connections[0]?.connection.sent).toEqual([]);
    expect(providerTransport.connections[1]?.connection.sent).toEqual([
      {
        type: "response.create",
      },
    ]);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "agent.route.announcement",
        payload: expect.objectContaining({
          text: "I'll connect you with Billing specialist.",
        }),
      }),
      expect.objectContaining({
        type: "agent.handoff.completed",
        payload: expect.objectContaining({
          targetAgentId: "agent-billing",
        }),
      }),
    ]));

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("forwards routed-agent audio after the router preamble consumes the caller turn", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const processProviderMessage = vi.fn(async (input) => {
      if (!input.rawProviderMessage.includes("function_call")) {
        return {
          packet: input.packet,
          providerMessages: [],
        };
      }

      return {
        session: {
          ...input.session,
          activeAgentId: "role-billing",
          toolDeclarations: [],
        },
        activeAgentId: "role-billing",
        packet: input.packet,
        routeEvents: [
          {
            type: "agent.handoff.completed",
            payload: {
              nodeId: "agent-front",
              transferId: "session-1:turn:1:agent-front:agent-billing",
              sourceAgentId: "role-front",
              sourceAgentName: "Front desk",
              targetAgentId: "role-billing",
              targetAgentName: "Billing specialist",
            },
          },
        ],
        providerMessages: [
          {
            type: "session.update",
            session: {
              instructions: "You are Billing specialist.",
              audio: {
                input: {
                  turn_detection: {
                    create_response: true,
                  },
                },
              },
            },
          },
          {
            type: "response.create",
          },
        ],
      };
    });
    const runtimeSessionsService = createRuntimeSessionsService({
      activeAgentId: "role-front",
    }, {
      processProviderMessage,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-user-1",
      transcript: "My name is Francis and I need invoice status help.",
    }));
    await waitFor(() => messages.some((message) => message.type === "turn.transcribed"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "response-router",
        status: "in_progress",
      },
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.output_audio_transcript.done",
      transcript: "Let me route you to Billing.",
    }));
    await waitFor(() => messages.some((message) =>
      message.type === "turn.completed"
      && (message.payload as { responseText?: string } | undefined)?.responseText === "Let me route you to Billing.",
    ));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "response-router",
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "provider-handoff-1",
            name: "zara_handoff_to_agent",
            arguments: JSON.stringify({
              targetAgentId: "agent-billing",
              reason: "Caller needs invoice status support.",
              callerNeedSummary: "Francis wants invoice status.",
            }),
          },
        ],
      },
    }));
    await waitFor(() =>
      providerTransport.connections[0]?.connection.sent.some((message) => message.type === "response.create") ?? false,
    );

    const billingAudio = Buffer.from("billing-audio", "utf8").toString("base64");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "response-billing",
        status: "in_progress",
      },
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.audio.delta",
      delta: billingAudio,
    }));

    await waitFor(() => messages.some((message) =>
      message.type === "turn.audio.chunk"
      && (message.payload as { audioBase64?: string } | undefined)?.audioBase64 === billingAudio,
    ));

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("forwards routed-agent audio after the source agent announces a delayed OpenAI route", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const processProviderMessage = vi.fn(async (input) => {
      if (input.rawProviderMessage.includes("provider-handoff-1")) {
        return {
          packet: input.packet,
          routeEvents: [],
          providerMessages: [
            {
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: "provider-handoff-1",
                output: JSON.stringify({ status: "completed" }),
              },
            },
            {
              type: "response.create",
              response: {
                instructions: "Say exactly this handoff message to the caller, then stop: \"Got it, I'll be routing you to Bill from Billing.\"",
              },
            },
          ],
        };
      }

      if (input.rawProviderMessage.includes("response-announcement")) {
        return {
          session: {
            ...input.session,
            activeAgentId: "role-billing",
            toolDeclarations: [],
          },
          activeAgentId: "role-billing",
          packet: input.packet,
          routeEvents: [
            {
              type: "agent.handoff.completed",
              payload: {
                nodeId: "agent-front",
                transferId: "session-1:turn:1:agent-front:agent-billing",
                sourceAgentId: "role-front",
                sourceAgentName: "Jane",
                targetAgentId: "role-billing",
                targetAgentName: "Bill",
              },
            },
          ],
          providerMessages: [
            {
              type: "session.update",
              session: {
                instructions: "You are Bill from Billing.",
                audio: {
                  output: {
                    voice: "cedar",
                  },
                  input: {
                    turn_detection: {
                      create_response: true,
                    },
                  },
                },
              },
            },
            {
              type: "response.create",
              response: {
                instructions: "You are now Bill. Continue helping the caller as the active agent.",
              },
            },
          ],
        };
      }

      return {
        packet: input.packet,
        providerMessages: [],
      };
    });
    const runtimeSessionsService = createRuntimeSessionsService({
      activeAgentId: "role-front",
    }, {
      processProviderMessage,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-user-1",
      transcript: "My name is Francis. I would like to know the status of the invoice.",
    }));
    await waitFor(() => messages.some((message) => message.type === "turn.transcribed"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "response-handoff-tool",
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "provider-handoff-1",
            name: "zara_handoff_to_agent",
            arguments: JSON.stringify({
              targetAgentId: "agent-billing",
              reason: "Caller needs invoice status support.",
              callerNeedSummary: "Francis wants invoice status.",
            }),
          },
        ],
      },
    }));
    await waitFor(() =>
      providerTransport.connections[0]?.connection.sent.some((message) => message.type === "response.create") ?? false,
    );

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "response-announcement",
        status: "in_progress",
      },
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.output_audio_transcript.done",
      transcript: "Got it, I'll be routing you to Bill from Billing.",
    }));
    await waitFor(() => messages.some((message) =>
      message.type === "turn.completed"
      && (message.payload as { responseText?: string } | undefined)?.responseText
        === "Got it, I'll be routing you to Bill from Billing.",
    ));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "response-announcement",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_audio",
                transcript: "Got it, I'll be routing you to Bill from Billing.",
              },
            ],
          },
        ],
      },
    }));
    await waitFor(() => providerTransport.connections.length === 2);
    await waitFor(() =>
      providerTransport.connections[1]?.connection.sent.some((message) => message.type === "response.create") ?? false,
    );

    const billingAudio = Buffer.from("billing-audio", "utf8").toString("base64");
    providerTransport.connections[1]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    providerTransport.connections[1]?.connection.emitMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "response-billing",
        status: "in_progress",
      },
    }));
    providerTransport.connections[1]?.connection.emitMessage(JSON.stringify({
      type: "response.audio.delta",
      delta: billingAudio,
    }));

    await waitFor(() => messages.some((message) =>
      message.type === "turn.audio.chunk"
      && (message.payload as { audioBase64?: string } | undefined)?.audioBase64 === billingAudio,
    ));
    expect(messages.filter((message) =>
      message.type === "turn.completed"
      && (message.payload as { responseText?: string } | undefined)?.responseText
        === "Got it, I'll be routing you to Bill from Billing.",
    )).toHaveLength(1);

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("waits for provider setup acknowledgement before reporting the premium session ready", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    expect(providerTransport.connections).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(messages.map((message) => message.type)).not.toContain("session.ready");

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    expect(messages.find((message) => message.type === "session.ready")).toMatchObject({
      type: "session.ready",
      payload: {
        runtimePath: "premium-realtime",
        provider: "openai-realtime",
      },
    });

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("fails the premium browser session when the provider rejects setup before readiness", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "invalid_value",
        message: "Invalid value: unsupported field.",
        param: "session.audio.output.speed",
        event_id: "setup-session-update",
      },
    }));

    await waitFor(() => messages.some((message) => message.type === "session.error"));

    expect(messages.map((message) => message.type)).not.toContain("session.ready");
    expect(runtimeSessionsService.processProviderMessage).not.toHaveBeenCalled();
    expect(messages.find((message) => message.type === "session.error")).toMatchObject({
      payload: {
        provider: "openai-realtime",
        model: "gpt-realtime-2",
        message: "Premium realtime provider setup failed: Invalid value: unsupported field.",
        error: {
          type: "invalid_request_error",
          code: "invalid_value",
          message: "Invalid value: unsupported field.",
          param: "session.audio.output.speed",
          eventId: "setup-session-update",
        },
      },
    });

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("resamples premium OpenAI browser microphone audio to provider PCM before forwarding", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const readyPromise = nextMessage(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await withTimeout(readyPromise, "session.ready");

    socket.send(JSON.stringify({
      type: "audio.append",
      audioBase64: encodePcm16([0, 0.5, -0.5, 0]),
      sampleRateHz: 16_000,
    }));

    await waitFor(() =>
      providerTransport.connections[0]?.connection.sent.some((message) => message.type === "input_audio_buffer.append") ?? false,
    );

    const appendMessage = providerTransport.connections[0]?.connection.sent.find(
      (message) => message.type === "input_audio_buffer.append",
    );
    expect(appendMessage).toMatchObject({
      type: "input_audio_buffer.append",
    });
    const forwardedAudio = String(appendMessage?.audio ?? "");
    expect(decodePcm16SampleCount(forwardedAudio)).toBe(6);

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("does not project premium voice agent output until the provider confirms a caller voice turn", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "conversation.item.input_audio_transcription.delta",
      transcript: "Hello, I need",
      delta: "Hello, I need",
    }));
    await waitFor(() => messages.some((message) => message.type === "stt.partial"));
    expect(messages.find((message) => message.type === "stt.partial")).toMatchObject({
      payload: {
        transcript: "Hello, I need",
        source: "voice",
      },
    });

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.output_audio.delta",
      delta: "UHJlbWF0dXJlIGF1ZGlv",
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.output_audio_transcript.done",
      transcript: "Hey there! Great to hear from you!",
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(messages.map((message) => message.type)).not.toContain("turn.audio.chunk");
    expect(messages.map((message) => message.type)).not.toContain("turn.completed");

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "input_audio_buffer.committed",
      item_id: "item-user-1",
    }));

    await waitFor(() => messages.some((message) => message.type === "turn.completed"));
    expect(messages.map((message) => message.type)).toContain("turn.audio.chunk");
    expect(messages.map((message) => message.type)).not.toContain("turn.transcribed");
    expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
      payload: {
        transcript: "",
        transcriptUnavailable: true,
        responseText: "Hey there! Great to hear from you!",
      },
    });

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("projects an OpenAI response after committed voice input even when input transcription is absent", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "input_audio_buffer.speech_stopped",
      item_id: "item-user-1",
      audio_end_ms: 4672,
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "input_audio_buffer.committed",
      item_id: "item-user-1",
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "resp-1",
        status: "in_progress",
      },
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-1",
        status: "completed",
        output: [
          {
            type: "message",
            id: "item-agent-1",
            content: [
              {
                type: "output_text",
                text: "Hello! Thanks for calling Zara AI. How can I help?",
              },
            ],
          },
        ],
      },
    }));

    await waitFor(() => messages.some((message) => message.type === "turn.completed"));
    expect(messages.map((message) => message.type)).not.toContain("turn.transcribed");
    expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
      payload: {
        transcript: "",
        transcriptUnavailable: true,
        responseText: "Hello! Thanks for calling Zara AI. How can I help?",
        provider: "openai-realtime",
        model: "gpt-realtime-2",
      },
    });
    expect(messages.find((message) =>
      message.type === "provider.diagnostic"
      && (message.payload as { eventType?: string } | undefined)?.eventType === "response.done",
    )).toMatchObject({
      payload: {
        eventType: "response.done",
        outputContentTypes: ["output_text"],
        audioOutputContentPresent: false,
        outputTextLength: 50,
      },
    });

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("does not delay a completed OpenAI response when the next caller capture starts before response.done", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "input_audio_buffer.committed",
      item_id: "item-user-1",
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "resp-1",
        status: "in_progress",
      },
    }));

    socket.send(JSON.stringify({
      type: "audio.append",
      audioBase64: encodePcm16([0, 0.2, -0.2, 0]),
      sampleRateHz: 16_000,
    }));
    await waitFor(() =>
      providerTransport.connections[0]?.connection.sent.some((message) => message.type === "input_audio_buffer.append") ?? false,
    );

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-1",
        status: "completed",
        output: [
          {
            type: "message",
            id: "item-agent-1",
            content: [
              {
                type: "output_text",
                text: "Hello! Thanks for calling Zara AI. How can I help?",
              },
            ],
          },
        ],
      },
    }));

    await waitFor(() => messages.some((message) => message.type === "turn.completed"));

    expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
      payload: {
        transcript: "",
        transcriptUnavailable: true,
        responseText: "Hello! Thanks for calling Zara AI. How can I help?",
      },
    });

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("lets provider-owned turn detection handle premium voice commits", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await withTimeout(nextMessage(socket), "session.ready");

    socket.send(JSON.stringify({
      type: "audio.commit",
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(providerTransport.connections[0]?.connection.sent).toEqual([]);

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("sends Gemini Live typed turns with realtimeInput text instead of clientContent", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService({
      runtime: "gemini-live",
      model: "gemini-3.1-flash-live-preview",
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      setupComplete: {},
    }));
    await withTimeout(nextMessage(socket), "session.ready");

    socket.send(JSON.stringify({
      type: "text.input",
      text: "Hello from Gemini.",
    }));

    await waitFor(() =>
      providerTransport.connections[0]?.connection.sent.some((message) => "realtimeInput" in message) ?? false,
    );
    expect(providerTransport.connections[0]?.connection.sent).toContainEqual({
      realtimeInput: {
        text: "Hello from Gemini.",
      },
    });
    expect(providerTransport.connections[0]?.connection.sent).not.toContainEqual(expect.objectContaining({
      clientContent: expect.anything(),
    }));

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("projects Gemini Live responses from provider input transcripts and turnComplete", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService({
      runtime: "gemini-live",
      model: "gemini-3.1-flash-live-preview",
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      setupComplete: {},
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    socket.send(JSON.stringify({
      type: "audio.append",
      audioBase64: encodePcm16([0, 0.25]),
      sampleRateHz: 16_000,
    }));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      serverContent: {
        inputTranscription: {
          text: "Hello Gemini.",
        },
      },
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      serverContent: {
        modelTurn: {
          parts: [
            {
              inlineData: {
                data: "R2VtaW5pIGF1ZGlv",
                mimeType: "audio/pcm;rate=24000",
              },
            },
          ],
        },
        outputTranscription: {
          text: "Hello, this is Gemini Live.",
        },
        turnComplete: true,
      },
    }));

    await waitFor(() => messages.some((message) => message.type === "turn.completed"));
    expect(messages.map((message) => message.type)).toContain("turn.transcribed");
    expect(messages.map((message) => message.type)).toContain("turn.audio.chunk");
    expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
      payload: {
        transcript: "Hello Gemini.",
        transcriptUnavailable: false,
        responseText: "Hello, this is Gemini Live.",
        provider: "gemini-live",
        model: "gemini-3.1-flash-live-preview",
      },
    });

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("drops a cancelled OpenAI response caller turn before projecting the next response", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "input_audio_buffer.committed",
      item_id: "item-user-1",
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "resp-1",
        status: "in_progress",
      },
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "input_audio_buffer.speech_started",
      item_id: "item-user-2",
      audio_start_ms: 6200,
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.cancelled",
      response: {
        id: "resp-1",
        status: "cancelled",
      },
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "input_audio_buffer.committed",
      item_id: "item-user-2",
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "resp-2",
        status: "in_progress",
      },
    }));
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-2",
        status: "completed",
        output: [
          {
            type: "message",
            id: "item-agent-2",
            content: [
              {
                type: "output_text",
                text: "I heard your follow-up.",
              },
            ],
          },
        ],
      },
    }));

    await waitFor(() => messages.some((message) => message.type === "turn.completed"));
    expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
      payload: {
        transcript: "",
        transcriptUnavailable: true,
        responseText: "I heard your follow-up.",
      },
    });
    expect(messages.filter((message) => message.type === "turn.completed")).toHaveLength(1);
    expect(messages.some((message) =>
      message.type === "provider.diagnostic"
      && (message.payload as { eventType?: string } | undefined)?.eventType === "response.cancelled",
    )).toBe(true);

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);

  it("projects redacted provider evidence instead of generic provider message spam", async () => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const runtimeSessionsService = createRuntimeSessionsService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RuntimeSessionsWebSocketBridge,
        {
          provide: RuntimeSessionsService,
          useValue: runtimeSessionsService,
        },
        {
          provide: premiumRealtimeProviderTransportToken,
          useValue: providerTransport,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const port = getListeningPort(app);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
    });

    await withTimeout(nextOpen(socket), "websocket open");
    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "session.updated",
    }));
    await waitFor(() => messages.some((message) => message.type === "session.ready"));

    providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
      type: "input_audio_buffer.committed",
      item_id: "item-user-1",
      previous_item_id: "item-prev",
    }));

    await waitFor(() => messages.some((message) =>
      message.type === "provider.diagnostic"
      && (message.payload as { eventType?: string } | undefined)?.eventType === "input_audio_buffer.committed",
    ));

    expect(messages.find((message) =>
      message.type === "provider.diagnostic"
      && (message.payload as { eventType?: string } | undefined)?.eventType === "input_audio_buffer.committed",
    )).toMatchObject({
      type: "provider.diagnostic",
      payload: {
        provider: "openai-realtime",
        model: "gpt-realtime-2",
        eventType: "input_audio_buffer.committed",
        itemId: "item-user-1",
        previousItemId: "item-prev",
      },
    });
    expect(messages.map((message) => message.type)).not.toContain("provider.message");

    socket.close();
    await withTimeout(nextClose(socket), "websocket close");
    await app.close();
  }, 20_000);
});

function createRuntimeSessionsService(
  sessionOverrides: Partial<PremiumRealtimeSession> = {},
  options: {
    processProviderMessage?: ReturnType<typeof vi.fn> | undefined;
    consumeRealtimeSessionTransportToken?: ReturnType<typeof vi.fn> | undefined;
  } = {},
) {
  return {
    consumeRealtimeSessionTransportToken: options.consumeRealtimeSessionTransportToken ?? vi.fn(() =>
      createRegisteredSession(sessionOverrides),
    ),
    getRegisteredSession() {
      return createRegisteredSession(sessionOverrides);
    },
    processProviderMessage: options.processProviderMessage ?? vi.fn(async (input: { rawProviderMessage: string }) => ({
      packet: {
        toolCalls: [],
      },
      providerMessages: input.rawProviderMessage.includes("function_call")
        ? [
            {
              type: "response.create",
            },
          ]
        : [],
    })),
    updateRegisteredSession: vi.fn(),
  };
}

function createRegisteredSession(sessionOverrides: Partial<PremiumRealtimeSession> = {}) {
  return {
    organizationId: "tenant-1",
    workspaceId: "workspace-customer-success",
    actorUserId: "user-1",
    activeAgentId: sessionOverrides.activeAgentId ?? "agent-support",
    transcript: "",
    session: {
      sessionId: "session-1",
      manifestId: "manifest-1",
      publishedVersionId: "published-1",
      activeAgentId: "agent-support",
      runtime: "openai-realtime",
      policy: "premium-realtime",
      model: "gpt-realtime-2",
      voice: "expressive",
      transportUrl: "/runtime/realtime/sessions/session-1/stream?token=token-1",
      expiresAt: "2026-06-14T10:00:00.000Z",
      toolDeclarations: [],
      observedEventTypes: [],
      ...sessionOverrides,
    } satisfies PremiumRealtimeSession,
    manifest: {
      tenantId: "tenant-1",
      workspaceId: "workspace-customer-success",
      manifestId: "manifest-1",
      graph: {
        nodes: [
          {
            id: "agent-front",
            kind: "agent",
            label: "Front desk",
            roleId: "role-front",
            position: { x: 0, y: 0 },
            config: {},
          },
          {
            id: "agent-billing",
            kind: "agent",
            label: "Billing specialist",
            roleId: "role-billing",
            position: { x: 0, y: 0 },
            config: {},
          },
        ],
        edges: [],
      },
      routePolicies: [
        {
          sourceAgentId: "agent-front",
          sourceAgentName: "Front desk",
          type: "route_by_intent",
          trigger: "on_caller_turn_end",
          activation: "until_routed",
          branches: [],
          fallback: {
            label: "Clarify",
            target: {
              type: "clarify_source_agent",
            },
          },
        },
      ],
      toolBindings: [],
    } as unknown as CompiledRuntimeManifest,
    packet: {
      toolCalls: [],
    } as unknown as TurnRuntimePacket,
  };
}

function packetWithToolLifecycleEvents(): TurnRuntimePacket {
  return {
    schemaVersion: "turn-runtime-packet.v1",
    ids: {
      tenantId: "tenant-1",
      workspaceId: "workspace-customer-success",
      callSessionId: "session-1",
      turnId: "session-1:turn:1",
      manifestId: "manifest-1",
      manifestVersion: 1,
    },
    timing: {
      startedAt: "2026-06-14T09:00:00.000Z",
      sequence: 5,
    },
    callerInput: {
      latestCallerTurn: "Caller needs a ticket update.",
      source: "voice",
      recentTranscript: [],
    },
    graph: {
      entryNodeId: "agent-support",
      currentNodeId: "agent-support",
      visitedNodeIds: [],
      frontierNodeIds: ["agent-support"],
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
      events: [
        {
          type: "tool.requested",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 1,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-1",
            toolAssignmentId: "tool-ticket-search",
            reason: "Provider requested a realtime tool call.",
          },
        },
        {
          type: "tool.started",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 2,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-1",
            toolAssignmentId: "tool-ticket-search",
            toolId: "zendesk.search_tickets",
            toolName: "Search tickets",
          },
        },
        {
          type: "tool.completed",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 3,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-1",
            toolAssignmentId: "tool-ticket-search",
            toolId: "zendesk.search_tickets",
            toolName: "Search tickets",
            status: "completed",
            summary: "Found one open ticket.",
            durationMs: 25,
            idempotencyKey: "session-1:turn-1:tool-ticket-search:provider-call-1",
            safeOutput: {
              count: 1,
            },
          },
        },
        {
          type: "tool.failed",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 4,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-2",
            toolAssignmentId: "tool-ticket-search",
            toolId: "zendesk.search_tickets",
            toolName: "Search tickets",
            status: "failed",
            summary: "Zendesk was unavailable.",
            durationMs: 10,
            idempotencyKey: "session-1:turn-1:tool-ticket-search:provider-call-2",
            error: {
              code: "provider.unavailable",
              message: "Provider unavailable.",
              recoverable: true,
            },
          },
        },
        {
          type: "tool.approval_required",
          at: "2026-06-14T09:00:00.000Z",
          turnId: "session-1:turn:1",
          sequence: 5,
          nodeId: "agent-support",
          payload: {
            toolCallId: "provider-call-3",
            toolAssignmentId: "tool-ticket-search",
            toolId: "zendesk.search_tickets",
            toolName: "Search tickets",
            status: "approval_required",
            summary: "Tool requires human approval.",
            durationMs: 0,
            idempotencyKey: "session-1:turn-1:tool-ticket-search:provider-call-3",
            error: {
              code: "tool_approval.required",
              message: "Human approval is required before executing this tool.",
              recoverable: true,
            },
          },
        },
      ],
    },
  };
}

class FakePremiumRealtimeProviderTransport implements PremiumRealtimeProviderTransport {
  readonly connections: Array<{
    input: Parameters<PremiumRealtimeProviderTransport["connect"]>[0];
    connection: FakePremiumRealtimeProviderConnection;
  }> = [];

  async connect(input: Parameters<PremiumRealtimeProviderTransport["connect"]>[0]) {
    const connection = new FakePremiumRealtimeProviderConnection();
    this.connections.push({ input, connection });
    return connection;
  }
}

class FakePremiumRealtimeProviderConnection implements PremiumRealtimeProviderConnection {
  readonly sent: Array<Record<string, unknown>> = [];
  private messageHandler: ((message: string) => void) | null = null;
  private closeHandler: ((event: { code: number; reason: string }) => void) | null = null;

  send(message: Record<string, unknown>) {
    this.sent.push(message);
  }

  close(code = 1000, reason = "closed") {
    this.closeHandler?.({ code, reason });
  }

  onMessage(handler: (message: string) => void) {
    this.messageHandler = handler;
  }

  onClose(handler: (event: { code: number; reason: string }) => void) {
    this.closeHandler = handler;
  }

  emitMessage(message: string) {
    this.messageHandler?.(message);
  }
}

function getListeningPort(app: INestApplication) {
  const server = app.getHttpServer() as Server;
  const address = server.address();
  if (typeof address === "object" && address !== null) {
    return address.port;
  }
  throw new Error("Nest test app is not listening on a TCP port.");
}

function nextOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (message: RawData) => {
      try {
        resolve(JSON.parse(message.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function nextMessageOfType(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const listener = (message: RawData) => {
      const parsed = JSON.parse(message.toString()) as Record<string, unknown>;
      if (parsed.type !== type) {
        return;
      }

      socket.off("message", listener);
      resolve(parsed);
    };
    socket.on("message", listener);
  });
}

function nextClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    socket.once("close", () => resolve());
  });
}

function nextCloseWithReason(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    });
  });
}

async function waitFor(predicate: () => boolean) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for predicate.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 1000);
    }),
  ]);
}

function encodePcm16(samples: number[]) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    const value = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    buffer.writeInt16LE(value, index * 2);
  });
  return buffer.toString("base64");
}

function decodePcm16SampleCount(audioBase64: string) {
  return Math.floor(Buffer.from(audioBase64, "base64").byteLength / 2);
}
