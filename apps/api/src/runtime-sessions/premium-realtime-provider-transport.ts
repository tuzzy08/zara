import WebSocket from "ws";
import type { CompiledRuntimeManifest, PremiumRealtimeSession } from "@zara/core";

import { GeminiLiveRealtimeAdapter } from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "../sandbox-live-sessions/openai-realtime.adapter";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";

export const premiumRealtimeProviderTransportToken = Symbol("premiumRealtimeProviderTransport");

export interface PremiumRealtimeProviderTransportConnectInput {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  session: PremiumRealtimeSession;
  manifest: CompiledRuntimeManifest;
}

export interface PremiumRealtimeProviderConnection {
  send(message: Record<string, unknown>): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (message: string) => void): void;
  onClose(handler: (event: { code: number; reason: string }) => void): void;
}

export interface PremiumRealtimeProviderTransport {
  connect(input: PremiumRealtimeProviderTransportConnectInput): Promise<PremiumRealtimeProviderConnection>;
}

interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", handler: () => void): void;
  on(event: "message", handler: (message: WebSocket.RawData) => void): void;
  on(event: "close", handler: (code: number, reason: Buffer) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
}

export class WsPremiumRealtimeProviderTransport implements PremiumRealtimeProviderTransport {
  constructor(
    private readonly websocketFactory: (
      url: string,
      options?: { headers?: Record<string, string> | undefined },
    ) => WebSocketLike = (url, options) => new WebSocket(url, options),
  ) {}

  async connect(input: PremiumRealtimeProviderTransportConnectInput): Promise<PremiumRealtimeProviderConnection> {
    const role = input.manifest.roles.find((candidate) => candidate.id === input.session.activeRoleId);
    const systemPrompt = role?.instructions ?? "";

    if (input.session.runtime === "gemini-live") {
      return this.connectGemini(input, systemPrompt);
    }

    return this.connectOpenAi(input, systemPrompt);
  }

  private async connectOpenAi(
    input: PremiumRealtimeProviderTransportConnectInput,
    systemPrompt: string,
  ): Promise<PremiumRealtimeProviderConnection> {
    const config = resolveLiveSandboxProviderConfig(process.env);
    if (config.openAiApiKey.length === 0) {
      throw new Error("OpenAI Realtime is not configured. Missing: OPENAI_API_KEY.");
    }

    const url = new URL("/v1/realtime", config.openAiBaseUrl.replace(/^http/, "ws"));
    url.searchParams.set("model", input.session.model);
    const adapter = new OpenAiRealtimeAdapter({
      model: input.session.model,
      systemPrompt,
      tools: input.session.toolDeclarations,
    });
    const socket = this.websocketFactory(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "OpenAI-Safety-Identifier": input.actorUserId,
      },
    });
    const connection = await WebSocketProviderConnection.open(socket);
    connection.send(adapter.createSessionUpdateMessage());
    return connection;
  }

  private async connectGemini(
    input: PremiumRealtimeProviderTransportConnectInput,
    systemPrompt: string,
  ): Promise<PremiumRealtimeProviderConnection> {
    const config = resolveLiveSandboxProviderConfig(process.env);
    if (config.geminiApiKey.length === 0) {
      throw new Error("Gemini Live is not configured. Missing: GEMINI_API_KEY.");
    }

    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: config.geminiApiKey,
      model: input.session.model,
      systemPrompt,
      tools: input.session.toolDeclarations,
    });
    const socket = this.websocketFactory(adapter.createSession().websocketUrl);
    const connection = await WebSocketProviderConnection.open(socket);
    connection.send(adapter.createSetupMessage());
    return connection;
  }
}

class WebSocketProviderConnection implements PremiumRealtimeProviderConnection {
  private messageHandler: ((message: string) => void) | null = null;
  private closeHandler: ((event: { code: number; reason: string }) => void) | null = null;

  private constructor(private readonly socket: WebSocketLike) {
    this.socket.on("message", (message) => {
      this.messageHandler?.(message.toString());
    });
    this.socket.on("close", (code, reason) => {
      this.closeHandler?.({ code, reason: reason.toString() });
    });
  }

  static open(socket: WebSocketLike): Promise<WebSocketProviderConnection> {
    return new Promise((resolve, reject) => {
      const connection = new WebSocketProviderConnection(socket);
      if (socket.readyState === WebSocket.OPEN) {
        resolve(connection);
        return;
      }

      socket.on("open", () => resolve(connection));
      socket.on("error", reject);
    });
  }

  send(message: Record<string, unknown>) {
    this.socket.send(JSON.stringify(message));
  }

  close(code = 1000, reason = "closed") {
    this.socket.close(code, reason);
  }

  onMessage(handler: (message: string) => void) {
    this.messageHandler = handler;
  }

  onClose(handler: (event: { code: number; reason: string }) => void) {
    this.closeHandler = handler;
  }
}
