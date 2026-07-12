import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import {
  WebSocketServer,
  type RawData,
  type WebSocket,
} from "ws";
import type { PstnAudioFrame } from "@zara/core";

import { TelephonyService } from "./telephony.service";
import {
  pstnCallObservabilityRecorderToken,
  type PstnCallObservabilityEvent,
  type PstnCallObservabilityRecorder,
} from "../runtime-observability/runtime-observability";
import {
  createTwilioMediaStreamsBridge,
  type TwilioMediaStreamBridgeError,
  type TwilioMediaStreamBridgeEvent,
} from "./twilio-media-streams.bridge";
import {
  logTwilioPstnDiagnostic,
  warnTwilioPstnDiagnostic,
} from "./twilio-pstn-diagnostics";
import { PstnPremiumCallExecution } from "./pstn-premium-call-execution";

type TwilioMediaStreamSessionEvent =
  | TwilioMediaStreamBridgeEvent
  | {
      type: "error";
      error: TwilioMediaStreamBridgeError;
    };

interface TwilioMediaStreamAuthorization {
  organizationId: string;
  dispatchId: string;
  callSessionId: string;
  expectedCallSid: string;
  connectionId?: string | undefined;
  runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
}

interface TwilioMediaStreamAttachment {
  client: WebSocket;
  callSessionId: string;
  bridge?: ReturnType<typeof createTwilioMediaStreamsBridge> | undefined;
  authorization?: TwilioMediaStreamAuthorization | undefined;
  events: TwilioMediaStreamSessionEvent[];
  processing: Promise<void>;
  pendingMessageBytes: number;
  mediaFrameCount: number;
  recordedPhoneTestCheckpoints: Set<"inboundFrameReceived" | "outboundAudioSent">;
}

const maxPendingTwilioMessageBytes = 64 * 1_024;
const maxTwilioEventHistory = 256;

