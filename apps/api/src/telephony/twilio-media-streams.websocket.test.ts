import { afterEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { computeTwilioWebhookSignature } from "@zara/core";
import WebSocket, { type RawData } from "ws";

import { ComplianceModule } from "../compliance/compliance.module";
import { configureCors } from "../config/cors";
import {
  FileTelephonyStateRepository,
  TELEPHONY_STATE_REPOSITORY,
} from "./telephony-state.repository";
import { TwilioMediaStreamsWebSocketBridge } from "./twilio-media-streams.websocket-bridge";

describe("Twilio Media Streams websocket bridge", () => {
  const sockets: WebSocket[] = [];

  afterEach(() => {
    while (sockets.length > 0) {
      sockets.pop()?.close();
    }
  });

  it("bridges verified Twilio media streams and sends only Twilio media mark and clear messages outbound", async () => {
    const { app, moduleRef, phoneNumber, authToken } = await createRoutedTwilioApp();
    const callSid = "CA-websocket-1";
    const callSessionId = `${callSid}:telephony`;
    const streamSid = "MZ-websocket-1";

    await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-websocket-1",
      phoneNumber,
    });

    const port = getListeningPort(app);
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/telephony/twilio/media-streams/${encodeURIComponent(callSessionId)}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "twilio websocket open");

    socket.send(JSON.stringify({
      event: "connected",
      protocol: "Call",
      version: "1.0.0",
    }));
    socket.send(JSON.stringify({
      event: "start",
      sequenceNumber: "1",
      streamSid,
      start: {
        accountSid: "AC1234567890abcdef1234567890abcd",
        callSid,
        streamSid,
        tracks: ["inbound"],
        mediaFormat: {
          encoding: "audio/x-mulaw",
          sampleRate: 8000,
          channels: 1,
        },
        customParameters: {
          zaraCallSessionId: "forged-value-is-ignored",
        },
      },
    }));
    socket.send(JSON.stringify({
      event: "media",
      sequenceNumber: "2",
      streamSid,
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: "//////////8=",
      },
    }));
    socket.send(JSON.stringify({
      event: "dtmf",
      sequenceNumber: "3",
      streamSid,
      dtmf: {
        track: "inbound_track",
        digit: "7",
      },
    }));

    const bridge = moduleRef.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(waitFor(() => bridge.getSessionEvents(callSessionId).some((event) => event.type === "media")), "media event");
    await withTimeout(waitFor(async () => {
      const stateResponse = await request(app.getHttpServer()).get("/organizations/tenant-west-africa/telephony/state");
      return JSON.stringify(stateResponse.body).includes("dtmf.received");
    }), "dtmf event persisted");

    const events = bridge.getSessionEvents(callSessionId);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "started",
          callSid,
          streamSid,
          codec: {
            name: "g711_mulaw",
            sampleRateHz: 8000,
            channels: 1,
          },
        }),
        expect.objectContaining({
          type: "media",
          provider: expect.objectContaining({
            callSid,
            streamSid,
            sequenceNumber: "2",
            track: "inbound",
          }),
          frame: expect.objectContaining({
            callSessionId,
            mediaStreamId: streamSid,
            direction: "inbound",
            sequence: 2,
            timestampMs: 20,
          }),
        }),
      ]),
    );

    bridge.sendOutboundMedia({
      callSessionId,
      frame: {
        callSessionId,
        mediaStreamId: streamSid,
        direction: "outbound",
        codec: {
          name: "g711_mulaw",
          sampleRateHz: 8000,
          channels: 1,
        },
        sequence: 1,
        timestampMs: 40,
        payloadBase64: "AAAA////",
      },
    });
    expect(await withTimeout(nextMessage(socket), "outbound media")).toEqual({
      event: "media",
      streamSid,
      media: {
        payload: "AAAA////",
      },
    });

    bridge.sendMark({ callSessionId, name: "response-1" });
    expect(await withTimeout(nextMessage(socket), "outbound mark")).toEqual({
      event: "mark",
      streamSid,
      mark: {
        name: "response-1",
      },
    });

    bridge.clearBufferedAudio({ callSessionId });
    expect(await withTimeout(nextMessage(socket), "outbound clear")).toEqual({
      event: "clear",
      streamSid,
    });

    socket.send(JSON.stringify({
      event: "stop",
      sequenceNumber: "4",
      streamSid,
      stop: {
        accountSid: "AC1234567890abcdef1234567890abcd",
        callSid,
      },
    }));
    const close = await withTimeout(nextClose(socket), "twilio stop close");
    expect(close.code).toBe(1000);
    expect(close.reason).toBe("twilio_stop");

    const stateResponse = await request(app.getHttpServer()).get("/organizations/tenant-west-africa/telephony/state");
    expect(JSON.stringify(stateResponse.body)).not.toContain("//////////8=");
    expect(JSON.stringify(stateResponse.body)).not.toContain("forged-value-is-ignored");

    await app.close();
  }, 30_000);

  it("closes malformed media streams safely and prevents concurrent stream attachment", async () => {
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp();
    const callSid = "CA-websocket-2";
    const callSessionId = `${callSid}:telephony`;

    await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-websocket-2",
      phoneNumber,
    });

    const port = getListeningPort(app);
    const firstSocket = new WebSocket(
      `ws://127.0.0.1:${port}/telephony/twilio/media-streams/${encodeURIComponent(callSessionId)}`,
    );
    sockets.push(firstSocket);
    await withTimeout(nextOpen(firstSocket), "first twilio websocket open");

    const duplicateSocket = new WebSocket(
      `ws://127.0.0.1:${port}/telephony/twilio/media-streams/${encodeURIComponent(callSessionId)}`,
    );
    sockets.push(duplicateSocket);
    const duplicateClose = await withTimeout(nextClose(duplicateSocket), "duplicate close");
    expect(duplicateClose).toEqual({
      code: 4409,
      reason: "stream_already_connected",
    });

    firstSocket.send(JSON.stringify({
      event: "media",
      sequenceNumber: "1",
      streamSid: "MZ-missing-start",
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: "//////////8=",
      },
    }));

    const malformedClose = await withTimeout(nextClose(firstSocket), "malformed media close");
    expect(malformedClose.code).toBe(4400);
    expect(malformedClose.reason).toBe("twilio_media.invalid_media");

    await app.close();
  }, 30_000);
});

