declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export interface MicrophoneTurnRecorder {
  readonly sampleRateHz: number;
  startTurnCapture(): void;
  stopTurnCapture(): void;
  dispose(): Promise<void>;
}

export interface PcmAudioPlayer {
  enqueue(audioBase64: string): Promise<void>;
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
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
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

export function createPcmAudioPlayer(): PcmAudioPlayer {
  const AudioContextConstructor = getAudioContextConstructor();

  if (AudioContextConstructor === null) {
    return {
      async enqueue() {},
      async dispose() {},
    };
  }

  const audioContext = new AudioContextConstructor({
    sampleRate: 16_000,
  });
  let nextPlaybackAt = 0;

  return {
    async enqueue(audioBase64) {
      const samples = decodePcm16Chunk(audioBase64);

      if (samples.length === 0) {
        return;
      }

      await audioContext.resume();
      const audioBuffer = audioContext.createBuffer(1, samples.length, 16_000);
      audioBuffer.copyToChannel(samples, 0);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      const startAt = Math.max(audioContext.currentTime, nextPlaybackAt);
      source.start(startAt);
      nextPlaybackAt = startAt + audioBuffer.duration;
    },
    async dispose() {
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
