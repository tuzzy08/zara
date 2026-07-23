import { createHash } from "node:crypto";
import WebSocket, { type RawData } from "ws";

import {
  createCallFingerprint,
  createTwilioMediaFrames,
  parseConnectStreamTwiML,
  signTwilioWebhook,
  verifyCallFingerprint,
} from "./twilio-protocol";
import { createTwilioStreamSid } from "./smoke-identities";

interface CallerWebSocket {
  readyState?: number | undefined;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  terminate?: (() => void) | undefined;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (message: RawData | Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number, reason: Buffer) => void): unknown;
}

interface ZaraStreamMessage {
  event?: string | undefined;
  streamSid?: string | undefined;
  media?: { payload?: string | undefined } | undefined;
  mark?: { name?: string | undefined } | undefined;
}

export interface TwilioVirtualCallerInput {
  accountSid: string;
  authToken: string;
  callSid: string;
  from: string;
  to: string;
  webhookUrl: string;
  durationMs: number;
  callerTurns?: Array<{ durationMs: number; silenceAfterMs?: number | undefined }> | undefined;
  connectTimeoutMs?: number | undefined;
  markAckLatencyMs?: number | undefined;
  loseMarks?: boolean | undefined;
  silence?: boolean | undefined;
  interruptionAtMs?: number | undefined;
  abruptDisconnect?: boolean | undefined;
  cadenceFactor?: number | undefined;
  completionProbe?: (() => boolean) | undefined;
  requireRemoteClose?: boolean | undefined;
  quiescenceMs?: number | undefined;
  signal?: AbortSignal | undefined;
  beforeConnect?: ((input: {
    callSessionId: string;
    callFingerprint: string;
  }) => void | Promise<void>) | undefined;
}

export interface TwilioVirtualCallerResult {
  callSid: string;
  callSessionId: string;
  inboundFrameCount: number;
  outboundFrameCount: number;
  outboundFrameCountAfterTurns: number[];
  outboundFingerprintMatched: boolean;
  markAcknowledgements: number;
  clearCount: number;
  closeMode: "stop" | "abrupt" | "remote";
  remoteCloseCode?: number | undefined;
  remoteCloseReason?: string | undefined;
  webhookLatencyMs: number;
  mediaConnectLatencyMs: number;
  firstOutboundAudioLatencyMs?: number | undefined;
  totalDurationMs: number;
}

export class TwilioVirtualCaller {
  private readonly seenStreamTokenHashes = new Set<string>();
  private readonly streamTokenHashOrder: string[] = [];

  constructor(private readonly dependencies: {
    fetch?: typeof fetch;
    websocketFactory?: (url: string) => CallerWebSocket;
    sleep?: (delayMs: number) => Promise<void>;
    nowMs?: (() => number) | undefined;
  } = {}) {}

