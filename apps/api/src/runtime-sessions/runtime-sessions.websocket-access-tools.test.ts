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

describe("RuntimeSessionsWebSocketBridge access-tools", () => {
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

  it("keeps the caller turn available for OpenAI tool-result follow-up answers after a spoken tool preamble", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const processProviderMessage = vi.fn(async (input: { rawProviderMessage: string; packet: TurnRuntimePacket }) => {
        if (!input.rawProviderMessage.includes("provider-call-1")) {
          return {
            packet: input.packet,
            providerMessages: [],
          };
        }

        return {
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
                  summary: "Found one matching ticket.",
                }),
              },
            },
            {
              event_id: "zara_response_create_provider-call-1",
              type: "response.create",
            },
          ],
        };
      });
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
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "item-user-1",
        transcript: "The ticket number is ticket number four.",
      }));
      await waitFor(() => messages.some((message) => message.type === "turn.transcribed"));

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.created",
        response: {
          id: "response-search-preamble",
          status: "in_progress",
        },
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.output_audio_transcript.done",
        transcript: "Got it. Let me search for ticket number 4.",
      }));
      await waitFor(() => messages.some((message) =>
        message.type === "turn.completed"
        && (message.payload as { responseText?: string } | undefined)?.responseText
          === "Got it. Let me search for ticket number 4.",
      ));

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.done",
        response: {
          id: "response-search-preamble",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "provider-call-1",
              name: "zara_zendesk_search_tickets_1234abcd",
              arguments: "{\"query\":\"4\"}",
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
          id: "response-after-tool",
          status: "in_progress",
        },
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.done",
        response: {
          id: "response-after-tool",
          status: "completed",
          output: [
            {
              type: "message",
              id: "item-agent-final",
              content: [
                {
                  type: "output_text",
                  text: "I found one ticket matching number 4. It is currently pending.",
                },
              ],
            },
          ],
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 25));

      const completedTexts = messages
        .filter((message) => message.type === "turn.completed")
        .map((message) => (message.payload as { responseText?: string } | undefined)?.responseText);
      expect(completedTexts).toEqual(expect.arrayContaining([
        "Got it. Let me search for ticket number 4.",
        "I found one ticket matching number 4. It is currently pending.",
      ]));

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);

  it("rejects retired premium typed browser input", async () => {
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

      await expect(withTimeout(nextCloseWithReason(socket), "typed input rejection")).resolves.toEqual({
        code: 4400,
        reason: "unsupported_message_type",
      });

      await app.close();
    }, 20_000);
});
