import {
  Inject,
  Injectable,
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
}

interface TwilioMediaStreamAttachment {
  client: WebSocket;
  callSessionId: string;
  bridge?: ReturnType<typeof createTwilioMediaStreamsBridge> | undefined;
  authorization?: TwilioMediaStreamAuthorization | undefined;
  events: TwilioMediaStreamSessionEvent[];
  processing: Promise<void>;
}

@Injectable()
export class TwilioMediaStreamsWebSocketBridge
implements OnApplicationBootstrap, OnApplicationShutdown {
  private websocketServer: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private readonly attachments = new Map<string, TwilioMediaStreamAttachment>();
  private readonly eventHistory = new Map<string, TwilioMediaStreamSessionEvent[]>();

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly telephonyService: TelephonyService,
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
    void this.telephonyService.recordPstnPhoneTestCheckpoint({
      organizationId: attachment.authorization.organizationId,
      callSessionId: attachment.authorization.callSessionId,
      checkpoint: "outboundAudioSent",
    });
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
      };
      this.attachments.set(callSessionId, attachment);
      this.eventHistory.set(callSessionId, attachment.events);

      client.once("close", () => {
        this.attachments.delete(callSessionId);
      });
      client.on("message", (message) => {
        attachment.processing = attachment.processing
          .then(() =>
            this.handleProviderMessage({
              attachment,
              message,
            }),
          )
          .catch(() => {
            attachment.client.close(4400, "twilio_media.handler_failed");
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

    if (result.event.type === "started") {
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
      return;
    }

    if (result.event.type === "media") {
      if (attachment.events.filter((event) => event.type === "media").length === 1) {
        this.recordPstnObservability(attachment, {
          type: "media.first_inbound_frame",
          at: result.event.receivedAt,
          payload: {
            frameSequence: result.event.frame.sequence,
            latencyMs: result.event.frame.timestampMs,
          },
        });
      }
      await this.telephonyService.recordPstnPhoneTestCheckpoint({
        organizationId: attachment.authorization.organizationId,
        callSessionId: attachment.authorization.callSessionId,
        checkpoint: "inboundFrameReceived",
        at: result.event.receivedAt,
      });
      return;
    }

    if (result.event.type === "dtmf") {
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
      attachment.client.close(1000, "twilio_stop");
    }
  }

  private async authorizeFromStartMessage(
    attachment: TwilioMediaStreamAttachment,
    parsedMessage: unknown,
  ): Promise<"authorized" | "handled"> {
    if (!isRecord(parsedMessage)) {
      attachment.client.close(4400, "twilio_media.invalid_message");
      return "handled";
    }

    if (parsedMessage.event === "connected") {
      attachment.events.push({
        type: "connected",
        protocol: readString(parsedMessage.protocol) ?? "unknown",
        version: readString(parsedMessage.version) ?? "unknown",
        receivedAt: new Date().toISOString(),
      });
      return "handled";
    }

    if (parsedMessage.event !== "start") {
      attachment.client.close(4401, "missing_stream_token");
      return "handled";
    }

    const start = isRecord(parsedMessage.start) ? parsedMessage.start : undefined;
    const customParameters = isRecord(start?.customParameters) ? start.customParameters : {};
    const token = readString(customParameters.zaraStreamToken)?.trim();
    if (token === undefined || token.length === 0) {
      attachment.client.close(4401, "missing_stream_token");
      return "handled";
    }

    const authorization = await this.telephonyService.authorizeTwilioMediaStream({
      callSessionId: attachment.callSessionId,
      token,
    });
    if (authorization === null) {
      attachment.client.close(4401, "invalid_stream_token");
      return "handled";
    }

    attachment.authorization = authorization;
    attachment.bridge = createTwilioMediaStreamsBridge({
      callSessionId: attachment.callSessionId,
      expectedCallSid: authorization.expectedCallSid,
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
