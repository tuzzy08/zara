declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const microphoneChunkSizeSamples = 1024;
const microphoneWorkletProcessorName = "zara-microphone-capture";
const microphoneWorkletSource = `
class ZaraMicrophoneCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${microphoneChunkSizeSamples});
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      return true;
    }

    let readOffset = 0;
    while (readOffset < channel.length) {
      const writable = Math.min(this.buffer.length - this.offset, channel.length - readOffset);
      this.buffer.set(channel.subarray(readOffset, readOffset + writable), this.offset);
      this.offset += writable;
      readOffset += writable;

      if (this.offset === this.buffer.length) {
        const chunk = this.buffer;
        this.port.postMessage(chunk, [chunk.buffer]);
        this.buffer = new Float32Array(${microphoneChunkSizeSamples});
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("${microphoneWorkletProcessorName}", ZaraMicrophoneCaptureProcessor);
`;

export interface MicrophoneTurnRecorder {
  readonly sampleRateHz: number;
  startTurnCapture(): void;
  stopTurnCapture(): void;
  dispose(): Promise<void>;
}

export interface PcmAudioPlayer {
  prime(): Promise<void>;
  enqueue(audioBase64: string, input?: { sampleRateHz?: number | undefined }): Promise<void>;
  interrupt(): void;
  dispose(): Promise<void>;
}

export function encodePcm16Chunk(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(index * 2, value, true);
  }

  return bytesToBase64(new Uint8Array(buffer));
}

export function decodePcm16Chunk(audioBase64: string) {
  const bytes = base64ToBytes(audioBase64);
  const sampleCount = Math.floor(bytes.length / 2);
  const output = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let index = 0; index < sampleCount; index += 1) {
    const value = view.getInt16(index * 2, true);
    output[index] = value / (value < 0 ? 0x8000 : 0x7fff);
  }

  return output;
}

export async function createMicrophoneTurnRecorder(input: {
  onAudioChunk: (audioBase64: string) => void;
}) {
  if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia === undefined) {
    throw new Error("Microphone input is unavailable in this browser.");
  }

  const AudioContextConstructor = getAudioContextConstructor();

  if (AudioContextConstructor === null) {
    throw new Error("Web Audio is unavailable in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContextConstructor({
    sampleRate: 16_000,
  });
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const workletCapture = await createMicrophoneWorkletCapture({
    audioContext,
    sourceNode,
    onAudioChunk: input.onAudioChunk,
  });

  if (workletCapture !== null) {
    return {
      sampleRateHz: audioContext.sampleRate,
      startTurnCapture() {
        workletCapture.setCapturing(true);
        void audioContext.resume();
      },
      stopTurnCapture() {
        workletCapture.setCapturing(false);
      },
      async dispose() {
        workletCapture.setCapturing(false);
        workletCapture.dispose();
        sourceNode.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        await audioContext.close();
      },
    } satisfies MicrophoneTurnRecorder;
  }

  const processor = audioContext.createScriptProcessor(microphoneChunkSizeSamples, 1, 1);
  const sinkGain = audioContext.createGain();
  sinkGain.gain.value = 0;
  let capturing = false;

  processor.onaudioprocess = (event) => {
    if (!capturing) {
      return;
    }

    input.onAudioChunk(encodePcm16Chunk(event.inputBuffer.getChannelData(0)));
  };

  sourceNode.connect(processor);
  processor.connect(sinkGain);
  sinkGain.connect(audioContext.destination);

  return {
    sampleRateHz: audioContext.sampleRate,
    startTurnCapture() {
      capturing = true;
      void audioContext.resume();
    },
    stopTurnCapture() {
      capturing = false;
    },
    async dispose() {
      capturing = false;
      processor.disconnect();
      sinkGain.disconnect();
      sourceNode.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close();
    },
  } satisfies MicrophoneTurnRecorder;
}

async function createMicrophoneWorkletCapture(input: {
  audioContext: AudioContext;
  sourceNode: MediaStreamAudioSourceNode;
  onAudioChunk: (audioBase64: string) => void;
}) {
  if (
    input.audioContext.audioWorklet === undefined
    || typeof AudioWorkletNode === "undefined"
    || typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  const moduleUrl = URL.createObjectURL(new Blob([microphoneWorkletSource], { type: "text/javascript" }));

  try {
    await input.audioContext.audioWorklet.addModule(moduleUrl);
  } catch {
    URL.revokeObjectURL(moduleUrl);
    return null;
  }

  const workletNode = new AudioWorkletNode(input.audioContext, microphoneWorkletProcessorName, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const sinkGain = input.audioContext.createGain();
  sinkGain.gain.value = 0;
  let capturing = false;

  workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (!capturing) {
      return;
    }

    input.onAudioChunk(encodePcm16Chunk(event.data));
  };

  input.sourceNode.connect(workletNode);
  workletNode.connect(sinkGain);
  sinkGain.connect(input.audioContext.destination);

  return {
    setCapturing(nextCapturing: boolean) {
      capturing = nextCapturing;
    },
    dispose() {
      workletNode.port.close();
      workletNode.disconnect();
      sinkGain.disconnect();
      URL.revokeObjectURL(moduleUrl);
    },
  };
}

export function createPcmAudioPlayer(): PcmAudioPlayer {
  const AudioContextConstructor = getAudioContextConstructor();

  if (AudioContextConstructor === null) {
    return {
      async prime() {},
      async enqueue() {},
      interrupt() {},
      async dispose() {},
    };
  }

  const audioContext = new AudioContextConstructor({
    sampleRate: 16_000,
  });
  let nextPlaybackAt = 0;
  const activeSources = new Set<AudioBufferSourceNode>();
  const prime = async () => {
    await audioContext.resume();
  };

  return {
    prime,
    async enqueue(audioBase64, input) {
      const samples = decodePcm16Chunk(audioBase64);

      if (samples.length === 0) {
        return;
      }

      await prime();
      const sampleRateHz = input?.sampleRateHz ?? 16_000;
      const audioBuffer = audioContext.createBuffer(1, samples.length, sampleRateHz);
      audioBuffer.copyToChannel(samples, 0);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        activeSources.delete(source);
        try {
          source.disconnect();
        } catch {
          // Some browsers throw when disconnecting an already-disconnected source.
        }
      };
      const startAt = Math.max(audioContext.currentTime, nextPlaybackAt);
      activeSources.add(source);
      source.start(startAt);
      nextPlaybackAt = startAt + audioBuffer.duration;
    },
    interrupt() {
      activeSources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // The source may already have ended by the time interruption is processed.
        }
        try {
          source.disconnect();
        } catch {
          // Some browsers throw when disconnecting an already-disconnected source.
        }
      });
      activeSources.clear();
      nextPlaybackAt = audioContext.currentTime;
    },
    async dispose() {
      activeSources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // ignore already-ended sources during teardown
        }
      });
      activeSources.clear();
      await audioContext.close();
    },
  };
}

function getAudioContextConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.AudioContext ?? window.webkitAudioContext ?? null;
}

function bytesToBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  const output = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }

  return output;
}
