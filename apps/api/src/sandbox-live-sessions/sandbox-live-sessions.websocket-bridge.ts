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
import type { LiveSandboxClientMessage } from "./sandbox-live-sessions.models";

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
    const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
    const source = url.searchParams.get("source") ?? undefined;

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      if (
        !this.sandboxLiveSessionsService.authorizeTransportConnection({
          organizationId,
          sessionId,
          token,
          ...(workspaceId !== undefined ? { workspaceId } : {}),
          ...(source !== undefined ? { source } : {}),
        })
      ) {
        client.close(4403, "forbidden");
        return;
      }
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
        void this.handleClientMessage({
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

  private async handleClientMessage(input: {
    organizationId: string;
    sessionId: string;
    message: RawData;
    client: WebSocket;
  }) {
    let payload: LiveSandboxClientMessage;

    try {
      payload = JSON.parse(input.message.toString()) as LiveSandboxClientMessage;
    } catch {
      input.client.close(4400, "invalid_json");
      return;
    }

    try {
      await this.sandboxLiveSessionsService.handleClientTransportMessage({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        message: payload,
      });
    } catch (error) {
      input.client.send(JSON.stringify({
        type: "session.error",
        sessionId: input.sessionId,
        at: new Date().toISOString(),
        payload: {
          message: error instanceof Error ? error.message : "Live sandbox turn failed.",
        },
      }));
    }
  }
}
