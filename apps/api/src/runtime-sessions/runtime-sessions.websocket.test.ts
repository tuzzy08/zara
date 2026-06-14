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
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream");
    const readyPromise = nextMessage(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    expect(providerTransport.connections).toHaveLength(1);
    expect(providerTransport.connections[0]?.input.session.sessionId).toBe("session-1");

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
      type: "response.function_call_arguments.done",
      call_id: "provider-call-1",
      name: "zara_zendesk_search_tickets_1234abcd",
      arguments: "{\"query\":\"account activation\"}",
    }));

    await waitFor(() => providerTransport.connections[0]?.connection.sent.length === 1);

    expect(runtimeSessionsService.processProviderMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      rawProviderMessage: expect.stringContaining("response.function_call_arguments.done"),
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
});

function createRuntimeSessionsService() {
  return {
    getRegisteredSession() {
      return {
        organizationId: "tenant-1",
        workspaceId: "workspace-support",
        actorUserId: "user-1",
        activeRoleId: "agent-support",
        transcript: "",
        session: {
          sessionId: "session-1",
          manifestId: "manifest-1",
          publishedVersionId: "published-1",
          activeRoleId: "agent-support",
          runtime: "openai-realtime",
          policy: "premium-realtime",
          model: "gpt-realtime-2",
          voice: "expressive",
          transportUrl: "/runtime/realtime/sessions/session-1/stream",
          expiresAt: "2026-06-14T10:00:00.000Z",
          toolDeclarations: [],
          observedEventTypes: [],
        } satisfies PremiumRealtimeSession,
        manifest: {
          tenantId: "tenant-1",
          workspaceId: "workspace-support",
          manifestId: "manifest-1",
          toolBindings: [],
        } as unknown as CompiledRuntimeManifest,
        packet: {
          toolCalls: [],
        } as unknown as TurnRuntimePacket,
      };
    },
    processProviderMessage: vi.fn(async () => ({
      packet: {
        toolCalls: [],
      },
      providerMessages: [
        {
          type: "response.create",
        },
      ],
    })),
    updateRegisteredSession: vi.fn(),
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

function nextClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    socket.once("close", () => resolve());
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
