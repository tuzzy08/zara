import { describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import WebSocket from "ws";
import { premiumRealtimeProviderTransportToken } from "./premium-realtime-provider-transport";
import { RuntimeSessionsWebSocketBridge } from "./runtime-sessions.websocket-bridge";
import { RuntimeSessionsService } from "./runtime-sessions.service";
import { createRuntimeSessionsService, FakePremiumRealtimeProviderTransport, getListeningPort, nextOpen, nextClose, nextCloseWithReason, waitFor, withTimeout } from "./runtime-sessions.websocket.test-support";

describe("RuntimeSessionsWebSocketBridge provider-lifecycle", () => {
  it.each(["notification", "browser close", "browser termination", "provider close"])("still stops the session when %s throws", async fault => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const moduleRef = await Test.createTestingModule({ providers: [RuntimeSessionsWebSocketBridge,
      { provide: RuntimeSessionsService, useValue: createRuntimeSessionsService() },
      { provide: premiumRealtimeProviderTransportToken, useValue: providerTransport },
    ] }).compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0);
    const socket = new WebSocket(`ws://127.0.0.1:${getListeningPort(app)}/runtime/realtime/sessions/session-1/stream?token=token-1`);
    const originalSend = WebSocket.prototype.send;
    const failedSend = vi.spyOn(WebSocket.prototype, "send").mockImplementation(function (this: WebSocket, ...args) {
      if (fault === "notification" && this !== socket && String(args[0]).includes('"type":"session.error"')) throw new Error("private-write-failure");
      return originalSend.apply(this, args);
    });
    const originalBrowserClose = WebSocket.prototype.close;
    const failedClose = vi.spyOn(WebSocket.prototype, "close").mockImplementation(function (this: WebSocket, ...args) {
      if (fault.startsWith("browser") && this !== socket) throw new Error("private-close-failure");
      return originalBrowserClose.apply(this, args);
    });
    const originalTerminate = WebSocket.prototype.terminate;
    const failedTerminate = vi.spyOn(WebSocket.prototype, "terminate").mockImplementation(function (this: WebSocket) {
      if (fault === "browser termination" && this !== socket) throw new Error("private-termination-failure");
      return originalTerminate.call(this);
    });
    const providerCloseReasons: string[] = [];
    try {
      await withTimeout(nextOpen(socket), "websocket open");
      const connection = providerTransport.connections[0]!.connection;
      connection.send = () => { throw new Error("private-provider-failure"); };
      const originalClose = connection.close.bind(connection);
      connection.close = (code, reason) => {
        providerCloseReasons.push(reason ?? "");
        if (fault === "provider close") throw new Error("private-provider-close-failure");
        originalClose(code, reason);
      };
      const closed = nextCloseWithReason(socket);
      connection.emitMessage(JSON.stringify({ type: "response.function_call_arguments.done" }));
      if (fault === "browser termination") {
        await waitFor(() => providerCloseReasons.includes("runtime_message_failed"));
        socket.terminate();
      }
      expect(await withTimeout(closed, "safe websocket close")).toEqual(fault.startsWith("browser")
        ? { code: 1006, reason: "" } : { code: 1011, reason: "runtime_message_failed" });
      expect(providerCloseReasons).toContain("runtime_message_failed");
    } finally {
      failedSend.mockRestore();
      failedClose.mockRestore();
      failedTerminate.mockRestore();
      socket.terminate();
      await app.close();
    }
  });
  it.each(["browser audio", "provider continuation"])("closes the browser safely when %s reaches a closed provider", async source => {
    const providerTransport = new FakePremiumRealtimeProviderTransport();
    const moduleRef = await Test.createTestingModule({ providers: [RuntimeSessionsWebSocketBridge,
      { provide: RuntimeSessionsService, useValue: createRuntimeSessionsService() },
      { provide: premiumRealtimeProviderTransportToken, useValue: providerTransport },
    ] }).compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0);
    const socket = new WebSocket(`ws://127.0.0.1:${getListeningPort(app)}/runtime/realtime/sessions/session-1/stream?token=token-1`);
    const messages: unknown[] = [];
    socket.on("message", message => messages.push(JSON.parse(message.toString())));
    try {
      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]!.connection.send = () => { throw new Error("private-database-secret"); };
      const closed = nextCloseWithReason(socket);
      if (source === "browser audio") socket.send(JSON.stringify({ type: "audio.append", audioBase64: "AAA=" }));
      else providerTransport.connections[0]!.connection.emitMessage(JSON.stringify({ type: "response.function_call_arguments.done" }));
      expect(await withTimeout(closed, "safe websocket close")).toEqual({ code: 1011, reason: "runtime_message_failed" });
      expect(messages).toContainEqual(expect.objectContaining({ type: "session.error",
        payload: { message: "Premium realtime session failed." } }));
      expect(JSON.stringify(messages)).not.toContain("private-database-secret");
    } finally {
      socket.terminate();
      await app.close();
    }
  });
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
