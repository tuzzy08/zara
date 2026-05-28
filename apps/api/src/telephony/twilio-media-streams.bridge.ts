import {
  PSTN_MULAW_CODEC,
  type PstnAudioFrame,
} from "@zara/core";

export interface TwilioMediaStreamsBridgeInput {
  callSessionId: string;
  expectedCallSid: string;
  now?: () => string;
}

export type TwilioMediaStreamBridgeResult =
  | {
      ok: true;
      event: TwilioMediaStreamBridgeEvent;
    }
  | {
      ok: false;
      error: TwilioMediaStreamBridgeError;
    };

export type TwilioMediaStreamBridgeEvent =
  | {
      type: "connected";
      protocol: string;
      version: string;
      receivedAt: string;
    }
  | {
      type: "started";
      callSid: string;
      streamSid: string;
      sequence: number;
      track: "inbound";
      codec: typeof PSTN_MULAW_CODEC;
      receivedAt: string;
      customParameters: Record<string, string>;
    }
  | {
      type: "media";
      frame: PstnAudioFrame;
      provider: {
        callSid: string;
        streamSid: string;
        sequenceNumber: string;
        chunk: string;
        track: "inbound";
      };
      receivedAt: string;
    }
  | {
      type: "dtmf";
      streamSid: string;
      sequence: number;
      track: "inbound_track";
      digit: string;
      receivedAt: string;
    }
  | {
      type: "mark";
      streamSid: string;
      sequence: number;
      name: string;
      receivedAt: string;
    }
  | {
      type: "stopped";
      callSid: string;
      streamSid: string;
      sequence: number;
      receivedAt: string;
    };

export interface TwilioMediaStreamBridgeError {
  code: string;
  message: string;
  safeToClose: boolean;
  receivedAt: string;
  details: Record<string, string | number | boolean>;
}

export type TwilioOutboundMediaMessage = {
  event: "media";
  streamSid: string;
  media: {
    payload: string;
  };
};

export type TwilioOutboundMarkMessage = {
  event: "mark";
  streamSid: string;
  mark: {
    name: string;
  };
};

export type TwilioOutboundClearMessage = {
  event: "clear";
  streamSid: string;
};

export function renderTwilioConnectStreamTwiML(input: {
  mediaStreamBaseUrl: string;
  callSessionId: string;
  organizationId: string;
  connectionId: string;
  publishedVersionId: string;
  workspaceId?: string | undefined;
}) {
  const streamUrl = `${input.mediaStreamBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(input.callSessionId)}`;
  const parameters: Array<[string, string]> = [
    ["zaraCallSessionId", input.callSessionId],
    ["zaraOrganizationId", input.organizationId],
    ["zaraConnectionId", input.connectionId],
    ["zaraPublishedVersionId", input.publishedVersionId],
    ...(input.workspaceId === undefined
      ? []
      : [["zaraWorkspaceId", input.workspaceId] satisfies [string, string]]),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    "  <Connect>",
    `    <Stream url="${escapeXml(streamUrl)}">`,
    ...parameters.map(([name, value]) => `      <Parameter name="${escapeXml(name)}" value="${escapeXml(value)}" />`),
    "    </Stream>",
    "  </Connect>",
    "</Response>",
  ].join("");
}

export function renderTwilioRejectTwiML(reason: "busy" | "rejected") {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `  <Reject reason="${reason}" />`,
    "</Response>",
  ].join("");
}