  async run(input: TwilioVirtualCallerInput): Promise<TwilioVirtualCallerResult> {
    const startedAt = this.nowMs();
    throwIfAborted(input.signal);
    const parameters = {
      AccountSid: input.accountSid,
      ApiVersion: "2010-04-01",
      CallSid: input.callSid,
      CallStatus: "ringing",
      Direction: "inbound",
      From: input.from,
      To: input.to,
    };
    const response = await (this.dependencies.fetch ?? fetch)(input.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signTwilioWebhook({
          authToken: input.authToken,
          parameters,
          url: input.webhookUrl,
        }),
      },
      body: new URLSearchParams(parameters),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (!response.ok) {
      throw new Error(`Zara Twilio webhook rejected simulated call with HTTP ${response.status}.`);
    }

    const twiml = parseConnectStreamTwiML(await response.text());
    const webhookCompletedAt = this.nowMs();
    throwIfAborted(input.signal);
    const streamTokenHash = createHash("sha256").update(twiml.streamToken).digest("hex");
    if (this.seenStreamTokenHashes.has(streamTokenHash)) {
      throw new Error("Twilio webhook reused a media stream token across simulated calls.");
    }
    this.rememberStreamTokenHash(streamTokenHash);
    const callSessionId = decodeURIComponent(new URL(twiml.streamUrl).pathname.split("/").at(-1) ?? "");
    if (callSessionId.length === 0) {
      throw new Error("Twilio Connect Stream URL did not contain a call session identifier.");
    }
    const providerFingerprint = createCallFingerprint(callSessionId);
    await input.beforeConnect?.({ callSessionId, callFingerprint: providerFingerprint });

    const socket = (this.dependencies.websocketFactory ?? ((url) => new WebSocket(url)))(twiml.streamUrl);
    try {
      await waitForOpen(socket, input.connectTimeoutMs ?? 5_000);
    } catch (error) {
      if (socket.terminate !== undefined) socket.terminate();
      else socket.close(1011, "simulated_connect_failure");
      throw error;
    }
    const mediaConnectedAt = this.nowMs();
    throwIfAborted(input.signal);
    const streamSid = createTwilioStreamSid(input.callSid);
    const result: TwilioVirtualCallerResult = {
      callSid: input.callSid,
      callSessionId,
      inboundFrameCount: 0,
      outboundFrameCount: 0,
      outboundFrameCountAfterTurns: [],
      outboundFingerprintMatched: true,
      markAcknowledgements: 0,
      clearCount: 0,
      closeMode: input.abruptDisconnect === true ? "abrupt" : "stop",
      webhookLatencyMs: Math.max(0, webhookCompletedAt - startedAt),
      mediaConnectLatencyMs: Math.max(0, mediaConnectedAt - webhookCompletedAt),
      totalDurationMs: 0,
    };
    let nextSequenceNumber = 2;
    let providerMessageVersion = 0;
    let localCloseRequested = false;
    let remoteClosed = false;
    let lifecycleError: Error | undefined;
    let resolveSocketClosed: (() => void) | undefined;
    const socketClosed = new Promise<void>((resolve) => {
      resolveSocketClosed = resolve;
    });
    const allocateSequenceNumber = () => String(nextSequenceNumber++);
    const playback = new TwilioPlaybackQueue({
      result,
      providerFingerprint,
      streamSid,
      sleep: (delayMs) => this.sleep(delayMs),
      acknowledgeMark: (name) => sendJson(socket, {
        event: "mark",
        sequenceNumber: allocateSequenceNumber(),
        streamSid,
        mark: { name },
      }),
      markAckLatencyMs: input.markAckLatencyMs ?? 0,
      loseMarks: input.loseMarks === true,
      onFirstOutboundAudio: () => {
        result.firstOutboundAudioLatencyMs ??= Math.max(0, this.nowMs() - startedAt);
      },
    });
    socket.on("message", (raw) => {
      try {
        providerMessageVersion += 1;
        playback.receive(raw.toString());
      } catch (error) {
        lifecycleError = error instanceof Error ? error : new Error("Invalid Zara media stream message.");
      }
    });
    socket.on("error", (error) => {
      lifecycleError ??= error;
    });
    socket.on("close", (code, reason) => {
      remoteClosed = true;
      playback.cancel();
      if (!localCloseRequested) result.closeMode = "remote";
      result.remoteCloseCode = code;
      const safeReason = reason.toString("utf8");
      if (safeReason.length > 0) result.remoteCloseReason = safeReason;
      resolveSocketClosed?.();
    });

    try {
      sendJson(socket, { event: "connected", protocol: "Call", version: "1.0.0" });
      sendJson(socket, {
      event: "start",
      sequenceNumber: "1",
      streamSid,
      start: {
        accountSid: input.accountSid,
        callSid: input.callSid,
        streamSid,
        tracks: ["inbound"],
        customParameters: { zaraStreamToken: twiml.streamToken },
        mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8_000, channels: 1 },
      },
      });

      if (input.silence === true) {
        await this.sleep(input.durationMs, input.signal);
      } else {
        await this.sleep(Math.max(0, input.interruptionAtMs ?? 0), input.signal);
        const turns = input.callerTurns ?? [{ durationMs: input.durationMs }];
        let mediaTimestampMs = 0;
        for (const turn of turns) {
          const frames = createTwilioMediaFrames({
            callFingerprint: createCallFingerprint(input.callSid),
            durationMs: turn.durationMs,
          });
          for (const frame of frames) {
            if (remoteClosed) break;
            if (lifecycleError !== undefined) throw lifecycleError;
            sendJson(socket, {
              event: "media",
              sequenceNumber: allocateSequenceNumber(),
              streamSid,
              media: {
                track: "inbound",
                chunk: String(result.inboundFrameCount + 1),
                timestamp: String(mediaTimestampMs + frame.timestampMs),
                payload: frame.payloadBase64,
              },
            });
            result.inboundFrameCount += 1;
            await this.sleep(
              Math.max(1, Math.round(20 / Math.max(0.01, input.cadenceFactor ?? 1))),
              input.signal,
            );
          }
          if (remoteClosed) break;
          mediaTimestampMs += frames.length * 20;
          const silenceAfterMs = Math.max(0, turn.silenceAfterMs ?? 0);
          if (silenceAfterMs > 0) {
            mediaTimestampMs += silenceAfterMs;
            await this.sleep(silenceAfterMs, input.signal);
          }
          result.outboundFrameCountAfterTurns.push(result.outboundFrameCount);
        }
      }

      await this.waitForProviderQuiescence({
        readVersion: () => providerMessageVersion,
        isClosed: () => remoteClosed,
        readError: () => lifecycleError,
        ...(input.completionProbe === undefined ? {} : { completionProbe: input.completionProbe }),
        requireRemoteClose: input.requireRemoteClose === true,
        quiescenceMs: input.quiescenceMs ?? 200,
        signal: input.signal,
      });
      await playback.waitUntilIdle();
      if (lifecycleError !== undefined) throw lifecycleError;

      if (input.abruptDisconnect === true) {
        localCloseRequested = true;
        if (socket.terminate !== undefined) socket.terminate();
        else socket.close(1011, "simulated_abrupt_disconnect");
      } else if (!remoteClosed) {
        sendJson(socket, {
        event: "stop",
        sequenceNumber: allocateSequenceNumber(),
        streamSid,
        stop: { accountSid: input.accountSid, callSid: input.callSid },
        });
        localCloseRequested = true;
        socket.close(1000, "simulated_call_completed");
      }
      await waitForSocketClose(socket, socketClosed);
      result.totalDurationMs = Math.max(0, this.nowMs() - startedAt);
      return result;
    } finally {
      if (!remoteClosed) {
        localCloseRequested = true;
        if (socket.terminate !== undefined) socket.terminate();
        else socket.close(1011, "simulated_call_cleanup");
        await waitForSocketClose(socket, socketClosed);
      }
    }
  }

  private async waitForProviderQuiescence(input: {
    readVersion: () => number;
    isClosed: () => boolean;
    readError: () => Error | undefined;
    completionProbe?: (() => boolean) | undefined;
    requireRemoteClose: boolean;
    quiescenceMs: number;
    signal?: AbortSignal | undefined;
  }) {
    let observedVersion = input.readVersion();
    let quietTicks = 0;
    for (let tick = 0; tick < 250; tick += 1) {
      await this.sleep(20, input.signal);
      const error = input.readError();
      if (error !== undefined) throw error;
      if (input.isClosed()) return;
      const currentVersion = input.readVersion();
      if (currentVersion === observedVersion) quietTicks += 1;
      else {
        observedVersion = currentVersion;
        quietTicks = 0;
      }
      if (input.completionProbe?.() === true && !input.requireRemoteClose) return;
      if (
        input.completionProbe === undefined
        && observedVersion > 0
        && quietTicks >= Math.max(1, Math.ceil(input.quiescenceMs / 20))
      ) return;
    }
    throw new Error("Timed out waiting for the simulated call completion contract.");
  }

  private rememberStreamTokenHash(hash: string) {
    this.seenStreamTokenHashes.add(hash);
    this.streamTokenHashOrder.push(hash);
    if (this.streamTokenHashOrder.length > 10_000) {
      const expired = this.streamTokenHashOrder.shift();
      if (expired !== undefined) this.seenStreamTokenHashes.delete(expired);
    }
  }

  private async sleep(delayMs: number, signal?: AbortSignal) {
    throwIfAborted(signal);
    if (signal === undefined) {
      await (this.dependencies.sleep ?? defaultSleep)(delayMs);
      return;
    }
    await Promise.race([
      (this.dependencies.sleep ?? defaultSleep)(delayMs),
      waitUntilAborted(signal),
    ]);
    throwIfAborted(signal);
  }

  private nowMs() {
    return (this.dependencies.nowMs ?? Date.now)();
  }
}

