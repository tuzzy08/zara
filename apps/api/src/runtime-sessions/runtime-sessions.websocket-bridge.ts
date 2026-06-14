import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from "ws";

import {
  premiumRealtimeProviderTransportToken,
  type PremiumRealtimeProviderConnection,
  type PremiumRealtimeProviderTransport,
} from "./premium-realtime-provider-transport";
import { RuntimeSessionsService, type RegisteredPremiumRealtimeSession } from "./runtime-sessions.service";

type PremiumRealtimeBrowserMessage =
  | {
      type: "audio.append";
      audioBase64: string;
    }
  | {
      type: "text.input";
      text: string;
    }
  | {
      type: "session.close";
    };

@Injectable()
export class RuntimeSessionsWebSocketBridge
implements OnApplicationBootstrap, OnApplicationShutdown {
  private websocketServer: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(RuntimeSessionsService)
    private readonly runtimeSessionsService: Pick<
      RuntimeSessionsService,
      "getRegisteredSession" | "processProviderMessage" | "updateRegisteredSession"
    >,
    @Inject(premiumRealtimeProviderTransportToken)
    private readonly providerTransport: PremiumRealtimeProviderTransport,
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
    const match = url.pathname.match(/^\/runtime\/realtime\/sessions\/([^/]+)\/stream$/);
    if (match === null) {
      return;
    }

    const sessionId = decodeURIComponent(match[1] ?? "");
    const registered = this.runtimeSessionsService.getRegisteredSession(sessionId);
    if (registered === null) {
      websocketServer.handleUpgrade(request, socket, head, (client) => {
        client.close(4404, "unknown_session");
      });
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
      void this.attachClient({
        client,
        registered,
      });
    });
  };

  private async attachClient(input: {
    client: WebSocket;
    registered: RegisteredPremiumRealtimeSession;
  }) {
    let providerConnection: PremiumRealtimeProviderConnection;

    try {
      providerConnection = await this.providerTransport.connect({
        organizationId: input.registered.organizationId,
        workspaceId: input.registered.workspaceId,
        actorUserId: input.registered.actorUserId,
        session: input.registered.session,
        manifest: input.registered.manifest,
      });
    } catch (error) {
      input.client.send(JSON.stringify({
        type: "session.error",
        sessionId: input.registered.session.sessionId,
        at: new Date().toISOString(),
        payload: {
          message: error instanceof Error ? error.message : "Premium realtime provider connection failed.",
        },
      }));
      input.client.close(1011, "provider_connection_failed");
      return;
    }

    providerConnection.onMessage((message) => {
      void this.handleProviderMessage({
        client: input.client,
        providerConnection,
        registered: input.registered,
        rawProviderMessage: message,
      });
    });
    providerConnection.onClose((event) => {
      if (input.client.readyState === WebSocket.OPEN) {
        input.client.send(JSON.stringify({
          type: "provider.closed",
          sessionId: input.registered.session.sessionId,
          at: new Date().toISOString(),
          payload: event,
        }));
        input.client.close(1011, "provider_closed");
      }
    });

    input.client.once("close", () => {
      providerConnection.close(1000, "browser_disconnected");
    });
    input.client.on("message", (message) => {
      this.handleClientMessage({
        client: input.client,
        providerConnection,
        session: input.registered.session,
        message,
      });
    });

    input.client.send(JSON.stringify({
      type: "session.ready",
      sessionId: input.registered.session.sessionId,
      at: new Date().toISOString(),
      payload: {
        transport: "websocket",
        provider: input.registered.session.runtime,
        model: input.registered.session.model,
      },
    }));
  }

  private handleClientMessage(input: {
    client: WebSocket;
    providerConnection: PremiumRealtimeProviderConnection;
    session: RegisteredPremiumRealtimeSession["session"];
    message: RawData;
  }) {
    let payload: PremiumRealtimeBrowserMessage;

    try {
      payload = JSON.parse(input.message.toString()) as PremiumRealtimeBrowserMessage;
    } catch {
      input.client.close(4400, "invalid_json");
      return;
    }

    if (payload.type === "session.close") {
      input.providerConnection.close(1000, "browser_requested_close");
      input.client.close(1000, "session_closed");
      return;
    }

    if (payload.type === "audio.append") {
      input.providerConnection.send(createProviderAudioMessage({
        runtime: input.session.runtime,
        audioBase64: payload.audioBase64,
      }));
      return;
    }

    if (payload.type === "text.input") {
      input.providerConnection.send(createProviderTextMessage({
        runtime: input.session.runtime,
        text: payload.text,
      }));
    }
  }

  private async handleProviderMessage(input: {
    client: WebSocket;
    providerConnection: PremiumRealtimeProviderConnection;
    registered: RegisteredPremiumRealtimeSession;
    rawProviderMessage: string;
  }) {
    const result = await this.runtimeSessionsService.processProviderMessage({
      organizationId: input.registered.organizationId,
      sessionId: input.registered.session.sessionId,
      workspaceId: input.registered.workspaceId,
      actorUserId: input.registered.actorUserId,
      session: input.registered.session,
      manifest: input.registered.manifest,
      activeRoleId: input.registered.activeRoleId,
      transcript: input.registered.transcript,
      packet: input.registered.packet,
      rawProviderMessage: input.rawProviderMessage,
      at: new Date().toISOString(),
    });

    this.runtimeSessionsService.updateRegisteredSession({
      sessionId: input.registered.session.sessionId,
      packet: result.packet,
    });

    for (const providerMessage of result.providerMessages) {
      input.providerConnection.send(providerMessage);
    }

    if (input.client.readyState === WebSocket.OPEN) {
      input.client.send(JSON.stringify({
        type: "provider.message",
        sessionId: input.registered.session.sessionId,
        at: new Date().toISOString(),
        payload: {
          provider: input.registered.session.runtime,
        },
      }));
    }
  }
}

function createProviderAudioMessage(input: {
  runtime: RegisteredPremiumRealtimeSession["session"]["runtime"];
  audioBase64: string;
}): Record<string, unknown> {
  if (input.runtime === "gemini-live") {
    return {
      realtimeInput: {
        audio: {
          data: input.audioBase64,
          mimeType: "audio/pcm;rate=16000",
        },
      },
    };
  }

  return {
    type: "input_audio_buffer.append",
    audio: input.audioBase64,
  };
}

function createProviderTextMessage(input: {
  runtime: RegisteredPremiumRealtimeSession["session"]["runtime"];
  text: string;
}): Record<string, unknown> {
  if (input.runtime === "gemini-live") {
    return {
      realtimeInput: {
        text: input.text,
      },
    };
  }

  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: input.text,
        },
      ],
    },
  };
}
