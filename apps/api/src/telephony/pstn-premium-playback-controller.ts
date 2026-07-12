const frameByteLength = 160;
const inFlightMarkLimit = 50;
const queuedAudioByteLimit = 40_000;
const invalidatedResponseLimit = 64;
const trackedResponseLimit = 64;
const maxDeltaAudioBytes = queuedAudioByteLimit
  + (inFlightMarkLimit * frameByteLength)
  + (frameByteLength - 1);
const maxDeltaBase64Length = 4 * Math.ceil(maxDeltaAudioBytes / 3);

export type PstnPremiumPlaybackInputResult =
  | { accepted: true }
  | { accepted: false; reason: "response_invalidated" | "response_unregistered" };

type QueuedCommand =
  | { type: "frame"; responseId: string; generation: number; bytes: Buffer }
  | { type: "boundary"; responseId: string; generation: number };

interface ResponsePlaybackState {
  generation: number;
  outstandingFrameCount: number;
  finished: boolean;
  boundaryAcknowledged: boolean;
}

export interface PstnPremiumPlaybackFrame {
  responseId: string;
  generation: number;
  payloadBase64: string;
}

export class PstnPremiumPlaybackController {
  private readonly remainders = new Map<string, Buffer>();
  private readonly queuedCommands: QueuedCommand[] = [];
  private readonly inFlightMarks = new Map<string, {
    responseId: string;
    generation: number;
    type: "frame" | "boundary";
  }>();
  private readonly responses = new Map<string, ResponsePlaybackState>();
  private readonly invalidatedResponseIds = new Set<string>();
  private queuedAudioBytes = 0;
  private generation = 0;
  private nextMarkSequence = 1;

  constructor(private readonly output: {
    sendFrame(frame: PstnPremiumPlaybackFrame): void;
    sendMark(name: string): void;
    clear(): void;
    onResponseCompleted?(completion: { responseId: string; generation: number }): void;
  }) {}

  startResponse(responseId: string): PstnPremiumPlaybackInputResult {
    if (this.invalidatedResponseIds.has(responseId)) {
      return { accepted: false, reason: "response_invalidated" };
    }
    if (this.responses.has(responseId)) {
      return { accepted: true };
    }
    if (this.responses.size >= trackedResponseLimit) {
      throw new Error("premium_playback_overflow");
    }
    this.responses.set(responseId, {
      generation: this.generation,
      outstandingFrameCount: 0,
      finished: false,
      boundaryAcknowledged: false,
    });
    return { accepted: true };
  }

  appendDelta(responseId: string, payloadBase64: string) {
    if (this.invalidatedResponseIds.has(responseId)) {
      return { accepted: false, reason: "response_invalidated" } as const;
    }
    if (!this.responses.has(responseId)) {
      return { accepted: false, reason: "response_unregistered" } as const;
    }
    if (payloadBase64.length > maxDeltaBase64Length) {
      throw new Error("premium_playback_delta_too_large");
    }
    const previous = this.remainders.get(responseId) ?? Buffer.alloc(0);
    const bytes = Buffer.concat([previous, Buffer.from(payloadBase64, "base64")]);
    this.assertQueueCapacity(Math.floor(bytes.length / frameByteLength));
    let offset = 0;

    while (bytes.length - offset >= frameByteLength) {
      this.acceptFrame(responseId, bytes.subarray(offset, offset + frameByteLength));
      offset += frameByteLength;
    }

    const remainder = bytes.subarray(offset);
    if (remainder.length === 0) {
      this.remainders.delete(responseId);
    } else {
      this.remainders.set(responseId, Buffer.from(remainder));
    }
    return { accepted: true } as const;
  }

  finishResponse(responseId: string) {
    if (this.invalidatedResponseIds.has(responseId)) {
      return { accepted: false, reason: "response_invalidated" } as const;
    }
    const response = this.responses.get(responseId);
    if (response === undefined) {
      return { accepted: false, reason: "response_unregistered" } as const;
    }
    if (response.finished) {
      return { accepted: true } as const;
    }
    const remainder = this.remainders.get(responseId);
    if (remainder !== undefined) {
      const frame = Buffer.alloc(frameByteLength, 0xff);
      remainder.copy(frame);
      this.assertQueueCapacity(1);
      this.remainders.delete(responseId);
      this.acceptFrame(responseId, frame);
    }

    response.finished = true;
    this.acceptBoundary(responseId);
    this.completeResponseIfAcknowledged(responseId, response);
    return { accepted: true } as const;
  }

