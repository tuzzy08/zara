import WebSocket from "ws";
import type {
  Agent,
  CompiledRuntimeManifest,
  GeminiLiveVoiceName,
  OpenAiRealtimeVoice,
  PremiumRealtimeSession,
} from "@zara/core";
import { resolveRuntimeAgent } from "@zara/core";

import { GeminiLiveRealtimeAdapter } from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "../sandbox-live-sessions/openai-realtime.adapter";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";
import { buildPremiumRealtimeAgentPrompt } from "./premium-realtime-agent-prompt";

export const premiumRealtimeProviderTransportToken = Symbol("premiumRealtimeProviderTransport");

export interface PremiumRealtimeProviderTransportConnectInput {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  session: PremiumRealtimeSession;
  manifest: CompiledRuntimeManifest;
  mediaProfile?: "browser" | "pstn" | undefined;
}

export interface PremiumRealtimeProviderConnection {
  send(message: Record<string, unknown>): void;
  getBufferedAmountBytes(): number;
  close(code?: number, reason?: string): void;
  waitUntilReady(): Promise<void>;
  onMessage(handler: (message: string) => void): void;
  onClose(handler: (event: { code: number; reason: string }) => void): void;
}

export interface PremiumRealtimeProviderTransport {
  connect(input: PremiumRealtimeProviderTransportConnectInput): Promise<PremiumRealtimeProviderConnection>;
}

interface WebSocketLike {
  readyState: number;
  bufferedAmount: number;
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
    const activeAgentConfig = resolvePremiumRealtimeActiveAgentConfig(input.manifest, input.session.activeAgentId);
    if (activeAgentConfig === undefined) {
      throw new Error(
        `Premium realtime active agent '${input.session.activeAgentId}' was not found in runtime manifest '${input.manifest.manifestId}'.`,
      );
    }

    const systemPrompt = buildPremiumRealtimeAgentPrompt({
      manifest: input.manifest,
      agent: activeAgentConfig,
    });

    if (input.session.runtime === "gemini-live") {
      return this.connectGemini(input, systemPrompt, activeAgentConfig);
    }

    return this.connectOpenAi(input, systemPrompt, activeAgentConfig);
  }

  private async connectOpenAi(
    input: PremiumRealtimeProviderTransportConnectInput,
    systemPrompt: string,
    agent: Agent | undefined,
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
      voice: resolveOpenAiRealtimeVoice(agent),
      language: agent?.languagePolicy.defaultLanguage,
      ...resolveOpenAiRealtimeSpeed(agent),
      tools: input.session.toolDeclarations,
      ...(input.mediaProfile === "pstn"
        ? {
            inputAudioFormat: "pcmu" as const,
            outputAudioFormat: "pcmu" as const,
            turnDetectionMode: "server_vad" as const,
          }
        : {}),
    });
    const socket = this.websocketFactory(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "OpenAI-Safety-Identifier": input.actorUserId,
      },
    });
    const connection = await WebSocketProviderConnection.open(
      socket,
      (message) => parseMessageType(message) === "session.updated",
    );
    connection.send(adapter.createSessionUpdateMessage());
    return connection;
  }

  private async connectGemini(
    input: PremiumRealtimeProviderTransportConnectInput,
    systemPrompt: string,
    agent: Agent | undefined,
  ): Promise<PremiumRealtimeProviderConnection> {
    const config = resolveLiveSandboxProviderConfig(process.env);
    if (config.geminiApiKey.length === 0) {
      throw new Error("Gemini Live is not configured. Missing: GEMINI_API_KEY.");
    }

    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: config.geminiApiKey,
      model: input.session.model,
      systemPrompt,
      voiceName: resolveGeminiLiveVoiceName(agent),
      tools: input.session.toolDeclarations,
    });
    const socket = this.websocketFactory(adapter.createSession().websocketUrl);
    const connection = await WebSocketProviderConnection.open(
      socket,
      (message) => hasMessageProperty(message, "setupComplete"),
    );
    connection.send(adapter.createSetupMessage());
    return connection;
  }
}

function resolvePremiumRealtimeActiveAgentConfig(
  manifest: CompiledRuntimeManifest,
  activeAgentId: string,
): Agent | undefined {
  return Array.isArray(manifest.graph?.nodes)
    ? resolveRuntimeAgent(manifest, activeAgentId)
    : undefined;
}

function resolveOpenAiRealtimeVoice(
  agent: Agent | undefined,
): OpenAiRealtimeVoice {
  const realtimeVoiceConfig = agent?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider === "openai-realtime") {
    return realtimeVoiceConfig.voice;
  }

  return "marin";
}

