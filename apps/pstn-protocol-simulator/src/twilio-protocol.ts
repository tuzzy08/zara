import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SaxesParser } from "saxes";

export interface TwilioMediaFrame {
  sequence: number;
  timestampMs: number;
  payloadBase64: string;
}

export function signTwilioWebhook(input: {
  authToken: string;
  parameters: Record<string, string>;
  url: string;
}) {
  const payload = Object.entries(input.parameters)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .reduce((value, [key, parameter]) => `${value}${key}${parameter}`, input.url);

  return createHmac("sha1", input.authToken).update(payload, "utf8").digest("base64");
}

export function parseConnectStreamTwiML(xml: string) {
  let insideConnect = false;
  let insideStream = false;
  let streamUrl: string | undefined;
  let streamToken: string | undefined;
  let parseError: Error | undefined;
  const parser = new SaxesParser({ xmlns: false });

  parser.on("opentag", (node) => {
    if (node.name === "Connect") {
      insideConnect = true;
      return;
    }
    if (node.name === "Stream" && insideConnect) {
      insideStream = true;
      streamUrl = readXmlAttribute(node.attributes.url);
      return;
    }
    if (node.name === "Parameter" && insideStream) {
      const name = readXmlAttribute(node.attributes.name);
      if (name === "zaraStreamToken") {
        streamToken = readXmlAttribute(node.attributes.value);
      }
    }
  });
  parser.on("closetag", (node) => {
    if (node.name === "Stream") insideStream = false;
    if (node.name === "Connect") insideConnect = false;
  });
  parser.on("error", (error) => {
    parseError = error;
  });
  parser.write(xml).close();

  if (parseError !== undefined) {
    throw new Error("Twilio webhook returned invalid XML.", { cause: parseError });
  }
  if (streamUrl === undefined || streamToken === undefined) {
    throw new Error("Twilio webhook did not return Connect Stream TwiML with zaraStreamToken.");
  }

  const parsedUrl = new URL(streamUrl);
  if (parsedUrl.protocol !== "wss:" || parsedUrl.search.length > 0) {
    throw new Error("Twilio Connect Stream URL must be a queryless wss URL.");
  }

  return { streamUrl, streamToken };
}

export function createCallFingerprint(callId: string) {
  return createHash("sha256").update(`zara-pstn-simulator:${callId}`, "utf8").digest("hex").slice(0, 24);
}

export function createTwilioMediaFrames(input: {
  callFingerprint: string;
  durationMs: number;
}): TwilioMediaFrame[] {
  const frameCount = Math.max(0, Math.ceil(input.durationMs / 20));
  const fingerprint = Buffer.from(input.callFingerprint, "utf8");

  return Array.from({ length: frameCount }, (_, index) => {
    const payload = Buffer.alloc(160, 0xff);
    fingerprint.copy(payload, 0, 0, Math.min(fingerprint.length, payload.length));
    payload.writeUInt32BE(index, payload.length - 4);
    return {
      sequence: index + 1,
      timestampMs: index * 20,
      payloadBase64: payload.toString("base64"),
    };
  });
}

export function verifyCallFingerprint(payloadBase64: string, expectedFingerprint: string) {
  const payload = Buffer.from(payloadBase64, "base64");
  const expected = Buffer.from(expectedFingerprint, "utf8");
  if (payload.length < expected.length) return false;
  return timingSafeEqual(payload.subarray(0, expected.length), expected);
}

function readXmlAttribute(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
