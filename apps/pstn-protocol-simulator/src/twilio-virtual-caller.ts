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
  duplicateMediaStream?: boolean | undefined;
  simultaneousDuplicateMediaStream?: boolean | undefined;
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
  duplicateMediaStream?: { closeCode: number } | undefined;
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

    if (
      input.duplicateMediaStream === true
      && input.simultaneousDuplicateMediaStream === true
    ) {
      throw new Error("Duplicate media stream modes cannot be combined.");
    }
    const streamSid = createTwilioStreamSid(input.callSid);
    const websocketFactory = this.dependencies.websocketFactory ?? ((url: string) => new WebSocket(url));
    let socket: CallerWebSocket;
    let bootstrapSent = false;
    let bufferedOwnerMessages: Array<RawData | Buffer> = [];
    let simultaneousDuplicateResult: { closeCode: number } | undefined;
    if (input.simultaneousDuplicateMediaStream === true) {
      const race = await establishSimultaneousMediaRace({
        accountSid: input.accountSid,
        callSid: input.callSid,
        connectTimeoutMs: input.connectTimeoutMs ?? 5_000,
        createSocket: websocketFactory,
        runtimePath: twiml.runtimePath,
        streamSid,
        streamToken: twiml.streamToken,
        streamUrl: twiml.streamUrl,
        workerId: twiml.workerId,
        workerReleaseId: twiml.workerReleaseId,
      });
      socket = race.owner.socket;
      race.owner.buffering = false;
      bufferedOwnerMessages = race.owner.messages.splice(0);
      simultaneousDuplicateResult = { closeCode: race.loserCloseCode };
      bootstrapSent = true;
    } else {
      socket = websocketFactory(twiml.streamUrl);
      try {
        await waitForOpen(socket, input.connectTimeoutMs ?? 5_000);
      } catch (error) {
        if (socket.terminate !== undefined) socket.terminate();
        else socket.close(1011, "simulated_connect_failure");
        throw error;
      }
    }
    const mediaConnectedAt = this.nowMs();
    throwIfAborted(input.signal);
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
      ...(simultaneousDuplicateResult === undefined
        ? {}
        : { duplicateMediaStream: simultaneousDuplicateResult }),
    };
    let nextSequenceNumber = 2;
    let providerMessageVersion = 0;
    let localCloseRequested = false;
    let remoteClosed = false;
    let lifecycleError: Error | undefined;
    let resolveOwnerPlayback: (() => void) | undefined;
    const ownerPlayback = new Promise<void>((resolve) => {
      resolveOwnerPlayback = resolve;
    });
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
    const receiveProviderMessage = (raw: RawData | Buffer) => {
      try {
        providerMessageVersion += 1;
        if (playback.receive(raw.toString())) resolveOwnerPlayback?.();
      } catch (error) {
        lifecycleError = error instanceof Error ? error : new Error("Invalid Zara media stream message.");
      }
    };
    socket.on("message", receiveProviderMessage);
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
    for (const raw of bufferedOwnerMessages) receiveProviderMessage(raw);
    bufferedOwnerMessages = [];

    try {
      if (!bootstrapSent) {
        sendMediaStreamBootstrap(socket, {
          accountSid: input.accountSid,
          callSid: input.callSid,
          runtimePath: twiml.runtimePath,
          streamSid,
          streamToken: twiml.streamToken,
          workerId: twiml.workerId,
          workerReleaseId: twiml.workerReleaseId,
        });
      }

      if (input.duplicateMediaStream === true) {
        await waitForOwnerPlayback({
          ownerPlayback,
          socketClosed,
          readError: () => lifecycleError,
          timeoutMs: input.connectTimeoutMs ?? 5_000,
          signal: input.signal,
        });
        result.duplicateMediaStream = await this.attemptDuplicateMediaStream({
          accountSid: input.accountSid,
          callSid: input.callSid,
          connectTimeoutMs: input.connectTimeoutMs ?? 5_000,
          streamSid,
          streamToken: twiml.streamToken,
          streamUrl: twiml.streamUrl,
          runtimePath: twiml.runtimePath,
          workerId: twiml.workerId,
          workerReleaseId: twiml.workerReleaseId,
        });
      }

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

  private async attemptDuplicateMediaStream(input: {
    accountSid: string;
    callSid: string;
    connectTimeoutMs: number;
    streamSid: string;
    streamToken: string;
    streamUrl: string;
    runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
    workerId: string | undefined;
    workerReleaseId: string | undefined;
  }) {
    const socket = (this.dependencies.websocketFactory ?? ((url) => new WebSocket(url)))(input.streamUrl);
    let closed = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const outcome = new Promise<
      | { type: "closed"; closeCode: number }
      | { type: "message" }
      | { type: "error" }
      | { type: "timeout" }
    >((resolve) => {
      const settle = (value:
        | { type: "closed"; closeCode: number }
        | { type: "message" }
        | { type: "error" }
        | { type: "timeout" }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      timeout = setTimeout(() => settle({ type: "timeout" }), Math.max(1, input.connectTimeoutMs));
      socket.on("message", () => settle({ type: "message" }));
      socket.on("error", () => settle({ type: "error" }));
      socket.on("close", (code) => {
        closed = true;
        settle({ type: "closed", closeCode: code });
      });
    });

    try {
      await waitForOpen(socket, input.connectTimeoutMs);
      sendMediaStreamBootstrap(socket, input);
      const rejection = await outcome;
      if (rejection.type === "message") {
        throw new Error("Duplicate media stream produced provider-side output before rejection.");
      }
      if (rejection.type === "error") {
        throw new Error("Duplicate media stream failed before deterministic rejection.");
      }
      if (rejection.type === "timeout") {
        throw new Error("Timed out waiting for duplicate media stream rejection.");
      }
      if (rejection.closeCode !== 4409) {
        throw new Error(`Duplicate media stream closed with unexpected code ${rejection.closeCode}.`);
      }
      return { closeCode: rejection.closeCode };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (!closed) {
        if (socket.terminate !== undefined) socket.terminate();
        else socket.close(1011, "simulated_duplicate_cleanup");
      }
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

type RaceCandidate = {
  socket: CallerWebSocket;
  messages: Array<RawData | Buffer>;
  buffering: boolean;
  failed: boolean;
  closedCode?: number | undefined;
  terminal: Promise<{ type: "close"; code: number } | { type: "error" }>;
};

async function establishSimultaneousMediaRace(input: {
  accountSid: string;
  callSid: string;
  connectTimeoutMs: number;
  createSocket: (url: string) => CallerWebSocket;
  runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
  streamSid: string;
  streamToken: string;
  streamUrl: string;
  workerId: string | undefined;
  workerReleaseId: string | undefined;
}) {
  const candidates = [createRaceCandidate(input.createSocket(input.streamUrl)), createRaceCandidate(
    input.createSocket(input.streamUrl),
  )] as const;
  try {
    await Promise.all(candidates.map(({ socket }) => waitForOpen(socket, input.connectTimeoutMs)));
    sendMediaStreamBootstrap(candidates[0].socket, input);
    if (candidates[0].messages.length > 0 || candidates[1].messages.length > 0) {
      throw new Error("Provider output arrived before both duplicate media streams attempted ownership.");
    }
    sendMediaStreamBootstrap(candidates[1].socket, input);
    const terminal = await waitForRaceTerminal(candidates, input.connectTimeoutMs);
    if (terminal.outcome.type !== "close" || terminal.outcome.code !== 4409) {
      throw new Error("Simultaneous duplicate media race did not produce deterministic rejection.");
    }
    const loser = candidates[terminal.index];
    const owner = candidates[terminal.index === 0 ? 1 : 0];
    if (loser.messages.length > 0) {
      throw new Error("Rejected duplicate media stream produced provider-side output.");
    }
    if (owner.closedCode !== undefined || owner.failed) {
      throw new Error("Simultaneous duplicate media race did not retain one owner.");
    }
    return { owner, loserCloseCode: terminal.outcome.code };
  } catch (error) {
    for (const { socket, closedCode } of candidates) {
      if (closedCode === undefined) {
        if (socket.terminate !== undefined) socket.terminate();
        else socket.close(1011, "simulated_race_cleanup");
      }
    }
    throw error;
  }
}

function createRaceCandidate(socket: CallerWebSocket): RaceCandidate {
  const messages: Array<RawData | Buffer> = [];
  let resolveTerminal: (
    outcome: { type: "close"; code: number } | { type: "error" },
  ) => void = () => undefined;
  let settled = false;
  const candidate: RaceCandidate = {
    socket,
    messages,
    buffering: true,
    failed: false,
    terminal: new Promise((resolve) => {
      resolveTerminal = resolve;
    }),
  };
  socket.on("message", (raw) => {
    if (candidate.buffering) messages.push(raw);
  });
  socket.on("error", () => {
    candidate.failed = true;
    if (settled) return;
    settled = true;
    resolveTerminal({ type: "error" });
  });
  socket.on("close", (code) => {
    candidate.closedCode = code;
    if (settled) return;
    settled = true;
    resolveTerminal({ type: "close", code });
  });
  return candidate;
}

async function waitForRaceTerminal(
  candidates: readonly [RaceCandidate, RaceCandidate],
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Timed out waiting for simultaneous duplicate media rejection.")),
      Math.max(1, timeoutMs),
    );
  });
  try {
    return await Promise.race([
      candidates[0].terminal.then((outcome) => ({ index: 0 as const, outcome })),
      candidates[1].terminal.then((outcome) => ({ index: 1 as const, outcome })),
      timedOut,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function sendMediaStreamBootstrap(socket: CallerWebSocket, input: {
  accountSid: string;
  callSid: string;
  runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
  streamSid: string;
  streamToken: string;
  workerId: string | undefined;
  workerReleaseId: string | undefined;
}) {
  sendJson(socket, { event: "connected", protocol: "Call", version: "1.0.0" });
  sendJson(socket, {
    event: "start",
    sequenceNumber: "1",
    streamSid: input.streamSid,
    start: {
      accountSid: input.accountSid,
      callSid: input.callSid,
      streamSid: input.streamSid,
      tracks: ["inbound"],
      customParameters: {
        zaraStreamToken: input.streamToken,
        zaraRuntimePath: input.runtimePath,
        ...(input.workerId === undefined ? {} : { zaraWorkerId: input.workerId }),
        ...(input.workerReleaseId === undefined
          ? {}
          : { zaraWorkerReleaseId: input.workerReleaseId }),
      },
      mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8_000, channels: 1 },
    },
  });
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
    if (this.cancelled) return false;
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
      return true;
    }
    if (message.event === "mark" && typeof message.mark?.name === "string") {
      this.queue.push({ type: "mark", name: message.mark.name, generation: this.generation });
      this.startDrain();
      return false;
    }
    if (message.event === "clear") this.clear();
    return false;
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

async function waitForOwnerPlayback(input: {
  ownerPlayback: Promise<void>;
  socketClosed: Promise<void>;
  readError: () => Error | undefined;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), Math.max(1, input.timeoutMs));
  });
  const outcome = await Promise.race([
    input.ownerPlayback.then(() => "playback" as const),
    input.socketClosed.then(() => "closed" as const),
    timedOut,
    ...(input.signal === undefined
      ? []
      : [waitUntilAborted(input.signal).then(() => "aborted" as const)]),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (outcome === "playback") return;
  if (outcome === "aborted") throwIfAborted(input.signal);
  if (input.readError() !== undefined) {
    throw new Error("Primary media stream failed before ownership was established.");
  }
  if (outcome === "closed") {
    throw new Error("Primary media stream closed before ownership was established.");
  }
  throw new Error("Timed out waiting for primary media stream ownership.");
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
