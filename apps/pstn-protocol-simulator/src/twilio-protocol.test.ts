import { describe, expect, it } from "vitest";

import {
  createCallFingerprint,
  createTwilioMediaFrames,
  parseConnectStreamTwiML,
  signTwilioWebhook,
  verifyCallFingerprint,
} from "./twilio-protocol";

describe("Twilio protocol simulator", () => {
  it("signs the exact form webhook and extracts a queryless stream token", () => {
    const parameters = {
      AccountSid: "AC11111111111111111111111111111111",
      CallSid: "CA11111111111111111111111111111111",
      From: "+15550001111",
      To: "+15550002222",
    };

    expect(signTwilioWebhook({
      authToken: "test-auth-token",
      parameters,
      url: "https://api.example.test/telephony/webhooks/twilio",
    })).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);

    expect(parseConnectStreamTwiML(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Connect><Stream url="wss://api.example.test/telephony/twilio/media-streams/call-1">
        <Parameter name="zaraStreamToken" value="opaque-one-time-token" />
        <Parameter name="zaraRuntimePath" value="pstn-premium-realtime" />
        <Parameter name="zaraWorkerId" value="worker-simulator-1" />
        <Parameter name="zaraWorkerReleaseId" value="release-simulator-1" />
      </Stream></Connect></Response>`)).toEqual({
      streamUrl: "wss://api.example.test/telephony/twilio/media-streams/call-1",
      streamToken: "opaque-one-time-token",
      runtimePath: "pstn-premium-realtime",
      workerId: "worker-simulator-1",
      workerReleaseId: "release-simulator-1",
    });
  });

  it("rejects premium TwiML without the signed worker target", () => {
    expect(() => parseConnectStreamTwiML(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Connect><Stream url="wss://api.example.test/telephony/twilio/media-streams/call-1">
        <Parameter name="zaraStreamToken" value="opaque-one-time-token" />
        <Parameter name="zaraRuntimePath" value="pstn-premium-realtime" />
      </Stream></Connect></Response>`)).toThrow("required Zara parameters");
  });

  it("rejects premium TwiML without the signed worker release", () => {
    expect(() => parseConnectStreamTwiML(`<?xml version="1.0" encoding="UTF-8"?>
      <Response><Connect><Stream url="wss://api.example.test/telephony/twilio/media-streams/call-1">
        <Parameter name="zaraStreamToken" value="opaque-one-time-token" />
        <Parameter name="zaraRuntimePath" value="pstn-premium-realtime" />
        <Parameter name="zaraWorkerId" value="worker-simulator-1" />
      </Stream></Connect></Response>`)).toThrow("required Zara parameters");
  });

  it("emits 20 ms PCMU frames with call-specific fingerprints", () => {
    const callOne = createCallFingerprint("call-one");
    const callTwo = createCallFingerprint("call-two");
    const frames = createTwilioMediaFrames({ callFingerprint: callOne, durationMs: 60 });

    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => frame.timestampMs)).toEqual([0, 20, 40]);
    expect(frames.every((frame) => Buffer.from(frame.payloadBase64, "base64").length === 160)).toBe(true);
    expect(verifyCallFingerprint(frames[0]!.payloadBase64, callOne)).toBe(true);
    expect(verifyCallFingerprint(frames[0]!.payloadBase64, callTwo)).toBe(false);
  });
});
