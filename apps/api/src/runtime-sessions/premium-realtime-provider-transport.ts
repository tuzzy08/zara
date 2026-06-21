import WebSocket from "ws";
import type {
  CompiledRuntimeManifest,
  GeminiLiveVoiceName,
  OpenAiRealtimeVoice,
  PremiumRealtimeSession,
} from "@zara/core";
import { resolveRuntimeAgent, runtimeAgentToVoiceAgentRole } from "@zara/core";

import { GeminiLiveRealtimeAdapter } from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "../sandbox-live-sessions/openai-realtime.adapter";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";
import { buildPremiumRealtimeRolePrompt } from "./premium-realtime-role-prompt";

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
    const role = resolvePremiumRealtimeActiveRole(input.manifest, input.session.activeRoleId);
    if (role === undefined) {
      throw new Error(
        `Premium realtime active role '${input.session.activeRoleId}' was not found in runtime manifest '${input.manifest.manifestId}'.`,
      );
    }

    const systemPrompt = buildPremiumRealtimeRolePrompt({
      manifest: input.manifest,
      role,
    });

    if (input.session.runtime === "gemini-live") {
      return this.connectGemini(input, systemPrompt, role);
    }

    return this.connectOpenAi(input, systemPrompt, role);
  }

  private async connectOpenAi(
    input: PremiumRealtimeProviderTransportConnectInput,
    systemPrompt: string,
    role: CompiledRuntimeManifest["roles"][number] | undefined,
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
      voice: resolveOpenAiRealtimeVoice(role),
      language: role?.languagePolicy.defaultLanguage,
      ...resolveOpenAiRealtimeSpeed(role),
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
    role: CompiledRuntimeManifest["roles"][number] | undefined,
  ): Promise<PremiumRealtimeProviderConnection> {
    const config = resolveLiveSandboxProviderConfig(process.env);
    if (config.geminiApiKey.length === 0) {
      throw new Error("Gemini Live is not configured. Missing: GEMINI_API_KEY.");
    }

    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: config.geminiApiKey,
      model: input.session.model,
      systemPrompt,
      voiceName: resolveGeminiLiveVoiceName(role),
      tools: input.session.toolDeclarations,
    });
    const socket = this.websocketFactory(adapter.createSession().websocketUrl);
    const connection = await WebSocketProviderConnection.open(socket);
    connection.send(adapter.createSetupMessage());
    return connection;
  }
}

function resolvePremiumRealtimeActiveRole(
  manifest: CompiledRuntimeManifest,
  activeAgentId: string,
): CompiledRuntimeManifest["roles"][number] | undefined {
  const runtimeAgent = Array.isArray(manifest.graph?.nodes)
    ? resolveRuntimeAgent(manifest, activeAgentId)
    : undefined;
  if (runtimeAgent !== undefined) {
    return runtimeAgentToVoiceAgentRole(runtimeAgent);
  }

  const role = manifest.roles.find((candidate) => candidate.id === activeAgentId);
  const roleName = role?.name?.trim() ?? "";

  return role !== undefined && roleName.length > 0 ? role : undefined;
}

function resolveOpenAiRealtimeVoice(
  role: CompiledRuntimeManifest["roles"][number] | undefined,
): OpenAiRealtimeVoice {
  const realtimeVoiceConfig = role?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider === "openai-realtime") {
    return realtimeVoiceConfig.voice;
  }

  return "marin";
}

function resolveOpenAiRealtimeSpeed(
  role: CompiledRuntimeManifest["roles"][number] | undefined,
): { speed?: number } {
  const realtimeVoiceConfig = role?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider !== "openai-realtime" || realtimeVoiceConfig.speed === undefined) {
    return {};
  }

  return {
    speed: Math.min(1.5, Math.max(0.25, realtimeVoiceConfig.speed)),
  };
}

function resolveGeminiLiveVoiceName(
  role: CompiledRuntimeManifest["roles"][number] | undefined,
): GeminiLiveVoiceName {
  const realtimeVoiceConfig = role?.realtimeVoiceConfig;
  if (realtimeVoiceConfig?.provider === "gemini-live") {
    return realtimeVoiceConfig.voiceName;
  }

  return "Kore";
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
