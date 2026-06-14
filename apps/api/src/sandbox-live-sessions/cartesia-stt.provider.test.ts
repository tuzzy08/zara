import { describe, expect, it } from "vitest";

import { CartesiaInkSttProvider } from "./cartesia-stt.provider";

describe("CartesiaInkSttProvider", () => {
  it("maps Ink 2 turn events into live STT callbacks", () => {
    const connection = new FakeCartesiaSttSocketConnection();
    const provider = new CartesiaInkSttProvider({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
      websocketFactory: () => connection,
    });
    const partials: string[] = [];
    const finals: string[] = [];
    const telemetry: string[] = [];

    const stream = provider.createStreamingSession({
      sampleRateHz: 16_000,
      config: {
        languageCode: "en",
      },
      onPartial(event) {
        partials.push(event.transcript);
      },
      onFinal(event) {
        finals.push(event.transcript);
      },
      onTelemetry(event) {
        telemetry.push(event.event);
      },
    });

    connection.open();
    stream.appendAudioFrame(Buffer.from("frame-1").toString("base64"));
    connection.message({ type: "turn.start", request_id: "req-1" });
    connection.message({ type: "turn.update", transcript: "I need", request_id: "req-1" });
    connection.message({ type: "turn.eager_end", transcript: "I need help", request_id: "req-1" });
    connection.message({ type: "turn.resume", request_id: "req-1" });
    connection.message({ type: "turn.end", transcript: "I need help with billing.", request_id: "req-1" });

    expect(connection.sentBuffers.map((buffer) => buffer.toString("utf8"))).toEqual(["frame-1"]);
    expect(partials).toEqual(["I need"]);
    expect(finals).toEqual(["I need help with billing."]);
    expect(telemetry).toEqual(["turn.start", "turn.update", "turn.eager_end", "turn.resume", "turn.end"]);
  });

  it("sends the Cartesia close command on termination", () => {
    const connection = new FakeCartesiaSttSocketConnection();
    const provider = new CartesiaInkSttProvider({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
      websocketFactory: () => connection,
    });

    const stream = provider.createStreamingSession({
      sampleRateHz: 16_000,
      config: {
        languageCode: "en",
      },
      onFinal() {},
    });

    connection.open();
    stream.terminate();

    expect(connection.sentMessages.at(-1)).toBe("{\"type\":\"close\"}");
  });
});

class FakeCartesiaSttSocketConnection {
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

  private emit(event: string, value: unknown, reason?: Buffer) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value, reason);
    }
  }
}
