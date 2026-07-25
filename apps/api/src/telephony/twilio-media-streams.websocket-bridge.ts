import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
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
import {
  classifyPremiumCallStartupFailure,
  PstnPremiumCallExecution,
} from "./pstn-premium-call-execution";
import { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";

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
  providerAccountId: string;
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
  pendingMessageCount: number;
  mediaFrameCount: number;
  capacitySocketId: string;
  capacityOpenedAtMs: number;
  capacityHandshakeRecorded: boolean;
  capacityCloseInitiator: "local" | "remote";
  premiumExecutionStopped: boolean;
  terminalization?: Promise<void> | undefined;
  validatedTwilioStopReceived: boolean;
  recordedPhoneTestCheckpoints: Set<"inboundFrameReceived" | "outboundAudioSent">;
}

interface PendingSandwichTerminalization {
  organizationId: string;
  callSessionId: string;
  outcome: "completed" | "failed";
  reasonCode: string;
  retryBackoffStep: number;
  nextRetryAtMs?: number | undefined;
  terminalization?: Promise<void> | undefined;
}

const maxPendingTwilioMessageBytes = 64 * 1_024;
const maxTwilioEventHistory = 256;
const maxCompletedTwilioEventHistories = 64;
const maxPendingSandwichTerminalizations = 1_024;
const maxSandwichTerminalizationRetryBackoffStep = 5;
const sandwichTerminalizationRetryBaseDelayMs = 1_000;