  acknowledgeMark(name: string) {
    const ownership = this.inFlightMarks.get(name);
    if (ownership === undefined) {
      return;
    }
    this.inFlightMarks.delete(name);
    const response = this.responses.get(ownership.responseId);
    if (response?.generation === ownership.generation) {
      if (ownership.type === "frame") {
        response.outstandingFrameCount -= 1;
      } else {
        response.boundaryAcknowledged = true;
      }
      this.completeResponseIfAcknowledged(ownership.responseId, response);
    }
    this.drainQueuedFrames();
  }

  interrupt() {
    const hasPlaybackOwnership = this.responses.size > 0
      || this.inFlightMarks.size > 0
      || this.queuedCommands.length > 0
      || this.remainders.size > 0;
    if (!hasPlaybackOwnership) {
      return;
    }
    for (const responseId of this.responses.keys()) {
      this.rememberInvalidatedResponse(responseId);
    }
    this.generation += 1;
    this.queuedCommands.length = 0;
    this.queuedAudioBytes = 0;
    this.remainders.clear();
    this.inFlightMarks.clear();
    this.responses.clear();
    if (hasPlaybackOwnership) {
      this.output.clear();
    }
  }

  getState() {
    return {
      generation: this.generation,
      inFlightMarkCount: this.inFlightMarks.size,
      queuedFrameCount: this.queuedCommands.filter((command) => command.type === "frame").length,
      queuedAudioBytes: this.queuedAudioBytes,
      trackedResponseCount: this.responses.size,
      invalidatedResponseCount: this.invalidatedResponseIds.size,
      remainderByteCount: [...this.remainders.values()].reduce(
        (total, remainder) => total + remainder.length,
        0,
      ),
    };
  }

  private acceptFrame(responseId: string, bytes: Buffer) {
    const response = this.responses.get(responseId);
    if (response === undefined) {
      throw new Error("premium_playback_response_unregistered");
    }
    response.outstandingFrameCount += 1;
    const frame = {
      type: "frame" as const,
      responseId,
      generation: this.generation,
      bytes: Buffer.from(bytes),
    };
    if (this.inFlightMarks.size >= inFlightMarkLimit || this.queuedCommands.length > 0) {
      this.queuedCommands.push(frame);
      this.queuedAudioBytes += frame.bytes.length;
      return;
    }
    this.sendCommand(frame);
  }

  private assertQueueCapacity(frameCount: number) {
    const directCapacity = this.queuedCommands.length === 0
      ? inFlightMarkLimit - this.inFlightMarks.size
      : 0;
    const queuedFrameCount = Math.max(0, frameCount - directCapacity);
    if (this.queuedAudioBytes + (queuedFrameCount * frameByteLength) > queuedAudioByteLimit) {
      throw new Error("premium_playback_overflow");
    }
  }

  private completeResponseIfAcknowledged(
    responseId: string,
    response: ResponsePlaybackState,
  ) {
    if (
      !response.finished
      || !response.boundaryAcknowledged
      || response.outstandingFrameCount !== 0
    ) {
      return;
    }
    this.responses.delete(responseId);
    this.rememberInvalidatedResponse(responseId);
    this.output.onResponseCompleted?.({ responseId, generation: response.generation });
  }

  private rememberInvalidatedResponse(responseId: string) {
    this.invalidatedResponseIds.delete(responseId);
    this.invalidatedResponseIds.add(responseId);
    if (this.invalidatedResponseIds.size <= invalidatedResponseLimit) {
      return;
    }
    const oldest = this.invalidatedResponseIds.values().next().value as string | undefined;
    if (oldest !== undefined) {
      this.invalidatedResponseIds.delete(oldest);
    }
  }

  private acceptBoundary(responseId: string) {
    const boundary = { type: "boundary" as const, responseId, generation: this.generation };
    if (this.inFlightMarks.size >= inFlightMarkLimit || this.queuedCommands.length > 0) {
      this.queuedCommands.push(boundary);
      return;
    }
    this.sendCommand(boundary);
  }

  private sendCommand(command: QueuedCommand) {
    const markName = `zara-playback-${command.type}-${command.generation}-${this.nextMarkSequence}`;
    this.nextMarkSequence += 1;
    this.inFlightMarks.set(markName, {
      responseId: command.responseId,
      generation: command.generation,
      type: command.type,
    });
    if (command.type === "frame") {
      this.output.sendFrame({
        responseId: command.responseId,
        generation: command.generation,
        payloadBase64: command.bytes.toString("base64"),
      });
    }
    this.output.sendMark(markName);
  }

  private drainQueuedFrames() {
    while (this.inFlightMarks.size < inFlightMarkLimit) {
      const command = this.queuedCommands.shift();
      if (command === undefined) {
        return;
      }
      if (command.type === "frame") {
        this.queuedAudioBytes -= command.bytes.length;
      }
      this.sendCommand(command);
    }
  }
}
