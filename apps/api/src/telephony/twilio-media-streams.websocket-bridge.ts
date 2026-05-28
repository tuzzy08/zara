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

interface TwilioMediaStreamAttachment {
  client: WebSocket;
  bridge: ReturnType<typeof createTwilioMediaStreamsBridge>;
  authorization: {
    organizationId: string;
    dispatchId: string;
    callSessionId: string;
    expectedCallSid: string;
    connectionId?: string | undefined;
  };
  events: TwilioMediaStreamSessionEvent[];
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

    const authorization = await this.telephonyService.authorizeTwilioMediaStream({ callSessionId });
    if (authorization === null) {
      websocketServer.handleUpgrade(request, socket, head, (client) => {
        client.close(4404, "unknown_call_session");
      });
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
      const bridge = createTwilioMediaStreamsBridge({
        callSessionId,
        expectedCallSid: authorization.expectedCallSid,
      });
      const attachment: TwilioMediaStreamAttachment = {
        client,
        bridge,
        authorization,
        events: [],
      };
      this.attachments.set(callSessionId, attachment);
      this.eventHistory.set(callSessionId, attachment.events);

      client.once("close", () => {
        this.attachments.delete(callSessionId);
      });
      client.on("message", (message) => {
        void this.handleProviderMessage({
          attachment,
          message,
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
      this.closeWithError(attachment, {
        code: "twilio_media.invalid_json",
        message: "Twilio media stream sent invalid JSON.",
        safeToClose: true,
        receivedAt: new Date().toISOString(),
        details: {},
      });
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

  private closeWithError(
    attachment: TwilioMediaStreamAttachment,
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
    attachment: TwilioMediaStreamAttachment,
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
    if (attachment === undefined) {
      throw new TwilioMediaStreamsWebSocketBridgeError(
        "twilio_media.stream_not_connected",
        `Twilio media stream for call session '${callSessionId}' is not connected.`,
      );
    }

    return attachment;
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
