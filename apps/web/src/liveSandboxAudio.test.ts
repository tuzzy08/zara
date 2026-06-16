/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMicrophoneTurnRecorder,
  createPcmAudioPlayer,
  decodePcm16Chunk,
  encodePcm16Chunk,
} from "./liveSandboxAudio";

describe("live sandbox audio helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.AudioContext = undefined as unknown as typeof AudioContext;
  });

  it("round-trips float samples through pcm16 base64 encoding", () => {
    const input = new Float32Array([0, 0.25, -0.5, 0.9, -1]);

    const encoded = encodePcm16Chunk(input);
    const decoded = decodePcm16Chunk(encoded);

    expect(decoded.length).toBe(input.length);
    input.forEach((sample, index) => {
      expect(decoded[index] ?? 0).toBeCloseTo(sample, 3);
    });
  });

  it("can prime output playback during the user's start-call gesture", async () => {
    const resume = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);

    const AudioContextMock = class {
      currentTime = 0;
      destination = {};
      resume = resume;
      close = close;

      createBuffer() {
        return {
          duration: 0.1,
          copyToChannel: vi.fn(),
        };
      }

      createBufferSource() {
        return {
          buffer: null,
          connect: vi.fn(),
          start: vi.fn(),
        };
      }
    };

    vi.stubGlobal("AudioContext", AudioContextMock);
    window.AudioContext = AudioContextMock as unknown as typeof AudioContext;

    const player = createPcmAudioPlayer();

    await player.prime();

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("plays realtime PCM chunks with their provider sample rate", async () => {
    const createdBuffers: Array<{ channels: number; sampleCount: number; sampleRate: number }> = [];
    const AudioContextMock = class {
      currentTime = 0;
      destination = {};

      createBuffer(channels: number, sampleCount: number, sampleRate: number) {
        createdBuffers.push({ channels, sampleCount, sampleRate });
        return {
          duration: sampleCount / sampleRate,
          copyToChannel: vi.fn(),
        };
      }

      createBufferSource() {
        return {
          buffer: null,
          connect: vi.fn(),
          start: vi.fn(),
        };
      }

      async resume() {}

      async close() {}
    };

    vi.stubGlobal("AudioContext", AudioContextMock);
    window.AudioContext = AudioContextMock as unknown as typeof AudioContext;

    const player = createPcmAudioPlayer();
    await player.enqueue(encodePcm16Chunk(new Float32Array([0, 0.25])), {
      sampleRateHz: 24_000,
    });

    expect(createdBuffers).toEqual([
      {
        channels: 1,
        sampleCount: 2,
        sampleRate: 24_000,
      },
    ]);
  });

  it("stops queued realtime PCM playback when the caller interrupts", async () => {
    const stoppedSources: Array<{ stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const AudioContextMock = class {
      currentTime = 2;
      destination = {};

      createBuffer(_channels: number, sampleCount: number, sampleRate: number) {
        return {
          duration: sampleCount / sampleRate,
          copyToChannel: vi.fn(),
        };
      }

      createBufferSource() {
        const source = {
          buffer: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null as (() => void) | null,
        };
        stoppedSources.push(source);
        return source;
      }

      async resume() {}

      async close() {}
    };

    vi.stubGlobal("AudioContext", AudioContextMock);
    window.AudioContext = AudioContextMock as unknown as typeof AudioContext;

    const player = createPcmAudioPlayer();
    await player.enqueue(encodePcm16Chunk(new Float32Array([0, 0.25])), {
      sampleRateHz: 24_000,
    });
    await player.enqueue(encodePcm16Chunk(new Float32Array([0.5, -0.25])), {
      sampleRateHz: 24_000,
    });

    player.interrupt();

    expect(stoppedSources).toHaveLength(2);
    expect(stoppedSources[0]?.stop).toHaveBeenCalledTimes(1);
    expect(stoppedSources[1]?.stop).toHaveBeenCalledTimes(1);
    expect(stoppedSources[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(stoppedSources[1]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("falls back to smaller microphone chunks when AudioWorklet is unavailable", async () => {
    const stream = createFakeMediaStream();
    const context = createFakeCaptureAudioContext({ hasAudioWorklet: false });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => stream),
      },
    });
    vi.stubGlobal("AudioContext", context.AudioContextMock);
    window.AudioContext = context.AudioContextMock as unknown as typeof AudioContext;

    const recorder = await createMicrophoneTurnRecorder({
      onAudioChunk: vi.fn(),
    });

    expect(context.createScriptProcessor).toHaveBeenCalledWith(1024, 1, 1);
    expect(recorder.sampleRateHz).toBe(16_000);

    await recorder.dispose();
  });

  it("uses AudioWorklet microphone capture when the browser supports it", async () => {
    const audioChunks: string[] = [];
    const stream = createFakeMediaStream();
    const context = createFakeCaptureAudioContext({ hasAudioWorklet: true });
    const workletNode = createFakeAudioWorkletNode();
    const createObjectUrl = vi.fn(() => "blob:zara-microphone-worklet");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => stream),
      },
    });
    vi.stubGlobal("AudioContext", context.AudioContextMock);
    vi.stubGlobal("AudioWorkletNode", workletNode.AudioWorkletNodeMock);
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    window.AudioContext = context.AudioContextMock as unknown as typeof AudioContext;

    const recorder = await createMicrophoneTurnRecorder({
      onAudioChunk: (chunk) => {
        audioChunks.push(chunk);
      },
    });
    recorder.startTurnCapture();
    workletNode.postMessage(new Float32Array([0.25, -0.25]));

    expect(context.audioWorkletAddModule).toHaveBeenCalledWith("blob:zara-microphone-worklet");
    expect(context.createScriptProcessor).not.toHaveBeenCalled();
    expect(decodePcm16Chunk(audioChunks[0] ?? "")).toHaveLength(2);

    await recorder.dispose();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:zara-microphone-worklet");
  });
});

function createFakeMediaStream() {
  return {
    getTracks: () => [
      {
        stop: vi.fn(),
      },
    ],
  } as unknown as MediaStream;
}

function createFakeCaptureAudioContext(input: { hasAudioWorklet: boolean }) {
  const createScriptProcessor = vi.fn(() => ({
    onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  const audioWorkletAddModule = vi.fn(async () => undefined);

  const AudioContextMock = class {
    readonly sampleRate = 16_000;
    readonly destination = {};
    readonly audioWorklet = input.hasAudioWorklet
      ? {
          addModule: audioWorkletAddModule,
        }
      : undefined;

    createMediaStreamSource() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    createScriptProcessor = createScriptProcessor;

    createGain() {
      return {
        gain: {
          value: 1,
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    async resume() {}

    async close() {}
  };

  return {
    AudioContextMock,
    audioWorkletAddModule,
    createScriptProcessor,
  };
}

function createFakeAudioWorkletNode() {
  let currentPort: { onmessage: ((event: MessageEvent<Float32Array>) => void) | null } | null = null;

  const AudioWorkletNodeMock = class {
    readonly port = {
      onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null,
      close: vi.fn(),
    };
    readonly connect = vi.fn();
    readonly disconnect = vi.fn();

    constructor() {
      currentPort = this.port;
    }
  };

  return {
    AudioWorkletNodeMock,
    postMessage(samples: Float32Array) {
      currentPort?.onmessage?.({ data: samples } as MessageEvent<Float32Array>);
    },
  };
}
