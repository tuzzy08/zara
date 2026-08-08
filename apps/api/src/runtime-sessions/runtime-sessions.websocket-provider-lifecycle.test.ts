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

describe("RuntimeSessionsWebSocketBridge provider-lifecycle", () => {
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

  it("emits structured provider error events after premium sessions are ready", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService({
        activeAgentId: "agent-billing",
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
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "invalid_schema",
          message: "Invalid schema for function 'zara_zendesk_tickets_search'.",
          param: "session.tools[1].parameters",
          event_id: "zara_response_create_call_1",
        },
      }));

      await waitFor(() => messages.some((message) => message.type === "provider.error"));

      expect(messages.find((message) =>
        message.type === "provider.diagnostic"
        && (message.payload as { eventType?: string } | undefined)?.eventType === "error",
      )).toMatchObject({
        payload: {
          provider: "openai-realtime",
          model: "gpt-realtime-2",
          eventType: "error",
          error: {
            type: "invalid_request_error",
            code: "invalid_schema",
            message: "Invalid schema for function 'zara_zendesk_tickets_search'.",
            param: "session.tools[1].parameters",
            eventId: "zara_response_create_call_1",
          },
        },
      });
      expect(messages.find((message) => message.type === "provider.error")).toMatchObject({
        payload: {
          provider: "openai-realtime",
          model: "gpt-realtime-2",
          activeAgentId: "agent-billing",
          stage: "provider",
          code: "invalid_schema",
          message: "Invalid schema for function 'zara_zendesk_tickets_search'.",
          recoverable: true,
          param: "session.tools[1].parameters",
          eventId: "zara_response_create_call_1",
        },
      });

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);
});
