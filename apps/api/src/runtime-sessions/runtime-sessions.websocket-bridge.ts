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
import type {
  RuntimePacketEvent,
  TurnRuntimePacket,
} from "@zara/core";

import { GeminiLiveRealtimeAdapter } from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import { OpenAiRealtimeAdapter } from "../sandbox-live-sessions/openai-realtime.adapter";
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
      sampleRateHz?: number | undefined;
    }
  | {
      type: "audio.commit";
    }
  | {
      type: "text.input";
      text: string;
    }
  | {
      type: "session.close";
    };

interface ConfirmedCallerTurn {
  source: "typed" | "voice";
  transcript: string;
  transcriptUnavailable: boolean;
  itemId?: string | undefined;
}

@Injectable()
export class RuntimeSessionsWebSocketBridge
implements OnApplicationBootstrap, OnApplicationShutdown {
  private websocketServer: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private readonly sequenceBySessionId = new Map<string, number>();
  private readonly outputTranscriptBySessionId = new Map<string, string>();
  private readonly audioChunkCountBySessionId = new Map<string, number>();
  private readonly readySessionIds = new Set<string>();
  private readonly confirmedCallerTurnsBySessionId = new Map<string, ConfirmedCallerTurn[]>();
  private readonly lastConsumedCallerTurnBySessionId = new Map<string, ConfirmedCallerTurn>();
  private readonly consumedCallerTurnItemIdsBySessionId = new Map<string, Set<string>>();
  private readonly voiceInputActiveSessionIds = new Set<string>();
  private readonly providerVoiceTurnSequenceBySessionId = new Map<string, number>();
  private readonly activeProviderVoiceTurnIdBySessionId = new Map<string, string>();
  private readonly transcribedCallerTurnItemIdsBySessionId = new Map<string, Set<string>>();
  private readonly pendingAudioChunksBySessionId = new Map<string, Array<{
    audioBase64: string;
    sampleRateHz: number;
    provider: string;
    model: string;
  }>>();
  private readonly pendingResponseTextBySessionId = new Map<string, string>();
  private readonly activeProviderResponseSessionIds = new Set<string>();

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(RuntimeSessionsService)
    private readonly runtimeSessionsService: Pick<
      RuntimeSessionsService,
      | "consumeRealtimeSessionTransportToken"
      | "processProviderMessage"
      | "updateRegisteredSession"
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
    const token = url.searchParams.get("token") ?? undefined;
    if (token === undefined || token.trim().length === 0) {
      websocketServer.handleUpgrade(request, socket, head, (client) => {
        client.close(4401, "missing_transport_token");
      });
      return;
    }

    const registered = this.runtimeSessionsService.consumeRealtimeSessionTransportToken({
      sessionId,
      token,
    });
    if (registered === null) {
      websocketServer.handleUpgrade(request, socket, head, (client) => {
        client.close(4401, "invalid_transport_token");
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

    const bindProviderConnection = (connection: PremiumRealtimeProviderConnection) => {
      providerConnection = connection;
      connection.onMessage((message) => {
        void this.handleProviderMessage({
          client: input.client,
          providerConnection: connection,
          registered: input.registered,
          rawProviderMessage: message,
          reconnectProviderConnection: async () => {
            const nextConnection = await this.providerTransport.connect({
              organizationId: input.registered.organizationId,
              workspaceId: input.registered.workspaceId,
              actorUserId: input.registered.actorUserId,
              session: input.registered.session,
              manifest: input.registered.manifest,
            });
            bindProviderConnection(nextConnection);
            connection.close(1000, "provider_voice_handoff");
            return nextConnection;
          },
        });
      });
      connection.onClose((event) => {
        if (connection !== providerConnection) {
          return;
        }

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
    };

    bindProviderConnection(providerConnection);

    input.client.once("close", () => {
      this.readySessionIds.delete(input.registered.session.sessionId);
      this.clearTurnState(input.registered.session.sessionId);
      providerConnection.close(1000, "browser_disconnected");
    });
    input.client.on("message", (message) => {
      this.handleClientMessage({
        client: input.client,
        providerConnection,
        registered: input.registered,
        message,
      });
    });

  }

  private handleClientMessage(input: {
    client: WebSocket;
    providerConnection: PremiumRealtimeProviderConnection;
    registered: RegisteredPremiumRealtimeSession;
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
      this.startProviderVoiceTurn(input.registered.session.sessionId);
      input.providerConnection.send(createProviderAudioMessage({
        runtime: input.registered.session.runtime,
        audioBase64: payload.audioBase64,
        sampleRateHz: payload.sampleRateHz,
      }));
      return;
    }

    if (payload.type === "audio.commit") {
      for (const message of createProviderAudioCommitMessages(input.registered.session.runtime)) {
        input.providerConnection.send(message);
      }
      return;
    }

    if (payload.type === "text.input") {
      this.confirmCallerTurn(input.registered.session.sessionId, {
        source: "typed",
        transcript: payload.text,
        transcriptUnavailable: false,
      });
      this.sendClientEvent(input.client, {
        session: input.registered.session,
      }, "turn.transcribed", {
        transcript: payload.text,
        source: "typed",
        language: "en",
        confidence: 1,
        provider: input.registered.session.runtime,
        model: input.registered.session.model,
      });
      this.sendClientEvent(input.client, {
        session: input.registered.session,
      }, "turn.response.started", {
        provider: input.registered.session.runtime,
        model: input.registered.session.model,
      });
      for (const message of createProviderTextMessages({
        runtime: input.registered.session.runtime,
        text: payload.text,
      })) {
        input.providerConnection.send(message);
      }
    }
  }

  private async handleProviderMessage(input: {
    client: WebSocket;
    providerConnection: PremiumRealtimeProviderConnection;
    registered: RegisteredPremiumRealtimeSession;
    rawProviderMessage: string;
    reconnectProviderConnection?: (() => Promise<PremiumRealtimeProviderConnection>) | undefined;
  }) {
    if (this.projectProviderReadyMessage(input)) {
      return;
    }

    if (this.projectProviderSetupFailure(input)) {
      return;
    }

    const result = await this.runtimeSessionsService.processProviderMessage({
      organizationId: input.registered.organizationId,
      sessionId: input.registered.session.sessionId,
      workspaceId: input.registered.workspaceId,
      actorUserId: input.registered.actorUserId,
      session: input.registered.session,
      manifest: input.registered.manifest,
      activeAgentId: input.registered.activeAgentId,
      transcript: input.registered.transcript,
      packet: input.registered.packet,
      rawProviderMessage: input.rawProviderMessage,
      at: new Date().toISOString(),
    });

    this.projectPacketToolLifecycleEvents({
      client: input.client,
      registered: input.registered,
      previousPacket: input.registered.packet,
      nextPacket: result.packet,
    });
    if (result.session !== undefined) {
      input.registered.session = result.session;
    }
    if (result.activeAgentId !== undefined) {
      input.registered.activeAgentId = result.activeAgentId;
    }
    input.registered.packet = result.packet;
    this.runtimeSessionsService.updateRegisteredSession({
      sessionId: input.registered.session.sessionId,
      ...(result.session !== undefined ? { session: result.session } : {}),
      ...(result.activeAgentId !== undefined ? { activeAgentId: result.activeAgentId } : {}),
      packet: result.packet,
      ...(result.transcript !== undefined ? { transcript: result.transcript } : {}),
    });

    for (const event of result.routeEvents ?? []) {
      this.sendClientEvent(input.client, input.registered, event.type, event.payload);
    }

    this.projectProviderMessage({
      client: input.client,
      registered: input.registered,
      rawProviderMessage: input.rawProviderMessage,
    });

    this.restoreCallerTurnForHandoffContinuation({
      sessionId: input.registered.session.sessionId,
      routeEvents: result.routeEvents,
      providerMessages: result.providerMessages,
    });

    let providerConnection = input.providerConnection;
    let providerMessages = result.providerMessages;
    if (
      input.reconnectProviderConnection !== undefined
      && shouldReconnectOpenAiProviderForVoiceHandoff(input.registered.session, result.providerMessages)
    ) {
      providerConnection = await input.reconnectProviderConnection();
      providerMessages = filterProviderMessagesAfterVoiceHandoffReconnect(result.providerMessages);
    }

    for (const providerMessage of providerMessages) {
      providerConnection.send(providerMessage);
    }

  }

  private projectPacketToolLifecycleEvents(input: {
    client: WebSocket;
    registered: RegisteredPremiumRealtimeSession;
    previousPacket: TurnRuntimePacket;
    nextPacket: TurnRuntimePacket;
  }) {
    const projectedEventKeys = new Set(getRuntimePacketEvents(input.previousPacket).map(createPacketEventKey));

    for (const event of getRuntimePacketEvents(input.nextPacket)) {
      if (!isToolLifecyclePacketEvent(event) || projectedEventKeys.has(createPacketEventKey(event))) {
        continue;
      }

      projectedEventKeys.add(createPacketEventKey(event));
      this.sendClientEvent(input.client, input.registered, event.type, {
        ...event.payload,
        turnId: event.turnId,
        packetSequence: event.sequence,
        ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
      });
    }
  }

  private projectProviderMessage(input: {
    client: WebSocket;
    registered: RegisteredPremiumRealtimeSession;
    rawProviderMessage: string;
  }) {
    const events = parseProviderEvents(input.registered, input.rawProviderMessage);

    for (const event of events) {
      if (event.type === "session_ready") {
        this.sendSessionReadyOnce(input.client, input.registered);
        continue;
      }

      if (event.type === "tool_call") {
        continue;
      }

      if (event.type === "input_audio_committed") {
        this.confirmProviderVoiceTurn({
          client: input.client,
          registered: input.registered,
          itemId: event.itemId,
        });
        continue;
      }

      if (event.type === "provider_event") {
        const normalizedEvent = normalizeProviderEvidenceEvent(event);
        if (normalizedEvent.eventType === "response.created") {
          this.startProviderResponse(input.registered.session.sessionId);
        }
        if (isProviderPlaybackInterruptionEvent(normalizedEvent.eventType)) {
          this.interruptProviderResponse(input.registered.session.sessionId);
        }
        this.sendClientEvent(input.client, input.registered, "provider.diagnostic", {
          provider: input.registered.session.runtime,
          model: input.registered.session.model,
          ...normalizedEvent,
        });
        continue;
      }

      if (event.type === "audio") {
        const chunkCount = this.audioChunkCountBySessionId.get(input.registered.session.sessionId) ?? 0;
        this.audioChunkCountBySessionId.set(input.registered.session.sessionId, chunkCount + 1);
        const audioPayload = {
          audioBase64: event.audioBase64,
          sampleRateHz: resolveProviderOutputSampleRateHz(
            input.registered.session.runtime,
            "mimeType" in event ? event.mimeType : undefined,
          ),
          provider: input.registered.session.runtime,
          model: input.registered.session.model,
        };

        if (!this.hasConfirmedCallerTurn(input.registered.session.sessionId)) {
          const pending = this.pendingAudioChunksBySessionId.get(input.registered.session.sessionId) ?? [];
          this.pendingAudioChunksBySessionId.set(input.registered.session.sessionId, [...pending, audioPayload]);
          continue;
        }

        this.sendClientEvent(input.client, input.registered, "turn.audio.chunk", {
          ...audioPayload,
          chunkIndex: chunkCount,
        });
        continue;
      }

      if (event.type === "input_transcript") {
        if (!event.done) {
          this.sendClientEvent(input.client, input.registered, "stt.partial", {
            transcript: event.text,
            source: "voice",
            provider: input.registered.session.runtime,
            model: input.registered.session.model,
          });
          if (input.registered.session.runtime === "gemini-live") {
            const itemId = this.getActiveProviderVoiceTurnId(input.registered.session.sessionId);
            const confirmed = this.confirmCallerTurn(input.registered.session.sessionId, {
              source: "voice",
              transcript: event.text,
              transcriptUnavailable: false,
              itemId,
            });
            if (confirmed && !this.hasEmittedTranscribedCallerTurn(input.registered.session.sessionId, itemId)) {
              this.markEmittedTranscribedCallerTurn(input.registered.session.sessionId, itemId);
              this.sendClientEvent(input.client, input.registered, "turn.transcribed", {
                transcript: event.text,
                source: "voice",
                language: "en",
                provider: input.registered.session.runtime,
                model: input.registered.session.model,
              });
              this.flushPendingProviderOutput(input.client, input.registered);
            }
          }
          continue;
        }

        const confirmed = this.confirmCallerTurn(input.registered.session.sessionId, {
          source: "voice",
          transcript: event.text,
          transcriptUnavailable: false,
          ...("itemId" in event && event.itemId !== undefined ? { itemId: event.itemId } : {}),
        });
        this.voiceInputActiveSessionIds.delete(input.registered.session.sessionId);
        if (confirmed) {
          this.sendClientEvent(input.client, input.registered, "turn.transcribed", {
            transcript: event.text,
            source: "voice",
            language: "en",
            provider: input.registered.session.runtime,
            model: input.registered.session.model,
          });
          this.flushPendingProviderOutput(input.client, input.registered);
        }
        continue;
      }

      if (event.type === "output_transcript") {
        const nextText = event.done
          ? event.text
          : `${this.outputTranscriptBySessionId.get(input.registered.session.sessionId) ?? ""}${event.text}`;
        this.outputTranscriptBySessionId.set(input.registered.session.sessionId, nextText);
        if (event.done) {
          if (!this.hasConfirmedCallerTurn(input.registered.session.sessionId)) {
            this.pendingResponseTextBySessionId.set(input.registered.session.sessionId, nextText);
            continue;
          }

          this.sendCompletedTurn(input.client, input.registered, nextText);
        }
        continue;
      }

      if (event.type === "turn_complete") {
        if (!this.hasConfirmedCallerTurn(input.registered.session.sessionId)) {
          const responseText = this.outputTranscriptBySessionId.get(input.registered.session.sessionId) ?? "";
          if (responseText.trim().length > 0) {
            this.pendingResponseTextBySessionId.set(input.registered.session.sessionId, responseText);
          }
          continue;
        }

        this.sendCompletedTurn(
          input.client,
          input.registered,
          this.outputTranscriptBySessionId.get(input.registered.session.sessionId) ?? "",
        );
        if (input.registered.session.runtime === "gemini-live") {
          this.clearActiveProviderVoiceTurn(input.registered.session.sessionId);
        }
      }
    }
  }

  private projectProviderReadyMessage(input: {
    client: WebSocket;
    registered: RegisteredPremiumRealtimeSession;
    rawProviderMessage: string;
  }) {
    const events = parseProviderEvents(input.registered, input.rawProviderMessage);
    if (!events.some((event) => event.type === "session_ready")) {
      return false;
    }

    this.sendSessionReadyOnce(input.client, input.registered);
    for (const event of events) {
      if (event.type !== "provider_event") {
        continue;
      }

      this.sendClientEvent(input.client, input.registered, "provider.diagnostic", {
        provider: input.registered.session.runtime,
        model: input.registered.session.model,
        ...normalizeProviderEvidenceEvent(event),
      });
    }
    return true;
  }

  private projectProviderSetupFailure(input: {
    client: WebSocket;
    providerConnection: PremiumRealtimeProviderConnection;
    registered: RegisteredPremiumRealtimeSession;
    rawProviderMessage: string;
  }) {
    const sessionId = input.registered.session.sessionId;
    if (this.readySessionIds.has(sessionId)) {
      return false;
    }

    const setupErrorEvent = parseProviderEvents(input.registered, input.rawProviderMessage)
      .find((event) => event.type === "provider_event"
        && normalizeProviderEvidenceEvent(event).eventType === "error");
    if (setupErrorEvent === undefined || setupErrorEvent.type !== "provider_event") {
      return false;
    }

    const normalizedEvent = normalizeProviderEvidenceEvent(setupErrorEvent);
    const providerError = isRecord(normalizedEvent.error) ? normalizedEvent.error : {};
    const providerMessage = typeof providerError.message === "string"
      ? providerError.message
      : "Provider rejected realtime session setup.";

    this.sendClientEvent(input.client, input.registered, "provider.diagnostic", {
      provider: input.registered.session.runtime,
      model: input.registered.session.model,
      ...normalizedEvent,
    });
    this.sendClientEvent(input.client, input.registered, "session.error", {
      provider: input.registered.session.runtime,
      model: input.registered.session.model,
      message: `Premium realtime provider setup failed: ${providerMessage}`,
      error: providerError,
    });
    input.providerConnection.close(1000, "provider_setup_failed");
    if (input.client.readyState === WebSocket.OPEN) {
      input.client.close(1011, "provider_setup_failed");
    }
    return true;
  }

  private sendSessionReadyOnce(
    client: WebSocket,
    registered: RegisteredPremiumRealtimeSession,
  ) {
    const sessionId = registered.session.sessionId;
    if (this.readySessionIds.has(sessionId)) {
      return;
    }

    this.readySessionIds.add(sessionId);
    this.sendClientEvent(client, registered, "session.ready", {
      transport: "websocket",
      runtimePath: "premium-realtime",
      provider: registered.session.runtime,
      model: registered.session.model,
    });
  }

  private sendCompletedTurn(
    client: WebSocket,
    registered: RegisteredPremiumRealtimeSession,
    responseText: string,
  ) {
    if (responseText.trim().length === 0) {
      return;
    }

    const callerTurn = this.consumeConfirmedCallerTurn(registered.session.sessionId);
    if (callerTurn === undefined) {
      this.pendingResponseTextBySessionId.set(registered.session.sessionId, responseText);
      return;
    }

    this.sendClientEvent(client, registered, "turn.completed", {
      transcript: callerTurn.transcript,
      transcriptUnavailable: callerTurn.transcriptUnavailable,
      responseText,
      audioChunkCount: this.audioChunkCountBySessionId.get(registered.session.sessionId) ?? 0,
      degraded: false,
      provider: registered.session.runtime,
      model: registered.session.model,
    });
    this.outputTranscriptBySessionId.delete(registered.session.sessionId);
    this.pendingResponseTextBySessionId.delete(registered.session.sessionId);
    this.activeProviderResponseSessionIds.delete(registered.session.sessionId);
  }

  private confirmProviderVoiceTurn(input: {
    client: WebSocket;
    registered: RegisteredPremiumRealtimeSession;
    itemId?: string | undefined;
  }) {
    const sessionId = input.registered.session.sessionId;
    const confirmed = this.confirmCallerTurn(sessionId, {
      source: "voice",
      transcript: "",
      transcriptUnavailable: true,
      ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
    });
    this.voiceInputActiveSessionIds.delete(sessionId);
    if (confirmed) {
      this.sendClientEvent(input.client, input.registered, "turn.input_audio_committed", {
        source: "voice",
        transcriptAvailable: false,
        provider: input.registered.session.runtime,
        model: input.registered.session.model,
        ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
      });
    }
    this.flushPendingProviderOutput(input.client, input.registered);
  }

  private startProviderVoiceTurn(sessionId: string) {
    if (this.voiceInputActiveSessionIds.has(sessionId)) {
      return;
    }

    this.voiceInputActiveSessionIds.add(sessionId);
    const nextSequence = (this.providerVoiceTurnSequenceBySessionId.get(sessionId) ?? 0) + 1;
    this.providerVoiceTurnSequenceBySessionId.set(sessionId, nextSequence);
    this.activeProviderVoiceTurnIdBySessionId.set(sessionId, `provider-voice-turn:${nextSequence}`);
  }

  private startProviderResponse(sessionId: string) {
    this.outputTranscriptBySessionId.set(sessionId, "");
    this.audioChunkCountBySessionId.set(sessionId, 0);
    this.pendingAudioChunksBySessionId.delete(sessionId);
    this.pendingResponseTextBySessionId.delete(sessionId);
    this.activeProviderResponseSessionIds.add(sessionId);
  }

  private interruptProviderResponse(sessionId: string) {
    this.outputTranscriptBySessionId.delete(sessionId);
    this.audioChunkCountBySessionId.set(sessionId, 0);
    this.pendingAudioChunksBySessionId.delete(sessionId);
    this.pendingResponseTextBySessionId.delete(sessionId);
    if (this.activeProviderResponseSessionIds.has(sessionId)) {
      this.activeProviderResponseSessionIds.delete(sessionId);
      this.consumeConfirmedCallerTurn(sessionId);
    }
  }

  private flushPendingProviderOutput(
    client: WebSocket,
    registered: RegisteredPremiumRealtimeSession,
  ) {
    const sessionId = registered.session.sessionId;
    const pendingAudio = this.pendingAudioChunksBySessionId.get(sessionId) ?? [];
    this.pendingAudioChunksBySessionId.delete(sessionId);

    pendingAudio.forEach((audioPayload, index) => {
      this.sendClientEvent(client, registered, "turn.audio.chunk", {
        ...audioPayload,
        chunkIndex: index,
      });
    });

    const pendingResponseText = this.pendingResponseTextBySessionId.get(sessionId);
    this.pendingResponseTextBySessionId.delete(sessionId);
    if (pendingResponseText !== undefined) {
      this.sendCompletedTurn(client, registered, pendingResponseText);
    }
  }

  private clearTurnState(sessionId: string) {
    this.sequenceBySessionId.delete(sessionId);
    this.outputTranscriptBySessionId.delete(sessionId);
    this.audioChunkCountBySessionId.delete(sessionId);
    this.confirmedCallerTurnsBySessionId.delete(sessionId);
    this.lastConsumedCallerTurnBySessionId.delete(sessionId);
    this.consumedCallerTurnItemIdsBySessionId.delete(sessionId);
    this.voiceInputActiveSessionIds.delete(sessionId);
    this.providerVoiceTurnSequenceBySessionId.delete(sessionId);
    this.activeProviderVoiceTurnIdBySessionId.delete(sessionId);
    this.transcribedCallerTurnItemIdsBySessionId.delete(sessionId);
    this.pendingAudioChunksBySessionId.delete(sessionId);
    this.pendingResponseTextBySessionId.delete(sessionId);
    this.activeProviderResponseSessionIds.delete(sessionId);
  }

  private getActiveProviderVoiceTurnId(sessionId: string) {
    const existing = this.activeProviderVoiceTurnIdBySessionId.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }

    const nextSequence = (this.providerVoiceTurnSequenceBySessionId.get(sessionId) ?? 0) + 1;
    this.providerVoiceTurnSequenceBySessionId.set(sessionId, nextSequence);
    const itemId = `provider-voice-turn:${nextSequence}`;
    this.activeProviderVoiceTurnIdBySessionId.set(sessionId, itemId);
    return itemId;
  }

  private clearActiveProviderVoiceTurn(sessionId: string) {
    this.voiceInputActiveSessionIds.delete(sessionId);
    this.activeProviderVoiceTurnIdBySessionId.delete(sessionId);
  }

  private hasEmittedTranscribedCallerTurn(sessionId: string, itemId: string) {
    return this.transcribedCallerTurnItemIdsBySessionId.get(sessionId)?.has(itemId) === true;
  }

  private markEmittedTranscribedCallerTurn(sessionId: string, itemId: string) {
    const emitted = this.transcribedCallerTurnItemIdsBySessionId.get(sessionId) ?? new Set<string>();
    emitted.add(itemId);
    this.transcribedCallerTurnItemIdsBySessionId.set(sessionId, emitted);
  }

  private hasConfirmedCallerTurn(sessionId: string) {
    return (this.confirmedCallerTurnsBySessionId.get(sessionId)?.length ?? 0) > 0;
  }

  private confirmCallerTurn(sessionId: string, callerTurn: ConfirmedCallerTurn) {
    if (callerTurn.itemId !== undefined
      && this.consumedCallerTurnItemIdsBySessionId.get(sessionId)?.has(callerTurn.itemId) === true) {
      return false;
    }

    const queue = [...(this.confirmedCallerTurnsBySessionId.get(sessionId) ?? [])];
    if (callerTurn.itemId !== undefined) {
      const existingIndex = queue.findIndex((turn) => turn.itemId === callerTurn.itemId);
      if (existingIndex >= 0) {
        queue[existingIndex] = {
          ...queue[existingIndex],
          ...callerTurn,
        };
        this.confirmedCallerTurnsBySessionId.set(sessionId, queue);
        return true;
      }
    }

    if (callerTurn.source === "voice" && !callerTurn.transcriptUnavailable) {
      const unavailableVoiceIndex = queue.findIndex((turn) =>
        turn.source === "voice"
        && turn.transcriptUnavailable
        && (callerTurn.itemId === undefined || turn.itemId === undefined),
      );
      if (unavailableVoiceIndex >= 0) {
        queue[unavailableVoiceIndex] = {
          ...queue[unavailableVoiceIndex],
          ...callerTurn,
        };
        this.confirmedCallerTurnsBySessionId.set(sessionId, queue);
        return true;
      }
    }

    queue.push(callerTurn);
    this.confirmedCallerTurnsBySessionId.set(sessionId, queue);
    return true;
  }

  private consumeConfirmedCallerTurn(sessionId: string) {
    const queue = this.confirmedCallerTurnsBySessionId.get(sessionId);
    if (queue === undefined || queue.length === 0) {
      return undefined;
    }

    const [callerTurn, ...remaining] = queue;
    if (remaining.length === 0) {
      this.confirmedCallerTurnsBySessionId.delete(sessionId);
    } else {
      this.confirmedCallerTurnsBySessionId.set(sessionId, remaining);
    }

    if (callerTurn?.itemId !== undefined) {
      const consumed = this.consumedCallerTurnItemIdsBySessionId.get(sessionId) ?? new Set<string>();
      consumed.add(callerTurn.itemId);
      this.consumedCallerTurnItemIdsBySessionId.set(sessionId, consumed);
    }

    if (callerTurn !== undefined) {
      this.lastConsumedCallerTurnBySessionId.set(sessionId, callerTurn);
    }

    return callerTurn;
  }

  private restoreCallerTurnForHandoffContinuation(input: {
    sessionId: string;
    routeEvents?: Array<{ type: string }> | undefined;
    providerMessages: Array<Record<string, unknown>>;
  }) {
    const hasHandoff = input.routeEvents?.some((event) =>
      event.type === "agent.handoff.requested" || event.type === "agent.handoff.completed",
    ) === true;
    const createsFollowUpResponse = input.providerMessages.some((message) => message.type === "response.create");
    if (!hasHandoff || !createsFollowUpResponse || this.hasConfirmedCallerTurn(input.sessionId)) {
      return;
    }

    const callerTurn = this.lastConsumedCallerTurnBySessionId.get(input.sessionId);
    if (callerTurn === undefined) {
      return;
    }

    this.confirmedCallerTurnsBySessionId.set(input.sessionId, [callerTurn]);
    this.lastConsumedCallerTurnBySessionId.delete(input.sessionId);
  }

  private sendClientEvent(
    client: WebSocket,
    registered: Pick<RegisteredPremiumRealtimeSession, "session">,
    type: string,
    payload: Record<string, unknown>,
  ) {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }

    const sessionId = registered.session.sessionId;
    const sequence = (this.sequenceBySessionId.get(sessionId) ?? 0) + 1;
    this.sequenceBySessionId.set(sessionId, sequence);
    client.send(JSON.stringify({
      sessionId,
      sequence,
      type,
      at: new Date().toISOString(),
      payload,
    }));
  }
}

function parseProviderEvents(
  registered: RegisteredPremiumRealtimeSession,
  rawProviderMessage: string,
) {
  return registered.session.runtime === "gemini-live"
    ? new GeminiLiveRealtimeAdapter({
        apiKey: "server-owned-provider-session",
        model: registered.session.model,
        systemPrompt: "",
        tools: registered.session.toolDeclarations,
      }).parseServerMessage(rawProviderMessage)
    : new OpenAiRealtimeAdapter({
        model: registered.session.model,
        systemPrompt: "",
      tools: registered.session.toolDeclarations,
    }).parseServerMessage(rawProviderMessage);
}

function shouldReconnectOpenAiProviderForVoiceHandoff(
  session: RegisteredPremiumRealtimeSession["session"],
  providerMessages: Array<Record<string, unknown>>,
) {
  return session.runtime === "openai-realtime" && providerMessages.some(hasOpenAiOutputVoiceUpdate);
}

function hasOpenAiOutputVoiceUpdate(message: Record<string, unknown>) {
  if (message["type"] !== "session.update") {
    return false;
  }

  const session = message["session"];
  if (!isRecord(session)) {
    return false;
  }

  const audio = session["audio"];
  if (!isRecord(audio)) {
    return false;
  }

  const output = audio["output"];
  if (!isRecord(output)) {
    return false;
  }

  return typeof output["voice"] === "string";
}

function filterProviderMessagesAfterVoiceHandoffReconnect(
  providerMessages: Array<Record<string, unknown>>,
) {
  return providerMessages.filter((message) =>
    message["type"] !== "session.update" && !isOpenAiFunctionCallOutputMessage(message),
  );
}

function isOpenAiFunctionCallOutputMessage(message: Record<string, unknown>) {
  if (message["type"] !== "conversation.item.create") {
    return false;
  }

  const item = message["item"];
  return isRecord(item) && item["type"] === "function_call_output";
}

function normalizeProviderEvidenceEvent(event: {
  type: "provider_event";
  event?: string | undefined;
  eventType?: string | undefined;
  evidence: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...event.evidence,
    eventType: event.eventType ?? event.event,
  };
}

function getRuntimePacketEvents(packet: TurnRuntimePacket) {
  return packet.diagnostics?.events ?? [];
}

function isToolLifecyclePacketEvent(event: RuntimePacketEvent) {
  return event.type === "tool.requested"
    || event.type === "tool.started"
    || event.type === "tool.completed"
    || event.type === "tool.failed"
    || event.type === "tool.approval_required";
}

function createPacketEventKey(event: RuntimePacketEvent) {
  return `${event.turnId}:${event.sequence}:${event.type}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderPlaybackInterruptionEvent(eventType: unknown) {
  return eventType === "input_audio_buffer.speech_started"
    || eventType === "response.cancelled"
    || eventType === "interrupted";
}

function createProviderAudioMessage(input: {
  runtime: RegisteredPremiumRealtimeSession["session"]["runtime"];
  audioBase64: string;
  sampleRateHz?: number | undefined;
}): Record<string, unknown> {
  if (input.runtime === "gemini-live") {
    return {
      realtimeInput: {
        audio: {
          data: input.audioBase64,
          mimeType: `audio/pcm;rate=${input.sampleRateHz ?? 16_000}`,
        },
      },
    };
  }

  return {
    type: "input_audio_buffer.append",
    audio: resamplePcm16Base64({
      audioBase64: input.audioBase64,
      sourceSampleRateHz: input.sampleRateHz ?? 24_000,
      targetSampleRateHz: 24_000,
    }),
  };
}

function resamplePcm16Base64(input: {
  audioBase64: string;
  sourceSampleRateHz: number;
  targetSampleRateHz: number;
}) {
  if (input.sourceSampleRateHz === input.targetSampleRateHz) {
    return input.audioBase64;
  }

  const sourceSamples = decodePcm16(input.audioBase64);
  if (sourceSamples.length === 0) {
    return input.audioBase64;
  }

  const targetLength = Math.max(
    1,
    Math.round(sourceSamples.length * (input.targetSampleRateHz / input.sourceSampleRateHz)),
  );
  const targetSamples = new Float32Array(targetLength);
  const sourceStep = input.sourceSampleRateHz / input.targetSampleRateHz;

  for (let index = 0; index < targetSamples.length; index += 1) {
    const sourcePosition = index * sourceStep;
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(sourceSamples.length - 1, lowerIndex + 1);
    const fraction = sourcePosition - lowerIndex;
    const lowerSample = sourceSamples[lowerIndex] ?? 0;
    const upperSample = sourceSamples[upperIndex] ?? lowerSample;
    targetSamples[index] = lowerSample + ((upperSample - lowerSample) * fraction);
  }

  return encodePcm16(targetSamples);
}

function decodePcm16(audioBase64: string) {
  const bytes = Buffer.from(audioBase64, "base64");
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));

  for (let index = 0; index < samples.length; index += 1) {
    const value = bytes.readInt16LE(index * 2);
    samples[index] = value / (value < 0 ? 0x8000 : 0x7fff);
  }

  return samples;
}

function encodePcm16(samples: Float32Array) {
  const buffer = Buffer.alloc(samples.length * 2);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    buffer.writeInt16LE(value, index * 2);
  }

  return buffer.toString("base64");
}

function createProviderAudioCommitMessages(
  runtime: RegisteredPremiumRealtimeSession["session"]["runtime"],
): Array<Record<string, unknown>> {
  if (runtime === "gemini-live" || runtime === "openai-realtime") {
    return [];
  }

  return [
    {
      type: "input_audio_buffer.commit",
    },
    {
      type: "response.create",
    },
  ];
}

function resolveProviderOutputSampleRateHz(
  runtime: RegisteredPremiumRealtimeSession["session"]["runtime"],
  mimeType: string | undefined,
) {
  if (runtime === "openai-realtime") {
    return 24_000;
  }

  const match = mimeType?.match(/rate=(\d+)/);
  return match?.[1] === undefined ? 24_000 : Number(match[1]);
}

function createProviderTextMessages(input: {
  runtime: RegisteredPremiumRealtimeSession["session"]["runtime"];
  text: string;
}): Array<Record<string, unknown>> {
  if (input.runtime === "gemini-live") {
    return [
      {
        realtimeInput: {
          text: input.text,
        },
      },
    ];
  }

  return [
    {
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
    },
    {
      type: "response.create",
    },
  ];
}
