import { describe, expect, it } from "vitest";

import { AssemblyAiSttProvider } from "./assemblyai-stt.provider";

describe("AssemblyAiSttProvider", () => {
  it("streams buffered audio frames and resolves the final transcript", async () => {
    const connection = new FakeAssemblySocketConnection();
    const provider = new AssemblyAiSttProvider({
      apiKey: "assembly-test-key",
      websocketFactory: () => connection,
    });
    const partials: string[] = [];
    const transcribePromise = provider.transcribeTurn({
      audioFramesBase64: [Buffer.from("frame-1").toString("base64")],
      sampleRateHz: 16_000,
      onPartial(event) {
        partials.push(event.transcript);
      },
    });

    connection.open();
    connection.message({
      type: "Turn",
      transcript: "I need help",
      utterance: "",
      end_of_turn: false,
      words: [{ confidence: 0.9 }],
    });
    connection.message({
      type: "Turn",
      transcript: "I need help with billing",
      utterance: "I need help with billing",
      end_of_turn: true,
      words: [{ confidence: 0.91 }, { confidence: 0.92 }],
    });

    const result = await transcribePromise;

    expect(partials).toEqual(["I need help"]);
    expect(connection.sentBuffers).toHaveLength(1);
    expect(connection.sentMessages.at(-1)).toBe("{\"type\":\"Terminate\"}");
    expect(result).toMatchObject({
      transcript: "I need help with billing",
      language: "en",
    });
  });
});

class FakeAssemblySocketConnection {
  sentMessages: string[] = [];
  sentBuffers: Buffer[] = [];
  private readonly listeners = new Map<string, Array<(value: unknown, reason?: Buffer) => void>>();

  on(event: string, listener: (value: unknown, reason?: Buffer) => void) {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  send(message: string | Buffer) {
    if (typeof message === "string") {
      this.sentMessages.push(message);
      return;
    }

    this.sentBuffers.push(message);
  }

  close(code?: number, reason?: string) {
    this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
  }

  open() {
    this.emit("open", undefined);
  }

  message(payload: Record<string, unknown>) {
    this.emit("message", Buffer.from(JSON.stringify(payload), "utf8"));
  }

  error(error: Error) {
    this.emit("error", error);
  }

  private emit(event: string, value: unknown, reason?: Buffer) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value, reason);
    }
  }
}