@Injectable()
export class TwilioMediaStreamsWebSocketBridge
implements OnApplicationBootstrap, OnApplicationShutdown {
  private websocketServer: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private readonly logger = new Logger(TwilioMediaStreamsWebSocketBridge.name);
  private readonly attachments = new Map<string, TwilioMediaStreamAttachment>();
  private readonly eventHistory = new Map<string, TwilioMediaStreamSessionEvent[]>();

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly telephonyService: TelephonyService,
    private readonly premiumCallExecution: PstnPremiumCallExecution,
    @Optional()
    @Inject(pstnCallObservabilityRecorderToken)
    private readonly pstnObservabilityRecorder?: PstnCallObservabilityRecorder,
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
    this.attachments.clear();
  }

  getSessionEvents(callSessionId: string) {
    return [...(this.eventHistory.get(callSessionId) ?? [])];
  }

  sendOutboundMedia(input: { callSessionId: string; frame: PstnAudioFrame }) {
    const attachment = this.requireAttachment(input.callSessionId);
    attachment.client.send(JSON.stringify(attachment.bridge.outboundMedia(input.frame)));
    this.recordPhoneTestCheckpointOnce(attachment, "outboundAudioSent");
  }

  sendMark(input: { callSessionId: string; name: string }) {
    const attachment = this.requireAttachment(input.callSessionId);
    attachment.client.send(JSON.stringify(attachment.bridge.mark(input.name)));
  }

  clearBufferedAudio(input: { callSessionId: string }) {
    const attachment = this.requireAttachment(input.callSessionId);
    attachment.client.send(JSON.stringify(attachment.bridge.clear()));
  }

  private readonly handleUpgrade = (
    request: Parameters<HttpServer["emit"]>[1] & { url?: string | undefined },
    socket: Duplex,
    head: Buffer,
  ) => {
    void this.handleTwilioUpgrade(request, socket, head);
  };

  private async handleTwilioUpgrade(
    request: Parameters<HttpServer["emit"]>[1] & { url?: string | undefined },
    socket: Duplex,
    head: Buffer,
  ) {
    const websocketServer = this.websocketServer;
    if (websocketServer === null || request.url === undefined) {
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    const match = url.pathname.match(/^\/telephony\/twilio\/media-streams\/([^/]+)$/);
    if (match === null) {
      return;
    }

    const callSessionId = decodeURIComponent(match[1] ?? "");

    if (this.attachments.has(callSessionId)) {
      warnTwilioPstnDiagnostic(this.logger, "media_socket_duplicate", {
        callSessionId,
      });
      websocketServer.handleUpgrade(request, socket, head, (client) => {
        client.close(4409, "stream_already_connected");
      });
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
      const attachment: TwilioMediaStreamAttachment = {
        client,
        callSessionId,
        events: [],
        processing: Promise.resolve(),
        pendingMessageBytes: 0,
        mediaFrameCount: 0,
        recordedPhoneTestCheckpoints: new Set(),
      };
      this.attachments.set(callSessionId, attachment);
      this.eventHistory.set(callSessionId, attachment.events);
      logTwilioPstnDiagnostic(this.logger, "media_socket_open", {
        callSessionId,
      });

      client.once("close", (code, reason) => {
        this.attachments.delete(callSessionId);
        if (attachment.authorization?.runtimePath === "pstn-premium-realtime") {
          void this.premiumCallExecution.stop({ callSessionId });
        }
        logTwilioPstnDiagnostic(this.logger, "media_socket_closed", {
          callSessionId,
          code,
          reason: reason.toString("utf8"),
          authorized: attachment.authorization !== undefined,
        });
      });
      client.on("message", (message) => {
        const messageBytes = rawDataByteLength(message);
        if (attachment.pendingMessageBytes + messageBytes > maxPendingTwilioMessageBytes) {
          warnTwilioPstnDiagnostic(this.logger, "media_ingress_overflow", {
            callSessionId,
            pendingMessageBytes: attachment.pendingMessageBytes,
            incomingMessageBytes: messageBytes,
          });
          attachment.client.close(4408, "twilio_media.ingress_overflow");
          return;
        }
        attachment.pendingMessageBytes += messageBytes;
        attachment.processing = attachment.processing
          .then(() =>
            this.handleProviderMessage({
              attachment,
              message,
            }),
          )
          .catch(() => {
            attachment.client.close(4400, "twilio_media.handler_failed");
          })
          .finally(() => {
            attachment.pendingMessageBytes = Math.max(0, attachment.pendingMessageBytes - messageBytes);
          });
      });
    });
  }

  private async handleProviderMessage(input: {
    attachment: TwilioMediaStreamAttachment;
    message: RawData;
  }) {
    const { attachment } = input;
    let parsedMessage: unknown;

    try {
      parsedMessage = JSON.parse(input.message.toString("utf8"));
    } catch {
      const error: TwilioMediaStreamBridgeError = {
        code: "twilio_media.invalid_json",
        message: "Twilio media stream sent invalid JSON.",
        safeToClose: true,
        receivedAt: new Date().toISOString(),
        details: {},
      };
      warnTwilioPstnDiagnostic(this.logger, "media_invalid_json", {
        callSessionId: attachment.callSessionId,
      });
      if (this.isAuthorizedAttachment(attachment)) {
        this.closeWithError(attachment, error);
      } else {
        attachment.events.push({
          type: "error",
          error,
        });
        attachment.client.close(4400, error.code);
      }
      return;
    }

    if (!this.isAuthorizedAttachment(attachment)) {
      const authorizationState = await this.authorizeFromStartMessage(attachment, parsedMessage);
      if (authorizationState === "handled") {
        return;
      }
    }

    if (!this.isAuthorizedAttachment(attachment)) {
      return;
    }

    const result = attachment.bridge.receive(parsedMessage);
    if (!result.ok) {
      this.closeWithError(attachment, result.error);
      return;
    }

    attachment.events.push(result.event);
    if (attachment.events.length > maxTwilioEventHistory) {
      attachment.events.splice(0, attachment.events.length - maxTwilioEventHistory);
    }

    if (result.event.type === "started") {
      logTwilioPstnDiagnostic(this.logger, "media_started", {
        organizationId: attachment.authorization.organizationId,
        connectionId: attachment.authorization.connectionId,
        dispatchId: attachment.authorization.dispatchId,
        callSessionId: attachment.authorization.callSessionId,
        callSid: result.event.callSid,
        streamSid: result.event.streamSid,
        codec: result.event.codec,
      });
      this.recordPstnObservability(attachment, {
        type: "media.websocket_connected",
        at: result.event.receivedAt,
        payload: {
          provider: "twilio",
        },
      });
      await this.telephonyService.recordTwilioMediaStreamLifecycle({
        organizationId: attachment.authorization.organizationId,
        callSessionId: attachment.authorization.callSessionId,
        streamSid: result.event.streamSid,
        status: "active",
        at: result.event.receivedAt,
      });
      if (attachment.authorization.runtimePath === "pstn-premium-realtime") {
        await this.premiumCallExecution.start({
          organizationId: attachment.authorization.organizationId,
          dispatchId: attachment.authorization.dispatchId,
          callSessionId: attachment.authorization.callSessionId,
          streamSid: result.event.streamSid,
          output: {
            sendMedia: (frame) => this.sendOutboundMedia({
              callSessionId: attachment.authorization!.callSessionId,
              frame,
            }),
            clearAudio: () => this.clearBufferedAudio({
              callSessionId: attachment.authorization!.callSessionId,
            }),
            sendMark: (name) => this.sendMark({
              callSessionId: attachment.authorization!.callSessionId,
              name,
            }),
            close: (code, reason) => attachment.client.close(code, reason),
          },
        });
      }
      return;
    }

    if (result.event.type === "media") {
      attachment.mediaFrameCount += 1;
      if (attachment.mediaFrameCount === 1) {
        logTwilioPstnDiagnostic(this.logger, "media_first_frame", {
          organizationId: attachment.authorization.organizationId,
          connectionId: attachment.authorization.connectionId,
          dispatchId: attachment.authorization.dispatchId,
          callSessionId: attachment.authorization.callSessionId,
          callSid: result.event.provider.callSid,
          streamSid: result.event.provider.streamSid,
          sequence: result.event.frame.sequence,
          timestampMs: result.event.frame.timestampMs,
        });
        this.recordPstnObservability(attachment, {
          type: "media.first_inbound_frame",
          at: result.event.receivedAt,
          payload: {
            frameSequence: result.event.frame.sequence,
            latencyMs: result.event.frame.timestampMs,
          },
        });
      }
      if (attachment.authorization.runtimePath === "pstn-premium-realtime") {
        await this.premiumCallExecution.appendInboundFrame({
          callSessionId: attachment.authorization.callSessionId,
          frame: result.event.frame,
        });
      }
      this.recordPhoneTestCheckpointOnce(attachment, "inboundFrameReceived", result.event.receivedAt);
      return;
    }

    if (result.event.type === "dtmf") {
      logTwilioPstnDiagnostic(this.logger, "media_dtmf_received", {
        organizationId: attachment.authorization.organizationId,
        connectionId: attachment.authorization.connectionId,
        dispatchId: attachment.authorization.dispatchId,
        callSessionId: attachment.authorization.callSessionId,
        streamSid: result.event.streamSid,
        digit: result.event.digit,
      });
      await this.telephonyService.recordCallControlEvent({
        organizationId: attachment.authorization.organizationId,
        callSessionId: attachment.authorization.callSessionId,
        dispatchId: attachment.authorization.dispatchId,
        eventType: "dtmf.received",
        digit: result.event.digit,
        at: result.event.receivedAt,
      });
      return;
    }

    if (result.event.type === "stopped") {
      logTwilioPstnDiagnostic(this.logger, "media_stopped", {
        organizationId: attachment.authorization.organizationId,
        connectionId: attachment.authorization.connectionId,
        dispatchId: attachment.authorization.dispatchId,
        callSessionId: attachment.authorization.callSessionId,
        callSid: result.event.callSid,
        streamSid: result.event.streamSid,
      });
      this.recordPstnObservability(attachment, {
        type: "call.ended",
        at: result.event.receivedAt,
        payload: {
          stopReason: "completed",
        },
      });
      await this.telephonyService.recordTwilioMediaStreamLifecycle({
        organizationId: attachment.authorization.organizationId,
        callSessionId: attachment.authorization.callSessionId,
        streamSid: result.event.streamSid,
        status: "completed",
        at: result.event.receivedAt,
      });
      if (attachment.authorization.runtimePath === "pstn-premium-realtime") {
        await this.premiumCallExecution.stop({
          callSessionId: attachment.authorization.callSessionId,
        });
      }
      attachment.client.close(1000, "twilio_stop");
    }
  }

  private recordPhoneTestCheckpointOnce(
    attachment: TwilioMediaStreamAttachment,
    checkpoint: "inboundFrameReceived" | "outboundAudioSent",
    at?: string,
  ) {
    if (attachment.recordedPhoneTestCheckpoints.has(checkpoint) || attachment.authorization === undefined) {
      return;
    }

    attachment.recordedPhoneTestCheckpoints.add(checkpoint);
    void this.telephonyService.recordPstnPhoneTestCheckpoint({
      organizationId: attachment.authorization.organizationId,
      callSessionId: attachment.authorization.callSessionId,
      checkpoint,
      ...(at === undefined ? {} : { at }),
    }).catch((error: unknown) => {
      warnTwilioPstnDiagnostic(this.logger, "phone_test_checkpoint_failed", {
        organizationId: attachment.authorization?.organizationId,
        callSessionId: attachment.callSessionId,
        checkpoint,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    });
  }

  private async authorizeFromStartMessage(
    attachment: TwilioMediaStreamAttachment,
    parsedMessage: unknown,
  ): Promise<"authorized" | "handled"> {
    if (!isRecord(parsedMessage)) {
      warnTwilioPstnDiagnostic(this.logger, "media_invalid_message", {
        callSessionId: attachment.callSessionId,
      });
      attachment.client.close(4400, "twilio_media.invalid_message");
      return "handled";
    }

    if (parsedMessage.event === "connected") {
      logTwilioPstnDiagnostic(this.logger, "media_connected_message", {
        callSessionId: attachment.callSessionId,
        protocol: readString(parsedMessage.protocol) ?? "unknown",
        version: readString(parsedMessage.version) ?? "unknown",
      });
      attachment.events.push({
        type: "connected",
        protocol: readString(parsedMessage.protocol) ?? "unknown",
        version: readString(parsedMessage.version) ?? "unknown",
        receivedAt: new Date().toISOString(),
      });
      return "handled";
    }

    if (parsedMessage.event !== "start") {
      warnTwilioPstnDiagnostic(this.logger, "media_start_missing", {
        callSessionId: attachment.callSessionId,
        event: readString(parsedMessage.event) ?? "unknown",
      });
      attachment.client.close(4401, "missing_stream_token");
      return "handled";
    }

    const start = isRecord(parsedMessage.start) ? parsedMessage.start : undefined;
    const customParameters = isRecord(start?.customParameters) ? start.customParameters : {};
    const token = readString(customParameters.zaraStreamToken)?.trim();
    logTwilioPstnDiagnostic(this.logger, "media_start_received", {
      callSessionId: attachment.callSessionId,
      accountSid: readString(start?.accountSid),
      callSid: readString(start?.callSid),
      streamSid: readString(start?.streamSid) ?? readString(parsedMessage.streamSid),
      customParameterKeys: Object.keys(customParameters).sort(),
      streamParameterPresent: token !== undefined && token.length > 0,
    });
    if (token === undefined || token.length === 0) {
      warnTwilioPstnDiagnostic(this.logger, "media_start_authorization_failed", {
        callSessionId: attachment.callSessionId,
        accountSid: readString(start?.accountSid),
        callSid: readString(start?.callSid),
        streamSid: readString(start?.streamSid) ?? readString(parsedMessage.streamSid),
        reason: "missing_stream_token",
      });
      attachment.client.close(4401, "missing_stream_token");
      return "handled";
    }

    const authorization = await this.telephonyService.authorizeTwilioMediaStream({
      callSessionId: attachment.callSessionId,
      token,
    });
    if (authorization === null) {
      warnTwilioPstnDiagnostic(this.logger, "media_start_authorization_failed", {
        callSessionId: attachment.callSessionId,
        accountSid: readString(start?.accountSid),
        callSid: readString(start?.callSid),
        streamSid: readString(start?.streamSid) ?? readString(parsedMessage.streamSid),
        reason: "invalid_stream_token",
      });
      attachment.client.close(4401, "invalid_stream_token");
      return "handled";
    }

    attachment.authorization = authorization;
    attachment.bridge = createTwilioMediaStreamsBridge({
      callSessionId: attachment.callSessionId,
      expectedCallSid: authorization.expectedCallSid,
    });
    logTwilioPstnDiagnostic(this.logger, "media_start_authorized", {
      organizationId: authorization.organizationId,
      connectionId: authorization.connectionId,
      dispatchId: authorization.dispatchId,
      callSessionId: authorization.callSessionId,
      expectedCallSid: authorization.expectedCallSid,
      callSid: readString(start?.callSid),
      streamSid: readString(start?.streamSid) ?? readString(parsedMessage.streamSid),
    });
    return "authorized";
  }

  private closeWithError(
    attachment: TwilioMediaStreamAttachment & {
      authorization: TwilioMediaStreamAuthorization;
      bridge: ReturnType<typeof createTwilioMediaStreamsBridge>;
    },
    error: TwilioMediaStreamBridgeError,
  ) {
    warnTwilioPstnDiagnostic(this.logger, "media_bridge_error", {
      organizationId: attachment.authorization.organizationId,
      connectionId: attachment.authorization.connectionId,
      dispatchId: attachment.authorization.dispatchId,
      callSessionId: attachment.authorization.callSessionId,
      code: error.code,
      safeToClose: error.safeToClose,
      details: error.details,
    });
    this.recordPstnObservability(attachment, {
      type: "provider.failure",
      at: error.receivedAt,
      payload: {
        stage: "bridge",
        code: error.code,
        recoverable: error.safeToClose,
      },
    });
    attachment.events.push({
      type: "error",
      error,
    });
    attachment.client.close(4400, error.code);
  }

  private recordPstnObservability(
    attachment: TwilioMediaStreamAttachment & {
      authorization: TwilioMediaStreamAuthorization;
      bridge: ReturnType<typeof createTwilioMediaStreamsBridge>;
    },
    event: PstnCallObservabilityEvent,
  ) {
    void this.pstnObservabilityRecorder?.recordPstnCall({
      traceId: `twilio:${attachment.authorization.callSessionId}`,
      call: {
        organizationId: attachment.authorization.organizationId,
        callSessionId: attachment.authorization.callSessionId,
        ...(attachment.authorization.connectionId === undefined
          ? {}
          : { connectionId: attachment.authorization.connectionId }),
        provider: "twilio",
      },
      events: [event],
    }).catch(() => undefined);
  }

  private requireAttachment(callSessionId: string) {
    const attachment = this.attachments.get(callSessionId);
    if (attachment === undefined || !this.isAuthorizedAttachment(attachment)) {
      throw new TwilioMediaStreamsWebSocketBridgeError(
        "twilio_media.stream_not_connected",
        `Twilio media stream for call session '${callSessionId}' is not connected.`,
      );
    }

    return attachment;
  }

  private isAuthorizedAttachment(
    attachment: TwilioMediaStreamAttachment,
  ): attachment is TwilioMediaStreamAttachment & {
    authorization: TwilioMediaStreamAuthorization;
    bridge: ReturnType<typeof createTwilioMediaStreamsBridge>;
  } {
    return attachment.authorization !== undefined && attachment.bridge !== undefined;
  }
}

export class TwilioMediaStreamsWebSocketBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TwilioMediaStreamsWebSocketBridgeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rawDataByteLength(message: RawData) {
  if (Array.isArray(message)) {
    return message.reduce((total, part) => total + part.byteLength, 0);
  }
  return message.byteLength;
}
