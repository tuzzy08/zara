import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import {
  WebSocketServer,
  type RawData,
  type WebSocket,
} from "ws";

import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";

@Injectable()
export class SandboxLiveSessionsWebSocketBridge
implements OnApplicationBootstrap, OnApplicationShutdown {
  private websocketServer: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly sandboxLiveSessionsService: SandboxLiveSessionsService,
  ) {}

  onApplicationBootstrap() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.httpServer = httpServer;
    this.websocketServer = new WebSocketServer({
      noServer: true,
    });
    httpServer.on("upgrade", this.handleUpgrade);
  }

  onApplicationShutdown() {
    if (this.httpServer !== null) {
      this.httpServer.off("upgrade", this.handleUpgrade);
    }

    this.websocketServer?.close();
    this.websocketServer = null;
  }

  private readonly handleUpgrade = (
    request: Parameters<HttpServer["emit"]>[1] & { url?: string | undefined },
    socket: Duplex,
    head: Buffer,
  ) => {
    const websocketServer = this.websocketServer;

    if (websocketServer === null || request.url === undefined) {
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    const match = url.pathname.match(
      /^\/organizations\/([^/]+)\/sandbox\/live-sessions\/([^/]+)\/stream$/,
    );

    if (match === null) {
      return;
    }

    const organizationId = decodeURIComponent(match[1] ?? "");
    const sessionId = decodeURIComponent(match[2] ?? "");
    const token = url.searchParams.get("token") ?? "";

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      if (
        !this.sandboxLiveSessionsService.validateTransportToken({
          organizationId,
          sessionId,
          token,
        })
      ) {
        client.close(4403, "forbidden");
        return;
      }

      this.sandboxLiveSessionsService.markSessionActive({
        organizationId,
        sessionId,
      });
      websocketServer.emit("connection", client, request);

      const unsubscribe = this.sandboxLiveSessionsService.subscribeToSession(
        {
          organizationId,
          sessionId,
        },
        (event) => {
          client.send(JSON.stringify(event));
        },
      );

      client.once("close", unsubscribe);
      client.on("message", (message) => {
        this.handleClientMessage({
          organizationId,
          sessionId,
          message,
          client,
        });
      });

      setImmediate(() => {
        this.sandboxLiveSessionsService.publishSessionEvent({
          organizationId,
          sessionId,
          type: "session.ready",
          payload: {
            transport: "websocket",
          },
        });
      });
    });
  };

  private handleClientMessage(input: {
    organizationId: string;
    sessionId: string;
    message: RawData;
    client: WebSocket;
  }) {
    try {
      const payload = JSON.parse(input.message.toString()) as Record<string, unknown>;
      this.sandboxLiveSessionsService.publishSessionEvent({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        type: "client.message",
        payload,
      });
    } catch {
      input.client.close(4400, "invalid_json");
    }
  }
}