@Injectable()
export class TwilioMediaStreamsWebSocketBridge
implements OnApplicationBootstrap {
  private websocketServer: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private readonly logger = new Logger(TwilioMediaStreamsWebSocketBridge.name);
  private readonly attachments = new Map<string, TwilioMediaStreamAttachment>();
  private readonly eventHistory = new Map<string, TwilioMediaStreamSessionEvent[]>();
  private readonly completedEventHistoryIds = new Set<string>();
  private readonly pendingTerminalizations = new Set<Promise<void>>();
  private readonly pendingSandwichTerminalizations = new Map<
    string,
    PendingSandwichTerminalization
  >();
  private sandwichTerminalizationRetryTimer:
    | ReturnType<typeof setTimeout>
    | undefined;
  private shuttingDown = false;
  private terminalizationFailureCount = 0;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly telephonyService: TelephonyService,
    private readonly premiumCallExecution: PstnPremiumCallExecution,
    private readonly pstnAdmissionCoordinator: PstnAdmissionCoordinator,
    @Optional()
    @Inject(pstnCallObservabilityRecorderToken)
    private readonly pstnObservabilityRecorder?: PstnCallObservabilityRecorder,
    @Optional()
    @Inject(PstnCapacityObservability)
    private readonly capacityObservability?: PstnCapacityObservability,
  ) {}

  onApplicationBootstrap() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.httpServer = httpServer;
    this.websocketServer = new WebSocketServer({
      noServer: true,
    });
    httpServer.on("upgrade", this.handleUpgrade);
  }

  shutdown() {
    this.shutdownPromise ??= this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown() {
    this.shuttingDown = true;
    if (this.sandwichTerminalizationRetryTimer !== undefined) {
      clearTimeout(this.sandwichTerminalizationRetryTimer);
      this.sandwichTerminalizationRetryTimer = undefined;
    }
    if (this.httpServer !== null) {
      this.httpServer.off("upgrade", this.handleUpgrade);
    }

    const attachments = [...this.attachments.values()];
    const shutdownResults = await Promise.allSettled(
      attachments.map(async (attachment) => {
        await attachment.processing;
        attachment.capacityCloseInitiator = "local";
        this.capacityObservability?.closeSocket({
          socketId: attachment.capacitySocketId,
          initiator: "local",
          code: 1001,
        });
        try {
          await this.terminalizeAttachment({
            attachment,
            outcome: "failed",
            reasonCode: "app_shutdown",
          });
        } finally {
          attachment.client.close(1001, "app_shutdown");
        }
      }),
    );
    await Promise.all([...this.pendingTerminalizations]);
    const sandwichTerminalizationsToRetry = [
      ...this.pendingSandwichTerminalizations.values(),
    ];
    const sandwichTerminalizationRetryIds = new Set(
      sandwichTerminalizationsToRetry.map(
        (terminalization) => terminalization.callSessionId,
      ),
    );
    const sandwichRetryResults = await Promise.allSettled(
      sandwichTerminalizationsToRetry.map((terminalization) =>
        this.retrySandwichTerminalization(terminalization),
      ),
    );
    this.websocketServer?.close();
    this.websocketServer = null;
    this.attachments.clear();
    const failureCount =
      shutdownResults.filter(
        (result, index) =>
          result.status === "rejected" &&
          !sandwichTerminalizationRetryIds.has(
            attachments[index]!.callSessionId,
          ),
      ).length +
      sandwichRetryResults.filter((result) => result.status === "rejected").length +
      this.terminalizationFailureCount;
    this.terminalizationFailureCount = 0;
    if (failureCount > 0) {
      this.logger.error(
        `[twilio-pstn] media_shutdown_failed ${JSON.stringify({ failureCount })}`,
      );
      throw new Error(
        `Twilio media shutdown failed for ${failureCount} attachment(s).`,
      );
    }
  }

  getSessionEvents(callSessionId: string) {
    return [...(this.eventHistory.get(callSessionId) ?? [])];
  }

  private registerActiveEventHistory(
    callSessionId: string,
    events: TwilioMediaStreamSessionEvent[],
  ) {
    this.completedEventHistoryIds.delete(callSessionId);
    this.eventHistory.set(callSessionId, events);
  }

  private retainCompletedEventHistory(callSessionId: string) {
    this.completedEventHistoryIds.delete(callSessionId);
    this.completedEventHistoryIds.add(callSessionId);

    while (this.completedEventHistoryIds.size > maxCompletedTwilioEventHistories) {
      const oldestCallSessionId = this.completedEventHistoryIds.values().next().value;
      if (oldestCallSessionId === undefined) {
        return;
      }
      this.completedEventHistoryIds.delete(oldestCallSessionId);
      if (!this.attachments.has(oldestCallSessionId)) {
        this.eventHistory.delete(oldestCallSessionId);
      }
    }
  }

  sendOutboundMedia(input: { callSessionId: string; frame: PstnAudioFrame }) {
    const attachment = this.requireAttachment(input.callSessionId);
    this.sendTwilioMessage(attachment, attachment.bridge.outboundMedia(input.frame));
    this.recordPhoneTestCheckpointOnce(attachment, "outboundAudioSent");
  }

  sendMark(input: { callSessionId: string; name: string }) {
    const attachment = this.requireAttachment(input.callSessionId);
    this.sendTwilioMessage(attachment, attachment.bridge.mark(input.name));
  }

  clearBufferedAudio(input: { callSessionId: string }) {
    const attachment = this.requireAttachment(input.callSessionId);
    this.sendTwilioMessage(attachment, attachment.bridge.clear());
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
        pendingMessageCount: 0,
        mediaFrameCount: 0,
        capacitySocketId: `twilio:${callSessionId}`,
        capacityOpenedAtMs: Date.now(),
        capacityHandshakeRecorded: false,
        capacityCloseInitiator: "remote",
        premiumExecutionStopped: false,
        validatedTwilioStopReceived: false,
        recordedPhoneTestCheckpoints: new Set(),
      };
      this.capacityObservability?.openSocket({
        socketId: attachment.capacitySocketId,
        leg: "twilio",
        runtimePath: "unknown",
        provider: "twilio",
      });
      this.attachments.set(callSessionId, attachment);
      this.registerActiveEventHistory(callSessionId, attachment.events);
      logTwilioPstnDiagnostic(this.logger, "media_socket_open", {
        callSessionId,
      });

      client.once("close", (code, reason) => {
        this.attachments.delete(callSessionId);
        this.retainCompletedEventHistory(callSessionId);
        const terminalOutcome = attachment.validatedTwilioStopReceived
          ? "completed"
          : "failed";
        const terminalReasonCode = attachment.validatedTwilioStopReceived
          ? "twilio_stop"
          : code === 1000
            ? "twilio_media_socket_closed_without_stop"
            : `twilio_media_socket_closed_${code}`;
        this.capacityObservability?.closeSocket({
          socketId: attachment.capacitySocketId,
          initiator: attachment.capacityCloseInitiator,
          code,
        });
        if (
          attachment.authorization !== undefined
          && attachment.authorization.runtimePath !== "pstn-premium-realtime"
        ) {
          this.capacityObservability?.clearCallQueues(callSessionId);
        }
        if (
          !(
            this.shuttingDown &&
            attachment.terminalization !== undefined
          )
        ) {
          this.trackTerminalization(
            attachment.processing.then(() =>
              this.terminalizeAttachment({
                attachment,
                outcome: terminalOutcome,
                reasonCode: terminalReasonCode,
              }),
            ),
            {
              callSessionId: attachment.callSessionId,
              reasonCode: terminalReasonCode,
              runtimePath: attachment.authorization?.runtimePath,
            },
          );
        }
        logTwilioPstnDiagnostic(this.logger, "media_socket_closed", {
          callSessionId,
          code,
          reason: reason.toString("utf8"),
          authorized: attachment.authorization !== undefined,
        });
      });
      client.on("message", (message) => {
        if (this.shuttingDown) {
          this.closeAttachment(attachment, 1001, "app_shutdown");
          return;
        }
        const messageBytes = rawDataByteLength(message);
        this.capacityObservability?.recordSocketTraffic({
          socketId: attachment.capacitySocketId,
          direction: "inbound",
          messageCount: 1,
          byteCount: messageBytes,
        });
        if (attachment.pendingMessageBytes + messageBytes > maxPendingTwilioMessageBytes) {
          this.capacityObservability?.recordQueue({
            callId: attachment.callSessionId,
            queue: "twilio_ingress",
            bytes: attachment.pendingMessageBytes + messageBytes,
            items: attachment.pendingMessageCount + 1,
            byteLimit: maxPendingTwilioMessageBytes,
          });
          this.capacityObservability?.recordQueueDrop({
            callId: attachment.callSessionId,
            queue: "twilio_ingress",
            reason: "overflow",
          });
          warnTwilioPstnDiagnostic(this.logger, "media_ingress_overflow", {
            callSessionId,
            pendingMessageBytes: attachment.pendingMessageBytes,
            incomingMessageBytes: messageBytes,
          });
          this.closeAttachment(attachment, 4408, "twilio_media.ingress_overflow");
          return;
        }
        attachment.pendingMessageBytes += messageBytes;
        attachment.pendingMessageCount += 1;
        this.recordTwilioIngressQueue(attachment);
        attachment.processing = attachment.processing
          .then(() =>
            this.handleProviderMessage({
              attachment,
              message,
            }),
          )
          .catch((error: unknown) => {
            const failure = classifyPremiumCallStartupFailure(error);
            warnTwilioPstnDiagnostic(this.logger, "media_handler_failed", {
              organizationId: attachment.authorization?.organizationId,
              connectionId: attachment.authorization?.connectionId,
              dispatchId: attachment.authorization?.dispatchId,
              callSessionId: attachment.callSessionId,
              runtimePath: attachment.authorization?.runtimePath,
              failureCode: failure.failureCode,
              stage: failure.stage,
            });
            this.closeAttachment(attachment, 4400, failure.failureCode);
          })
          .finally(() => {
            attachment.pendingMessageBytes = Math.max(0, attachment.pendingMessageBytes - messageBytes);
            attachment.pendingMessageCount = Math.max(0, attachment.pendingMessageCount - 1);
            this.recordTwilioIngressQueue(attachment);
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
        this.closeAttachment(attachment, 4400, error.code);
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
      const admissionActivation =
        await this.pstnAdmissionCoordinator.activate(
          attachment.authorization.organizationId,
          attachment.authorization.callSessionId,
          {
            provider: "twilio",
            providerAccountId: attachment.authorization.providerAccountId,
            runtime: attachment.authorization.runtimePath,
          },
        );
      if (
        admissionActivation.outcome !== "activated" &&
        admissionActivation.outcome !== "existing"
      ) {
        const error: TwilioMediaStreamBridgeError = {
          code: "twilio_media.admission_claim_unavailable",
          message: "The PSTN admission claim could not be activated.",
          safeToClose: true,
          receivedAt: result.event.receivedAt,
          details: {
            outcome: admissionActivation.outcome,
          },
        };
        warnTwilioPstnDiagnostic(
          this.logger,
          "media_admission_activation_failed",
          {
            organizationId: attachment.authorization.organizationId,
            connectionId: attachment.authorization.connectionId,
            dispatchId: attachment.authorization.dispatchId,
            callSessionId: attachment.authorization.callSessionId,
            outcome: admissionActivation.outcome,
          },
        );
        await this.telephonyService.recordPstnCallLifecycle({
          organizationId: attachment.authorization.organizationId,
          callSessionId: attachment.authorization.callSessionId,
          stage: "failed",
          reasonCode: "pstn_admission_activation_failed",
        });
        this.closeWithError(attachment, error);
        return;
      }
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
      await this.telephonyService.recordPstnCallLifecycle({
        organizationId: attachment.authorization.organizationId,
        callSessionId: attachment.authorization.callSessionId,
        stage: "media-connected",
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
            close: (code, reason) => this.closeAttachment(attachment, code, reason),
          },
        });
      } else {
        await this.telephonyService.recordTwilioMediaStreamLifecycle({
          organizationId: attachment.authorization.organizationId,
          callSessionId: attachment.authorization.callSessionId,
          streamSid: result.event.streamSid,
          status: "active",
          at: result.event.receivedAt,
        });
        this.capacityObservability?.trackCall({
          callId: attachment.authorization.callSessionId,
          state: "active",
          runtimePath: attachment.authorization.runtimePath,
          provider: "sandwich",
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

    if (
      result.event.type === "mark"
      && attachment.authorization.runtimePath === "pstn-premium-realtime"
    ) {
      this.premiumCallExecution.acknowledgePlaybackMark({
        callSessionId: attachment.authorization.callSessionId,
        name: result.event.name,
      });
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
      attachment.validatedTwilioStopReceived = true;
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
      if (attachment.authorization.runtimePath === "pstn-premium-realtime") {
        await this.premiumCallExecution.stop({
          callSessionId: attachment.authorization.callSessionId,
          outcome: "completed",
          reasonCode: "twilio_stop",
        });
        attachment.premiumExecutionStopped = true;
        for (const checkpoint of ["cleanEnd", "noFatalError"] as const) {
          await this.telephonyService.recordPstnPhoneTestCheckpoint({
            organizationId: attachment.authorization.organizationId,
            callSessionId: attachment.authorization.callSessionId,
            checkpoint,
            at: result.event.receivedAt,
          });
        }
      } else {
        await this.telephonyService.recordPstnCallLifecycle({
          organizationId: attachment.authorization.organizationId,
          callSessionId: attachment.authorization.callSessionId,
          stage: "draining",
          at: result.event.receivedAt,
        });
        await this.telephonyService.recordTwilioMediaStreamLifecycle({
          organizationId: attachment.authorization.organizationId,
          callSessionId: attachment.authorization.callSessionId,
          streamSid: result.event.streamSid,
          status: "completed",
          at: result.event.receivedAt,
        });
      }
      this.closeAttachment(attachment, 1000, "twilio_stop");
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
      this.closeAttachment(attachment, 4400, "twilio_media.invalid_message");
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
      this.closeAttachment(attachment, 4401, "missing_stream_token");
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
      this.closeAttachment(attachment, 4401, "missing_stream_token");
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
      this.closeAttachment(attachment, 4401, "invalid_stream_token");
      return "handled";
    }

    const startAccountSid = readString(start?.accountSid)?.trim();
    if (
      startAccountSid === undefined ||
      startAccountSid !== authorization.providerAccountId
    ) {
      warnTwilioPstnDiagnostic(this.logger, "media_start_authorization_failed", {
        callSessionId: attachment.callSessionId,
        accountSid: startAccountSid,
        callSid: readString(start?.callSid),
        streamSid: readString(start?.streamSid) ?? readString(parsedMessage.streamSid),
        reason: "provider_account_mismatch",
      });
      this.closeAttachment(attachment, 4401, "provider_account_mismatch");
      return "handled";
    }

    attachment.authorization = authorization;
    attachment.bridge = createTwilioMediaStreamsBridge({
      callSessionId: attachment.callSessionId,
      expectedCallSid: authorization.expectedCallSid,
    });
    this.capacityObservability?.updateSocketContext({
      socketId: attachment.capacitySocketId,
      runtimePath: authorization.runtimePath,
      provider: "twilio",
    });
    this.recordTwilioHandshake(attachment, "accepted");
    this.capacityObservability?.trackCall({
      callId: authorization.callSessionId,
      state: "reserved",
      runtimePath: authorization.runtimePath,
      provider: authorization.runtimePath === "pstn-sandwich" ? "sandwich" : "other",
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
    this.closeAttachment(attachment, 4400, error.code);
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

  private sendTwilioMessage(attachment: TwilioMediaStreamAttachment, message: unknown) {
    const serialized = JSON.stringify(message);
    attachment.client.send(serialized);
    this.capacityObservability?.recordSocketTraffic({
      socketId: attachment.capacitySocketId,
      direction: "outbound",
      messageCount: 1,
      byteCount: Buffer.byteLength(serialized, "utf8"),
    });
    this.capacityObservability?.recordSocketBuffered({
      socketId: attachment.capacitySocketId,
      bufferedBytes: attachment.client.bufferedAmount,
    });
  }

  private recordTwilioIngressQueue(attachment: TwilioMediaStreamAttachment) {
    this.capacityObservability?.recordQueue({
      callId: attachment.callSessionId,
      queue: "twilio_ingress",
      bytes: attachment.pendingMessageBytes,
      items: attachment.pendingMessageCount,
      byteLimit: maxPendingTwilioMessageBytes,
    });
  }

  private recordTwilioHandshake(
    attachment: TwilioMediaStreamAttachment,
    outcome: "accepted" | "rejected" | "failed",
  ) {
    if (attachment.capacityHandshakeRecorded) return;
    attachment.capacityHandshakeRecorded = true;
    this.capacityObservability?.recordSocketHandshake({
      socketId: attachment.capacitySocketId,
      latencyMs: Math.max(0, Date.now() - attachment.capacityOpenedAtMs),
      outcome,
    });
  }

  private closeAttachment(attachment: TwilioMediaStreamAttachment, code: number, reason: string) {
    if (!attachment.capacityHandshakeRecorded) {
      this.recordTwilioHandshake(attachment, "rejected");
    }
    attachment.capacityCloseInitiator = "local";
    attachment.client.close(code, reason);
  }

  private terminalizeAttachment(input: {
    attachment: TwilioMediaStreamAttachment;
    outcome: "completed" | "failed";
    reasonCode: string;
  }) {
    const existing = input.attachment.terminalization;
    if (existing !== undefined) {
      return existing;
    }

    const authorization = input.attachment.authorization;
    if (authorization === undefined) {
      return Promise.resolve();
    }

    const terminalization = (async () => {
      if (authorization.runtimePath === "pstn-premium-realtime") {
        if (!input.attachment.premiumExecutionStopped) {
          await this.premiumCallExecution.stop({
            callSessionId: authorization.callSessionId,
            outcome: input.outcome,
            reasonCode: input.reasonCode,
          });
          input.attachment.premiumExecutionStopped = true;
        }
        return;
      }

      const pending = this.getOrCreatePendingSandwichTerminalization({
        organizationId: authorization.organizationId,
        callSessionId: authorization.callSessionId,
        outcome: input.outcome,
        reasonCode: input.reasonCode,
      });
      await this.retrySandwichTerminalization(pending, true);
    })();
    input.attachment.terminalization = terminalization;
    return terminalization;
  }

  private trackTerminalization(
    terminalization: Promise<void>,
    context: {
      callSessionId: string;
      reasonCode: string;
      runtimePath?: TwilioMediaStreamAuthorization["runtimePath"] | undefined;
    },
  ) {
    const tracked = terminalization
      .catch(() => {
        if (
          context.runtimePath !== "pstn-premium-realtime" &&
          !this.pendingSandwichTerminalizations.has(context.callSessionId)
        ) {
          this.terminalizationFailureCount += 1;
        }
        this.logger.error(
          `[twilio-pstn] media_terminalization_failed ${JSON.stringify({
            callSessionId: context.callSessionId,
            reasonCode: context.reasonCode,
            runtimePath: context.runtimePath,
          })}`,
        );
      })
      .finally(() => {
        this.pendingTerminalizations.delete(tracked);
      });
    this.pendingTerminalizations.add(tracked);
  }

  private getOrCreatePendingSandwichTerminalization(
    input: Omit<
      PendingSandwichTerminalization,
      "nextRetryAtMs" | "retryBackoffStep" | "terminalization"
    >,
  ) {
    const existing = this.pendingSandwichTerminalizations.get(input.callSessionId);
    if (existing !== undefined) {
      return existing;
    }
    if (
      this.pendingSandwichTerminalizations.size >=
      maxPendingSandwichTerminalizations
    ) {
      throw new Error("Twilio sandwich terminalization ownership is exhausted.");
    }

    const pending: PendingSandwichTerminalization = {
      ...input,
      retryBackoffStep: 0,
    };
    this.pendingSandwichTerminalizations.set(input.callSessionId, pending);
    return pending;
  }

  private retrySandwichTerminalization(
    pending: PendingSandwichTerminalization,
    scheduleAutomaticRetry = false,
  ): Promise<void> {
    if (
      this.pendingSandwichTerminalizations.get(pending.callSessionId) !== pending
    ) {
      return Promise.resolve();
    }
    if (pending.terminalization !== undefined) {
      return pending.terminalization;
    }

    const terminalization = (async () => {
      await this.telephonyService.recordPstnCallLifecycle({
        organizationId: pending.organizationId,
        callSessionId: pending.callSessionId,
        stage: pending.outcome,
        reasonCode: pending.reasonCode,
      });
      this.pendingSandwichTerminalizations.delete(pending.callSessionId);
      this.capacityObservability?.endCall({
        callId: pending.callSessionId,
        outcome: pending.outcome,
      });
    })();
    pending.terminalization = terminalization;
    void terminalization.then(
      () => {
        if (pending.terminalization === terminalization) {
          pending.terminalization = undefined;
        }
      },
      () => {
        if (pending.terminalization === terminalization) {
          pending.terminalization = undefined;
        }
        if (scheduleAutomaticRetry) {
          this.scheduleSandwichTerminalizationRetry(pending);
        }
      },
    );
    return terminalization;
  }

  private scheduleSandwichTerminalizationRetry(
    pending: PendingSandwichTerminalization,
  ) {
    if (
      this.shuttingDown ||
      this.pendingSandwichTerminalizations.get(pending.callSessionId) !== pending
    ) {
      return;
    }

    const delayMs =
      sandwichTerminalizationRetryBaseDelayMs *
      2 ** pending.retryBackoffStep;
    pending.retryBackoffStep = Math.min(
      pending.retryBackoffStep + 1,
      maxSandwichTerminalizationRetryBackoffStep,
    );
    pending.nextRetryAtMs = Date.now() + delayMs;
    this.scheduleNextSandwichTerminalizationRetry();
  }

  private scheduleNextSandwichTerminalizationRetry() {
    if (this.shuttingDown) {
      return;
    }
    const nextRetryAtMs = Math.min(
      ...[...this.pendingSandwichTerminalizations.values()]
        .map((pending) => pending.nextRetryAtMs)
        .filter((retryAtMs): retryAtMs is number => retryAtMs !== undefined),
    );
    if (!Number.isFinite(nextRetryAtMs)) {
      return;
    }
    if (this.sandwichTerminalizationRetryTimer !== undefined) {
      clearTimeout(this.sandwichTerminalizationRetryTimer);
    }
    this.sandwichTerminalizationRetryTimer = setTimeout(
      () => this.runDueSandwichTerminalizationRetries(),
      Math.max(0, nextRetryAtMs - Date.now()),
    );
  }

  private runDueSandwichTerminalizationRetries() {
    this.sandwichTerminalizationRetryTimer = undefined;
    if (this.shuttingDown) {
      return;
    }

    const now = Date.now();
    for (const pending of this.pendingSandwichTerminalizations.values()) {
      if (
        pending.nextRetryAtMs === undefined ||
        pending.nextRetryAtMs > now
      ) {
        continue;
      }
      pending.nextRetryAtMs = undefined;
      this.trackTerminalization(
        this.retrySandwichTerminalization(pending, true),
        {
          callSessionId: pending.callSessionId,
          reasonCode: pending.reasonCode,
          runtimePath: "pstn-sandwich",
        },
      );
    }
    this.scheduleNextSandwichTerminalizationRetry();
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
