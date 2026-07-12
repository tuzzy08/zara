import { describe, expect, it } from "vitest";

import {
  createTwilioMediaStreamsBridge,
  renderTwilioConnectStreamTwiML,
} from "./twilio-media-streams.bridge";

describe("Twilio Media Streams bridge", () => {
  it("renders Twilio Stream TwiML with custom parameters instead of query parameters", () => {
    const twiml = renderTwilioConnectStreamTwiML({
      mediaStreamBaseUrl: "wss://api.zara.test/telephony/twilio/media-streams/",
      callSessionId: "CA-webhook-1:telephony",
      streamToken: "stream-token-1",
      organizationId: "tenant-west-africa",
      connectionId: "connection-twilio-1",
      publishedVersionId: "workflow-support-v1",
      runtimePath: "pstn-sandwich",
      workspaceId: "workspace-customer-success",
    });

    expect(twiml).toContain(
      '<Stream url="wss://api.zara.test/telephony/twilio/media-streams/CA-webhook-1%3Atelephony">',
    );
    expect(twiml).not.toContain("?token=");
    expect(twiml).toContain(
      '<Parameter name="zaraStreamToken" value="stream-token-1" />',
    );
    expect(twiml).toContain(
      '<Parameter name="zaraRuntimePath" value="pstn-sandwich" />',
    );
  });

  it("normalizes Twilio bidirectional stream messages and keeps provider IDs out of PSTN frames", () => {
    const bridge = createTwilioMediaStreamsBridge({
      callSessionId: "CA-webhook-1:telephony",
      expectedCallSid: "CA-webhook-1",
      now: () => "2026-05-28T12:00:00.000Z",
    });

    expect(bridge.receive({
      event: "connected",
      protocol: "Call",
      version: "1.0.0",
    })).toMatchObject({
      ok: true,
      event: {
        type: "connected",
        protocol: "Call",
        version: "1.0.0",
      },
    });

    const started = bridge.receive({
      event: "start",
      sequenceNumber: "1",
      streamSid: "MZ-stream-1",
      start: {
        accountSid: "AC-account-1",
        callSid: "CA-webhook-1",
        streamSid: "MZ-stream-1",
        tracks: ["inbound"],
        mediaFormat: {
          encoding: "audio/x-mulaw",
          sampleRate: 8000,
          channels: 1,
        },
        customParameters: {
          zaraCallSessionId: "CA-webhook-1:telephony",
        },
      },
    });

    expect(started).toMatchObject({
      ok: true,
      event: {
        type: "started",
        callSid: "CA-webhook-1",
        streamSid: "MZ-stream-1",
        sequence: 1,
        track: "inbound",
        codec: {
          name: "g711_mulaw",
          sampleRateHz: 8000,
          channels: 1,
        },
      },
    });

    const media = bridge.receive({
      event: "media",
      sequenceNumber: "2",
      streamSid: "MZ-stream-1",
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: "//////////8=",
      },
    });

    expect(media).toMatchObject({
      ok: true,
      event: {
        type: "media",
        provider: {
          callSid: "CA-webhook-1",
          streamSid: "MZ-stream-1",
          sequenceNumber: "2",
          chunk: "1",
          track: "inbound",
        },
        frame: {
          callSessionId: "CA-webhook-1:telephony",
          mediaStreamId: "MZ-stream-1",
          direction: "inbound",
          sequence: 2,
          timestampMs: 20,
          payloadBase64: "//////////8=",
          codec: {
            name: "g711_mulaw",
            sampleRateHz: 8000,
            channels: 1,
          },
        },
      },
    });
    expect(media.ok && media.event.type === "media" ? media.event.frame : {}).not.toHaveProperty("callSid");
    expect(media.ok && media.event.type === "media" ? media.event.frame : {}).not.toHaveProperty("streamSid");

    expect(bridge.receive({
      event: "dtmf",
      sequenceNumber: "3",
      streamSid: "MZ-stream-1",
      dtmf: {
        track: "inbound_track",
        digit: "5",
      },
    })).toMatchObject({
      ok: true,
      event: {
        type: "dtmf",
        digit: "5",
        track: "inbound_track",
      },
    });

    expect(bridge.receive({
      event: "mark",
      sequenceNumber: "4",
      streamSid: "MZ-stream-1",
      mark: {
        name: "response-1",
      },
    })).toMatchObject({
      ok: true,
      event: {
        type: "mark",
        name: "response-1",
      },
    });

    expect(bridge.receive({
      event: "mark",
      sequenceNumber: "5",
      streamSid: "MZ-wrong-stream",
      mark: { name: "response-wrong-stream" },
    })).toMatchObject({
      ok: false,
      error: { code: "twilio_media.stream_sid_mismatch" },
    });

    expect(bridge.outboundMedia({
      callSessionId: "CA-webhook-1:telephony",
      mediaStreamId: "MZ-stream-1",
      direction: "outbound",
      codec: {
        name: "g711_mulaw",
        sampleRateHz: 8000,
        channels: 1,
      },
      sequence: 1,
      timestampMs: 40,
      payloadBase64: "AAAA////",
    })).toEqual({
      event: "media",
      streamSid: "MZ-stream-1",
      media: {
        payload: "AAAA////",
      },
    });

    expect(bridge.mark("response-1")).toEqual({
      event: "mark",
      streamSid: "MZ-stream-1",
      mark: {
        name: "response-1",
      },
    });

    expect(bridge.clear()).toEqual({
      event: "clear",
      streamSid: "MZ-stream-1",
    });

    expect(bridge.receive({
      event: "stop",
      sequenceNumber: "5",
      streamSid: "MZ-stream-1",
      stop: {
        accountSid: "AC-account-1",
        callSid: "CA-webhook-1",
      },
    })).toMatchObject({
      ok: true,
      event: {
        type: "stopped",
        callSid: "CA-webhook-1",
        streamSid: "MZ-stream-1",
        sequence: 5,
      },
    });
  });

  it("rejects malformed or replayed media frames with structured safe-close errors", () => {
    const bridge = createTwilioMediaStreamsBridge({
      callSessionId: "CA-webhook-2:telephony",
      expectedCallSid: "CA-webhook-2",
      now: () => "2026-05-28T12:05:00.000Z",
    });

    bridge.receive({
      event: "start",
      sequenceNumber: "1",
      streamSid: "MZ-stream-2",
      start: {
        callSid: "CA-webhook-2",
        streamSid: "MZ-stream-2",
        mediaFormat: {
          encoding: "audio/x-mulaw",
          sampleRate: 8000,
          channels: 1,
        },
      },
    });

    expect(bridge.receive({
      event: "media",
      sequenceNumber: "2",
      streamSid: "MZ-stream-2",
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: "UklGRg==",
      },
    })).toMatchObject({
      ok: false,
      error: {
        code: "twilio_media.invalid_payload",
        safeToClose: true,
      },
    });

    expect(bridge.receive({
      event: "media",
      sequenceNumber: "3",
      streamSid: "MZ-stream-2",
      media: {
        track: "inbound",
        chunk: "2",
        timestamp: "40",
        payload: "//////////8=",
      },
    })).toMatchObject({
      ok: true,
    });

    expect(bridge.receive({
      event: "media",
      sequenceNumber: "3",
      streamSid: "MZ-stream-2",
      media: {
        track: "inbound",
        chunk: "3",
        timestamp: "60",
        payload: "//////////8=",
      },
    })).toMatchObject({
      ok: false,
      error: {
        code: "twilio_media.replayed_sequence",
        safeToClose: true,
        details: {
          sequence: 3,
          lastSequence: 3,
        },
      },
    });
  });

  it("rejects unsupported start codecs and messages after stop", () => {
    const unsupportedCodecBridge = createTwilioMediaStreamsBridge({
      callSessionId: "CA-webhook-3:telephony",
      expectedCallSid: "CA-webhook-3",
      now: () => "2026-05-28T12:10:00.000Z",
    });

    expect(unsupportedCodecBridge.receive({
      event: "start",
      sequenceNumber: "1",
      streamSid: "MZ-stream-3",
      start: {
        callSid: "CA-webhook-3",
        streamSid: "MZ-stream-3",
        mediaFormat: {
          encoding: "audio/pcm",
          sampleRate: 16000,
          channels: 1,
        },
      },
    })).toMatchObject({
      ok: false,
      error: {
        code: "twilio_media.unsupported_codec",
        safeToClose: true,
        details: {
          encoding: "audio/pcm",
          sampleRate: 16000,
          channels: 1,
        },
      },
    });

    const stoppedBridge = createTwilioMediaStreamsBridge({
      callSessionId: "CA-webhook-4:telephony",
      expectedCallSid: "CA-webhook-4",
      now: () => "2026-05-28T12:11:00.000Z",
    });
    stoppedBridge.receive({
      event: "start",
      sequenceNumber: "1",
      streamSid: "MZ-stream-4",
      start: {
        callSid: "CA-webhook-4",
        streamSid: "MZ-stream-4",
        mediaFormat: {
          encoding: "audio/x-mulaw",
          sampleRate: 8000,
          channels: 1,
        },
      },
    });
    stoppedBridge.receive({
      event: "stop",
      sequenceNumber: "2",
      streamSid: "MZ-stream-4",
      stop: {
        callSid: "CA-webhook-4",
      },
    });

    expect(stoppedBridge.receive({
      event: "media",
      sequenceNumber: "3",
      streamSid: "MZ-stream-4",
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: "//////////8=",
      },
    })).toMatchObject({
      ok: false,
      error: {
        code: "twilio_media.stream_stopped",
        safeToClose: true,
      },
    });
  });
});
