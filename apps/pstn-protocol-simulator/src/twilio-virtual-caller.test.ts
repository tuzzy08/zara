import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { createCallFingerprint } from "./twilio-protocol";
import { TwilioVirtualCaller } from "./twilio-virtual-caller";

describe("TwilioVirtualCaller", () => {
  it("posts a signed webhook and runs the bidirectional media protocol", async () => {
    const socket = new FakeSocket();
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/x-www-form-urlencoded",
      });
      expect((init?.headers as Record<string, string>)["x-twilio-signature"]).toBeTruthy();
      return new Response(`<?xml version="1.0"?><Response><Connect>
        <Stream url="wss://api.example.test/telephony/twilio/media-streams/call-session-1">
          <Parameter name="zaraStreamToken" value="opaque-token" />
          <Parameter name="zaraRuntimePath" value="pstn-premium-realtime" />
          <Parameter name="zaraWorkerId" value="worker-inline-1" />
          <Parameter name="zaraWorkerReleaseId" value="release-inline-1" />
        </Stream></Connect></Response>`, { status: 200 });
    });
    const beforeConnect = vi.fn();
    socket.onSend = (message) => {
      const sent = JSON.parse(message) as { event?: string; streamSid?: string };
      if (sent.event !== "media" || socket.sent.filter((candidate) => JSON.parse(candidate).event === "media").length !== 2) {
        return;
      }
      const start = JSON.parse(socket.sent[1]!) as { streamSid?: string };
      socket.receive(JSON.stringify({
        event: "media",
        streamSid: start.streamSid,
        media: {
          payload: Buffer.from(createCallFingerprint("call-session-1"), "utf8").toString("base64"),
        },
      }));
      socket.receive(JSON.stringify({ event: "mark", streamSid: start.streamSid, mark: { name: "played-1" } }));
    };
    const caller = new TwilioVirtualCaller({
      fetch,
      websocketFactory: () => socket,
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
      nowMs: (() => {
        let now = 0;
        return () => now += 10;
      })(),
    });

    const resultPromise = caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CA11111111111111111111111111111111",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 40,
      beforeConnect,
    });
    socket.open();
    const result = await resultPromise;

    expect(beforeConnect).toHaveBeenCalledWith({
      callSessionId: "call-session-1",
      callFingerprint: createCallFingerprint("call-session-1"),
    });
    expect(socket.sent.map((message) => JSON.parse(message).event)).toEqual([
      "connected",
      "start",
      "media",
      "media",
      "mark",
      "stop",
    ]);
    expect(JSON.parse(socket.sent[1]!).start.customParameters).toMatchObject({
      zaraWorkerId: "worker-inline-1",
      zaraWorkerReleaseId: "release-inline-1",
    });
    expect(result.outboundFingerprintMatched).toBe(true);
    expect(result.markAcknowledgements).toBe(1);
    expect(result).toMatchObject({
      webhookLatencyMs: 10,
      mediaConnectLatencyMs: 10,
      firstOutboundAudioLatencyMs: expect.any(Number),
      totalDurationMs: expect.any(Number),
    });
    const mark = socket.sent.map((message) => JSON.parse(message) as Record<string, unknown>)
      .find((message) => message.event === "mark");
    expect(mark?.sequenceNumber).toMatch(/^\d+$/u);
  });

  it.each([
    { loseMarks: false, expectedAcknowledgements: 1 },
    { loseMarks: true, expectedAcknowledgements: 0 },
  ])("flushes queued playback on clear with lostMarks=$loseMarks", async ({
    loseMarks,
    expectedAcknowledgements,
  }) => {
    const socket = new FakeSocket();
    socket.onSend = (message) => {
      const sent = JSON.parse(message) as { event?: string; streamSid?: string };
      if (sent.event !== "media") return;
      socket.receive(JSON.stringify({
        event: "media",
        streamSid: sent.streamSid,
        media: { payload: Buffer.from(createCallFingerprint("call-session-clear"), "utf8").toString("base64") },
      }));
      socket.receive(JSON.stringify({ event: "mark", streamSid: sent.streamSid, mark: { name: "queued-mark" } }));
      socket.receive(JSON.stringify({ event: "clear", streamSid: sent.streamSid }));
    };
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse("call-session-clear", "clear-token"),
      websocketFactory: () => socket,
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
    });

    const resultPromise = caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CA22222222222222222222222222222222",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
      loseMarks,
    });
    socket.open();
    const result = await resultPromise;

    expect(result.clearCount).toBe(1);
    expect(result.outboundFrameCount).toBe(0);
    expect(result.markAcknowledgements).toBe(expectedAcknowledgements);
  });

  it("rejects reuse of an opaque stream token without retaining the raw token", async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    for (const socket of sockets) {
      socket.onSend = (message) => {
        const sent = JSON.parse(message) as { event?: string; streamSid?: string };
        if (sent.event === "media") {
          socket.receive(JSON.stringify({ event: "clear", streamSid: sent.streamSid }));
        }
      };
    }
    let socketIndex = 0;
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse("call-session-replay", "replayed-token"),
      websocketFactory: () => sockets[socketIndex++]!,
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
    });
    const first = caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CA33333333333333333333333333333333",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
    });
    sockets[0]!.open();
    await first;

    await expect(caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CA44444444444444444444444444444444",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
    })).rejects.toThrow("reused a media stream token");
  });

  it("rejects a duplicate media socket before the owning stream sends media", async () => {
    const primarySocket = new FakeSocket();
    const duplicateSocket = new FakeSocket();
    const lifecycle: string[] = [];
    primarySocket.onSend = (message) => {
      const sent = JSON.parse(message) as { event?: string; streamSid?: string };
      if (sent.event === "start") {
        queueMicrotask(() => {
          lifecycle.push("owner-barrier");
          primarySocket.receive(JSON.stringify({
            event: "media",
            streamSid: sent.streamSid,
            media: {
              payload: Buffer.from(
                createCallFingerprint("call-session-duplicate"),
                "utf8",
              ).toString("base64"),
            },
          }));
        });
      }
      if (sent.event === "media") {
        lifecycle.push("owner-media");
        primarySocket.receive(JSON.stringify({ event: "clear", streamSid: sent.streamSid }));
      }
    };
    duplicateSocket.onSend = (message) => {
      const sent = JSON.parse(message) as { event?: string };
      if (sent.event === "start") {
        lifecycle.push("duplicate-rejected");
        duplicateSocket.emit("close", 4409, Buffer.from("stream_already_connected"));
      }
    };
    const sockets = [primarySocket, duplicateSocket];
    let socketIndex = 0;
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse("call-session-duplicate", "duplicate-token"),
      websocketFactory: () => {
        const socket = sockets[socketIndex++]!;
        if (socket === duplicateSocket) lifecycle.push("duplicate-opened");
        queueMicrotask(() => socket.open());
        return socket;
      },
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
    });

    const result = await caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CA34343434343434343434343434343434",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
      duplicateMediaStream: true,
    });

    expect(result.duplicateMediaStream).toEqual({ closeCode: 4409 });
    expect(lifecycle).toEqual([
      "owner-barrier",
      "duplicate-opened",
      "duplicate-rejected",
      "owner-media",
    ]);
    expect(primarySocket.sent.map((message) => JSON.parse(message).event)).toContain("media");
    expect(duplicateSocket.sent.map((message) => JSON.parse(message).event)).toEqual([
      "connected",
      "start",
    ]);
    expect([
      JSON.parse(primarySocket.sent[1]!).start.customParameters.zaraWorkerId,
      JSON.parse(duplicateSocket.sent[1]!).start.customParameters.zaraWorkerId,
    ]).toEqual(["worker-simulator-1", "worker-simulator-1"]);
    expect([
      JSON.parse(primarySocket.sent[1]!).start.customParameters.zaraWorkerReleaseId,
      JSON.parse(duplicateSocket.sent[1]!).start.customParameters.zaraWorkerReleaseId,
    ]).toEqual(["release-simulator-1", "release-simulator-1"]);
    expect(JSON.stringify(result)).not.toContain("duplicate-token");
    expect(JSON.stringify(result)).not.toContain("stream_already_connected");
  });

  it.each([0, 1] as const)(
    "races the same stream token when candidate %i loses",
    async (loserIndex) => {
      const firstSocket = new FakeSocket();
      const secondSocket = new FakeSocket();
      const sockets = [firstSocket, secondSocket] as const;
      const loserSocket = sockets[loserIndex];
      const winnerSocket = sockets[loserIndex === 0 ? 1 : 0];
      const lifecycle: string[] = [];
      const starts: Array<{
        start?: {
          customParameters?: {
            zaraStreamToken?: string;
            zaraWorkerId?: string;
            zaraWorkerReleaseId?: string;
          };
        };
      }> = [];
      const handleSend = (socket: FakeSocket, label: "first" | "second") => (message: string) => {
        const sent = JSON.parse(message) as {
          event?: string;
          streamSid?: string;
          start?: {
            customParameters?: {
              zaraStreamToken?: string;
              zaraWorkerId?: string;
              zaraWorkerReleaseId?: string;
            };
          };
        };
        if (sent.event === "start") {
          lifecycle.push(`${label}-start`);
          starts.push(sent);
          if (starts.length === 2) {
            queueMicrotask(() => {
              lifecycle.push("loser-rejected");
              loserSocket.emit("close", 4409, Buffer.from("stream_already_connected"));
            });
          }
        }
        if (socket === winnerSocket && sent.event === "media") {
          lifecycle.push("winner-media");
          winnerSocket.receive(JSON.stringify({
            event: "media",
            streamSid: sent.streamSid,
            media: {
              payload: Buffer.from(
                createCallFingerprint("call-session-simultaneous"),
                "utf8",
              ).toString("base64"),
            },
          }));
        }
      };
      firstSocket.onSend = handleSend(firstSocket, "first");
      secondSocket.onSend = handleSend(secondSocket, "second");
      let socketIndex = 0;
      const caller = new TwilioVirtualCaller({
        fetch: createWebhookResponse("call-session-simultaneous", "simultaneous-token"),
        websocketFactory: () => {
          const socket = sockets[socketIndex++]!;
          queueMicrotask(() => socket.open());
          return socket;
        },
        sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
      });

      const result = await caller.run({
        accountSid: "AC11111111111111111111111111111111",
        authToken: "auth-token",
        callSid: "CA56565656565656565656565656565656",
        from: "+15550001111",
        to: "+15550002222",
        webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
        durationMs: 20,
        simultaneousDuplicateMediaStream: true,
      });

      const tokenHashes = starts.map((start) => createHash("sha256")
        .update(start.start?.customParameters?.zaraStreamToken ?? "")
        .digest("hex"));
      expect(starts).toHaveLength(2);
      expect(new Set(tokenHashes).size).toBe(1);
      expect(starts.map((start) => start.start?.customParameters?.zaraWorkerId)).toEqual([
        "worker-simulator-1",
        "worker-simulator-1",
      ]);
      expect(starts.map(
        (start) => start.start?.customParameters?.zaraWorkerReleaseId,
      )).toEqual([
        "release-simulator-1",
        "release-simulator-1",
      ]);
      expect(result.duplicateMediaStream).toEqual({ closeCode: 4409 });
      expect(lifecycle).toEqual([
        "first-start",
        "second-start",
        "loser-rejected",
        "winner-media",
      ]);
      expect(loserSocket.received).toHaveLength(0);
      expect(winnerSocket.sent.map((message) => JSON.parse(message).event)).toContain("media");
  });

  it.each(["abrupt", "remote"] as const)("records %s socket termination", async (mode) => {
    const socket = new FakeSocket();
    socket.onSend = (message) => {
      const sent = JSON.parse(message) as { event?: string; streamSid?: string };
      if (sent.event !== "media") return;
      if (mode === "remote") socket.emit("close", 4400, Buffer.from("provider_failed"));
      else socket.receive(JSON.stringify({ event: "clear", streamSid: sent.streamSid }));
    };
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse(`call-session-${mode}`, `${mode}-token`),
      websocketFactory: () => socket,
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
    });
    const resultPromise = caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: mode === "abrupt"
        ? "CA55555555555555555555555555555555"
        : "CA66666666666666666666666666666666",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
      abruptDisconnect: mode === "abrupt",
    });
    socket.open();

    const result = await resultPromise;

    expect(result.closeMode).toBe(mode);
    expect(result.remoteCloseCode).toBe(mode === "abrupt" ? 1006 : 4400);
  });

  it("closes the caller socket when the call contract fails", async () => {
    const socket = new FakeSocket();
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse("call-session-failed", "failed-token"),
      websocketFactory: () => socket,
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
    });
    const resultPromise = caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CA77777777777777777777777777777777",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
      completionProbe: () => false,
    });
    socket.open();

    await expect(resultPromise).rejects.toThrow("Timed out waiting for the simulated call completion contract");
    expect(socket.closeRequests + socket.terminateRequests).toBeGreaterThan(0);
  });

  it("cancels queued playback when Zara closes the media stream", async () => {
    const socket = new FakeSocket();
    socket.onSend = (message) => {
      const sent = JSON.parse(message) as { event?: string; streamSid?: string };
      if (sent.event !== "media") return;
      socket.receive(JSON.stringify({
        event: "media",
        streamSid: sent.streamSid,
        media: { payload: Buffer.from(createCallFingerprint("call-session-remote-close"), "utf8").toString("base64") },
      }));
      socket.receive(JSON.stringify({ event: "mark", streamSid: sent.streamSid, mark: { name: "never-played" } }));
      socket.emit("close", 4400, Buffer.from("provider_failed"));
    };
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse("call-session-remote-close", "remote-close-token"),
      websocketFactory: () => socket,
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
    });
    const resultPromise = caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CA88888888888888888888888888888888",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
    });
    socket.open();

    const result = await resultPromise;
    expect(result.closeMode).toBe("remote");
    expect(result.outboundFrameCount).toBe(0);
    expect(result.markAcknowledgements).toBe(0);
  });

  it("times out and releases a media socket that never opens", async () => {
    const socket = new FakeSocket();
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse("call-session-connect-timeout", "connect-timeout-token"),
      websocketFactory: () => socket,
    });

    await expect(caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CA99999999999999999999999999999999",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
      connectTimeoutMs: 5,
    })).rejects.toThrow("Timed out opening the simulated Twilio media stream");
    expect(socket.terminateRequests).toBe(1);
  });

  it("terminates an active media socket when the load safety signal aborts", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse("call-session-abort", "abort-token"),
      websocketFactory: () => socket,
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
    });
    const result = caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CA12121212121212121212121212121212",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 10_000,
      silence: true,
      signal: controller.signal,
    });
    socket.open();
    while (socket.sent.length < 2) await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(result).rejects.toThrow("aborted by the load safety stop");
    expect(socket.terminateRequests + socket.closeRequests).toBeGreaterThan(0);
  });

  it("rejects Zara playback commands for another Twilio stream", async () => {
    const socket = new FakeSocket();
    socket.onSend = (message) => {
      const sent = JSON.parse(message) as { event?: string };
      if (sent.event !== "media") return;
      socket.receive(JSON.stringify({
        event: "media",
        streamSid: "MZ-wrong-stream",
        media: { payload: Buffer.alloc(160, 0xff).toString("base64") },
      }));
    };
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse("call-session-wrong-stream", "wrong-stream-token"),
      websocketFactory: () => socket,
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
    });
    const resultPromise = caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
    });
    socket.open();

    await expect(resultPromise).rejects.toThrow("another Twilio stream");
  });

  it("emits multiple caller turns with continuous Twilio media sequencing", async () => {
    const socket = new FakeSocket();
    socket.onSend = (message) => {
      const sent = JSON.parse(message) as { event?: string; streamSid?: string };
      if (sent.event === "media") socket.receive(JSON.stringify({ event: "clear", streamSid: sent.streamSid }));
    };
    const caller = new TwilioVirtualCaller({
      fetch: createWebhookResponse("call-session-two-turns", "two-turn-token"),
      websocketFactory: () => socket,
      sleep: async () => new Promise<void>((resolve) => setImmediate(resolve)),
    });
    const resultPromise = caller.run({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "auth-token",
      callSid: "CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      from: "+15550001111",
      to: "+15550002222",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      durationMs: 20,
      callerTurns: [
        { durationMs: 40, silenceAfterMs: 250 },
        { durationMs: 40 },
      ],
    });
    socket.open();
    const result = await resultPromise;

    const media = socket.sent
      .map((message) => JSON.parse(message) as { event?: string; sequenceNumber?: string; media?: { timestamp?: string } })
      .filter((message) => message.event === "media");
    expect(result.inboundFrameCount).toBe(4);
    expect(result.outboundFrameCountAfterTurns).toEqual([0, 0]);
    expect(media.map((message) => message.sequenceNumber)).toEqual(["2", "3", "4", "5"]);
    expect(media.map((message) => message.media?.timestamp)).toEqual(["0", "20", "290", "310"]);
  });
});

function createWebhookResponse(callSessionId: string, token: string) {
  return vi.fn(async () => new Response(`<?xml version="1.0"?><Response><Connect>
    <Stream url="wss://api.example.test/telephony/twilio/media-streams/${callSessionId}">
      <Parameter name="zaraStreamToken" value="${token}" />
      <Parameter name="zaraRuntimePath" value="pstn-premium-realtime" />
      <Parameter name="zaraWorkerId" value="worker-simulator-1" />
      <Parameter name="zaraWorkerReleaseId" value="release-simulator-1" />
    </Stream></Connect></Response>`, { status: 200 }));
}

class FakeSocket extends EventEmitter {
  readonly sent: string[] = [];
  readonly received: string[] = [];
  readyState = 0;
  closeRequests = 0;
  terminateRequests = 0;
  onSend?: (message: string) => void;

  send(message: string) {
    this.sent.push(message);
    this.onSend?.(message);
  }

  close() {
    this.closeRequests += 1;
    this.emit("close", 1000, Buffer.alloc(0));
  }

  terminate() {
    this.terminateRequests += 1;
    this.emit("close", 1006, Buffer.alloc(0));
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  receive(message: string) {
    this.received.push(message);
    this.emit("message", Buffer.from(message));
  }
}