type PlaybackItem =
  | { type: "media"; payloadBase64: string; generation: number }
  | { type: "mark"; name: string; generation: number };

class TwilioPlaybackQueue {
  private readonly queue: PlaybackItem[] = [];
  private generation = 0;
  private drainPromise: Promise<void> | undefined;
  private activeMark: { name: string; generation: number } | undefined;
  private readonly cancellation = new AbortController();
  private cancelled = false;

  constructor(private readonly dependencies: {
    result: TwilioVirtualCallerResult;
    providerFingerprint: string;
    streamSid: string;
    sleep(delayMs: number): Promise<void>;
    acknowledgeMark(name: string): void;
    markAckLatencyMs: number;
    loseMarks: boolean;
    onFirstOutboundAudio(): void;
  }) {}

  receive(raw: string) {
    if (this.cancelled) return;
    const message = JSON.parse(raw) as ZaraStreamMessage;
    if (
      (message.event === "media" || message.event === "mark" || message.event === "clear")
      && message.streamSid !== this.dependencies.streamSid
    ) {
      throw new Error("Zara sent a playback command for another Twilio stream.");
    }
    if (message.event === "media" && typeof message.media?.payload === "string") {
      this.dependencies.onFirstOutboundAudio();
      this.queue.push({ type: "media", payloadBase64: message.media.payload, generation: this.generation });
      this.startDrain();
      return;
    }
    if (message.event === "mark" && typeof message.mark?.name === "string") {
      this.queue.push({ type: "mark", name: message.mark.name, generation: this.generation });
      this.startDrain();
      return;
    }
    if (message.event === "clear") this.clear();
  }

