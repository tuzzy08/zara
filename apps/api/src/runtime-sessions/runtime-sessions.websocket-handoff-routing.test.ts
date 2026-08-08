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
import { createRuntimeSessionsService, createRegisteredSession, websocketTestProviderConfig, packetWithToolLifecycleEvents, FakePremiumRealtimeProviderTransport, FakePremiumRealtimeProviderConnection, getListeningPort, nextOpen, nextMessage, nextClose, nextCloseWithReason, waitFor, withTimeout, encodePcm16, decodePcm16SampleCount } from "./runtime-sessions.websocket.test-support";

describe("RuntimeSessionsWebSocketBridge handoff-routing", () => {
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
});