async function createRoutedTwilioApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [ComplianceModule],
  })
    .overrideProvider(TELEPHONY_STATE_REPOSITORY)
    .useValue(
      new FileTelephonyStateRepository(
        join(tmpdir(), "zara-telephony-websocket-tests", randomUUID()),
      ),
    )
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  configureCors(app);
  await app.listen(0);

  const authToken = "twilio-auth-token-1234567890";
  const connectResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/telephony/connections")
    .send({
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
    });
  const connectionId = connectResponse.body.connection.id as string;

  const importResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
    .send({
      actorUserId: "user-ops-lead",
    });
  const phoneNumberId = importResponse.body.importedNumbers[0].id as string;
  const phoneNumber = importResponse.body.importedNumbers[0].phoneNumber as string;

  await request(app.getHttpServer())
    .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
    .send({
      actorUserId: "user-ops-lead",
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-support",
    });

  return {
    app,
    moduleRef,
    phoneNumber,
    authToken,
  };
}

async function answerViaVerifiedWebhook(input: {
  app: INestApplication;
  accountSid: string;
  authToken: string;
  callSid: string;
  eventSid: string;
  phoneNumber: string;
}) {
  const payload = {
    AccountSid: input.accountSid,
    CallSid: input.callSid,
    EventSid: input.eventSid,
    EventType: "incoming.call",
    To: input.phoneNumber,
    From: "+233201110001",
  };
  const signature = computeTwilioWebhookSignature({
    url: "http://127.0.0.1/telephony/webhooks/twilio",
    parameters: payload,
    authToken: input.authToken,
  });

  const response = await request(input.app.getHttpServer())
    .post("/telephony/webhooks/twilio")
    .set("x-twilio-signature", signature)
    .send(payload);
  expect(response.status).toBe(200);
  expect(response.text).toContain("<Connect>");
}

function getListeningPort(app: INestApplication) {
  const address = app.getHttpServer().address() as { port: number } | string | null;
  if (address === null || typeof address === "string") {
    throw new Error("Expected telephony websocket test server to listen on a TCP port.");
  }

  return address.port;
}

function nextOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("close", (code, reason) => {
      reject(new Error(`Socket closed before open: ${code} ${reason.toString("utf8")}`));
    });
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (message: RawData) => {
      try {
        resolve(JSON.parse(message.toString("utf8")) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("close", (code, reason) => {
      reject(new Error(`Socket closed before message: ${code} ${reason.toString("utf8")}`));
    });
    socket.once("error", reject);
  });
}

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    });
    socket.once("error", reject);
  });
}

function waitFor(predicate: () => boolean | Promise<boolean>) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const poll = async () => {
      try {
        if (await predicate()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }

      if (Date.now() - startedAt > 2_000) {
        reject(new Error("Condition was not met before timeout."));
        return;
      }

      setTimeout(poll, 20);
    };

    void poll();
  });
}

function withTimeout<TValue>(promise: Promise<TValue>, label: string, timeoutMs = 3_000) {
  return Promise.race([
    promise,
    new Promise<TValue>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}