  async waitUntilIdle() {
    while (this.drainPromise !== undefined) await this.drainPromise;
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.generation += 1;
    this.queue.splice(0);
    this.activeMark = undefined;
    this.cancellation.abort();
  }

  private clear() {
    this.dependencies.result.clearCount += 1;
    const pendingMarks = this.queue.flatMap((item) => item.type === "mark" ? [item.name] : []);
    if (this.activeMark !== undefined) pendingMarks.unshift(this.activeMark.name);
    this.generation += 1;
    this.queue.splice(0);
    if (!this.dependencies.loseMarks) {
      for (const mark of [...new Set(pendingMarks)]) this.acknowledge(mark);
    }
  }

  private startDrain() {
    if (this.drainPromise !== undefined) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = undefined;
      if (this.queue.length > 0) this.startDrain();
    });
  }

  private async drain() {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      if (item.type === "media") {
        const byteCount = Buffer.from(item.payloadBase64, "base64").byteLength;
        if (byteCount === 0) throw new Error("Zara sent an empty Twilio PCMU payload.");
        await this.sleep(Math.max(1, Math.round(byteCount / 8)));
        if (this.cancelled) return;
        if (item.generation !== this.generation) continue;
        this.dependencies.result.outboundFrameCount += 1;
        this.dependencies.result.outboundFingerprintMatched = this.dependencies.result.outboundFingerprintMatched
          && verifyCallFingerprint(item.payloadBase64, this.dependencies.providerFingerprint);
        continue;
      }
      this.activeMark = item;
      await this.sleep(this.dependencies.markAckLatencyMs);
      if (this.cancelled) return;
      if (item.generation === this.generation && !this.dependencies.loseMarks) this.acknowledge(item.name);
      if (this.activeMark === item) this.activeMark = undefined;
    }
  }

  private acknowledge(name: string) {
    if (this.cancelled) return;
    this.dependencies.acknowledgeMark(name);
    this.dependencies.result.markAcknowledgements += 1;
  }

  private async sleep(delayMs: number) {
    await Promise.race([
      this.dependencies.sleep(delayMs),
      waitUntilAborted(this.cancellation.signal),
    ]);
  }
}

function waitForOpen(socket: CallerWebSocket, timeoutMs: number) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Timed out opening the simulated Twilio media stream."));
    }, Math.max(1, timeoutMs));
    socket.on("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    });
    socket.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("close", (code, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Simulated Twilio media stream closed before opening (${code}: ${reason.toString("utf8")}).`));
    });
  });
}

function sendJson(socket: CallerWebSocket, message: Record<string, unknown>) {
  socket.send(JSON.stringify(message));
}

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function waitForSocketClose(socket: CallerWebSocket, closed: Promise<void>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), 1_000);
  });
  const outcome = await Promise.race([closed.then(() => "closed" as const), timedOut]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (outcome === "timeout") {
    if (socket.terminate !== undefined) socket.terminate();
    else socket.close(1011, "simulated_close_timeout");
    await closed;
  }
}

function waitUntilAborted(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted === true) throw new Error("Simulated PSTN call aborted by the load safety stop.");
}