export function createTwilioMediaStreamsBridge(input: TwilioMediaStreamsBridgeInput) {
  const now = input.now ?? (() => new Date().toISOString());
  let streamSid: string | undefined;
  let callSid: string | undefined;
  let stopped = false;
  let lastMediaSequence = 0;

  const currentStreamSid = () => {
    if (streamSid === undefined) {
      throw new TwilioMediaStreamsBridgeStateError(
        "twilio_media.missing_stream_sid",
        "Twilio media stream has not started yet.",
      );
    }

    return streamSid;
  };

  return {
    receive(message: unknown): TwilioMediaStreamBridgeResult {
      if (!isObject(message)) {
        return failure(
          "twilio_media.invalid_message",
          "Twilio media message must be a JSON object.",
          now(),
        );
      }

      if (stopped) {
        return failure(
          "twilio_media.stream_stopped",
          "Twilio media stream is already stopped.",
          now(),
          { streamSid: streamSid ?? "unknown" },
        );
      }

      switch (message.event) {
        case "connected":
          return {
            ok: true,
            event: {
              type: "connected",
              protocol: readString(message.protocol) ?? "unknown",
              version: readString(message.version) ?? "unknown",
              receivedAt: now(),
            },
          };
        case "start": {
          const start = isObject(message.start) ? message.start : undefined;
          const nextStreamSid = readString(message.streamSid) ?? readString(start?.streamSid);
          const nextCallSid = readString(start?.callSid);
          const sequence = readInteger(message.sequenceNumber);

          if (nextStreamSid === undefined || nextCallSid === undefined || sequence === undefined) {
            return failure(
              "twilio_media.invalid_start",
              "Twilio start message requires streamSid, callSid, and sequenceNumber.",
              now(),
            );
          }

          if (nextCallSid !== input.expectedCallSid) {
            return failure(
              "twilio_media.call_sid_mismatch",
              "Twilio start message call SID does not match the routed call.",
              now(),
              { expectedCallSid: input.expectedCallSid, callSid: nextCallSid },
            );
          }

          const mediaFormat = isObject(start?.mediaFormat) ? start.mediaFormat : undefined;
          const encoding = readString(mediaFormat?.encoding);
          const sampleRate = readInteger(mediaFormat?.sampleRate);
          const channels = readInteger(mediaFormat?.channels);
          if (
            encoding !== "audio/x-mulaw" ||
            sampleRate !== PSTN_MULAW_CODEC.sampleRateHz ||
            channels !== PSTN_MULAW_CODEC.channels
          ) {
            return failure(
              "twilio_media.unsupported_codec",
              "Twilio stream must use audio/x-mulaw at 8000 Hz mono.",
              now(),
              {
                encoding: encoding ?? "unknown",
                sampleRate: sampleRate ?? 0,
                channels: channels ?? 0,
              },
            );
          }

          streamSid = nextStreamSid;
          callSid = nextCallSid;

          return {
            ok: true,
            event: {
              type: "started",
              callSid: nextCallSid,
              streamSid: nextStreamSid,
              sequence,
              track: "inbound",
              codec: PSTN_MULAW_CODEC,
              receivedAt: now(),
              customParameters: readStringMap(start?.customParameters),
            },
          };
        }
        case "media": {
          const media = isObject(message.media) ? message.media : undefined;
          const activeStreamSid = streamSid;
          const activeCallSid = callSid;
          const messageStreamSid = readString(message.streamSid);
          const sequence = readInteger(message.sequenceNumber);
          const timestampMs = readInteger(media?.timestamp);
          const chunk = readString(media?.chunk);
          const payloadBase64 = readString(media?.payload);
          const track = readString(media?.track);

          if (
            activeStreamSid === undefined ||
            activeCallSid === undefined ||
            messageStreamSid === undefined ||
            sequence === undefined ||
            timestampMs === undefined ||
            chunk === undefined ||
            payloadBase64 === undefined
          ) {
            return failure(
              "twilio_media.invalid_media",
              "Twilio media message requires an active stream, streamSid, sequenceNumber, timestamp, chunk, and payload.",
              now(),
            );
          }

          if (messageStreamSid !== activeStreamSid) {
            return failure(
              "twilio_media.stream_sid_mismatch",
              "Twilio media message stream SID does not match the active stream.",
              now(),
              { expectedStreamSid: activeStreamSid, streamSid: messageStreamSid },
            );
          }

          if (track !== "inbound") {
            return failure(
              "twilio_media.unsupported_track",
              "Bidirectional Twilio streams must send only the inbound track to Zara.",
              now(),
              { track: track ?? "unknown" },
            );
          }

          if (!isRawMulawBase64(payloadBase64)) {
            return failure(
              "twilio_media.invalid_payload",
              "Twilio media payload must be base64 raw mu-law audio without file headers.",
              now(),
              { sequence },
            );
          }

          if (sequence <= lastMediaSequence) {
            return failure(
              "twilio_media.replayed_sequence",
              "Twilio media sequence number must increase monotonically.",
              now(),
              { sequence, lastSequence: lastMediaSequence },
            );
          }
          lastMediaSequence = sequence;

          return {
            ok: true,
            event: {
              type: "media",
              frame: {
                callSessionId: input.callSessionId,
                mediaStreamId: activeStreamSid,
                direction: "inbound",
                codec: PSTN_MULAW_CODEC,
                sequence,
                timestampMs,
                payloadBase64,
              },
              provider: {
                callSid: activeCallSid,
                streamSid: activeStreamSid,
                sequenceNumber: String(message.sequenceNumber),
                chunk,
                track: "inbound",
              },
              receivedAt: now(),
            },
          };
        }
        case "dtmf": {
          const dtmf = isObject(message.dtmf) ? message.dtmf : undefined;
          const messageStreamSid = readString(message.streamSid);
          const sequence = readInteger(message.sequenceNumber);
          const digit = readString(dtmf?.digit);
          const track = readString(dtmf?.track);
          if (
            messageStreamSid === undefined ||
            sequence === undefined ||
            digit === undefined ||
            track !== "inbound_track"
          ) {
            return failure(
              "twilio_media.invalid_dtmf",
              "Twilio DTMF message requires streamSid, sequenceNumber, inbound_track, and digit.",
              now(),
            );
          }

          return {
            ok: true,
            event: {
              type: "dtmf",
              streamSid: messageStreamSid,
              sequence,
              track: "inbound_track",
              digit,
              receivedAt: now(),
            },
          };
        }
        case "mark": {
          const mark = isObject(message.mark) ? message.mark : undefined;
          const messageStreamSid = readString(message.streamSid);
          const sequence = readInteger(message.sequenceNumber);
          const name = readString(mark?.name);
          if (messageStreamSid === undefined || sequence === undefined || name === undefined) {
            return failure(
              "twilio_media.invalid_mark",
              "Twilio mark message requires streamSid, sequenceNumber, and mark.name.",
              now(),
            );
          }

          return {
            ok: true,
            event: {
              type: "mark",
              streamSid: messageStreamSid,
              sequence,
              name,
              receivedAt: now(),
            },
          };
        }
        case "stop": {
          const stop = isObject(message.stop) ? message.stop : undefined;
          const messageStreamSid = readString(message.streamSid);
          const sequence = readInteger(message.sequenceNumber);
          const stopCallSid = readString(stop?.callSid) ?? callSid;
          if (messageStreamSid === undefined || sequence === undefined || stopCallSid === undefined) {
            return failure(
              "twilio_media.invalid_stop",
              "Twilio stop message requires streamSid, sequenceNumber, and callSid.",
              now(),
            );
          }

          stopped = true;
          return {
            ok: true,
            event: {
              type: "stopped",
              callSid: stopCallSid,
              streamSid: messageStreamSid,
              sequence,
              receivedAt: now(),
            },
          };
        }
        default:
          return failure(
            "twilio_media.unsupported_event",
            "Twilio media message event is not supported.",
            now(),
            { event: readString(message.event) ?? "unknown" },
          );
      }
    },

    outboundMedia(frame: PstnAudioFrame): TwilioOutboundMediaMessage {
      const activeStreamSid = currentStreamSid();
      if (
        frame.direction !== "outbound" ||
        frame.mediaStreamId !== activeStreamSid ||
        frame.codec.name !== PSTN_MULAW_CODEC.name ||
        frame.codec.sampleRateHz !== PSTN_MULAW_CODEC.sampleRateHz ||
        frame.codec.channels !== PSTN_MULAW_CODEC.channels
      ) {
        throw new TwilioMediaStreamsBridgeStateError(
          "twilio_media.invalid_outbound_media",
          "Twilio outbound media must be mu-law 8000 Hz mono for the active stream.",
        );
      }

      return {
        event: "media",
        streamSid: activeStreamSid,
        media: {
          payload: frame.payloadBase64,
        },
      };
    },

    mark(name: string): TwilioOutboundMarkMessage {
      return {
        event: "mark",
        streamSid: currentStreamSid(),
        mark: {
          name,
        },
      };
    },

    clear(): TwilioOutboundClearMessage {
      return {
        event: "clear",
        streamSid: currentStreamSid(),
      };
    },
  };
}

export class TwilioMediaStreamsBridgeStateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TwilioMediaStreamsBridgeStateError";
  }
}

function failure(
  code: string,
  message: string,
  receivedAt: string,
  details: Record<string, string | number | boolean> = {},
): TwilioMediaStreamBridgeResult {
  return {
    ok: false,
    error: {
      code,
      message,
      safeToClose: true,
      receivedAt,
      details,
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false;
}

function readString(value: unknown, fallback?: string): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readStringMap(value: unknown) {
  if (!isObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function isRawMulawBase64(payload: string) {
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(payload) === false) {
    return false;
  }

  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0) {
    return false;
  }

  const header = bytes.subarray(0, 4).toString("ascii");
  return header !== "RIFF";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