function resolveOpenAiRealtimeSpeed(
  agent: Agent | undefined,
): { speed?: number } {
  const realtimeVoiceConfig = agent?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider !== "openai-realtime" || realtimeVoiceConfig.speed === undefined) {
    return {};
  }

  return {
    speed: Math.min(1.5, Math.max(0.25, realtimeVoiceConfig.speed)),
  };
}

function resolveGeminiLiveVoiceName(
  agent: Agent | undefined,
): GeminiLiveVoiceName {
  const realtimeVoiceConfig = agent?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider === "gemini-live") {
    return realtimeVoiceConfig.voiceName;
  }

  return "Kore";
}

class WebSocketProviderConnection implements PremiumRealtimeProviderConnection {
  private messageHandler: ((message: string) => void) | null = null;
  private closeHandler: ((event: { code: number; reason: string }) => void) | null = null;
  private pendingReadyMessage: string | null = null;
  private ready = false;
  private readyFailure: Error | null = null;
  private terminalEvent: { code: number; reason: string } | null = null;
  private openFailureHandler: ((error: Error) => void) | null = null;
  private readonly readyWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  private constructor(
    private readonly socket: WebSocketLike,
    private readonly isReadyMessage: (message: string) => boolean,
  ) {
    this.socket.on("message", (message) => {
      const text = message.toString();
      const isReadyAcknowledgement = !this.ready && this.isReadyMessage(text);
      if (isReadyAcknowledgement) {
        this.ready = true;
        for (const waiter of this.readyWaiters.splice(0)) {
          waiter.resolve();
        }
      }
      if (this.messageHandler !== null) {
        this.messageHandler(text);
      } else if (isReadyAcknowledgement) {
        this.pendingReadyMessage = text;
      }
    });
    this.socket.on("error", (error) => {
      this.recordTerminal({ code: 1011, reason: error.message }, error);
    });
    this.socket.on("close", (code, reason) => {
      const textReason = reason.toString();
      const error = new Error(
        `Provider connection closed before readiness (${code})${textReason.length > 0 ? `: ${textReason}` : "."}`,
      );
      this.recordTerminal({ code, reason: textReason }, error);
    });
  }

  static open(
    socket: WebSocketLike,
    isReadyMessage: (message: string) => boolean = () => false,
  ): Promise<WebSocketProviderConnection> {
    return new Promise((resolve, reject) => {
      const connection = new WebSocketProviderConnection(socket, isReadyMessage);
      if (socket.readyState === WebSocket.OPEN) {
        resolve(connection);
        return;
      }

      connection.openFailureHandler = reject;
      socket.on("open", () => {
        connection.openFailureHandler = null;
        resolve(connection);
      });
    });
  }

  send(message: Record<string, unknown>) {
    this.socket.send(JSON.stringify(message));
  }

  getBufferedAmountBytes() {
    return this.socket.bufferedAmount;
  }

  close(code = 1000, reason = "closed") {
    this.socket.close(code, reason);
  }

  waitUntilReady() {
    if (this.ready) {
      return Promise.resolve();
    }
    if (this.readyFailure !== null) {
      return Promise.reject(this.readyFailure);
    }

    return new Promise<void>((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject });
    });
  }

  onMessage(handler: (message: string) => void) {
    this.messageHandler = handler;
    if (this.pendingReadyMessage !== null) {
      const message = this.pendingReadyMessage;
      this.pendingReadyMessage = null;
      handler(message);
    }
  }

  onClose(handler: (event: { code: number; reason: string }) => void) {
    this.closeHandler = handler;
    if (this.terminalEvent !== null) {
      handler(this.terminalEvent);
    }
  }

  private failReadiness(error: Error) {
    if (this.ready || this.readyFailure !== null) {
      return;
    }

    this.readyFailure = error;
    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.reject(error);
    }
  }

  private failOpen(error: Error) {
    const handler = this.openFailureHandler;
    this.openFailureHandler = null;
    handler?.(error);
  }

  private recordTerminal(event: { code: number; reason: string }, error: Error) {
    this.failReadiness(error);
    this.failOpen(error);
    if (this.terminalEvent !== null) {
      return;
    }
    this.terminalEvent = event;
    this.closeHandler?.(event);
  }
}

function parseMessageType(message: string): string | undefined {
  const parsed = parseProviderMessage(message);
  return typeof parsed?.type === "string" ? parsed.type : undefined;
}

function hasMessageProperty(message: string, property: string): boolean {
  const parsed = parseProviderMessage(message);
  return parsed !== undefined && Object.prototype.hasOwnProperty.call(parsed, property);
}

function parseProviderMessage(message: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(message);
    return typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
