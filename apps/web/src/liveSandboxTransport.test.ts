import { describe, expect, it, vi } from "vitest";

import { createLiveSandboxTransport } from "./liveSandboxTransport";

describe("createLiveSandboxTransport", () => {
  it("appends token, workspace, and source scope to the websocket url", async () => {
    const openedUrls: string[] = [];
    const socket = createMockSocket();
    const transport = createLiveSandboxTransport({
      transportUrl: "ws://127.0.0.1:4010/organizations/tenant-west-africa/sandbox/live-sessions/session-1/stream",
      transportToken: "transport-token",
      workspaceId: "workspace-operations",
      source: "draft",
      webSocketFactory: (url) => {
        openedUrls.push(url);
        queueMicrotask(() => {
          socket.emit("open");
        });
        return socket;
      },
      onEvent: vi.fn(),
    });

    await transport.connect();

    expect(openedUrls).toEqual([
      "ws://127.0.0.1:4010/organizations/tenant-west-africa/sandbox/live-sessions/session-1/stream?token=transport-token&workspaceId=workspace-operations&source=draft",
    ]);
  });

  it("includes sandbox intent in typed and voice transport messages", async () => {
    const sentMessages: string[] = [];
    const socket = createMockSocket({
      send: (message) => {
        sentMessages.push(message);
      },
    });
    const transport = createLiveSandboxTransport({
      transportUrl: "ws://127.0.0.1:4010/organizations/tenant-west-africa/sandbox/live-sessions/session-1/stream",
      transportToken: "transport-token",
      workspaceId: "workspace-operations",
      source: "draft",
      webSocketFactory: () => {
        queueMicrotask(() => {
          socket.emit("open");
        });
        return socket;
      },
      onEvent: vi.fn(),
    });

    await transport.connect();
    transport.sendTextTurn({
      transcript: "Please route this to the right team.",
      callPhase: "tool-use",
      intent: "billing",
    });
    transport.appendAudioChunk("audio-frame", {
      sampleRateHz: 16_000,
      callPhase: "tool-use",
      intent: "billing",
    });
    transport.commitAudioTurn({
      sampleRateHz: 16_000,
      callPhase: "tool-use",
      intent: "billing",
    });

    expect(sentMessages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "input.text",
        transcript: "Please route this to the right team.",
        callPhase: "tool-use",
        intent: "billing",
      },
      {
        type: "input.audio.append",
        audioBase64: "audio-frame",
        sampleRateHz: 16_000,
        callPhase: "tool-use",
        intent: "billing",
      },
      {
        type: "input.audio.commit",
        sampleRateHz: 16_000,
        callPhase: "tool-use",
        intent: "billing",
      },
    ]);
  });
});

function createMockSocket(options?: { send?: ((message: string) => void) | undefined }) {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();

  return {
    readyState: 0,
    addEventListener(event: string, listener: (event: unknown) => void) {
      const current = listeners.get(event) ?? new Set<(event?: unknown) => void>();
      current.add(listener);
      listeners.set(event, current);
    },
    removeEventListener(event: string, listener: (event: unknown) => void) {
      listeners.get(event)?.delete(listener);
    },
    send(message: string) {
      options?.send?.(message);
    },
    close() {
      return undefined;
    },
    emit(event: string, payload?: unknown) {
      if (event === "open") {
        this.readyState = 1;
      }

      for (const listener of listeners.get(event) ?? []) {
        listener(payload);
      }
    },
  };
}
